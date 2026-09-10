import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface ClienteAgendamento {
  agendamentoId: string;
  clienteId: string;
  nome: string;
  dataTermos: string | null;
  previsaoAtual: string | null;
  valor: number;
  valorPago: number;
  parcelasPagas: number;
  totalParcelas: number;
  custeioConfirmado: boolean;
  cirurgiaRealizada: boolean;
  statusFinanceiro: string | null;
  formaCusteio: string | null;
  saldoRestante: number | null;
}

export async function GET(_req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const { data: agendamentos, error } = await supabase
    .from("agendamentos")
    .select(
      "id, cliente_id, valor_contrato, previsao_liberacao_financeira, datas(data), clientes(id, nome_completo, status_cirurgia, status_financeiro, custeio_confirmado_em, financeiro_saldo_restante), solicitacoes_liberacao_financeira(forma_custeio, saldo_restante, status, updated_at)"
    )
    .eq("status", "confirmado")
    .order("previsao_liberacao_financeira", { ascending: true, nullsFirst: true });

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const ids = [...new Set((agendamentos ?? []).map((item: any) => item.cliente_id).filter(Boolean))];
  const boletosPorCliente = new Map<string, any[]>();
  if (ids.length) {
    const { data: boletos } = await supabase
      .from("boletos")
      .select("cliente_id, numero_parcela, total_parcelas, valor, status")
      .in("cliente_id", ids);
    for (const boleto of boletos ?? []) {
      const lista = boletosPorCliente.get(boleto.cliente_id) ?? [];
      lista.push(boleto);
      boletosPorCliente.set(boleto.cliente_id, lista);
    }
  }

  const clientes: ClienteAgendamento[] = (agendamentos ?? [])
    .map((item: any) => {
      const cliente = item.clientes;
      const solicitacao = Array.isArray(item.solicitacoes_liberacao_financeira)
        ? [...item.solicitacoes_liberacao_financeira].sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0]
        : item.solicitacoes_liberacao_financeira;
      const boletos = boletosPorCliente.get(item.cliente_id) ?? [];
      const pagos = boletos.filter((b) => b.status === "pago");
      const valorPago = pagos.reduce((total, b) => total + Number(b.valor ?? 0), 0);
      const totalParcelas = Math.max(0, ...boletos.map((b) => Number(b.total_parcelas ?? 0)));
      const saldoRestante = solicitacao?.saldo_restante != null
        ? Number(solicitacao.saldo_restante)
        : (cliente?.financeiro_saldo_restante != null ? Number(cliente.financeiro_saldo_restante) : Math.max(0, Number(item.valor_contrato ?? 0) - valorPago));
      return {
        agendamentoId: item.id,
        clienteId: item.cliente_id,
        nome: cliente?.nome_completo ?? "Cliente",
        dataTermos: item.datas?.data ?? null,
        previsaoAtual: item.previsao_liberacao_financeira,
        valor: Number(item.valor_contrato ?? 0),
        valorPago: Number(valorPago.toFixed(2)),
        parcelasPagas: pagos.length,
        totalParcelas,
        custeioConfirmado: Boolean(cliente?.custeio_confirmado_em),
        cirurgiaRealizada: cliente?.status_cirurgia === "realizada",
        statusFinanceiro: cliente?.status_financeiro ?? null,
        formaCusteio: solicitacao?.forma_custeio ?? null,
        saldoRestante: Number(saldoRestante.toFixed(2)),
      };
    })
    .filter((item) => !(item.custeioConfirmado && item.cirurgiaRealizada));

  return NextResponse.json({ clientes });
}
