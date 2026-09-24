import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { estadosIntegracoes, obterCredencial } from "./integrations-credenciais";
import { getCookie, verificarTokenAdmin } from "./session";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { validarConfiguracaoVapid } from "./web-push-config";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

type EstadoIntegracao = "pronto_para_configurar" | "credenciais_presentes" | "planejado" | "base_incompleta";
type EstadoValidacao = "nao_configurada" | "credenciais_salvas" | "aguardando_validacao" | "conectada" | "erro_autenticacao" | "erro_configuracao" | "indisponivel" | "planejada";

type StatusIntegracao = {
  id: string;
  nome: string;
  grupo: "comunicacao" | "pagamentos" | "crm" | "bancos";
  estado: EstadoIntegracao;
  credenciaisConfiguradas: boolean;
  persistenciaPronta: boolean;
  conexaoLiveVerificada: boolean;
  detalhes: string;
  eventosRegistrados?: number;
  ultimaVerificacao?: string | null;
  ultimaSincronizacao?: string | null;
  ultimoWebhook?: string | null;
  errosRecentes?: number;
  oauthConfigurado?: boolean;
  oauthAutorizado?: boolean;
  modoLeitura?: boolean;
  ativo?: boolean;
  ativacaoConfigurada?: boolean;
  estadoValidacao?: EstadoValidacao;
  codigoValidacao?: string | null;
  latenciaMs?: number | null;
};

async function exigirAdminAtivo(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return { resposta: json({ erro: "Serviço temporariamente indisponível." }, 503), adminId: null };
  const sessao = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  if (!sessao) return { resposta: json({ erro: "Sessão administrativa expirada." }, 401), adminId: null };
  const colaborador = await buscarColaboradorAdminAtivo(sessao.adminId, env).catch(() => null);
  if (!colaborador) return { resposta: json({ erro: "Acesso administrativo inativo ou não autorizado." }, 403), adminId: null };
  if (!temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.INTEGRACOES_GERENCIAR_CREDENCIAIS)) {
    return { resposta: json({ erro: "Seu papel não tem permissão para visualizar o painel de integrações." }, 403), adminId: null };
  }
  return { resposta: null, adminId: sessao.adminId };
}

async function tabelaDisponivel(db: ReturnType<typeof createServiceSupabaseClient>, tabela: string, chave = "id") {
  const { error } = await db.from(tabela).select(chave, { count: "exact", head: true });
  return !error;
}

async function contar(db: ReturnType<typeof createServiceSupabaseClient>, tabela: string) {
  const { count, error } = await db.from(tabela).select("id", { count: "exact", head: true });
  return error ? undefined : (count ?? 0);
}

function estadoBase(persistenciaPronta: boolean, credenciaisConfiguradas: boolean): EstadoIntegracao {
  if (!persistenciaPronta) return "base_incompleta";
  return credenciaisConfiguradas ? "credenciais_presentes" : "pronto_para_configurar";
}

function estadoValidacaoDe(input: {
  credenciais: boolean;
  ativo: boolean;
  ativacaoConfigurada: boolean;
  teste?: { detalhes?: any; created_at?: string } | null;
  planejada?: boolean;
}): { estado: EstadoValidacao; codigo: string | null; latencia: number | null } {
  if (input.planejada) return { estado: "planejada", codigo: "VALIDACAO_REAL_INDISPONIVEL", latencia: null };
  if (!input.credenciais) return { estado: "nao_configurada", codigo: null, latencia: null };
  const d = input.teste?.detalhes ?? {};
  const codigo = typeof d.codigo === "string" ? d.codigo : null;
  const latencia = Number.isFinite(Number(d.latenciaMs)) ? Number(d.latenciaMs) : null;
  if (input.ativo && d.conectado === true) return { estado: "conectada", codigo, latencia };
  if (d.conectado === false) {
    if (codigo === "AUTENTICACAO_RECUSADA" || codigo === "OAUTH_NAO_AUTORIZADO") return { estado: "erro_autenticacao", codigo, latencia };
    if (codigo === "PROVEDOR_INDISPONIVEL") return { estado: "indisponivel", codigo, latencia };
    return { estado: "erro_configuracao", codigo, latencia };
  }
  return { estado: input.ativacaoConfigurada ? "credenciais_salvas" : "aguardando_validacao", codigo, latencia };
}

