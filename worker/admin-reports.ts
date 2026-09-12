import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenAdmin } from "./session";
import { calcularLiberacaoCirurgica } from "./surgery-release";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function auth(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);
  return (await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET))
    ? null
    : json({ erro: "Sessão administrativa expirada." }, 401);
}

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const REGRAS_ELEGIBILIDADE: Record<number, number> = { 12: 60, 18: 60, 24: 60, 36: 70, 48: 80, 60: 80, 72: 80 };
const PAGE_SIZE = 1000;

function cpfKey(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const iso = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

function addMonthsIso(iso: string, months: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, lastDay));
  return base.toISOString().slice(0, 10);
}

function maxInstallments(rows: any[]) {
  return rows.reduce((max, row) => Math.max(max, Number(row.total_parcelas ?? 0), Number(row.numero_parcela ?? 0)), rows.length);
}

function sortInstallments(rows: any[]) {
  return [...rows].sort((a, b) => {
    const numberDiff = Number(a.numero_parcela ?? 0) - Number(b.numero_parcela ?? 0);
    if (numberDiff !== 0) return numberDiff;
    return String(a.data_vencimento ?? "9999-12-31").localeCompare(String(b.data_vencimento ?? "9999-12-31"));
  });
}

async function fetchAllRows(
  db: ReturnType<typeof createServiceSupabaseClient>,
  table: string,
  select: string,
  orderColumn?: string,
  ascending = true,
) {
  const rows: any[] = [];
  let from = 0;

  while (true) {
    let query: any = db.from(table).select(select);
    if (orderColumn) query = query.order(orderColumn, { ascending });
    query = query.range(from, from + PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function fetchOptionalRows(
  db: ReturnType<typeof createServiceSupabaseClient>,
  table: string,
  select: string,
  orderColumn?: string,
  ascending = true,
) {
  try {
    return {
      data: await fetchAllRows(db, table, select, orderColumn, ascending),
      disponivel: true,
    };
  } catch {
    return { data: [] as any[], disponivel: false };
  }
}

async function forecastLiberacoes(db: ReturnType<typeof createServiceSupabaseClient>) {
  const hoje = new Date().toISOString().slice(0, 10);

  const [clientes, boletos] = await Promise.all([
    fetchAllRows(
      db,
      "clientes",
      "id,nome_completo,cpf,quantidade_parcelas,consultora,data_atingiu_percentual,valor_contrato,ativo,created_at",
      "created_at",
      false,
    ),
    fetchAllRows(
      db,
      "boletos",
      "id,cliente_id,numero_parcela,total_parcelas,status,data_vencimento,data_pagamento,created_at",
      "created_at",
      true,
    ),
  ]);

  // CRM e contratos novos enriquecem os dados, mas a tabela clientes continua
  // sendo a fonte mestre da base cadastrada e do valor da carta.
  const [contratosRes, crmRes] = await Promise.all([
    fetchOptionalRows(
      db,
      "contratos_credito",
      "id,cliente_id,codigo,campanha,origem,etapa,valor_contrato,data_venda,created_at",
      "created_at",
      false,
    ),
    fetchOptionalRows(
      db,
      "crm_vendas_entrada",
      "cliente_cpf,campanha,origem,vendedor,status,created_at",
      "created_at",
      false,
    ),
  ]);

  const contratos = contratosRes.data;
  const crm = crmRes.data;

  const boletosPorCliente = new Map<string, any[]>();
  for (const boleto of boletos) {
    const current = boletosPorCliente.get(boleto.cliente_id) ?? [];
    current.push(boleto);
    boletosPorCliente.set(boleto.cliente_id, current);
  }

  const contratoPorCliente = new Map<string, any>();
  for (const contrato of contratos) {
    if (!contratoPorCliente.has(contrato.cliente_id) && !["cancelado", "concluido"].includes(String(contrato.etapa))) {
      contratoPorCliente.set(contrato.cliente_id, contrato);
    }
  }

  const crmPorCpf = new Map<string, any>();
  for (const entrada of crm) {
    const key = cpfKey(entrada.cliente_cpf);
    if (key && !crmPorCpf.has(key)) crmPorCpf.set(key, entrada);
  }

  const clientesForecast = clientes.map((cliente: any) => {
    const parcelas = sortInstallments(boletosPorCliente.get(cliente.id) ?? []);
    const totalParcelas = Math.max(Number(cliente.quantidade_parcelas ?? 0), maxInstallments(parcelas));
    const percentual = REGRAS_ELEGIBILIDADE[totalParcelas] ?? null;
    const parcelasNecessarias = percentual ? Math.ceil((totalParcelas * percentual) / 100) : null;
    const pagas = parcelas.filter((parcela) => parcela.status === "pago");
    const vencidas = parcelas.filter((parcela) => {
      const vencimento = isoDate(parcela.data_vencimento);
      return Boolean(vencimento && vencimento < hoje && !["pago", "pendente_confirmacao"].includes(String(parcela.status)));
    });

    const contrato = contratoPorCliente.get(cliente.id);
    const entradaCrm = crmPorCpf.get(cpfKey(cliente.cpf));
    const campanha = contrato?.campanha || entradaCrm?.campanha || null;
    const origem = contrato?.origem || entradaCrm?.origem || null;
    const responsavel = entradaCrm?.vendedor || cliente.consultora || null;

    let previsao: string | null = null;
    let fontePrevisao: "cronograma" | "projecao_mensal" | "sem_base" = "sem_base";
    let confianca: "alta" | "media" | "baixa" = "baixa";

    if (parcelasNecessarias) {
      const parcelaAlvo = parcelas.find((parcela) => Number(parcela.numero_parcela) === parcelasNecessarias) ?? parcelas[parcelasNecessarias - 1];
      const vencimentoAlvo = isoDate(parcelaAlvo?.data_vencimento);

      if (vencimentoAlvo) {
        previsao = vencimentoAlvo;
        fontePrevisao = "cronograma";
        confianca = "alta";
      } else {
        const primeiraComData = parcelas.find((parcela) => isoDate(parcela.data_vencimento));
        const primeira = primeiraComData ?? parcelas[0];
        const base = isoDate(primeira?.data_vencimento) ?? isoDate(primeira?.created_at);
        if (base) {
          const numeroBase = Math.max(1, Number(primeira?.numero_parcela ?? 1));
          previsao = addMonthsIso(base, Math.max(0, parcelasNecessarias - numeroBase));
          fontePrevisao = "projecao_mensal";
          confianca = "media";
        }
      }
    }

    const atingiuEm = parcelasNecessarias && pagas.length >= parcelasNecessarias
      ? isoDate(
          [...pagas]
            .sort((a, b) => String(a.data_pagamento ?? a.data_vencimento ?? "").localeCompare(String(b.data_pagamento ?? b.data_vencimento ?? "")))[parcelasNecessarias - 1]?.data_pagamento
            ?? cliente.data_atingiu_percentual,
        )
      : null;

    const situacao = !percentual
      ? "sem_regra"
      : parcelasNecessarias && pagas.length >= parcelasNecessarias
        ? "elegivel"
        : vencidas.length > 0
          ? "em_risco"
          : previsao
            ? "no_ritmo"
            : "sem_previsao";

    return {
      clienteId: cliente.id,
      nome: cliente.nome_completo ?? "Cliente",
      campanha,
      origem,
      responsavel,
      totalParcelas,
      percentual,
      parcelasNecessarias,
      parcelasPagas: pagas.length,
      parcelasRestantes: parcelasNecessarias == null ? null : Math.max(0, parcelasNecessarias - pagas.length),
      parcelasVencidas: vencidas.length,
      primeiroBoletoEm: isoDate(parcelas[0]?.created_at),
      primeiroVencimento: isoDate(parcelas.find((parcela) => isoDate(parcela.data_vencimento))?.data_vencimento),
      previsao,
      atingiuEm,
      fontePrevisao,
      confianca,
      situacao,
      // Fonte oficial: valor informado no cadastro da cliente.
      valorCarta: cliente.valor_contrato == null ? null : Number(cliente.valor_contrato),
      dataVenda: isoDate(contrato?.data_venda) ?? isoDate(entradaCrm?.created_at),
      dataCadastro: isoDate(cliente.created_at),
      codigoContrato: contrato?.codigo ?? null,
      statusCrm: entradaCrm?.status ?? null,
      ativo: cliente.ativo !== false,
      financeiroRegistrado: parcelas.length > 0,
      parcelas: parcelas.map((parcela) => ({
        numero: Number(parcela.numero_parcela ?? 0),
        status: String(parcela.status ?? ""),
        vencimento: isoDate(parcela.data_vencimento),
        pagamento: isoDate(parcela.data_pagamento),
      })),
    };
  });

  const mesesMap = new Map<string, { total: number; noRitmo: number; emRisco: number }>();
  for (const cliente of clientesForecast as any[]) {
    if (!cliente.previsao || cliente.situacao === "elegivel") continue;
    const mes = cliente.previsao.slice(0, 7);
    const current = mesesMap.get(mes) ?? { total: 0, noRitmo: 0, emRisco: 0 };
    current.total += 1;
    if (cliente.situacao === "em_risco") current.emRisco += 1;
    else current.noRitmo += 1;
    mesesMap.set(mes, current);
  }

  const meses = [...mesesMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, item]) => ({ mes, ...item }));
  const futuros12 = meses.filter((item) => item.mes >= hoje.slice(0, 7)).slice(0, 12);
  const mesPico = futuros12.reduce<{ mes: string; total: number } | null>((best, item) => {
    if (!best || item.total > best.total) return { mes: item.mes, total: item.total };
    return best;
  }, null);

  return {
    geradoEm: new Date().toISOString(),
    regras: Object.entries(REGRAS_ELEGIBILIDADE).map(([parcelas, percentual]) => ({
      parcelas: Number(parcelas),
      percentual,
      parcelasNecessarias: Math.ceil((Number(parcelas) * percentual) / 100),
    })),
    resumo: {
      total: clientesForecast.length,
      emFormacao: clientesForecast.filter((cliente: any) => ["no_ritmo", "em_risco"].includes(cliente.situacao)).length,
      elegiveis: clientesForecast.filter((cliente: any) => cliente.situacao === "elegivel").length,
      emRisco: clientesForecast.filter((cliente: any) => cliente.situacao === "em_risco").length,
      semPrevisao: clientesForecast.filter((cliente: any) => ["sem_previsao", "sem_regra"].includes(cliente.situacao)).length,
      proximos12Meses: futuros12.reduce((total, item) => total + item.total, 0),
      mesPico,
    },
    meses,
    clientes: clientesForecast,
    enriquecimento: {
      contratosDisponiveis: contratosRes.disponivel,
      crmDisponivel: crmRes.disponivel,
    },
  };
}

export async function adminReports(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!["/api/admin/agenda-mensal", "/api/admin/clientes-agendamentos", "/api/admin/previsao-liberacoes"].includes(url.pathname)) return null;
  if (request.method !== "GET") return null;
  const denied = await auth(request, env);
  if (denied) return denied;
  const db = createServiceSupabaseClient(env);

  if (url.pathname === "/api/admin/previsao-liberacoes") {
    try {
      return json(await forecastLiberacoes(db));
    } catch (error) {
      console.error("Falha no forecast de liberações:", error);
      return json({ erro: error instanceof Error ? error.message : "Não foi possível gerar a previsão." }, 500);
    }
  }

  if (url.pathname === "/api/admin/clientes-agendamentos") {
    const { data, error } = await db.from("agendamentos")
      .select("id,cliente_id,valor_contrato,previsao_liberacao_financeira,termos_assinados_em,status,datas(data),clientes(id,nome_completo,status_cirurgia,status_financeiro,custeio_confirmado_em,financeiro_saldo_restante,consultora)")
      .order("created_at", { ascending: false });
    if (error) return json({ erro: error.message }, 500);
    const clientes = (data ?? []).map((a: any) => {
      const d = Array.isArray(a.datas) ? a.datas[0]?.data ?? null : a.datas?.data ?? null;
      const c = Array.isArray(a.clientes) ? a.clientes[0] : a.clientes;
      return {
        agendamentoId: a.id,
        clienteId: a.cliente_id,
        nome: c?.nome_completo ?? "Cliente",
        dataTermos: d,
        termosAssinadosEm: a.termos_assinados_em ?? null,
        agendaCirurgicaLiberarEm: calcularLiberacaoCirurgica(a.termos_assinados_em, c?.custeio_confirmado_em ?? null),
        previsaoAtual: a.previsao_liberacao_financeira ?? null,
        valor: Number(a.valor_contrato ?? 0),
        custeioConfirmado: Boolean(c?.custeio_confirmado_em),
        cirurgiaRealizada: c?.status_cirurgia === "realizada",
        statusFinanceiro: c?.status_financeiro ?? null,
        formaCusteio: null,
        saldoRestante: c?.financeiro_saldo_restante == null ? null : Number(c.financeiro_saldo_restante),
      };
    });
    return json({ clientes, agendamentos: data ?? [] });
  }

  const ano = Number(url.searchParams.get("ano")) || new Date().getFullYear();
  const inicio = `${ano}-01-01`;
  const fim = `${ano + 1}-01-01`;
  const { data: agendamentos, error } = await db.from("agendamentos")
    .select("id,cliente_id,valor_contrato,status,datas(data),clientes(nome_completo,consultora,status_financeiro,status_cirurgia)")
    .gte("datas.data", inicio)
    .lt("datas.data", fim)
    .order("created_at", { ascending: true });
  if (error) return json({ erro: error.message }, 500);

  const meses = MESES.map((nome, index) => {
    const mes = index + 1;
    const clientes = (agendamentos ?? []).filter((a: any) => {
      const d = Array.isArray(a.datas) ? a.datas[0]?.data : a.datas?.data;
      return d && Number(String(d).slice(5, 7)) === mes;
    }).map((a: any) => {
      const d = Array.isArray(a.datas) ? a.datas[0]?.data ?? null : a.datas?.data ?? null;
      const c = Array.isArray(a.clientes) ? a.clientes[0] : a.clientes;
      return {
        agendamentoId: a.id,
        nome: c?.nome_completo ?? "Cliente",
        responsavel: c?.consultora ?? null,
        statusFinanceiro: c?.status_financeiro === "pago" ? "pago" : c?.status_financeiro === "parcial" ? "parcial" : "a_pagar",
        statusCirurgia: c?.status_cirurgia === "realizada" ? "realizada" : c?.status_cirurgia === "cancelada" ? "cancelada" : c?.status_cirurgia === "agendada" ? "agendada" : "nao_agendada",
        valorContrato: Number(a.valor_contrato ?? 0),
        data: d,
      };
    });
    return { mes, nome, total: clientes.length, clientes };
  });
  return json({ ano, meses });
}
