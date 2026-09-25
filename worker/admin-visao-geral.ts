import { publicError } from "./http-security";
import { createServiceSupabaseClient, type Env } from "./supabase";

const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

function one<T = any>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function dinheiro(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function dataBrasil(value: string | Date = new Date()) {
  const data = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(data.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(data);
}

function hojeBrasil() {
  return dataBrasil(new Date());
}

function addDias(iso: string, dias: number) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return data.toISOString().slice(0, 10);
}

function periodoMes(ano: number, mes: number) {
  const inicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const proximoAno = mes === 12 ? ano + 1 : ano;
  const proximoMes = mes === 12 ? 1 : mes + 1;
  const fimExclusivo = `${proximoAno}-${String(proximoMes).padStart(2, "0")}-01`;
  return { inicio, fimExclusivo };
}

function chaveMes(ano: number, mes: number, deslocamento: number) {
  const base = new Date(Date.UTC(ano, mes - 1 + deslocamento, 1));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}`;
}

function labelMes(chave: string) {
  const [ano, mes] = chave.split("-").map(Number);
  return `${MESES_CURTOS[mes - 1] ?? chave}/${String(ano).slice(-2)}`;
}

function dataDaRelacao(value: any) {
  const rel = one<any>(value);
  return rel?.data ? String(rel.data).slice(0, 10) : null;
}

function statusContrato(value: unknown) {
  const status = String(value ?? "ativo");
  return ["ativo", "suspenso", "negativado", "cancelado"].includes(status) ? status : "ativo";
}

export async function adminVisaoGeral(request: Request, env: Env): Promise<Response> {
  try {
    const supabase = createServiceSupabaseClient(env, request);
    const url = new URL(request.url);
    const agoraBrasil = hojeBrasil();
    const anoPadrao = Number(agoraBrasil.slice(0, 4));
    const mesPadrao = Number(agoraBrasil.slice(5, 7));
    const ano = Math.min(2200, Math.max(2000, Number(url.searchParams.get("ano")) || anoPadrao));
    const mes = Math.min(12, Math.max(1, Number(url.searchParams.get("mes")) || mesPadrao));
    const { inicio, fimExclusivo } = periodoMes(ano, mes);
    // Intervalo [hoje, hoje + 7): exatamente sete datas corridas, incluindo hoje.
    const fimProximos7 = addDias(agoraBrasil, 7);
    const diaSemanaUtc = new Date(`${agoraBrasil}T12:00:00.000Z`).getUTCDay();
    const inicioSemana = addDias(agoraBrasil, -((diaSemanaUtc + 6) % 7));
    const fimSemana = addDias(inicioSemana, 7);
    const graficoInicio = `${chaveMes(ano, mes, -2)}-01`;
    const graficoFim = `${chaveMes(ano, mes, 4)}-01`;

    const [snapshotRes, agendaRes] = await Promise.all([
      supabase.rpc("loadtest_admin_dashboard_stats", {
        p_hoje: agoraBrasil, p_inicio: inicio, p_fim: fimExclusivo,
        p_semana_inicio: inicioSemana, p_semana_fim: fimSemana,
        p_grafico_inicio: graficoInicio, p_grafico_fim: graficoFim,
      }),
      supabase.rpc("loadtest_admin_dashboard_agenda", {
        p_inicio: inicio, p_fim: fimExclusivo,
        p_hoje: agoraBrasil, p_proximos_fim: fimProximos7,
      }),
    ]);

    for (const result of [snapshotRes, agendaRes]) {
      if (result.error) return json({ erro: publicError(result.error) }, 500);
    }

    const snapshot = (snapshotRes.data ?? {}) as any;
    const billStats = snapshot.boletos ?? {};
    const agendaSnapshot = (agendaRes.data ?? {}) as any;
    const termosMes = (agendaSnapshot.termosMes ?? []) as any[];
    const cirurgiasMes = (agendaSnapshot.cirurgiasMes ?? []) as any[];
    const termosProximos = (agendaSnapshot.termosProximos ?? []) as any[];
    const cirurgiasProximas = (agendaSnapshot.cirurgiasProximas ?? []) as any[];

    const clientStats = {
      ativas: Number(snapshot.clientes?.ativas ?? 0),
      suspensas: Number(snapshot.clientes?.suspensas ?? 0),
      negativadas: Number(snapshot.clientes?.negativadas ?? 0),
      canceladas: Number(snapshot.clientes?.canceladas ?? 0),
    };
    // Canceladas (incluindo perfis arquivados) não fazem parte do funil operacional V46.
    const totalClientes = clientStats.ativas + clientStats.suspensas + clientStats.negativadas;
    const novasClientesHoje = Number(snapshot.clientes?.novas_hoje ?? 0);
    const novasClientesRecentes = (snapshot.novasClientesRecentes ?? []).map((c: any) => ({
      clienteId: c.id,
      nome: c.nome_completo ?? "Cliente",
      cpf: c.cpf ?? "—",
      quando: dataBrasil(String(c.created_at ?? "")) || String(c.created_at ?? "").slice(0, 10),
      status: statusContrato(c.status_contrato),
    }));

    const clientesInadimplentes = Number(billStats.inadimplentes ?? 0);
    const clientesProntasAcessoApp = Number(snapshot.clientesProntasAcessoApp ?? 0);

    const financeiroMensal = (snapshot.financeiroMensal ?? []).map((item: any) => ({
      mes: item.mes, label: labelMes(item.mes),
      previsto: dinheiro(item.previsto), recebido: dinheiro(item.recebido), vencido: dinheiro(item.vencido),
    }));

    type EventoAgenda = {
      id: string;
      agendamentoId: string;
      clienteId: string;
      nome: string;
      data: string;
      horario: string | null;
      tipo: "termos" | "cirurgia";
      status: string;
    };
    const eventosAgenda: EventoAgenda[] = [];

    for (const item of termosMes) {
      const data = dataDaRelacao(item.datas);
      if (!data) continue;
      const cliente = one<any>(item.clientes);
      eventosAgenda.push({
        id: `termos:${item.id}`,
        agendamentoId: item.id,
        clienteId: item.cliente_id,
        nome: cliente?.nome_completo ?? "Cliente",
        data,
        horario: item.horario_termos ? String(item.horario_termos).slice(0, 5) : null,
        tipo: "termos",
        status: item.termos_assinados_em ? "assinado" : "a_confirmar",
      });
    }
    for (const item of cirurgiasMes) {
      const data = item.data_cirurgia ? String(item.data_cirurgia).slice(0, 10) : null;
      if (!data) continue;
      const cliente = one<any>(item.clientes);
      eventosAgenda.push({
        id: `cirurgia:${item.id}`,
        agendamentoId: item.id,
        clienteId: item.cliente_id,
        nome: cliente?.nome_completo ?? "Cliente",
        data,
        horario: null,
        tipo: "cirurgia",
        status: cliente?.status_cirurgia === "realizada" || item.status === "realizado" ? "realizada" : "confirmada",
      });
    }
    eventosAgenda.sort((a, b) => `${a.data} ${a.horario ?? "23:59"}`.localeCompare(`${b.data} ${b.horario ?? "23:59"}`));

    const diasMap = new Map<string, { termos: number; cirurgias: number; termosPendentes: number }>();
    for (const evento of eventosAgenda) {
      const atual = diasMap.get(evento.data) ?? { termos: 0, cirurgias: 0, termosPendentes: 0 };
      if (evento.tipo === "termos") {
        atual.termos += 1;
        if (evento.status !== "assinado") atual.termosPendentes += 1;
      } else atual.cirurgias += 1;
      diasMap.set(evento.data, atual);
    }
    const dias = [...diasMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([data, item]) => ({ data, total: item.termos + item.cirurgias, ...item }));

    const eventosProximos: EventoAgenda[] = [];
    for (const item of termosProximos) {
      const data = dataDaRelacao(item.datas);
      if (!data) continue;
      const cliente = one<any>(item.clientes);
      eventosProximos.push({ id: `termos:${item.id}`, agendamentoId: item.id, clienteId: item.cliente_id, nome: cliente?.nome_completo ?? "Cliente", data, horario: item.horario_termos ? String(item.horario_termos).slice(0, 5) : null, tipo: "termos", status: item.termos_assinados_em ? "assinado" : "a_confirmar" });
    }
    for (const item of cirurgiasProximas) {
      const data = item.data_cirurgia ? String(item.data_cirurgia).slice(0, 10) : null;
      if (!data) continue;
      const cliente = one<any>(item.clientes);
      eventosProximos.push({ id: `cirurgia:${item.id}`, agendamentoId: item.id, clienteId: item.cliente_id, nome: cliente?.nome_completo ?? "Cliente", data, horario: null, tipo: "cirurgia", status: cliente?.status_cirurgia === "realizada" || item.status === "realizado" ? "realizada" : "confirmada" });
    }
    eventosProximos.sort((a, b) => `${a.data} ${a.horario ?? "23:59"}`.localeCompare(`${b.data} ${b.horario ?? "23:59"}`));

    const termosHojeLista = eventosProximos.filter((e) => e.tipo === "termos" && e.data === agoraBrasil).map((e) => ({ agendamentoId: e.agendamentoId, nome: e.nome, horario: e.horario }));
    const cirurgiasHojeLista = eventosProximos.filter((e) => e.tipo === "cirurgia" && e.data === agoraBrasil);
    const termosPendentesMes = eventosAgenda.filter((e) => e.tipo === "termos" && e.status !== "assinado").length;

    const totalDispositivos = Number(snapshot.dispositivos?.total ?? 0);
    const pwaInstalados = Number(snapshot.dispositivos?.instalados ?? 0);
    const semAcessoRecente = Number(snapshot.dispositivos?.sem_acesso ?? 0);
    const webPushConfigurado = Boolean(
      snapshot.webPushConfigurado
      || (env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY && env.WEB_PUSH_VAPID_SUBJECT)
    );

    const comprovantesPendentes = (snapshot.comprovantesPendentes ?? []).map((b: any) => ({
        boletoId: b.id,
        clienteId: b.cliente_id,
        nome: b.nome_completo ?? "Cliente",
        numeroParcela: Number(b.numero_parcela ?? 0),
        totalParcelas: Number(b.total_parcelas ?? 0),
        valor: dinheiro(b.valor),
        dataPagamento: b.data_pagamento ?? null,
    }));

    const clientesAguardandoLiberacao = (snapshot.clientesAguardandoLiberacao ?? []).map((c: any) => {
      const total = Math.max(Number(c.quantidade_parcelas ?? 0), Number(c.parcelas_total ?? 0));
      return {
        clienteId: c.id,
        nome: c.nome_completo,
        valor: dinheiro(c.valor_contrato),
        valorContrato: dinheiro(c.valor_contrato),
        quantidadeParcelas: total || null,
        porcentagemPagamento: total > 0 ? Math.round((Number(c.parcelas_pagas ?? 0) / total) * 1000) / 10 : 0,
      };
    });

    return json({
      geradoEm: new Date().toISOString(),
      periodo: { ano, mes, inicio, fimExclusivo, hoje: agoraBrasil },
      kpis: {
        novasClientesHoje,
        aguardandoCadastro: Number(snapshot.novasVendas ?? 0),
        aguardandoConferencia: Number(billStats.conferencia ?? 0),
        clientesAtivas: clientStats.ativas,
        termosHoje: termosHojeLista.length,
        cirurgiasHoje: cirurgiasHojeLista.length,
      },
      clientStats,
      novasClientesRecentes,
      financeiro: {
        parcelasAbertas: Number(billStats.abertos ?? 0),
        parcelasVencidas: Number(billStats.vencidos ?? 0),
        aguardandoConferencia: Number(billStats.conferencia ?? 0),
        recebidasNoMes: Number(billStats.pagos_mes ?? 0),
        recebidasSemana: Number(billStats.pagos_semana ?? 0),
        clientesInadimplentes,
        clientesProntasAcessoApp,
        semVencimento: Number(billStats.sem_vencimento ?? 0),
        valorAberto: dinheiro(billStats.valor_aberto),
        valorVencido: dinheiro(billStats.valor_vencido),
        valorRecebidoMes: dinheiro(billStats.valor_mes),
        valorRecebidoSemana: dinheiro(billStats.valor_semana),
      },
      agenda: {
        resumo: {
          termosHoje: termosHojeLista.length,
          termosMes: eventosAgenda.filter((e) => e.tipo === "termos").length,
          cirurgiasHoje: cirurgiasHojeLista.length,
          cirurgiasMes: eventosAgenda.filter((e) => e.tipo === "cirurgia").length,
          termosPendentesMes,
          proximos7Dias: eventosProximos.length,
        },
        dias,
        eventos: eventosAgenda,
        proximos: eventosProximos.slice(0, 12),
      },
      graficos: {
        financeiroMensal,
        clientesStatus: [
          { id: "ativo", label: "Ativas", valor: clientStats.ativas },
          { id: "suspenso", label: "Suspensas", valor: clientStats.suspensas },
          { id: "negativado", label: "Negativadas", valor: clientStats.negativadas },
          { id: "cancelado", label: "Canceladas", valor: clientStats.canceladas },
        ],
        agendaDiaria: dias,
      },
      termosHojeLista,
      cirurgiasHojeLista,
      comprovantesPendentes,
      clientesAguardandoLiberacao,
      monitoramento: {
        webPushConfigurado,
        notificacoesHoje: Number(snapshot.notificacoesHoje ?? 0),
        totalDispositivos,
        pwaInstalados,
        pwaInstaladoPercentual: totalDispositivos > 0 ? Math.round((pwaInstalados / totalDispositivos) * 100) : 0,
        semAcessoRecente,
      },
      atividadeRecente: (snapshot.atividadeRecente ?? []).map((a: any) => ({ texto: `${a.acao ?? "Ação"} · ${a.entidade ?? "sistema"}`, usuario: a.usuario ?? null, quando: a.created_at })),
      carteira: {
        clientesAtivos: clientStats.ativas,
        valorContratadoAtivo: dinheiro(snapshot.clientes?.valor_ativo),
        ticketMedio: clientStats.ativas > 0 ? dinheiro(dinheiro(snapshot.clientes?.valor_ativo) / clientStats.ativas) : 0,
        taxaAdministrativaMedia: 0,
        taxaInadimplencia: Number(billStats.total ?? 0) > 0 ? Math.round((Number(billStats.vencidos ?? 0) / Number(billStats.total)) * 1000) / 10 : 0,
        parcelasVencidas: Number(billStats.vencidos ?? 0),
        totalParcelas: Number(billStats.total ?? 0),
      },
      resumoClientes: { total: totalClientes },
    });
  } catch (error) {
    console.error("Falha na visão geral administrativa:", error);
    return json({ erro: publicError(error, "Serviço temporariamente indisponível.") }, 503);
  }
}
