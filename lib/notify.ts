import { sendText } from "./zapi";
import { getSupabase } from "./supabase";

// Get notification number from agent_config or env
async function getNotifyPhone(): Promise<string | null> {
  // First check env var
  if (process.env.NOTIFY_PHONE) return process.env.NOTIFY_PHONE;

  // Then check agent_config table
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

export async function notifyHumanAgent(
  type: "qualified" | "warm" | "needs_attention" | "handoff",
  leadName: string,
  leadPhone: string,
  summary: string
) {
  const phone = await getNotifyPhone();
  if (!phone) {
    console.log("[Notify] No notification phone configured, skipping");
    return;
  }

  const labels: Record<string, string> = {
    qualified: "LEAD QUALIFICADO",
    warm: "LEAD MORNO",
    needs_attention: "PRECISA ATENÇÃO",
    handoff: "HANDOFF REALIZADO",
  };

  const message = `🔔 ${labels[type] || type.toUpperCase()}

${summary}

Telefone: ${formatPhone(leadPhone)}
Dashboard: https://cantos-do-mundo-agent.vercel.app/conversations`;

  try {
    await sendText(phone, message);
    console.log("[Notify] Sent notification to", phone);
  } catch (err) {
    console.error("[Notify] Failed to send notification:", err);
  }
}

function formatPhone(phone: string): string {
  if (phone.length === 13) {
    return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 9)}-${phone.slice(9)}`;
  }
  return phone;
}
