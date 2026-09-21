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

export function getAppAccessRequirements(input: AppAccessRequirementsInput): AppAccessRequirements {
  const hasName = Boolean(input.name?.trim());
  const hasCpf = Boolean(input.cpf?.trim()) && cpfValido(input.cpf ?? "");
  const hasBirthDate = Boolean(input.birthDate?.trim());
  const hasFinancial = Number(input.installmentCount ?? 0) > 0;

  const missing: AppAccessRequirementKey[] = [];
  if (!hasName) missing.push("nome");
  if (!hasCpf) missing.push("cpf");
  if (!hasBirthDate) missing.push("data_nascimento");
  if (!hasFinancial) missing.push("financeiro");

  return { hasName, hasCpf, hasBirthDate, hasFinancial, canRelease: missing.length === 0, missing };
}
