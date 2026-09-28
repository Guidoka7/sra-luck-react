/**
 * Fila de pendências das integrações (migration_113). Diagnóstico: docs/DIAGNOSTICO-RD-2026-09-28.md.
 *
 * Toda negociação do RD que não vira venda válida — erro, fora do funil ganha, duplicidade,
 * campos ausentes, vendedora sem vínculo, status não ganho, execução que falhou ou foi interrompida —
 * gera UMA pendência aberta por (provedor, tipo, external_id). Repetição soma ocorrências.
 * As regras de venda incompleta ficam só no banco (rd_recalcular_pendencias_venda).
 *
 * Rotas (Admin e Dev Console via M2M; o Console aplica o RBAC dele antes):
 *   GET  /api/admin/integrations/pendencias                  lista + resumo (sem dados pessoais)
 *   POST /api/admin/integrations/pendencias/:id/reprocessar  seguro: nunca cria venda duplicada
 *   POST /api/admin/integrations/pendencias/:id/descartar    exige motivo; auditado
 *   GET  /api/admin/integrations/rd-station/responsaveis     responsáveis do RD e vínculo com a equipe
 *   POST /api/admin/integrations/rd-station/responsaveis     vincula usuário do RD ↔ pessoa da equipe
 */
import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { getCookie, verificarTokenAdmin } from "./session";
import { createServiceSupabaseClient, type Env } from "./supabase";

type Json = Record<string, any>;
type Db = ReturnType<typeof createServiceSupabaseClient>;

export const TIPOS_PENDENCIA = [
  "execucao_falhou", "execucao_interrompida", "negociacao_com_erro", "campos_ausentes",
  "vendedora_nao_vinculada", "status_nao_ganha", "ganha_fora_do_funil", "duplicidade_possivel", "excluida_no_rd",
] as const;
export type TipoPendencia = (typeof TIPOS_PENDENCIA)[number];

/** Tipos cuja causa está nos dados do Sra. Luck: reprocessar = recalcular localmente, sem chamar o RD. */
export const TIPOS_DA_VENDA: TipoPendencia[] = ["campos_ausentes", "vendedora_nao_vinculada", "status_nao_ganha", "excluida_no_rd"];

export type ItemParaPendencia = {
  external_id: string;
  resultado: string;
  motivo: string | null;
  nova_venda_id: string | null;
  dados?: Json;
};

/**
 * O que um resultado de negociação exige. Função pura (testada): a venda criada/atualizada
 * não entra aqui — ela é avaliada no banco por rd_recalcular_pendencias_venda.
 */
export function pendenciaDoItem(item: ItemParaPendencia): { tipo: TipoPendencia; motivo: string; acao: string } | null {
  if (item.resultado === "erro") {
    return { tipo: "negociacao_com_erro", motivo: item.motivo || "Falha ao processar a negociação.", acao: "Reprocessar a negociação; se repetir, verificar o registro no RD." };
  }
  if (item.resultado === "duplicada" || item.resultado === "cliente_existente") {
    return { tipo: "duplicidade_possivel", motivo: item.motivo || "Possível duplicidade.", acao: "Decidir em Admin › Clientes › Importações do RD: é a mesma pessoa ou importar mesmo assim." };
  }
  if (item.resultado === "ignorada" && /funil|funis/i.test(item.motivo ?? "") && String(item.dados?.rdStatus ?? "") === "won") {
    return { tipo: "ganha_fora_do_funil", motivo: "Negociação ganha num funil que não está na configuração.", acao: "Incluir o funil na configuração do RD ou confirmar que não é venda; depois reprocessar." };
  }
  if (item.resultado === "ignorada" && /sem nome/i.test(item.motivo ?? "") && String(item.dados?.rdStatus ?? "") === "won") {
    return { tipo: "negociacao_com_erro", motivo: item.motivo || "Negociação sem nome de contato.", acao: "Completar o contato no RD e reprocessar." };
  }
  return null;
}

/** Código estável do erro de execução (agrupa as 75 falhas de token numa pendência). */
export function codigoErroExecucao(mensagem: string): string {
  const m = /^(RD_[A-Z0-9_]+)/.exec(mensagem.trim());
  if (m) return m[1];
  if (/^PENDENCIA_/.test(mensagem.trim())) return "PENDENCIA_NAO_REGISTRADA";
  if (/timeout|504/i.test(mensagem)) return "EXECUTION_TIMEOUT";
  return "RD_FALHA_LEITURA";
}

