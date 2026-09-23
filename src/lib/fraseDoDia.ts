/**
 * Motor da "Frase do dia" da Início da cliente.
 *
 * Regras:
 * - O dia é o de Brasília (America/Sao_Paulo), não o do aparelho.
 * - Datas especiais (Ano Novo, Dia da Mulher, Dia das Mães...) têm frase própria.
 * - No dia 1 de cada mês aparece a frase daquele mês.
 * - Nos demais dias vale o tema do dia da semana; dentro do tema a frase gira
 *   semana a semana, então a mesma segunda só repete depois de percorrer todas
 *   as frases de segunda.
 * - Todas as frases do catálogo são diferentes entre si, então dois dias
 *   seguidos nunca mostram a mesma mensagem (coberto por teste).
 *
 * Para editar o conteúdo, mexa só nos catálogos abaixo. Marque o trecho de
 * destaque entre asteriscos: "Disciplina hoje, *resultados sempre*."
 * Tom Sra. Luck: acolhedor, confiante e responsável. Nada de promessa de
 * resultado estético, pressão ou comparação de corpos.
 */

export interface FraseDoDia {
  /** Frase com o destaque entre asteriscos. */
  texto: string;
  /** Rótulo do dia exibido no cartão (ex.: "Terça de constância"). */
  tema: string;
  /** Data de referência no formato AAAA-MM-DD (fuso de Brasília). */
  data: string;
  origem: "especial" | "mes" | "semana";
}

export interface DiaLocal {
  ano: number;
  mes: number;
  dia: number;
  /** 0 = domingo ... 6 = sábado. */
  diaSemana: number;
}

export const FUSO_SRA_LUCK = "America/Sao_Paulo";

export const TEMAS_SEMANA: { tema: string; frases: string[] }[] = [
  {
    tema: "Domingo de pausa",
    frases: [
      "Domingo é para respirar fundo e *sonhar de novo*.",
      "Pausar também é *continuar*.",
      "Agradeça pelo caminho: ele está *te levando longe*.",
      "Recarregue as energias. A semana que vem é *mais um passo*.",
      "Sonhe grande, planeje com calma e *viva cada etapa*.",
      "O descanso de hoje prepara *as conquistas de amanhã*.",
      "Tire um momento para imaginar o seu *sonho realizado*.",
      "Planejar é cuidar do seu *futuro com carinho*.",
    ],
  },
  {
    tema: "Segunda de recomeço",
    frases: [
      "Semana nova, mesmo sonho. *Um passo de cada vez* leva você até ele.",
      "Todo grande resultado começa com um *plano bem feito*.",
      "Comece a semana lembrando por que você *começou*.",
      "Planejar é a forma mais bonita de dizer *eu vou conseguir*.",
      "Segunda-feira é página em branco: escreva nela o seu *próximo passo*.",
      "O seu sonho não precisa de pressa. Precisa de *direção*.",
      "Quem se organiza hoje *realiza amanhã*.",
      "Começar a semana com foco já é *metade do caminho*.",
    ],
  },
  {
    tema: "Terça de constância",
    frases: [
      "Disciplina hoje, *resultados sempre*.",
      "Não é sobre fazer muito. É sobre *não parar*.",
      "Cada parcela em dia é um *tijolo* do seu sonho.",
      "Constância vence a pressa. *Sempre*.",
      "Pequenos compromissos cumpridos constroem *grandes conquistas*.",
      "O que você repete todos os dias vira *o seu resultado*.",
      "Firmeza nos detalhes, *leveza no caminho*.",
      "Ser constante é um ato de *amor por você mesma*.",
    ],
  },
  {
    tema: "Quarta de foco",
    frases: [
      "Meio da semana, e você *continua firme*. Isso é força.",
      "Olhe para trás e veja: você já *avançou muito*.",
      "Foco no que depende de você. *O resto se organiza*.",
      "Cada etapa vencida deixa o seu sonho *mais perto*.",
      "O caminho fica mais leve quando você sabe *para onde vai*.",
      "Progresso não faz barulho, mas *aparece no resultado*.",
      "Hoje é um bom dia para *acreditar no processo*.",
      "Você não está atrasada. Está *no seu tempo*.",
    ],
  },
  {
    tema: "Quinta de confiança",
    frases: [
      "Confie no caminho que você *escolheu construir*.",
      "Você não está sozinha: a Sra. Luck *caminha com você*.",
      "Acreditar em si é o primeiro passo de *toda transformação*.",
      "Segurança vem de saber que cada detalhe foi *bem planejado*.",
      "Seu sonho merece *responsabilidade e carinho*. Você também.",
      "A confiança cresce a cada *promessa cumprida consigo mesma*.",
      "Quem planeja com calma *decide com segurança*.",
      "Você é capaz de *muito mais* do que imagina.",
    ],
  },
  {
    tema: "Sexta de conquista",
    frases: [
      "Chegou sexta: celebre *cada passo* que você deu esta semana.",
      "Pequenas vitórias também merecem *ser comemoradas*.",
      "Mais uma semana de compromisso com o seu sonho. *Orgulhe-se*.",
      "O seu esforço de hoje é a *conquista* de amanhã.",
      "Cada semana cumprida é uma *vitória silenciosa*.",
      "Sonho planejado é *sonho realizado*.",
      "Feche a semana com gratidão pelo *caminho percorrido*.",
      "Você fez a sua parte. *Isso é disciplina*.",
    ],
  },
  {
    tema: "Sábado de cuidado",
    frases: [
      "Cuidar de você também faz *parte do plano*.",
      "Sábado é dia de se olhar com *mais carinho*.",
      "Autocuidado não é luxo. É *prioridade*.",
      "Faça hoje algo que deixe o seu dia *mais leve*.",
      "Se sentir bem é um *direito seu*. Nunca esqueça disso.",
      "O seu bem-estar é o *melhor investimento* que existe.",
      "Descanse, respire e *reconheça o quanto já caminhou*.",
      "Você merece se sentir *bem novamente*.",
    ],
  },
];

