export const FUSO_OPERACIONAL = "America/Sao_Paulo";

const DATA_CIVIL_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function partesDataCivil(iso: string) {
  const match = DATA_CIVIL_RE.exec(String(iso || ""));
  if (!match) return null;
  const ano = Number(match[1]), mes = Number(match[2]), dia = Number(match[3]);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return null;
  return { ano, mes, dia };
}

export function dataCivilValida(iso: string): boolean {
  return partesDataCivil(iso) !== null;
}

export function hojeSaoPaulo(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_OPERACIONAL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

export function adicionarDiasCivil(iso: string, dias: number): string {
  const partes = partesDataCivil(iso);
  if (!partes || !Number.isInteger(dias)) throw new Error("DATA_CIVIL_INVALIDA");
  const data = new Date(Date.UTC(partes.ano, partes.mes - 1, partes.dia + dias));
  return data.toISOString().slice(0, 10);
}

export function ordinalDataCivil(iso: string): number {
  const partes = partesDataCivil(iso);
  if (!partes) throw new Error("DATA_CIVIL_INVALIDA");
  return Math.floor(Date.UTC(partes.ano, partes.mes - 1, partes.dia) / 86_400_000);
}

function offsetNoFusoMs(instanteMs: number, timeZone = FUSO_OPERACIONAL) {
  const data = new Date(instanteMs);
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(data);
  const porTipo = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  const comoUtc = Date.UTC(
    Number(porTipo.year), Number(porTipo.month) - 1, Number(porTipo.day),
    Number(porTipo.hour), Number(porTipo.minute), Number(porTipo.second),
  );
  return comoUtc - instanteMs;
}

function meiaNoiteCivilUtc(iso: string) {
  const partes = partesDataCivil(iso);
  if (!partes) throw new Error("DATA_CIVIL_INVALIDA");
  const alvoCivilComoUtc = Date.UTC(partes.ano, partes.mes - 1, partes.dia);
  let instante = alvoCivilComoUtc - offsetNoFusoMs(alvoCivilComoUtc);
  instante = alvoCivilComoUtc - offsetNoFusoMs(instante);
  return new Date(instante).toISOString();
}

export function intervaloDiaOperacionalUtc(iso: string) {
  if (!dataCivilValida(iso)) throw new Error("DATA_CIVIL_INVALIDA");
  return {
    inicio: meiaNoiteCivilUtc(iso),
    fimExclusivo: meiaNoiteCivilUtc(adicionarDiasCivil(iso, 1)),
  };
}