export async function registrarPendencia(db: Db, p: {
  tipo: TipoPendencia; externalId: string; motivo: string; acao: string; origem?: string | null;
  importacaoId?: string | null; novaVendaId?: string | null; dados?: Json; campos?: string[];
}) {
  const { error } = await db.rpc("integracao_registrar_pendencia", {
    p_provedor: "rd_station", p_tipo: p.tipo, p_external_id: p.externalId, p_motivo: p.motivo, p_acao: p.acao,
    p_campos: p.campos ?? [], p_origem: p.origem ?? null, p_importacao_id: p.importacaoId ?? null,
    p_nova_venda_id: p.novaVendaId ?? null, p_dados: p.dados ?? {}, p_contar: true,
  });
  if (error) throw new Error("PENDENCIA_NAO_REGISTRADA");
}

/** Registra o que o resultado de uma negociação exige (idempotente). */
export async function registrarPendenciasDoItem(db: Db, item: ItemParaPendencia, origem: string, importacaoId: string | null) {
  if ((item.resultado === "criada" || item.resultado === "atualizada") && item.nova_venda_id) {
    const { error } = await db.rpc("rd_recalcular_pendencias_venda", { p_venda_id: item.nova_venda_id, p_origem: origem, p_importacao_id: importacaoId, p_ator: `sistema:rd_${origem}` });
    if (error) throw new Error("PENDENCIA_NAO_REGISTRADA");
    return;
  }
  const p = pendenciaDoItem(item);
  if (!p) return;
  await registrarPendencia(db, {
    ...p, externalId: item.external_id, origem, importacaoId,
    dados: { resultado: item.resultado, rd_status: item.dados?.rdStatus ?? null, rd_pipeline_id: item.dados?.rdPipelineId ?? null, rd_stage_id: item.dados?.rdStageId ?? null },
  });
}

// ------------------------------------------------------------------ leitura

export async function listarPendencias(db: Db, filtro: { estado?: string | null; tipo?: string | null; limite?: number }) {
  const estado = ["aberta", "resolvida", "descartada"].includes(String(filtro.estado)) ? String(filtro.estado) : "aberta";
  let q = db.from("integracao_pendencias")
    .select("id,provedor,tipo,external_id,importacao_id,nova_venda_id,origem,motivo,campos_faltantes,acao_necessaria,dados,estado,resolucao,nota,ocorrencias,primeira_ocorrencia_em,ultima_ocorrencia_em,resolvido_por,resolvido_em")
    .eq("provedor", "rd_station").eq("estado", estado).order("ultima_ocorrencia_em", { ascending: false })
    .limit(Math.min(500, Math.max(1, filtro.limite ?? 200)));
  if (filtro.tipo && (TIPOS_PENDENCIA as readonly string[]).includes(filtro.tipo)) q = q.eq("tipo", filtro.tipo);
  const [{ data, error }, resumo] = await Promise.all([q, db.from("integracao_pendencias").select("tipo,estado").eq("provedor", "rd_station")]);
  if (error) return { disponivel: false, itens: [], resumo: {} };
  const porTipo: Record<string, number> = {};
  for (const r of (resumo.data ?? []) as Json[]) if (r.estado === "aberta") porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + 1;
  const { count: validas } = await db.from("vw_vendas_validas_bi").select("id", { count: "exact", head: true });
  const { count: vendas } = await db.from("novas_vendas").select("id", { count: "exact", head: true }).not("rd_station_id", "is", null);
  return { disponivel: true, itens: data ?? [], resumo: { abertasPorTipo: porTipo, vendasRd: vendas ?? 0, vendasValidasBi: validas ?? 0 } };
}

// ------------------------------------------------------------------ rotas

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
function mesmaOrigem(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}
async function exigir(request: Request, env: Env, permissao: string) {
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);
  const sessao = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  if (!sessao) return json({ erro: "Sessão administrativa expirada." }, 401);
  const colaborador = await buscarColaboradorAdminAtivo(sessao.adminId, env).catch(() => null);
  if (!colaborador || !temPermissaoAdmin(colaborador, permissao)) return json({ erro: "Seu papel não tem permissão para esta ação." }, 403);
  return { ator: `staff:${colaborador.id}` };
}

export type Reprocessadores = {
  /** Relê UMA negociação no RD e processa com a mesma chave rd_station_id (nunca duplica). */
  negociacao: (env: Env, db: Db, externalId: string, ator: string) => Promise<{ ok: boolean; resultado?: string; erro?: string }>;
  /** Roda uma importação completa (idempotente pela trava e pela chave rd_station_id). */
  execucao: (env: Env, ator: string) => Promise<{ ok: boolean; erro?: string }>;
};

