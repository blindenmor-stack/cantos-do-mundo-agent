import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export interface QualificationData {
  name?: string;
  destination?: string;
  travel_dates?: string;
  travelers_count?: number;
  travelers_type?: string;
  has_passport?: boolean;
  travel_motive?: string;
  first_time?: boolean;
  budget_per_person?: string;
  extra_notes?: string;
  only_wants_price?: boolean;
}

export function calculateScore(data: QualificationData): number {
  let score = 0;
  if (data.destination) score += 20;
  if (data.travel_dates) {
    const months = parseDateToMonths(data.travel_dates);
    if (months !== null && months <= 6) score += 25;
    else if (months !== null && months <= 12) score += 15;
    else score += 5;
  }
  if (data.travelers_count && data.travelers_count >= 2) score += 15;
  else if (data.travelers_count === 1) score += 10;
  if (data.travel_motive) score += 15;
  if (data.has_passport) score += 10;
  if (data.budget_per_person) score += 10;
  if (data.only_wants_price) score -= 20;
  return score;
}

function parseDateToMonths(dateStr: string): number | null {
  const lower = dateStr.toLowerCase();
  const months: Record<string, number> = {
    janeiro: 1, fevereiro: 2, março: 3, marco: 3, abril: 4, maio: 5,
    junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  };
  for (const [name, num] of Object.entries(months)) {
    if (lower.includes(name)) {
      const now = new Date();
      let diff = num - (now.getMonth() + 1);
      if (diff <= 0) diff += 12;
      return diff;
    }
  }
  if (lower.includes("2027") || lower.includes("ano que vem")) return 12;
  if (lower.includes("próximo") || lower.includes("logo")) return 3;
  if (lower.includes("este ano") || lower.includes("esse ano")) return 6;
  return null;
}

export function getQualificationStatus(score: number): "qualified" | "warm" | "disqualified" {
  if (score >= 60) return "qualified";
  if (score >= 30) return "warm";
  return "disqualified";
}

// Steps in order
const STEPS = ["greeting", "destination", "people", "passport", "dates", "motive", "budget", "closing"] as const;

const SYSTEM_PROMPT = `Você é a Miry, consultora da Cantos do Mundo, agência de viagens com roteiros personalizados.

TOM DE VOZ — copie exatamente:
- Consultora brasileira real no WhatsApp
- "Oii", "Como vai?", "Me conta", "Ah que legal", "Perfeito"
- ☺️ APENAS na primeira saudação. Depois disso ZERO emojis. NENHUM.
- Mensagens naturais, 2-3 linhas quando faz sentido
- ||| separa mensagens diferentes no WhatsApp. Máximo 2 por resposta.

NÃO FAÇA:
- NÃO use emojis além do ☺️ na saudação
- NÃO fale "experiência inesquecível" ou "viagem incrível"
- NÃO repita pergunta que já foi respondida
- NÃO invente preços
- NÃO mande mais que 2 mensagens por vez

IMPORTANTE: Se a pessoa já mencionou algo antes (como motivo da viagem), NÃO pergunte de novo. Confirme e avance.`;

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
  // Force handoff after 15 bot messages
  if (context.botMessagesCount >= 15) {
    return {
      responses: [`${context.qualificationData.name || ""}, foi ótimo conversar contigo! Vou passar tudo pra Miriany, nossa especialista. Logo mais ela te manda mensagem aqui por esse número`],
      newStep: "handoff",
      updatedData: context.qualificationData,
      shouldHandoff: true,
      handoffReason: "max_messages",
    };
  }

  // Extract data from user message FIRST (simple, no AI needed)
  const updatedData = extractDataFromText(userMessage, context.qualificationData, context.messagesHistory);

  // Advance step based on collected data
  const currentStep = advanceStep(context.currentStep, updatedData);

  // Build instruction for this step
  const instruction = buildInstruction(currentStep, updatedData);

  // Build clean message history
  let msgs: { role: "user" | "assistant"; content: string }[] = context.messagesHistory.slice(-10);
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== "user" || last.content !== userMessage) {
    msgs = [...msgs, { role: "user", content: userMessage }];
  }
  // Merge consecutive same-role
  const cleaned: typeof msgs = [];
  for (const m of msgs) {
    const prev = cleaned[cleaned.length - 1];
    if (prev && prev.role === m.role) prev.content += "\n" + m.content;
    else cleaned.push({ ...m });
  }

  // Generate response
  let responses: string[];
  try {
    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: `${SYSTEM_PROMPT}\n\nETAPA: ${currentStep}\nINSTRUÇÃO: ${instruction}\nDADOS COLETADOS: ${JSON.stringify(updatedData)}`,
      messages: cleaned,
    });

    // Clean up response - remove any RESPONSE:/DATA: artifacts
    let cleanText = text
      .replace(/^RESPONSE:\s*/i, "")
      .replace(/DATA:\s*\{[\s\S]*\}\s*$/i, "")
      .trim();

    responses = cleanText
      .split("|||")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    if (responses.length === 0) responses = [cleanText || "Me conta mais"];
  } catch (error) {
    console.error("[AI] Error:", error);
    // Smart fallback based on step
    responses = getFallbackResponse(currentStep, updatedData);
  }

  // Check handoff
  const shouldHandoff = currentStep === "handoff";
  let handoffReason: string | undefined;
  if (shouldHandoff) {
    const score = calculateScore(updatedData);
    handoffReason = `${getQualificationStatus(score)}_score_${score}`;
  }

  return { responses, newStep: currentStep, updatedData, shouldHandoff, handoffReason };
}

