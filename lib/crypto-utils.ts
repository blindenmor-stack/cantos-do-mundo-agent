// Edge-compatible crypto utilities using Web Crypto API.
// Works in both Node.js runtime and Vercel Edge Runtime.

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
  lengthBytes: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    lengthBytes * 8
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, 100000, 32);
  return `${bytesToHex(salt)}:${bytesToHex(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  try {
    const salt = hexToBytes(saltHex);
    const expected = hexToBytes(hashHex);
    const computed = await pbkdf2(password, salt, 100000, expected.length);
    return timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );
  return bytesToHex(new Uint8Array(sig));
}

export interface SessionPayload {
  email: string;
  exp: number; // unix seconds
}

function b64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): string {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}

export async function signSession(
  email: string,
  secret: string,
  days = 30
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const payload = b64urlEncode(JSON.stringify({ email, exp }));
  const sig = await hmacSign(payload, secret);
  return `${payload}.${sig}`;
}

export async function verifySession(
  token: string,
  secret: string
): Promise<SessionPayload | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expectedSig = await hmacSign(payload, secret);
  // Compare in constant time via byte comparison
  if (
    !timingSafeEqual(
      new TextEncoder().encode(sig),
      new TextEncoder().encode(expectedSig)
    )
  ) {
    return null;
  }
  try {
    const data = JSON.parse(b64urlDecode(payload)) as SessionPayload;
    if (!data.email || !data.exp) return null;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}
