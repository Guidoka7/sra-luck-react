import { publicError } from "./http-security";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { getCookie, verificarTokenAdmin } from "./session";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
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

  if (path === "/api/admin/novas-vendas" && request.method === "GET") {
    const status = url.searchParams.get("status");
    // A listagem do funil não precisa carregar payload_original nem snapshots
    // pesados do RD. Com centenas/milhares de vendas isso reduz bastante o JSON
    // transferido e o tempo até a primeira pintura no Admin.
    let query = db.from("novas_vendas")
      .select("id,rd_station_id,cliente_id,nome_completo,cpf,telefone,email,data_venda,vendedora_responsavel,valor_contrato,quantidade_parcelas,valor_parcela,taxa_administrativa,tipo_venda,origem_venda,status,created_at,updated_at,vendedora_id")
      .order("data_venda", { ascending: false });
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return json({ erro: publicError(error) }, 500);
    return json({ vendas: data ?? [] });
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
