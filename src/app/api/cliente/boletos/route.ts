import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { CLIENTE_COOKIE_NAME, verificarTokenSessao } from "@/lib/session";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE_NAME)?.value;
  const sessao = await verificarTokenSessao(token);
  if (!sessao) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const supabase = createServiceSupabaseClient();

  const { data: cliente, error: erroCliente } = await supabase
    .from("clientes")
    .select("id, quantidade_parcelas, status_revisao_financeira, data_atingiu_percentual, observacao_revisao_financeira")
    .eq("id", sessao.clienteId)
    .single();

  if (erroCliente || !cliente) {
    return NextResponse.json({ erro: "Cliente não encontrada." }, { status: 404 });
  }

  const { data: boletos, error: erroBoletos } = await supabase
    .from("boletos")
    .select("*")
    .eq("cliente_id", cliente.id)
    .order("numero_parcela", { ascending: true });

  if (erroBoletos) {
    return NextResponse.json({ erro: "Erro ao buscar boletos." }, { status: 500 });
  }

  const { data: porcentagem } = await supabase.rpc("porcentagem_pagamento", {
    p_cliente_id: cliente.id,
  });
  // pode_agendar = já atingiu o % financeiro necessário (etapa 1).
  const { data: podeAgendar } = await supabase.rpc("pode_agendar", {
    p_cliente_id: cliente.id,
  });
  // agenda_liberada = % atingido E revisão financeira aprovada pelo admin (etapa 2, gate real).
  const { data: agendaLiberada } = await supabase.rpc("agenda_liberada", {
    p_cliente_id: cliente.id,
  });

  const parcelasPagas = (boletos ?? []).filter((b: { status: string }) => b.status === "pago").length;

  // Formato snake_case de propósito: espelha os nomes de coluna do banco e
  // o contrato já usado pelo componente TabBoletos.tsx.
  return NextResponse.json({
    cliente_id: cliente.id,
    quantidade_parcelas: cliente.quantidade_parcelas ?? (boletos?.[0]?.total_parcelas ?? 12),
    porcentagem_pagamento: Number(porcentagem ?? 0),
    pode_agendar: Boolean(podeAgendar),
    agenda_liberada: Boolean(agendaLiberada),
    status_revisao_financeira: cliente.status_revisao_financeira ?? null,
    data_atingiu_percentual: cliente.data_atingiu_percentual ?? null,
    observacao_revisao_financeira: cliente.observacao_revisao_financeira ?? null,
    parcelas_pagas: parcelasPagas,
    parcelas_nao_pagas: (boletos ?? []).length - parcelasPagas,
    boletos: (boletos ?? []).map((b: { valor: number }) => ({ ...b, valor: Number(b.valor) })),
  });
}
