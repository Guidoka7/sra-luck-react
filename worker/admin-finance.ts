import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenAdmin } from "./session";
import { calcularLiberacaoCirurgica } from "./surgery-release";
import { adminFinanceiro } from "./admin-financeiro";

type Json = Record<string, any>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function body(request: Request): Promise<Json> {
  try { return await request.json(); } catch { return {}; }
}

async function exigirAdmin(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);
  const token = getCookie(request, "admin_session");
  return (await verificarTokenAdmin(token, env.CLIENTE_SESSION_SECRET)) ? null : json({ erro: "Sessão administrativa expirada." }, 401);
}

function one<T = any>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function adminFinance(request: Request, env: Env): Promise<Response | null> {
  const unificado = await adminFinanceiro(request, env);
  if (unificado) return unificado;

  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/admin/")) return null;

  const managed = [
    "/api/admin/datas-liberacao-financeira",
    "/api/admin/solicitacoes-liberacao-financeira",
    "/api/admin/monitoramento-app",
  ];
  if (!managed.includes(path)) return null;

  const denied = await exigirAdmin(request, env);
  if (denied) return denied;
  const db = createServiceSupabaseClient(env);

  if (path === "/api/admin/datas-liberacao-financeira") {
    if (request.method === "GET") {
      const ano = Number(url.searchParams.get("ano"));
      const mes = Number(url.searchParams.get("mes"));
      if (!ano || !mes || mes < 1 || mes > 12) return json({ erro: "Parâmetros obrigatórios: ano, mes" }, 400);
      const inicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
      const proximo = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
      const [{ data: datas, error }, { data: ocupacoes }] = await Promise.all([
        db.from("datas_liberacao_financeira").select("id,data,status").gte("data", inicio).lt("data", proximo).order("data", { ascending: true }),
        db.from("agendamentos").select("data_cirurgia,valor_contrato,clientes(nome_completo)").in("status", ["confirmado", "realizado"]).gte("data_cirurgia", inicio).lt("data_cirurgia", proximo),
      ]);
      if (error) return json({ erro: "Não foi possível carregar as datas." }, 500);
      const mapa = new Map<string, { nome: string; valor: number }[]>();
      for (const item of ocupacoes ?? []) {
        const data = (item as any).data_cirurgia as string | null;
        if (!data) continue;
        const cliente = one((item as any).clientes);
        const lista = mapa.get(data) ?? [];
        lista.push({ nome: cliente?.nome_completo ?? "Cliente", valor: Number((item as any).valor_contrato ?? 0) });
        mapa.set(data, lista);
      }
      return json({ datas: (datas ?? []).map((d: any) => ({ ...d, vagasOcupadas: mapa.get(d.data)?.length ?? 0, clientes: mapa.get(d.data) ?? [] })) });
    }

    if (request.method === "POST") {
      const b = await body(request);
      if (typeof b.data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.data)) return json({ erro: "Informe uma data válida." }, 400);
      const { data, error } = await db.from("datas_liberacao_financeira").upsert({ data: b.data, status: "disponivel" }, { onConflict: "data" }).select("id,data,status").single();
      if (error) return json({ erro: "Não foi possível liberar essa data." }, 400);
      return json({ data });
    }

    if (request.method === "DELETE") {
      const dataSolicitada = url.searchParams.get("data");
      if (!dataSolicitada) return json({ erro: "Informe a data." }, 400);
      const { data: ocupacoes } = await db.from("agendamentos").select("id").in("status", ["confirmado", "realizado"]).eq("data_cirurgia", dataSolicitada).limit(1);
      if ((ocupacoes ?? []).length) return json({ erro: "Esta data já possui uma cirurgia confirmada e não pode ser fechada." }, 409);
      const { data, error } = await db.from("datas_liberacao_financeira").delete().eq("data", dataSolicitada).select("id,data,status").maybeSingle();
      if (error) return json({ erro: "Não foi possível fechar essa data." }, 400);
      if (!data) return json({ erro: "Data não encontrada ou já estava fechada." }, 404);
      return json({ data });
    }
    return json({ erro: "Método não suportado." }, 405);
  }

  if (path === "/api/admin/solicitacoes-liberacao-financeira") {
    if (request.method === "GET") {
      const { data, error } = await db.from("solicitacoes_liberacao_financeira")
        .select("id,cliente_id,agendamento_id,forma_custeio,saldo_restante,taxa_cartao,total_com_taxa,status,observacao,created_at,updated_at,clientes(nome_completo,cpf,quantidade_parcelas,custeio_confirmado_em),agendamentos(data_cirurgia,termos_assinados_em,datas(data))")
        .in("status", ["pendente", "em_analise", "aprovada"])
        .order("created_at", { ascending: true });
      if (error) return json({ erro: "Não foi possível carregar as solicitações." }, 500);
      const solicitacoes = (data ?? []).filter((item: any) => !one(item.agendamentos)?.data_cirurgia).map((item: any) => {
        const agendamento = one(item.agendamentos);
        const cliente = one(item.clientes);
        const dataTermos = one(agendamento?.datas)?.data ?? null;
        return {
          ...item,
          data_termos: dataTermos,
          previsao_sugerida: calcularLiberacaoCirurgica(agendamento?.termos_assinados_em ?? null, cliente?.custeio_confirmado_em ?? null),
        };
      });
      return json({ solicitacoes });
    }

    if (request.method === "PATCH") {
      const b = await body(request);
      const id = typeof b.id === "string" ? b.id : null;
      const status = typeof b.status === "string" ? b.status : null;
      // Nome legado do payload mantido apenas por compatibilidade de UI. O valor
      // é a DATA REAL da cirurgia e é persistido por agendar_cirurgia_data.
      const dataCirurgia = typeof b.dataLiberacaoFinanceira === "string" ? b.dataLiberacaoFinanceira : null;
      const observacao = typeof b.observacao === "string" ? b.observacao.trim().slice(0, 1000) : null;
      if (!id) return json({ erro: "Solicitação inválida." }, 400);
      if (status && !["pendente", "em_analise", "aprovada", "recusada"].includes(status)) return json({ erro: "Status inválido." }, 400);
      if (dataCirurgia && !/^\d{4}-\d{2}-\d{2}$/.test(dataCirurgia)) return json({ erro: "Data inválida." }, 400);
      const { data: atual, error: erroAtual } = await db.from("solicitacoes_liberacao_financeira")
        .select("id,cliente_id,agendamento_id,status,forma_custeio,saldo_restante,taxa_cartao,total_com_taxa")
        .eq("id", id)
        .single();
      if (erroAtual || !atual) return json({ erro: "Solicitação não encontrada." }, 404);
      const updates: Json = {};
      if (status) updates.status = status;
      if (observacao !== null) updates.observacao = observacao;
      if (dataCirurgia) {
        if (!atual.agendamento_id) return json({ erro: "A cliente ainda não possui agendamento confirmado para definir a data." }, 409);
        updates.status = status ?? "aprovada";
      }
      const { data: atualizado, error } = await db.from("solicitacoes_liberacao_financeira")
        .update(updates)
        .eq("id", id)
        .select("id,cliente_id,agendamento_id,status,forma_custeio,saldo_restante,taxa_cartao,total_com_taxa,observacao")
        .single();
      if (error) return json({ erro: "Não foi possível atualizar a solicitação." }, 500);
      if (dataCirurgia && atual.agendamento_id) {
        const { data: agendamento } = await db.from("agendamentos").select("id,termos_assinados_em,clientes(custeio_confirmado_em)").eq("id", atual.agendamento_id).maybeSingle();
        const cliente = one((agendamento as any)?.clientes);
        const limite = calcularLiberacaoCirurgica((agendamento as any)?.termos_assinados_em ?? null, cliente?.custeio_confirmado_em ?? null);
        if (!limite) return json({ erro: "A data cirúrgica só pode ser definida depois dos termos assinados e da quitação confirmada." }, 409);
        if (dataCirurgia > limite) return json({ erro: `A data excede o prazo máximo permitido (até ${limite.split("-").reverse().join("/")}).` }, 409);
        const { error: erroAgenda } = await db.rpc("agendar_cirurgia_data", { p_agendamento_id: atual.agendamento_id, p_data: dataCirurgia });
        if (erroAgenda) return json({ erro: "Não foi possível confirmar a data cirúrgica." }, 409);
      }
      return json({ solicitacao: atualizado, dataCirurgia });
    }
    return json({ erro: "Método não suportado." }, 405);
  }

  if (path === "/api/admin/monitoramento-app" && request.method === "GET") {
    const [{ data: clientes, error: erroClientes }, { data: devices, error: erroDevices }] = await Promise.all([
      db.from("clientes").select("id,nome_completo,ativo").eq("ativo", true).order("nome_completo", { ascending: true }),
      db.from("cliente_app_devices").select("cliente_id,device_key,device_type,display_mode,is_pwa_installed,notification_permission,push_active,first_access_at,last_access_at,pwa_installed_at,notifications_activated_at").order("last_access_at", { ascending: false }),
    ]);
    if (erroClientes || erroDevices) return json({ erro: "Não foi possível carregar o monitoramento." }, 500);
    const mapa = new Map<string, any[]>();
    for (const d of devices ?? []) {
      const lista = mapa.get(d.cliente_id) ?? [];
      lista.push(d);
      mapa.set(d.cliente_id, lista);
    }
    const resumo = (clientes ?? []).map((cliente: any) => {
      const lista = mapa.get(cliente.id) ?? [];
      const ultimo = lista[0] ?? null;
      const primeiro = lista.reduce((m: string | null, x: any) => !x.first_access_at ? m : !m || new Date(x.first_access_at) < new Date(m) ? x.first_access_at : m, null);
      const ultimoAcesso = lista.reduce((m: string | null, x: any) => !x.last_access_at ? m : !m || new Date(x.last_access_at) > new Date(m) ? x.last_access_at : m, null);
      const pwa = lista.some((x: any) => x.is_pwa_installed);
      const push = lista.some((x: any) => x.notification_permission === "granted" && x.push_active);
      const deniedPush = !push && lista.some((x: any) => x.notification_permission === "denied");
      return {
        cliente_id: cliente.id,
        cliente: { id: cliente.id, nome_completo: cliente.nome_completo },
        device_key: ultimo?.device_key ?? null,
        device_type: ultimo?.device_type ?? null,
        display_mode: ultimo?.display_mode ?? null,
        is_pwa_installed: pwa,
        notification_permission: deniedPush ? "denied" : push ? "granted" : "default",
        push_active: push,
        first_access_at: primeiro,
        last_access_at: ultimoAcesso,
        pwa_installed_at: lista.find((x: any) => x.pwa_installed_at)?.pwa_installed_at ?? null,
        notifications_activated_at: lista.find((x: any) => x.notifications_activated_at)?.notifications_activated_at ?? null,
        dispositivos_count: lista.length,
      };
    });
    return json({
      dispositivos: devices ?? [],
      resumo,
      metricas: {
        clientesMonitoradas: resumo.length,
        pwaInstalado: resumo.filter((x: any) => x.is_pwa_installed).length,
        pwaNaoInstalado: resumo.filter((x: any) => !x.is_pwa_installed).length,
        notificacoesAtivas: resumo.filter((x: any) => x.push_active).length,
        notificacoesNaoAtivadas: resumo.filter((x: any) => !x.push_active).length,
        notificacoesBloqueadas: resumo.filter((x: any) => x.notification_permission === "denied").length,
        acessoWeb: resumo.filter((x: any) => x.display_mode === "browser").length,
      },
    });
  }

  return null;
}
