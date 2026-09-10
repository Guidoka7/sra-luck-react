import { createServiceSupabaseClient, type Env } from "./supabase";
import { exigirAdmin } from "./admin-auth";

const LIMITE_ITENS = 8;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

export async function adminVisaoGeral(request: Request, env: Env): Promise<Response> {
  const authError = await exigirAdmin(request, env);
  if (authError) return authError;

  try {
    const supabase = createServiceSupabaseClient(env);
    const hoje = new Date();
    const isoHoje = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, "0")}-${String(hoje.getUTCDate()).padStart(2, "0")}`;

    const [comprovantesRes, agendamentosRes, revisaoRes, liberacaoRes] = await Promise.all([
      supabase.from("boletos").select("id, cliente_id, numero_parcela, total_parcelas, valor, status, data_pagamento, comprovante_url, clientes ( id, nome_completo, cpf )").eq("status", "pendente_confirmacao").order("data_pagamento", { ascending: true }).limit(LIMITE_ITENS),
      supabase.from("agendamentos").select("id, cliente_id, valor_contrato, status, previsao_liberacao_financeira, clientes(id, nome_completo), datas!inner(data)").eq("status", "confirmado").gte("datas.data", isoHoje).order("data", { ascending: true, foreignTable: "datas" }).limit(LIMITE_ITENS),
      supabase.from("clientes").select("id, nome_completo, cpf, valor_contrato, quantidade_parcelas, status_revisao_financeira, data_atingiu_percentual").eq("status_revisao_financeira", "pendente").order("data_atingiu_percentual", { ascending: true }).limit(LIMITE_ITENS),
      supabase.from("agendamentos").select("id, cliente_id, valor_contrato, previsao_liberacao_financeira, clientes(id, nome_completo)").eq("status", "confirmado").not("previsao_liberacao_financeira", "is", null).gte("previsao_liberacao_financeira", isoHoje).order("previsao_liberacao_financeira", { ascending: true }).limit(LIMITE_ITENS),
    ]);

    if (comprovantesRes.error) return json({ erro: comprovantesRes.error.message }, 500);
    if (agendamentosRes.error) return json({ erro: agendamentosRes.error.message }, 500);
    if (revisaoRes.error) return json({ erro: revisaoRes.error.message }, 500);
    if (liberacaoRes.error) return json({ erro: liberacaoRes.error.message }, 500);

    const idsRevisao = (revisaoRes.data ?? []).map((c) => c.id as string);
    const porcentagens = new Map<string, number>();
    if (idsRevisao.length > 0) {
      const { data: boletosRevisao, error } = await supabase.from("boletos").select("cliente_id, status, total_parcelas").in("cliente_id", idsRevisao);
      if (error) return json({ erro: error.message }, 500);
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

    return json({
      comprovantesPendentes: (comprovantesRes.data ?? []).map((b) => ({ boletoId: b.id, clienteId: b.cliente_id, nome: b.clientes?.nome_completo ?? "Cliente", numeroParcela: b.numero_parcela, totalParcelas: b.total_parcelas, valor: Number(b.valor), dataPagamento: b.data_pagamento })),
      proximosAgendamentos: (agendamentosRes.data ?? []).map((a) => ({ agendamentoId: a.id, clienteId: a.cliente_id, nome: a.clientes?.nome_completo ?? "Cliente", data: a.datas?.data ?? null, valorContrato: Number(a.valor_contrato), temPrevisaoLiberacao: Boolean(a.previsao_liberacao_financeira) })),
      clientesAguardandoLiberacao: (revisaoRes.data ?? []).map((c) => ({ clienteId: c.id, nome: c.nome_completo, valorContrato: Number(c.valor_contrato), quantidadeParcelas: c.quantidade_parcelas, porcentagemPagamento: porcentagens.get(c.id) ?? 0, dataAtingiuPercentual: c.data_atingiu_percentual })),
      proximasLiberacoesFinanceiras: (liberacaoRes.data ?? []).map((a) => ({ agendamentoId: a.id, clienteId: a.cliente_id, nome: a.clientes?.nome_completo ?? "Cliente", valorContrato: Number(a.valor_contrato), dataPrevisao: a.previsao_liberacao_financeira })),
    });
  } catch (error) {
    console.error("Falha na visão geral administrativa:", error);
    return json({ erro: "Serviço temporariamente indisponível." }, 503);
  }
}
