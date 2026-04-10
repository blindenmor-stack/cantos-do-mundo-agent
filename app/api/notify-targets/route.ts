import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function GET() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("notify_targets")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ targets: data || [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { target, type, label, notify_qualified, notify_warm, notify_daily_report } = body;

  if (!target || !type || !label) {
    return NextResponse.json({ error: "target, type and label are required" }, { status: 400 });
  }
  if (type !== "phone" && type !== "group") {
    return NextResponse.json({ error: "type must be 'phone' or 'group'" }, { status: 400 });
  }

  // For phone: normalize to digits only
  // For group: keep as-is (e.g. "120363407808868215-group")
  const normalized = type === "phone" ? target.replace(/\D/g, "") : target;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("notify_targets")
    .insert({
      target: normalized,
      type,
      label,
      notify_qualified: notify_qualified ?? true,
      notify_warm: notify_warm ?? false,
      notify_daily_report: notify_daily_report ?? true,
      active: true,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "target already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ target: data });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("notify_targets")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ target: data });
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = getSupabase();
  const { error } = await supabase.from("notify_targets").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
