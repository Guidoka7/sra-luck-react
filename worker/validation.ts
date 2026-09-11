export const MAX_MONEY_BRL = 50_000_000;
export const MAX_JSON_BODY_BYTES = 128 * 1024;

export class ValidationError extends Error {
  constructor(public readonly userMessage: string, public readonly field?: string) {
    super(userMessage);
    this.name = "ValidationError";
  }
}

export type JsonObject = Record<string, unknown>;

export function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

export function requiredString(value: unknown, field: string, maxLength = 255): string {
  if (typeof value !== "string") throw new ValidationError(`Informe ${field}.`, field);
  const normalized = value.trim();
  if (!normalized) throw new ValidationError(`Informe ${field}.`, field);
  if (normalized.length > maxLength) throw new ValidationError(`${field} ultrapassa o tamanho permitido.`, field);
  return normalized;
}

export function optionalString(value: unknown, field: string, maxLength = 255): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, field, maxLength);
}

export function normalizeCpf(value: unknown): string {
  const cpf = String(value ?? "").replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) throw new ValidationError("Informe um CPF válido.", "cpf");
  const digits = cpf.split("").map(Number);
  const calculate = (length: number): number => {
    const total = digits.slice(0, length).reduce((sum, digit, index) => sum + digit * (length + 1 - index), 0);
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  if (calculate(9) !== digits[9] || calculate(10) !== digits[10]) throw new ValidationError("Informe um CPF válido.", "cpf");
  return cpf;
}

export function validateEmail(value: unknown, field = "e-mail"): string {
  const email = requiredString(value, field, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email)) throw new ValidationError("Informe um e-mail válido.", field);
  return email;
}

export function validateUuid(value: unknown, field = "identificador"): string {
  const id = requiredString(value, field, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new ValidationError(`${field} é inválido.`, field);
  }
  return id;
}

export function validateMoney(value: unknown, field = "valor", max = MAX_MONEY_BRL): number {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(number) || number < 0) throw new ValidationError(`${field} deve ser um valor numérico válido.`, field);
  if (number > max) throw new ValidationError(`${field} ultrapassa o limite permitido de R$ ${max.toLocaleString("pt-BR")}.`, field);
  return Math.round(number * 100) / 100;
}

export function validatePercentage(value: unknown, field = "percentual"): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new ValidationError(`${field} deve estar entre 0 e 100.`, field);
  return Math.round(number * 100) / 100;
}

export function validateIsoDate(value: unknown, field = "data", options: { allowPast?: boolean } = {}): string {
  const date = requiredString(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError(`Informe ${field} no formato AAAA-MM-DD.`, field);
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    throw new ValidationError(`Informe uma ${field} válida.`, field);
  }
  if (!options.allowPast) {
    const today = new Date();
    const todayIso = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
    if (date < todayIso) throw new ValidationError(`${field} não pode estar no passado.`, field);
  }
  return date;
}

export function validateBirthDate(value: unknown): string {
  const raw = requiredString(value, "data de nascimento", 10);
  let normalized = raw;
  const br = raw.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  if (br) normalized = `${br[3]}-${br[2]}-${br[1]}`;
  const date = validateIsoDate(normalized, "data de nascimento", { allowPast: true });
  const today = new Date().toISOString().slice(0, 10);
  if (date >= today) throw new ValidationError("Informe uma data de nascimento válida.", "data de nascimento");
  return date;
}

export function validateInteger(value: unknown, field: string, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new ValidationError(`${field} deve estar entre ${min} e ${max}.`, field);
  }
  return number;
}

export async function parseJsonObject(request: Request): Promise<JsonObject> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_JSON_BODY_BYTES) throw new ValidationError("A requisição é maior que o limite permitido.");
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) throw new ValidationError("Envie os dados no formato JSON.");
  let parsed: unknown;
  try { parsed = await request.json(); } catch { throw new ValidationError("Os dados enviados estão em um formato inválido."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ValidationError("Os dados enviados são inválidos.");
  return parsed as JsonObject;
}
