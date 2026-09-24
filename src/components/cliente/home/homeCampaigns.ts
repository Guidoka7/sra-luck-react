export type HomeCampaignDestination =
  | "historia"
  | "clube"
  | "parcelas"
  | "campanhas"
  | "jornada"
  | "agenda"
  | "notificacoes"
  | "atendimento";

export type HomeCampaignAvailability = "always" | "requires-campaign-config";

export interface HomeCampaignWaveConfig {
  startY: number;
  endY?: number;
  color?: string;
  opacity?: number;
}

/** Paleta da marca aplicada ao cartão (src/styles/home-promo.css). */
export type HomeCampaignTema = "creme" | "vinho" | "rose" | "blush" | "nude" | "ameixa";
/** Ilustração exclusiva do cartão (HomeCampaignArt.tsx). */
export type HomeCampaignArte = "camila" | "clube" | "indicacao" | "progresso" | "jornada" | "atendimento" | "campanha";

export interface HomeCampaignSlideConfig {
  id: string;
  /**
   * Título e descrição aceitam {nome} (primeiro nome da cliente). Sem nome,
   * "{nome}, " some e a frase continua com inicial maiúscula.
   */
  title: string;
  /** Trecho do título destacado em itálico rosé, como no site da Sra. Luck. */
  destaque?: string;
  tema?: HomeCampaignTema;
  arte?: HomeCampaignArte;
  description: string;
  cta: string;
  action: HomeCampaignDestination;
  eyebrow?: string;
  active: boolean;
  order: number;
  availability?: HomeCampaignAvailability;
  backgroundColor: string;
  startColor: string;
  endColor: string;
  backgroundGradient?: string;
  backgroundImage?: string;
  overlay?: string;
  overlayOpacity?: number;
  accentColor: string;
  textColor: string;
  buttonColor: string;
  buttonTextColor: string;
  desktopImage?: string;
  mobileImage?: string;
  imageAlt?: string;
  objectPositionDesktop?: string;
  objectPositionMobile?: string;
  wave: HomeCampaignWaveConfig;
}

export interface ResolvedHomeCampaignSlide extends HomeCampaignSlideConfig {
  wave: HomeCampaignWaveConfig & { endY: number };
}

/**
 * Catálogo inicial do carrossel da Home.
 *
 * `active` e `order` são deliberadamente dados de configuração, não estrutura da Home.
 * Slides dependentes de campanha permanecem inativos enquanto não houver configuração
 * persistida/autorização de negócio que os habilite. Isso evita CTA ou promessa fictícia.
 */
