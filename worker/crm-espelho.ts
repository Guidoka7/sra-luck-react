/**
 * Espelho somente-leitura do RD (migration_122): todas as negociações dos 15 funis e todos os
 * contatos, gravados pela varredura de 6 h (crm-contagens). Não cria venda nem cliente: serve
 * para o Console ver cada funil inteiro e para achar a origem de cada cliente em qualquer funil
 * e em qualquer cadastro da mesma pessoa (crm-origem-geral).
 */
import { createServiceSupabaseClient, type Env } from "./supabase";
import { arrayValue, contatoParaCache, dataRdql, objectValue, paginaContatos, stringValue, TAMANHO_PAGINA_RD } from "./rd-station-readonly";
import { chaveTelefone } from "./crm-chaves";
import { camposDeOrigem, emailsValidos } from "./crm-origem";

type Json = Record<string, any>;
type Db = ReturnType<typeof createServiceSupabaseClient>;

const data = (v: unknown) => { const ms = Date.parse(stringValue(v)); return Number.isFinite(ms) ? new Date(ms).toISOString() : null; };
const idDe = (d: Json, campo: string) => stringValue(d[`${campo}_id`]) || stringValue(objectValue(d[campo]).id) || null;

/** Linha de crm_rd_negociacoes: só o que a contagem e a origem usam. */
export function negociacaoParaEspelho(deal: Json, vistaEm: string) {
  const contatos = new Set<string>();
  for (const v of [deal.contact_id, deal.contact, ...arrayValue(deal.contact_ids), ...arrayValue(deal.contacts)]) {
    const id = typeof v === "object" && v ? stringValue(objectValue(v).id) : stringValue(v);
    if (id) contatos.add(id);
  }
  return {
    id: stringValue(deal.id),
    pipeline_id: idDe(deal, "pipeline"),
    stage_id: idDe(deal, "stage"),
    status: stringValue(deal.status) || null,
    owner_id: idDe(deal, "owner"),
    criada_em: data(deal.created_at),
    contact_ids: [...contatos],
    source_id: idDe(deal, "source"),
    campaign_id: idDe(deal, "campaign"),
    campos_origem: camposDeOrigem(objectValue(deal.custom_fields)),
    vista_em: vistaEm,
  };
}

/** Linha de crm_rd_contatos: e-mails normalizados e telefones como chave DDD+número. */
export function contatoParaEspelho(c: Json, vistoEm: string) {
  const telefones = [...arrayValue(c.phones).map((p) => (typeof p === "object" && p ? (p as Json).phone : p)), c.phone, c.mobile_phone]
    .map(chaveTelefone).filter(Boolean) as string[];
  return {
    id: stringValue(c.id),
    nome: stringValue(c.name).trim().slice(0, 200) || null,
    emails: emailsValidos([...arrayValue(c.emails), c.email]),
    telefones: [...new Set(telefones)],
    criado_em: data(c.created_at),
    visto_em: vistoEm,
    // O que a importação usa do contato (mesmo formato do cache da venda): a importação não relê no RD.
    dados: contatoParaCache(c),
  };
}

export async function gravarNegociacoes(db: Db, deals: Json[], vistaEm: string) {
  const linhas = deals.map((d) => negociacaoParaEspelho(d, vistaEm)).filter((l) => l.id);
  if (!linhas.length) return;
  const { error } = await db.from("crm_rd_negociacoes").upsert(linhas, { onConflict: "id" });
  if (error) throw new Error("ESPELHO_NEGOCIACOES_FALHOU");
}

export async function gravarContatos(db: Db, contatos: Json[], vistoEm: string) {
  const linhas = contatos.map((c) => contatoParaEspelho(c, vistoEm)).filter((l) => l.id);
  if (!linhas.length) return;
  const { error } = await db.from("crm_rd_contatos").upsert(linhas, { onConflict: "id" });
  if (error) throw new Error("ESPELHO_CONTATOS_FALHOU");
}

/** Depois de uma varredura completa: apaga o que não existe mais no RD (não foi visto nesta varredura). */
export async function limparEspelho(db: Db, iniciadaEm: string, opcoes: { contatos: boolean }) {
  await db.from("crm_rd_negociacoes").delete().lt("vista_em", iniciadaEm);
  if (opcoes.contatos) await db.from("crm_rd_contatos").delete().lt("visto_em", iniciadaEm);
}

