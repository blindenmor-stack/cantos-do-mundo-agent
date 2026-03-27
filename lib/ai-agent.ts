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

  // Destino definido (20 pts)
  if (data.destination) score += 20;

  // Data da viagem (25 pts max — mais próximo = mais quente)
  if (data.travel_dates) {
    const months = parseDateToMonths(data.travel_dates);
    if (months !== null && months <= 3) score += 25;
    else if (months !== null && months <= 6) score += 20;
    else if (months !== null && months <= 12) score += 15;
    else score += 10;
  }

  // Número de viajantes (15 pts)
  if (data.travelers_count && data.travelers_count >= 2) score += 15;
  else if (data.travelers_count === 1) score += 10;

  // Motivo da viagem (15 pts — motivos especiais = mais engajado)
  if (data.travel_motive) {
    const special = ["lua de mel", "casamento", "aniversário", "aniversario", "comemoração"];
    if (special.some((s) => (data.travel_motive || "").toLowerCase().includes(s))) {
      score += 15; // Motivo especial = muito engajado
    } else {
      score += 10;
    }
  }

  // Orçamento informado (15 pts)
  if (data.budget_per_person) score += 15;

  // Respondeu todas as perguntas = lead completo (10 pts bonus)
  const fieldsCount = [data.destination, data.travel_dates, data.travelers_count, data.travel_motive, data.budget_per_person].filter(Boolean).length;
  if (fieldsCount >= 5) score += 10;

  // Penalidade: só quer preço sem contexto
  if (data.only_wants_price) score -= 30;

  return Math.max(0, Math.min(100, score));
}

// Score ranges:
// 0-39: Desqualificado (não forneceu dados suficientes ou só quer preço)
// 40-69: Morno (forneceu alguns dados, potencial)
// 70-100: Qualificado (forneceu tudo, lead quente)

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
  if (score >= 70) return "qualified";
  if (score >= 40) return "warm";
  return "disqualified";
}

// Steps in order
const STEPS = ["greeting", "destination", "dates", "motive", "people", "budget", "closing"] as const;

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
- NÃO invente preços ou prometa passar valores
- NÃO mande mais que 2 mensagens por vez
- NÃO diga "vou te passar uma ideia de valores" — você NÃO tem acesso a preços

SE PEDIREM PREÇO:
Diga algo como: "Os valores dependem muito do roteiro, datas e estilo de hospedagem que vocês preferem. A Miriany, nossa especialista, vai montar um orçamento personalizado certinho pra vocês." Depois continue o fluxo normalmente com a próxima pergunta pendente.

REGRA ABSOLUTA — NÃO REPETIR:
Olhe os DADOS COLETADOS abaixo. Se um dado já existe, NUNCA pergunte sobre ele de novo. Exemplos:
- Se travelers_count já tem valor → NÃO pergunte quantas pessoas
- Se travel_dates já tem valor → NÃO pergunte quando vão viajar
- Se has_passport já tem valor → NÃO pergunte sobre passaporte
- Se travel_motive já tem valor → NÃO pergunte o motivo