export const HOME_CAMPAIGN_SLIDES: HomeCampaignSlideConfig[] = [
  {
    id: "nossa-historia",
    eyebrow: "Camila Luck · Fundadora",
    title: "Aqui o seu sonho é possível.",
    destaque: "é possível.",
    description: "{nome}, a Camila realizou o próprio sonho com planejamento. Agora é a sua vez.",
    cta: "Conhecer a história",
    action: "historia",
    tema: "creme",
    arte: "camila",
    imageAlt: "Camila Luck, fundadora da Sra. Luck",
    active: true,
    order: 10,
    availability: "always",
    backgroundColor: "#FBF1EC",
    startColor: "#FBF1EC",
    endColor: "#F1D9D6",
    accentColor: "#B77C76",
    textColor: "#5E1F2B",
    buttonColor: "#7A2632",
    buttonTextColor: "#FFF8F3",
    wave: { startY: 64 },
  },
  {
    id: "clube-vantagens",
    eyebrow: "Clube de Vantagens",
    title: "Pagar em dia vira presente.",
    destaque: "presente.",
    description: "Parcela em dia soma pontos. Troque por prêmios pensados para você.",
    cta: "Ver meus prêmios",
    action: "clube",
    tema: "vinho",
    arte: "clube",
    active: true,
    order: 20,
    availability: "always",
    backgroundColor: "#7A2632",
    startColor: "#7A2632",
    endColor: "#4A1520",
    accentColor: "#D9B56E",
    textColor: "#FFF4EF",
    buttonColor: "#F6E3C8",
    buttonTextColor: "#5E1F2B",
    wave: { startY: 43 },
  },
  {
    id: "indique-amiga",
    eyebrow: "Indique e ganhe",
    title: "Divida o sonho com uma amiga.",
    destaque: "com uma amiga.",
    description: "Indique e ganhe pontos no Clube quando a indicação for confirmada.",
    cta: "Indicar uma amiga",
    action: "clube",
    tema: "rose",
    arte: "indicacao",
    active: true,
    order: 30,
    availability: "always",
    backgroundColor: "#C58A8C",
    startColor: "#C58A8C",
    endColor: "#A55E68",
    accentColor: "#FFF1EE",
    textColor: "#FFFFFF",
    buttonColor: "#FFF8F5",
    buttonTextColor: "#7A2632",
    wave: { startY: 55 },
  },
  {
    id: "seu-plano",
    eyebrow: "Seu plano",
    title: "Cada parcela te leva mais perto.",
    destaque: "mais perto.",
    description: "{nome}, mantenha seus boletos em dia e chegue mais rápido ao seu grande dia.",
    cta: "Ver minhas parcelas",
    action: "parcelas",
    tema: "blush",
    arte: "progresso",
    active: true,
    order: 40,
    availability: "always",
    backgroundColor: "#F7E3E6",
    startColor: "#F7E3E6",
    endColor: "#E9C2CA",
    accentColor: "#B4586A",
    textColor: "#5E1F2B",
    buttonColor: "#7A2632",
    buttonTextColor: "#FFF8F3",
    wave: { startY: 37 },
  },
  {
    id: "acompanhe-jornada",
    eyebrow: "Do contrato à cirurgia",
    title: "Sua jornada, etapa por etapa.",
    destaque: "etapa por etapa.",
    description: "Veja o que já foi concluído e qual é o seu próximo passo.",
    cta: "Ver minha jornada",
    action: "jornada",
    tema: "nude",
    arte: "jornada",
    active: true,
    order: 50,
    availability: "always",
    backgroundColor: "#F4E6DD",
    startColor: "#F4E6DD",
    endColor: "#E4C9BA",
    accentColor: "#A8773F",
    textColor: "#4F2A22",
    buttonColor: "#5E2F27",
    buttonTextColor: "#FFF8F3",
    wave: { startY: 61 },
  },
  {
    id: "fale-com-a-gente",
    eyebrow: "Atendimento humanizado",
    title: "Estamos com você em cada etapa.",
    destaque: "em cada etapa.",
    description: "Fale com a equipe pelo app ou visite a gente na Asa Sul e em Águas Claras.",
    cta: "Falar com a equipe",
    action: "atendimento",
    tema: "ameixa",
    arte: "atendimento",
    active: true,
    order: 60,
    availability: "always",
    backgroundColor: "#3E1E2A",
    startColor: "#3E1E2A",
    endColor: "#62303F",
    accentColor: "#E6A2B2",
    textColor: "#FFF4F2",
    buttonColor: "#F4D3DA",
    buttonTextColor: "#4A1F2C",
    wave: { startY: 45 },
  },
  {
    id: "campanhas-especiais",
    eyebrow: "Seleção especial",
    title: "Campanhas especiais",
    destaque: "especiais",
    description: "Condições exclusivas para apoiar sua jornada e deixar seu sonho ainda mais perto.",
    cta: "Acompanhar campanhas",
    action: "campanhas",
    tema: "rose",
    arte: "campanha",
    active: false,
    order: 70,
    availability: "requires-campaign-config",
    backgroundColor: "#A95C72",
    startColor: "#A95C72",
    endColor: "#D8A27F",
    accentColor: "#7A243A",
    textColor: "#FFF8F7",
    buttonColor: "rgba(255, 248, 245, .92)",
    buttonTextColor: "#6B1F2E",
    wave: { startY: 34 },
  },
  {
    id: "isencao-juros-multas",
    eyebrow: "Condição de campanha",
    title: "Isenção de juros e multas",
    destaque: "juros e multas",
    description: "Em campanhas selecionadas, aproveite condições especiais para regularizar seu contrato.",
    cta: "Ver condições",
    action: "campanhas",
    tema: "nude",
    arte: "campanha",
    active: false,
    order: 80,
    availability: "requires-campaign-config",
    backgroundColor: "#D8A27F",
    startColor: "#D8A27F",
    endColor: "#C0A6C3",
    accentColor: "#895449",
    textColor: "#432A25",
    buttonColor: "rgba(92, 54, 46, .91)",
    buttonTextColor: "#FFF9F4",
    wave: { startY: 55 },
  },
];

