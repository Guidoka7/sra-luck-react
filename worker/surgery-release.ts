const TIME_ZONE = "America/Sao_Paulo";

/**
 * V46 (2026-09-21): a janela de liberação da agenda cirúrgica deixou de ser
 * um PRAZO MÁXIMO de 90 dias corridos (Fase 2) e voltou a ser um prazo
 * PADRÃO de 5 dias úteis, com dois ajustes administrativos possíveis:
 *   - extensão manual em dias úteis (+1/+3/+5), acumulada por agendamento;
 *   - liberação manual antecipada, que ignora o prazo calculado.
 * A contagem só começa quando termos assinados E quitação confirmada já
 * existem (nenhum dos dois isoladamente inicia a janela), usando o marco
 * mais recente entre os dois eventos, e começa a valer no PRÓXIMO dia útil
 * após esse marco.
 */
export const PRAZO_PADRAO_LIBERACAO_CIRURGICA_DIAS_UTEIS = 5;

export function dataSaoPaulo(valor: string | Date | null | undefined): string | null {
  if (!valor) return null;
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(data);
  const get = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  const ano = get("year");
  const mes = get("month");
  const dia = get("day");
  return ano && mes && dia ? `${ano}-${mes}-${dia}` : null;
}

export function agoraSaoPaulo() {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "00";
  return {
    data: `${get("year")}-${get("month")}-${get("day")}`,
    hora: `${get("hour")}:${get("minute")}`,
  };
}

function parseDataIso(dataIso: string): Date {
  const match = dataIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("DATA_INVALIDA");
  const data = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(data.getTime())) throw new Error("DATA_INVALIDA");
  return data;
}

function formatarDataIso(data: Date): string {
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}-${String(data.getUTCDate()).padStart(2, "0")}`;
}

export function adicionarDiasCorridos(dataIso: string, dias: number): string {
  const data = parseDataIso(dataIso);
  data.setUTCDate(data.getUTCDate() + Math.max(0, dias));
  return formatarDataIso(data);
}

/** Dia útil = segunda a sexta (não considera feriados). Espelha public.adicionar_dias_uteis (migration_028). */
export function ehDiaUtil(dataIso: string): boolean {
  const diaSemana = parseDataIso(dataIso).getUTCDay();
  return diaSemana !== 0 && diaSemana !== 6;
}

export function adicionarDiasUteis(dataIso: string, dias: number): string {
  const data = parseDataIso(dataIso);
  let adicionados = 0;
  while (adicionados < Math.max(0, dias)) {
    data.setUTCDate(data.getUTCDate() + 1);
    const diaSemana = data.getUTCDay();
    if (diaSemana !== 0 && diaSemana !== 6) adicionados++;
  }
  return formatarDataIso(data);
}

export function proximoDiaUtil(dataIso: string): string {
  return adicionarDiasUteis(dataIso, 1);
}

/**
 * Calcula o prazo PADRÃO (5 dias úteis) da liberação da agenda cirúrgica,
 * sem considerar extensões manuais nem liberação antecipada — essas duas
 * camadas ficam em `calcularPrazoCirurgicoComAjuste`, que é o que os
 * endpoints administrativos devem efetivamente usar.
 *
 * Regra: só existe janela quando termos assinados E quitação confirmada já
 * existem — nenhum dos dois isoladamente inicia a contagem. A data-base é a
 * mais recente entre os dois eventos, e o prazo é essa data-base + 5 dias
 * úteis (a contagem, em termos de exibição, "começa" no próximo dia útil
 * após a data-base — ver `proximoDiaUtil` — mas o prazo final é sempre
 * data-base + 5 dias úteis, sem contar duas vezes o primeiro dia útil).
 */
export function calcularLiberacaoCirurgica(
  termosAssinadosEm: string | null | undefined,
  custeioConfirmadoEm: string | null | undefined,
): string | null {
  const termos = dataSaoPaulo(termosAssinadosEm);
  const quitacao = dataSaoPaulo(custeioConfirmadoEm);
  if (!termos || !quitacao) return null;
  const base = termos >= quitacao ? termos : quitacao;
  return adicionarDiasUteis(base, PRAZO_PADRAO_LIBERACAO_CIRURGICA_DIAS_UTEIS);
}

/**
 * Aplica a extensão manual (em dias úteis, acumulada) por cima do prazo
 * padrão. `diasExtras` vem de `agendamentos.prazo_cirurgico_dias_extras`.
 */
export function calcularPrazoCirurgicoComAjuste(
  termosAssinadosEm: string | null | undefined,
  custeioConfirmadoEm: string | null | undefined,
  diasExtras: number | null | undefined,
): string | null {
  const prazoBase = calcularLiberacaoCirurgica(termosAssinadosEm, custeioConfirmadoEm);
  if (!prazoBase) return null;
  const extras = Math.max(0, Number(diasExtras || 0));
  return extras > 0 ? adicionarDiasUteis(prazoBase, extras) : prazoBase;
}

/**
 * A agenda cirúrgica está liberada quando a liberação manual antecipada foi
 * registrada OU quando a data real (America/Sao_Paulo) já atingiu o prazo
 * calculado (padrão + ajustes). `hojeIso` é injetável para testes; em
 * produção deve vir de `agoraSaoPaulo().data`.
 */
export function agendaCirurgicaLiberada(params: {
  termosAssinadosEm: string | null | undefined;
  custeioConfirmadoEm: string | null | undefined;
  diasExtras: number | null | undefined;
  liberadaManualmenteEm: string | null | undefined;
  hojeIso: string;
}): boolean {
  if (params.liberadaManualmenteEm) return true;
  const prazo = calcularPrazoCirurgicoComAjuste(params.termosAssinadosEm, params.custeioConfirmadoEm, params.diasExtras);
  if (!prazo) return false;
  return params.hojeIso >= prazo;
}
