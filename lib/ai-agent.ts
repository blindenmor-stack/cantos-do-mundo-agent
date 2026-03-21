import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

// Qualification scoring
interface QualificationData {
  name?: string;
  destination?: string;
  travel_dates?: string;
  travelers_count?: number;
  travelers_type?: string;
  has_passport?: boolean;
  travel_motive?: string;
  first_time?: boolean;
  budget_mentioned?: string;
  only_wants_price?: boolean;
  extra_notes?: string;
}

export function calculateScore(data: QualificationData): number {
  let score = 0;

  if (data.destination && data.destination !== "indefinido") score += 20;
  else if (data.destination === "indefinido") score += 10;

  if (data.travel_dates) {
    const months = parseDateToMonths(data.travel_dates);
    if (months !== null && months <= 6) score += 25;
    else if (months !== null && months <= 12) score += 15;
    else score += 5;
  }

  if (data.travelers_count && data.travelers_count >= 2) score += 15;
  else if (data.travelers_count === 1) score += 10;

  if (data.first_time === false) score += 10; // already traveled = experienced
  if (data.travel_motive) score += 15;
  if (data.has_passport) score += 10;
  if (data.only_wants_price) score -= 20;
  if (data.budget_mentioned === "baixo") score -= 30;

  return score;
}

function parseDateToMonths(dateStr: string): number | null {
  const lower = dateStr.toLowerCase();
  const monthMap: Record<string, number> = {
    janeiro: 1, fevereiro: 2, março: 3, marco: 3, abril: 4,
    maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9,
    outubro: 10, novembro: 11, dezembro: 12,
  };

  for (const [name, num] of Object.entries(monthMap)) {
    if (lower.includes(name)) {
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      let diff = num - currentMonth;
      if (diff <= 0) diff += 12;
      return diff;
    }
  }

  if (lower.includes("2027")) return 12;
  if (lower.includes("próximo") || lower.includes("proximo") || lower.includes("logo")) return 3;
  if (lower.includes("este ano") || lower.includes("esse ano")) return 6;
  if (lower.includes("ano que vem") || lower.includes("próximo ano")) return 12;

  return null;
}

export function getQualificationStatus(score: number): "qualified" | "warm" | "disqualified" {
  if (score >= 60) return "qualified";
  if (score >= 30) return "warm";
  return "disqualified";
}

const SYSTEM_PROMPT = `Você é a Miry, consultora da Cantos do Mundo, agência de viagens que cria roteiros personalizados.

COMO VOCÊ FALA (copie este estilo EXATAMENTE):
- Consultora de viagens real brasileira no WhatsApp
- Linguagem natural, leve, coloquial — "Oii", "Como vai?", "Me conta", "Ah que legal"
- Emojis: MÁXIMO 1 emoji ☺️ na saudação inicial. Depois ZERO emojis. NENHUM.
- NÃO use: 😊😍🌍✈️✨🌊❤️🎉😅 — parece robô
- Mensagens naturais — pode ter 2-3 linhas quando faz sentido
- Use ||| APENAS quando mandaria mensagens separadas no WhatsApp. Máximo 2 por resposta.

EXEMPLOS REAIS (copie este tom):
- "Oii! Como vai? ☺️ Sou a Miry, consultora aqui da Cantos do Mundo"
- "Vi que demonstrou interesse no nosso roteiro para [Destino], seria sua primeira vez?"
- "Ah que legal, vai ser uma experiência maravilhosa"
- "Perfeito, e seria para quantas pessoas?"
- "Vocês já possuem passaporte?"

O QUE NÃO FAZER:
- NÃO fale "planejar uma viagem incrível" ou "experiência inesquecível"
- NÃO use emojis (exceto ☺️ na saudação)
- NÃO pergunte algo que o lead JÁ RESPONDEU — verifique os DADOS COLETADOS
- NÃO invente preços
- Se o lead já mencionou algo (ex: lua de mel), apenas CONFIRME: "Só pra confirmar, a viagem é pra comemorar a lua de mel, certo?"

REGRAS:
- UMA pergunta por vez
- Se o lead já respondeu algo em mensagens anteriores, NÃO pergunte de novo. CONFIRME e avance.
- Se preço: "Os valores dependem do roteiro e das datas, vou montar uma proposta certinha pra vocês"
- Se áudio: "Opa, recebi! Por aqui consigo responder só por texto, me conta aqui que te ajudo"

FORMATO DE RESPOSTA (OBRIGATÓRIO):
Responda SEMPRE neste formato exato:

RESPONSE: [suas mensagens separadas por ||| se necessário]
DATA: {"campo": "valor"} ← JSON com dados novos extraídos da mensagem do lead

Campos possíveis no DATA: name, destination, travel_dates, travelers_count, travelers_type (solo/couple/family/friends), has_passport (boolean), travel_motive (string), first_time (boolean), extra_notes (string), only_wants_price (boolean)

Se não tem dados novos pra extrair: DATA: {}
Extraia dados de TODA a conversa, não só da última mensagem.`;

