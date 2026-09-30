/**
 * De onde a cliente veio (fonte, campanha, como ficou sabendo, influencer) — só com dado real do RD.
 *
 * A negociação do funil de contratos muitas vezes não tem a origem preenchida: ela foi registrada
 * na negociação de entrada do lead (funil de vendas/pré-vendas). Por isso a origem é procurada:
 *   1. na própria negociação;
 *   2. nas outras negociações do MESMO contato, em qualquer funil, da mais antiga para a mais nova
 *      (a primeira é o primeiro contato da cliente com a Sra Luck);
 *   3. (busca ampliada, crm-origem-ampliada) nas negociações de OUTROS cadastros de contato do RD
 *      com o mesmo e-mail ou telefone — o lead do formulário costuma ser outro cadastro.
 * Nada é deduzido nem inventado: sem registro no RD, a situação fica "sem_registro_no_rd".
 * Cada valor guarda a negociação de onde veio (id, funil e data), para conferência no Admin.
 */
import { arrayValue, objectValue, stringValue } from "./rd-station-readonly";

type Json = Record<string, any>;

export type CampoOrigem = "fonte" | "campanha" | "como_ficou_sabendo" | "influencer" | "cupom" | "landing_page";
export type OutroContato = { id: string; via: "email" | "telefone" };

export type EvidenciaOrigem = {
  campo: CampoOrigem;
  rotulo: string;
  valor: string;
  /** Valor registrado, mas que não diz de onde a cliente veio (ex.: fonte "Desconhecido"). */
  fraca?: boolean;
  negociacao: {
    id: string; funilId: string | null; funil: string | null; criadaEm: string | null; propria: boolean;
    /** Negociação de outro cadastro de contato no RD com o mesmo e-mail/telefone. */
    outroContato?: OutroContato;
  };
};

export type BuscaAmpliada = {
  em: string;
  /** Outros cadastros de contato do RD com o mesmo e-mail/telefone. */
  contatos: OutroContato[];
  /** Negociações desses contatos lidas. */
  negociacoes: number;
};

export type OrigemCliente = {
  fonte: string | null;
  campanha: string | null;
  comoFicouSabendo: string | null;
  influencer: string | null;
  cupom?: string | null;
  /** Alguma negociação tem respostas do formulário da landing page (campos "-lp"). */
  landingPage?: boolean;
  situacao: "encontrada" | "parcial" | "sem_registro_no_rd" | "sem_contato";
  negociacoesAnalisadas: number;
  evidencias: EvidenciaOrigem[];
  checadoEm: string;
  ampliada?: BuscaAmpliada;
};

type Refs = { fontes?: Map<string, Json>; campanhas?: Map<string, Json>; funis?: Map<string, string> };

/**
 * Campos personalizados da conta que registram a origem. Casam pelo slug do RD
 * ("Como ficou sabendo da Sra Luck?" → como-ficou-sabendo-da-sra-luck; "Nome da influencer"; "Cupom").
 */
const PERSONALIZADOS: { campo: CampoOrigem; rotulo: string; slug: RegExp }[] = [
  { campo: "como_ficou_sabendo", rotulo: "Como ficou sabendo", slug: /^como-(ficou-sabendo|conheceu|soube)/ },
  { campo: "influencer", rotulo: "Influencer", slug: /influenc/ },
  { campo: "cupom", rotulo: "Cupom", slug: /^cupom/ },
];
/** Campos preenchidos só pelo formulário da landing page (procedimento-lp, valor-parcela-lp...). */
const CAMPO_LP = /-lp$/;

/** Registrado, mas sem informação de origem: só vale quando não há nada melhor. */
const NAO_INFORMATIVO = /^(desconhecid[oa]|unknown|\(?not set\)?|\(?none\)?|nenhum[a]?|n[aã]o sei|n[aã]o informad[oa]|sem (origem|fonte|campanha)|-+|\.+)$/i;
/** Resposta negativa no campo de cupom ("Não tenho", "não"): não é cupom. */
const CUPOM_VAZIO = /^(n[aã]o( tenho| possuo| tem)?|nenhum|sem cupom|-+|\.+)$/i;

function texto(v: unknown): string | null {
  if (Array.isArray(v)) return v.map((x) => stringValue(x).trim()).filter(Boolean).join(", ") || null;
  if (v && typeof v === "object") return stringValue((v as Json).name ?? (v as Json).value).trim() || null;
  return stringValue(v).trim() || null;
}

