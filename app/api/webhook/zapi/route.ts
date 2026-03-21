import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { parseWebhookPayload, getMessageContent, sendMultipleMessages } from "@/lib/zapi";
import { processMessage, calculateScore, getQualificationStatus, generateHandoffSummary, type ConversationContext } from "@/lib/ai-agent";

export const maxDuration = 60;

// Always return 200 to Z-API to prevent webhook disabling
function ok(data: Record<string, unknown> = {}) {
  return NextResponse.json({ status: "ok", ...data });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = getSupabase();

    console.log("[Webhook] Received:", JSON.stringify(body).slice(0, 500));

    // Parse the Z-API webhook payload
    const msg = parseWebhookPayload(body);
    if (!msg) {
      return ok({ detail: "ignored" });
    }

    const { type: msgType, content: msgContent } = getMessageContent(msg);
    if (!msgContent && msgType === "unknown") {
      return ok({ detail: "no_content" });
    }

    const phone = msg.phone.replace(/\D/g, "");

    // Find or create conversation
    // Use maybeSingle() instead of single() to avoid error when no rows found
    const { data: existingConv, error: convError } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone", phone)
      .eq("bot_active", true)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (convError) {
      console.error("[Webhook] Error finding conversation:", convError);
    }

    let conversation = existingConv;
    let lead: Record<string, unknown> | null = null;

    if (!conversation) {
      // Also check for any recent conversation (even with bot inactive) to avoid duplicating leads
      const { data: recentConv } = await supabase
        .from("conversations")
        .select("*, leads:lead_id(*)")
        .eq("phone", phone)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentConv) {
        // Existing conversation found (bot may be inactive)
        conversation = recentConv;
        lead = recentConv.leads || null;

        // Update CTWA data if this is a new click
        if (msg.referral?.ctwaClid && lead) {
          await supabase
            .from("leads")
            .update({
              ctwa_clid: msg.referral.ctwaClid,
              ad_id: msg.referral.sourceId || (lead.ad_id as string),
            })
            .eq("id", lead.id);
        }
      } else {
        // Truly new conversation - create lead and conversation
        const leadInsert: Record<string, unknown> = {
          phone,
          name: msg.senderName || null,
          source: "whatsapp",
          qualification_status: "pending",
          qualification_score: 0,
        };

        // Capture CTWA and Ad data from referral
        if (msg.referral) {
          leadInsert.ctwa_clid = msg.referral.ctwaClid || null;
          leadInsert.ad_id = msg.referral.sourceId || null;
          if (msg.referral.sourceUrl) {
            leadInsert.utm_source = "meta";
            leadInsert.utm_medium = "ctwa";
          }
        }

        const { data: newLead, error: leadError } = await supabase
          .from("leads")
          .insert(leadInsert)
          .select()
          .single();

        if (leadError) {
          console.error("[Webhook] Error creating lead:", leadError);
          return ok({ detail: "lead_creation_failed" });
        }

        lead = newLead;

        // Create conversation
        const { data: newConv, error: newConvError } = await supabase
          .from("conversations")
          .insert({
            lead_id: newLead?.id,
            phone,
            bot_active: true,
            current_step: "greeting",
            qualification_data: {},
            bot_messages_count: 0,
            messages_count: 0,
            last_message_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (newConvError) {
          console.error("[Webhook] Error creating conversation:", newConvError);
          return ok({ detail: "conversation_creation_failed" });
        }

        conversation = newConv;
      }
    } else {
      // Get existing lead
      const { data: existingLead } = await supabase
        .from("leads")
        .select("*")
        .eq("id", conversation.lead_id)
        .single();
      lead = existingLead;

      // Update CTWA data if this is a new click
      if (msg.referral?.ctwaClid && lead) {
        await supabase
          .from("leads")
          .update({
            ctwa_clid: msg.referral.ctwaClid,
            ad_id: msg.referral.sourceId || (lead.ad_id as string),
          })
          .eq("id", lead.id);
      }
    }

    if (!conversation || !lead) {
      console.error("[Webhook] Failed to resolve conversation or lead");
      return ok({ detail: "resolution_failed" });
    }

    // Save incoming message
    const { error: msgInsertError } = await supabase.from("messages").insert({
      conversation_id: conversation.id,
      lead_id: lead.id,
      direction: "incoming",
      content: msgContent,
      message_type: msgType,
      is_from_bot: false,
      zapi_message_id: msg.messageId,
      metadata: msg.referral ? { referral: msg.referral } : {},
    });

    if (msgInsertError) {
      console.error("[Webhook] Error saving message:", msgInsertError);
    }

    // Increment messages_count
    await supabase
      .from("conversations")
      .update({
        messages_count: (conversation.messages_count || 0) + 1,
        last_message_at: new Date().toISOString(),
      })
      .eq("id", conversation.id);

    // If bot is not active, just save the message
    if (!conversation.bot_active) {
      return ok({ detail: "saved_human_mode" });
    }

    // Get conversation history
    const { data: history } = await supabase
      .from("messages")
      .select("direction, content, is_from_bot")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(20);

    const messagesHistory = (history || [])
      .filter((m) => m.content) // Skip empty messages
      .map((m) => ({
        role: (m.direction === "incoming" ? "user" : "assistant") as "user" | "assistant",
        content: m.content || "",
      }));

    // Process with AI
    const context: ConversationContext = {
      conversationId: conversation.id,
      leadId: lead.id as string,
      currentStep: conversation.current_step || "greeting",
      qualificationData: conversation.qualification_data || {},
      messagesHistory,
      botMessagesCount: conversation.bot_messages_count || 0,
    };

    const result = await processMessage(msgContent, context);

    // Send responses via Z-API
    if (result.responses.length > 0) {
      try {
        await sendMultipleMessages(phone, result.responses);
      } catch (sendError) {
        console.error("[Webhook] Error sending Z-API messages:", sendError);
        // Still save the messages to DB even if sending failed
      }

      // Save bot messages
      for (const response of result.responses) {
        await supabase.from("messages").insert({
          conversation_id: conversation.id,
          lead_id: lead.id,
          direction: "outgoing",
          content: response,
          message_type: "text",
          is_from_bot: true,
        });
      }
    }

    // Update conversation
    const newBotCount = (conversation.bot_messages_count || 0) + result.responses.length;
    const newMsgCount = (conversation.messages_count || 0) + 1 + result.responses.length;

    const convUpdate: Record<string, unknown> = {
      current_step: result.newStep,
      qualification_data: result.updatedData,
      last_message_at: new Date().toISOString(),
      bot_messages_count: newBotCount,
      messages_count: newMsgCount,
    };

    if (result.shouldHandoff) {
      convUpdate.bot_active = false;
      convUpdate.handoff_at = new Date().toISOString();
      convUpdate.handoff_reason = result.handoffReason;

      const score = calculateScore(result.updatedData);
      convUpdate.handoff_summary = await generateHandoffSummary(result.updatedData, score);

      // Update lead qualification
      await supabase
        .from("leads")
        .update({
          name: result.updatedData.name || (lead.name as string),
          destination_interest: result.updatedData.destination,
          travel_dates: result.updatedData.travel_dates,
          travelers_count: result.updatedData.travelers_count,
          travelers_type: result.updatedData.travelers_type,
          has_international_experience: result.updatedData.has_international_experience,
          travel_style: result.updatedData.travel_style,
          qualification_score: score,
          qualification_status: getQualificationStatus(score),
          qualification_summary: convUpdate.handoff_summary,
        })
        .eq("id", lead.id);
    } else {
      // Update lead name if captured
      if (result.updatedData.name && !(lead.name as string)) {
        await supabase
          .from("leads")
          .update({ name: result.updatedData.name })
          .eq("id", lead.id);
      }
    }

    await supabase
      .from("conversations")
      .update(convUpdate)
      .eq("id", conversation.id);

    return ok({ detail: "processed" });
  } catch (error) {
    console.error("[Webhook] Unhandled error:", error);
    // CRITICAL: Always return 200 to Z-API to prevent webhook disabling
    return ok({ detail: "error", message: String(error) });
  }
}

// Z-API may send GET for webhook verification
export async function GET() {
  return NextResponse.json({ status: "ok", service: "cantos-do-mundo-agent" });
}
