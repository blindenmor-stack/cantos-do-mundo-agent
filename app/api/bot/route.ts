import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const { conversationId, active } = await req.json();
  const supabase = getSupabase();

  const { error } = await supabase
    .from("conversations")
    .update({ bot_active: active })
    .eq("id", conversationId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
