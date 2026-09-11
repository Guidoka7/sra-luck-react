const TIME_ZONE = "America/Sao_Paulo";

export const PRAZO_LIBERACAO_CIRURGICA_DIAS_UTEIS = 5;

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

export function adicionarDiasUteis(dataIso: string, dias: number): string {
  const match = dataIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("DATA_INVALIDA");
  const data = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(data.getTime())) throw new Error("DATA_INVALIDA");
  let adicionados = 0;
  while (adicionados < Math.max(0, dias)) {
    data.setUTCDate(data.getUTCDate() + 1);
    const diaSemana = data.getUTCDay();
    if (diaSemana !== 0 && diaSemana !== 6) adicionados += 1;
  }
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}-${String(data.getUTCDate()).padStart(2, "0")}`;
}

export function calcularLiberacaoCirurgica(
  termosAssinadosEm: string | null | undefined,
  custeioConfirmadoEm: string | null | undefined,
): string | null {
  const termos = dataSaoPaulo(termosAssinadosEm);
  const quitacao = dataSaoPaulo(custeioConfirmadoEm);
  if (!termos || !quitacao) return null;
  const base = termos >= quitacao ? termos : quitacao;
  return adicionarDiasUteis(base, PRAZO_LIBERACAO_CIRURGICA_DIAS_UTEIS);
}
