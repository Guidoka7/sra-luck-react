/**
 * Fonte e campanha de TODAS as negociações do RD (os 15 funis), só com dado real.
 *
 * Usa o espelho do RD (crm-espelho, migration_122): todas as negociações e todos os contatos.
 * Para cada negociação, a origem é procurada, nesta ordem:
 *   1. na própria negociação;
 *   2. nas outras negociações do mesmo contato, em qualquer funil (a mais antiga primeiro);
 *   3. nas negociações de OUTROS cadastros da mesma pessoa no RD — contatos com o mesmo e-mail ou
 *      o mesmo telefone (a regra de "mesma pessoa" da importação). O lead do anúncio/formulário e o
 *      contato criado depois pela equipe costumam ser cadastros diferentes.
 * Cada valor guarda a negociação de onde saiu. Nada é inventado: sem registro em nenhum cadastro,
 * a coluna diz "Não registrada no RD".
 *
 * Etapas (agendador de 5 min, depois da contagem):
 *   A. resolve o espelho inteiro em memória, grava o que mudou em crm_rd_negociacoes e a
 *      cobertura por funil (integracao_catalogos: crm_origem_funis); lista as vendas do Admin
 *      cuja origem mudou;
 *   B. grava essas vendas (rd_snapshot._sra_origem e colunas origem/campanha), fora das passadas
 *      da importação e com a mesma trava dela.
 * Nenhuma consulta extra ao RD além dos nomes de fontes, campanhas e funis.
 */
import { createServiceSupabaseClient, type Env } from "./supabase";
import { arrayValue, listarSeguro, mapById, objectValue, stringValue } from "./rd-station-readonly";
import { configDaFuncao, type ConfigCrm } from "./integracoes-registro";
import { funisConfigurados, passadaEmAndamento } from "./crm-importacao";
import { lerContagens } from "./crm-contagens";
import {
  evidenciasDaNegociacao, origemParaColunas, resumirOrigem, valorDescritivoDeOrigem, valorNaoInformativo,
  type EvidenciaOrigem, type OrigemCliente, type OutroContato,
} from "./crm-origem";

type Json = Record<string, any>;
type Db = ReturnType<typeof createServiceSupabaseClient>;

export type NegEspelho = {
  id: string; pipeline_id: string | null; criada_em: string | null; contact_ids: string[];
  source_id: string | null; campaign_id: string | null; campos_origem: Json; assinatura?: string | null;
};
export type ContatoEspelho = { id: string; nome?: string | null; emails: string[]; telefones: string[] };
type Refs = { fontes?: Map<string, Json>; campanhas?: Map<string, Json>; funis?: Map<string, string> };

/** Evidências guardadas por negociação (a mesma pessoa raramente passa disso). */
export const EVIDENCIAS_MAX = 30;
/** Telefone/e-mail em mais cadastros que isso é genérico (telefone da clínica, teste): não liga pessoas. */
const LIMITE_CHAVE = 5;
const CHAVE_ESTADO = "crm_origem_resolucao";
const CHAVE_FUNIS = "crm_origem_funis";

// ------------------------------------------------------------------ mesma pessoa

/** Cadastros da mesma pessoa: ligados por e-mail ou telefone em comum (união transitiva). */
export function agruparPessoas(contatos: ContatoEspelho[]): Map<string, string> {
  const pai = new Map<string, string>();
  const raiz = (x: string): string => {
    let r = x;
    while (pai.get(r) !== r) r = pai.get(r)!;
    let y = x;
    while (pai.get(y) !== r) { const p = pai.get(y)!; pai.set(y, r); y = p; }
    return r;
  };
  for (const c of contatos) pai.set(c.id, c.id);
  const porChave = new Map<string, string[]>();
  for (const c of contatos) {
    for (const k of [...c.emails.map((e) => `e:${e}`), ...c.telefones.map((t) => `t:${t}`)]) {
      const lista = porChave.get(k) ?? [];
      lista.push(c.id);
      porChave.set(k, lista);
    }
  }
  for (const ids of porChave.values()) {
    const unicos = [...new Set(ids)];
    if (unicos.length < 2 || unicos.length > LIMITE_CHAVE) continue;
    for (const id of unicos.slice(1)) {
      const a = raiz(unicos[0]), b = raiz(id);
      if (a !== b) pai.set(b, a);
    }
  }
  const out = new Map<string, string>();
  for (const c of contatos) out.set(c.id, raiz(c.id));
  return out;
}

