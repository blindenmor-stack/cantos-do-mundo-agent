import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie, clearSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/crypto-utils";
import { findUserByEmail } from "@/lib/users";

export const runtime = "nodejs";

// Dummy hash used to equalize response time when the email is not found.
// Prevents email enumeration via timing analysis.
const DUMMY_HASH =
  "00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000";

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { email, password, action } = body;

  if (action === "logout") {
    await clearSession();
    return NextResponse.json({ success: true });
  }

  if (!email || !password) {
    return NextResponse.json(
      { success: false, error: "Credenciais obrigatórias" },
      { status: 400 }
    );
  }

  const user = findUserByEmail(email);

  if (!user) {
    // Run the verification anyway to keep timing constant
    await verifyPassword(password, DUMMY_HASH);
    return NextResponse.json(
      { success: false, error: "Credenciais inválidas" },
      { status: 401 }
    );
  }

  const ok = await verifyPassword(password, user.hash);
  if (!ok) {
    return NextResponse.json(
      { success: false, error: "Credenciais inválidas" },
      { status: 401 }
    );
  }

  try {
    await setSessionCookie(user.email);
  } catch (err) {
    console.error("[auth] setSessionCookie failed:", err);
    return NextResponse.json(
      { success: false, error: "server_misconfigured" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    user: { email: user.email, name: user.name },
  });
}
