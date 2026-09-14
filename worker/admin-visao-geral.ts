import { createServiceSupabaseClient, type Env } from "./supabase";

const LIMITE_ITENS = 8;
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
    const supabase = createServiceSupabaseClient(env);
    const url = new URL(request.url);
    const agoraBrasil = hojeBrasil();
    const anoPadrao = Number(agoraBrasil.slice(0, 4));
    const mesPadrao = Number(agoraBrasil.slice(5, 7));
    const ano = Math.min(2200, Math.max(2000, Number(url.searchParams.get("ano")) || anoPadrao));
    const mes = Math.min(12, Math.max(1, Number(url.searchParams.get("mes")) || mesPadrao));
    const { inicio, fimExclusivo } = periodoMes(ano, mes);
    // Intervalo [hoje, hoje + 7): exatamente sete datas corridas, incluindo hoje.
    const fimProximos7 = addDias(agoraBrasil, 7);
    const inicioPushUtc = `${agoraBrasil}T03:00:00.000Z`;
    const fimPushUtc = `${addDias(agoraBrasil, 1)}T03:00:00.000Z`;

    const [
      clientesRes,
      boletosRes,
      novasVendasRes,
      termosMesRes,
      cirurgiasMesRes,
      termosProximosRes,
      cirurgiasProximasRes,
      devicesRes,
      notifHojeRes,
      credenciaisRes,
      atividadeRes,
    ] = await Promise.all([
      supabase.from("clientes")
        .select("id,nome_completo,cpf,status_contrato,status_revisao_financeira,valor_contrato,quantidade_parcelas,created_at,ativo")
        .order("created_at", { ascending: false }),
      supabase.from("boletos")
        .select("id,cliente_id,numero_parcela,total_parcelas,valor,status,data_vencimento,data_pagamento,comprovante_url,suspensa,clientes(id,nome_completo,cpf)")
        .order("data_vencimento", { ascending: true })
        .limit(5000),
      supabase.from("novas_vendas").select("id", { count: "exact", head: true }).eq("status", "aguardando_cadastro"),
      supabase.from("agendamentos")
        .select("id,cliente_id,status,horario_termos,termos_assinados_em,clientes(id,nome_completo,status_financeiro,status_cirurgia),datas!inner(data)")
        .in("status", ["confirmado", "realizado"])
        .gte("datas.data", inicio)
        .lt("datas.data", fimExclusivo)
        .order("created_at", { ascending: true }),
      supabase.from("agendamentos")
        .select("id,cliente_id,status,data_cirurgia,clientes(id,nome_completo,status_financeiro,status_cirurgia)")
        .in("status", ["confirmado", "realizado"])
        .gte("data_cirurgia", inicio)
        .lt("data_cirurgia", fimExclusivo)
        .order("data_cirurgia", { ascending: true }),
      supabase.from("agendamentos")
        .select("id,cliente_id,status,horario_termos,termos_assinados_em,clientes(id,nome_completo,status_financeiro,status_cirurgia),datas!inner(data)")
        .in("status", ["confirmado", "realizado"])
        .gte("datas.data", agoraBrasil)
        .lt("datas.data", fimProximos7)
        .order("created_at", { ascending: true }),
      supabase.from("agendamentos")
        .select("id,cliente_id,status,data_cirurgia,clientes(id,nome_completo,status_financeiro,status_cirurgia)")
        .in("status", ["confirmado", "realizado"])
        .gte("data_cirurgia", agoraBrasil)
        .lt("data_cirurgia", fimProximos7)
        .order("data_cirurgia", { ascending: true }),
      supabase.from("cliente_app_devices").select("id,is_pwa_installed,last_access_at"),
      supabase.from("notificacao_logs").select("id,push_enviadas", { count: "exact", head: true }).gte("created_at", inicioPushUtc).lt("created_at", fimPushUtc).gt("push_enviadas", 0),
      supabase.from("integracoes_credenciais").select("chave,ativo").eq("provedor", "web_push").eq("ativo", true),
      supabase.from("logs_alteracoes").select("usuario,acao,entidade,created_at").order("created_at", { ascending: false }).limit(8),
    ]);

    for (const result of [clientesRes, boletosRes, termosMesRes, cirurgiasMesRes, termosProximosRes, cirurgiasProximasRes]) {
      if (result.error) return json({ erro: result.error.message }, 500);
    }

    const clientes = (clientesRes.data ?? []) as any[];
    const boletos = (boletosRes.data ?? []) as any[];
    const termosMes = (termosMesRes.data ?? []) as any[];
    const cirurgiasMes = (cirurgiasMesRes.data ?? []) as any[];
    const termosProximos = (termosProximosRes.data ?? []) as any[];
    const cirurgiasProximas = (cirurgiasProximasRes.data ?? []) as any[];

    const clientStats = {
      ativas: clientes.filter((c) => statusContrato(c.status_contrato) === "ativo").length,
      suspensas: clientes.filter((c) => statusContrato(c.status_contrato) === "suspenso").length,
      negativadas: clientes.filter((c) => statusContrato(c.status_contrato) === "negativado").length,
      canceladas: clientes.filter((c) => statusContrato(c.status_contrato) === "cancelado").length,
    };
    const totalClientes = clientStats.ativas + clientStats.suspensas + clientStats.negativadas + clientStats.canceladas;
    const novasClientesHoje = clientes.filter((c) => dataBrasil(String(c.created_at ?? "")) === agoraBrasil).length;
    const novasClientesRecentes = clientes.slice(0, 6).map((c) => ({
      clienteId: c.id,
      nome: c.nome_completo ?? "Cliente",
      cpf: c.cpf ?? "—",
      quando: dataBrasil(String(c.created_at ?? "")) || String(c.created_at ?? "").slice(0, 10),
      status: statusContrato(c.status_contrato),
    }));

    const abertos = boletos.filter((b) => b.status !== "pago");
    const vencidos = abertos.filter((b) => !b.suspensa && b.data_vencimento && String(b.data_vencimento).slice(0, 10) < agoraBrasil);
    const aguardandoConferencia = boletos.filter((b) => b.status === "pendente_confirmacao");
    const semVencimento = abertos.filter((b) => !b.data_vencimento);
    const pagosNoMes = boletos.filter((b) => b.status === "pago" && b.data_pagamento && String(b.data_pagamento).slice(0, 10) >= inicio && String(b.data_pagamento).slice(0, 10) < fimExclusivo);

    const janelaMeses = Array.from({ length: 6 }, (_, i) => chaveMes(ano, mes, i - 2));
    const financeiroMensal = janelaMeses.map((chave) => {
      const previsto = boletos.filter((b) => String(b.data_vencimento ?? "").startsWith(chave)).reduce((s, b) => s + dinheiro(b.valor), 0);
      const recebido = boletos.filter((b) => b.status === "pago" && String(b.data_pagamento ?? "").startsWith(chave)).reduce((s, b) => s + dinheiro(b.valor), 0);
      const vencido = boletos.filter((b) => b.status !== "pago" && !b.suspensa && String(b.data_vencimento ?? "").startsWith(chave) && String(b.data_vencimento).slice(0, 10) < agoraBrasil).reduce((s, b) => s + dinheiro(b.valor), 0);
      return { mes: chave, label: labelMes(chave), previsto: dinheiro(previsto), recebido: dinheiro(recebido), vencido: dinheiro(vencido) };
    });

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

    const dispositivos = (devicesRes.data ?? []) as any[];
    const totalDispositivos = dispositivos.length;
    const pwaInstalados = dispositivos.filter((d) => d.is_pwa_installed === true).length;
    const limiteSemAcesso = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const semAcessoRecente = dispositivos.filter((d) => !d.last_access_at || new Date(d.last_access_at).getTime() < limiteSemAcesso).length;
    const chavesPainel = new Set(((credenciaisRes.data ?? []) as any[]).map((c) => c.chave));
    const webPushConfigurado = Boolean(
      (chavesPainel.has("vapid_public_key") && chavesPainel.has("vapid_private_key") && chavesPainel.has("vapid_subject"))
      || (env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY && env.WEB_PUSH_VAPID_SUBJECT)
    );

    const comprovantesPendentes = aguardandoConferencia.slice(0, LIMITE_ITENS).map((b) => {
      const cliente = one<any>(b.clientes);
      return {
        boletoId: b.id,
        clienteId: b.cliente_id,
        nome: cliente?.nome_completo ?? "Cliente",
        numeroParcela: Number(b.numero_parcela ?? 0),
        totalParcelas: Number(b.total_parcelas ?? 0),
        valor: dinheiro(b.valor),
        dataPagamento: b.data_pagamento ?? null,
      };
    });

    const clientesAguardandoLiberacao = clientes.filter((c) => c.status_revisao_financeira === "pendente").slice(0, LIMITE_ITENS).map((c) => {
      const daCliente = boletos.filter((b) => b.cliente_id === c.id);
      const pagas = daCliente.filter((b) => b.status === "pago").length;
      const total = Math.max(Number(c.quantidade_parcelas ?? 0), daCliente.length);
      return {
        clienteId: c.id,
        nome: c.nome_completo,
        valor: dinheiro(c.valor_contrato),
        valorContrato: dinheiro(c.valor_contrato),
        quantidadeParcelas: total || null,
        porcentagemPagamento: total > 0 ? Math.round((pagas / total) * 1000) / 10 : 0,
      };
    });

    return json({
      geradoEm: new Date().toISOString(),
      periodo: { ano, mes, inicio, fimExclusivo, hoje: agoraBrasil },
      kpis: {
        novasClientesHoje,
        aguardandoCadastro: novasVendasRes.count ?? 0,
        aguardandoConferencia: aguardandoConferencia.length,
        clientesAtivas: clientStats.ativas,
        termosHoje: termosHojeLista.length,
        cirurgiasHoje: cirurgiasHojeLista.length,
      },
      clientStats,
      novasClientesRecentes,
      financeiro: {
        parcelasAbertas: abertos.length,
        parcelasVencidas: vencidos.length,
        aguardandoConferencia: aguardandoConferencia.length,
        recebidasNoMes: pagosNoMes.length,
        semVencimento: semVencimento.length,
        valorAberto: dinheiro(abertos.reduce((s, b) => s + dinheiro(b.valor), 0)),
        valorVencido: dinheiro(vencidos.reduce((s, b) => s + dinheiro(b.valor), 0)),
        valorRecebidoMes: dinheiro(pagosNoMes.reduce((s, b) => s + dinheiro(b.valor), 0)),
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
        notificacoesHoje: notifHojeRes.count ?? 0,
        totalDispositivos,
        pwaInstalados,
        pwaInstaladoPercentual: totalDispositivos > 0 ? Math.round((pwaInstalados / totalDispositivos) * 100) : 0,
        semAcessoRecente,
      },
      atividadeRecente: ((atividadeRes.data ?? []) as any[]).map((a) => ({ texto: `${a.acao ?? "Ação"} · ${a.entidade ?? "sistema"}`, usuario: a.usuario ?? null, quando: a.created_at })),
      carteira: {
        clientesAtivos: clientStats.ativas,
        valorContratadoAtivo: dinheiro(clientes.filter((c) => statusContrato(c.status_contrato) === "ativo").reduce((s, c) => s + dinheiro(c.valor_contrato), 0)),
        ticketMedio: clientStats.ativas > 0 ? dinheiro(clientes.filter((c) => statusContrato(c.status_contrato) === "ativo").reduce((s, c) => s + dinheiro(c.valor_contrato), 0) / clientStats.ativas) : 0,
        taxaAdministrativaMedia: 0,
        taxaInadimplencia: boletos.length > 0 ? Math.round((vencidos.length / boletos.length) * 1000) / 10 : 0,
        parcelasVencidas: vencidos.length,
        totalParcelas: boletos.length,
      },
      resumoClientes: { total: totalClientes },
    });
  } catch (error) {
    console.error("Falha na visão geral administrativa:", error);
    return json({ erro: error instanceof Error ? error.message : "Serviço temporariamente indisponível." }, 503);
  }
}
