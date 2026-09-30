import { publicError } from "./http-security";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { getCookie, verificarTokenAdmin } from "./session";
import { filtroRdql, opcoesCrm } from "./crm-importacao";
import { configDaFuncao, type ConfigCrm } from "./integracoes-registro";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const PAGE_SIZE = 1000;
let opcoesCrmCache: { expiraEm: number; valor: Awaited<ReturnType<typeof opcoesCrm>> } | null = null;

function nomeNoSnapshot(snapshot: unknown, tipo: "pipeline" | "stage") {
  if (!snapshot || typeof snapshot !== "object") return null;
  const obj = snapshot as Record<string, any>;
  const inline = obj[tipo];
  if (inline && typeof inline === "object") {
    const nome = String(inline.name ?? inline.nome ?? "").trim();
    if (nome) return nome;
  }
  const chaves = tipo === "pipeline"
    ? ["pipeline_name", "pipelineName", "funil_nome", "funil"]
    : ["stage_name", "stageName", "deal_stage_name", "etapa_nome", "etapa"];
  for (const chave of chaves) {
    const valor = obj[chave];
    if (typeof valor === "string" && valor.trim()) return valor.trim();
  }
  return null;
}

/** Campos escolhidos no Dev Console para o funil desta venda, com o valor lido do RD na última sincronização. */
function textoDoValor(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (Array.isArray(valor)) {
    const partes = valor.map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>).phone ?? (v as Record<string, unknown>).email ?? (v as Record<string, unknown>).value ?? (v as Record<string, unknown>).name ?? "" : v))
      .map((v) => String(v ?? "").trim()).filter(Boolean);
    return partes.length ? partes.join(", ") : null;
  }
  if (typeof valor === "object") return null;
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  return String(valor).trim() || null;
}
function camposDoConsole(snapshot: unknown) {
  const mapa = snapshot && typeof snapshot === "object" ? (snapshot as Record<string, any>)._sra_mapeamento : null;
  const campos = Array.isArray(mapa?.campos) ? mapa.campos : [];
  return campos
    .filter((c: any) => c && typeof c.rotulo === "string")
    .map((c: any) => ({ rotulo: String(c.rotulo), valor: textoDoValor(c.valor), situacao: String(c.situacao ?? "") }));
}

/** De onde a cliente veio (rd_snapshot._sra_origem, montado pela importação a partir do RD). */
function origemDaCliente(snapshot: unknown) {
  const o = snapshot && typeof snapshot === "object" ? (snapshot as Record<string, any>)._sra_origem : null;
  if (!o || typeof o !== "object" || !o.checadoEm) return null;
  const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 240) : null);
  return {
    fonte: txt(o.fonte), campanha: txt(o.campanha), comoFicouSabendo: txt(o.comoFicouSabendo), influencer: txt(o.influencer),
    cupom: txt(o.cupom), landingPage: Boolean(o.landingPage),
    situacao: String(o.situacao ?? ""), negociacoesAnalisadas: Number(o.negociacoesAnalisadas ?? 0), checadoEm: String(o.checadoEm),
    ampliada: o.ampliada && typeof o.ampliada === "object"
      ? { em: txt(o.ampliada.em), contatos: Array.isArray(o.ampliada.contatos) ? o.ampliada.contatos.length : 0, negociacoes: Number(o.ampliada.negociacoes ?? 0) }
      : null,
    evidencias: (Array.isArray(o.evidencias) ? o.evidencias : []).slice(0, 20).map((e: any) => ({
      rotulo: txt(e?.rotulo) ?? "", valor: txt(e?.valor) ?? "",
      funil: txt(e?.negociacao?.funil), criadaEm: txt(e?.negociacao?.criadaEm), propria: Boolean(e?.negociacao?.propria),
      outroContato: e?.negociacao?.outroContato?.via === "email" ? "email" : e?.negociacao?.outroContato?.via === "telefone" ? "telefone" : null,
    })),
  };
}

async function opcoesCrmComCache(env: Env) {
  if (opcoesCrmCache && opcoesCrmCache.expiraEm > Date.now()) return opcoesCrmCache.valor;
  const valor = await opcoesCrm(env);
  opcoesCrmCache = { expiraEm: Date.now() + 5 * 60_000, valor };
  return valor;
}