// Extract data from user text using pattern matching (no AI call needed)
function extractDataFromText(
  text: string,
  existing: QualificationData,
  history: { role: string; content: string }[]
): QualificationData {
  const data = { ...existing };
  const lower = text.toLowerCase();
  const allUserText = history
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ")
    .toLowerCase() + " " + lower;

  // Name (if greeting step and no name yet)
  if (!data.name) {
    // Common patterns: "me chame de X", "sou o/a X", "meu nome é X", or just a first name
    const namePatterns = [
      /(?:me (?:chame?|chama) de |sou (?:o |a )?|meu nome [eé] |pode me chamar de )(\w+)/i,
      /^(\w{2,15})(?:\s+(?:por favor|pfvr|pf))?$/i,
    ];
    for (const pat of namePatterns) {
      const match = text.match(pat);
      if (match) {
        const name = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
        if (!["sim", "nao", "não", "oi", "ola", "olá", "opa", "bom", "boa", "tudo", "ok"].includes(name.toLowerCase())) {
          data.name = name;
        }
      }
    }
  }

  // Destination
  if (!data.destination) {
    const destinations = [
      "europa", "itália", "italia", "roma", "paris", "frança", "franca",
      "portugal", "lisboa", "espanha", "madri", "barcelona",
      "grécia", "grecia", "turquia", "toscana", "patagônia", "patagonia",
      "caribe", "punta cana", "cancun", "cancún", "maldivas",
      "egito", "marrocos", "japão", "japao", "tailândia", "tailandia",
      "eua", "estados unidos", "nova york", "miami", "orlando",
      "bariloche", "argentina", "chile", "peru", "machu picchu",
      "africa", "áfrica", "dubai", "maldivas", "bali", "croácia", "croacia",
    ];
    for (const dest of destinations) {
      if (lower.includes(dest)) {
        data.destination = dest.charAt(0).toUpperCase() + dest.slice(1);
        break;
      }
    }
    if (!data.destination && (lower.includes("eurotrip") || lower.includes("euro trip"))) {
      data.destination = "Europa (Eurotrip)";
    }
  }

  // Travelers count
  if (!data.travelers_count) {
    const countMatch = text.match(/(\d+)\s*(?:pessoa|pessoas|adulto|adultos|viajante)/i);
    if (countMatch) data.travelers_count = parseInt(countMatch[1]);
    else if (lower.includes("casal") || lower.includes("nós dois") || lower.includes("a dois") || lower.match(/\b2\b/)) {
      data.travelers_count = 2;
      data.travelers_type = "couple";
    } else if (lower.includes("sozinho") || lower.includes("sozinha") || lower.includes("só eu")) {
      data.travelers_count = 1;
      data.travelers_type = "solo";
    }
  }

  // Travel dates
  if (!data.travel_dates) {
    const monthNames = ["janeiro", "fevereiro", "março", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    for (const month of monthNames) {
      if (lower.includes(month)) {
        const yearMatch = text.match(/20\d{2}/);
        data.travel_dates = yearMatch ? `${month} ${yearMatch[0]}` : month;
        break;
      }
    }
  }

  // Passport
  if (data.has_passport === undefined) {
    if (lower.includes("sim") && (allUserText.includes("passaporte"))) {
      data.has_passport = true;
    } else if ((lower.includes("não") || lower.includes("nao")) && allUserText.includes("passaporte")) {
      data.has_passport = false;
    } else if (lower.includes("temos passaporte") || lower.includes("tenho passaporte") || lower.includes("já temos")) {
      data.has_passport = true;
    } else if (lower.includes("não temos") || lower.includes("nao temos") || lower.includes("ainda não")) {
      data.has_passport = false;
    }
  }

  // Travel motive
  if (!data.travel_motive) {
    if (allUserText.includes("lua de mel") || allUserText.includes("casamento")) data.travel_motive = "lua de mel";
    else if (allUserText.includes("aniversário") || allUserText.includes("aniversario")) data.travel_motive = "aniversário";
    else if (allUserText.includes("férias") || allUserText.includes("ferias")) data.travel_motive = "férias";
    else if (allUserText.includes("descanso") || allUserText.includes("relaxar")) data.travel_motive = "descanso";
    else if (allUserText.includes("aposentadoria") || allUserText.includes("aposentei")) data.travel_motive = "aposentadoria";
    else if (allUserText.includes("comemorar") || allUserText.includes("comemoração")) data.travel_motive = "comemoração";
  }

  // First time
  if (data.first_time === undefined) {
    if (lower.includes("primeira vez") || lower.includes("nunca fui") || lower.includes("nunca fomos")) {
      data.first_time = true;
    } else if (lower.includes("já fui") || lower.includes("já fomos") || lower.includes("já fiz")) {
      data.first_time = false;
    }
  }

  // Budget
  if (!data.budget_per_person) {
    const budgetMatch = text.match(/(\d[\d.,]*)\s*(?:mil|k|reais|R\$)/i);
    if (budgetMatch) data.budget_per_person = budgetMatch[0];
    const fullMatch = text.match(/R\$\s*[\d.,]+/);
    if (fullMatch) data.budget_per_person = fullMatch[0];
  }

  // Extra notes from longer messages
  if (text.length > 50 && !data.extra_notes) {
    data.extra_notes = text.slice(0, 200);
  } else if (text.length > 50 && data.extra_notes) {
    data.extra_notes += " | " + text.slice(0, 100);
  }

  return data;
}

// Advance to the next unfilled step
function advanceStep(currentStep: string, data: QualificationData): string {
  const stepChecks: Record<string, () => boolean> = {
    greeting: () => !!data.name,
    destination: () => !!data.destination,
    people: () => !!data.travelers_count,
    passport: () => data.has_passport !== undefined,
    dates: () => !!data.travel_dates,
    motive: () => !!data.travel_motive,
    budget: () => !!data.budget_per_person,
    closing: () => true,
  };

  // If current step is complete, find next incomplete step
  const check = stepChecks[currentStep];
  if (check && check()) {
    const currentIdx = STEPS.indexOf(currentStep as typeof STEPS[number]);
    for (let i = currentIdx + 1; i < STEPS.length; i++) {
      const step = STEPS[i];
      const stepCheck = stepChecks[step];
      if (!stepCheck || !stepCheck()) return step;
    }
    return "closing";
  }

  return currentStep;
}

function buildInstruction(step: string, data: QualificationData): string {
  const name = data.name || "";

  switch (step) {
    case "greeting":
      return "Mande 2 mensagens com |||. Primeira: 'Oii! Como vai? ☺️ Sou a Miry, consultora aqui da Cantos do Mundo.' Segunda: 'Como posso te chamar?'";
    case "destination":
      return `Cumprimente ${name} pelo nome. Pergunte qual destino tem interesse ou se veio de anúncio, referencie. Pergunte se é primeira vez. 1 mensagem.`;
    case "people":
      return `Comente algo positivo e curto sobre ${data.destination || "o destino"}. Pergunte quantas pessoas viajam. 1 mensagem.`;
    case "passport":
      return "Pergunte se já possuem passaporte. 1 mensagem.";
    case "dates":
      return "Pergunte quando pretendem viajar. 1 mensagem.";
    case "motive":
      if (data.travel_motive) {
        return `O motivo já foi mencionado: "${data.travel_motive}". NÃO pergunte de novo. Apenas confirme rapidamente e pergunte sobre orçamento. Ex: "Que lindo, ${data.travel_motive}! E vocês tem ideia de quanto gostariam de investir nessa viagem, por pessoa?"`;
      }
      return `Pergunte o motivo da viagem: comemoração, férias, descanso? 1 mensagem.`;
    case "budget":
      return `Pergunte: "${name}, vocês tem ideia de quanto gostariam de investir nessa viagem, por pessoa? Pode ser um valor aproximado, pra gente já direcionar pro roteiro certo." 1 mensagem. SEM emojis.`;
    case "closing":
      return `Mande 2 mensagens com |||. Primeira: "Perfeito ${name}, já tenho tudo que preciso! Vou passar todas as informações pra Miriany, nossa especialista em roteiros. Logo mais ela te manda mensagem aqui por esse número mesmo." Segunda: "Se quiser ir adiantando, pode mandar um áudio contando o que seria mais importante nessa viagem, tipos de passeios que gostam, o que não pode faltar... assim já chega tudo redondinho pra ela montar a proposta." SEM emojis.`;
    default:
      return "Continue a conversa naturalmente, faça a próxima pergunta do fluxo. 1 mensagem. Sem emojis.";
  }
}

function getFallbackResponse(step: string, data: QualificationData): string[] {
  switch (step) {
    case "greeting":
      return ["Oii! Como vai? ☺️ Sou a Miry, consultora aqui da Cantos do Mundo.", "Como posso te chamar?"];
    case "destination":
      return [`Prazer, ${data.name || ""}! Me conta, qual destino despertou seu interesse?`];
    case "people":
      return ["E seria pra quantas pessoas essa viagem?"];
    case "passport":
      return ["Vocês já possuem passaporte?"];
    case "dates":
      return ["E pra quando vocês estão pensando em viajar?"];
    case "motive":
      return ["Me conta, a viagem é pra alguma comemoração, férias, descanso?"];
    case "budget":
      return [`${data.name || "Vocês"}, tem ideia de quanto gostariam de investir por pessoa?`];
    case "closing":
      return [
        `Perfeito ${data.name || ""}! Vou passar tudo pra Miriany, nossa especialista. Logo mais ela te manda mensagem aqui por esse número`,
        "Se quiser ir adiantando, pode mandar um áudio contando o que seria mais importante nessa viagem",
      ];
    default:
      return ["Me conta mais sobre o que vocês buscam nessa viagem"];
  }
}

export async function generateHandoffSummary(data: QualificationData, score: number): Promise<string> {
  const status = getQualificationStatus(score);
  const label = status === "qualified" ? "✅ QUALIFICADO" : status === "warm" ? "🟡 MORNO" : "❌ DESQUALIFICADO";

  return `${label} (Score: ${score})
Nome: ${data.name || "N/I"}
Destino: ${data.destination || "N/I"}
Quando: ${data.travel_dates || "N/I"}
Viajantes: ${data.travelers_count || "?"} (${data.travelers_type || "?"})
Motivo: ${data.travel_motive || "N/I"}
Primeira vez: ${data.first_time === true ? "Sim" : data.first_time === false ? "Não" : "N/I"}
Passaporte: ${data.has_passport === true ? "Sim" : data.has_passport === false ? "Não" : "N/I"}
Orçamento/pessoa: ${data.budget_per_person || "N/I"}
Notas: ${data.extra_notes || "-"}`;
}
