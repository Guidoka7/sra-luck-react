import { createServiceSupabaseClient, type Env } from "./supabase";

const LIMITE_ITENS = 8;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

export async function adminVisaoGeral(_request: Request, env: Env): Promise<Response> {
  try {
    const supabase = createServiceSupabaseClient(env);
    const hoje = new Date();
    const isoHoje = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, "0")}-${String(hoje.getUTCDate()).padStart(2, "0")}`;

    const [
      comprovantesRes,
      agendamentosRes,
      revisaoRes,
      liberacaoRes,
      carteiraRes,
      parcelasRes,
      clientesRes,
      novasVendasRes,
      termosHojeRes,
      cirurgiasHojeRes,
      devicesRes,
      notifHojeRes,
      credenciaisRes,
      atividadeRes,
    ] = await Promise.all([
      supabase.from("boletos").select("id, cliente_id, numero_parcela, total_parcelas, valor, status, data_pagamento, comprovante_url, clientes ( id, nome_completo, cpf )").eq("status", "pendente_confirmacao").order("data_pagamento", { ascending: true }).limit(LIMITE_ITENS),
      supabase.from("agendamentos").select("id, cliente_id, valor_contrato, status, previsao_liberacao_financeira, clientes(id, nome_completo), datas!inner(data)").eq("status", "confirmado").gte("datas.data", isoHoje).order("data", { ascending: true, foreignTable: "datas" }).limit(LIMITE_ITENS),
      supabase.from("clientes").select("id, nome_completo, cpf, valor_contrato, quantidade_parcelas, status_revisao_financeira, data_atingiu_percentual").eq("status_revisao_financeira", "pendente").order("data_atingiu_percentual", { ascending: true }).limit(LIMITE_ITENS),
      supabase.from("agendamentos").select("id, cliente_id, valor_contrato, previsao_liberacao_financeira, clientes(id, nome_completo)").eq("status", "confirmado").not("previsao_liberacao_financeira", "is", null).gte("previsao_liberacao_financeira", isoHoje).order("previsao_liberacao_financeira", { ascending: true }).limit(LIMITE_ITENS),
      supabase.from("clientes").select("id, valor_contrato, taxa_administrativa_percentual").eq("ativo", true),
      supabase.from("boletos").select("status, data_vencimento"),
      supabase.from("clientes").select("id,nome_completo,cpf,status_contrato,status_revisao_financeira,created_at").order("created_at", { ascending: false }),
      supabase.from("novas_vendas").select("id", { count: "exact", head: true }).eq("status", "aguardando_cadastro"),
      supabase.from("agendamentos").select("id,horario_termos,clientes(nome_completo),datas!inner(data)").eq("status", "confirmado").eq("datas.data", isoHoje),
      supabase.from("agendamentos").select("id", { count: "exact", head: true }).eq("data_cirurgia", isoHoje),
      supabase.from("cliente_app_devices").select("id,is_pwa_installed,last_access_at"),
      supabase.from("notificacao_logs").select("id,push_enviadas", { count: "exact" }).gte("created_at", `${isoHoje}T00:00:00`).gt("push_enviadas", 0),
      supabase.from("integracoes_credenciais").select("provedor,ativo").eq("provedor", "web_push"),
      supabase.from("logs_alteracoes").select("usuario,acao,entidade,created_at").order("created_at", { ascending: false }).limit(5),
    ]);

    if (comprovantesRes.error) return json({ erro: comprovantesRes.error.message }, 500);
    if (agendamentosRes.error) return json({ erro: agendamentosRes.error.message }, 500);
    if (revisaoRes.error) return json({ erro: revisaoRes.error.message }, 500);
    if (liberacaoRes.error) return json({ erro: liberacaoRes.error.message }, 500);
    if (carteiraRes.error) return json({ erro: carteiraRes.error.message }, 500);
    if (parcelasRes.error) return json({ erro: parcelasRes.error.message }, 500);
    if (clientesRes.error) return json({ erro: clientesRes.error.message }, 500);

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

    const comprovantes = (comprovantesRes.data ?? []) as any[];
    const agendamentos = (agendamentosRes.data ?? []) as any[];
    const revisao = (revisaoRes.data ?? []) as any[];
    const liberacoes = (liberacaoRes.data ?? []) as any[];

    const clientesAtivos = (carteiraRes.data ?? []) as any[];
    const totalClientesAtivos = clientesAtivos.length;
    const valorContratadoAtivo = clientesAtivos.reduce((soma, c) => soma + Number(c.valor_contrato ?? 0), 0);
    const ticketMedio = totalClientesAtivos > 0 ? valorContratadoAtivo / totalClientesAtivos : 0;
    const taxasValidas = clientesAtivos.map((c) => Number(c.taxa_administrativa_percentual)).filter((v) => Number.isFinite(v) && v > 0);
    const taxaAdministrativaMedia = taxasValidas.length > 0 ? taxasValidas.reduce((soma, v) => soma + v, 0) / taxasValidas.length : 0;

    const parcelas = (parcelasRes.data ?? []) as any[];
    const totalParcelas = parcelas.length;
    const parcelasVencidas = parcelas.filter((p) => p.status !== "pago" && p.data_vencimento && p.data_vencimento < isoHoje).length;
    const taxaInadimplencia = totalParcelas > 0 ? (parcelasVencidas / totalParcelas) * 100 : 0;

    const todosClientes = (clientesRes.data ?? []) as any[];
    const clientStats = {
      ativas: todosClientes.filter((c) => c.status_contrato === "ativo").length,
      suspensas: todosClientes.filter((c) => c.status_contrato === "suspenso").length,
      negativadas: todosClientes.filter((c) => c.status_contrato === "negativado").length,
      canceladas: todosClientes.filter((c) => c.status_contrato === "cancelado").length,
    };
    const novasClientesHoje = todosClientes.filter((c) => String(c.created_at ?? "").slice(0, 10) === isoHoje).length;
    const novasClientesRecentes = todosClientes.slice(0, 5).map((c) => {
      const horas = (Date.now() - new Date(c.created_at).getTime()) / (1000 * 60 * 60);
      const status = horas <= 24 ? "Nova" : c.status_revisao_financeira === "pendente" ? "Aguardando revisão" : "Cadastrada";
      return { clienteId: c.id, nome: c.nome_completo ?? "Cliente", cpf: c.cpf ?? "—", quando: String(c.created_at ?? "").slice(0, 10), status };
    });

    const dispositivos = (devicesRes.data ?? []) as any[];
    const totalDispositivos = dispositivos.length;
    const pwaInstalados = dispositivos.filter((d) => d.is_pwa_installed === true).length;
    const limiteSemAcesso = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const semAcessoRecente = dispositivos.filter((d) => !d.last_access_at || new Date(d.last_access_at).getTime() < limiteSemAcesso).length;

    const webPushConfigurado = ((credenciaisRes.data ?? []) as any[]).some((c) => c.ativo === true);

    return json({
      kpis: {
        novasClientesHoje,
        aguardandoCadastro: novasVendasRes.count ?? 0,
        aguardandoConferencia: comprovantes.length,
        clientesAtivas: clientStats.ativas,
        termosHoje: (termosHojeRes.data ?? []).length,
        cirurgiasHoje: cirurgiasHojeRes.count ?? 0,
      },
      termosHojeLista: ((termosHojeRes.data ?? []) as any[]).map((a) => ({
        agendamentoId: a.id,
        nome: (Array.isArray(a.clientes) ? a.clientes[0] : a.clientes)?.nome_completo ?? "Cliente",
        horario: a.horario_termos ?? null,
      })),
      clientStats,
      novasClientesRecentes,
      monitoramento: {
        webPushConfigurado,
        notificacoesHoje: notifHojeRes.count ?? 0,
        totalDispositivos,
        pwaInstalados,
        pwaInstaladoPercentual: totalDispositivos > 0 ? Math.round((pwaInstalados / totalDispositivos) * 100) : 0,
        semAcessoRecente,
      },
      atividadeRecente: ((atividadeRes.data ?? []) as any[]).map((a) => ({
        texto: `${a.acao ?? "Ação"} · ${a.entidade ?? "sistema"}`,
        usuario: a.usuario ?? null,
        quando: a.created_at,
      })),
      carteira: {
        clientesAtivos: totalClientesAtivos,
        valorContratadoAtivo,
        ticketMedio,
        taxaAdministrativaMedia,
        taxaInadimplencia,
        parcelasVencidas,
        totalParcelas,
      },
      comprovantesPendentes: comprovantes.map((b) => ({
        boletoId: b.id,
        clienteId: b.cliente_id,
        nome: b.clientes?.nome_completo ?? "Cliente",
        numeroParcela: b.numero_parcela,
        totalParcelas: b.total_parcelas,
        valor: Number(b.valor),
        dataPagamento: b.data_pagamento,
      })),
      proximosAgendamentos: agendamentos.map((a) => ({
        agendamentoId: a.id,
        clienteId: a.cliente_id,
        nome: a.clientes?.nome_completo ?? "Cliente",
        data: a.datas?.data ?? null,
        valor: Number(a.valor_contrato),
        valorContrato: Number(a.valor_contrato),
        temPrevisaoLiberacao: Boolean(a.previsao_liberacao_financeira),
        quantidadeParcelas: null,
        porcentagemPagamento: null,
      })),
      clientesAguardandoLiberacao: revisao.map((c) => ({
        clienteId: c.id,
        nome: c.nome_completo,
        valor: Number(c.valor_contrato),
        valorContrato: Number(c.valor_contrato),
        quantidadeParcelas: c.quantidade_parcelas,
        porcentagemPagamento: porcentagens.get(c.id) ?? 0,
        data: c.data_atingiu_percentual,
        dataAtingiuPercentual: c.data_atingiu_percentual,
      })),
      proximasLiberacoesFinanceiras: liberacoes.map((a) => ({
        agendamentoId: a.id,
        clienteId: a.cliente_id,
        nome: a.clientes?.nome_completo ?? "Cliente",
        valor: Number(a.valor_contrato),
        valorContrato: Number(a.valor_contrato),
        dataPrevisao: a.previsao_liberacao_financeira,
      })),
    });
  } catch (error) {
    console.error("Falha na visão geral administrativa:", error);
    return json({ erro: "Serviço temporariamente indisponível." }, 503);
  }
}
