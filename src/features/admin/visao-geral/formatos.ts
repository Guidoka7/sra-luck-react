const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const MOEDA_INTEIRA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const NUMERO = new Intl.NumberFormat("pt-BR");

export function moeda(valor: number) {
  return MOEDA.format(Number.isFinite(valor) ? valor : 0);
}

/** Valor de destaque: sem centavos a partir de R$ 10 mil. */
export function moedaDestaque(valor: number) {
  const v = Number.isFinite(valor) ? valor : 0;
  return Math.abs(v) >= 10_000 ? MOEDA_INTEIRA.format(v) : MOEDA.format(v);
}

/** Rótulo curto de eixo: R$ 950 · R$ 12 mil · R$ 1,2 mi. */
export function moedaEixo(valor: number) {
  if (valor >= 1_000_000) return `R$ ${(valor / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (valor >= 1_000) return `R$ ${(valor / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: valor >= 10_000 ? 0 : 1 })} mil`;
  return `R$ ${Math.round(valor)}`;
}

export function numero(valor: number) {
  return NUMERO.format(valor);
}

export function plural(n: number, um: string, varios: string) {
  return `${numero(n)} ${n === 1 ? um : varios}`;
}

function dataLocal(iso: string) {
  return new Date(`${iso.slice(0, 10)}T12:00:00`);
}

export function dataPorExtenso(iso: string) {
  const texto = dataLocal(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** "Hoje", "Amanhã" ou "Qua, 30/09". */
export function rotuloDia(iso: string, hoje: string) {
  const diff = Math.round((dataLocal(iso).getTime() - dataLocal(hoje).getTime()) / 86_400_000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  const d = dataLocal(iso);
  const semana = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  return `${semana.charAt(0).toUpperCase()}${semana.slice(1)}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export function horaMinuto(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function percentual(valor: number) {
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}
