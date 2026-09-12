import { createServiceSupabaseClient, type Env } from "./supabase";
import { obterCredencial } from "./integrations-credenciais";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

type EstadoIntegracao = "pronto_para_configurar" | "credenciais_presentes" | "planejado" | "base_incompleta";

type StatusIntegracao = {
  id: string;
  nome: string;
  grupo: "comunicacao" | "pagamentos" | "crm" | "bancos";
  estado: EstadoIntegracao;
  credenciaisConfiguradas: boolean;
  persistenciaPronta: boolean;
  conexaoLiveVerificada: false;
  detalhes: string;
  eventosRegistrados?: number;
};

async function tabelaDisponivel(db: ReturnType<typeof createServiceSupabaseClient>, tabela: string) {
  const { error } = await db.from(tabela).select("id", { count: "exact", head: true });
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

export async function integrationsStatusApi(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== "/api/admin/integrations/status" || request.method !== "GET") return null;

  const db = createServiceSupabaseClient(env);
  const [
    pushTable,
    eventTable,
    paymentTable,
    contaAzulTable,
    rdTable,
    pushCount,
    paymentCount,
    contaAzulCount,
    rdCount,
  ] = await Promise.all([
    tabelaDisponivel(db, "web_push_subscriptions"),
    tabelaDisponivel(db, "integracao_eventos"),
    tabelaDisponivel(db, "pagamentos_externos"),
    tabelaDisponivel(db, "conta_azul_operacoes"),
    tabelaDisponivel(db, "crm_vendas_entrada"),
    contar(db, "web_push_subscriptions"),
    contar(db, "pagamentos_externos"),
    contar(db, "conta_azul_operacoes"),
    contar(db, "crm_vendas_entrada"),
  ]);

  const [
    pushPublicKey, pushPrivateKey, pushSubject,
    mpAccessToken, mpWebhookSecret,
    caClientId, caClientSecret, caAccessToken, caRefreshToken,
    rdWebhookSecret, rdApiToken,
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
    obterCredencial(env, "rd_station", "api_access_token"),
  ]);

  const pushCredenciais = Boolean(pushPublicKey && pushPrivateKey && pushSubject);
  const mpCredenciais = Boolean(mpAccessToken && mpWebhookSecret);
  const contaAzulCredenciais = Boolean(caClientId && caClientSecret && caAccessToken && caRefreshToken);
  const rdCredenciais = Boolean(rdWebhookSecret && rdApiToken);

  const integracoes: StatusIntegracao[] = [
    {
      id: "web_push",
      nome: "Web Push",
      grupo: "comunicacao",
      estado: estadoBase(pushTable, pushCredenciais),
      credenciaisConfiguradas: pushCredenciais,
      persistenciaPronta: pushTable,
      conexaoLiveVerificada: false,
      detalhes: pushCredenciais
        ? "Credenciais VAPID presentes. O envio live continuará desativado até homologação específica."
        : "Assinaturas e rotas estão prontas; faltam as chaves VAPID para ativação futura.",
      eventosRegistrados: pushCount,
    },
    {
      id: "mercado_pago",
      nome: "Mercado Pago",
      grupo: "pagamentos",
      estado: estadoBase(paymentTable && eventTable, mpCredenciais),
      credenciaisConfiguradas: mpCredenciais,
      persistenciaPronta: paymentTable && eventTable,
      conexaoLiveVerificada: false,
      detalhes: mpCredenciais
        ? "Credenciais presentes no backend; conexão live não foi homologada."
        : "Checkout, webhook e persistência estão modelados para conexão futura.",
      eventosRegistrados: paymentCount,
    },
    {
      id: "conta_azul",
      nome: "Conta Azul",
      grupo: "pagamentos",
      estado: estadoBase(contaAzulTable, contaAzulCredenciais),
      credenciaisConfiguradas: contaAzulCredenciais,
      persistenciaPronta: contaAzulTable,
      conexaoLiveVerificada: false,
      detalhes: contaAzulCredenciais
        ? "Credenciais presentes no backend; sincronização live permanece sem homologação."
        : "Estrutura de contas a receber está preparada para conexão futura.",
      eventosRegistrados: contaAzulCount,
    },
    {
      id: "rd_station",
      nome: "RD Station CRM",
      grupo: "crm",
      estado: estadoBase(rdTable && eventTable, rdCredenciais),
      credenciaisConfiguradas: rdCredenciais,
      persistenciaPronta: rdTable && eventTable,
      conexaoLiveVerificada: false,
      detalhes: rdCredenciais
        ? "Credenciais presentes no backend; webhook live não foi homologado."
        : "Entrada de vendas e auditoria estão preparadas para conexão futura.",
      eventosRegistrados: rdCount,
    },
  ];

  const [brbSecret, bbSecret, santanderSecret, sicrediSecret, efiSecret] = await Promise.all([
    obterCredencial(env, "brb", "webhook_secret"),
    obterCredencial(env, "bb", "webhook_secret"),
    obterCredencial(env, "santander", "webhook_secret"),
    obterCredencial(env, "sicredi", "webhook_secret"),
    obterCredencial(env, "efi", "webhook_secret"),
  ]);
  const bancos = [
    ["brb", "BRB", Boolean(brbSecret)],
    ["bb", "Banco do Brasil", Boolean(bbSecret)],
    ["santander", "Santander", Boolean(santanderSecret)],
    ["sicredi", "Sicredi", Boolean(sicrediSecret)],
    ["efi", "Efí", Boolean(efiSecret)],
  ] as const;

  for (const [id, nome, credenciais] of bancos) {
    integracoes.push({
      id,
      nome,
      grupo: "bancos",
      estado: "planejado",
      credenciaisConfiguradas: credenciais,
      persistenciaPronta: eventTable,
      conexaoLiveVerificada: false,
      detalhes: credenciais
        ? "Segredo reservado no backend. Adapter bancário ainda depende da homologação do provedor."
        : "Provider reservado na arquitetura; credenciais e homologação serão configuradas futuramente.",
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
      conexoesLiveVerificadas: 0,
    },
    observacao: "Este painel não executa testes contra provedores externos. Conexões live serão homologadas futuramente.",
  });
}
