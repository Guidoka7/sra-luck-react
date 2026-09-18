import { cpfValido } from "./cpf";

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

  return {
    hasName,
    hasCpf,
    hasBirthDate,
    hasFinancial,
    canRelease: missing.length === 0,
    missing,
  };
}

export function shouldShowPlanningFallback(installmentCount: number | null | undefined) {
  return Number(installmentCount ?? 0) <= 0;
}
