/**
 * Busca ampliada da origem da cliente (fonte/campanha) — só com dado real do RD.
 *
 * A importação procura a origem na negociação e nas outras negociações do MESMO contato. Quando
 * não acha tudo, a origem costuma estar em OUTRO cadastro da mesma pessoa no RD: o lead que chegou
 * pelo formulário/anúncio (com fonte e campanha) e o contato criado depois pela equipe são dois
 * contatos diferentes. Esta etapa procura, para cada venda sem origem completa, os contatos do RD
 * com o mesmo e-mail ou o mesmo telefone (a regra de "mesma pessoa" da importação) e soma as
 * negociações deles à origem, com a prova de onde cada dado saiu.
 *
 * Segurança do dado: o resultado da busca do RD só é aceito se o contato devolvido tiver de fato o
 * mesmo e-mail ou telefone (conferido aqui), então um filtro mal interpretado nunca mistura pessoas.
 * O formato do filtro (aspas, lista) é calibrado com o próprio contato da cliente: se o RD não o
 * devolver buscando pelo telefone/e-mail dele, aquela forma não é usada.
 *
 * Roda em etapas no agendador de 5 min, fora das passadas de importação (usa a mesma trava: nunca
 * grava a venda ao mesmo tempo que a importação). Cada venda é refeita a cada 30 dias.
 */
import { createServiceSupabaseClient, type Env } from "./supabase";
import { arrayValue, lerDealsDosContatos, listarSeguro, mapById, objectValue, rdGet, stringValue } from "./rd-station-readonly";
import { configDaFuncao, type ConfigCrm } from "./integracoes-registro";
import { chaveTelefone, funisConfigurados, passadaEmAndamento } from "./crm-importacao";
import {
  ampliarOrigem, emailsValidos, origemParaColunas, valorDescritivoDeOrigem, valorNaoInformativo, variacoesTelefone,
  type OrigemCliente, type OutroContato,
} from "./crm-origem";

type Json = Record<string, any>;
type Db = ReturnType<typeof createServiceSupabaseClient>;

export type FormaEmail = "aspas" | "simples";
export type FormaTelefone = "lista_aspas" | "lista" | "aspas" | "simples";

export type EstadoAmpliada = {
  formas: { email: FormaEmail | null; telefone: FormaTelefone | null; calibradaEm: string; detalhe: string } | null;
  ultimaRodada: Json | null;
  totais: { analisadas: number; comOutrosContatos: number; melhoradas: number };
};

const CHAVE = "crm_origem_ampliada";
export const REVALIDAR_AMPLIADA_MS = 30 * 24 * 60 * 60_000;
const RECALIBRAR_MS = 7 * 24 * 60 * 60_000;
const ORCAMENTO_MS = 150_000;
/** Página única de 100: se vier cheia, o RD ignorou o filtro (nunca é a mesma pessoa em 100 cadastros). */
const TAMANHO_BUSCA = 100;
/** No modo "uma consulta por formato", só os formatos mais comuns da conta. */
const VARIACOES_INDIVIDUAIS = 6;

/** Leitura de contatos por filtro RDQL; `null` = o RD recusou o filtro (400/422). */
export type BuscarContatos = (filtro: string) => Promise<Json[] | null>;

type Deps = {
  db?: Db;
  relogio?: () => number;
  orcamentoMs?: number;
  buscarContatos?: BuscarContatos;
  dealsDosContatos?: (ids: string[]) => Promise<Json[]>;
  refs?: () => Promise<{ fontes: Json[]; campanhas: Json[]; funis: Json[] }>;
  config?: ConfigCrm;
};

function buscarContatosRd(env: Env): BuscarContatos {
  return async (filtro) => {
    const q = new URLSearchParams({ "page[number]": "1", "page[size]": String(TAMANHO_BUSCA), filter: filtro });
    try {
      return arrayValue((await rdGet(env, `/contacts?${q.toString()}`)).data).map(objectValue);
    } catch (e) {
      if (e instanceof Error && /^RD_HTTP_(400|422)$/.test(e.message)) return null;
      throw e;
    }
  };
}

// ------------------------------------------------------------------ filtros

export function filtroEmail(email: string, forma: FormaEmail) {
  return forma === "aspas" ? `email:"${email}"` : `email:${email}`;
}

