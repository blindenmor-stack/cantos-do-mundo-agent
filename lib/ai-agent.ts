import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

// Qualification scoring
interface QualificationData {
  name?: string;
  destination?: string;
  travel_dates?: string;
  travelers_count?: number;
  travelers_type?: string;
  has_international_experience?: boolean;
  travel_style?: string;
  budget_mentioned?: string;
  only_wants_price?: boolean;
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

  if (data.has_international_experience) score += 15;
  else if (data.has_international_experience === false) score += 5;

  if (data.travel_style) score += 20;
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
- Você fala como uma consultora de viagens real brasileira no WhatsApp
- Linguagem natural, leve, coloquial — "Oii", "Como vai?", "Me conta", "Ah que legal"
- Emojis: MÁXIMO 1 por conversa inteira. Só ☺️ na saudação. Depois disso ZERO emojis.
- NÃO use: 😊😍🌍✈️✨🌊❤️🎉 — isso parece robô
- Mensagens de tamanho natural — pode ter 2-3 linhas quando faz sentido
- Use ||| APENAS quando seria natural mandar mensagens separadas no WhatsApp (ex: saudação e depois pergunta)
- NÃO quebre cada frase em mensagem separada. 2 mensagens por vez é o máximo normal.

EXEMPLOS REAIS DE COMO FALAR (copie este tom):
- "Oii [Nome], como vai? ☺️ Sou a Miry, consultora aqui da Cantos do Mundo"
- "Vi que demonstrou interesse no nosso roteiro para [Destino], seria sua primeira vez?"
- "Ah que legal, vai ser uma experiência maravilhosa"
- "Perfeito, e seria para quantas pessoas?"
- "Me conta, a viagem é para alguma comemoração, férias, descanso?"
- "Vocês já possuem passaporte?"

O QUE NÃO FAZER:
- NÃO fale "planejar uma viagem incrível" — isso é linguagem de IA
- NÃO fale "experiência inesquecível" ou "jornada transformadora" — robótico
- NÃO use 3+ mensagens seguidas na saudação
- NÃO seja excessivamente entusiasmada — seja simpática e profissional
- NÃO pergunte "o que não pode faltar na viagem dos sonhos" — muito genérico
- NÃO invente preços

FLUXO DA CONVERSA:
1. SAUDAÇÃO + NOME: Se apresentar e perguntar o nome
2. DESTINO: Referenciar o anúncio se souber, perguntar se é primeira vez nesse destino
3. PESSOAS: Quantas pessoas viajam
4. DATAS: Quando pretendem ir
5. MOTIVO: Comemoração, férias, descanso?
6. PASSAPORTE: Se já possuem passaporte (para destinos internacionais)
7. HANDOFF: Conectar com consultor

REGRAS:
- Faça UMA pergunta por vez, nunca duas
- Se perguntarem preço: "Os valores dependem do roteiro e das datas, vou montar uma proposta certinha pra vocês"
- Se mandarem áudio: "Opa, recebi! Por aqui consigo responder só por texto, me conta aqui que te ajudo"
- Não pule etapas
- Quando fizer sentido, comente algo positivo e curto sobre o destino antes da próxima pergunta

Você receberá o histórico e a etapa atual. Responda no tom descrito acima.
Use ||| apenas para separar mensagens que seriam enviadas separadamente no WhatsApp (máximo 2 por resposta).`;

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

  // Force handoff if too many bot messages
  if (context.botMessagesCount >= maxBotMessages) {
    return {
      responses: [
        "Foi ótimo conversar com você! 😊",
        "Vou te conectar com um dos nossos consultores que vai poder te ajudar com todos os detalhes",
        "Ele(a) entra em contato em breve!",
      ],
      newStep: "handoff",
      updatedData: context.qualificationData,
      shouldHandoff: true,
      handoffReason: "max_messages_reached",
    };
  }

  const stepInstruction = getStepInstruction(context.currentStep, context.qualificationData);

  // Build messages - the history already includes the current message from DB
  // so we don't append userMessage again. But if history is empty (first message
  // race condition), ensure the user message is present.
  let messages: { role: "user" | "assistant"; content: string }[] =
    context.messagesHistory.slice(-10);

  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== "user" || lastMsg.content !== userMessage) {
    messages = [...messages, { role: "user", content: userMessage }];
  }

  // Ensure messages alternate properly (AI SDK requirement)
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
    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: `${SYSTEM_PROMPT}\n\nETAPA ATUAL: ${context.currentStep}\nINSTRUÇÃO: ${stepInstruction}\nDADOS JÁ COLETADOS: ${JSON.stringify(context.qualificationData)}`,
      messages: cleanedMessages,
    });

    // Split responses by |||
    const responses = text
      .split("|||")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    // Extract data from conversation using AI
    const updatedData = await extractQualificationData(
      userMessage,
      context.currentStep,
      context.qualificationData
    );

    // Determine next step
    const newStep = determineNextStep(context.currentStep, updatedData);

    // Check if should handoff
    const score = calculateScore(updatedData);
    const shouldHandoff = newStep === "handoff" || newStep === "closing";

    let handoffReason: string | undefined;
    if (shouldHandoff) {
      const status = getQualificationStatus(score);
      handoffReason = `${status}_score_${score}`;
    }

    return { responses, newStep, updatedData, shouldHandoff, handoffReason };
  } catch (error) {
    console.error("[AI] Error generating response:", error);
    // Return a graceful fallback so the conversation doesn't break
    return {
      responses: ["Opa, tive um probleminha técnico aqui! 😅", "Pode repetir o que você disse?"],
      newStep: context.currentStep,
      updatedData: context.qualificationData,
      shouldHandoff: false,
    };
  }
}

function getStepInstruction(step: string, data: QualificationData): string {
  switch (step) {
    case "greeting":
      return "Use EXATAMENTE 2 mensagens separadas por |||. Primeira: 'Oii! Como vai? ☺️ Sou a Miry, consultora aqui da Cantos do Mundo.' Segunda: 'Como posso te chamar?' NÃO mencione viagem, destino, ou qualquer outra coisa. APENAS se apresente e pergunte o nome.";
    case "destination":
      return `O nome é ${data.name}. Cumprimente usando o nome: 'Oii ${data.name}, que bom falar contigo!' Depois pergunte qual destino tem interesse. Se veio de um anúncio, referencie: 'Vi que demonstrou interesse no nosso roteiro para [destino], seria sua primeira vez?' Use 1 mensagem só.`;
    case "dates":
      return `Faça um comentário curto e positivo sobre o destino (${data.destination}) tipo 'Ah que legal, ${data.destination} é lindíssimo'. Depois pergunte: 'Seria para quantas pessoas?' Use 1 ou 2 mensagens no máximo.`;
    case "travelers":
      return "Responda 'Perfeito' ou similar, depois pergunte quando pretendem viajar. Se souber datas do anúncio, mencione: 'As datas estão boas pra vocês, ou gostariam de ajustar?' Use 1 mensagem.";
    case "experience":
      return `Responda positivamente de forma curta. Depois pergunte: 'Me conta, a viagem é para alguma comemoração, férias, descanso?' Use 1 mensagem.`;
    case "style":
      return `Responda 'Perfeito' ou 'Que legal'. Se for destino internacional, pergunte: 'Vocês já possuem passaporte?' Se for nacional, pergunte: 'Tem alguma experiência específica que gostariam de viver no destino?' Use 1 mensagem.`;
    case "closing":
      return "Responda positivamente. Diga que vai preparar uma proposta personalizada e conectar com o time. Algo como: 'Perfeito [nome], vou passar todas essas informações pro nosso time e logo entram em contato com uma proposta certinha pra vocês!' Use 1 mensagem. NÃO use emojis.";
    default:
      return "Continue a conversa naturalmente. Faça uma pergunta por vez. Sem emojis.";
  }
}

function determineNextStep(currentStep: string, data: QualificationData): string {
  // Flow: greeting → destination → dates (pessoas) → travelers (datas) → experience (motivo) → style (passaporte) → closing
  switch (currentStep) {
    case "greeting":
      return data.name ? "destination" : "greeting";
    case "destination":
      return data.destination ? "dates" : "destination";
    case "dates":
      // Step "dates" actually asks for number of people (following Miriany's real flow)
      return data.travelers_count ? "travelers" : "dates";
    case "travelers":
      // Step "travelers" actually asks for dates
      return data.travel_dates ? "experience" : "travelers";
    case "experience":
      // Asks for trip motive (comemoração, férias, descanso)
      return data.travel_style ? "style" : "experience";
    case "style":
      // Asks for passport
      return data.has_international_experience !== undefined ? "closing" : "style";
    case "closing":
      return "handoff";
    default:
      return currentStep;
  }
}

async function extractQualificationData(
  userMessage: string,
  currentStep: string,
  existingData: QualificationData
): Promise<QualificationData> {
  try {
    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: `Extraia dados de qualificação da mensagem do usuário. Retorne APENAS um JSON válido com os campos que conseguir identificar. Campos possíveis: name (string), destination (string), travel_dates (string), travelers_count (number), travelers_type (string: solo/couple/family/friends), has_international_experience (boolean), travel_style (string), budget_mentioned (string: alto/medio/baixo), only_wants_price (boolean).

Dados já existentes: ${JSON.stringify(existingData)}
Etapa atual: ${currentStep}

Retorne APENAS o JSON atualizado, sem explicações.`,
      prompt: userMessage,
    });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const extracted = JSON.parse(jsonMatch[0]);
      return { ...existingData, ...extracted };
    }
  } catch (err) {
    console.error("[AI] Error extracting data:", err);
  }
  return existingData;
}

// Generate handoff summary
export async function generateHandoffSummary(
  data: QualificationData,
  score: number
): Promise<string> {
  const status = getQualificationStatus(score);
  const statusLabel = status === "qualified" ? "✅ QUALIFICADO" : status === "warm" ? "🟡 MORNO" : "❌ DESQUALIFICADO";

  return `${statusLabel} (Score: ${score})
Nome: ${data.name || "Não informado"}
Destino: ${data.destination || "Não informado"}
Quando: ${data.travel_dates || "Não informado"}
Viajantes: ${data.travelers_count || "?"} (${data.travelers_type || "?"})
Experiência internacional: ${data.has_international_experience ? "Sim" : data.has_international_experience === false ? "Não" : "Não informado"}
Estilo: ${data.travel_style || "Não informado"}`;
}