export async function reprocessarPendencia(env: Env, db: Db, id: string, ator: string, r: Reprocessadores) {
  const { data: p } = await db.from("integracao_pendencias").select("*").eq("id", id).eq("provedor", "rd_station").maybeSingle();
  if (!p) return { status: 404, corpo: { erro: "Pendência não encontrada." } };
  const pend = p as Json;
  if (pend.estado !== "aberta") return { status: 409, corpo: { erro: "Pendência já encerrada." } };
  let resultado: Json;
  if ((TIPOS_DA_VENDA as string[]).includes(pend.tipo)) {
    if (!pend.nova_venda_id) return { status: 409, corpo: { erro: "Pendência sem venda vinculada." } };
    const { data, error } = await db.rpc("rd_recalcular_pendencias_venda", { p_venda_id: pend.nova_venda_id, p_origem: "reprocessamento", p_importacao_id: null, p_ator: ator });
    if (error) return { status: 500, corpo: { erro: "Não foi possível recalcular. Nada foi alterado." } };
    resultado = { abertas: data };
  } else if (pend.tipo === "duplicidade_possivel") {
    return { status: 409, corpo: { erro: "Duplicidade é decidida na revisão do RD (mesma pessoa ou importar mesmo assim)." } };
  } else if (pend.tipo === "execucao_falhou" || pend.tipo === "execucao_interrompida") {
    const e = await r.execucao(env, ator);
    if (!e.ok) return { status: 502, corpo: { erro: e.erro ?? "A execução falhou de novo; a pendência continua aberta." } };
    resultado = { execucao: "concluida" };
  } else {
    const n = await r.negociacao(env, db, String(pend.external_id), ator);
    if (!n.ok) return { status: 502, corpo: { erro: n.erro ?? "Não foi possível reler a negociação; a pendência continua aberta." } };
    resultado = { negociacao: n.resultado };
  }
  const { data: atual } = await db.from("integracao_pendencias").select("estado,resolucao").eq("id", id).maybeSingle();
  await db.from("logs_alteracoes").insert({ usuario: ator, acao: "reprocessou_pendencia_integracao", entidade: "integracoes", entidade_id: id, detalhes: { tipo: pend.tipo, estado_depois: (atual as Json | null)?.estado ?? null, ...resultado } });
  return { status: 200, corpo: { ok: true, estado: (atual as Json | null)?.estado ?? pend.estado, ...resultado } };
}

export async function descartarPendencia(db: Db, id: string, ator: string, motivo: string) {
  const nota = motivo.trim().slice(0, 500);
  if (nota.length < 5) return { status: 400, corpo: { erro: "Informe o motivo do descarte (mínimo 5 caracteres)." } };
  const agora = new Date().toISOString();
  const { data } = await db.from("integracao_pendencias")
    .update({ estado: "descartada", resolucao: "descartada", nota, resolvido_por: ator, resolvido_em: agora })
    .eq("id", id).eq("provedor", "rd_station").eq("estado", "aberta").select("id,tipo").maybeSingle();
  if (!data) return { status: 409, corpo: { erro: "Pendência não encontrada ou já encerrada." } };
  await db.from("logs_alteracoes").insert({ usuario: ator, acao: "descartou_pendencia_integracao", entidade: "integracoes", entidade_id: id, detalhes: { tipo: (data as Json).tipo, motivoInformado: true } });
  return { status: 200, corpo: { ok: true } };
}

export async function responsaveisRd(db: Db) {
  const [{ data: vendas }, { data: vinculos }, { data: equipe }] = await Promise.all([
    db.from("novas_vendas").select("rd_owner_id,rd_vendedora_original,vendedora_responsavel").not("rd_owner_id", "is", null).limit(20000),
    db.from("colaborador_vinculos_externos").select("id_externo,colaborador_id").eq("provedor", "rd_station"),
    db.from("colaboradores").select("id,nome,cargo,ativo").in("cargo", ["vendedora", "sdr"]).eq("ativo", true),
  ]);
  const mapa = new Map<string, { rdUserId: string; nomeNoRd: string | null; vendas: number }>();
  for (const v of (vendas ?? []) as Json[]) {
    const id = String(v.rd_owner_id);
    const atual = mapa.get(id) ?? { rdUserId: id, nomeNoRd: (v.rd_vendedora_original || v.vendedora_responsavel || null) as string | null, vendas: 0 };
    atual.vendas += 1;
    mapa.set(id, atual);
  }
  const vinc = new Map(((vinculos ?? []) as Json[]).map((x) => [String(x.id_externo), String(x.colaborador_id)]));
  return {
    responsaveis: [...mapa.values()].sort((a, b) => b.vendas - a.vendas).map((r) => ({ ...r, colaboradorId: vinc.get(r.rdUserId) ?? null })),
    equipe: ((equipe ?? []) as Json[]).map((c) => ({ id: c.id, nome: c.nome, cargo: c.cargo })),
  };
}