export async function integrationsStatusApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const historico = path === "/api/admin/integrations/historico" && request.method === "GET";
  const status = path === "/api/admin/integrations/status" && request.method === "GET";
  if (!historico && !status) return null;

  // Este handler é chamado pelo monitoramento antes do roteador administrativo
  // genérico. Por isso a autenticação precisa acontecer aqui, e não pode ser
  // presumida pelo prefixo /api/admin/*.
  const auth = await exigirAdminAtivo(request, env);
  if (auth.resposta) return auth.resposta;

  const db = createServiceSupabaseClient(env);
  const estados = await estadosIntegracoes(env, true);
  if (historico) {
    const { data, error } = await db.from("logs_alteracoes").select("id,usuario,acao,entidade_id,detalhes,created_at")
      .in("entidade", ["integracoes", "integracoes_credenciais"]).order("created_at", { ascending: false }).limit(100);
    if (error) return json({ erro: "Não foi possível carregar o histórico de integrações." }, 500);
    return json({ eventos: data ?? [] });
  }

  const [pushTable, eventTable, paymentTable, contaAzulTable, rdRawTable, novasVendasTable] = await Promise.all([
    tabelaDisponivel(db, "web_push_subscriptions"),
    tabelaDisponivel(db, "integracao_eventos"),
    tabelaDisponivel(db, "pagamentos_externos"),
    tabelaDisponivel(db, "conta_azul_operacoes"),
    tabelaDisponivel(db, "crm_vendas_entrada"),
    tabelaDisponivel(db, "novas_vendas"),
  ]);

  const [pushCount, paymentCount, contaAzulCount, rdCount] = await Promise.all([
    contar(db, "web_push_subscriptions"), contar(db, "pagamentos_externos"), contar(db, "conta_azul_operacoes"), contar(db, "novas_vendas"),
  ]);

  const [
    pushPublicKey, pushPrivateKey, pushSubject,
    mpAccessToken, mpWebhookSecret,
    caClientId, caClientSecret, caAccessToken, caRefreshToken,
    rdWebhookSecret, rdClientId, rdClientSecret, rdAccessToken, rdLegacyToken, rdRefreshToken,
  ] = await Promise.all([
    obterCredencial(env, "web_push", "vapid_public_key"),
    obterCredencial(env, "web_push", "vapid_private_key"),
    obterCredencial(env, "web_push", "vapid_subject"),
    obterCredencial(env, "mercado_pago", "access_token"),
    obterCredencial(env, "mercado_pago", "webhook_secret"),
    obterCredencial(env, "conta_azul", "client_id"),
    obterCredencial(env, "conta_azul", "client_secret"),
    obterCredencial(env, "conta_azul", "access_token"),
    obterCredencial(env, "conta_azul", "refresh_token"),
    obterCredencial(env, "rd_station", "webhook_secret"),
    obterCredencial(env, "rd_station", "client_id"),
    obterCredencial(env, "rd_station", "client_secret"),
    obterCredencial(env, "rd_station", "access_token"),
    obterCredencial(env, "rd_station", "api_access_token"),
    obterCredencial(env, "rd_station", "refresh_token"),
  ]);

  const pushCredenciais = Boolean(pushPublicKey && pushPrivateKey && pushSubject);
  const pushValidacao = pushCredenciais
    ? await validarConfiguracaoVapid({ subject: pushSubject!, publicKey: pushPublicKey!, privateKey: pushPrivateKey! })
    : { valido: false, detalhe: "As três credenciais VAPID ainda não estão configuradas." };
  const { data: testePush } = await db.from("logs_alteracoes").select("created_at,detalhes")
    .eq("acao", "testou_conexao_integracao").eq("entidade_id", "web_push").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const mpCredenciais = Boolean(mpAccessToken && mpWebhookSecret);
  const contaAzulCredenciais = Boolean(caClientId && caClientSecret && caAccessToken && caRefreshToken);
  const rdOauthConfigurado = Boolean(rdClientId && rdClientSecret);
  const rdOauthAutorizado = Boolean(rdAccessToken || rdLegacyToken);
  const rdCredenciais = Boolean(rdWebhookSecret && rdOauthConfigurado);
  const rdPersistencia = rdRawTable && eventTable && novasVendasTable;

  let rdUltimaSincronizacao: string | null = null;
  let rdUltimoWebhook: string | null = null;
  let rdErros = 0;
  let rdUltimaVerificacao: string | null = null;
  let rdConectado = false;
  if (eventTable) {
    const [{ data: sync }, { count: erros }] = await Promise.all([
      db.from("integracao_eventos").select("created_at").eq("provedor", "rd_station").eq("event_type", "sync_manual").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("integracao_eventos").select("id", { count: "exact", head: true }).eq("provedor", "rd_station").eq("status", "erro"),
    ]);
    rdUltimaSincronizacao = sync?.created_at ?? null;
    rdErros = erros ?? 0;
  }
  if (rdRawTable) {
    const { data: webhook } = await db.from("crm_vendas_entrada").select("created_at").eq("provedor", "rd_station").order("created_at", { ascending: false }).limit(1).maybeSingle();
    rdUltimoWebhook = webhook?.created_at ?? null;
  }
  const { data: testeRd } = await db.from("logs_alteracoes").select("detalhes,created_at")
    .eq("acao", "testou_conexao_integracao").eq("entidade_id", "rd_station").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (testeRd) {
    rdUltimaVerificacao = testeRd.created_at;
    rdConectado = Boolean((testeRd.detalhes as any)?.conectado);
  }

  const provedoresTeste = ["web_push", "mercado_pago", "conta_azul", "rd_station", "gemini", "brb", "bb", "santander", "sicredi", "efi"];
  const testes = new Map<string, any>();
  for (const provedor of provedoresTeste) {
    const { data } = await db.from("logs_alteracoes").select("created_at,detalhes")
      .eq("acao", "testou_conexao_integracao").eq("entidade_id", provedor)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    testes.set(provedor, data ?? null);
  }
  const estadoAtivo = (provedor: string) => ({
    ativo: estados.get(provedor)?.ativo === true,
    ativacaoConfigurada: estados.has(provedor),
  });

  const integracoes: StatusIntegracao[] = [
    {
      id: "web_push", nome: "Web Push", grupo: "comunicacao", estado: estadoBase(pushTable, pushCredenciais),
      credenciaisConfiguradas: pushCredenciais, persistenciaPronta: pushTable, conexaoLiveVerificada: estadoAtivo("web_push").ativo && pushValidacao.valido,
      detalhes: pushValidacao.valido
        ? "Configuração VAPID validada criptograficamente pelo sistema. O envio usa as chaves salvas no painel."
        : pushCredenciais
          ? `Credenciais VAPID presentes, mas inválidas: ${pushValidacao.detalhe}`
          : "Assinaturas e rotas estão prontas; configure ou gere as chaves VAPID pelo painel.",
      eventosRegistrados: pushCount,
      ultimaVerificacao: testePush?.created_at ?? null,
      ...estadoAtivo("web_push"),
      estadoValidacao: estadoValidacaoDe({ credenciais: pushCredenciais, ...estadoAtivo("web_push"), teste: testes.get("web_push") }).estado,
      codigoValidacao: estadoValidacaoDe({ credenciais: pushCredenciais, ...estadoAtivo("web_push"), teste: testes.get("web_push") }).codigo,
      latenciaMs: estadoValidacaoDe({ credenciais: pushCredenciais, ...estadoAtivo("web_push"), teste: testes.get("web_push") }).latencia,
    },
    {
      id: "mercado_pago", nome: "Mercado Pago", grupo: "pagamentos", estado: estadoBase(paymentTable && eventTable, mpCredenciais),
      credenciaisConfiguradas: mpCredenciais, persistenciaPronta: paymentTable && eventTable,
      conexaoLiveVerificada: estadoAtivo("mercado_pago").ativo && (testes.get("mercado_pago")?.detalhes as any)?.conectado === true,
      detalhes: mpCredenciais ? "Credenciais salvas. O estado conectado só é exibido após teste real aprovado pelo Mercado Pago." : "Checkout e webhook estão preparados para conferência financeira manual.",
      eventosRegistrados: paymentCount,
      ultimaVerificacao: testes.get("mercado_pago")?.created_at ?? null,
      ...estadoAtivo("mercado_pago"),
      estadoValidacao: estadoValidacaoDe({ credenciais: mpCredenciais, ...estadoAtivo("mercado_pago"), teste: testes.get("mercado_pago") }).estado,
      codigoValidacao: estadoValidacaoDe({ credenciais: mpCredenciais, ...estadoAtivo("mercado_pago"), teste: testes.get("mercado_pago") }).codigo,
      latenciaMs: estadoValidacaoDe({ credenciais: mpCredenciais, ...estadoAtivo("mercado_pago"), teste: testes.get("mercado_pago") }).latencia,
    },
    {
      id: "conta_azul", nome: "Conta Azul", grupo: "pagamentos", estado: estadoBase(contaAzulTable, contaAzulCredenciais),
      credenciaisConfiguradas: contaAzulCredenciais, persistenciaPronta: contaAzulTable,
      conexaoLiveVerificada: estadoAtivo("conta_azul").ativo && (testes.get("conta_azul")?.detalhes as any)?.conectado === true,
      detalhes: contaAzulCredenciais ? "Credenciais salvas. A conexão só fica ativa após a Conta Azul responder ao teste real." : "Configure OAuth e autorize a conta antes de ativar.",
      eventosRegistrados: contaAzulCount,
      ultimaVerificacao: testes.get("conta_azul")?.created_at ?? null,
      ...estadoAtivo("conta_azul"),
      estadoValidacao: estadoValidacaoDe({ credenciais: contaAzulCredenciais, ...estadoAtivo("conta_azul"), teste: testes.get("conta_azul") }).estado,
      codigoValidacao: estadoValidacaoDe({ credenciais: contaAzulCredenciais, ...estadoAtivo("conta_azul"), teste: testes.get("conta_azul") }).codigo,
      latenciaMs: estadoValidacaoDe({ credenciais: contaAzulCredenciais, ...estadoAtivo("conta_azul"), teste: testes.get("conta_azul") }).latencia,
    },
    {
      id: "rd_station", nome: "RD Station CRM", grupo: "crm", estado: estadoBase(rdPersistencia, rdCredenciais),
      credenciaisConfiguradas: rdCredenciais, persistenciaPronta: rdPersistencia, conexaoLiveVerificada: estadoAtivo("rd_station").ativo && rdConectado,
      detalhes: rdOauthAutorizado
        ? "Integração somente leitura autorizada: o Sra. Luck consulta/recebe dados do RD e nunca escreve dados comerciais de volta."
        : rdOauthConfigurado
          ? "OAuth configurado, aguardando autorização da conta RD Station. Integração comercial é estritamente somente leitura."
          : "Configure OAuth e o segredo do webhook. Alterações locais nunca são enviadas ao RD Station.",
      eventosRegistrados: rdCount,
      ultimaVerificacao: rdUltimaVerificacao,
      ultimaSincronizacao: rdUltimaSincronizacao,
      ultimoWebhook: rdUltimoWebhook,
      errosRecentes: rdErros,
      oauthConfigurado: rdOauthConfigurado,
      oauthAutorizado: rdOauthAutorizado && Boolean(rdRefreshToken || rdLegacyToken),
      modoLeitura: true,
      ...estadoAtivo("rd_station"),
      estadoValidacao: estadoValidacaoDe({ credenciais: rdCredenciais, ...estadoAtivo("rd_station"), teste: testes.get("rd_station") }).estado,
      codigoValidacao: estadoValidacaoDe({ credenciais: rdCredenciais, ...estadoAtivo("rd_station"), teste: testes.get("rd_station") }).codigo,
      latenciaMs: estadoValidacaoDe({ credenciais: rdCredenciais, ...estadoAtivo("rd_station"), teste: testes.get("rd_station") }).latencia,
    },
  ];

  const [geminiChave, frasesTabela, { data: testeGemini }, { count: frasesIa }] = await Promise.all([
    obterCredencial(env, "gemini", "api_key"),
    tabelaDisponivel(db, "mensagens_do_dia", "data"),
    db.from("logs_alteracoes").select("created_at,detalhes").eq("acao", "testou_conexao_integracao").eq("entidade_id", "gemini").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("mensagens_do_dia").select("data", { count: "exact", head: true }).eq("origem", "ia"),
  ]);
  const geminiConectado = Boolean(geminiChave && estadoAtivo("gemini").ativo && (testeGemini?.detalhes as any)?.conectado);
  integracoes.push({
    id: "gemini", nome: "Gemini (frase do dia)", grupo: "comunicacao", estado: estadoBase(frasesTabela, Boolean(geminiChave)),
    credenciaisConfiguradas: Boolean(geminiChave), persistenciaPronta: frasesTabela, conexaoLiveVerificada: geminiConectado,
    detalhes: geminiChave
      ? "Rotina diária (00:05) prepara 1 candidata global, sem dados pessoais. A equipe aprova antes de publicar; se o Gemini falhar, o app mostra a frase de reserva."
      : "Cole a API Key gratuita do Google AI Studio para ativar a mensagem do dia por IA. Enquanto isso, a rotina diária usa o catálogo de frases.",
    eventosRegistrados: frasesIa ?? 0,
    ultimaVerificacao: testeGemini?.created_at ?? null,
    ...estadoAtivo("gemini"),
    estadoValidacao: estadoValidacaoDe({ credenciais: Boolean(geminiChave), ...estadoAtivo("gemini"), teste: testes.get("gemini") }).estado,
    codigoValidacao: estadoValidacaoDe({ credenciais: Boolean(geminiChave), ...estadoAtivo("gemini"), teste: testes.get("gemini") }).codigo,
    latenciaMs: estadoValidacaoDe({ credenciais: Boolean(geminiChave), ...estadoAtivo("gemini"), teste: testes.get("gemini") }).latencia,
  });

  const [brbSecret, bbSecret, santanderSecret, sicrediSecret, efiSecret] = await Promise.all([
    obterCredencial(env, "brb", "webhook_secret"), obterCredencial(env, "bb", "webhook_secret"), obterCredencial(env, "santander", "webhook_secret"), obterCredencial(env, "sicredi", "webhook_secret"), obterCredencial(env, "efi", "webhook_secret"),
  ]);
  const bancos = [["brb", "BRB", Boolean(brbSecret)], ["bb", "Banco do Brasil", Boolean(bbSecret)], ["santander", "Santander", Boolean(santanderSecret)], ["sicredi", "Sicredi", Boolean(sicrediSecret)], ["efi", "Efí", Boolean(efiSecret)]] as const;
  for (const [id, nome, credenciais] of bancos) {
    integracoes.push({
      id, nome, grupo: "bancos", estado: "planejado", credenciaisConfiguradas: credenciais, persistenciaPronta: eventTable, conexaoLiveVerificada: false,
      detalhes: credenciais ? "Credencial salva, mas o adapter ainda não possui validação real; por segurança, a integração não pode ser ativada." : "Adapter reservado na arquitetura; sem validação real, não existe status Conectada.",
      ...estadoAtivo(id),
      estadoValidacao: estadoValidacaoDe({ credenciais, ...estadoAtivo(id), teste: testes.get(id), planejada: true }).estado,
      codigoValidacao: "VALIDACAO_REAL_INDISPONIVEL",
      latenciaMs: null,
    });
  }

  return json({
    integracoes,
    resumo: {
      total: integracoes.length,
      prontosParaConfigurar: integracoes.filter((item) => item.estado === "pronto_para_configurar").length,
      credenciaisPresentes: integracoes.filter((item) => item.estado === "credenciais_presentes").length,
      planejados: integracoes.filter((item) => item.estado === "planejado").length,
      baseIncompleta: integracoes.filter((item) => item.estado === "base_incompleta").length,
      conexoesLiveVerificadas: integracoes.filter((item) => item.conexaoLiveVerificada).length,
    },
    observacao: "Status Conectada exige ativação explícita e validação real. Presença de credencial, sozinha, nunca significa conexão.",
  });
}
