import { cookies } from "next/headers";
import { verifySession, signSession, type SessionPayload } from "./crypto-utils";

export const SESSION_COOKIE = "cdm_session";
const DEFAULT_DAYS = 30;

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "SESSION_SECRET env var missing or too short (>=32 chars required)"
    );
  }
  return s;
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await verifySession(token, getSecret());
  } catch {
    return null;
  }
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getSession()) !== null;
}

export async function setSessionCookie(email: string): Promise<void> {
  const token = await signSession(email, getSecret(), DEFAULT_DAYS);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * DEFAULT_DAYS,
    path: "/",
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
