import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { notifyDailyReport } from "@/lib/notify";

export const maxDuration = 60;

// Vercel Cron calls this route with an Authorization header
// Schedule configured in vercel.json: "0 11 * * *" (08:00 BRT = 11:00 UTC)
export async function GET(req: NextRequest) {
  // Security: CRON_SECRET must be configured. Vercel Cron auto-injects the Bearer header.
  const authHeader = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[DailyReport] CRON_SECRET not configured — refusing to run");
    return NextResponse.json(
      { error: "server_misconfigured" },
      { status: 500 }
    );
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabase();

    // Get "yesterday" in BRT — covers full day 00:00 → 23:59:59 BRT
    const now = new Date();
    const brtOffset = -3 * 60; // BRT = UTC-3
    const brtNow = new Date(now.getTime() + brtOffset * 60 * 1000);
    const yesterday = new Date(brtNow);
    yesterday.setUTCDate(brtNow.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(yesterday);
    yesterdayEnd.setUTCHours(23, 59, 59, 999);

    // Convert window back to UTC for DB query
    const fromUtc = new Date(yesterday.getTime() - brtOffset * 60 * 1000);
    const toUtc = new Date(yesterdayEnd.getTime() - brtOffset * 60 * 1000);

    const dayLabel = yesterday.toISOString().split("T")[0];

    // Fetch yesterday's leads
    const { data: leads, error: leadsErr } = await supabase
      .from("leads")
      .select("id, name, phone, qualification_status, qualification_score, ad_id, ctwa_clid, destination_interest, created_at")
      .gte("created_at", fromUtc.toISOString())
      .lte("created_at", toUtc.toISOString())
      .order("created_at", { ascending: false });

    if (leadsErr) {
      console.error("[DailyReport] Failed to fetch leads:", leadsErr);
      return NextResponse.json({ error: "query_failed", detail: leadsErr.message }, { status: 500 });
    }

    const total = leads?.length || 0;
    const qualified = leads?.filter((l) => l.qualification_status === "qualified").length || 0;
    const warm = leads?.filter((l) => l.qualification_status === "warm").length || 0;
    const disqualified = leads?.filter((l) => l.qualification_status === "disqualified").length || 0;
    const pending = leads?.filter((l) => l.qualification_status === "pending").length || 0;
    const fromAds = leads?.filter((l) => l.ad_id || l.ctwa_clid).length || 0;
    const organic = total - fromAds;

    // Handoffs on yesterday
    const { data: handoffs } = await supabase
      .from("conversations")
      .select("id, phone, handoff_summary, lead_id")
      .gte("handoff_at", fromUtc.toISOString())
      .lte("handoff_at", toUtc.toISOString());

    const handoffCount = handoffs?.length || 0;

    // Build report message
    const lines: string[] = [];
    lines.push(`📅 *${formatBrDate(yesterday)}*`);
    lines.push("");
    lines.push(`👥 *Leads recebidos:* ${total}`);
    if (total > 0) {
      lines.push(`  • Via anúncios Meta: ${fromAds}`);
      lines.push(`  • Orgânicos: ${organic}`);
    }
    lines.push("");
    lines.push(`🎯 *Qualificação*`);
    lines.push(`  🔥 Qualificados: ${qualified}`);
    lines.push(`  🟡 Mornos: ${warm}`);
    lines.push(`  ❌ Desqualificados: ${disqualified}`);
    lines.push(`  ⏳ Pendentes: ${pending}`);
    lines.push("");
    lines.push(`📣 *Handoffs realizados:* ${handoffCount}`);

    if (total > 0) {
      const processed = qualified + warm + disqualified;
      const rate = processed > 0 ? Math.round((qualified / processed) * 100) : 0;
      lines.push("");
      lines.push(`📊 *Taxa de qualificação:* ${rate}% (${qualified}/${processed} processados)`);
    }

    // List top qualified
    const topQualified = leads?.filter((l) => l.qualification_status === "qualified").slice(0, 5) || [];
    if (topQualified.length > 0) {
      lines.push("");
      lines.push(`🏆 *Qualificados de ontem:*`);
      for (const l of topQualified) {
        lines.push(`  • ${l.name || "—"} (score ${l.qualification_score}) — ${l.destination_interest || "destino não informado"}`);
      }
    }

    if (total === 0) {
      lines.push("");
      lines.push("_Nenhum lead recebido ontem._");
    }

    const summary = lines.join("\n");

    // Send to all active daily report targets
    await notifyDailyReport(summary);

    // Persist snapshot to daily_metrics for historical tracking
    try {
      await supabase.from("daily_metrics").upsert(
        {
          date: dayLabel,
          total_leads: total,
          qualified,
          warm,
          disqualified,
          pending,
          from_ads: fromAds,
          organic,
          handoffs: handoffCount,
        },
        { onConflict: "date" }
      );
    } catch (err) {
      console.error("[DailyReport] Failed to persist daily_metrics:", err);
    }

    return NextResponse.json({
      ok: true,
      day: dayLabel,
      stats: { total, qualified, warm, disqualified, pending, fromAds, handoffCount },
    });
  } catch (err) {
    console.error("[DailyReport] Unhandled:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function formatBrDate(d: Date): string {
  const days = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${days[d.getUTCDay()]}, ${d.getUTCDate()} de ${months[d.getUTCMonth()]}`;
}
