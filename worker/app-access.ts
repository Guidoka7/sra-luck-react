import { hojeSaoPaulo } from "../src/lib/dataCivil";
export type AppAccessRequirementKey = "nome" | "cpf" | "data_nascimento" | "financeiro";

export interface AppAccessRequirementsInput {
  name?: string | null;
  cpf?: string | null;
  birthDate?: string | null;
  installmentCount?: number | null;
}

export interface AppAccessRequirements {
  hasName: boolean;
  hasCpf: boolean;
  hasBirthDate: boolean;
  hasFinancial: boolean;
  canRelease: boolean;
  missing: AppAccessRequirementKey[];
}

export function cpfValido(valorBruto: string): boolean {
  const cpf = String(valorBruto ?? "").replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const digito = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return digito(cpf.slice(0, 9), 10) === Number(cpf[9])
    && digito(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

const DATA_NASCIMENTO_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function dataIsoReal(valor: string): boolean {
  const m = DATA_NASCIMENTO_ISO.exec(valor);
  if (!m) return false;
  const ano = Number(m[1]), mes = Number(m[2]), dia = Number(m[3]);
  if (ano < 1 || mes < 1 || mes > 12 || dia < 1) return false;
  const bissexto = ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0);
  const diasMes = [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return dia <= diasMes[mes - 1];
}

/** Data de nascimento persistida em ISO (AAAA-MM-DD), existente e nunca futura. */
export function dataNascimentoValida(valorBruto: string | null | undefined, hojeIso = hojeSaoPaulo()): boolean {
  const valor = String(valorBruto ?? "").trim();
  if (!dataIsoReal(valor) || !dataIsoReal(hojeIso)) return false;
  return valor <= hojeIso;
}

export function getAppAccessRequirements(input: AppAccessRequirementsInput, hojeIso?: string): AppAccessRequirements {
  const hasName = Boolean(input.name?.trim());
  const hasCpf = Boolean(input.cpf?.trim()) && cpfValido(input.cpf ?? "");
  const hasBirthDate = dataNascimentoValida(input.birthDate, hojeIso);
  const hasFinancial = Number(input.installmentCount ?? 0) > 0;

  const missing: AppAccessRequirementKey[] = [];
  if (!hasName) missing.push("nome");
  if (!hasCpf) missing.push("cpf");
  if (!hasBirthDate) missing.push("data_nascimento");
  if (!hasFinancial) missing.push("financeiro");

  return { hasName, hasCpf, hasBirthDate, hasFinancial, canRelease: missing.length === 0, missing };
}
