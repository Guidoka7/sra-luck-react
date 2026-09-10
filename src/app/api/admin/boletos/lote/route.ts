import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function PATCH(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0) : [];
  const acao = body.acao as string | undefined;
  const acoes = ["marcar_pago", "confirmar", "rejeitar", "reabrir", "suspender", "excluir"];
  if (!ids.length || ids.length > 500) return NextResponse.json({ erro: "Selecione entre 1 e 500 parcelas." }, { status: 400 });
  if (!acao || !acoes.includes(acao)) return NextResponse.json({ erro: "Ação inválida." }, { status: 400 });

  const { data: boletos, error: erroBusca } = await supabase.from("boletos").select("id, cliente_id, numero_parcela, total_parcelas, valor, data_vencimento, status, suspensa").in("id", ids);
  if (erroBusca) return NextResponse.json({ erro: erroBusca.message }, { status: 500 });
  if (!boletos?.length) return NextResponse.json({ erro: "Nenhuma parcela encontrada." }, { status: 404 });

  if (["reabrir", "suspender", "excluir"].includes(acao) && boletos.some((b) => b.status === "pago")) {
    return NextResponse.json({ erro: "Parcelas pagas não podem ser alteradas, suspensas ou excluídas." }, { status: 400 });
  }

  if (acao === "marcar_pago") {
    const elegiveis = boletos.filter((b) => b.status !== "pago");
    if (!elegiveis.length) return NextResponse.json({ erro: "Nenhuma parcela aberta foi selecionada." }, { status: 400 });
    const dataPagamento = new Date().toISOString().slice(0, 10);
    const { data: atualizados, error } = await supabase.from("boletos").update({ status: "pago", data_pagamento: dataPagamento }).in("id", elegiveis.map((b) => b.id)).select("id, cliente_id, numero_parcela, valor, status, data_pagamento");
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    await supabase.from("logs_alteracoes").insert(elegiveis.map((b) => ({ usuario: user.email ?? "admin", acao: "marcou_pagamento_manual", entidade: "boleto", entidade_id: b.id, detalhes: { cliente_id: b.cliente_id, numero_parcela: b.numero_parcela, valor: b.valor } })));
    return NextResponse.json({ boletos: atualizados ?? [], total: atualizados?.length ?? 0 });
  }

  if (acao === "confirmar" || acao === "rejeitar") {
    const elegiveis = boletos.filter((b) => b.status === "pendente_confirmacao");
    if (!elegiveis.length) return NextResponse.json({ erro: "Nenhuma parcela selecionada está aguardando confirmação." }, { status: 400 });
    const novoStatus = acao === "confirmar" ? "pago" : "rejeitado";
    const dataPagamento = acao === "confirmar" ? new Date().toISOString().slice(0, 10) : null;
    const { data: atualizados, error } = await supabase.from("boletos").update({ status: novoStatus, data_pagamento: dataPagamento }).in("id", elegiveis.map((b) => b.id)).select("id, cliente_id, numero_parcela, valor, status, data_pagamento");
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    await supabase.from("logs_alteracoes").insert(elegiveis.map((b) => ({ usuario: user.email ?? "admin", acao: acao === "confirmar" ? "confirmou_pagamento" : "rejeitou_pagamento", entidade: "boleto", entidade_id: b.id, detalhes: { cliente_id: b.cliente_id, numero_parcela: b.numero_parcela } })));
    return NextResponse.json({ boletos: atualizados ?? [], total: atualizados?.length ?? 0 });
  }

  if (acao === "reabrir") {
    const elegiveis = boletos.filter((b) => b.status !== "pago");
    const { data: atualizados, error } = await supabase.from("boletos").update({ status: "nao_pago", data_pagamento: null, suspensa: false }).in("id", elegiveis.map((b) => b.id)).select("id, cliente_id, numero_parcela, status, valor, data_vencimento");
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    await supabase.from("logs_alteracoes").insert(elegiveis.map((b) => ({ usuario: user.email ?? "admin", acao: "reabriu_parcela", entidade: "boleto", entidade_id: b.id, detalhes: { cliente_id: b.cliente_id, numero_parcela: b.numero_parcela, status_anterior: b.status } })));
    return NextResponse.json({ boletos: atualizados ?? [], total: atualizados?.length ?? 0 });
  }

  const clientes = [...new Set(boletos.map((b) => b.cliente_id))];

  if (acao === "excluir") {
    const elegiveis = boletos.filter((b) => b.status !== "pago");
    const idsExcluir = elegiveis.map((b) => b.id);
    const { error } = await supabase.from("boletos").delete().in("id", idsExcluir);
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

    for (const clienteId of clientes) {
      const { data: restantes } = await supabase.from("boletos").select("id, numero_parcela, status").eq("cliente_id", clienteId).order("numero_parcela", { ascending: true });
      const pagos = (restantes ?? []).filter((b) => b.status === "pago");
      const abertas = (restantes ?? []).filter((b) => b.status !== "pago");
      const total = Math.max((restantes ?? []).length, pagos.reduce((maior, b) => Math.max(maior, Number(b.numero_parcela)), 0));
      const vagas = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !pagos.some((p) => Number(p.numero_parcela) === n)).slice(0, abertas.length);
      for (let i = 0; i < abertas.length; i++) await supabase.from("boletos").update({ numero_parcela: 10000 + i }).eq("id", abertas[i].id);
      for (let i = 0; i < abertas.length; i++) await supabase.from("boletos").update({ numero_parcela: vagas[i], total_parcelas: total }).eq("id", abertas[i].id);
      await supabase.from("clientes").update({ quantidade_parcelas: total }).eq("id", clienteId);
    }

    await supabase.from("logs_alteracoes").insert(elegiveis.map((b) => ({ usuario: user.email ?? "admin", acao: "excluiu_parcela", entidade: "boleto", entidade_id: b.id, detalhes: { cliente_id: b.cliente_id, numero_parcela: b.numero_parcela, valor: b.valor, data_vencimento: b.data_vencimento } })));
    return NextResponse.json({ total: idsExcluir.length });
  }

  const selecionadosPorCliente = new Map<string, Set<string>>();
  for (const b of boletos) {
    if (!selecionadosPorCliente.has(b.cliente_id)) selecionadosPorCliente.set(b.cliente_id, new Set());
    selecionadosPorCliente.get(b.cliente_id)!.add(b.id);
  }

  for (const [clienteId, selecionadosCliente] of selecionadosPorCliente) {
    const { data: todas, error } = await supabase.from("boletos").select("id, numero_parcela, status, suspensa").eq("cliente_id", clienteId).order("numero_parcela", { ascending: true });
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    const abertas = (todas ?? []).filter((b) => b.status !== "pago");
    const vagas = abertas.map((b) => Number(b.numero_parcela)).sort((a, b) => a - b);
    const ativas = abertas.filter((b) => !selecionadosCliente.has(b.id) && !b.suspensa);
    const suspensasAntigas = abertas.filter((b) => !selecionadosCliente.has(b.id) && b.suspensa);
    const novasSuspensas = abertas.filter((b) => selecionadosCliente.has(b.id));
    const ordem = [...ativas, ...suspensasAntigas, ...novasSuspensas];
    for (let i = 0; i < ordem.length; i++) await supabase.from("boletos").update({ numero_parcela: 10000 + i }).eq("id", ordem[i].id);
    for (let i = 0; i < ordem.length; i++) {
      const b = ordem[i];
      const novaSuspensa = novasSuspensas.some((s) => s.id === b.id);
      const update: Record<string, unknown> = { numero_parcela: vagas[i], suspensa: novaSuspensa || suspensasAntigas.some((s) => s.id === b.id) };
      if (novaSuspensa) { update.suspensa_em = new Date().toISOString(); update.suspensa_por = user.email ?? "admin"; }
      await supabase.from("boletos").update(update).eq("id", b.id);
    }
  }

  await supabase.from("logs_alteracoes").insert(boletos.map((b) => ({ usuario: user.email ?? "admin", acao: "suspendeu_parcela", entidade: "boleto", entidade_id: b.id, detalhes: { cliente_id: b.cliente_id, numero_parcela_anterior: b.numero_parcela, valor: b.valor, data_vencimento: b.data_vencimento, realocada_para_final: true } })));
  return NextResponse.json({ total: boletos.length });
}
