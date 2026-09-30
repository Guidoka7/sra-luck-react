/**
 * Chaves de comparação de contato (mesma pessoa): telefone (DDD + número), CPF e e-mail.
 * Usadas pela importação (duplicidade) e pelo espelho do RD (cadastros da mesma pessoa).
 */
import { stringValue } from "./rd-station-readonly";

/**
 * Chave do telefone brasileiro: DDD + número (11 dígitos no celular, 10 no fixo).
 * Aceita +55, 0055, zero de longa distância, código de operadora (0 + 2 dígitos) e o
 * celular antigo de 8 dígitos (ganha o 9). Sem DDD não há chave: número local é ambíguo.
 */
export function chaveTelefone(bruto: unknown): string | null {
  let d = stringValue(bruto).replace(/\D/g, "");
  if (d.startsWith("0")) {
    d = d.replace(/^0+/, "");
    // 0 + operadora (2 dígitos) + DDD + número.
    if (!d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  }
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (!/^[1-9][0-9]/.test(d)) return null;
  if (d.length === 11) return d;
  // Celular no formato antigo (8 dígitos começando com 6–9) ganha o 9; fixo (2–5) fica como está.
  if (d.length === 10) return /^[6-9]$/.test(d[2]) ? `${d.slice(0, 2)}9${d.slice(2)}` : d;
  return null;
}
export const chaveCpf = (v: unknown) => { const d = stringValue(v).replace(/\D/g, ""); return d.length === 11 ? d : null; };
export const chaveEmail = (v: unknown) => { const e = stringValue(v).trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null; };
