import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { CLIENTE_COOKIE_NAME, verificarTokenSessao } from "@/lib/session";

const FORMAS = ["cartao", "pix", "cheques", "boleto_100"] as const;
type Forma = (typeof FORMAS)[number];

async function clienteDaSessao(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE_NAME)?.value;
  return verificarTokenSessao(token);
}

export async function GET(req: NextRequest) {
  const sessao = await clienteDaSessao(req);
  if (!sessao) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const supabase = createServiceSupabaseClient();
  const [{ data: solicitacao, error }, { data: cliente }] = await Promise.all([
    supabase.from("solicitacoes_liberacao_financeira")
      .select("id, forma_custeio, saldo_restante, taxa_cartao, total_com_taxa, status, observacao, agendamento_id, created_at, updated_at")
      .eq("cliente_id", sessao.clienteId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("clientes")
      .select("status_revisao_financeira, financeiro_saldo_restante, financeiro_taxa_cartao, financeiro_total_com_taxa, financeiro_formas_custeio, financeiro_confirmado_em")
      .eq("id", sessao.clienteId).single(),
  ]);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  const formasPermitidas = Array.isArray(cliente?.financeiro_formas_custeio) ? cliente.financeiro_formas_custeio : [];
  return NextResponse.json({
    solicitacao: solicitacao ?? null,
    financeiro: {
      confirmado: cliente?.status_revisao_financeira === "aprovada" && cliente?.financeiro_saldo_restante != null,
      saldoRestante: cliente?.financeiro_saldo_restante ?? null,
      taxaCartao: cliente?.financeiro_taxa_cartao ?? 5.4,
      totalComTaxa: cliente?.financeiro_total_com_taxa ?? null,
      formasCusteio: formasPermitidas,
      confirmadoEm: cliente?.financeiro_confirmado_em ?? null,
    },
  });
}

export async function POST(req: NextRequest) {
  const sessao = await clienteDaSessao(req);
  if (!sessao) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const formaCusteio = body.formaCusteio as Forma | undefined;
  if (!formaCusteio || !FORMAS.includes(formaCusteio)) return NextResponse.json({ erro: "Escolha uma forma de custeio válida." }, { status: 400 });

  const supabase = createServiceSupabaseClient();
  const { data: cliente, error: erroCliente } = await supabase
    .from("clientes")
    .select("id, nome_completo, status_revisao_financeira, financeiro_saldo_restante, financeiro_taxa_cartao, financeiro_total_com_taxa, financeiro_formas_custeio")
    .eq("id", sessao.clienteId).single();
  if (erroCliente || !cliente) return NextResponse.json({ erro: "Cliente não encontrada." }, { status: 404 });
  if (cliente.status_revisao_financeira !== "aprovada" || cliente.financeiro_saldo_restante == null) return NextResponse.json({ erro: "O levantamento financeiro ainda não foi confirmado pela nossa equipe." }, { status: 409 });

  const formasPermitidas = (Array.isArray(cliente.financeiro_formas_custeio) ? cliente.financeiro_formas_custeio : []) as string[];
  if (!formasPermitidas.includes(formaCusteio)) return NextResponse.json({ erro: "Essa forma de custeio não está disponível para o seu contrato." }, { status: 409 });

  const saldoRestante = Math.round(Number(cliente.financeiro_saldo_restante) * 100) / 100;
  const taxaCartao = formaCusteio === "cartao" ? Number(cliente.financeiro_taxa_cartao ?? 5.4) : 0;
  const totalComTaxa = formaCusteio === "cartao"
    ? Math.round((saldoRestante * (1 + taxaCartao / 100)) * 100) / 100
    : saldoRestante;

  const { data: agendamentoAtivo } = await supabase.from("agendamentos")
    .select("id")
    .eq("cliente_id", cliente.id)
    .eq("status", "confirmado")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: existente } = await supabase.from("solicitacoes_liberacao_financeira")
    .select("id, status, forma_custeio, saldo_restante, taxa_cartao, total_com_taxa, agendamento_id")
    .eq("cliente_id", cliente.id).in("status", ["pendente", "em_analise", "aprovada"]).order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (existente) {
    if (!existente.agendamento_id && agendamentoAtivo?.id) {
      const { data: vinculada, error: erroVinculo } = await supabase.from("solicitacoes_liberacao_financeira")
        .update({ agendamento_id: agendamentoAtivo.id })
        .eq("id", existente.id)
        .select("id, status, forma_custeio, saldo_restante, taxa_cartao, total_com_taxa, agendamento_id")
        .single();
      if (erroVinculo) return NextResponse.json({ erro: erroVinculo.message }, { status: 500 });
      return NextResponse.json({ solicitacao: vinculada });
    }
    return NextResponse.json({ erro: "Sua escolha de custeio já foi enviada para nossa equipe.", solicitacao: existente }, { status: 409 });
  }

  const observacao = formaCusteio === "cheques" || formaCusteio === "boleto_100"
    ? "Forma de custeio sujeita a análise de até 5 dias úteis."
    : "A escolha foi registrada e retornou para o painel administrativo.";

  const { data, error } = await supabase.from("solicitacoes_liberacao_financeira").insert({
    cliente_id: cliente.id,
    agendamento_id: agendamentoAtivo?.id ?? null,
    forma_custeio: formaCusteio,
    saldo_restante: saldoRestante,
    taxa_cartao: taxaCartao,
    total_com_taxa: totalComTaxa,
    status: "pendente",
    observacao,
  }).select("id, forma_custeio, saldo_restante, taxa_cartao, total_com_taxa, status, observacao, agendamento_id, created_at").single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  await supabase.from("logs_alteracoes").insert({
    usuario: `cliente:${cliente.id}`,
    acao: "solicitou_liberacao_financeira",
    entidade: "solicitacoes_liberacao_financeira",
    entidade_id: data.id,
    detalhes: { cliente: cliente.nome_completo, formaCusteio, saldoRestante, taxaCartao, totalComTaxa, observacao, agendamentoId: agendamentoAtivo?.id ?? null },
  });
  return NextResponse.json({ solicitacao: data });
}