export const HOME_CAMPAIGN_TEMAS: readonly HomeCampaignTema[] = ["creme", "vinho", "rose", "blush", "nude", "ameixa"];
export const HOME_CAMPAIGN_ARTES: readonly HomeCampaignArte[] = ["camila", "clube", "indicacao", "progresso", "jornada", "atendimento", "campanha"];
/** Destinos que um cartão configurável pode abrir (campanhas não tem tela própria). */
export const HOME_CAMPAIGN_DESTINOS_CONFIGURAVEIS: readonly HomeCampaignDestination[] = ["historia", "clube", "parcelas", "jornada", "agenda", "notificacoes", "atendimento"];
export const HOME_CAMPAIGN_TEXTOS = ["eyebrow", "title", "destaque", "description", "cta"] as const;

/** Ajuste salvo pelo Admin/Dev Console para um cartão (existente ou novo). */
export interface HomeCampaignOverride {
  id: string;
  /** Cartão novo: de qual cartão existente copia o visual (cores, onda, imagem). */
  baseId?: string | null;
  ativo?: boolean | null;
  ordem?: number | null;
  dados?: Partial<Pick<HomeCampaignSlideConfig, "eyebrow" | "title" | "destaque" | "description" | "cta" | "action" | "tema" | "arte">> | null;
}

function dadosPermitidos(dados: HomeCampaignOverride["dados"]) {
  const out: Partial<HomeCampaignSlideConfig> = {};
  if (!dados) return out;
  for (const campo of HOME_CAMPAIGN_TEXTOS) {
    const valor = dados[campo];
    if (typeof valor === "string" && valor.trim()) out[campo] = valor.trim();
  }
  if (dados.action && HOME_CAMPAIGN_DESTINOS_CONFIGURAVEIS.includes(dados.action)) out.action = dados.action;
  if (dados.tema && HOME_CAMPAIGN_TEMAS.includes(dados.tema)) out.tema = dados.tema;
  if (dados.arte && HOME_CAMPAIGN_ARTES.includes(dados.arte)) out.arte = dados.arte;
  return out;
}

/**
 * Aplica os ajustes salvos sobre o catálogo padrão. Sem ajustes (ou com dados
 * inválidos) o resultado é exatamente o catálogo padrão. Cartões de campanha
 * comercial continuam dependendo de `requires-campaign-config`.
 */
export function aplicarConfiguracaoCampanhas(
  base: HomeCampaignSlideConfig[] = HOME_CAMPAIGN_SLIDES,
  overrides: HomeCampaignOverride[] = [],
): HomeCampaignSlideConfig[] {
  const porId = new Map(base.map((slide) => [slide.id, slide]));
  const resultado = base.map((slide) => {
    const o = overrides.find((item) => item.id === slide.id && !item.baseId);
    if (!o) return slide;
    return {
      ...slide,
      ...dadosPermitidos(o.dados),
      active: typeof o.ativo === "boolean" ? o.ativo : slide.active,
      order: Number.isFinite(o.ordem) ? Number(o.ordem) : slide.order,
    };
  });
  for (const o of overrides) {
    const modelo = o.baseId ? porId.get(o.baseId) : undefined;
    if (!modelo || porId.has(o.id)) continue;
    const dados = dadosPermitidos(o.dados);
    if (!dados.title || !dados.description || !dados.cta) continue;
    resultado.push({
      ...modelo,
      ...dados,
      id: o.id,
      action: dados.action ?? (modelo.action === "campanhas" ? "clube" : modelo.action),
      availability: "always",
      active: o.ativo !== false,
      order: Number.isFinite(o.ordem) ? Number(o.ordem) : 100,
    });
  }
  return resultado;
}

