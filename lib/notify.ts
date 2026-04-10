import { sendText } from "./zapi";
import { getSupabase } from "./supabase";

export type NotifyType = "qualified" | "warm" | "needs_attention" | "handoff" | "daily_report";

interface NotifyTarget {
  id: string;
  target: string;
  type: "phone" | "group";
  label: string;
  notify_qualified: boolean;
  notify_warm: boolean;
  notify_daily_report: boolean;
  active: boolean;
}

// Fetch all active targets that should receive a given notification type
async function getActiveTargets(type: NotifyType): Promise<NotifyTarget[]> {
  try {
    const supabase = getSupabase();
    let query = supabase.from("notify_targets").select("*").eq("active", true);

    if (type === "qualified") query = query.eq("notify_qualified", true);
    else if (type === "warm") query = query.eq("notify_warm", true);
    else if (type === "daily_report") query = query.eq("notify_daily_report", true);
    // handoff and needs_attention: broadcast to anyone with notify_qualified on

    const { data, error } = await query;
    if (error) {
      console.error("[Notify] Failed to fetch targets:", error);
      return [];
    }
    return (data as NotifyTarget[]) || [];
  } catch (err) {
    console.error("[Notify] getActiveTargets error:", err);
    return [];
  }
}

// Fallback: legacy single-number config from agent_config.notify_phone or env
async function getLegacyFallbackPhone(): Promise<string | null> {
  if (process.env.NOTIFY_PHONE) return process.env.NOTIFY_PHONE;
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("agent_config")
      .select("value")
      .eq("key", "notify_phone")
      .maybeSingle();
    return data?.value || null;
  } catch {
    return null;
  }
}

function labelFor(type: NotifyType): string {
  const labels: Record<NotifyType, string> = {
    qualified: "🔥 LEAD QUALIFICADO",
    warm: "🟡 LEAD MORNO",
    needs_attention: "⚠️ PRECISA ATENÇÃO",
    handoff: "📣 HANDOFF REALIZADO",
    daily_report: "📊 RELATÓRIO DIÁRIO",
  };
  return labels[type] || type.toUpperCase();
}

export async function notifyHumanAgent(
  type: Exclude<NotifyType, "daily_report">,
  leadName: string,
  leadPhone: string,
  summary: string
) {
  const message = `${labelFor(type)}

${summary}

Telefone: ${formatPhone(leadPhone)}
Dashboard: https://cantos-do-mundo-agent.vercel.app/conversations`;

  await broadcast(type, message);
}

export async function notifyDailyReport(summaryText: string) {
  const message = `${labelFor("daily_report")}

${summaryText}

Dashboard: https://cantos-do-mundo-agent.vercel.app/dashboard`;

  await broadcast("daily_report", message);
}

// Core: send a pre-formatted message to all active targets for a given type
async function broadcast(type: NotifyType, message: string) {
  const targets = await getActiveTargets(type);

  // If no targets configured, try legacy fallback
  if (targets.length === 0) {
    const legacy = await getLegacyFallbackPhone();
    if (legacy) {
      try {
        await sendText(legacy, message);
        console.log(`[Notify] Sent ${type} via legacy fallback to ${legacy}`);
      } catch (err) {
        console.error(`[Notify] Legacy send failed:`, err);
      }
    } else {
      console.log(`[Notify] No targets configured for ${type}, skipping`);
    }
    return;
  }

  // Send to each target in parallel
  const results = await Promise.allSettled(
    targets.map(async (t) => {
      try {
        await sendText(t.target, message);
        return { ok: true, label: t.label };
      } catch (err) {
        throw new Error(`${t.label}: ${err}`);
      }
    })
  );

  const ok = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  console.log(`[Notify] ${type}: ${ok} ok, ${failed} failed (of ${targets.length})`);

  if (failed > 0) {
    for (const r of results) {
      if (r.status === "rejected") console.error("[Notify] fail:", r.reason);
    }
  }
}

function formatPhone(phone: string): string {
  // Don't format group IDs
  if (phone.endsWith("-group") || phone.includes("@g.us")) return phone;
  if (phone.length === 13) {
    return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 9)}-${phone.slice(9)}`;
  }
  return phone;
}