/** Filtros de uma busca por telefone (um só na forma de lista; um por formato nas demais). */
export function filtrosTelefone(variacoes: string[], forma: FormaTelefone): string[] {
  const semEspaco = variacoes.filter((v) => /^\+?\d+$/.test(v));
  if (forma === "lista_aspas") return variacoes.length ? [`phone:(${variacoes.map((v) => `"${v}"`).join(",")})`] : [];
  if (forma === "lista") return semEspaco.length ? [`phone:(${semEspaco.join(",")})`] : [];
  if (forma === "aspas") return variacoes.slice(0, VARIACOES_INDIVIDUAIS).map((v) => `phone:"${v}"`);
  return semEspaco.slice(0, VARIACOES_INDIVIDUAIS).map((v) => `phone:${v}`);
}

const telefonesDoContato = (c: Json) => [
  ...arrayValue(c.phones).map((p) => (typeof p === "object" && p ? (p as Json).phone : p)), c.phone, c.mobile_phone,
].map(chaveTelefone).filter(Boolean) as string[];
const emailsDoContato = (c: Json) => emailsValidos([...arrayValue(c.emails), c.email]);

/** Resultado válido: filtro respeitado (não voltou página cheia). */
async function buscar(fn: BuscarContatos, filtro: string): Promise<Json[] | null> {
  const r = await fn(filtro);
  if (r === null || r.length >= TAMANHO_BUSCA) return null;
  return r;
}

// ------------------------------------------------------------------ calibração

type Amostra = { contatoId: string; emails: string[]; telefonesBrutos: string[]; chaves: string[] };

/**
 * Descobre como o RD aceita o filtro de e-mail e de telefone, buscando o próprio contato da
 * cliente: a forma certa é a que o devolve.
 */
export async function calibrarFormas(amostras: Amostra[], fn: BuscarContatos): Promise<NonNullable<EstadoAmpliada["formas"]>> {
  let email: FormaEmail | null = null;
  let telefone: FormaTelefone | null = null;
  const tentativas: string[] = [];
  for (const a of amostras) {
    if (!email && a.emails.length) {
      for (const forma of ["aspas", "simples"] as FormaEmail[]) {
        const r = await buscar(fn, filtroEmail(a.emails[0], forma));
        tentativas.push(`email:${forma}=${r === null ? "recusado" : r.some((c) => stringValue(c.id) === a.contatoId) ? "ok" : "sem_retorno"}`);
        if (r?.some((c) => stringValue(c.id) === a.contatoId)) { email = forma; break; }
      }
    }
    if (!telefone && a.chaves.length && a.telefonesBrutos.length) {
      const bruto = a.telefonesBrutos[0].trim();
      const variacoes = [...new Set([bruto, ...variacoesTelefone(a.chaves[0])])];
      for (const forma of ["lista_aspas", "lista", "aspas", "simples"] as FormaTelefone[]) {
        // Nas formas individuais, testa com o telefone exatamente como está no contato.
        const filtros = forma.startsWith("lista") ? filtrosTelefone(variacoes, forma) : filtrosTelefone([bruto], forma);
        if (!filtros.length) continue;
        const r = await buscar(fn, filtros[0]);
        tentativas.push(`telefone:${forma}=${r === null ? "recusado" : r.some((c) => stringValue(c.id) === a.contatoId) ? "ok" : "sem_retorno"}`);
        if (r?.some((c) => stringValue(c.id) === a.contatoId)) { telefone = forma; break; }
      }
    }
    if (email && telefone) break;
  }
  return { email, telefone, calibradaEm: new Date().toISOString(), detalhe: tentativas.join(" · ").slice(0, 900) };
}

// ------------------------------------------------------------------ estado

export async function lerEstadoAmpliada(db: Db): Promise<EstadoAmpliada> {
  const { data } = await db.from("integracao_catalogos").select("dados").eq("provedor", "rd_station").eq("chave", CHAVE).maybeSingle();
  const e = objectValue((data as Json | null)?.dados);
  return {
    formas: e.formas && typeof e.formas === "object" ? e.formas : null,
    ultimaRodada: e.ultimaRodada ?? null,
    totais: { analisadas: Number(e.totais?.analisadas ?? 0), comOutrosContatos: Number(e.totais?.comOutrosContatos ?? 0), melhoradas: Number(e.totais?.melhoradas ?? 0) },
  };
}

