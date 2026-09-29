/**
 * De onde a cliente veio (fonte, campanha, como ficou sabendo, influencer) — só com dado real do RD.
 *
 * A negociação do funil de contratos muitas vezes não tem a origem preenchida: ela foi registrada
 * na negociação de entrada do lead (funil de vendas/pré-vendas). Por isso a origem é procurada:
 *   1. na própria negociação;
 *   2. nas outras negociações do MESMO contato, em qualquer funil, da mais antiga para a mais nova
 *      (a primeira é o primeiro contato da cliente com a Sra Luck).
 * Nada é deduzido nem inventado: sem registro no RD, a situação fica "sem_registro_no_rd".
 * Cada valor guarda a negociação de onde veio (id, funil e data), para conferência no Admin.
 */
import { arrayValue, objectValue, stringValue } from "./rd-station-readonly";

type Json = Record<string, any>;

export type CampoOrigem = "fonte" | "campanha" | "como_ficou_sabendo" | "influencer";

export type EvidenciaOrigem = {
  campo: CampoOrigem;
  rotulo: string;
  valor: string;
  negociacao: { id: string; funilId: string | null; funil: string | null; criadaEm: string | null; propria: boolean };
};

export type OrigemCliente = {
  fonte: string | null;
  campanha: string | null;
  comoFicouSabendo: string | null;
  influencer: string | null;
  situacao: "encontrada" | "parcial" | "sem_registro_no_rd" | "sem_contato";
  negociacoesAnalisadas: number;
  evidencias: EvidenciaOrigem[];
  checadoEm: string;
};

/**
 * Campos personalizados da conta que registram a origem. Casam pelo slug do RD
 * ("Como ficou sabendo da Sra Luck?" → como-ficou-sabendo-da-sra-luck; "Nome da influencer").
 */
const PERSONALIZADOS: { campo: CampoOrigem; rotulo: string; slug: RegExp }[] = [
  { campo: "como_ficou_sabendo", rotulo: "Como ficou sabendo", slug: /^como-(ficou-sabendo|conheceu|soube)/ },
  { campo: "influencer", rotulo: "Influencer", slug: /influenc/ },
];

function texto(v: unknown): string | null {
  if (Array.isArray(v)) return v.map((x) => stringValue(x).trim()).filter(Boolean).join(", ") || null;
  if (v && typeof v === "object") return stringValue((v as Json).name ?? (v as Json).value).trim() || null;
  return stringValue(v).trim() || null;
}

function idDe(deal: Json, campo: "source" | "campaign" | "pipeline"): string | null {
  return stringValue(deal[`${campo}_id`]) || stringValue(objectValue(deal[campo]).id) || null;
}

/** Evidências de origem de uma negociação, com os nomes de fonte/campanha/funil já resolvidos. */
export function evidenciasDaNegociacao(deal: Json, refs: { fontes?: Map<string, Json>; campanhas?: Map<string, Json>; funis?: Map<string, string> }, propria: boolean): EvidenciaOrigem[] {
  const funilId = idDe(deal, "pipeline");
  const negociacao = {
    id: stringValue(deal.id), funilId, funil: funilId ? refs.funis?.get(funilId) ?? null : null,
    criadaEm: stringValue(deal.created_at) || null, propria,
  };
  const out: EvidenciaOrigem[] = [];
  const fonteId = idDe(deal, "source");
  const fonte = (fonteId ? texto(refs.fontes?.get(fonteId)?.name) : null) ?? texto(objectValue(deal.source).name);
  if (fonte) out.push({ campo: "fonte", rotulo: "Fonte", valor: fonte, negociacao });
  const campanhaId = idDe(deal, "campaign");
  const campanha = (campanhaId ? texto(refs.campanhas?.get(campanhaId)?.name) : null) ?? texto(objectValue(deal.campaign).name);
  if (campanha) out.push({ campo: "campanha", rotulo: "Campanha", valor: campanha, negociacao });
  const cf = objectValue(deal.custom_fields);
  for (const def of PERSONALIZADOS) {
    for (const [slug, valor] of Object.entries(cf)) {
      if (!def.slug.test(slug)) continue;
      const v = texto(valor);
      if (v) out.push({ campo: def.campo, rotulo: def.rotulo, valor: v, negociacao });
    }
  }
  return out;
}

/**
 * Origem da cliente: a própria negociação primeiro; o que faltar vem da negociação mais antiga
 * do mesmo contato que tenha o dado.
 */
export function montarOrigem(propria: Json, outras: Json[], refs: { fontes?: Map<string, Json>; campanhas?: Map<string, Json>; funis?: Map<string, string> }, opcoes: { semContato?: boolean; agora?: string } = {}): OrigemCliente {
  const idPropria = stringValue(propria.id);
  const demais = outras.filter((d) => stringValue(d.id) && stringValue(d.id) !== idPropria)
    .sort((a, b) => stringValue(a.created_at).localeCompare(stringValue(b.created_at)));
  const evidencias = [
    ...evidenciasDaNegociacao(propria, refs, true),
    ...demais.flatMap((d) => evidenciasDaNegociacao(d, refs, false)),
  ];
  const primeiro = (campo: CampoOrigem) => evidencias.find((e) => e.campo === campo)?.valor ?? null;
  const fonte = primeiro("fonte"), campanha = primeiro("campanha"), comoFicouSabendo = primeiro("como_ficou_sabendo"), influencer = primeiro("influencer");
  const achados = [fonte, campanha, comoFicouSabendo, influencer].filter(Boolean).length;
  const situacao: OrigemCliente["situacao"] = opcoes.semContato && !achados ? "sem_contato"
    : !achados ? "sem_registro_no_rd"
      : (fonte || comoFicouSabendo) && (campanha || influencer) ? "encontrada" : "parcial";
  return {
    fonte, campanha, comoFicouSabendo, influencer, situacao,
    negociacoesAnalisadas: 1 + demais.length,
    // Sem repetir o mesmo valor do mesmo campo (a mesma campanha costuma estar em várias negociações).
    evidencias: evidencias.filter((e, i) => evidencias.findIndex((x) => x.campo === e.campo && x.valor === e.valor) === i),
    checadoEm: opcoes.agora ?? new Date().toISOString(),
  };
}

/** Origem (texto) e campanha (texto) para as colunas da venda, quando o próprio deal não tem. */
export function origemParaColunas(o: OrigemCliente): { origem: string | null; campanha: string | null } {
  return {
    origem: o.fonte ?? o.comoFicouSabendo,
    campanha: o.campanha ?? (o.influencer ? `Influencer: ${o.influencer}` : null),
  };
}

/** Negociações agrupadas por contato (cada negociação pode ter vários contatos). */
export function agruparPorContato(deals: Json[]): Map<string, Json[]> {
  const mapa = new Map<string, Json[]>();
  for (const d of deals) {
    for (const c of arrayValue(d.contact_ids).map(stringValue).filter(Boolean)) {
      const lista = mapa.get(c) ?? [];
      if (!lista.some((x) => stringValue(x.id) === stringValue(d.id))) lista.push(d);
      mapa.set(c, lista);
    }
  }
  return mapa;
}
