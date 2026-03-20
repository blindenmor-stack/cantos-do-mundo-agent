import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { parseWebhookPayload, getMessageContent, sendMultipleMessages } from "@/lib/zapi";
import { processMessage, calculateScore, getQualificationStatus, generateHandoffSummary, type ConversationContext } from "@/lib/ai-agent";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = getSupabase();

    // Parse the Z-API webhook payload
    const msg = parseWebhookPayload(body);
    if (!msg) {
      return NextResponse.json({ status: "ignored" });
    }

    const { type: msgType, content: msgContent } = getMessageContent(msg);
    if (!msgContent && msgType === "unknown") {
      return NextResponse.json({ status: "no_content" });
    }

    const phone = msg.phone.replace(/\D/g, "");

    // Find or create conversation
    let { data: conversation } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone", phone)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    let lead: Record<string, unknown> | null = null;

    if (!conversation) {
      // Create new lead
      const leadInsert: Record<string, unknown> = {
        phone,
        name: msg.senderName || null,
        source: "whatsapp",
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

      const { data: newLead } = await supabase
        .from("leads")
        .insert(leadInsert)
        .select()
        .single();

      lead = newLead;

      // Create conversation
      const { data: newConv } = await supabase
        .from("conversations")
        .insert({
          lead_id: newLead?.id,
          phone,
          bot_active: true,
          current_step: "greeting",
          qualification_data: {},
        })
        .select()
        .single();

      conversation = newConv;
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
            ad_id: msg.referral.sourceId || lead.ad_id,
          })
          .eq("id", lead.id);
      }
    }

    if (!conversation || !lead) {
      console.error("[Webhook] Failed to create conversation or lead");
      return NextResponse.json({ status: "error" }, { status: 500 });
    }

    // Save incoming message
    await supabase.from("messages").insert({
      conversation_id: conversation.id,
      lead_id: lead.id,
      direction: "incoming",
      content: msgContent,
      message_type: msgType,
      is_from_bot: false,
      zapi_message_id: msg.messageId,
      metadata: msg.referral ? { referral: msg.referral } : {},
    });

    // If bot is not active, just save the message
    if (!conversation.bot_active) {
      return NextResponse.json({ status: "saved_human_mode" });
    }

    // Get conversation history
    const { data: history } = await supabase
      .from("messages")
      .select("direction, content, is_from_bot")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(20);

    const messagesHistory = (history || []).map((m) => ({
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
      await sendMultipleMessages(phone, result.responses);

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
    const convUpdate: Record<string, unknown> = {
      current_step: result.newStep,
      qualification_data: result.updatedData,
      last_message_at: new Date().toISOString(),
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
          name: result.updatedData.name || lead.name,
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
      if (result.updatedData.name && !lead.name) {
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

    return NextResponse.json({ status: "processed" });
  } catch (error) {
    console.error("[Webhook] Error:", error);
    // Always return 200 to Z-API to prevent webhook disabling
    return NextResponse.json({ status: "error", message: String(error) });
  }
}

// Z-API may send GET for webhook verification
export async function GET() {
  return NextResponse.json({ status: "ok", service: "cantos-do-mundo-agent" });
}