function viaEntre(a: ContatoEspelho | undefined, b: ContatoEspelho | undefined): "email" | "telefone" {
  if (a && b && a.emails.some((e) => b.emails.includes(e))) return "email";
  return "telefone";
}

// ------------------------------------------------------------------ assinatura

/** Identifica o conteúdo da origem (sem data de conferência): só regrava o que mudou. */
export function assinaturaOrigem(o: Partial<OrigemCliente> | null | undefined): string {
  if (!o || !o.situacao) return "";
  const ev = (o.evidencias ?? []).slice(0, EVIDENCIAS_MAX).map((e) => [e.campo, e.valor, e.negociacao?.id ?? "", e.negociacao?.outroContato?.id ?? ""]);
  const base = JSON.stringify([o.situacao, o.fonte ?? null, o.campanha ?? null, o.comoFicouSabendo ?? null, o.influencer ?? null, o.cupom ?? null, Boolean(o.landingPage), ev, o.ampliada ? 1 : 0]);
  let h = 0x811c9dc5;
  for (let i = 0; i < base.length; i++) { h ^= base.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${base.length.toString(36)}-${h.toString(36)}`;
}

// ------------------------------------------------------------------ resolução

const comoDeal = (n: NegEspelho): Json => ({
  id: n.id, pipeline_id: n.pipeline_id, created_at: n.criada_em ?? "", source_id: n.source_id, campaign_id: n.campaign_id, custom_fields: objectValue(n.campos_origem),
});
const porData = (a: NegEspelho, b: NegEspelho) => stringValue(a.criada_em).localeCompare(stringValue(b.criada_em));

/** Origem de cada negociação do espelho, com a pessoa (grupo de cadastros) de cada uma. */
export function resolverEspelho(negs: NegEspelho[], contatos: ContatoEspelho[], refs: Refs, agora: string) {
  const pessoa = agruparPessoas(contatos);
  const contatoPorId = new Map(contatos.map((c) => [c.id, c]));
  const membros = new Map<string, string[]>();
  for (const [id, r] of pessoa) { const l = membros.get(r) ?? []; l.push(id); membros.set(r, l); }
  const porContato = new Map<string, NegEspelho[]>();
  for (const n of negs) for (const c of n.contact_ids) { const l = porContato.get(c) ?? []; l.push(n); porContato.set(c, l); }
  for (const l of porContato.values()) l.sort(porData);

  const origens = new Map<string, OrigemCliente>();
  const pessoaDaNegociacao = new Map<string, string>();
  for (const n of negs) {
    const proprios = n.contact_ids;
    const vistas = new Set([n.id]);
    const doContato: NegEspelho[] = [];
    for (const c of proprios) for (const d of porContato.get(c) ?? []) if (!vistas.has(d.id)) { vistas.add(d.id); doContato.push(d); }
    doContato.sort(porData);
    const outros: { deal: NegEspelho; contato: OutroContato }[] = [];
    const outrosContatos: OutroContato[] = [];
    const raizes = new Set(proprios.map((c) => pessoa.get(c) ?? c));
    for (const r of raizes) {
      for (const m of membros.get(r) ?? []) {
        if (proprios.includes(m)) continue;
        const via = viaEntre(contatoPorId.get(proprios.find((p) => (pessoa.get(p) ?? p) === r) ?? ""), contatoPorId.get(m));
        outrosContatos.push({ id: m, via });
        for (const d of porContato.get(m) ?? []) if (!vistas.has(d.id)) { vistas.add(d.id); outros.push({ deal: d, contato: { id: m, via } }); }
      }
    }
    outros.sort((a, b) => porData(a.deal, b.deal));
    const evidencias: EvidenciaOrigem[] = [
      ...evidenciasDaNegociacao(comoDeal(n), refs, true),
      ...doContato.flatMap((d) => evidenciasDaNegociacao(comoDeal(d), refs, false)),
      ...outros.flatMap((x) => evidenciasDaNegociacao(comoDeal(x.deal), refs, false, x.contato)),
    ];
    const o = resumirOrigem(evidencias, {
      negociacoesAnalisadas: 1 + doContato.length + outros.length, semContato: !proprios.length, agora,
      ampliada: { em: agora, contatos: outrosContatos, negociacoes: outros.length },
    });
    o.evidencias = o.evidencias.slice(0, EVIDENCIAS_MAX);
    origens.set(n.id, o);
    pessoaDaNegociacao.set(n.id, proprios.length ? [...raizes].sort()[0] : `neg:${n.id}`);
  }
  return { origens, pessoaDaNegociacao };
}

// ------------------------------------------------------------------ cobertura por funil

export type CoberturaFunil = {
  negociacoes: number;
  clientes: number;
  /** Clientes (pessoas) por situação da origem. */
  porSituacao: Record<string, number>;
  /** Clientes com fonte real / com campanha real (não descritiva). */
  comFonte: number;
  comCampanha: number;
  fontes: { valor: string; clientes: number }[];
  campanhas: { valor: string; clientes: number }[];
};

const real = (v: string | null | undefined) => Boolean(v && !valorNaoInformativo(v) && !valorDescritivoDeOrigem(v));

export function coberturaPorFunil(negs: NegEspelho[], origens: Map<string, OrigemCliente>, pessoaDaNegociacao: Map<string, string>) {
  const porFunil: Record<string, CoberturaFunil> = {};
  const vistos = new Map<string, Set<string>>();
  const contagens = new Map<string, { fontes: Map<string, number>; campanhas: Map<string, number> }>();
  const ordenadas = negs.slice().sort(porData);
  for (const n of ordenadas) {
    const funil = n.pipeline_id ?? "sem_funil";
    const c = porFunil[funil] ??= { negociacoes: 0, clientes: 0, porSituacao: { encontrada: 0, parcial: 0, sem_registro_no_rd: 0, sem_contato: 0 }, comFonte: 0, comCampanha: 0, fontes: [], campanhas: [] };
    c.negociacoes++;
    const p = pessoaDaNegociacao.get(n.id) ?? `neg:${n.id}`;
    const set = vistos.get(funil) ?? new Set<string>();
    vistos.set(funil, set);
    if (set.has(p)) continue;
    set.add(p);
    const o = origens.get(n.id);
    if (!o) continue;
    c.clientes++;
    c.porSituacao[o.situacao] = (c.porSituacao[o.situacao] ?? 0) + 1;
    const cols = origemParaColunas(o);
    const k = contagens.get(funil) ?? { fontes: new Map(), campanhas: new Map() };
    contagens.set(funil, k);
    if (real(cols.origem)) c.comFonte++;
    if (real(cols.campanha)) c.comCampanha++;
    k.fontes.set(cols.origem, (k.fontes.get(cols.origem) ?? 0) + 1);
    k.campanhas.set(cols.campanha, (k.campanhas.get(cols.campanha) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) => [...m].map(([valor, clientes]) => ({ valor, clientes })).sort((a, b) => b.clientes - a.clientes).slice(0, 12);
  for (const [funil, k] of contagens) { porFunil[funil].fontes = top(k.fontes); porFunil[funil].campanhas = top(k.campanhas); }
  return porFunil;
}

// ------------------------------------------------------------------ colunas das vendas

/**
 * Colunas origem_venda/campanha_local: completa o que está vazio, "Desconhecido" ou "não
 * registrada no RD"; troca um dado real só por outro dado real vindo do RD. Nunca mexe no que a
 * equipe editou no Admin nem no campo marcado "ignorar" no Console.
 */
export function patchColunasOrigem(v: { origem_venda: string | null; campanha_local: string | null; rd_pipeline_id: string | null }, origem: OrigemCliente, config: ConfigCrm, editadas?: Set<string>) {
  const funil = funisConfigurados(config).find((f) => f.pipelineId === v.rd_pipeline_id);
  const mapa = (funil?.mapeamento ?? config.mapeamento ?? {}) as Json;
  const cols = origemParaColunas(origem);
  const vazio = (x: unknown) => x === undefined || x === null || (typeof x === "string" && !x.trim());
  const patch: Json = {};
  for (const [coluna, campo, novo] of [["origem_venda", "origem", cols.origem], ["campanha_local", "campanha", cols.campanha]] as const) {
    const atual = v[coluna];
    if (editadas?.has(coluna) || mapa[campo] === "ignorar" || atual === novo) continue;
    const atualSemDado = vazio(atual) || valorNaoInformativo(String(atual)) || valorDescritivoDeOrigem(atual);
    // Descrição ("não registrada no RD") nunca substitui dado real; "Desconhecido" só sai por algo melhor.
    if (!atualSemDado && (valorDescritivoDeOrigem(novo) || valorNaoInformativo(novo))) continue;
    if (!vazio(atual) && valorNaoInformativo(String(atual)) && (valorDescritivoDeOrigem(novo) || valorNaoInformativo(novo))) continue;
    // Dado real diferente do RD vale só se a venda ainda não tinha dado real (a importação cuida do resto).
    if (!atualSemDado) continue;
    patch[coluna] = novo.slice(0, 240);
  }
  return patch;
}

// ------------------------------------------------------------------ estado e leitura

export type EstadoResolucao = {
  espelhoDe: string | null;
  em: string | null;
  negociacoes: number;
  alteradas: number;
  /** Vendas do Admin cuja origem mudou e ainda vão ser gravadas (etapa B). */
  vendasPendentes: string[];
  vendasGravadas: number;
  erro?: string | null;
};

export async function lerEstadoResolucao(db: Db): Promise<EstadoResolucao> {
  const { data } = await db.from("integracao_catalogos").select("dados").eq("provedor", "rd_station").eq("chave", CHAVE_ESTADO).maybeSingle();
  const e = objectValue((data as Json | null)?.dados);
  return {
    espelhoDe: e.espelhoDe ?? null, em: e.em ?? null, negociacoes: Number(e.negociacoes ?? 0), alteradas: Number(e.alteradas ?? 0),
    vendasPendentes: Array.isArray(e.vendasPendentes) ? e.vendasPendentes.map(String) : [], vendasGravadas: Number(e.vendasGravadas ?? 0), erro: e.erro ?? null,
  };
}

async function salvarCatalogo(db: Db, chave: string, dados: unknown) {
  await db.from("integracao_catalogos").upsert({ provedor: "rd_station", chave, dados, atualizado_em: new Date().toISOString() }, { onConflict: "provedor,chave" });
}

export async function lerCoberturaFunis(db: Db): Promise<{ atualizadoEm: string | null; porFunil: Record<string, CoberturaFunil> }> {
  const { data } = await db.from("integracao_catalogos").select("dados").eq("provedor", "rd_station").eq("chave", CHAVE_FUNIS).maybeSingle();
  const d = objectValue((data as Json | null)?.dados);
  return { atualizadoEm: d.atualizadoEm ?? null, porFunil: objectValue(d.porFunil) as Record<string, CoberturaFunil> };
}

async function todasAsLinhas(consulta: (de: number, ate: number) => PromiseLike<{ data: Json[] | null; error: unknown }>) {
  const linhas: Json[] = [];
  for (let de = 0; de < 500_000; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw error;
    linhas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return linhas;
}

type Deps = {
  db?: Db;
  relogio?: () => number;
  orcamentoMs?: number;
  refs?: () => Promise<{ fontes: Json[]; campanhas: Json[]; funis: Json[] }>;
  config?: ConfigCrm;
};

// ------------------------------------------------------------------ etapa A: espelho inteiro

async function etapaA(env: Env, db: Db, estado: EstadoResolucao, espelhoDe: string, deps: Deps, prazo: number, relogio: () => number) {
  const agora = new Date(relogio()).toISOString();
  const [negsBrutas, contatosBrutos, vendas] = await Promise.all([
    todasAsLinhas((de, ate) => db.from("crm_rd_negociacoes")
      .select("id,pipeline_id,criada_em,contact_ids,source_id,campaign_id,campos_origem,assinatura:origem->>assinatura").order("id").range(de, ate)),
    todasAsLinhas((de, ate) => db.from("crm_rd_contatos").select("id,emails,telefones").order("id").range(de, ate)),
    todasAsLinhas((de, ate) => db.from("novas_vendas").select("id,rd_station_id,origem:rd_snapshot->_sra_origem").not("rd_station_id", "is", null).order("id").range(de, ate)),
  ]);
  const negs: NegEspelho[] = negsBrutas.map((n) => ({
    id: String(n.id), pipeline_id: n.pipeline_id ?? null, criada_em: n.criada_em ?? null, contact_ids: arrayValue(n.contact_ids).map(String),
    source_id: n.source_id ?? null, campaign_id: n.campaign_id ?? null, campos_origem: objectValue(n.campos_origem),
    assinatura: stringValue(n.assinatura ?? objectValue(n.origem).assinatura) || null,
  }));
  const contatos: ContatoEspelho[] = contatosBrutos.map((c) => ({ id: String(c.id), emails: arrayValue(c.emails).map(String), telefones: arrayValue(c.telefones).map(String) }));
  const r = await (deps.refs ?? (async () => {
    const [fontes, campanhas, funis] = await Promise.all([listarSeguro(env, "sources"), listarSeguro(env, "campaigns"), listarSeguro(env, "pipelines")]);
    return { fontes, campanhas, funis };
  }))();
  const refs: Refs = {
    fontes: mapById(r.fontes), campanhas: mapById(r.campanhas),
    funis: new Map(r.funis.map((f) => [stringValue(f.id), stringValue(f.name)] as [string, string]).filter(([id, nome]) => id && nome)),
  };
  const { origens, pessoaDaNegociacao } = resolverEspelho(negs, contatos, refs, agora);

  // Só o que mudou vai para o banco (lotes de 200).
  const alteradas = negs.map((n) => ({ n, o: origens.get(n.id)!, a: assinaturaOrigem(origens.get(n.id)) })).filter((x) => x.a !== x.n.assinatura);
  let gravadas = 0;
  for (let i = 0; i < alteradas.length; i += 200) {
    if (relogio() >= prazo) break;
    const lote = alteradas.slice(i, i + 200).map(({ n, o, a }) => {
      const cols = origemParaColunas(o);
      return { id: n.id, fonte: cols.origem, campanha: cols.campanha, situacao: o.situacao, origem: { ...o, assinatura: a }, resolvida_em: agora };
    });
    const { error } = await db.from("crm_rd_negociacoes").upsert(lote, { onConflict: "id" });
    if (error) throw new Error("RESOLUCAO_GRAVAR_FALHOU");
    gravadas += lote.length;
  }
  const completa = gravadas === alteradas.length;

  await salvarCatalogo(db, CHAVE_FUNIS, { atualizadoEm: agora, espelhoDe, porFunil: coberturaPorFunil(negs, origens, pessoaDaNegociacao) });

  // Vendas do Admin cuja origem guardada difere da resolvida agora.
  const pendentes = vendas.filter((v) => {
    const o = origens.get(String(v.rd_station_id));
    return o && assinaturaOrigem(o) !== assinaturaOrigem(origemDaVenda(v) as OrigemCliente);
  }).sort((a, b) => ordemVenda(origemDaVenda(a)) - ordemVenda(origemDaVenda(b))).map((v) => String(v.id));

  estado.espelhoDe = completa ? espelhoDe : estado.espelhoDe;
  estado.em = agora;
  estado.negociacoes = negs.length;
  estado.alteradas = gravadas;
  estado.vendasPendentes = pendentes;
  estado.erro = null;
  return { negociacoes: negs.length, contatos: contatos.length, alteradas: gravadas, completa, vendasPendentes: pendentes.length };
}

const origemDaVenda = (v: Json) => objectValue(v.origem ?? objectValue(v.rd_snapshot)._sra_origem);
/** Vendas sem origem completa primeiro. */
const ordemVenda = (o: Json) => (o.situacao === "encontrada" ? 1 : 0);

// ------------------------------------------------------------------ etapa B: vendas do Admin

async function etapaB(env: Env, db: Db, estado: EstadoResolucao, deps: Deps, prazo: number, relogio: () => number) {
  if (!estado.vendasPendentes.length) return { vendasGravadas: 0, vendasPendentes: 0 };
  if (await passadaEmAndamento(db)) return { vendasGravadas: 0, vendasPendentes: estado.vendasPendentes.length, motivo: "importacao_em_andamento" };
  const { data: trava } = await db.rpc("integracao_tentar_trava", { p_nome: "crm_importacao", p_segundos: 290 });
  if (trava === false) return { vendasGravadas: 0, vendasPendentes: estado.vendasPendentes.length, motivo: "importacao_em_andamento" };
  let gravadas = 0;
  try {
    const config = deps.config ?? await configDaFuncao<ConfigCrm>(env, "rd_station", "importacao", { db });
    const edicoes = await todasAsLinhas((de, ate) => db.from("logs_alteracoes").select("entidade_id,detalhes")
      .eq("acao", "editou_venda_local_sem_sync_rd").order("entidade_id").range(de, ate)).catch(() => [] as Json[]);
    const editadas = new Map<string, Set<string>>();
    for (const e of edicoes) {
      const set = editadas.get(String(e.entidade_id)) ?? new Set<string>();
      for (const c of arrayValue(objectValue(e.detalhes).campos)) set.add(String(c));
      editadas.set(String(e.entidade_id), set);
    }
    while (estado.vendasPendentes.length && relogio() < prazo) {
      const lote = estado.vendasPendentes.slice(0, 50);
      const { data: vendas } = await db.from("novas_vendas").select("id,rd_station_id,rd_pipeline_id,origem_venda,campanha_local,rd_snapshot").in("id", lote);
      const ids = (vendas ?? []).map((v: Json) => String(v.rd_station_id));
      const { data: negs } = await db.from("crm_rd_negociacoes").select("id,origem").in("id", ids);
      const origemPorDeal = new Map((negs ?? []).map((n: Json) => [String(n.id), objectValue(n.origem)]));
      for (const v of (vendas ?? []) as Json[]) {
        const bruta = origemPorDeal.get(String(v.rd_station_id));
        if (!bruta?.situacao) continue;
        const { assinatura: _a, ...origem } = bruta;
        const patch = patchColunasOrigem(v as never, origem as OrigemCliente, config, editadas.get(String(v.id)));
        const { error } = await db.from("novas_vendas").update({ rd_snapshot: { ...objectValue(v.rd_snapshot), _sra_origem: origem }, ...patch }).eq("id", v.id);
        if (!error) gravadas++;
      }
      estado.vendasPendentes = estado.vendasPendentes.slice(lote.length);
    }
  } finally {
    await db.rpc("integracao_liberar_trava", { p_nome: "crm_importacao" });
  }
  estado.vendasGravadas += gravadas;
  return { vendasGravadas: gravadas, vendasPendentes: estado.vendasPendentes.length };
}

/**
 * Chamado pelo agendador depois da contagem. Resolve de novo quando a varredura do espelho
 * termina (a cada 6 h) e grava as vendas pendentes aos poucos.
 */
export async function avancarOrigemGeral(env: Env, deps: Deps = {}) {
  const db = deps.db ?? createServiceSupabaseClient(env);
  const relogio = deps.relogio ?? Date.now;
  const prazo = relogio() + (deps.orcamentoMs ?? 150_000);
  const { data: trava } = await db.rpc("integracao_tentar_trava", { p_nome: "crm_origem_geral", p_segundos: 290 });
  if (trava === false) return { executada: false, motivo: "em_andamento" };
  try {
    const estado = await lerEstadoResolucao(db);
    const espelhoDe = (await lerContagens(db))?.espelho?.concluidoEm ?? null;
    let a: Json | null = null;
    if (espelhoDe && estado.espelhoDe !== espelhoDe) {
      try {
        a = await etapaA(env, db, estado, espelhoDe, deps, prazo, relogio);
      } catch (e) {
        estado.erro = e instanceof Error ? e.message : "Falha ao resolver a origem.";
        await salvarCatalogo(db, CHAVE_ESTADO, estado);
        return { executada: false, motivo: "falha", erro: estado.erro };
      }
      await salvarCatalogo(db, CHAVE_ESTADO, estado);
    }
    const b = relogio() < prazo ? await etapaB(env, db, estado, deps, prazo, relogio) : { vendasGravadas: 0, vendasPendentes: estado.vendasPendentes.length };
    await salvarCatalogo(db, CHAVE_ESTADO, estado);
    if (!espelhoDe) return { executada: false, motivo: "espelho_ainda_nao_concluido", ...b };
    return { executada: true, espelho: a, ...b };
  } finally {
    await db.rpc("integracao_liberar_trava", { p_nome: "crm_origem_geral" });
  }
}

// ------------------------------------------------------------------ lista por funil (Console/Admin)

const SITUACOES = new Set(["encontrada", "parcial", "sem_registro_no_rd", "sem_contato"]);

/** Negociações de um funil (qualquer um dos 15) com a fonte e a campanha de cada cliente e a prova. */
export async function listarNegociacoesDoFunil(db: Db, funil: string, opcoes: { pagina?: number; situacao?: string | null } = {}) {
  const tamanho = 50;
  const pagina = Math.max(1, Math.min(10_000, Math.floor(opcoes.pagina ?? 1)));
  let q = db.from("crm_rd_negociacoes")
    .select("id,status,stage_id,criada_em,contact_ids,fonte,campanha,situacao,evidencias:origem->evidencias", { count: "exact" })
    .eq("pipeline_id", funil);
  if (opcoes.situacao && SITUACOES.has(opcoes.situacao)) q = q.eq("situacao", opcoes.situacao);
  const { data, count, error } = await q.order("criada_em", { ascending: false }).range((pagina - 1) * tamanho, pagina * tamanho - 1);
  if (error) return { disponivel: false, total: 0, pagina, tamanho, itens: [] };
  const linhas = (data ?? []) as Json[];
  const ids = [...new Set(linhas.flatMap((l) => arrayValue(l.contact_ids).map(String)))];
  const { data: contatos } = ids.length ? await db.from("crm_rd_contatos").select("id,nome").in("id", ids) : { data: [] as Json[] };
  const nome = new Map(((contatos ?? []) as Json[]).map((c) => [String(c.id), stringValue(c.nome)]));
  return {
    disponivel: true, total: count ?? linhas.length, pagina, tamanho,
    itens: linhas.map((l) => ({
      id: String(l.id), status: l.status ?? null, etapaId: l.stage_id ?? null, criadaEm: l.criada_em ?? null,
      cliente: arrayValue(l.contact_ids).map((c) => nome.get(String(c))).find(Boolean) ?? null,
      fonte: l.fonte ?? null, campanha: l.campanha ?? null, situacao: l.situacao ?? null,
      provas: arrayValue(l.evidencias ?? objectValue(l.origem).evidencias).slice(0, 4).map((e: Json) => ({
        rotulo: stringValue(e.rotulo), valor: stringValue(e.valor), funil: e.negociacao?.funil ?? null, criadaEm: e.negociacao?.criadaEm ?? null,
        propria: Boolean(e.negociacao?.propria), outroContato: e.negociacao?.outroContato?.via ?? null,
      })),
    })),
  };
}
