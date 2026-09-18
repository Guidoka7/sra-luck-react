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
  const db = createServiceSupabaseClient(env);

  if (path === "/api/admin/novas-vendas" && request.method === "GET") {
    const status = url.searchParams.get("status");
    let query = db.from("novas_vendas").select("*").order("data_venda", { ascending: false });
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return json({ erro: error.message }, 500);
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
      ["procedimentoLocal", "procedimento_local", 240],
      ["bancoLocal", "banco_local", 160],
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
    if (error) return json({ erro: error.message }, 500);
    if (!data) return json({ erro: "Venda não encontrada." }, 404);
    await db.from("logs_alteracoes").insert({
      usuario: auth.adminId,
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
    if (erroVenda) return json({ erro: erroVenda.message }, 500);
    if (!venda) return json({ erro: "Venda não encontrada." }, 404);
    if (venda.cliente_id) return json({ erro: "Esta venda já está vinculada a uma cliente." }, 409);

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const cpfInformado = String(body.cpf ?? venda.cpf ?? "").replace(/\D/g, "");
    const cpf = cpfInformado || null;
    if (cpf && cpf.length !== 11) return json({ erro: "CPF deve conter 11 dígitos quando informado." }, 400);

    const dataNascimentoTexto = String(body.dataNascimento ?? "").trim();
    const dataNascimento = dataNascimentoTexto || null;
    if (dataNascimento && !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
      return json({ erro: "Data de nascimento inválida." }, 400);
    }

    let clienteExistente: any = null;
    if (cpf) {
      const formatado = `${cpf.slice(0,3)}.${cpf.slice(3,6)}.${cpf.slice(6,9)}-${cpf.slice(9)}`;
      const { data } = await db.from("clientes")
        .select("id,crm_importado_em")
        .in("cpf", [cpf, formatado])
        .limit(1)
        .maybeSingle();
      clienteExistente = data ?? null;
    }

    const agora = new Date().toISOString();
    let cliente: any = clienteExistente;
    if (!cliente) {
      const { data, error: erroCliente } = await db.from("clientes").insert({
        nome_completo: venda.nome_completo ?? null,
        cpf,
        data_nascimento: dataNascimento,
        telefone: venda.telefone ?? null,
        email: venda.email ?? null,
        procedimento: venda.procedimento_local ?? null,
        consultora: venda.vendedora_responsavel ?? null,
        valor_contrato: venda.valor_contrato == null ? null : Number(venda.valor_contrato),
        quantidade_parcelas: venda.quantidade_parcelas ?? null,
        valor_parcela_plano: venda.valor_parcela == null ? null : Number(venda.valor_parcela),
        origem_venda: venda.campanha_local ?? venda.origem_venda ?? null,
        banco: venda.banco_local ?? null,
        origem_cadastro: "rd_station",
        crm_importado_em: agora,
        crm_ultimo_recebido_em: venda.sincronizado_rd_em ?? agora,
        vendedora_id: venda.vendedora_id ?? null,
        ativo: true,
        status_cirurgia: "nao_agendada",
        status_financeiro: "a_pagar",
      }).select("*").single();
      if (erroCliente) {
        return json({ erro: erroCliente.code === "23505" ? "Já existe uma cliente cadastrada com esse CPF." : erroCliente.message }, 400);
      }
      cliente = data;
    } else {
      await db.from("clientes").update({
        crm_importado_em: cliente.crm_importado_em ?? agora,
        crm_ultimo_recebido_em: venda.sincronizado_rd_em ?? agora,
      }).eq("id", cliente.id);
      const { data } = await db.from("clientes").select("*").eq("id", cliente.id).single();
      cliente = data;
    }

    const { error: erroUpdate } = await db.from("novas_vendas")
      .update({ cliente_id: cliente.id, status: "aguardando_boletos", updated_at: agora })
      .eq("id", id);
    if (erroUpdate) return json({ erro: erroUpdate.message }, 500);

    await db.from("logs_alteracoes").insert({
      usuario: auth.adminId,
      acao: "cadastrou_cliente_a_partir_de_venda",
      entidade: "clientes",
      entidade_id: cliente.id,
      detalhes: { novaVendaId: id, rdStationId: venda.rd_station_id, nomeCliente: cliente.nome_completo, escritaNoRd: false },
    });

    return json({ cliente, venda: { ...venda, cliente_id: cliente.id, status: "aguardando_boletos" }, escritaNoRd: false });
  }

  return json({ erro: "Rota de novas vendas não encontrada." }, 404);
}
