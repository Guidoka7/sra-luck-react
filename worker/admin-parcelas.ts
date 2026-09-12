import { createServiceSupabaseClient, type Env } from "./supabase";
import { ADMIN_COOKIE_NAME, getCookie, verificarTokenAdmin } from "./session";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function lerBody(request: Request): Promise<Record<string, any>> {
  try { return await request.json(); } catch { return {}; }
}

function dataValida(data: unknown) {
  return data === null || data === undefined || (typeof data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data));
}

async function avisarCliente(db: ReturnType<typeof createServiceSupabaseClient>, clienteId: string, payload: Record<string, unknown>) {
  try {
    await db.channel(`notificacoes-cliente:${clienteId}`).send({ type: "broadcast", event: "nova_notificacao", payload });
  } catch (erro) {
    console.error("Falha no realtime das parcelas:", erro);
  }
}

export async function adminParcelas(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/admin\/clientes\/([^/]+)\/parcelas$/);
  if (!match || !["GET", "POST"].includes(request.method)) return null;
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);

  const sessao = await verificarTokenAdmin(getCookie(request, ADMIN_COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
  if (!sessao) return json({ erro: "Sessão administrativa expirada." }, 401);

  const clienteId = decodeURIComponent(match[1]);
  const db = createServiceSupabaseClient(env);

  if (request.method === "GET") {
    const [{ data: boletos, error }, { data: cliente, error: clienteError }] = await Promise.all([
      db
        .from("boletos")
        .select("*")
        .eq("cliente_id", clienteId)
        .order("numero_parcela", { ascending: true }),
      db
        .from("clientes")
        .select("id,nome_completo,valor_contrato,quantidade_parcelas,ativo,status_financeiro,updated_at")
        .eq("id", clienteId)
        .maybeSingle(),
    ]);
    if (error) return json({ erro: error.message }, 500);
    if (clienteError) return json({ erro: clienteError.message }, 500);
    if (!cliente) return json({ erro: "Cliente não encontrada." }, 404);

    const { data: historico } = await db
      .from("logs_alteracoes")
      .select("*")
      .eq("entidade_id", clienteId)
      .in("acao", ["editou_parcela", "reabriu_parcela", "excluiu_parcela", "suspendeu_parcelas", "gerou_parcelas", "alterou_quantidade_parcelas", "registrou_observacao"])
      .order("created_at", { ascending: false })
      .limit(100);

    return json({
      cliente: {
        ...cliente,
        valor_contrato: cliente.valor_contrato == null ? null : Number(cliente.valor_contrato),
      },
      boletos: (boletos ?? []).map((boleto: any) => ({ ...boleto, valor: Number(boleto.valor) })),
      parcelas: (boletos ?? []).map((boleto: any) => ({ ...boleto, valor: Number(boleto.valor) })),
      historico: historico ?? [],
    });
  }

  const body = await lerBody(request);
  const acao = String(body.acao ?? "");
  const usuario = `admin:${sessao.adminId}`;

  if (acao === "gerar") {
    const quantidade = Number(body.quantidade);
    const valorParcela = body.valorParcela === undefined || body.valorParcela === "" ? null : Number(body.valorParcela);
    const primeiroVencimento = body.primeiroVencimento || null;

    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 240) return json({ erro: "A quantidade deve ser um número inteiro entre 1 e 240." }, 400);
    if (valorParcela !== null && (!Number.isFinite(valorParcela) || valorParcela <= 0)) return json({ erro: "Valor da parcela inválido." }, 400);
    if (!dataValida(primeiroVencimento)) return json({ erro: "Data de vencimento inválida." }, 400);

    const { data: cliente } = await db.from("clientes").select("id,nome_completo,quantidade_parcelas,valor_contrato,custo_total").eq("id", clienteId).maybeSingle();
    if (!cliente) return json({ erro: "Cliente não encontrada." }, 404);

    const { data: existentes, error: existentesError } = await db
      .from("boletos")
      .select("numero_parcela,data_vencimento")
      .eq("cliente_id", clienteId)
      .order("numero_parcela", { ascending: false })
      .limit(1);
    if (existentesError) return json({ erro: existentesError.message }, 500);

    const ultima = Number(existentes?.[0]?.numero_parcela ?? 0);
    const total = ultima + quantidade;
    if (total > 240) return json({ erro: "O contrato não pode ultrapassar 240 parcelas." }, 400);

    const primeiro = primeiroVencimento || existentes?.[0]?.data_vencimento || new Date().toISOString().slice(0, 10);
    const totalBase = Number((cliente as any).custo_total ?? cliente.valor_contrato ?? 0);
    const valor = valorParcela ?? Number((totalBase / Math.max(total, 1)).toFixed(2));
    const rows = Array.from({ length: quantidade }, (_, index) => {
      const numero = ultima + index + 1;
      const base = new Date(`${primeiro}T00:00:00`);
      base.setMonth(base.getMonth() + (primeiroVencimento ? index : index + (ultima ? 1 : 0)));
      return {
        cliente_id: clienteId,
        numero_parcela: numero,
        total_parcelas: total,
        valor,
        data_vencimento: base.toISOString().slice(0, 10),
        status: "nao_pago",
      };
    });

    const { error } = await db.from("boletos").insert(rows);
    if (error) return json({ erro: error.message }, 500);
    await db.from("boletos").update({ total_parcelas: total }).eq("cliente_id", clienteId);
    await db.from("clientes").update({ quantidade_parcelas: total }).eq("id", clienteId);
    await db.from("logs_alteracoes").insert({ usuario, acao: "gerou_parcelas", entidade: "clientes", entidade_id: clienteId, detalhes: { quantidade_adicionada: quantidade, total_anterior: ultima, total_novo: total, valor_parcela: valor } });
    await avisarCliente(db, clienteId, { tipo: "parcelamento_atualizado", quantidadeParcelas: total });
    return json({ sucesso: true, quantidadeAdicionada: quantidade, totalParcelas: total });
  }

  if (["reabrir", "excluir", "editar"].includes(acao)) {
    const boletoId = String(body.boletoId ?? "");
    if (!boletoId) return json({ erro: "Parcela não informada." }, 400);

    const { data: atual } = await db.from("boletos").select("*").eq("id", boletoId).eq("cliente_id", clienteId).maybeSingle();
    if (!atual) return json({ erro: "Parcela não encontrada." }, 404);
    if (atual.status === "pago") return json({ erro: "Parcelas pagas não podem ser alteradas." }, 400);

    if (acao === "excluir") {
      const { data: todas } = await db.from("boletos").select("id").eq("cliente_id", clienteId);
      const novoTotal = Math.max(0, (todas ?? []).length - 1);
      const { error } = await db.from("boletos").delete().eq("id", boletoId).eq("cliente_id", clienteId);
      if (error) return json({ erro: error.message }, 500);
      if (novoTotal > 0) await db.from("boletos").update({ total_parcelas: novoTotal }).eq("cliente_id", clienteId);
      await db.from("clientes").update({ quantidade_parcelas: novoTotal > 0 ? novoTotal : null }).eq("id", clienteId);
      await db.from("logs_alteracoes").insert({ usuario, acao: "excluiu_parcela", entidade: "clientes", entidade_id: clienteId, detalhes: { parcela: atual.numero_parcela, valor: atual.valor, vencimento: atual.data_vencimento, novo_total: novoTotal } });
      await avisarCliente(db, clienteId, { tipo: "parcelamento_atualizado", quantidadeParcelas: novoTotal });
      return json({ sucesso: true, totalParcelas: novoTotal });
    }

    if (acao === "reabrir") {
      const { data, error } = await db.from("boletos").update({ status: "nao_pago", data_pagamento: null, observacoes: body.observacoes ?? atual.observacoes }).eq("id", boletoId).eq("cliente_id", clienteId).select("*").single();
      if (error) return json({ erro: error.message }, 500);
      await db.from("logs_alteracoes").insert({ usuario, acao: "reabriu_parcela", entidade: "clientes", entidade_id: clienteId, detalhes: { parcela: atual.numero_parcela, status_anterior: atual.status } });
      await avisarCliente(db, clienteId, { tipo: "parcela_atualizada", parcela: atual.numero_parcela });
      return json({ boleto: { ...data, valor: Number(data.valor) } });
    }

    const valor = body.valor === undefined || body.valor === "" ? undefined : Number(body.valor);
    const dataVencimento = body.dataVencimento === undefined ? undefined : (body.dataVencimento || null);
    if (valor !== undefined && (!Number.isFinite(valor) || valor <= 0)) return json({ erro: "Valor inválido." }, 400);
    if (!dataValida(dataVencimento)) return json({ erro: "Data de vencimento inválida." }, 400);
    if (valor === undefined && dataVencimento === undefined) return json({ erro: "Informe valor ou data de vencimento." }, 400);

    const update: Record<string, unknown> = {};
    if (valor !== undefined) update.valor = valor;
    if (dataVencimento !== undefined) update.data_vencimento = dataVencimento;
    const { data, error } = await db.from("boletos").update(update).eq("id", boletoId).eq("cliente_id", clienteId).select("*").single();
    if (error) return json({ erro: error.message }, 500);
    await db.from("logs_alteracoes").insert({ usuario, acao: "editou_parcela", entidade: "clientes", entidade_id: clienteId, detalhes: { parcela: atual.numero_parcela, de: { valor: atual.valor, data_vencimento: atual.data_vencimento }, para: { valor: data.valor, data_vencimento: data.data_vencimento } } });
    await avisarCliente(db, clienteId, { tipo: "parcela_atualizada", parcela: atual.numero_parcela });
    return json({ boleto: { ...data, valor: Number(data.valor) } });
  }

  if (acao === "registrar_observacao") {
    const texto = String(body.texto ?? "").trim();
    if (!texto) return json({ erro: "Escreva uma observação antes de salvar." }, 400);
    if (texto.length > 2000) return json({ erro: "Observação muito longa (máximo de 2000 caracteres)." }, 400);

    const { data, error } = await db
      .from("logs_alteracoes")
      .insert({ usuario, acao: "registrou_observacao", entidade: "clientes", entidade_id: clienteId, detalhes: { texto } })
      .select("id,created_at")
      .single();
    if (error) return json({ erro: error.message }, 500);
    return json({ sucesso: true, observacao: { id: data.id, texto, usuario, created_at: data.created_at } });
  }

  if (acao === "suspender") {
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (!ids.length) return json({ erro: "Selecione ao menos uma parcela em aberto." }, 400);

    const { data: atuais, error } = await db.from("boletos").select("id,status,numero_parcela").eq("cliente_id", clienteId).order("numero_parcela", { ascending: true });
    if (error) return json({ erro: error.message }, 500);
    const selecionadas = (atuais ?? []).filter((boleto: any) => ids.includes(String(boleto.id)));
    if (selecionadas.length !== ids.length) return json({ erro: "Uma ou mais parcelas não pertencem a esta cliente." }, 400);
    if (selecionadas.some((boleto: any) => boleto.status === "pago")) return json({ erro: "Parcelas pagas nunca podem ser suspensas." }, 400);

    const agora = new Date().toISOString();
    const { error: erroSuspensao } = await db.from("boletos").update({ suspensa: true, suspensa_em: agora, suspensa_por: usuario }).in("id", ids).eq("cliente_id", clienteId).neq("status", "pago");
    if (erroSuspensao) return json({ erro: erroSuspensao.message }, 500);
    await db.from("logs_alteracoes").insert({ usuario, acao: "suspendeu_parcelas", entidade: "clientes", entidade_id: clienteId, detalhes: { parcelas: selecionadas.map((boleto: any) => boleto.numero_parcela), quantidade: ids.length } });
    await avisarCliente(db, clienteId, { tipo: "parcelamento_atualizado", suspensas: ids.length });
    return json({ sucesso: true, mensagem: `${ids.length} parcela(s) suspensa(s).` });
  }

  return json({ erro: "Ação inválida." }, 400);
}