function idDe(deal: Json, campo: "source" | "campaign" | "pipeline"): string | null {
  return stringValue(deal[`${campo}_id`]) || stringValue(objectValue(deal[campo]).id) || null;
}

export const valorNaoInformativo = (v: string | null | undefined) => Boolean(v && NAO_INFORMATIVO.test(v.trim()));

/** Evidências de origem de uma negociação, com os nomes de fonte/campanha/funil já resolvidos. */
export function evidenciasDaNegociacao(deal: Json, refs: Refs, propria: boolean, outroContato?: OutroContato): EvidenciaOrigem[] {
  const funilId = idDe(deal, "pipeline");
  const negociacao = {
    id: stringValue(deal.id), funilId, funil: funilId ? refs.funis?.get(funilId) ?? null : null,
    criadaEm: stringValue(deal.created_at) || null, propria, ...(outroContato ? { outroContato } : {}),
  };
  const out: EvidenciaOrigem[] = [];
  const add = (campo: CampoOrigem, rotulo: string, valor: string) =>
    out.push({ campo, rotulo, valor, ...(valorNaoInformativo(valor) ? { fraca: true } : {}), negociacao });
  const fonteId = idDe(deal, "source");
  const fonte = (fonteId ? texto(refs.fontes?.get(fonteId)?.name) : null) ?? texto(objectValue(deal.source).name);
  if (fonte) add("fonte", "Fonte", fonte);
  const campanhaId = idDe(deal, "campaign");
  const campanha = (campanhaId ? texto(refs.campanhas?.get(campanhaId)?.name) : null) ?? texto(objectValue(deal.campaign).name);
  if (campanha) add("campanha", "Campanha", campanha);
  const cf = objectValue(deal.custom_fields);
  for (const def of PERSONALIZADOS) {
    for (const [slug, valor] of Object.entries(cf)) {
      if (!def.slug.test(slug)) continue;
      const v = texto(valor);
      if (!v || (def.campo === "cupom" && CUPOM_VAZIO.test(v))) continue;
      add(def.campo, def.rotulo, v);
    }
  }
  if (Object.entries(cf).some(([slug, valor]) => CAMPO_LP.test(slug) && texto(valor))) add("landing_page", "Landing page", "Formulário da landing page");
  return out;
}

/**
 * Resume as evidências (já na ordem de prioridade): o primeiro valor informativo de cada campo; um
 * valor fraco ("Desconhecido") só quando é o único registrado.
 */
export function resumirOrigem(evidencias: EvidenciaOrigem[], meta: { negociacoesAnalisadas: number; semContato?: boolean; agora?: string; ampliada?: BuscaAmpliada }): OrigemCliente {
  const unicas = evidencias.filter((e, i) => evidencias.findIndex((x) => x.campo === e.campo && x.valor === e.valor) === i);
  const primeiro = (campo: CampoOrigem) =>
    unicas.find((e) => e.campo === campo && !e.fraca)?.valor ?? unicas.find((e) => e.campo === campo)?.valor ?? null;
  const fonte = primeiro("fonte"), campanha = primeiro("campanha"), comoFicouSabendo = primeiro("como_ficou_sabendo");
  const influencer = primeiro("influencer"), cupom = primeiro("cupom");
  const landingPage = unicas.some((e) => e.campo === "landing_page");
  const informativo = (v: string | null) => Boolean(v && !valorNaoInformativo(v));
  const temFonte = informativo(fonte) || informativo(comoFicouSabendo) || landingPage;
  const temCampanha = informativo(campanha) || informativo(influencer) || informativo(cupom);
  const algum = Boolean(fonte || campanha || comoFicouSabendo || influencer || cupom || landingPage);
  const situacao: OrigemCliente["situacao"] = meta.semContato && !algum ? "sem_contato"
    : !algum ? "sem_registro_no_rd"
      : temFonte && temCampanha ? "encontrada" : "parcial";
  return {
    fonte, campanha, comoFicouSabendo, influencer, cupom, landingPage, situacao,
    negociacoesAnalisadas: meta.negociacoesAnalisadas,
    // Sem repetir o mesmo valor do mesmo campo (a mesma campanha costuma estar em várias negociações).
    evidencias: unicas,
    checadoEm: meta.agora ?? new Date().toISOString(),
    ...(meta.ampliada ? { ampliada: meta.ampliada } : {}),
  };
}

