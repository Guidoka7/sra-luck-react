import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const { data: clientes, error } = await supabase
    .from("clientes")
    .select("id, nome_completo, cpf, valor_contrato, quantidade_parcelas, status_revisao_financeira, data_atingiu_percentual, observacao_revisao_financeira")
    .eq("status_revisao_financeira", "pendente")
    .order("data_atingiu_percentual", { ascending: true });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const ids = (clientes ?? []).map((c) => c.id);
  const porcentagens = new Map<string, number>();
  const saldos = new Map<string, number>();
  if (ids.length > 0) {
    const { data: boletos } = await supabase.from("boletos").select("cliente_id, status, valor, total_parcelas").in("cliente_id", ids);
    const resumo = new Map<string, { pagos: number; parcelas: number; saldo: number }>();
    for (const boleto of boletos ?? []) {
      const atual = resumo.get(boleto.cliente_id) ?? { pagos: 0, parcelas: 0, saldo: 0 };
      if (boleto.status === "pago") atual.pagos += 1;
      else atual.saldo += Number(boleto.valor || 0);
      atual.parcelas = Math.max(atual.parcelas, Number(boleto.total_parcelas) || 0);
      resumo.set(boleto.cliente_id, atual);
    }
    for (const id of ids) {
      const r = resumo.get(id);
      porcentagens.set(id, r && r.parcelas > 0 ? Math.round((r.pagos / r.parcelas) * 1000) / 10 : 0);
      saldos.set(id, Math.round((r?.saldo ?? 0) * 100) / 100);
    }
  }

  const pendentes = (clientes ?? []).map((c) => ({
    id: c.id,
    nome: c.nome_completo,
    cpf: c.cpf,
    valorContrato: Number(c.valor_contrato),
    quantidadeParcelas: c.quantidade_parcelas,
    porcentagemPagamento: porcentagens.get(c.id) ?? 0,
    dataAtingiuPercentual: c.data_atingiu_percentual,
    saldoRestanteEstimado: saldos.get(c.id) ?? 0,
  }));
  return NextResponse.json({ pendentes });
}
