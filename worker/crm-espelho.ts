/**
 * Espelho somente-leitura do RD (migration_122): todas as negociações dos 15 funis e todos os
 * contatos, gravados pela varredura de 6 h (crm-contagens). Não cria venda nem cliente: serve
 * para o Console ver cada funil inteiro e para achar a origem de cada cliente em qualquer funil
 * e em qualquer cadastro da mesma pessoa (crm-origem-geral).
 */
import { createServiceSupabaseClient } from "./supabase";
import { arrayValue, contatoParaCache, objectValue, stringValue } from "./rd-station-readonly";
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