export interface ConversationContext {
  conversationId: string;
  leadId: string;
  currentStep: string;
  qualificationData: QualificationData;
  messagesHistory: { role: "user" | "assistant"; content: string }[];
  botMessagesCount: number;
}

export async function processMessage(
  userMessage: string,
  context: ConversationContext
): Promise<{
  responses: string[];
  newStep: string;
  updatedData: QualificationData;
  shouldHandoff: boolean;
  handoffReason?: string;
}> {
  const maxBotMessages = 15;

  if (context.botMessagesCount >= maxBotMessages) {
    return {
      responses: [
        `${context.qualificationData.name || ""}, foi ótimo conversar contigo! Vou passar tudo pro nosso time de especialistas e logo entram em contato`,
      ],
      newStep: "handoff",
      updatedData: context.qualificationData,
      shouldHandoff: true,
      handoffReason: "max_messages_reached",
    };
  }

  const stepInstruction = getStepInstruction(context.currentStep, context.qualificationData);

  // Build message history
  let messages: { role: "user" | "assistant"; content: string }[] =
    context.messagesHistory.slice(-12);

  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== "user" || lastMsg.content !== userMessage) {
    messages = [...messages, { role: "user", content: userMessage }];
  }

  // Merge consecutive same-role messages
  const cleanedMessages: typeof messages = [];
  for (const msg of messages) {
    const prev = cleanedMessages[cleanedMessages.length - 1];
    if (prev && prev.role === msg.role) {
      prev.content += "\n" + msg.content;
    } else {
      cleanedMessages.push({ ...msg });
    }
  }

  try {
    // SINGLE AI call: generates response AND extracts data
    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: `${SYSTEM_PROMPT}\n\nETAPA ATUAL: ${context.currentStep}\nINSTRUÇÃO DA ETAPA: ${stepInstruction}\nDADOS JÁ COLETADOS: ${JSON.stringify(context.qualificationData)}\n\nLEMBRE: Verifique os DADOS JÁ COLETADOS antes de perguntar algo. Se já tem a info, confirme e avance.`,
      messages: cleanedMessages,
    });

    // Parse response and data from single call
    const responsePart = text.match(/RESPONSE:\s*([\s\S]*?)(?=DATA:|$)/)?.[1]?.trim() || text;
    const dataPart = text.match(/DATA:\s*(\{[\s\S]*\})/)?.[1]?.trim();

    const responses = responsePart
      .replace(/^RESPONSE:\s*/i, "")
      .split("|||")
      .map((r) => r.trim())
      .filter((r) => r.length > 0 && !r.startsWith("DATA:"));

    // Extract data
    let updatedData = { ...context.qualificationData };
    if (dataPart) {
      try {
        const extracted = JSON.parse(dataPart);
        // Only update fields that have actual values
        for (const [key, value] of Object.entries(extracted)) {
          if (value !== null && value !== undefined && value !== "") {
            (updatedData as Record<string, unknown>)[key] = value;
          }
        }
      } catch {
        console.error("[AI] Failed to parse DATA JSON:", dataPart);
      }
    }

    // Determine next step
    const newStep = determineNextStep(context.currentStep, updatedData);

    // Check handoff
    const shouldHandoff = newStep === "handoff";

    let handoffReason: string | undefined;
    if (shouldHandoff) {
      const score = calculateScore(updatedData);
      const status = getQualificationStatus(score);
      handoffReason = `${status}_score_${score}`;
    }

    return { responses, newStep, updatedData, shouldHandoff, handoffReason };
  } catch (error) {
    console.error("[AI] Error:", error);
    // Graceful fallback — don't mention "technical problem", just ask to continue
    return {
      responses: ["Me conta mais sobre o que você tá buscando"],
      newStep: context.currentStep,
      updatedData: context.qualificationData,
      shouldHandoff: false,
    };
  }
}

