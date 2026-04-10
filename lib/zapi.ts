import { getSupabase } from "./supabase";

const ZAPI_BASE = "https://api.z-api.io/instances";

interface ZApiCreds {
  instanceId: string;
  token: string;
  clientToken?: string;
}

// In-memory cache to avoid hitting Supabase every send
let cachedCreds: ZApiCreds | null = null;
let cachedAt = 0;
const CACHE_TTL = 60 * 1000; // 1 min

async function loadCreds(): Promise<ZApiCreds> {
  // Env vars take precedence (fast path)
  const envId = process.env.ZAPI_INSTANCE_ID;
  const envTk = process.env.ZAPI_TOKEN;
  const envCt = process.env.ZAPI_CLIENT_TOKEN;
  if (envId && envTk) {
    return { instanceId: envId, token: envTk, clientToken: envCt };
  }

  // Supabase fallback (cached)
  if (cachedCreds && Date.now() - cachedAt < CACHE_TTL) {
    return cachedCreds;
  }

  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("zapi_config")
      .select("instance_id, token, client_token")
      .limit(1)
      .maybeSingle();

    if (data?.instance_id && data?.token) {
      cachedCreds = {
        instanceId: data.instance_id,
        token: data.token,
        clientToken: data.client_token || undefined,
      };
      cachedAt = Date.now();
      return cachedCreds;
    }
  } catch (err) {
    console.error("[Z-API] Failed to load creds from Supabase:", err);
  }

  throw new Error("Z-API credentials not configured (env vars or zapi_config table)");
}

async function getBaseUrl(): Promise<string> {
  const c = await loadCreds();
  return `${ZAPI_BASE}/${c.instanceId}/token/${c.token}`;
}

async function buildHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const c = await loadCreds();
  if (c.clientToken) headers["Client-Token"] = c.clientToken;
  return headers;
}

// Determines correct send endpoint based on target type
function isGroup(target: string): boolean {
  return target.endsWith("-group") || target.includes("@g.us");
}

// Normalize group ID for Z-API (strip -group suffix if present)
function normalizeTarget(target: string): string {
  if (target.endsWith("-group")) return target.slice(0, -"-group".length);
  if (target.endsWith("@g.us")) return target.slice(0, -"@g.us".length);
  return target;
}

export async function sendText(target: string, message: string) {
  const base = await getBaseUrl();
  const headers = await buildHeaders();

  // Both phone and group use /send-text in Z-API; groups need groupId or groupMessage
  // Z-API infers type from phone value — send to /send-text for both
  const url = `${base}/send-text`;
  const body: Record<string, unknown> = {
    phone: normalizeTarget(target),
    message,
  };

  // Z-API needs isGroup flag for some instances; include when target is a group
  if (isGroup(target)) {
    body.phone = normalizeTarget(target);
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[Z-API] send-text error:", res.status, err, "target:", target);
    throw new Error(`Z-API send-text failed: ${res.status}`);
  }
  return res.json();
}

export async function sendTyping(phone: string) {
  // Skip typing indicator for groups
  if (isGroup(phone)) return;
  const base = await getBaseUrl();
  const headers = await buildHeaders();
  const url = `${base}/send-chat-state`;
  try {
    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone: normalizeTarget(phone), state: "composing" }),
    });
  } catch {
    // typing is best-effort, don't fail on errors
  }
}

export async function sendMultipleMessages(phone: string, messages: string[]) {
  for (let i = 0; i < messages.length; i++) {
    await sendTyping(phone);

    // Human-like delay: 1-3 seconds between messages
    const delay = 1000 + Math.random() * 2000 + messages[i].length * 30;
    await new Promise((r) => setTimeout(r, Math.min(delay, 4000)));

    await sendText(phone, messages[i]);
  }
}

// Parse Z-API webhook payload
export interface ZApiMessage {
  phone: string;
  isGroup: boolean;
  messageId: string;
  fromMe: boolean;
  momment: number;
  participantPhone?: string;
  text?: { message: string };
  image?: { imageUrl: string; caption?: string };
  audio?: { audioUrl: string };
  video?: { videoUrl: string; caption?: string };
  document?: { documentUrl: string; fileName?: string };
  referral?: {
    sourceUrl?: string;
    headline?: string;
    body?: string;
    ctwaClid?: string;
    sourceId?: string;
    sourceType?: string;
  };
  senderName?: string;
  photo?: string;
  broadcast?: boolean;
  instanceId?: string;
}

export function parseWebhookPayload(body: Record<string, unknown>): ZApiMessage | null {
  // We only care about incoming non-group messages
  if (!body.phone || body.fromMe) return null;
  if (body.isGroup) return null;

  const msg: ZApiMessage = {
    phone: body.phone as string,
    isGroup: (body.isGroup as boolean) || false,
    messageId: (body.messageId as string) || "",
    fromMe: false,
    momment: (body.momment as number) || Date.now(),
    senderName: (body.senderName as string) || (body.chatName as string) || undefined,
    text: body.text as ZApiMessage["text"],
    image: body.image as ZApiMessage["image"],
    audio: body.audio as ZApiMessage["audio"],
    video: body.video as ZApiMessage["video"],
    document: body.document as ZApiMessage["document"],
    referral: body.referral as ZApiMessage["referral"],
  };

  return msg;
}

export function getMessageContent(msg: ZApiMessage): { type: string; content: string } {
  if (msg.text?.message) return { type: "text", content: msg.text.message };
  if (msg.image) return { type: "image", content: msg.image.caption || "[Imagem]" };
  if (msg.audio) return { type: "audio", content: "[Áudio]" };
  if (msg.video) return { type: "video", content: msg.video.caption || "[Vídeo]" };
  if (msg.document) return { type: "document", content: msg.document.fileName || "[Documento]" };
  return { type: "unknown", content: "" };
}
