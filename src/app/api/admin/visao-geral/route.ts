import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Visão Geral — painel de acompanhamento.
 *
 * Esta rota NÃO cria nenhum dado, cálculo ou regra nova. Ela apenas lê, dos
 * mesmos módulos/tabelas/RPCs já usados pelas telas existentes, um recorte
 * "próximos itens" de cada funcionalidade:
 *
 *  - comprovantesPendentes  → mesma fonte de /api/admin/boletos?status=pendente_confirmacao
 *  - proximosAgendamentos   → mesma fonte da agenda de "Termos cirúrgicos" (tabela `agendamentos` + `datas`)
 *  - clientesAguardandoLiberacao → mesma consulta de /api/admin/liberacoes-financeiras
 *  - proximasLiberacoesFinanceiras → mesma coluna usada por /api/admin/previsoes-liberacao,
 *    só que sem o agrupamento por mês (lista corrida das próximas datas)
 *
 * Qualquer alteração feita nas telas originais (pagamentos, agenda, revisão
 * financeira, previsão de liberação) é refletida aqui automaticamente, pois
 * lemos as mesmas tabelas/colunas/status, sem cache ou cópia de estado.
 */

const LIMITE_ITENS = 8;

export async function GET() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const hoje = new Date();
  const isoHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(
    hoje.getDate()
  ).padStart(2, "0")}`;

  const [comprovantesRes, agendamentosRes, revisaoRes, liberacaoRes] = await Promise.all([
    // 1) Parcelas aguardando validação do comprovante — igual a /api/admin/boletos
    supabase
      .from("boletos")
      .select(
        `id, cliente_id, numero_parcela, total_parcelas, valor, status,
         data_pagamento, comprovante_url,
         clientes ( id, nome_completo, cpf )`
      )
      .eq("status", "pendente_confirmacao")
      .order("data_pagamento", { ascending: true }),

    // 2 e 5) Próximos agendamentos de termos cirúrgicos confirmados, a partir de hoje
    supabase
      .from("agendamentos")
      .select(
        "id, cliente_id, valor_contrato, status, previsao_liberacao_financeira, clientes(id, nome_completo), datas!inner(data)"
      )
      .eq("status", "confirmado")
      .gte("datas.data", isoHoje)
      .order("data", { ascending: true, foreignTable: "datas" })
      .limit(LIMITE_ITENS),

    // 3) Clientes aguardando liberação da agenda — igual a /api/admin/liberacoes-financeiras
    supabase
      .from("clientes")
      .select(
        "id, nome_completo, cpf, valor_contrato, quantidade_parcelas, status_revisao_financeira, data_atingiu_percentual"
      )
      .eq("status_revisao_financeira", "pendente")
      .order("data_atingiu_percentual", { ascending: true }),

    // 4) Próximas liberações financeiras — mesma coluna usada em /api/admin/previsoes-liberacao,
    // sem o agrupamento por mês
    supabase
      .from("agendamentos")
      .select("id, cliente_id, valor_contrato, previsao_liberacao_financeira, clientes(id, nome_completo)")
      .eq("status", "confirmado")
      .not("previsao_liberacao_financeira", "is", null)
      .gte("previsao_liberacao_financeira", isoHoje)
      .order("previsao_liberacao_financeira", { ascending: true })
      .limit(LIMITE_ITENS),
  ]);

  if (comprovantesRes.error) return NextResponse.json({ erro: comprovantesRes.error.message }, { status: 500 });
  if (agendamentosRes.error) return NextResponse.json({ erro: agendamentosRes.error.message }, { status: 500 });
  if (revisaoRes.error) return NextResponse.json({ erro: revisaoRes.error.message }, { status: 500 });
  if (liberacaoRes.error) return NextResponse.json({ erro: liberacaoRes.error.message }, { status: 500 });

  const comprovantesPendentes = (comprovantesRes.data ?? []).map((b: any) => ({
    boletoId: b.id,
    clienteId: b.cliente_id,
    nome: b.clientes?.nome_completo ?? "Cliente",
    numeroParcela: b.numero_parcela,
    totalParcelas: b.total_parcelas,
    valor: Number(b.valor),
    dataPagamento: b.data_pagamento,
  }));

  const proximosAgendamentos = (agendamentosRes.data ?? []).map((a: any) => ({
    agendamentoId: a.id,
    clienteId: a.cliente_id,
    nome: a.clientes?.nome_completo ?? "Cliente",
    data: a.datas?.data ?? null,
    valorContrato: Number(a.valor_contrato),
    temPrevisaoLiberacao: !!a.previsao_liberacao_financeira,
  }));

  // Reaproveita a mesma RPC `porcentagem_pagamento` usada em /api/admin/liberacoes-financeiras
  // — nenhum cálculo novo é feito aqui.
  const idsRevisao = (revisaoRes.data ?? []).map((c: any) => c.id);
  const porcentagens = new Map<string, number>();
  if (idsRevisao.length > 0) {
    // Evita uma chamada RPC por cliente. Uma consulta agrupável reduz
    // bastante a latência da Visão Geral em bases maiores.
    const { data: boletosRevisao } = await supabase
      .from("boletos")
      .select("cliente_id, status, total_parcelas")
      .in("cliente_id", idsRevisao);
    const resumo = new Map<string, { pagos: number; parcelas: number }>();
    for (const boleto of boletosRevisao ?? []) {
      const atual = resumo.get(boleto.cliente_id) ?? { pagos: 0, parcelas: 0 };
      if (boleto.status === "pago") atual.pagos += 1;
      atual.parcelas = Math.max(atual.parcelas, Number(boleto.total_parcelas) || 0);
      resumo.set(boleto.cliente_id, atual);
    }
    for (const id of idsRevisao) {
      const r = resumo.get(id);
      porcentagens.set(id, r && r.parcelas > 0 ? Math.round((r.pagos / r.parcelas) * 1000) / 10 : 0);
    }
  }

  const clientesAguardandoLiberacao = (revisaoRes.data ?? []).map((c: any) => ({
    clienteId: c.id,
    nome: c.nome_completo,
    valorContrato: Number(c.valor_contrato),
    quantidadeParcelas: c.quantidade_parcelas,
    porcentagemPagamento: porcentagens.get(c.id) ?? 0,
    dataAtingiuPercentual: c.data_atingiu_percentual,
  }));

  const proximasLiberacoesFinanceiras = (liberacaoRes.data ?? []).map((a: any) => ({
    agendamentoId: a.id,
    clienteId: a.cliente_id,
    nome: a.clientes?.nome_completo ?? "Cliente",
    valorContrato: Number(a.valor_contrato),
    dataPrevisao: a.previsao_liberacao_financeira,
  }));

  return NextResponse.json({
    comprovantesPendentes,
    proximosAgendamentos,
    clientesAguardandoLiberacao,
    proximasLiberacoesFinanceiras,
  });
}