async function salvarEstado(db: Db, e: EstadoAmpliada) {
  await db.from("integracao_catalogos").upsert({ provedor: "rd_station", chave: CHAVE, dados: e, atualizado_em: new Date().toISOString() }, { onConflict: "provedor,chave" });
}

// ------------------------------------------------------------------ vendas candidatas

type Venda = {
  id: string; status: string; rd_pipeline_id: string | null; telefone: string | null; email: string | null;
  origem_venda: string | null; campanha_local: string | null; origem: OrigemCliente; contato: Json; contatosNegociacao: string[];
};

const ORDEM_SITUACAO: Record<string, number> = { sem_registro_no_rd: 0, sem_contato: 0, parcial: 1 };

/** Vendas cuja origem ainda não está completa e que não passaram pela busca nos últimos 30 dias. */
export function candidatas(linhas: Json[], agora: number): Venda[] {
  const out: Venda[] = [];
  for (const v of linhas) {
    const snap = objectValue(v.rd_snapshot);
    const origem = objectValue(v.origem ?? snap._sra_origem) as OrigemCliente;
    if (!origem.checadoEm || !(origem.situacao in ORDEM_SITUACAO)) continue;
    const em = Date.parse(stringValue(origem.ampliada?.em));
    if (Number.isFinite(em) && agora - em < REVALIDAR_AMPLIADA_MS) continue;
    out.push({
      id: String(v.id), status: stringValue(v.status), rd_pipeline_id: stringValue(v.rd_pipeline_id) || null,
      telefone: v.telefone ?? null, email: v.email ?? null, origem_venda: v.origem_venda ?? null, campanha_local: v.campanha_local ?? null,
      origem, contato: objectValue(objectValue(v.contato ?? snap._sra_contato).dados),
      contatosNegociacao: arrayValue(v.contact_ids ?? snap.contact_ids).map(stringValue).filter(Boolean),
    });
  }
  // Primeiro quem não tem registro nenhum; depois as nunca procuradas; depois as mais antigas.
  return out.sort((a, b) => (ORDEM_SITUACAO[a.origem.situacao] - ORDEM_SITUACAO[b.origem.situacao])
    || stringValue(a.origem.ampliada?.em).localeCompare(stringValue(b.origem.ampliada?.em)));
}

function amostraDe(v: Venda): Amostra | null {
  const contatoId = stringValue(v.contato.id);
  if (!contatoId) return null;
  const telefonesBrutos = arrayValue(v.contato.phones).map((p) => stringValue(typeof p === "object" && p ? (p as Json).phone : p)).filter(Boolean);
  return { contatoId, emails: emailsDoContato(v.contato), telefonesBrutos, chaves: telefonesBrutos.map(chaveTelefone).filter(Boolean) as string[] };
}

