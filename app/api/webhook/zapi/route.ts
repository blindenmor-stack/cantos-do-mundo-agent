import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { parseWebhookPayload, getMessageContent, sendMultipleMessages } from "@/lib/zapi";
import { processMessage, calculateScore, getQualificationStatus, generateHandoffSummary, type ConversationContext } from "@/lib/ai-agent";
import { notifyHumanAgent } from "@/lib/notify";
import { evaluateBotGate, logGateDecision } from "@/lib/bot-gate";
import { transcribeAudio, describeImage } from "@/lib/media";

export const maxDuration = 60;

const BUFFER_MS = 15000; // 15 seconds buffer — people send multiple short messages

// Always return 200 to Z-API
function ok(data: Record<string, unknown> = {}) {
  return NextResponse.json({ status: "ok", ...data });
}

// Structured error logging
function logError(phase: string, detail: Record<string, unknown>, error?: unknown) {
  const entry = {
    level: "ERROR",
    phase,
    ...detail,
    error: error ? String(error) : undefined,
    stack: error instanceof Error ? error.stack?.split("\n").slice(0, 3).join(" | ") : undefined,
    ts: new Date().toISOString(),
  };
  console.error("[Webhook]", JSON.stringify(entry));
}

function logInfo(phase: string, detail: Record<string, unknown>) {
  console.log("[Webhook]", JSON.stringify({ level: "INFO", phase, ...detail, ts: new Date().toISOString() }));
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let phone = "unknown";

  try {
    const body = await req.json();
    const supabase = getSupabase();

    logInfo("received", { payload: JSON.stringify(body).slice(0, 300) });

    const msg = parseWebhookPayload(body);
    if (!msg) return ok({ detail: "ignored" });

    let { type: msgType, content: msgContent } = getMessageContent(msg);
    if (!msgContent && msgType === "unknown") return ok({ detail: "no_content" });

    // === Transcribe audio / describe image BEFORE buffering so downstream sees text ===
    // This lets Whisper/Vision output flow through the normal qualification pipeline.
    if (msgType === "audio" && msg.audio?.audioUrl) {
      logInfo("audio_transcribe_start", { phone: msg.phone.replace(/\D/g, ""), url: msg.audio.audioUrl.slice(0, 80) });
      const transcript = await transcribeAudio(msg.audio.audioUrl);
      if (transcript) {
        msgContent = transcript;
        msgType = "text"; // treat as text from here on
        logInfo("audio_transcribed", { phone: msg.phone.replace(/\D/g, ""), chars: transcript.length, preview: transcript.slice(0, 150) });
      } else {
        logError("audio_transcribe_failed", { phone: msg.phone.replace(/\D/g, "") });
      }
    } else if (msgType === "image" && msg.image?.imageUrl) {
      logInfo("image_describe_start", { phone: msg.phone.replace(/\D/g, ""), url: msg.image.imageUrl.slice(0, 80) });
      const desc = await describeImage(msg.image.imageUrl, msg.image.caption);
      if (desc && desc !== "[irrelevante]") {
        // Combine caption (if any) with vision description — feed as text into the pipeline.
        const caption = msg.image.caption ? `${msg.image.caption}. ` : "";
        msgContent = `${caption}[imagem enviada pelo cliente: ${desc}]`;
        msgType = "text";
        logInfo("image_described", { phone: msg.phone.replace(/\D/g, ""), desc: desc.slice(0, 150) });
      } else {
        logInfo("image_irrelevant_or_failed", { phone: msg.phone.replace(/\D/g, "") });
      }
    }

    phone = msg.phone.replace(/\D/g, "");

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
      // Upsert lead (unique on phone — prevents duplicate leads from race conditions)
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
        .upsert(leadInsert, { onConflict: "phone", ignoreDuplicates: true })
        .select()
        .single();

      if (leadError) {
        // If upsert fails, try to fetch existing lead
        const { data: existingLead } = await supabase
          .from("leads")
          .select("*")
          .eq("phone", phone)
          .maybeSingle();
        if (existingLead) {
          lead = existingLead;
        } else {
          logError("lead_create", { phone }, leadError);
          return ok({ detail: "lead_creation_failed" });
        }
      } else {
        lead = newLead;
      }

      // Check again for conversation (another webhook may have created it)
      const { data: raceConv } = await supabase
        .from("conversations")
        .select("*")
        .eq("phone", phone)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (raceConv) {
        conversation = raceConv;
      } else {
        // Bot gate: decide if bot should activate for this new conversation
        const gate = await evaluateBotGate({ phone, hasReferral: !!msg.referral });
        logInfo("bot_gate", { phone, decision: gate });

        const { data: newConv, error: convError } = await supabase
          .from("conversations")
          .insert({
            lead_id: (lead as Record<string, unknown>).id,
            phone,
            bot_active: gate.shouldActivate,
            source: gate.source,
            current_step: "greeting",
            qualification_data: {},
            bot_messages_count: 0,
            messages_count: 0,
            last_message_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (convError) {
          // Race condition: another call created it, fetch it
          const { data: fallbackConv } = await supabase
            .from("conversations")
            .select("*")
            .eq("phone", phone)
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          conversation = fallbackConv;
        } else {
          conversation = newConv;
        }
      }
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
      logError("resolve", { phone, hasConv: !!conversation, hasLead: !!lead });
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
        logInfo("dedup", { phone, messageId: msg.messageId });
        return ok({ detail: "duplicate" });
      }
    }

    // === STEP 3: Save incoming message immediately ===
    const { error: msgInsertErr } = await supabase.from("messages").insert({
      conversation_id: conversation.id,
      lead_id: lead.id,
      direction: "incoming",
      content: msgContent,
      message_type: msgType,
      is_from_bot: false,
      zapi_message_id: msg.messageId,
      metadata: msg.referral ? { referral: msg.referral } : {},
    });
    if (msgInsertErr) {
      logError("msg_insert", { phone, convId: conversation.id }, msgInsertErr);
    }

    // Update last_message_at
    await supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversation.id);

    // Re-read bot_active (may have been toggled by dashboard or another webhook)
    const { data: botCheck } = await supabase
      .from("conversations")
      .select("bot_active")
      .eq("id", conversation.id)
      .single();

    if (!botCheck?.bot_active) {
      return ok({ detail: "saved_human_mode" });
    }

    // Fallback when transcription/vision failed — still acknowledge so lead doesn't feel ignored
    if (msgType === "audio") {
      try {
        await sendMultipleMessages(phone, [
          "Recebi teu áudio, mas não consegui escutar direito aqui. Consegue me mandar por texto o mais importante? Assim já adianto pra Miriany",
        ]);
        await supabase.from("messages").insert({
          conversation_id: conversation.id,
          lead_id: lead.id,
          direction: "outgoing",
          content: "Recebi teu áudio, mas não consegui escutar direito aqui. Consegue me mandar por texto o mais importante? Assim já adianto pra Miriany",
          message_type: "text",
          is_from_bot: true,
        });
      } catch (e) { logError("audio_fallback_response", { phone }, e); }
      return ok({ detail: "audio_transcription_failed" });
    }

    // Videos and documents — save silently, continue to buffer (will be seen as [Vídeo]/[Documento])
    if (msgType === "video" || msgType === "document") {
      logInfo("media_saved", { phone, type: msgType });
    }

    // === STEP 4: Message buffer ===
    const { data: freshCheck } = await supabase
      .from("conversations")
      .select("context_summary")
      .eq("id", conversation.id)
      .single();

    const now = Date.now();
    const scheduledAt = freshCheck?.context_summary
      ? parseInt(freshCheck.context_summary, 10)
      : 0;

    if (scheduledAt > 0 && now - scheduledAt < BUFFER_MS + 5000) {
      // Another call is already waiting — just save and return
      logInfo("buffered", { phone, scheduledAge: now - scheduledAt });
      return ok({ detail: "buffered" });
    }

    // Mark that we're scheduling processing
    const { error: lockErr } = await supabase
      .from("conversations")
      .update({ context_summary: String(now) })
      .eq("id", conversation.id);
    if (lockErr) {
      logError("buffer_lock", { phone }, lockErr);
    }

    // Wait for buffer period to collect more messages
    logInfo("buffer_wait", { phone, bufferMs: BUFFER_MS });
    await new Promise((r) => setTimeout(r, BUFFER_MS));

    // === STEP 5: Process after buffer ===
    // Re-fetch conversation fresh
    const { data: freshConv } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", conversation.id)
      .single();

    if (!freshConv || !freshConv.bot_active) {
      logInfo("bot_disabled", { phone, hasConv: !!freshConv, botActive: freshConv?.bot_active });
      return ok({ detail: "bot_disabled_during_buffer" });
    }

    // Check if WE are the one who should process
    const currentScheduled = freshConv.context_summary
      ? parseInt(freshConv.context_summary, 10)
      : 0;

    if (currentScheduled !== now) {
      // A newer webhook set a different lock — but ONLY skip if the newer one
      // is actually still pending (hasn't expired). Otherwise, WE should process.
      const newerAge = Date.now() - currentScheduled;
      if (currentScheduled > now && newerAge < BUFFER_MS + 5000) {
        logInfo("superseded", { phone, ourTs: now, currentTs: currentScheduled, newerAge });
        return ok({ detail: "superseded" });
      }
      // The lock is stale or ours was overwritten but the newer one already finished
      // — we should process to avoid dropped messages
      logInfo("stale_lock_recovery", { phone, ourTs: now, currentTs: currentScheduled, newerAge });
    }

    // Clear the lock
    await supabase
      .from("conversations")
      .update({ context_summary: null })
      .eq("id", conversation.id);

    // Get conversation history (includes all buffered messages)
    const { data: history } = await supabase
      .from("messages")
      .select("direction, content, is_from_bot, created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(30);

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
        break;
      }
    }
    const combinedUserMessage = recentUserMsgs.join("\n");

    if (!combinedUserMessage.trim()) {
      logInfo("empty_combined", { phone, historyLen: messagesHistory.length });
      return ok({ detail: "no_user_message" });
    }

    logInfo("processing", {
      phone,
      step: freshConv.current_step,
      combined: combinedUserMessage.slice(0, 200),
      bufferedCount: recentUserMsgs.length,
      qualData: JSON.stringify(freshConv.qualification_data).slice(0, 200),
    });

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

    logInfo("ai_result", {
      phone,
      newStep: result.newStep,
      handoff: result.shouldHandoff,
      responses: result.responses.length,
      updatedData: JSON.stringify(result.updatedData).slice(0, 300),
    });

    // Send responses
    if (result.responses.length > 0) {
      try {
        await sendMultipleMessages(phone, result.responses);
        logInfo("sent", { phone, count: result.responses.length });
      } catch (sendError) {
        logError("send_messages", { phone, responses: result.responses.length }, sendError);
      }

      // Save bot messages
      for (const response of result.responses) {
        const { error: botMsgErr } = await supabase.from("messages").insert({
          conversation_id: conversation.id,
          lead_id: lead.id,
          direction: "outgoing",
          content: response,
          message_type: "text",
          is_from_bot: true,
        });
        if (botMsgErr) {
          logError("bot_msg_insert", { phone, convId: conversation.id }, botMsgErr);
        }
      }
    }

    // Update conversation — THIS IS CRITICAL, must succeed
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

      const { error: leadUpdateErr } = await supabase
        .from("leads")
        .update({
          name: result.updatedData.name || (lead.name as string),
          destination_interest: result.updatedData.destination,
          travel_dates: result.updatedData.travel_dates,
          travelers_count: result.updatedData.travelers_count,
          travelers_type: result.updatedData.travelers_type,
          travel_style: result.updatedData.travel_motive,
          budget_range: result.updatedData.budget_per_person,
          qualification_score: score,
          qualification_status: getQualificationStatus(score),
          qualification_summary: convUpdate.handoff_summary,
        })
        .eq("id", lead.id);

      if (leadUpdateErr) {
        logError("lead_update_handoff", { phone, leadId: lead.id, score }, leadUpdateErr);
      }

      // Notify human agent via WhatsApp
      const status = getQualificationStatus(score);
      await notifyHumanAgent(
        status === "qualified" ? "qualified" : status === "warm" ? "warm" : "handoff",
        result.updatedData.name || "Lead",
        phone,
        convUpdate.handoff_summary as string
      );
    } else if (result.updatedData.name && !(lead.name as string)) {
      await supabase
        .from("leads")
        .update({ name: result.updatedData.name })
        .eq("id", lead.id);
    }

    // Critical update — retry once on failure
    const { error: convUpdateErr } = await supabase
      .from("conversations")
      .update(convUpdate)
      .eq("id", conversation.id);

    if (convUpdateErr) {
      logError("conv_update", {
        phone,
        convId: conversation.id,
        newStep: result.newStep,
        update: JSON.stringify(convUpdate).slice(0, 500),
      }, convUpdateErr);

      // Retry with minimal update (step + data only)
      const { error: retryErr } = await supabase
        .from("conversations")
        .update({
          current_step: result.newStep,
          qualification_data: result.updatedData,
        })
        .eq("id", conversation.id);

      if (retryErr) {
        logError("conv_update_retry", { phone, convId: conversation.id }, retryErr);
      } else {
        logInfo("conv_update_retry_ok", { phone, newStep: result.newStep });
      }
    }

    logInfo("done", {
      phone,
      step: result.newStep,
      handoff: result.shouldHandoff,
      elapsed: Date.now() - startTime,
    });

    return ok({ detail: "processed", buffered_messages: recentUserMsgs.length, step: result.newStep });
  } catch (error) {
    logError("unhandled", { phone, elapsed: Date.now() - startTime }, error);
    return ok({ detail: "error", message: String(error) });
  }
}

export async function GET() {
  return NextResponse.json({ status: "ok", service: "cantos-do-mundo-agent" });
}
