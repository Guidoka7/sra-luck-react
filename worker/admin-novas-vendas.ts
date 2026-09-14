import { createServiceSupabaseClient, type Env } from "./supabase";
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

/**
 * Staging de vendas (hoje sem integração RD Station ativa — a tabela existe e é real,
 * só ainda não é alimentada automaticamente). Permite, quando alguém inserir uma venda
 * aqui (manualmente ou futuramente via webhook), fazer a conferência interna e o
 * cadastro da cliente sem reentrada manual dos dados já recebidos — fluxo de
 * BUSINESS-RULES.md §5.
 */
export async function adminNovasVendas(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/admin/novas-vendas")) return null;

  const auth = await exigirAdmin(request, env);
  if (!auth) return json({ erro: "Sessão administrativa expirada." }, 401);
  const db = createServiceSupabaseClient(env);

  if (path === "/api/admin/novas-vendas" && request.method === "GET") {
    const status = url.searchParams.get("status");
    let query = db.from("novas_vendas").select("*").order("data_venda", { ascending: false });
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return json({ erro: error.message }, 500);
    return json({ vendas: data ?? [] });
  }

  const cadastrar = path.match(/^\/api\/admin\/novas-vendas\/([^/]+)\/cadastrar$/);
  if (cadastrar && request.method === "POST") {
    const id = decodeURIComponent(cadastrar[1]);
    const { data: venda, error: erroVenda } = await db.from("novas_vendas").select("*").eq("id", id).maybeSingle();
    if (erroVenda) return json({ erro: erroVenda.message }, 500);
    if (!venda) return json({ erro: "Venda não encontrada." }, 404);
    if (venda.cliente_id) return json({ erro: "Esta venda já está vinculada a uma cliente." }, 409);

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const cpf = String(body.cpf ?? venda.cpf ?? "").replace(/\D/g, "");
    const dataNascimento = String(body.dataNascimento ?? "");
    if (cpf.length !== 11 || !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
      return json({ erro: "Informe CPF (11 dígitos) e data de nascimento para concluir o cadastro." }, 400);
    }

    const { data: cliente, error: erroCliente } = await db.from("clientes").insert({
      nome_completo: venda.nome_completo,
      cpf,
      data_nascimento: dataNascimento,
      telefone: venda.telefone,
      email: venda.email,
      valor_contrato: Number(venda.valor_contrato ?? 0),
      taxa_administrativa_percentual: Number(venda.taxa_administrativa ?? 0),
      quantidade_parcelas: venda.quantidade_parcelas ?? null,
      vendedora_id: venda.vendedora_id ?? null,
      ativo: true,
      status_cirurgia: "nao_agendada",
      status_financeiro: "a_pagar",
    }).select("*").single();
    if (erroCliente) {
      return json({ erro: erroCliente.code === "23505" ? "Já existe uma cliente cadastrada com esse CPF." : erroCliente.message }, 400);
    }

    const { error: erroUpdate } = await db.from("novas_vendas")
      .update({ cliente_id: cliente.id, status: "aguardando_boletos", updated_at: new Date().toISOString() })
      .eq("id", id);
    if (erroUpdate) return json({ erro: erroUpdate.message }, 500);

    await db.from("logs_alteracoes").insert({
      usuario: auth.adminId,
      acao: "cadastrou_cliente_a_partir_de_venda",
      entidade: "clientes",
      entidade_id: cliente.id,
      detalhes: { novaVendaId: id, rdStationId: venda.rd_station_id, nomeCliente: cliente.nome_completo },
    });

    return json({ cliente, venda: { ...venda, cliente_id: cliente.id, status: "aguardando_boletos" } });
  }

  return json({ erro: "Rota de novas vendas não encontrada." }, 404);
}
