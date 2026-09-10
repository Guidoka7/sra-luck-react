import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenAdmin } from "./session";

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

function adicionarDias(iso: string, dias: number) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  data.setUTCDate(data.getUTCDate() + dias);
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}-${String(data.getUTCDate()).padStart(2, "0")}`;
}

function hojeIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function adminFinance(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/admin/")) return null;

  const managed = [
    "/api/admin/datas-liberacao-financeira",
    "/api/admin/liberacao-inteligente",
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
        db.from("datas_liberacao_financeira").select("*").gte("data", inicio).lt("data", proximo).order("data", { ascending: true }),
        db.from("agendamentos").select("previsao_liberacao_financeira, valor_contrato, clientes(nome_completo)").eq("status", "confirmado").gte("previsao_liberacao_financeira", inicio).lt("previsao_liberacao_financeira", proximo),
      ]);
      if (error) return json({ erro: error.message }, 500);
      const mapa = new Map<string, { nome: string; valor: number }[]>();
      for (const item of ocupacoes ?? []) {
        const data = (item as any).previsao_liberacao_financeira as string | null;
        if (!data) continue;
        const cliente = Array.isArray((item as any).clientes) ? (item as any).clientes[0] : (item as any).clientes;
        const lista = mapa.get(data) ?? [];
        lista.push({ nome: cliente?.nome_completo ?? "Cliente", valor: Number((item as any).valor_contrato ?? 0) });
        mapa.set(data, lista);
      }
      return json({ datas: (datas ?? []).map((d: any) => ({ ...d, vagasOcupadas: mapa.get(d.data)?.length ?? 0, clientes: mapa.get(d.data) ?? [] })) });
    }

    if (request.method === "POST") {
      const b = await body(request);
      if (typeof b.data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.data)) return json({ erro: "Informe uma data válida." }, 400);
      const { data, error } = await db.from("datas_liberacao_financeira").upsert({ data: b.data, status: "disponivel" }, { onConflict: "data" }).select("*").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ data });
    }

    if (request.method === "DELETE") {
      const dataSolicitada = url.searchParams.get("data");
      if (!dataSolicitada) return json({ erro: "Informe a data." }, 400);
      const { data: ocupacoes } = await db.from("agendamentos").select("id").eq("status", "confirmado").eq("previsao_liberacao_financeira", dataSolicitada).limit(1);
      if ((ocupacoes ?? []).length) return json({ erro: "Esta data já possui uma previsão confirmada e não pode ser fechada." }, 409);
      const { data, error } = await db.from("datas_liberacao_financeira").delete().eq("data", dataSolicitada).select("*").maybeSingle();
      if (error) return json({ erro: error.message }, 400);
      if (!data) return json({ erro: "Data não encontrada ou já estava fechada." }, 404);
      return json({ data });
    }
    return json({ erro: "Método não suportado." }, 405);
  }

  if (path === "/api/admin/solicitacoes-liberacao-financeira") {
    if (request.method === "GET") {
      const { data, error } = await db.from("solicitacoes_liberacao_financeira")
        .select("id, cliente_id, agendamento_id, forma_custeio, saldo_restante, taxa_cartao, total_com_taxa, status, observacao, created_at, updated_at, clientes(nome_completo, cpf, quantidade_parcelas), agendamentos(previsao_liberacao_financeira, datas(data))")
        .in("status", ["pendente", "em_analise", "aprovada"]).order("created_at", { ascending: true });
      if (error) return json({ erro: error.message }, 500);
      const solicitacoes = (data ?? []).filter((item: any) => !item.agendamentos?.previsao_liberacao_financeira).map((item: any) => {
        const dataTermos = item.agendamentos?.datas?.data ?? null;
        return { ...item, data_termos: dataTermos, previsao_sugerida: dataTermos ? adicionarDias(dataTermos, 90) : null };
      });
      return json({ solicitacoes });
    }

    if (request.method === "PATCH") {
      const b = await body(request);
      const id = typeof b.id === "string" ? b.id : null;
      const status = typeof b.status === "string" ? b.status : null;
      const dataLiberacao = typeof b.dataLiberacaoFinanceira === "string" ? b.dataLiberacaoFinanceira : null;
      const observacao = typeof b.observacao === "string" ? b.observacao.trim() : null;
      if (!id) return json({ erro: "Solicitação inválida." }, 400);
      if (status && !["pendente", "em_analise", "aprovada", "recusada"].includes(status)) return json({ erro: "Status inválido." }, 400);
      const { data: atual, error: erroAtual } = await db.from("solicitacoes_liberacao_financeira").select("id, cliente_id, agendamento_id, status, forma_custeio, saldo_restante, taxa_cartao, total_com_taxa").eq("id", id).single();
      if (erroAtual || !atual) return json({ erro: "Solicitação não encontrada." }, 404);
      const updates: Json = {};
      if (status) updates.status = status;
      if (observacao !== null) updates.observacao = observacao;
      if (dataLiberacao) {
        if (!atual.agendamento_id) return json({ erro: "A cliente ainda não possui agendamento confirmado para definir a previsão de liberação." }, 409);
        updates.status = status ?? "aprovada";
      }
      const { data: atualizado, error } = await db.from("solicitacoes_liberacao_financeira").update(updates).eq("id", id).select("id, cliente_id, agendamento_id, status, forma_custeio, saldo_restante, taxa_cartao, total_com_taxa, observacao").single();
      if (error) return json({ erro: error.message }, 500);
      if (dataLiberacao && atual.agendamento_id) {
        const { error: erroAgendamento } = await db.from("agendamentos").update({ previsao_liberacao_financeira: dataLiberacao }).eq("id", atual.agendamento_id);
        if (erroAgendamento) return json({ erro: erroAgendamento.message }, 500);
      }
      return json({ solicitacao: atualizado, dataLiberacaoFinanceira: dataLiberacao });
    }
    return json({ erro: "Método não suportado." }, 405);
  }

  if (path === "/api/admin/liberacao-inteligente" && request.method === "GET") {
    const ano = Number(url.searchParams.get("ano"));
    const mes = Number(url.searchParams.get("mes"));
    const agendamentoId = url.searchParams.get("agendamento_id") || null;
    if (!ano || !mes || mes < 1 || mes > 12) return json({ erro: "Parâmetros obrigatórios: ano, mes" }, 400);
    const hoje = hojeIso();
    let clienteId: string | null = null;
    let cliente: any = null;

    if (agendamentoId) {
      const { data: ag, error } = await db.from("agendamentos").select("cliente_id, valor_contrato, clientes(id, nome_completo, valor_contrato), datas(data)").eq("id", agendamentoId).eq("status", "confirmado").single();
      if (error || !ag) return json({ erro: "Agendamento não encontrado." }, 404);
      clienteId = ag.cliente_id;
      const dataTermos = Array.isArray((ag as any).datas) ? (ag as any).datas[0]?.data ?? null : (ag as any).datas?.data ?? null;
      cliente = { id: clienteId, nome: (ag as any).clientes?.nome_completo ?? "Cliente", valor: Number(ag.valor_contrato ?? 0), status: dataTermos && dataTermos <= hoje ? "termos_assinados" : "apta", dataTermos };
    }

    const { data: config } = await db.from("configuracoes").select("meta_orcamento_mensal").eq("id", 1).single();
    const orcamentoMensal = Number(config?.meta_orcamento_mensal ?? 100000);
    const fim = ano + 2;
    const [{ data: liberadas }, { data: confirmadas }] = await Promise.all([
      db.from("datas_liberacao_financeira").select("data").eq("status", "disponivel").gte("data", `${ano}-01-01`).lte("data", `${fim}-12-31`),
      db.from("agendamentos").select("cliente_id, valor_contrato, previsao_liberacao_financeira, clientes(nome_completo)").eq("status", "confirmado").not("previsao_liberacao_financeira", "is", null).gte("previsao_liberacao_financeira", `${ano}-01-01`).lte("previsao_liberacao_financeira", `${fim}-12-31`),
    ]);
    const disponibilizadas = new Set((liberadas ?? []).map((x: any) => x.data));
    const ocupadas = new Map<string, any>();
    const porMes = new Map<string, number>();
    for (const item of confirmadas ?? []) {
      const data = (item as any).previsao_liberacao_financeira as string | null;
      if (!data) continue;
      ocupadas.set(data, { nome: (item as any).clientes?.nome_completo ?? "Cliente", valor: Number(item.valor_contrato ?? 0), clienteId: item.cliente_id });
      if (!clienteId || item.cliente_id !== clienteId) porMes.set(data.slice(0, 7), (porMes.get(data.slice(0, 7)) ?? 0) + Number(item.valor_contrato ?? 0));
    }
    const analisar = (anoM: number, mesM: number) => {
      const total = new Date(anoM, mesM, 0).getDate();
      const mesStr = String(mesM).padStart(2, "0");
      const comprometido = porMes.get(`${anoM}-${mesStr}`) ?? 0;
      return Array.from({ length: total }, (_, i) => {
        const dia = i + 1; const data = `${anoM}-${mesStr}-${String(dia).padStart(2, "0")}`;
        const ocupante = ocupadas.get(data); const passado = data < hoje;
        const disponibilizada = disponibilizadas.has(data);
        const depois = comprometido + (cliente?.valor ?? 0); const ultrapassagem = Math.max(0, depois - orcamentoMensal);
        const estado = passado ? "passado" : ocupante ? "vermelho" : !disponibilizada ? "cinza" : !cliente ? "verde" : depois <= orcamentoMensal ? "verde" : "amarelo";
        return { data, dia, estado, vagasDisponiveis: !passado && !ocupante && disponibilizada, oracamentoAntes: comprometido, oracamentoDepois: cliente ? depois : comprometido, ultrapassagem, dentroOrcamento: depois <= orcamentoMensal, diasDisponibilizados: disponibilizada ? 1 : 0, ocupante: ocupante ? { nome: ocupante.nome, valor: ocupante.valor } : null };
      });
    };
    const dias = analisar(ano, mes);
    let melhorData: any = null;
    if (cliente?.dataTermos && cliente.dataTermos <= hoje) {
      const sugerida = adicionarDias(cliente.dataTermos, 90); const [a, m, d] = sugerida.split("-").map(Number); const analiseMes = a === ano && m === mes ? dias : analisar(a, m); const dia = analiseMes.find((x: any) => x.data === sugerida); const antes = dia?.oracamentoAntes ?? (porMes.get(sugerida.slice(0, 7)) ?? 0); const depois = antes + cliente.valor;
      melhorData = { data: sugerida, dia: d, mes: m, ano: a, oracamentoMes: orcamentoMensal, comprometidoAntes: antes, valorCliente: cliente.valor, totalDepois: depois, dentroOrcamento: depois <= orcamentoMensal, motivo: "Sugestão automática: 90 dias corridos após a assinatura dos termos." };
    }
    const verdes = dias.filter((d: any) => d.estado === "verde").slice(0, 5).map((d: any) => ({ data: d.data, dia: d.dia, estado: "verde", oracamentoDepois: d.oracamentoDepois, ultrapassagem: 0, motivo: "Data disponível dentro do orçamento mensal" }));
    const amarelas = dias.filter((d: any) => d.estado === "amarelo").slice(0, 5).map((d: any) => ({ data: d.data, dia: d.dia, estado: "amarelo", oracamentoDepois: d.oracamentoDepois, ultrapassagem: d.ultrapassagem, motivo: `Ultrapassa o orçamento em ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(d.ultrapassagem)}.` }));
    return json({ cliente, orcamentoMensal, calendario: { ano, mes, dias }, melhorData, alternativas: { verdes, amarelas } });
  }

  if (path === "/api/admin/monitoramento-app" && request.method === "GET") {
    const [{ data: clientes, error: erroClientes }, { data: devices, error: erroDevices }] = await Promise.all([
      db.from("clientes").select("id, nome_completo, cpf, ativo").eq("ativo", true).order("nome_completo", { ascending: true }),
      db.from("cliente_app_devices").select("cliente_id, device_key, device_type, display_mode, is_pwa_installed, notification_permission, push_active, user_agent, first_access_at, last_access_at, pwa_installed_at, notifications_activated_at").order("last_access_at", { ascending: false }),
    ]);
    if (erroClientes) return json({ erro: erroClientes.message }, 500);
    if (erroDevices) return json({ erro: erroDevices.message }, 500);
    const mapa = new Map<string, any[]>();
    for (const d of devices ?? []) { const lista = mapa.get(d.cliente_id) ?? []; lista.push(d); mapa.set(d.cliente_id, lista); }
    const resumo = (clientes ?? []).map((cliente: any) => {
      const lista = mapa.get(cliente.id) ?? []; const ultimo = lista[0] ?? null;
      const primeiro = lista.reduce((m: string | null, x: any) => !x.first_access_at ? m : !m || new Date(x.first_access_at) < new Date(m) ? x.first_access_at : m, null);
      const ultimoAcesso = lista.reduce((m: string | null, x: any) => !x.last_access_at ? m : !m || new Date(x.last_access_at) > new Date(m) ? x.last_access_at : m, null);
      const pwa = lista.some((x: any) => x.is_pwa_installed); const push = lista.some((x: any) => x.notification_permission === "granted" && x.push_active); const deniedPush = !push && lista.some((x: any) => x.notification_permission === "denied");
      return { cliente_id: cliente.id, cliente, device_key: ultimo?.device_key ?? null, device_type: ultimo?.device_type ?? null, display_mode: ultimo?.display_mode ?? null, is_pwa_installed: pwa, notification_permission: deniedPush ? "denied" : push ? "granted" : "default", push_active: push, first_access_at: primeiro, last_access_at: ultimoAcesso, pwa_installed_at: lista.find((x: any) => x.pwa_installed_at)?.pwa_installed_at ?? null, notifications_activated_at: lista.find((x: any) => x.notifications_activated_at)?.notifications_activated_at ?? null, dispositivos_count: lista.length };
    });
    return json({ dispositivos: devices ?? [], resumo, metricas: { clientesMonitoradas: resumo.length, pwaInstalado: resumo.filter((x: any) => x.is_pwa_installed).length, pwaNaoInstalado: resumo.filter((x: any) => !x.is_pwa_installed).length, notificacoesAtivas: resumo.filter((x: any) => x.push_active).length, notificacoesNaoAtivadas: resumo.filter((x: any) => !x.push_active).length, notificacoesBloqueadas: resumo.filter((x: any) => x.notification_permission === "denied").length, acessoWeb: resumo.filter((x: any) => x.display_mode === "browser").length } });
  }

  return null;
}
