export type HomeCampaignDestination =
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

export interface HomeCampaignSlideConfig {
  id: string;
  title: string;
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
    id: "clube-vantagens",
    eyebrow: "Benefícios Sra. Luck",
    title: "Clube de Vantagens",
    description: "Descontos, parcerias e benefícios exclusivos para acompanhar sua jornada.",
    cta: "Conhecer benefícios",
    action: "clube",
    active: true,
    order: 10,
    availability: "always",
    backgroundColor: "#F6E7DF",
    startColor: "#F6E7DF",
    endColor: "#D9B1B8",
    accentColor: "#7A5149",
    textColor: "#3D2926",
    buttonColor: "rgba(91, 52, 48, .92)",
    buttonTextColor: "#FFF9F5",
    overlay: "radial-gradient(circle at 77% 18%, rgba(255,255,255,.48), transparent 34%), radial-gradient(circle at 22% 100%, rgba(126,78,67,.15), transparent 43%)",
    overlayOpacity: 1,
    objectPositionDesktop: "72% 50%",
    objectPositionMobile: "72% 50%",
    wave: { startY: 64, color: "#FFF7F0", opacity: 0.34 },
  },
  {
    id: "acompanhe-pagamentos",
    eyebrow: "Seu plano",
    title: "Acompanhe seus pagamentos",
    description: "Veja suas parcelas, acompanhe seu plano e mantenha seu processo em andamento com mais tranquilidade.",
    cta: "Ver parcelas",
    action: "parcelas",
    active: true,
    order: 20,
    availability: "always",
    backgroundColor: "#D9B1B8",
    startColor: "#D9B1B8",
    endColor: "#C0A6C3",
    accentColor: "#6B1F2E",
    textColor: "#3C222A",
    buttonColor: "rgba(107, 31, 46, .93)",
    buttonTextColor: "#FFF8F7",
    overlay: "radial-gradient(circle at 88% 8%, rgba(112,44,61,.16), transparent 34%), radial-gradient(circle at 8% 80%, rgba(255,242,239,.31), transparent 42%)",
    overlayOpacity: 1,
    objectPositionDesktop: "70% 50%",
    objectPositionMobile: "70% 50%",
    wave: { startY: 43, color: "#FCECEE", opacity: 0.3 },
  },
  {
    id: "campanhas-especiais",
    eyebrow: "Seleção especial",
    title: "Campanhas especiais",
    description: "Condições exclusivas para apoiar sua jornada e deixar seu sonho ainda mais perto.",
    cta: "Acompanhar campanhas",
    action: "campanhas",
    active: false,
    order: 30,
    availability: "requires-campaign-config",
    backgroundColor: "#A95C72",
    startColor: "#A95C72",
    endColor: "#D8A27F",
    accentColor: "#7A243A",
    textColor: "#FFF8F7",
    buttonColor: "rgba(255, 248, 245, .92)",
    buttonTextColor: "#6B1F2E",
    overlay: "radial-gradient(circle at 82% 12%, rgba(255,223,218,.24), transparent 36%)",
    overlayOpacity: 1,
    objectPositionDesktop: "72% 50%",
    objectPositionMobile: "72% 50%",
    wave: { startY: 34, color: "#F4D2D7", opacity: 0.22 },
  },
  {
    id: "isencao-juros-multas",
    eyebrow: "Condição de campanha",
    title: "Isenção de juros e multas",
    description: "Em campanhas selecionadas, aproveite condições especiais para regularizar seu contrato.",
    cta: "Ver condições",
    action: "campanhas",
    active: false,
    order: 40,
    availability: "requires-campaign-config",
    backgroundColor: "#D8A27F",
    startColor: "#D8A27F",
    endColor: "#C0A6C3",
    accentColor: "#895449",
    textColor: "#432A25",
    buttonColor: "rgba(92, 54, 46, .91)",
    buttonTextColor: "#FFF9F4",
    overlay: "radial-gradient(circle at 84% 14%, rgba(255,244,223,.4), transparent 35%), radial-gradient(circle at 8% 92%, rgba(154,79,64,.16), transparent 42%)",
    overlayOpacity: 1,
    objectPositionDesktop: "72% 50%",
    objectPositionMobile: "72% 50%",
    wave: { startY: 55, color: "#FFF1DF", opacity: 0.32 },
  },
  {
    id: "acompanhe-jornada",
    eyebrow: "Sua evolução",
    title: "Acompanhe sua jornada",
    description: "Visualize cada etapa do seu processo, veja o que já foi concluído e saiba o que falta para avançar.",
    cta: "Ver etapas",
    action: "jornada",
    active: true,
    order: 50,
    availability: "always",
    backgroundColor: "#C0A6C3",
    startColor: "#C0A6C3",
    endColor: "#AAB79C",
    accentColor: "#6D506F",
    textColor: "#382A39",
    buttonColor: "rgba(83, 56, 86, .9)",
    buttonTextColor: "#FFF9FF",
    overlay: "radial-gradient(circle at 84% 18%, rgba(244,231,247,.45), transparent 34%), radial-gradient(circle at 13% 92%, rgba(124,78,114,.14), transparent 42%)",
    overlayOpacity: 1,
    objectPositionDesktop: "72% 50%",
    objectPositionMobile: "72% 50%",
    wave: { startY: 37, color: "#F3E8F2", opacity: 0.31 },
  },
  {
    id: "agenda-mais-perto",
    eyebrow: "Próximo grande passo",
    title: "Sua agenda cada vez mais perto",
    description: "Acompanhe o andamento da liberação e veja com clareza o que falta para chegar ao seu grande passo.",
    cta: "Ver andamento",
    action: "agenda",
    active: true,
    order: 60,
    availability: "always",
    backgroundColor: "#AAB79C",
    startColor: "#AAB79C",
    endColor: "#AFC2D5",
    accentColor: "#4F6750",
    textColor: "#263127",
    buttonColor: "rgba(61, 82, 63, .91)",
    buttonTextColor: "#FBFFF9",
    overlay: "radial-gradient(circle at 82% 12%, rgba(241,237,218,.45), transparent 35%), radial-gradient(circle at 8% 90%, rgba(130,91,88,.12), transparent 42%)",
    overlayOpacity: 1,
    objectPositionDesktop: "72% 50%",
    objectPositionMobile: "72% 50%",
    wave: { startY: 61, color: "#EEF1E7", opacity: 0.32 },
  },
  {
    id: "notificacoes-momento-certo",
    eyebrow: "Sempre por perto",
    title: "Tudo o que importa, no momento certo",
    description: "Receba avisos sobre parcelas, campanhas, benefícios e próximos passos do seu processo.",
    cta: "Ver novidades",
    action: "notificacoes",
    active: true,
    order: 70,
    availability: "always",
    backgroundColor: "#AFC2D5",
    startColor: "#AFC2D5",
    endColor: "#C78F79",
    accentColor: "#52667A",
    textColor: "#263340",
    buttonColor: "rgba(65, 82, 99, .9)",
    buttonTextColor: "#F9FCFF",
    overlay: "radial-gradient(circle at 84% 13%, rgba(245,238,242,.45), transparent 35%), radial-gradient(circle at 12% 92%, rgba(116,133,153,.16), transparent 43%)",
    overlayOpacity: 1,
    objectPositionDesktop: "72% 50%",
    objectPositionMobile: "72% 50%",
    wave: { startY: 45, color: "#EAF2F7", opacity: 0.31 },
  },
  {
    id: "fale-com-a-gente",
    eyebrow: "Atendimento Sra. Luck",
    title: "Dúvidas? Fale com a gente",
    description: "Nossa equipe está pronta para ajudar você em cada etapa do seu processo.",
    cta: "Falar com a gente",
    action: "atendimento",
    active: true,
    order: 80,
    availability: "always",
    backgroundColor: "#C78F79",
    startColor: "#C78F79",
    endColor: "#F6E7DF",
    accentColor: "#7C4A3E",
    textColor: "#3D2924",
    buttonColor: "rgba(103, 62, 51, .91)",
    buttonTextColor: "#FFF9F5",
    overlay: "radial-gradient(circle at 83% 15%, rgba(255,235,214,.44), transparent 34%), radial-gradient(circle at 9% 91%, rgba(137,67,67,.13), transparent 43%)",
    overlayOpacity: 1,
    objectPositionDesktop: "72% 50%",
    objectPositionMobile: "72% 50%",
    wave: { startY: 68, color: "#FFEBDD", opacity: 0.3 },
  },
];

/**
 * Resolve somente slides habilitados e recalcula os pontos de saída para o próximo
 * slide ativo. Assim, mesmo ao ligar/desligar campanhas, cor e onda continuam cíclicas.
 */
export function resolveHomeCampaignSlides(
  slides: HomeCampaignSlideConfig[] = HOME_CAMPAIGN_SLIDES,
): ResolvedHomeCampaignSlide[] {
  const activeSlides = slides
    .filter((slide) => slide.active)
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