/** Dados da cliente usados para personalizar os cartões. */
export interface HomeCampaignContexto {
  /** Primeiro nome da cliente (vazio = texto genérico). */
  nome?: string | null;
  /** Percentual do plano já pago (0–100). */
  percentualPago?: number | null;
}

/** Aplica {nome} no texto do cartão, sem deixar vírgula solta quando não há nome. */
export function aplicarContexto(texto: string, contexto: HomeCampaignContexto = {}): string {
  const nome = (contexto.nome ?? "").trim();
  if (nome) return texto.replace(/\{nome\}/g, nome);
  const semNome = texto.replace(/\{nome\},?\s*/g, "").trim();
  return semNome.charAt(0).toUpperCase() + semNome.slice(1);
}

/** Primeiro nome, com só a inicial maiúscula ("MARIA SOUZA" → "Maria"). */
export function primeiroNome(nomeCompleto: string | null | undefined): string {
  const primeiro = (nomeCompleto ?? "").trim().split(/\s+/)[0] ?? "";
  return primeiro ? primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase() : "";
}

/**
 * Resolve somente slides habilitados e recalcula os pontos de saída para o próximo
 * slide ativo. Assim, mesmo ao ligar/desligar campanhas, cor e onda continuam cíclicas.
 */
export function resolveHomeCampaignSlides(
  slides: HomeCampaignSlideConfig[] = HOME_CAMPAIGN_SLIDES,
  { campaignConfigAvailable = false }: { campaignConfigAvailable?: boolean } = {},
): ResolvedHomeCampaignSlide[] {
  // Oferta comercial só aparece com configuração real de campanha persistida;
  // enquanto ela não existe, nem um `active: true` acidental promete desconto/isenção.
  const activeSlides = slides
    .filter((slide) => slide.active)
    .filter((slide) => slide.availability !== "requires-campaign-config" || campaignConfigAvailable)
    .slice()
    .sort((a, b) => a.order - b.order);

  if (activeSlides.length === 0) return [];

  return activeSlides.map((slide, index) => {
    const next = activeSlides[(index + 1) % activeSlides.length];
    const hasNext = activeSlides.length > 1;

    return {
      ...slide,
      endColor: hasNext ? next.startColor : slide.endColor,
      wave: {
        ...slide.wave,
        endY: hasNext ? next.wave.startY : (slide.wave.endY ?? slide.wave.startY),
      },
    };
  });
}

export type HomeCampaignTab = "inicio" | "agenda" | "premios" | "parcelas" | "mais";

export interface HomeCampaignNavigation {
  tab: HomeCampaignTab;
  /** Subtela do Mais aberta diretamente (Jornada/Atendimento). */
  maisSubTela?: "jornada" | "atendimento";
  /** Abre o balão de notificações do sininho. */
  openNotifications?: boolean;
}

/**
 * Destino de cada CTA no app atual. `campanhas` não tem runtime enquanto não
 * existir configuração real de campanha — retorna `null` (nenhuma navegação).
 */
export function resolveHomeCampaignNavigation(destination: HomeCampaignDestination): HomeCampaignNavigation | null {
  switch (destination) {
    case "parcelas": return { tab: "parcelas" };
    case "jornada": return { tab: "mais", maisSubTela: "jornada" };
    case "notificacoes": return { tab: "inicio", openNotifications: true };
    case "agenda": return { tab: "agenda" };
    case "clube": return { tab: "premios" };
    case "atendimento": return { tab: "mais", maisSubTela: "atendimento" };
    // A história da Sra. Luck abre numa folha dentro da própria Início.
    case "historia": return { tab: "inicio" };
    case "campanhas": return null;
  }
}