async function todasAsLinhas(consulta: (de: number, ate: number) => PromiseLike<{ data: Json[] | null; error: unknown }>) {
  const linhas: Json[] = [];
  for (let de = 0; de < 100_000; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw error;
    linhas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return linhas;
}

const vazio = (v: unknown) => v === undefined || v === null || (typeof v === "string" && !v.trim());
const semDadoReal = (v: unknown) => vazio(v) || valorNaoInformativo(String(v)) || valorDescritivoDeOrigem(v);

/**
 * Colunas origem_venda/campanha_local: só completa o que está vazio, "Desconhecido" ou
 * "não registrada no RD"; nunca troca o que a equipe editou no Admin nem o campo marcado
 * "ignorar" no Console.
 */
export function patchColunasOrigem(v: Pick<Venda, "origem_venda" | "campanha_local" | "rd_pipeline_id">, origem: OrigemCliente, config: ConfigCrm, editadas?: Set<string>) {
  const funil = funisConfigurados(config).find((f) => f.pipelineId === v.rd_pipeline_id);
  const mapa = funil?.mapeamento ?? config.mapeamento ?? {};
  const cols = origemParaColunas(origem);
  const patch: Json = {};
  for (const [coluna, campo, novo] of [["origem_venda", "origem", cols.origem], ["campanha_local", "campanha", cols.campanha]] as const) {
    const atual = v[coluna];
    if (editadas?.has(coluna) || (mapa as Json)[campo] === "ignorar") continue;
    if (!semDadoReal(atual) || atual === novo) continue;
    // "Desconhecido" registrado no RD só é trocado por um dado melhor.
    if (!vazio(atual) && valorNaoInformativo(String(atual)) && semDadoReal(novo)) continue;
    patch[coluna] = novo.slice(0, 240);
  }
  return patch;
}

// ------------------------------------------------------------------ etapa

export async function avancarOrigemAmpliada(env: Env, deps: Deps = {}) {
  const db = deps.db ?? createServiceSupabaseClient(env);
  const relogio = deps.relogio ?? Date.now;
  const prazo = relogio() + (deps.orcamentoMs ?? ORCAMENTO_MS);
  if (await passadaEmAndamento(db)) return { executada: false, motivo: "importacao_em_andamento" };
  // A mesma trava da importação: as duas gravam rd_snapshot da venda e nunca podem se cruzar.
  const { data: trava } = await db.rpc("integracao_tentar_trava", { p_nome: "crm_importacao", p_segundos: 290 });
  if (trava === false) return { executada: false, motivo: "importacao_em_andamento" };
  try {
    const estado = await lerEstadoAmpliada(db);
    const linhas = await todasAsLinhas((de, ate) => db.from("novas_vendas")
      .select("id,status,rd_pipeline_id,telefone,email,origem_venda,campanha_local,origem:rd_snapshot->_sra_origem,contato:rd_snapshot->_sra_contato,contact_ids:rd_snapshot->contact_ids")
      .not("rd_station_id", "is", null).order("id").range(de, ate));
    const fila = candidatas(linhas, relogio());
    if (!fila.length) {
      estado.ultimaRodada = { em: new Date(relogio()).toISOString(), analisadas: 0, pendentes: 0 };
      await salvarEstado(db, estado);
      return { executada: true, analisadas: 0, pendentes: 0 };
    }
    const fn = deps.buscarContatos ?? buscarContatosRd(env);
    const idadeCalibracao = estado.formas ? relogio() - Date.parse(estado.formas.calibradaEm) : Infinity;
    // Recalibra toda semana; se nenhuma forma funcionou, tenta de novo a cada hora (sem gastar consultas a cada rodada).
    if (!(idadeCalibracao < RECALIBRAR_MS) || (!estado.formas?.email && !estado.formas?.telefone && idadeCalibracao >= 60 * 60_000)) {
      const amostras = linhas.map((l) => amostraDe({ contato: objectValue(objectValue(l.contato ?? objectValue(l.rd_snapshot)._sra_contato).dados) } as Venda))
        .filter((a): a is Amostra => Boolean(a && a.emails.length && a.chaves.length)).slice(0, 3);
      estado.formas = await calibrarFormas(amostras, fn);
      await salvarEstado(db, estado);
    }
    const formas = estado.formas!;
    if (!formas.email && !formas.telefone) {
      estado.ultimaRodada = { em: new Date(relogio()).toISOString(), analisadas: 0, pendentes: fila.length, erro: "RD não aceitou a busca de contatos por e-mail nem por telefone.", detalhe: formas.detalhe };
      await salvarEstado(db, estado);
      return { executada: false, motivo: "busca_indisponivel", detalhe: formas.detalhe };
    }
    const config = deps.config ?? await configDaFuncao<ConfigCrm>(env, "rd_station", "importacao", { db });
    const r = await (deps.refs ?? (async () => {
      const [fontes, campanhas, funis] = await Promise.all([listarSeguro(env, "sources"), listarSeguro(env, "campaigns"), listarSeguro(env, "pipelines")]);
      return { fontes, campanhas, funis };
    }))();
    const refs = {
      fontes: mapById(r.fontes), campanhas: mapById(r.campanhas),
      funis: new Map(r.funis.map((f) => [stringValue(f.id), stringValue(f.name)] as [string, string]).filter(([id, nome]) => id && nome)),
    };
    const edicoes = await todasAsLinhas((de, ate) => db.from("logs_alteracoes").select("entidade_id,detalhes")
      .eq("acao", "editou_venda_local_sem_sync_rd").order("entidade_id").range(de, ate)).catch(() => [] as Json[]);
    const editadas = new Map<string, Set<string>>();
    for (const e of edicoes) {
      const set = editadas.get(String(e.entidade_id)) ?? new Set<string>();
      for (const c of arrayValue(objectValue(e.detalhes).campos)) set.add(String(c));
      editadas.set(String(e.entidade_id), set);
    }
    const lerDeals = deps.dealsDosContatos ?? ((ids: string[]) => lerDealsDosContatos(env, ids));

    const rodada = { em: new Date(relogio()).toISOString(), analisadas: 0, comOutrosContatos: 0, melhoradas: 0, colunas: 0, erros: 0, pendentes: 0, formas: { email: formas.email, telefone: formas.telefone } };
    for (const v of fila) {
      if (relogio() >= prazo) break;
      try {
        const proprios = new Set([stringValue(v.contato.id), ...v.contatosNegociacao].filter(Boolean));
        const emails = emailsValidos([...arrayValue(v.contato.emails), v.email]).slice(0, 3);
        const chaves = [...new Set([v.telefone, ...arrayValue(v.contato.phones).map((p) => (typeof p === "object" && p ? (p as Json).phone : p))]
          .map(chaveTelefone).filter(Boolean) as string[])].slice(0, 3);
        const achados = new Map<string, OutroContato>();
        if (formas.email) {
          for (const e of emails) {
            for (const c of await buscar(fn, filtroEmail(e, formas.email)) ?? []) {
              const id = stringValue(c.id);
              if (id && !proprios.has(id) && emailsDoContato(c).includes(e)) achados.set(id, { id, via: "email" });
            }
          }
        }
        if (formas.telefone) {
          for (const k of chaves) {
            for (const filtro of filtrosTelefone(variacoesTelefone(k), formas.telefone)) {
              for (const c of await buscar(fn, filtro) ?? []) {
                const id = stringValue(c.id);
                if (id && !proprios.has(id) && !achados.has(id) && telefonesDoContato(c).includes(k)) achados.set(id, { id, via: "telefone" });
              }
            }
          }
        }
        const contatos = [...achados.values()];
        const deals = contatos.length ? await lerDeals(contatos.map((c) => c.id)) : [];
        const pares = deals.map((deal) => {
          const id = arrayValue(deal.contact_ids).map(stringValue).find((c) => achados.has(c));
          return id ? { deal, contato: achados.get(id)! } : null;
        }).filter((x): x is { deal: Json; contato: OutroContato } => Boolean(x));
        const nova = ampliarOrigem(v.origem, pares, refs, { em: new Date(relogio()).toISOString(), contatos });
        const patch = patchColunasOrigem(v, nova, config, editadas.get(v.id));
        const { data: atual } = await db.from("novas_vendas").select("rd_snapshot").eq("id", v.id).maybeSingle();
        const snapshot = objectValue((atual as Json | null)?.rd_snapshot);
        const { error } = await db.from("novas_vendas").update({ rd_snapshot: { ...snapshot, _sra_origem: nova }, ...patch }).eq("id", v.id);
        if (error) throw error;
        rodada.analisadas++;
        if (contatos.length) rodada.comOutrosContatos++;
        const antes = [v.origem.fonte, v.origem.campanha, v.origem.comoFicouSabendo, v.origem.influencer, v.origem.cupom].filter(Boolean).length + (v.origem.landingPage ? 1 : 0);
        const depois = [nova.fonte, nova.campanha, nova.comoFicouSabendo, nova.influencer, nova.cupom].filter(Boolean).length + (nova.landingPage ? 1 : 0);
        if (depois > antes) rodada.melhoradas++;
        if (Object.keys(patch).length) rodada.colunas++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        rodada.erros++;
        // Sem acesso ao RD ou limite de consultas esgotado: não adianta seguir nesta rodada.
        if (/^RD_(ACCESS_TOKEN_MISSING|HTTP_401|HTTP_403|HTTP_429)/.test(msg)) break;
      }
    }
    rodada.pendentes = Math.max(0, fila.length - rodada.analisadas);
    estado.ultimaRodada = rodada;
    estado.totais = {
      analisadas: estado.totais.analisadas + rodada.analisadas,
      comOutrosContatos: estado.totais.comOutrosContatos + rodada.comOutrosContatos,
      melhoradas: estado.totais.melhoradas + rodada.melhoradas,
    };
    await salvarEstado(db, estado);
    return { executada: true, ...rodada };
  } finally {
    await db.rpc("integracao_liberar_trava", { p_nome: "crm_importacao" });
  }
}