async function origemCrmDaVenda(env: Env, venda: Record<string, any>) {
  let funil = nomeNoSnapshot(venda.rd_snapshot, "pipeline");
  let etapa = nomeNoSnapshot(venda.rd_snapshot, "stage");
  if ((!funil || !etapa) && (venda.rd_pipeline_id || venda.rd_stage_id)) {
    try {
      const opcoes = await opcoesCrmComCache(env);
      const pipeline = (opcoes.funis ?? []).find((item) => String(item.id) === String(venda.rd_pipeline_id ?? ""));
      if (!funil) funil = pipeline?.nome ?? null;
      if (!etapa) etapa = pipeline?.etapas?.find((item) => String(item.id) === String(venda.rd_stage_id ?? ""))?.nome ?? null;
    } catch {
      // A origem continua segura mesmo se o RD estiver momentaneamente indisponível.
    }
  }
  return {
    rdStationId: venda.rd_station_id ?? null,
    pipelineId: venda.rd_pipeline_id ?? null,
    stageId: venda.rd_stage_id ?? null,
    funil,
    etapa,
    campos: camposDoConsole(venda.rd_snapshot),
    origemCliente: origemDaCliente(venda.rd_snapshot),
  };
}

async function exigirAdmin(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const token = getCookie(request, "admin_session");
  return verificarTokenAdmin(token, env.CLIENTE_SESSION_SECRET);
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

/**
 * Staging operacional de vendas recebidas do RD Station.
 *
 * O RD é fonte EXTERNA somente de leitura. Campos rd_* guardam o snapshot
 * original/atual do CRM; os campos sem prefixo rd_ são a cópia operacional
 * local e podem ser editados no Sra. Luck sem qualquer chamada de volta ao RD.
 */
export async function adminNovasVendas(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/admin/novas-vendas")) return null;

  const auth = await exigirAdmin(request, env);
  if (!auth) return json({ erro: "Sessão administrativa expirada." }, 401);
  const mutating = ["POST", "PATCH", "PUT", "DELETE"].includes(request.method);
  if (mutating && !sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  const colaborador = await buscarColaboradorAdminAtivo(auth.adminId, env).catch(() => null);
  if (!colaborador) return json({ erro: "Acesso administrativo não autorizado." }, 403);
  if (mutating && !temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.CLIENTES_EDITAR)) {
    return json({ erro: "Seu papel não tem permissão para editar ou cadastrar clientes a partir do CRM." }, 403);
  }
  const db = createServiceSupabaseClient(env);

  if (path === "/api/admin/novas-vendas/origem" && request.method === "GET") {
    const vendaId = url.searchParams.get("vendaId");
    const clienteId = url.searchParams.get("clienteId");
    if (!vendaId && !clienteId) return json({ erro: "Informe a venda ou a cliente." }, 400);
    let query = db.from("novas_vendas")
      .select("id,rd_station_id,rd_pipeline_id,rd_stage_id,rd_snapshot,updated_at")
      .order("updated_at", { ascending: false })
      .limit(1);
    query = vendaId ? query.eq("id", vendaId) : query.eq("cliente_id", clienteId!);
    const { data, error } = await query.maybeSingle();
    if (error) return json({ erro: publicError(error) }, 500);
    return json({ origem: data ? await origemCrmDaVenda(env, data as Record<string, any>) : null });
  }

  if (path === "/api/admin/novas-vendas" && request.method === "GET") {
    const status = url.searchParams.get("status");
    const escopoAtual = url.searchParams.get("escopo") === "funil_atual";
    const config = escopoAtual ? await configDaFuncao<ConfigCrm>(env, "rd_station", "importacao", { db }) : null;
    const funis = config && !config.todosFunis ? (config.funis.length ? config.funis.map((f) => f.pipelineId) : config.pipelineId ? [config.pipelineId] : []) : [];
    let ultimaImportacao: string | null = null;
    if (escopoAtual && config) {
      const { data } = await db.from("integracao_importacoes").select("iniciado_em")
        .eq("provedor", "rd_station").eq("filtro", filtroRdql(config)).eq("status", "concluida")
        .neq("origem", "webhook").order("iniciado_em", { ascending: false }).limit(1).maybeSingle();
      ultimaImportacao = data?.iniciado_em ?? null;
    }
    const vendas: Record<string, any>[] = [];
    let total: number | null = null;
    for (let pagina = 0; pagina < 100; pagina++) {
      const de = pagina * PAGE_SIZE;
      let query = db.from("novas_vendas")
        .select("id,rd_station_id,cliente_id,nome_completo,cpf,telefone,email,data_venda,vendedora_responsavel,valor_contrato,quantidade_parcelas,valor_parcela,taxa_administrativa,tipo_venda,origem_venda,status,created_at,updated_at,vendedora_id", { count: "exact" });
      if (status) query = query.eq("status", status);
      if (status === "aguardando_cadastro") query = query.is("cliente_id", null);
      if (escopoAtual && funis.length) query = query.in("rd_pipeline_id", funis);
      if (escopoAtual && ultimaImportacao) query = query.gte("sincronizado_rd_em", ultimaImportacao);
      const { data, error, count } = await query
        .order("data_venda", { ascending: false })
        .range(de, de + PAGE_SIZE - 1);
      if (error) return json({ erro: publicError(error) }, 500);
      const lote = (data ?? []) as Record<string, any>[];
      vendas.push(...lote);
      if (total == null) total = count ?? null;
      if (lote.length < PAGE_SIZE) break;
      if (pagina === 99) return json({ erro: "A lista de vendas excedeu o limite operacional de leitura." }, 500);
    }
    return json({ vendas, total: total ?? vendas.length, escopo: escopoAtual && funis.length ? "funil_atual" : "historico", atualizadoEm: ultimaImportacao });
  }

  const editarLocal = path.match(/^\/api\/admin\/novas-vendas\/([^/]+)$/);
  if (editarLocal && request.method === "PATCH") {
    const id = decodeURIComponent(editarLocal[1]);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const campos: Array<[string, string, number]> = [
      ["nomeCompleto", "nome_completo", 240],
      ["telefone", "telefone", 80],
      ["email", "email", 240],
      ["campanhaLocal", "campanha_local", 240],
      ["origemVenda", "origem_venda", 240],
      ["vendedoraResponsavel", "vendedora_responsavel", 240],
      ["tipoVenda", "tipo_venda", 120],
    ];
    for (const [entrada, coluna, max] of campos) {
      if (body[entrada] !== undefined) patch[coluna] = String(body[entrada] ?? "").trim().slice(0, max) || null;
    }
    if (body.valorContrato !== undefined) {
      const valor = Number(body.valorContrato);
      if (!Number.isFinite(valor) || valor < 0) return json({ erro: "Valor de contrato inválido." }, 400);
      patch.valor_contrato = valor;
    }
    if (body.quantidadeParcelas !== undefined) {
      const parcelas = Number(body.quantidadeParcelas);
      if (!Number.isInteger(parcelas) || parcelas <= 0) return json({ erro: "Quantidade de parcelas inválida." }, 400);
      patch.quantidade_parcelas = parcelas;
    }
    if (!Object.keys(patch).length) return json({ erro: "Nenhum campo local informado." }, 400);
    patch.updated_at = new Date().toISOString();
    const { data, error } = await db.from("novas_vendas").update(patch).eq("id", id).select("*").maybeSingle();
    if (error) return json({ erro: publicError(error) }, 500);
    if (!data) return json({ erro: "Venda não encontrada." }, 404);
    await db.from("logs_alteracoes").insert({
      usuario: colaborador.id,
      acao: "editou_venda_local_sem_sync_rd",
      entidade: "novas_vendas",
      entidade_id: id,
      detalhes: { campos: Object.keys(patch).filter((campo) => campo !== "updated_at"), escritaNoRd: false },
    });
    return json({ venda: data, escritaNoRd: false });
  }

  const cadastrar = path.match(/^\/api\/admin\/novas-vendas\/([^/]+)\/cadastrar$/);
  if (cadastrar && request.method === "POST") {
    const id = decodeURIComponent(cadastrar[1]);
    const { data: venda, error: erroVenda } = await db.from("novas_vendas").select("*").eq("id", id).maybeSingle();
    if (erroVenda) return json({ erro: publicError(erroVenda) }, 500);
    if (!venda) return json({ erro: "Venda não encontrada." }, 404);
    if (venda.cliente_id) return json({ erro: "Esta venda já está vinculada a uma cliente." }, 409);

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const cpf = String(body.cpf ?? venda.cpf ?? "").replace(/\D/g, "");
    const dataNascimento = String(body.dataNascimento ?? "");
    if (cpf.length !== 11 || !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
      return json({ erro: "Informe CPF (11 dígitos) e data de nascimento para concluir o cadastro." }, 400);
    }

    const nomeCompleto = String(body.nomeCompleto ?? venda.nome_completo ?? "").trim();
    if (!nomeCompleto) return json({ erro: "Informe o nome completo para concluir o cadastro." }, 400);
    const telefone = body.telefone !== undefined ? String(body.telefone ?? "").trim() || null : venda.telefone;
    const email = body.email !== undefined ? String(body.email ?? "").trim() || null : venda.email;
    const procedimento = body.procedimento !== undefined ? String(body.procedimento ?? "").trim() || null : null;
    const consultora = body.consultora !== undefined ? String(body.consultora ?? "").trim() || null : venda.vendedora_responsavel ?? null;
    const observacoes = body.observacoes !== undefined ? String(body.observacoes ?? "").trim() || null : null;
    const valorContrato = body.valorContrato !== undefined ? Number(body.valorContrato) : Number(venda.valor_contrato ?? 0);
    if (!Number.isFinite(valorContrato) || valorContrato < 0) return json({ erro: "Valor da carta de crédito inválido." }, 400);
    const taxaAdministrativa = body.taxaAdministrativaPercentual !== undefined ? Number(body.taxaAdministrativaPercentual) : Number(venda.taxa_administrativa ?? 0);
    if (!Number.isFinite(taxaAdministrativa) || taxaAdministrativa < 0) return json({ erro: "Taxa administrativa inválida." }, 400);
    const quantidadeParcelas = body.quantidadeParcelas !== undefined ? Number(body.quantidadeParcelas) : venda.quantidade_parcelas;
    if (quantidadeParcelas != null && (!Number.isInteger(quantidadeParcelas) || quantidadeParcelas <= 0)) {
      return json({ erro: "Quantidade de parcelas inválida." }, 400);
    }

    const { data: cliente, error: erroCliente } = await db.from("clientes").insert({
      nome_completo: nomeCompleto,
      cpf,
      data_nascimento: dataNascimento,
      telefone,
      email,
      procedimento,
      consultora,
      observacoes_internas: observacoes,
      valor_contrato: valorContrato,
      taxa_administrativa_percentual: taxaAdministrativa,
      quantidade_parcelas: quantidadeParcelas ?? null,
      vendedora_id: venda.vendedora_id ?? null,
      ativo: true,
      status_cirurgia: "nao_agendada",
      status_financeiro: "a_pagar",
    }).select("*").single();
    if (erroCliente) {
      return json({ erro: erroCliente.code === "23505" ? "Já existe uma cliente cadastrada com esse CPF." : publicError(erroCliente) }, 400);
    }

    const { error: erroUpdate } = await db.from("novas_vendas")
      .update({ cliente_id: cliente.id, status: "aguardando_boletos", updated_at: new Date().toISOString() })
      .eq("id", id);
    if (erroUpdate) return json({ erro: publicError(erroUpdate) }, 500);

    await db.from("logs_alteracoes").insert({
      usuario: colaborador.id,
      acao: "cadastrou_cliente_a_partir_de_venda",
      entidade: "clientes",
      entidade_id: cliente.id,
      detalhes: { novaVendaId: id, rdStationId: venda.rd_station_id, escritaNoRd: false },
    });

    return json({ cliente, venda: { ...venda, cliente_id: cliente.id, status: "aguardando_boletos" } });
  }

  return json({ erro: "Rota de novas vendas não encontrada." }, 404);
}
