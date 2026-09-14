const TIME_ZONE = "America/Sao_Paulo";

/**
 * Fase 2 (2026-09-14): a janela de liberação da agenda cirúrgica deixou de
 * ser "5 dias úteis" e passou a ser um PRAZO MÁXIMO de 90 dias corridos.
 * A liberação real pode ocorrer antes, conforme capacidade do mês
 * (configuracoes.meta_orcamento_mensal é só referência de planejamento,
 * nunca trava) — este valor é apenas o teto que os endpoints/telas usam
 * para não deixar a cliente aguardar indefinidamente.
 */
export const PRAZO_MAXIMO_LIBERACAO_CIRURGICA_DIAS_CORRIDOS = 90;

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

export function adicionarDiasCorridos(dataIso: string, dias: number): string {
  const match = dataIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("DATA_INVALIDA");
  const data = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(data.getTime())) throw new Error("DATA_INVALIDA");
  data.setUTCDate(data.getUTCDate() + Math.max(0, dias));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}-${String(data.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Calcula o PRAZO MÁXIMO (teto) da liberação da agenda cirúrgica.
 *
 * Regra vigente (Fase 2): só existe janela quando termos assinados E
 * quitação confirmada já existem — nenhum dos dois isoladamente inicia a
 * contagem. A data-base é a mais recente entre os dois eventos, e o teto é
 * essa data + 90 dias corridos. A liberação real (escolhida pelo admin
 * dentro da capacidade do mês) pode acontecer em qualquer data até esse
 * teto — este valor não é a data automática da cirurgia.
 */
export function calcularLiberacaoCirurgica(
  termosAssinadosEm: string | null | undefined,
  custeioConfirmadoEm: string | null | undefined,
): string | null {
  const termos = dataSaoPaulo(termosAssinadosEm);
  const quitacao = dataSaoPaulo(custeioConfirmadoEm);
  if (!termos || !quitacao) return null;
  const base = termos >= quitacao ? termos : quitacao;
  return adicionarDiasCorridos(base, PRAZO_MAXIMO_LIBERACAO_CIRURGICA_DIAS_CORRIDOS);
}
