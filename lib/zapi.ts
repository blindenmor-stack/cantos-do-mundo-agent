const ZAPI_BASE = "https://api.z-api.io/instances";

function getConfig() {
  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const token = process.env.ZAPI_TOKEN;
  const clientToken = process.env.ZAPI_CLIENT_TOKEN;
  return { instanceId, token, clientToken };
}

function getBaseUrl() {
  const { instanceId, token } = getConfig();
  if (!instanceId || !token) throw new Error("Z-API credentials not configured");
  return `${ZAPI_BASE}/${instanceId}/token/${token}`;
}

export async function sendText(phone: string, message: string) {
  const url = `${getBaseUrl()}/send-text`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Client-Token": getConfig().clientToken || "" },
    body: JSON.stringify({ phone, message }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("[Z-API] send-text error:", err);
    throw new Error(`Z-API send-text failed: ${res.status}`);
  }
  return res.json();
}

export async function sendTyping(phone: string) {
  const url = `${getBaseUrl()}/action/typing`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Client-Token": getConfig().clientToken || "" },
      body: JSON.stringify({ phone, duration: 3000 }),
    });
  } catch {
    // typing is best-effort, don't fail on errors
  }
}

export async function sendMultipleMessages(phone: string, messages: string[]) {
  for (let i = 0; i < messages.length; i++) {
    // Show typing indicator before each message
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
  // Z-API sends different event types
  // We only care about ReceivedCallback (incoming messages)
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
