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

export async function adminReports(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/agenda-mensal" && url.pathname !== "/api/admin/clientes-agendamentos") return null;
  if (request.method !== "GET") return null;
  const denied = await auth(request, env);
  if (denied) return denied;
  const db = createServiceSupabaseClient(env);

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
