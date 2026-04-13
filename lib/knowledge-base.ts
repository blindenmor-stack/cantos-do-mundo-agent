// Base de conhecimento da Cantos do Mundo — usada pela Miry para responder
// perguntas do cliente sobre a empresa, serviços, processo, diferenciais, etc.
//
// Preencha cada campo com texto curto e objetivo (o bot usa isso como contexto no system prompt).
// Quanto mais específico, melhor — evita respostas genéricas/inventadas.
//
// Para atualizar: edite este arquivo e faça o deploy (push no main).

export interface KnowledgeBase {
  company: {
    name: string;
    description: string;
    founded?: string;
    location?: string;
    team?: string;
    website?: string;
    instagram?: string;
  };
  services: {
    what_we_do: string; // O que fazemos
    what_we_dont_do?: string; // O que NÃO fazemos (pra Miry não prometer o que não existe)
    types_of_trips: string; // Tipos de roteiro: lua de mel, família, solo, grupo...
    destinations_specialty: string; // Destinos em que somos especialistas
  };
  process: {
    how_it_works: string; // Como funciona o processo do primeiro contato ao pós-viagem
    timeline: string; // Tempo entre o primeiro contato e a proposta
    who_speaks_after_handoff: string; // Quem continua depois da Miry (ex: Miriany)
  };
  pricing: {
    approach: string; // Como falamos de preço (não temos tabela pronta, é sob medida)
    payment_methods?: string; // Formas de pagamento aceitas
    deposit_required?: string; // Se tem entrada, sinal, etc
  };
  differentials: {
    why_us: string; // Por que escolher a Cantos do Mundo vs outras agências
    proof?: string; // Provas sociais, clientes famosos, prêmios, depoimentos notáveis
  };
  common_questions: {
    // FAQ — perguntas que clientes fazem com frequência + resposta curta
    // formato livre em markdown, será injetado no system prompt
    faq: string;
  };
  restrictions: {
    // O que a Miry NÃO deve fazer/falar
    never_promise?: string;
    escalate_to_human?: string; // Quando passar pra humano imediatamente
  };
}

// ⚠️ PLACEHOLDER — preencher com respostas reais da Cantos do Mundo.
// Enquanto estiver "[PREENCHER: ...]", a Miry vai falar de forma genérica.
export const KB: KnowledgeBase = {
  company: {
    name: "Cantos do Mundo",
    description: "[PREENCHER: descrição curta da empresa em 2-3 frases. Quem somos, há quanto tempo, posicionamento.]",
    founded: "[PREENCHER: ano de fundação]",
    location: "[PREENCHER: cidade/estado ou 100% online]",
    team: "[PREENCHER: tamanho e composição da equipe (especialistas por região, etc)]",
    website: "[PREENCHER: URL do site]",
    instagram: "[PREENCHER: @handle]",
  },
  services: {
    what_we_do: "[PREENCHER: descrição curta do serviço principal. Ex: 'Montamos roteiros personalizados sob medida, cuidamos de tudo — passagens, hospedagem, passeios, transfers, guias, documentação.']",
    what_we_dont_do: "[PREENCHER: o que NÃO vendemos. Ex: 'Não vendemos pacotes prontos de operadora. Não fazemos intercâmbio de longa duração. Não operamos cruzeiros.']",
    types_of_trips: "[PREENCHER: tipos de viagem que atendemos. Ex: 'Lua de mel, aniversários, viagens em família, viagens solo, bodas, comemorações especiais, viagens em grupo fechado.']",
    destinations_specialty: "[PREENCHER: destinos em que somos mais fortes. Ex: 'Europa (Itália, França, Portugal), Ásia (Japão, Tailândia), Caribe, África (safáris), destinos premium no Brasil.']",
  },
  process: {
    how_it_works: "[PREENCHER: passo a passo do atendimento. Ex: '1. Conversa inicial aqui no WhatsApp pra entender o perfil. 2. Especialista monta proposta personalizada em até 3 dias. 3. Ajustes até ficar perfeito. 4. Fechamento e pagamento. 5. Envio da documentação e dicas. 6. Suporte durante a viagem.']",
    timeline: "[PREENCHER: quanto tempo leva do primeiro contato até receber a proposta]",
    who_speaks_after_handoff: "[PREENCHER: quem toma a conta depois que a Miry qualifica. Ex: 'Miriany, nossa especialista em roteiros.']",
  },
  pricing: {
    approach: "[PREENCHER: como abordar preço quando o cliente perguntar. Ex: 'Não temos tabela — cada roteiro é montado sob medida. Os valores dependem de destino, época, hospedagem e experiências. Depois da qualificação, a Miriany monta orçamento personalizado sem custo.']",
    payment_methods: "[PREENCHER: cartão em quantas vezes, PIX, boleto, etc]",
    deposit_required: "[PREENCHER: entrada ou sinal necessário]",
  },
  differentials: {
    why_us: "[PREENCHER: 3-4 diferenciais concretos. Ex: 'Atendimento humano e personalizado do início ao fim. Equipe que já viveu os destinos (não só leu sobre). Suporte 24/7 durante a viagem. Rede de parceiros locais premium.']",
    proof: "[PREENCHER: provas sociais. Ex: '+2000 viagens entregues, 4.9 estrelas no Google, clientes recorrentes que voltam todo ano.']",
  },
  common_questions: {
    faq: `[PREENCHER EM MARKDOWN — cada pergunta + resposta curta]
Exemplo:
**Vocês vendem só viagens internacionais?**
Não, também fazemos roteiros Brasil adentro — do litoral ao pantanal.

**Precisa de passaporte desde já?**
Depende do destino. Pra Brasil, só RG. Pra fora, sim — e damos dicas de como tirar/renovar.

**Tem como parcelar?**
[PREENCHER condições]
`,
  },
  restrictions: {
    never_promise: "NUNCA inventar preços específicos, prazos de resposta menores que o combinado, ou disponibilidade de hotel/voo específico. Sempre redirecionar essas perguntas para o especialista humano.",
    escalate_to_human: "Se o cliente estiver ansioso, com urgência de viagem em menos de 30 dias, ou com pergunta muito técnica (visto complicado, caso atípico), qualificar o mais rápido possível e passar pra Miriany.",
  },
};

// Monta um bloco de conhecimento pronto pra injetar no system prompt do agente.
export function buildKnowledgeContext(): string {
  return `
# CONHECIMENTO SOBRE A CANTOS DO MUNDO

## Empresa
${KB.company.description}
- Localização: ${KB.company.location}
- Equipe: ${KB.company.team}
- Site: ${KB.company.website}

## Serviços
O QUE FAZEMOS: ${KB.services.what_we_do}
O QUE NÃO FAZEMOS: ${KB.services.what_we_dont_do}
TIPOS DE VIAGEM: ${KB.services.types_of_trips}
ESPECIALIDADES: ${KB.services.destinations_specialty}

## Como funciona o atendimento
${KB.process.how_it_works}
Tempo pra proposta: ${KB.process.timeline}
Depois da Miry: ${KB.process.who_speaks_after_handoff}

## Preço
${KB.pricing.approach}
Formas de pagamento: ${KB.pricing.payment_methods}
Entrada/sinal: ${KB.pricing.deposit_required}

## Diferenciais
${KB.differentials.why_us}
${KB.differentials.proof ? `Provas: ${KB.differentials.proof}` : ""}

## FAQ
${KB.common_questions.faq}

## Restrições
- ${KB.restrictions.never_promise}
- ${KB.restrictions.escalate_to_human}
`.trim();
}
