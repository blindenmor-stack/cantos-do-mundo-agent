import { getSupabase } from "./supabase";

export interface GateDecision {
  shouldActivate: boolean;
  reason: string;
  source: "meta_ad" | "organic" | "excluded" | "quiet_hours" | "test";
}

interface GateContext {
  phone: string;
  hasReferral: boolean;
}

// Central decision: should the bot qualify this incoming message?
// Called on lead/conversation creation (new phone)
export async function evaluateBotGate(ctx: GateContext): Promise<GateDecision> {
  const supabase = getSupabase();

  // 1. Whitelist/excluded phones check — highest priority
  const { data: excluded } = await supabase
    .from("excluded_phones")
    .select("label, reason")
    .eq("phone", ctx.phone)
    .maybeSingle();

  if (excluded) {
    return {
      shouldActivate: false,
      reason: `excluded: ${excluded.label || excluded.reason || "on whitelist"}`,
      source: "excluded",
    };
  }

  // 2. Fetch relevant config keys in one query
  const { data: configs } = await supabase
    .from("agent_config")
    .select("key, value")
    .in("key", ["bot_mode", "quiet_hours_enabled", "quiet_hours_start", "quiet_hours_end"]);

  const config: Record<string, string> = {};
  for (const row of configs || []) config[row.key] = row.value;

  const mode = config.bot_mode || "all";
  const quietEnabled = config.quiet_hours_enabled === "true";

  // 3. Quiet hours check
  if (quietEnabled && isInQuietHours(config.quiet_hours_start, config.quiet_hours_end)) {
    return {
      shouldActivate: false,
      reason: `quiet hours (${config.quiet_hours_start}–${config.quiet_hours_end} BRT)`,
      source: "quiet_hours",
    };
  }

  // 4. Ad-only mode: require referral
  if (mode === "ad_only") {
    if (ctx.hasReferral) {
      return { shouldActivate: true, reason: "meta ad referral detected", source: "meta_ad" };
    }
    return {
      shouldActivate: false,
      reason: "ad_only mode: no referral in message",
      source: "organic",
    };
  }

  // 5. All mode: activate regardless
  return {
    shouldActivate: true,
    reason: `mode=all | ${ctx.hasReferral ? "ad referral" : "organic"}`,
    source: ctx.hasReferral ? "meta_ad" : "organic",
  };
}

// Check if current time in São Paulo is inside the quiet window
function isInQuietHours(start?: string, end?: string): boolean {
  if (!start || !end) return false;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (isNaN(sh) || isNaN(eh)) return false;

  // Current BRT (UTC-3)
  const now = new Date();
  const brtMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() - 180 + 1440) % 1440;
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if (startMin <= endMin) {
    // same day window (ex: 08:00–18:00)
    return brtMinutes >= startMin && brtMinutes < endMin;
  } else {
    // overnight window (ex: 22:00–08:00)
    return brtMinutes >= startMin || brtMinutes < endMin;
  }
}

// Utility: log gate decisions for audit
export async function logGateDecision(
  conversationId: string | null,
  phone: string,
  decision: GateDecision
) {
  try {
    const supabase = getSupabase();
    await supabase.from("conversation_events").insert({
      conversation_id: conversationId,
      event_type: "bot_gate",
      from_value: null,
      to_value: decision.shouldActivate ? "activated" : "skipped",
      metadata: { phone, reason: decision.reason, source: decision.source },
    });
  } catch (err) {
    console.error("[BotGate] Failed to log decision:", err);
  }
}