REGRA ABSOLUTA — UMA PERGUNTA:
Faça EXATAMENTE 1 pergunta por mensagem. NUNCA duas. Se a instrução diz pra perguntar X, pergunte APENAS X e nada mais.`;

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
  console.log("[AI] processMessage input:", JSON.stringify({
    userMessage: userMessage.slice(0, 200),
    currentStep: context.currentStep,
    qualData: context.qualificationData,
    botMsgs: context.botMessagesCount,
    historyLen: context.messagesHistory.length,
  }));

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
  // This scans ALL message history, so it catches data even if step is out of sync
  const updatedData = extractDataFromText(userMessage, context.qualificationData, context.messagesHistory);

  console.log("[AI] Extracted data:", JSON.stringify(updatedData));

  // Find the REAL current step based on collected data (not just DB step)
  // This fixes desync: if DB says "dates" but we already have travel_dates, skip ahead
  let realStep = findFirstIncompleteStep(updatedData);

  console.log("[AI] Step resolution: db=" + context.currentStep + " → real=" + realStep);

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

  // Generate response — use templates for standard questions, AI only for dynamic responses
  let responses: string[];
  const finalInstruction = buildInstruction(realStep, updatedData);
  const templateResponse = getTemplateResponse(realStep, updatedData, userMessage);

  if (templateResponse) {
    responses = templateResponse;
    console.log("[AI] Using template for step:", realStep);
  } else {
    try {
      const { text } = await generateText({
        model: anthropic("claude-sonnet-4-20250514"),
        system: `${SYSTEM_PROMPT}\n\nETAPA ATUAL: ${realStep}\nINSTRUÇÃO (siga à risca): ${finalInstruction}\n\nDADOS JÁ COLETADOS (NÃO pergunte sobre nenhum desses):\n${formatCollectedData(updatedData)}\n\nPERGUNTAS PROIBIDAS (já tem resposta): ${getForbiddenQuestions(updatedData)}`,
        messages: cleaned,
      });

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
      console.error("[AI] Error generating response:", error);
      responses = getFallbackResponse(realStep, updatedData);
    }
  }

  // Check handoff — closing IS the handoff (sends the goodbye + triggers scoring)
  const shouldHandoff = realStep === "handoff" || realStep === "closing";
  let handoffReason: string | undefined;
  if (shouldHandoff) {
    const score = calculateScore(updatedData);
    handoffReason = `${getQualificationStatus(score)}_score_${score}`;
  }

  console.log("[AI] processMessage result:", JSON.stringify({
    newStep: realStep,
    handoff: shouldHandoff,
    responses: responses.length,
    responsesPreview: responses.map(r => r.slice(0, 60)),
  }));

  return { responses, newStep: realStep, updatedData, shouldHandoff, handoffReason };
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

  // Destination — comprehensive list + pattern extraction
  if (!data.destination) {
    const destinations: Record<string, string> = {
      // Internacional
      "europa": "Europa", "eurotrip": "Europa", "euro trip": "Europa",
      "itália": "Itália", "italia": "Itália", "roma": "Roma", "toscana": "Toscana",
      "paris": "Paris", "frança": "França", "franca": "França",
      "portugal": "Portugal", "lisboa": "Lisboa", "porto": "Porto",
      "espanha": "Espanha", "madri": "Madri", "barcelona": "Barcelona",
      "grécia": "Grécia", "grecia": "Grécia", "santorini": "Santorini",
      "turquia": "Turquia", "capadócia": "Capadócia", "capadocia": "Capadócia",
      "croácia": "Croácia", "croacia": "Croácia",
      "patagônia": "Patagônia", "patagonia": "Patagônia",
      "caribe": "Caribe", "punta cana": "Punta Cana", "cancun": "Cancún", "cancún": "Cancún",
      "maldivas": "Maldivas", "egito": "Egito", "marrocos": "Marrocos",
      "japão": "Japão", "japao": "Japão", "tailândia": "Tailândia", "tailandia": "Tailândia",
      "eua": "EUA", "estados unidos": "EUA", "nova york": "Nova York", "miami": "Miami", "orlando": "Orlando",
      "bariloche": "Bariloche", "argentina": "Argentina", "chile": "Chile",
      "peru": "Peru", "machu picchu": "Machu Picchu",
      "africa": "África", "áfrica": "África", "dubai": "Dubai", "bali": "Bali",
      "méxico": "México", "mexico": "México", "londres": "Londres", "amsterdam": "Amsterdam",
      "suíça": "Suíça", "suica": "Suíça", "áustria": "Áustria", "austria": "Áustria",
      // Nacional
      "bahia": "Bahia", "salvador": "Salvador",
      "porto seguro": "Porto Seguro", "morro de são paulo": "Morro de São Paulo",
      "fernando de noronha": "Fernando de Noronha", "noronha": "Fernando de Noronha",
      "gramado": "Gramado", "canela": "Canela",
      "florianópolis": "Florianópolis", "florianopolis": "Florianópolis", "floripa": "Florianópolis",
      "rio de janeiro": "Rio de Janeiro",
      "natal": "Natal", "recife": "Recife", "fortaleza": "Fortaleza",
      "foz do iguaçu": "Foz do Iguaçu", "foz do iguacu": "Foz do Iguaçu",
      "bonito": "Bonito", "jericoacoara": "Jericoacoara", "jeri": "Jericoacoara",
      "chapada diamantina": "Chapada Diamantina", "chapada": "Chapada",
      "pantanal": "Pantanal", "amazônia": "Amazônia", "amazonia": "Amazônia",
      "maragogi": "Maragogi", "porto de galinhas": "Porto de Galinhas",
      "arraial d'ajuda": "Arraial d'Ajuda", "arraial": "Arraial",
      "trancoso": "Trancoso", "ilhabela": "Ilhabela",
      "paraty": "Paraty", "búzios": "Búzios", "buzios": "Búzios",
      "lençóis maranhenses": "Lençóis Maranhenses", "lençóis": "Lençóis",
      "são paulo": "São Paulo", "minas gerais": "Minas Gerais",
      "caldas novas": "Caldas Novas", "serra gaúcha": "Serra Gaúcha",
      "costa do sauípe": "Costa do Sauípe", "praia do forte": "Praia do Forte",
      "costa do descobrimento": "Costa do Descobrimento",
      "nordeste": "Nordeste", "sul": "Sul do Brasil",
    };

    // Try exact match first (longer phrases first) — scan ALL history
    const sortedKeys = Object.keys(destinations).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (allUserText.includes(key)) {
        data.destination = destinations[key];
        break;
      }
    }

    // Pattern-based extraction from all history
    if (!data.destination) {
      const patterns = [
        /(?:ir|viajar|conhecer|visitar|quero|gostaria)\s+(?:pra|para|a|o)\s+(.{2,30})(?:\.|,|!|\?|\n|$)/i,
        /(?:destino|lugar|pacote|roteiro)\s+(?:pra|para|de|em)\s+(.{2,30})(?:\.|,|!|\?|\n|$)/i,
      ];
      for (const pat of patterns) {
        const match = allUserText.match(pat);
        if (match) {
          const extracted = match[1].trim().replace(/\s+mesmo$/, "").replace(/\s+por$/, "");
          if (extracted.length >= 2 && extracted.length <= 30) {
            data.destination = extracted.charAt(0).toUpperCase() + extracted.slice(1);
            break;
          }
        }
      }
    }
  }

  // Travelers count — scan ALL history
  if (!data.travelers_count) {
    // Digit + pessoa/pessoas
    const countMatch = allUserText.match(/(\d+)\s*(?:pessoa|pessoas|adulto|adultos|viajante)/i);
    if (countMatch) {
      data.travelers_count = parseInt(countMatch[1]);
    }

    // Word numbers: "duas pessoas", "três pessoas"
    if (!data.travelers_count) {
      const wordNums: Record<string, number> = {
        uma: 1, duas: 2, dois: 2, três: 3, tres: 3, quatro: 4, cinco: 5, seis: 6,
      };
      for (const [word, num] of Object.entries(wordNums)) {
        if (allUserText.includes(word + " pessoa") || allUserText.includes(word + " adulto")) {
          data.travelers_count = num;
          break;
        }
      }
    }

    // "eu e minha esposa/noiva/marido/namorada" = 2 people — scan ALL history
    if (!data.travelers_count) {
      if (allUserText.match(/eu e m(?:inha|eu)\s+(?:esposa|noiva|marido|noivo|namorad[ao]|mulher|companheir[ao])/)) {
        data.travelers_count = 2;
        data.travelers_type = "couple";
      } else if (allUserText.includes("casal") || allUserText.includes("nós dois") || allUserText.includes("a dois") || allUserText.includes("nós duas")) {
        data.travelers_count = 2;
        data.travelers_type = "couple";
      } else if (allUserText.match(/\bsomos\s+2\b/) || allUserText.match(/\bseriam\s+2\b/) || allUserText.match(/\bserao\s+2\b/) || lower.match(/\b2\b/)) {
        data.travelers_count = 2;
      } else if (allUserText.includes("sozinho") || allUserText.includes("sozinha") || allUserText.includes("só eu")) {
        data.travelers_count = 1;
        data.travelers_type = "solo";
      } else if (allUserText.includes("família") || allUserText.includes("familia")) {
        data.travelers_type = "family";
      }
    }
  }

  // Travel dates — scan ALL user history
  if (!data.travel_dates) {
    const monthNames = ["janeiro", "fevereiro", "março", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    // Check allUserText (full history) not just current message
    for (const month of monthNames) {
      if (allUserText.includes(month)) {
        const yearMatch = allUserText.match(/20\d{2}/);
        data.travel_dates = yearMatch ? `${month} ${yearMatch[0]}` : month;
        break;
      }
    }
  }

  // Auto-skip passport for national destinations
  if (data.has_passport === undefined && data.destination) {
    const destLower = data.destination.toLowerCase();
    const nacional = ["brasil", "fernando de noronha", "noronha", "gramado", "florianópolis", "florianopolis", "rio de janeiro", "salvador", "recife", "natal", "fortaleza", "foz do iguaçu", "foz do iguacu", "bonito", "jericoacoara", "lençóis", "lencois", "chapada", "pantanal", "amazônia", "amazonia", "maragogi", "porto de galinhas", "arraial", "trancoso", "ilhabela", "paraty", "búzios", "buzios"];
    if (nacional.some((n) => destLower.includes(n))) {
      data.has_passport = true; // Mark as "not needed" to skip step
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

  // Budget — scan all history
  if (!data.budget_per_person) {
    const budgetMatch = allUserText.match(/(\d[\d.,]*)\s*(?:mil|k|reais|R\$|por pessoa)/i);
    if (budgetMatch) data.budget_per_person = budgetMatch[0];
    const fullMatch = allUserText.match(/R\$\s*[\d.,]+/);
    if (fullMatch) data.budget_per_person = fullMatch[0];
    // Match plain numbers after budget context: "em torno de 3000", "uns 2500"
    const contextMatch = allUserText.match(/(?:torno de|mais ou menos|aproximadamente|uns|cerca de)\s*(\d[\d.,]*)/i);
    if (contextMatch && !data.budget_per_person) data.budget_per_person = `R$ ${contextMatch[1]}`;
  }

  // Extra notes from longer messages
  if (text.length > 50 && !data.extra_notes) {
    data.extra_notes = text.slice(0, 200);
  } else if (text.length > 50 && data.extra_notes) {
    data.extra_notes += " | " + text.slice(0, 100);
  }

  return data;
}

// Find the first step that doesn't have data yet — scans from the beginning
// This is the primary step resolution: ignores DB step entirely, just looks at data
function findFirstIncompleteStep(data: QualificationData): string {
  const stepChecks: Record<string, () => boolean> = {
    greeting: () => !!data.name,
    destination: () => !!data.destination,
    dates: () => !!data.travel_dates,
    motive: () => !!data.travel_motive,
    people: () => !!data.travelers_count,
    budget: () => !!data.budget_per_person,
  };

  for (const step of STEPS) {
    if (step === "closing") return "closing"; // all prior steps passed
    const check = stepChecks[step];
    if (check && !check()) return step;
  }
  return "closing";
}

function buildInstruction(step: string, data: QualificationData): string {
  const name = data.name || "";

  switch (step) {
    case "greeting":
      return "Template vai responder.";
    case "destination":
      return `Cumprimente ${name} pelo nome de forma curta. Pergunte qual destino tem interesse. APENAS 1 pergunta. Máximo 2 linhas. SEM emojis.`;
    case "dates":
      return "Template vai responder.";
    case "motive":
      return "Template vai responder.";
    case "people":
      return "Template vai responder.";
    case "budget":
      return "Template vai responder.";
    case "closing":
      return "Template vai responder.";
    default:
      return `Responda de forma curta e natural. Faça APENAS 1 pergunta. SEM emojis. Dados já coletados: ${JSON.stringify(data)}`;
  }
}

function getFallbackResponse(step: string, data: QualificationData): string[] {
  switch (step) {
    case "greeting":
      return ["Oii! Como vai? ☺️ Sou a Miry, consultora aqui da Cantos do Mundo.", "Como posso te chamar?"];
    case "destination":
      return [`Prazer, ${data.name || ""}! Me conta, qual destino te interessa?`];
    case "dates":
      return ["E pra quando vocês estão pensando em viajar?"];
    case "motive":
      return ["Me conta, a viagem é pra alguma comemoração, férias, descanso?"];
    case "people":
      return ["Seria pra quantas pessoas essa viagem?"];
    case "budget":
      return [`${data.name || "Vocês"}, têm ideia de quanto gostariam de investir por pessoa?`];
    case "closing":
      return [
        `Perfeito ${data.name || ""}! Vou passar tudo pra Miriany, nossa especialista. Logo mais ela te manda mensagem aqui por esse número`,
        "Se quiser ir adiantando, pode mandar um áudio contando o que seria mais importante nessa viagem",
      ];
    default:
      return ["Me conta mais sobre o que vocês buscam"];
  }
}

// Template responses for standard questions — bypasses AI entirely
function getTemplateResponse(step: string, data: QualificationData, _userMessage: string): string[] | null {
  const name = data.name || "";

  switch (step) {
    case "greeting":
      return [
        "Oii! Como vai? ☺️ Sou a Miry, consultora aqui da Cantos do Mundo.",
        "Como posso te chamar?",
      ];

    case "dates":
      if (data.travel_dates) return null;
      return [`E pra quando vocês estão pensando em viajar?`];

    case "motive":
      if (data.travel_motive) return null;
      return [`Me conta${name ? " " + name : ""}, a viagem é pra alguma comemoração, férias, descanso?`];

    case "people":
      if (data.travelers_count) return null;
      return [`Seria pra quantas pessoas essa viagem?`];

    case "budget":
      return [`${name || "Vocês"}, têm ideia de quanto gostariam de investir nessa viagem, por pessoa? Pode ser um valor aproximado`];

    case "closing":
      return [
        `Perfeito ${name}, já tenho tudo que preciso! Vou passar todas as informações pra Miriany, nossa especialista em roteiros. Logo mais ela te manda mensagem aqui por esse número mesmo`,
        `Se quiser ir adiantando, pode mandar um áudio contando o que seria mais importante nessa viagem, tipos de passeios que gostam, o que não pode faltar... assim já chega tudo redondinho pra ela montar a proposta`,
      ];

    // Only destination uses AI (needs dynamic comment about the destination)
    case "destination":
    default:
      return null;
  }
}

function formatCollectedData(data: QualificationData): string {
  const lines: string[] = [];
  if (data.name) lines.push(`- Nome: ${data.name}`);
  if (data.destination) lines.push(`- Destino: ${data.destination}`);
  if (data.travelers_count) lines.push(`- Viajantes: ${data.travelers_count} (${data.travelers_type || "?"})`);
  if (data.has_passport !== undefined) lines.push(`- Passaporte: ${data.has_passport ? "Sim" : "Não"}`);
  if (data.travel_dates) lines.push(`- Datas: ${data.travel_dates}`);
  if (data.travel_motive) lines.push(`- Motivo: ${data.travel_motive}`);
  if (data.budget_per_person) lines.push(`- Orçamento: ${data.budget_per_person}`);
  if (data.first_time !== undefined) lines.push(`- Primeira vez: ${data.first_time ? "Sim" : "Não"}`);
  if (data.extra_notes) lines.push(`- Notas: ${data.extra_notes}`);
  return lines.length > 0 ? lines.join("\n") : "Nenhum dado coletado ainda";
}

function getForbiddenQuestions(data: QualificationData): string {
  const forbidden: string[] = [];
  if (data.name) forbidden.push("nome");
  if (data.destination) forbidden.push("destino");
  if (data.travelers_count) forbidden.push("quantas pessoas");
  if (data.has_passport !== undefined) forbidden.push("passaporte");
  if (data.travel_dates) forbidden.push("quando vai viajar / datas");
  if (data.travel_motive) forbidden.push("motivo da viagem");
  if (data.budget_per_person) forbidden.push("orçamento");
  if (data.first_time !== undefined) forbidden.push("primeira vez");
  return forbidden.length > 0 ? forbidden.join(", ") : "nenhuma";
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
