import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const supabase = getSupabase();
  const url = new URL(req.url);
  const botActive = url.searchParams.get("bot_active");

  let query = supabase
    .from("conversations")
    .select("*, leads(name, phone, qualification_status, qualification_score)")
    .order("last_message_at", { ascending: false })
    .limit(100);

  if (botActive === "true") query = query.eq("bot_active", true);
  if (botActive === "false") query = query.eq("bot_active", false);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversations: data });
}