const porData = (a: Json, b: Json) => stringValue(a.created_at).localeCompare(stringValue(b.created_at));

/**
 * Origem da cliente: a própria negociação primeiro; o que faltar vem da negociação mais antiga
 * do mesmo contato que tenha o dado.
 */
export function montarOrigem(propria: Json, outras: Json[], refs: Refs, opcoes: { semContato?: boolean; agora?: string } = {}): OrigemCliente {
  const idPropria = stringValue(propria.id);
  const demais = outras.filter((d) => stringValue(d.id) && stringValue(d.id) !== idPropria).sort(porData);
  const evidencias = [
    ...evidenciasDaNegociacao(propria, refs, true),
    ...demais.flatMap((d) => evidenciasDaNegociacao(d, refs, false)),
  ];
  return resumirOrigem(evidencias, { negociacoesAnalisadas: 1 + demais.length, semContato: opcoes.semContato, agora: opcoes.agora });
}

const deOutroContato = (e: EvidenciaOrigem) => Boolean(e.negociacao?.outroContato);

/**
 * Soma à origem as negociações de outros cadastros de contato (mesmo e-mail/telefone), depois das
 * do próprio contato: o cadastro da cliente sempre tem prioridade. Refazer a busca substitui o
 * resultado anterior dela.
 */
export function ampliarOrigem(base: OrigemCliente, encontradas: { deal: Json; contato: OutroContato }[], refs: Refs, busca: { em: string; contatos: OutroContato[] }): OrigemCliente {
  const proprias = (base.evidencias ?? []).filter((e) => !deOutroContato(e));
  const jaVistas = new Set(proprias.map((e) => e.negociacao.id));
  const novas = encontradas
    .filter((x) => stringValue(x.deal.id) && !jaVistas.has(stringValue(x.deal.id)))
    .filter((x, i, arr) => arr.findIndex((y) => stringValue(y.deal.id) === stringValue(x.deal.id)) === i)
    .sort((a, b) => porData(a.deal, b.deal));
  const analisadasProprias = Math.max(1, base.negociacoesAnalisadas - (base.ampliada?.negociacoes ?? 0));
  return resumirOrigem([...proprias, ...novas.flatMap((x) => evidenciasDaNegociacao(x.deal, refs, false, x.contato))], {
    negociacoesAnalisadas: analisadasProprias + novas.length, semContato: base.situacao === "sem_contato",
    agora: busca.em, ampliada: { em: busca.em, contatos: busca.contatos, negociacoes: novas.length },
  });
}

/**
 * A importação recalcula a origem a cada passada só com o próprio contato. Para não perder o que a
 * busca ampliada achou, as evidências de outros contatos guardadas antes são somadas de novo.
 */
export function manterAmpliada(nova: OrigemCliente, anterior: OrigemCliente | null | undefined): OrigemCliente {
  if (!anterior?.ampliada) return nova;
  const jaVistas = new Set(nova.evidencias.map((e) => e.negociacao.id));
  const deOutros = (anterior.evidencias ?? []).filter((e) => deOutroContato(e) && !jaVistas.has(e.negociacao.id));
  return resumirOrigem([...nova.evidencias, ...deOutros], {
    negociacoesAnalisadas: nova.negociacoesAnalisadas + (anterior.ampliada.negociacoes ?? 0),
    semContato: nova.situacao === "sem_contato", agora: nova.checadoEm, ampliada: anterior.ampliada,
  });
}

// ------------------------------------------------------------------ colunas da venda

/** Texto gravado quando o RD não tem o dado: nunca em branco, nunca inventado. */
export const SEM_REGISTRO_ORIGEM = "Não registrada no RD";
const DESCRITIVO = /(sem campanha paga|n[aã]o registrad[ao] no RD)\)?$/i;
/** Valor que só descreve a falta de registro (é trocado pelo dado real quando ele aparecer). */
export const valorDescritivoDeOrigem = (v: unknown) => typeof v === "string" && DESCRITIVO.test(v.trim());

const normalizar = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

/**
 * Sem campanha registrada, diz o que o RD mostra sobre o canal, com as palavras do próprio
 * registro: orgânico e indicação não têm campanha paga; tráfego pago sem campanha é
 * "campanha não registrada no RD".
 */
