import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { parseWebhookPayload, getMessageContent, sendMultipleMessages } from "@/lib/zapi";
import { processMessage, calculateScore, getQualificationStatus, generateHandoffSummary, type ConversationContext } from "@/lib/ai-agent";

export const maxDuration = 60;

const BUFFER_MS = 8000; // 8 seconds buffer to collect multiple messages

// Always return 200 to Z-API
function ok(data: Record<string, unknown> = {}) {
  return NextResponse.json({ status: "ok", ...data });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = getSupabase();

    console.log("[Webhook] Received:", JSON.stringify(body).slice(0, 500));

    const msg = parseWebhookPayload(body);
    if (!msg) return ok({ detail: "ignored" });

    const { type: msgType, content: msgContent } = getMessageContent(msg);
    if (!msgContent && msgType === "unknown") return ok({ detail: "no_content" });

    const phone = msg.phone.replace(/\D/g, "");

    // === STEP 1: Find or create conversation ===
    const { data: existingConv } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone", phone)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let conversation = existingConv;
    let lead: Record<string, unknown> | null = null;

    if (!conversation) {
      // New lead + new conversation
      const leadInsert: Record<string, unknown> = {
        phone,
        name: msg.senderName || null,
        source: "whatsapp",
        qualification_status: "pending",
        qualification_score: 0,
      };

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

      const { data: newConv, error: convError } = await supabase
        .from("conversations")
        .insert({
          lead_id: newLead.id,
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

      if (convError) {
        console.error("[Webhook] Error creating conversation:", convError);
        return ok({ detail: "conversation_creation_failed" });
      }
      conversation = newConv;
    } else {
      // Existing conversation - get lead
      const { data: existingLead } = await supabase
        .from("leads")
        .select("*")
        .eq("id", conversation.lead_id)
        .single();
      lead = existingLead;

      // Update CTWA if new click
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

    // === STEP 2: Dedup by messageId ===
    if (msg.messageId) {
      const { data: existingMsg } = await supabase
        .from("messages")
        .select("id")
        .eq("zapi_message_id", msg.messageId)
        .maybeSingle();

      if (existingMsg) {
        console.log("[Webhook] Duplicate messageId, skipping:", msg.messageId);
        return ok({ detail: "duplicate" });
      }
    }

    // === STEP 3: Save incoming message immediately ===
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

    // Update last_message_at
    await supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversation.id);

    // If bot is not active, just save
    if (!conversation.bot_active) {
      return ok({ detail: "saved_human_mode" });
    }

    // === STEP 4: Message buffer ===
    // Use context_summary to store the processing lock timestamp
    // Re-read fresh to avoid race conditions
    const { data: freshCheck } = await supabase
      .from("conversations")
      .select("context_summary")
      .eq("id", conversation.id)
      .single();

    const now = Date.now();
    const scheduledAt = freshCheck?.context_summary
      ? parseInt(freshCheck.context_summary, 10)
      : 0;

    if (scheduledAt > 0 && now - scheduledAt < BUFFER_MS + 3000) {
      // Another call is already waiting — just save and return
      console.log("[Webhook] Buffer active, message saved, skipping processing");
      return ok({ detail: "buffered" });
    }

    // Mark that we're scheduling processing
    await supabase
      .from("conversations")
      .update({ context_summary: String(now) })
      .eq("id", conversation.id);

    // Wait for buffer period to collect more messages
    console.log("[Webhook] Waiting buffer:", BUFFER_MS, "ms");
    await new Promise((r) => setTimeout(r, BUFFER_MS));

    // === STEP 4: Collect all unprocessed messages and process ===
    // Re-fetch conversation (may have been updated by other webhook calls)
    const { data: freshConv } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", conversation.id)
      .single();

    if (!freshConv || !freshConv.bot_active) {
      return ok({ detail: "bot_disabled_during_buffer" });
    }

    // Check if WE are the one who should process (our timestamp matches)
    const currentScheduled = freshConv.context_summary
      ? parseInt(freshConv.context_summary, 10)
      : 0;
    if (currentScheduled !== now) {
      // A newer webhook call took over — let it handle processing
      console.log("[Webhook] Newer buffer took over, skipping");
      return ok({ detail: "superseded" });
    }

    // Clear the lock
    await supabase
      .from("conversations")
      .update({ context_summary: null })
      .eq("id", conversation.id);

    // Get conversation history (includes all buffered messages)
    const { data: history } = await supabase
      .from("messages")
      .select("direction, content, is_from_bot")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(20);

    const messagesHistory = (history || [])
      .filter((m) => m.content)
      .map((m) => ({
        role: (m.direction === "incoming" ? "user" : "assistant") as "user" | "assistant",
        content: m.content || "",
      }));

    // Combine recent unprocessed user messages into one
    const recentUserMsgs: string[] = [];
    for (let i = messagesHistory.length - 1; i >= 0; i--) {
      if (messagesHistory[i].role === "user") {
        recentUserMsgs.unshift(messagesHistory[i].content);
      } else {
        break; // Stop at first bot message
      }
    }
    const combinedUserMessage = recentUserMsgs.join("\n");

    console.log("[Webhook] Processing combined message:", combinedUserMessage.slice(0, 200));

    // Process with AI
    const context: ConversationContext = {
      conversationId: conversation.id,
      leadId: lead.id as string,
      currentStep: freshConv.current_step || "greeting",
      qualificationData: freshConv.qualification_data || {},
      messagesHistory,
      botMessagesCount: freshConv.bot_messages_count || 0,
    };

    const result = await processMessage(combinedUserMessage, context);

    // Send responses
    if (result.responses.length > 0) {
      try {
        await sendMultipleMessages(phone, result.responses);
      } catch (sendError) {
        console.error("[Webhook] Error sending:", sendError);
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
    const convUpdate: Record<string, unknown> = {
      current_step: result.newStep,
      qualification_data: result.updatedData,
      last_message_at: new Date().toISOString(),
      bot_messages_count: (freshConv.bot_messages_count || 0) + result.responses.length,
      messages_count: (freshConv.messages_count || 0) + recentUserMsgs.length + result.responses.length,
    };

    if (result.shouldHandoff) {
      convUpdate.bot_active = false;
      convUpdate.handoff_at = new Date().toISOString();
      convUpdate.handoff_reason = result.handoffReason;

      const score = calculateScore(result.updatedData);
      convUpdate.handoff_summary = await generateHandoffSummary(result.updatedData, score);

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
    } else if (result.updatedData.name && !(lead.name as string)) {
      await supabase
        .from("leads")
        .update({ name: result.updatedData.name })
        .eq("id", lead.id);
    }

    await supabase
      .from("conversations")
      .update(convUpdate)
      .eq("id", conversation.id);

    return ok({ detail: "processed", buffered_messages: recentUserMsgs.length });
  } catch (error) {
    console.error("[Webhook] Unhandled error:", error);
    return ok({ detail: "error", message: String(error) });
  }
}

export async function GET() {
  return NextResponse.json({ status: "ok", service: "cantos-do-mundo-agent" });
}
