import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function GET() {
  const supabase = getSupabase();

  const { data: agentConfig } = await supabase
    .from("agent_config")
    .select("key, value, description");

  const { data: zapiConfig } = await supabase
    .from("zapi_config")
    .select("*")
    .limit(1)
    .single();

  return NextResponse.json({
    agentConfig: agentConfig || [],
    zapiConfig: zapiConfig || null,
  });
}

export async function POST(req: NextRequest) {
  const { type, data } = await req.json();
  const supabase = getSupabase();

  if (type === "zapi") {
    const { data: existing } = await supabase
      .from("zapi_config")
      .select("id")
      .limit(1)
      .single();

    if (existing) {
      await supabase.from("zapi_config").update(data).eq("id", existing.id);
    } else {
      await supabase.from("zapi_config").insert(data);
    }
    return NextResponse.json({ success: true });
  }

  if (type === "agent") {
    for (const [key, value] of Object.entries(data)) {
      await supabase
        .from("agent_config")
        .update({ value: String(value) })
        .eq("key", key);
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid type" }, { status: 400 });
}