export function campanhaDescritiva(o: OrigemCliente): string {
  const canais = [o.comoFicouSabendo, o.fonte].filter((v): v is string => Boolean(v && !valorNaoInformativo(v))).map(normalizar);
  const tem = (re: RegExp) => canais.some((c) => re.test(c));
  if (tem(/INFLUENC/)) return "Influencer (nome não registrado no RD)";
  if (tem(/INDICA/)) return "Indicação — sem campanha paga";
  if (tem(/TRAFEGO PAGO META|FACEBOOK ADS|\bMETA\b/)) return "Tráfego pago Meta — campanha não registrada no RD";
  if (tem(/TRAFEGO PAGO GOOGLE|GOOGLE ADS/)) return "Tráfego pago Google — campanha não registrada no RD";
  if (tem(/TRAFEGO PAGO|BUSCA PAGA|\bPAID\b|\bPAGO\b/)) return "Tráfego pago — campanha não registrada no RD";
  if (tem(/ORGANIC|^SOCIAL\b|REDES SOCIAIS/)) return "Orgânico — sem campanha paga";
  if (tem(/TRAFEGO DIRETO/)) return "Tráfego direto — sem campanha paga";
  if (tem(/^REFERENCIA\b/)) return "Referência de site — sem campanha paga";
  if (tem(/^EMAIL\b/)) return "E-mail — campanha não registrada no RD";
  if (tem(/TELEFONE/)) return "Contato por telefone — sem campanha paga";
  if (o.landingPage) return "Landing page — campanha não registrada no RD";
  return "Campanha não registrada no RD";
}

/**
 * Origem e campanha (texto) para as colunas da venda. Depois que o RD foi consultado, nunca ficam
 * em branco: o dado real quando existe; senão, a descrição do que o RD registra.
 */
export function origemParaColunas(o: OrigemCliente): { origem: string; campanha: string } {
  const bom = (v: string | null | undefined) => (v && !valorNaoInformativo(v) ? v : null);
  const origem = bom(o.fonte) ?? bom(o.comoFicouSabendo) ?? (o.landingPage ? "Landing page (formulário do site)" : null)
    ?? o.fonte ?? o.comoFicouSabendo ?? SEM_REGISTRO_ORIGEM;
  const campanha = bom(o.campanha)
    ?? (bom(o.influencer) ? `Influencer: ${o.influencer}` : null)
    ?? (bom(o.cupom) ? `Cupom: ${o.cupom}` : null)
    ?? (o.situacao === "sem_registro_no_rd" || o.situacao === "sem_contato" ? SEM_REGISTRO_ORIGEM : campanhaDescritiva(o));
  return { origem, campanha };
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

// ------------------------------------------------------------------ busca por e-mail/telefone

/**
 * Formas como o mesmo telefone aparece nos contatos do RD (a equipe e os formulários gravam de
 * jeitos diferentes), das mais comuns na conta para as menos: 556184035758, 5561984035758,
 * (61) 98403-5758, +55 (61) 98403-5758, +5561984035758, 61984035758...
 * `chave` é a chave de telefone da importação (DDD + número, 10 ou 11 dígitos).
 */
export function variacoesTelefone(chave: string): string[] {
  if (!/^\d{10,11}$/.test(chave)) return [];
  const ddd = chave.slice(0, 2);
  const numero = chave.slice(2);
  const com9 = numero.length === 9 ? numero : null;
  const sem9 = numero.length === 9 ? numero.slice(1) : numero;
  const traco = (n: string) => (n.length === 9 ? `${n.slice(0, 5)}-${n.slice(5)}` : `${n.slice(0, 4)}-${n.slice(4)}`);
  const principal = com9 ?? sem9;
  const out = [
    `55${ddd}${sem9}`, ...(com9 ? [`55${ddd}${com9}`] : []),
    `(${ddd}) ${traco(principal)}`, `+55 (${ddd}) ${traco(principal)}`, `+55${ddd}${principal}`, `${ddd}${principal}`,
    ...(com9 ? [`+55${ddd}${sem9}`, `${ddd}${sem9}`, `(${ddd}) ${traco(sem9)}`, `+55 (${ddd}) ${traco(sem9)}`] : []),
  ];
  return [...new Set(out)];
}

export function emailsValidos(lista: unknown[]): string[] {
  return [...new Set(lista.map((e) => stringValue(typeof e === "object" && e ? (e as Json).email : e).trim().toLowerCase())
    .filter((e) => /^[^\s@"(),]+@[^\s@"(),]+\.[^\s@"(),]+$/.test(e)))];
}