// ------------------------------------------------------------------ carga única dos contatos

const CHAVE_CARGA = "crm_espelho_contatos_carga";

export type EstadoCarga = { desde: string | null; pagina: number; noLimite: string[]; lidos: number; concluidaEm: string | null; semFiltroData?: boolean; semOrdem?: boolean; incompleta?: boolean; iniciadaEm: string };

/**
 * Carga de TODOS os contatos do RD com o contato completo (100 por consulta), uma única vez.
 * Sem ela, cada cliente nova da importação custava uma consulta ao RD e trazer os 15 funis levava
 * horas. Depois de concluída não roda mais: a varredura de 6 h mantém o espelho em dia.
 */
export async function carregarContatosDoEspelho(env: Env, deps: {
  db?: Db; relogio?: () => number; orcamentoMs?: number;
  pagina?: (desde: string | null, pagina: number, ordenar?: boolean) => Promise<Json[]>;
} = {}) {
  const db = deps.db ?? createServiceSupabaseClient(env);
  const relogio = deps.relogio ?? Date.now;
  const prazo = relogio() + (deps.orcamentoMs ?? 150_000);
  const { data: lida } = await db.from("integracao_catalogos").select("dados").eq("provedor", "rd_station").eq("chave", CHAVE_CARGA).maybeSingle();
  const salvo = objectValue((lida as Json | null)?.dados);
  if (salvo.concluidaEm) return { executada: false, concluida: true, lidos: Number(salvo.lidos ?? 0) };
  const { data: trava } = await db.rpc("integracao_tentar_trava", { p_nome: "crm_espelho_contatos", p_segundos: 290 });
  if (trava === false) return { executada: false, concluida: false, motivo: "em_andamento" };
  const e: EstadoCarga = typeof salvo.iniciadaEm === "string"
    ? salvo as EstadoCarga
    : { desde: null, pagina: 1, noLimite: [], lidos: 0, concluidaEm: null, iniciadaEm: new Date(relogio()).toISOString() };
  const ler = deps.pagina ?? ((d: string | null, p: number, o?: boolean) => paginaContatos(env, d, p, o));
  const salvar = () => db.from("integracao_catalogos").upsert({ provedor: "rd_station", chave: CHAVE_CARGA, dados: e, atualizado_em: new Date().toISOString() }, { onConflict: "provedor,chave" });
  try {
    while (!e.concluidaEm && relogio() < prazo) {
      let pagina: Json[];
      try {
        pagina = await ler(e.semFiltroData ? null : e.desde, e.pagina, !e.semOrdem);
      } catch (erro) {
        const recusado = erro instanceof Error && /^RD_HTTP_(400|422)$/.test(erro.message);
        if (recusado && !e.semFiltroData && e.desde) { e.semFiltroData = true; e.desde = null; e.pagina = 1; e.noLimite = []; continue; }
        if (recusado && !e.semOrdem) { e.semOrdem = true; e.semFiltroData = true; e.desde = null; e.pagina = 1; e.noLimite = []; continue; }
        if (recusado) { e.incompleta = true; e.concluidaEm = new Date(relogio()).toISOString(); break; }
        throw erro;
      }
      const vistos = new Set(e.noLimite);
      const novos = pagina.filter((c) => { const id = stringValue(c.id); if (!id || vistos.has(id)) return false; vistos.add(id); return true; });
      await gravarContatos(db, novos, new Date(relogio()).toISOString());
      e.lidos += novos.length;
      if (pagina.length < TAMANHO_PAGINA_RD) {
        e.concluidaEm = new Date(relogio()).toISOString();
      } else if (e.semFiltroData) {
        if (e.pagina >= 100) { e.incompleta = true; e.concluidaEm = new Date(relogio()).toISOString(); } else e.pagina++;
      } else {
        const ultima = dataRdql(pagina[pagina.length - 1].created_at);
        if (ultima && ultima !== e.desde) { e.desde = ultima; e.pagina = 1; } else e.pagina++;
        e.noLimite = [...vistos].filter((id) => pagina.some((c) => stringValue(c.id) === id && dataRdql(c.created_at) === e.desde));
      }
      await salvar();
    }
    await salvar();
    return { executada: true, concluida: Boolean(e.concluidaEm), lidos: e.lidos };
  } finally {
    await db.rpc("integracao_liberar_trava", { p_nome: "crm_espelho_contatos" });
  }
}
