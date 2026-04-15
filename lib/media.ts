// Media processing: audio transcription (Whisper) and image analysis (GPT-4o).
// Uses the OpenAI REST API directly to keep things simple and streaming-free.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
const WHISPER_MODEL = process.env.OPENAI_WHISPER_MODEL || "whisper-1";

function assertKey(): string {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");
  return OPENAI_API_KEY;
}

async function downloadToBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download media: ${res.status} ${res.statusText}`);
  }
  return await res.blob();
}

/**
 * Transcribe a WhatsApp audio (.ogg/.opus/.mp3) using OpenAI Whisper.
 * Returns the transcribed text or null if transcription failed.
 */
export async function transcribeAudio(audioUrl: string): Promise<string | null> {
  try {
    assertKey();
    const blob = await downloadToBlob(audioUrl);

    // Whisper expects multipart/form-data
    const form = new FormData();
    // WhatsApp audio is usually ogg/opus — Whisper auto-detects format by filename extension
    const ext = audioUrl.toLowerCase().includes(".mp3")
      ? "mp3"
      : audioUrl.toLowerCase().includes(".m4a")
      ? "m4a"
      : "ogg";
    form.append("file", blob, `audio.${ext}`);
    form.append("model", WHISPER_MODEL);
    form.append("language", "pt"); // Brazilian Portuguese
    form.append("response_format", "text");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[Media] Whisper error:", res.status, err.slice(0, 300));
      return null;
    }

    const text = (await res.text()).trim();
    console.log(`[Media] Audio transcribed (${text.length} chars):`, text.slice(0, 200));
    return text || null;
  } catch (err) {
    console.error("[Media] transcribeAudio failed:", err);
    return null;
  }
}

/**
 * Describe an image using GPT-4o vision.
 * Returns a short description in Portuguese or null on failure.
 */
export async function describeImage(
  imageUrl: string,
  caption?: string
): Promise<string | null> {
  try {
    assertKey();

    // GPT-4o can consume image URLs directly. For Z-API URLs that may be ephemeral,
    // this works because OpenAI fetches the URL synchronously during the request.
    const systemPrompt = `Você é uma assistente de agência de viagens. Um cliente enviou uma imagem no WhatsApp. Descreva em 1-2 frases CURTAS o que tem na imagem, focando em: destino/lugar se reconhecível, tipo de viagem sugerida (praia, montanha, cultural, etc), ou se é um print de pesquisa/roteiro/passaporte/documento. Se for algo irrelevante (foto pessoal, selfie, meme), responda apenas "[irrelevante]". Português brasileiro.`;

    const userContent: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: caption
          ? `Legenda que o cliente enviou junto: "${caption}". Descreva a imagem.`
          : "Descreva a imagem.",
      },
      { type: "image_url", image_url: { url: imageUrl } },
    ];

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        max_tokens: 150,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[Media] Vision error:", res.status, err.slice(0, 300));
      return null;
    }

    const data = await res.json();
    const desc = data?.choices?.[0]?.message?.content?.trim();
    if (!desc) return null;
    console.log(`[Media] Image described:`, desc.slice(0, 200));
    return desc;
  } catch (err) {
    console.error("[Media] describeImage failed:", err);
    return null;
  }
}
