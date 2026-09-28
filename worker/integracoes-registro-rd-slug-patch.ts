import { ESQUEMAS_CONFIG } from "./integracoes-registro";

type Json = Record<string, any>;
type Resultado = { ok: true; config: any } | { ok: false; erro: string };

const CHAVE_PATCH = "__sra_rd_slug_hifen_patch_v1__";
const FONTE_RD_REAL = /^(deal|contact):[a-z0-9_-]{1,100}$/;
const FONTE_RD_ANTIGA = /^(deal|contact):[a-z0-9_]{1,60}$/;

function objeto(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Json : null;
}

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function prepararFonte(valor: unknown, mapa: Map<string, string>, contador: { n: number }) {
  if (typeof valor !== "string" || !FONTE_RD_REAL.test(valor) || FONTE_RD_ANTIGA.test(valor)) return valor;
  const entidade = valor.startsWith("contact:") ? "contact" : "deal";
  const placeholder = `${entidade}:rd_slug_patch_${contador.n++}`;
  mapa.set(placeholder, valor);
  return placeholder;
}

function prepararMapa(mapa: unknown, traducoes: Map<string, string>, contador: { n: number }) {
  const m = objeto(mapa);
  if (!m) return;
  for (const chave of Object.keys(m)) m[chave] = prepararFonte(m[chave], traducoes, contador);
}

function prepararConfig(bruto: unknown) {
  const copia = cloneJson(bruto);
  const raiz = objeto(copia);
  const traducoes = new Map<string, string>();
  const contador = { n: 0 };
  if (!raiz) return { copia, traducoes };

  prepararMapa(raiz.mapeamento, traducoes, contador);
  if (Array.isArray(raiz.funis)) {
    for (const brutoFunil of raiz.funis) {
      const funil = objeto(brutoFunil);
      if (!funil) continue;
      prepararMapa(funil.mapeamento, traducoes, contador);
      if (Array.isArray(funil.camposSelecionados)) {
        for (const brutoCampo of funil.camposSelecionados) {
          const campo = objeto(brutoCampo);
          if (campo) campo.fonte = prepararFonte(campo.fonte, traducoes, contador);
        }
      }
    }
  }
  return { copia, traducoes };
}

function restaurarFontes(valor: unknown, traducoes: Map<string, string>): unknown {
  if (typeof valor === "string") return traducoes.get(valor) ?? valor;
  if (Array.isArray(valor)) return valor.map((item) => restaurarFontes(item, traducoes));
  const o = objeto(valor);
  if (!o) return valor;
  for (const chave of Object.keys(o)) o[chave] = restaurarFontes(o[chave], traducoes);
  return o;
}

export function instalarPatchSlugRdComHifen() {
  const global = globalThis as unknown as Record<string, unknown>;
  if (global[CHAVE_PATCH]) return;
  const esquema = ESQUEMAS_CONFIG.rd_station?.importacao as { validar?: (bruto: unknown) => Resultado } | undefined;
  if (!esquema?.validar) return;

  const original = esquema.validar.bind(esquema);
  esquema.validar = (bruto: unknown): Resultado => {
    const { copia, traducoes } = prepararConfig(bruto);
    const resultado = original(copia);
    if (!resultado.ok || traducoes.size === 0) return resultado;
    return { ok: true, config: restaurarFontes(resultado.config, traducoes) };
  };
  global[CHAVE_PATCH] = true;
}

instalarPatchSlugRdComHifen();