/** Dia 1 de cada mês (índice 0 = janeiro; o 1º de janeiro usa a frase especial de Ano Novo). */
export const FRASES_MES: string[] = [
  "Janeiro começa com *um plano de verdade* para o seu sonho.",
  "Fevereiro chegou: mantenha o *ritmo* que você começou.",
  "Março, mês das mulheres: celebre *a mulher que você está se tornando*.",
  "Abril começa hoje. Renove o *compromisso com você*.",
  "Maio chegou: que seja um mês de *cuidado e conquista*.",
  "Junho começa: veja o quanto você já *construiu* este ano.",
  "Julho começa: segundo semestre, *mesmo foco*.",
  "Agosto chegou: persistência é o que *transforma o ano*.",
  "Setembro, mês de florescer: o seu sonho também *está crescendo*.",
  "Outubro Rosa: cuidar de si também é *prevenção e amor*.",
  "Novembro começa: a reta final do ano é feita de *constância*.",
  "Dezembro chegou: olhe com orgulho para *tudo o que você construiu*.",
];

interface DataEspecial {
  tema: string;
  texto: string;
  /** Diz se a data é especial naquele dia. */
  cai: (d: DiaLocal) => boolean;
}

const diaFixo = (mes: number, dia: number) => (d: DiaLocal) => d.mes === mes && d.dia === dia;
/** N-ésimo domingo do mês (ex.: Dia das Mães = 2º domingo de maio). */
const domingoDoMes = (mes: number, n: number) => (d: DiaLocal) =>
  d.mes === mes && d.diaSemana === 0 && Math.ceil(d.dia / 7) === n;

export const DATAS_ESPECIAIS: DataEspecial[] = [
  { tema: "Feliz Ano Novo", texto: "Ano novo, sonho de sempre: agora com *um caminho planejado*.", cai: diaFixo(1, 1) },
  { tema: "Dia da Mulher", texto: "Hoje celebramos você: *forte, sonhadora e dona das suas escolhas*.", cai: diaFixo(3, 8) },
  { tema: "Dia das Mães", texto: "Quem cuida de todos também merece *ser cuidada*.", cai: domingoDoMes(5, 2) },
  { tema: "Dia dos Namorados", texto: "O amor mais importante começa *por você mesma*.", cai: diaFixo(6, 12) },
  { tema: "Dia do Cliente", texto: "Obrigada por confiar o seu sonho à *Sra. Luck*.", cai: diaFixo(9, 15) },
  { tema: "Véspera de Natal", texto: "Que a sua noite seja leve e cheia de *gratidão pelo caminho*.", cai: diaFixo(12, 24) },
  { tema: "Feliz Natal", texto: "Natal é tempo de celebrar os sonhos que estão *virando realidade*.", cai: diaFixo(12, 25) },
  { tema: "Último dia do ano", texto: "Fecha-se um ano, abre-se um *novo capítulo* do seu sonho.", cai: diaFixo(12, 31) },
];

const DIAS_SEMANA_EN: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Data de hoje no fuso da Sra. Luck, independente do fuso do aparelho. */
export function diaLocal(agora: Date, fuso: string = FUSO_SRA_LUCK): DiaLocal {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: fuso, year: "numeric", month: "numeric", day: "numeric", weekday: "short" }).formatToParts(agora);
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return { ano: Number(valor("year")), mes: Number(valor("month")), dia: Number(valor("day")), diaSemana: DIAS_SEMANA_EN[valor("weekday")] ?? 0 };
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");

export function fraseDoDia(agora: Date = new Date(), fuso: string = FUSO_SRA_LUCK): FraseDoDia {
  const d = diaLocal(agora, fuso);
  const data = `${d.ano}-${doisDigitos(d.mes)}-${doisDigitos(d.dia)}`;

  const especial = DATAS_ESPECIAIS.find((e) => e.cai(d));
  if (especial) return { texto: especial.texto, tema: especial.tema, data, origem: "especial" };

  if (d.dia === 1) return { texto: FRASES_MES[d.mes - 1], tema: "Mês novo", data, origem: "mes" };

  const { tema, frases } = TEMAS_SEMANA[d.diaSemana];
  // Semanas corridas desde 1970 (em dias de calendário, sem efeito de horário de verão).
  const semana = Math.floor(Date.UTC(d.ano, d.mes - 1, d.dia) / 86_400_000 / 7);
  return { texto: frases[semana % frases.length], tema, data, origem: "semana" };
}

/** Separa a frase em trechos normais e de destaque (marcados com asteriscos). */
export function trechosDaFrase(texto: string): { texto: string; destaque: boolean }[] {
  return texto
    .split(/(\*[^*]+\*)/g)
    .filter(Boolean)
    .map((t) => (t.startsWith("*") && t.endsWith("*") ? { texto: t.slice(1, -1), destaque: true } : { texto: t, destaque: false }));
}
