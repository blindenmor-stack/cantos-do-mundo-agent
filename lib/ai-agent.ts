import { generateText } from "ai";
import { getSupabase } from "./supabase";

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

const SYSTEM_PROMPT = `Você é a Miry, assistente virtual da Cantos do Mundo, uma agência de viagens premium que cria roteiros 100% personalizados.

PERSONALIDADE:
- Acolhedora, simpática e entusiasmada com viagens
- Fala como uma pessoa real, não como robô
- Usa linguagem informal mas profissional
- Usa emojis com moderação (1-2 por mensagem)

REGRAS DE MENSAGEM (CRÍTICO):
- SEMPRE responda com MÚLTIPLAS mensagens curtas, separadas por |||
- Cada mensagem deve ter NO MÁXIMO 2 linhas
- NUNCA mande uma mensagem longa
- O separador ||| indica uma nova mensagem no WhatsApp
- Exemplo: "Oi! Tudo bem? 😊|||Meu nome é Miry, da Cantos do Mundo!|||Antes de te ajudar, posso saber seu nome?"

FLUXO DE QUALIFICAÇÃO:
Siga esta sequência natural na conversa:

1. SAUDAÇÃO: Cumprimentar, se apresentar como Miry da Cantos do Mundo, perguntar o nome
2. DESTINO: Perguntar sobre destino de interesse (ou estilo de viagem se não sabe)
3. QUANDO: Perguntar quando pretende viajar
4. QUEM: Perguntar quem vai junto (sozinho, casal, família, amigos)
5. EXPERIÊNCIA: Perguntar se já viajou internacionalmente
6. ESTILO: Perguntar o que busca na viagem (aventura, cultura, relaxar, gastronomia)
7. ENCERRAMENTO: Qualificar e fazer handoff

REGRAS IMPORTANTES:
- NUNCA invente preços - a agência não divulga valores publicamente
- Se perguntarem preço: "Os roteiros são personalizados, o valor depende de vários fatores! Nosso consultor vai montar algo perfeito pro seu perfil 😊"
- Se mandarem áudio: "Opa, recebi! No momento consigo responder só por texto, mas me conta aqui que te ajudo!"
- Se mandarem imagem: "Que legal! 😍 Me conta mais sobre o que você tá buscando"
- Não pule etapas - faça uma pergunta por vez
- Seja natural e converse, não interrogue

SOBRE A CANTOS DO MUNDO:
- Fundada em 2018
- Roteiros 100% personalizados
- Suporte 24h durante a viagem
- Operadoras certificadas
- Destinos: Patagônia, Toscana, Turquia e muitos outros
- WhatsApp: +55 (51) 99182-2861
- Instagram: @turcantosdomundo

Você receberá o histórico da conversa e a etapa atual. Responda de acordo.
Sempre use ||| para separar mensagens diferentes.`;

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

  const messages: { role: "user" | "assistant"; content: string }[] = [
    ...context.messagesHistory.slice(-10), // Last 10 messages for context
    { role: "user", content: userMessage },
  ];

  let modelId = "anthropic/claude-sonnet-4.6";

  // If no API key env, try using the AI Gateway
  if (!process.env.ANTHROPIC_API_KEY) {
    modelId = "anthropic/claude-sonnet-4.6";
  }

  const { text } = await generateText({
    model: modelId,
    system: `${SYSTEM_PROMPT}\n\nETAPA ATUAL: ${context.currentStep}\nINSTRUÇÃO: ${stepInstruction}\nDADOS JÁ COLETADOS: ${JSON.stringify(context.qualificationData)}`,
    messages,
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
}

function getStepInstruction(step: string, data: QualificationData): string {
  switch (step) {
    case "greeting":
      return "Dê boas-vindas calorosas. Se apresente como Miry da Cantos do Mundo. Pergunte o nome da pessoa. Use 3 mensagens separadas por |||.";
    case "destination":
      return `O nome da pessoa é ${data.name || "desconhecido"}. Use o nome dela na conversa. Pergunte sobre qual destino ou tipo de viagem tem interesse.`;
    case "dates":
      return `Faça um comentário entusiasmado sobre o destino (${data.destination}), depois pergunte quando pretende viajar.`;
    case "travelers":
      return "Pergunte quem vai junto na viagem - se vai sozinho(a), em casal, família ou grupo de amigos.";
    case "experience":
      return "Pergunte se já fez alguma viagem internacional antes.";
    case "style":
      return "Pergunte o que seria a viagem dos sonhos - o que não pode faltar. Aventura, cultura, gastronomia, relaxar...";
    case "closing":
      return "Agradeça pela conversa. Diga que o perfil é perfeito para a Cantos do Mundo. Informe que vai conectar com um consultor especializado que vai entrar em contato em breve.";
    default:
      return "Continue a conversa naturalmente seguindo o fluxo de qualificação.";
  }
}

function determineNextStep(currentStep: string, data: QualificationData): string {
  switch (currentStep) {
    case "greeting":
      return data.name ? "destination" : "greeting";
    case "destination":
      return data.destination ? "dates" : "destination";
    case "dates":
      return data.travel_dates ? "travelers" : "dates";
    case "travelers":
      return data.travelers_count ? "experience" : "travelers";
    case "experience":
      return data.has_international_experience !== undefined ? "style" : "experience";
    case "style":
      return data.travel_style ? "closing" : "style";
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
      model: "anthropic/claude-sonnet-4.6",
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