function getStepInstruction(step: string, data: QualificationData): string {
  switch (step) {
    case "greeting":
      return "Use 2 mensagens separadas por |||. Primeira: 'Oii! Como vai? ☺️ Sou a Miry, consultora aqui da Cantos do Mundo.' Segunda: 'Como posso te chamar?' APENAS isso, nada mais.";
    case "destination":
      return `O nome é ${data.name}. Use o nome. Pergunte qual destino tem interesse. Se veio de anúncio, referencie. Pergunte se é primeira vez. 1 mensagem.`;
    case "dates":
      return `Comente algo positivo e curto sobre ${data.destination || "o destino"}. Pergunte quantas pessoas viajam. 1 mensagem.`;
    case "travelers":
      return "Responda 'Perfeito' ou similar. Pergunte quando pretendem viajar. 1 mensagem.";
    case "experience":
      if (data.travel_motive) {
        return `O motivo já foi mencionado: "${data.travel_motive}". NÃO pergunte de novo. Apenas confirme: "Só pra confirmar, a viagem é pra ${data.travel_motive}, certo?" e avance. 1 mensagem.`;
      }
      return "Pergunte: 'Me conta, a viagem é para alguma comemoração, férias, descanso?' 1 mensagem.";
    case "style":
      return "Se destino internacional: pergunte 'Vocês já possuem passaporte?' Se nacional: pergunte se tem alguma experiência específica que gostariam. 1 mensagem.";
    case "closing":
      return `Diga algo como: "Perfeito ${data.name || ""}, vou passar todas essas informações pra nossa especialista em viagens poder te ajudar em cada detalhe. Se quiser ir adiantando, pode mandar um áudio contando o que seria importantíssimo ter nessa viagem, tipos de passeios que gostam, o que não pode faltar... assim já chega tudo certinho pra ela montar a proposta!" Use 1 mensagem. SEM emojis.`;
    default:
      return "Continue naturalmente. 1 pergunta por vez. Sem emojis.";
  }
}

function determineNextStep(currentStep: string, data: QualificationData): string {
  switch (currentStep) {
    case "greeting":
      return data.name ? "destination" : "greeting";
    case "destination":
      return data.destination ? "dates" : "destination";
    case "dates":
      return data.travelers_count ? "travelers" : "dates";
    case "travelers":
      return data.travel_dates ? "experience" : "travelers";
    case "experience":
      return data.travel_motive ? "style" : "experience";
    case "style":
      return data.has_passport !== undefined ? "closing" : "style";
    case "closing":
      return "handoff";
    default:
      return currentStep;
  }
}

export async function generateHandoffSummary(
  data: QualificationData,
  score: number
): Promise<string> {
  const status = getQualificationStatus(score);
  const statusLabel = status === "qualified" ? "✅ QUALIFICADO" : status === "warm" ? "🟡 MORNO" : "❌ DESQUALIFICADO";

  return `${statusLabel} (Score: ${score})
Nome: ${data.name || "N/I"}
Destino: ${data.destination || "N/I"}
Quando: ${data.travel_dates || "N/I"}
Viajantes: ${data.travelers_count || "?"} (${data.travelers_type || "?"})
Motivo: ${data.travel_motive || "N/I"}
Primeira vez: ${data.first_time === true ? "Sim" : data.first_time === false ? "Não" : "N/I"}
Passaporte: ${data.has_passport === true ? "Sim" : data.has_passport === false ? "Não" : "N/I"}
Notas: ${data.extra_notes || "-"}`;
}
