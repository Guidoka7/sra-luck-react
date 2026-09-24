export const FUSO_OPERACIONAL = "America/Sao_Paulo";

export function hojeSaoPaulo(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_OPERACIONAL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

export function adicionarDiasCivil(iso: string, dias: number): string {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("DATA_CIVIL_INVALIDA");
  const data = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + dias));
  return data.toISOString().slice(0, 10);
}

export function ordinalDataCivil(iso: string): number {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("DATA_CIVIL_INVALIDA");
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000);
}