export async function vincularResponsavel(db: Db, rdUserId: string, colaboradorId: string, ator: string) {
  if (!rdUserId.trim() || !/^[0-9a-f-]{36}$/i.test(colaboradorId)) return { status: 400, corpo: { erro: "Informe o usuário do RD e a pessoa da equipe." } };
  const { data: c } = await db.from("colaboradores").select("id,cargo,ativo").eq("id", colaboradorId).maybeSingle();
  if (!c || !(c as Json).ativo || !["vendedora", "sdr"].includes(String((c as Json).cargo))) return { status: 400, corpo: { erro: "Escolha uma vendedora ou SDR ativa." } };
  const { error } = await db.from("colaborador_vinculos_externos").insert({ provedor: "rd_station", id_externo: rdUserId.trim(), colaborador_id: colaboradorId, criado_por: ator });
  if (error) return { status: (error as { code?: string }).code === "23505" ? 409 : 500, corpo: { erro: (error as { code?: string }).code === "23505" ? "Este usuário do RD já tem vínculo. Remova o atual para trocar." : "Não foi possível gravar o vínculo." } };
  // Recalcula só as vendas desse responsável: vendedora_id é preenchido pelo vínculo estável.
  const { data: vendas } = await db.from("novas_vendas").select("id").eq("rd_owner_id", rdUserId.trim());
  let recalculadas = 0;
  for (const v of (vendas ?? []) as Json[]) {
    const { error: e } = await db.rpc("rd_recalcular_pendencias_venda", { p_venda_id: v.id, p_origem: "vinculo_equipe", p_importacao_id: null, p_ator: ator });
    if (!e) recalculadas += 1;
  }
  await db.from("logs_alteracoes").insert({ usuario: ator, acao: "vinculou_responsavel_rd", entidade: "colaboradores", entidade_id: colaboradorId, detalhes: { rd_user_id: rdUserId.trim(), vendas_recalculadas: recalculadas } });
  return { status: 200, corpo: { ok: true, vendasRecalculadas: recalculadas } };
}

export async function pendenciasApi(request: Request, env: Env, r: Reprocessadores): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const ehPendencias = path === "/api/admin/integrations/pendencias" || path.startsWith("/api/admin/integrations/pendencias/");
  const ehResponsaveis = path === "/api/admin/integrations/rd-station/responsaveis";
  if (!ehPendencias && !ehResponsaveis) return null;
  const db = createServiceSupabaseClient(env);

  if (request.method === "GET") {
    const auth = await exigir(request, env, ehResponsaveis ? PERMISSOES_ADMIN.EQUIPE_GERENCIAR : PERMISSOES_ADMIN.CRM_IMPORTAR);
    if (auth instanceof Response) return auth;
    if (ehResponsaveis) return json(await responsaveisRd(db));
    if (path === "/api/admin/integrations/pendencias") return json(await listarPendencias(db, { estado: url.searchParams.get("estado"), tipo: url.searchParams.get("tipo"), limite: Number(url.searchParams.get("limite") || 200) }));
    return json({ erro: "Rota não encontrada." }, 404);
  }
  if (request.method !== "POST") return json({ erro: "Método não permitido." }, 405);
  if (!mesmaOrigem(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  const body = await request.json().catch(() => ({})) as Json;

  if (ehResponsaveis) {
    const auth = await exigir(request, env, PERMISSOES_ADMIN.EQUIPE_GERENCIAR);
    if (auth instanceof Response) return auth;
    const res = await vincularResponsavel(db, String(body.rdUserId ?? ""), String(body.colaboradorId ?? ""), auth.ator);
    return json(res.corpo, res.status);
  }
  const auth = await exigir(request, env, PERMISSOES_ADMIN.CRM_IMPORTAR);
  if (auth instanceof Response) return auth;
  const acao = path.match(/^\/api\/admin\/integrations\/pendencias\/([0-9a-f-]{36})\/(reprocessar|descartar)$/);
  if (!acao) return json({ erro: "Rota não encontrada." }, 404);
  const res = acao[2] === "reprocessar"
    ? await reprocessarPendencia(env, db, acao[1], auth.ator, r)
    : await descartarPendencia(db, acao[1], auth.ator, String(body.motivo ?? ""));
  return json(res.corpo, res.status);
}
