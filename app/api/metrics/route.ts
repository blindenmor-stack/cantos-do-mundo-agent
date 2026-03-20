import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function GET() {
  const supabase = getSupabase();
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Total leads
  const { count: totalLeads } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true });

  // Today's leads
  const { count: todayLeads } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .gte("created_at", today);

  // By status
  const { count: qualified } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("qualification_status", "qualified");

  const { count: warm } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("qualification_status", "warm");

  const { count: disqualified } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("qualification_status", "disqualified");

  const { count: pending } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("qualification_status", "pending");

  // Active conversations (bot active)
  const { count: activeConversations } = await supabase
    .from("conversations")
    .select("*", { count: "exact", head: true })
    .eq("bot_active", true);

  // Leads last 30 days by date
  const { data: recentLeads } = await supabase
    .from("leads")
    .select("created_at, qualification_status")
    .gte("created_at", thirtyDaysAgo)
    .order("created_at", { ascending: true });

  // Group by date
  const dailyData: Record<string, { total: number; qualified: number; warm: number; disqualified: number }> = {};
  for (const lead of recentLeads || []) {
    const date = lead.created_at.split("T")[0];
    if (!dailyData[date]) dailyData[date] = { total: 0, qualified: 0, warm: 0, disqualified: 0 };
    dailyData[date].total++;
    if (lead.qualification_status === "qualified") dailyData[date].qualified++;
    if (lead.qualification_status === "warm") dailyData[date].warm++;
    if (lead.qualification_status === "disqualified") dailyData[date].disqualified++;
  }

  const chartData = Object.entries(dailyData).map(([date, counts]) => ({
    date,
    ...counts,
  }));

  // Leads by ad_id
  const { data: adLeads } = await supabase
    .from("leads")
    .select("ad_id, qualification_status")
    .not("ad_id", "is", null);

  const adData: Record<string, { total: number; qualified: number }> = {};
  for (const lead of adLeads || []) {
    const adId = lead.ad_id || "unknown";
    if (!adData[adId]) adData[adId] = { total: 0, qualified: 0 };
    adData[adId].total++;
    if (lead.qualification_status === "qualified") adData[adId].qualified++;
  }

  // Conversion rate
  const totalProcessed = (qualified || 0) + (warm || 0) + (disqualified || 0);
  const conversionRate = totalProcessed > 0 ? ((qualified || 0) / totalProcessed) * 100 : 0;

  return NextResponse.json({
    totalLeads: totalLeads || 0,
    todayLeads: todayLeads || 0,
    qualified: qualified || 0,
    warm: warm || 0,
    disqualified: disqualified || 0,
    pending: pending || 0,
    activeConversations: activeConversations || 0,
    conversionRate: Math.round(conversionRate * 10) / 10,
    chartData,
    adData: Object.entries(adData).map(([adId, counts]) => ({ adId, ...counts })),
  });
}
