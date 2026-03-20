import { NextRequest, NextResponse } from "next/server";
import { setSession, clearSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { password, action } = await req.json();

  if (action === "logout") {
    await clearSession();
    return NextResponse.json({ success: true });
  }

  const expected = process.env.DASHBOARD_PASSWORD || "cantos2026";
  if (password === expected) {
    await setSession();
    return NextResponse.json({ success: true });
  }

  return NextResponse.json(
    { success: false, error: "Senha incorreta" },
    { status: 401 }
  );
}
