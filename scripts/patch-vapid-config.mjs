import fs from "node:fs";

function patch(path, operations) {
  let source = fs.readFileSync(path, "utf8");
  for (const [before, after, label] of operations) {
    if (!source.includes(before)) throw new Error(`${path}: trecho não encontrado (${label})`);
    source = source.replace(before, after);
  }
  fs.writeFileSync(path, source);
}

patch("worker/integrations-core.ts", [
  [
    'import { rdStationReadonlyApi } from "./rd-station-readonly";',
    'import { rdStationReadonlyApi } from "./rd-station-readonly";\nimport { webPushConfigApi } from "./web-push-config";',
    "import web push config",
  ],
  [
    'export async function integrationsApi(request: Request, env: Env): Promise<Response | null> {\n  const rd = await rdStationReadonlyApi(request, env);',
    'export async function integrationsApi(request: Request, env: Env): Promise<Response | null> {\n  const webPush = await webPushConfigApi(request, env);\n  if (webPush) return webPush;\n\n  const rd = await rdStationReadonlyApi(request, env);',
    "route web push config",
  ],
]);

patch("worker/integrations-status.ts", [
  [
    'import { createServiceSupabaseClient, type Env } from "./supabase";',
    'import { createServiceSupabaseClient, type Env } from "./supabase";\nimport { validarConfiguracaoVapid } from "./web-push-config";',
    "import vapid validator",
  ],
  [
    '  const pushCredenciais = Boolean(pushPublicKey && pushPrivateKey && pushSubject);\n  const mpCredenciais = Boolean(mpAccessToken && mpWebhookSecret);',
    '  const pushCredenciais = Boolean(pushPublicKey && pushPrivateKey && pushSubject);\n  const pushValidacao = pushCredenciais\n    ? await validarConfiguracaoVapid({ subject: pushSubject!, publicKey: pushPublicKey!, privateKey: pushPrivateKey! })\n    : { valido: false, detalhe: "As três credenciais VAPID ainda não estão configuradas." };\n  const { data: testePush } = await db.from("logs_alteracoes").select("created_at,detalhes")\n    .eq("acao", "testou_conexao_integracao").eq("entidade_id", "web_push").order("created_at", { ascending: false }).limit(1).maybeSingle();\n  const mpCredenciais = Boolean(mpAccessToken && mpWebhookSecret);',
    "validate web push credentials",
  ],
  [
    '    {\n      id: "web_push", nome: "Web Push", grupo: "comunicacao", estado: estadoBase(pushTable, pushCredenciais),\n      credenciaisConfiguradas: pushCredenciais, persistenciaPronta: pushTable, conexaoLiveVerificada: false,\n      detalhes: pushCredenciais ? "Credenciais VAPID presentes. Envio depende de assinatura ativa do dispositivo." : "Assinaturas e rotas estão prontas; faltam as chaves VAPID.",\n      eventosRegistrados: pushCount,\n    },',
    '    {\n      id: "web_push", nome: "Web Push", grupo: "comunicacao", estado: estadoBase(pushTable, pushCredenciais),\n      credenciaisConfiguradas: pushCredenciais, persistenciaPronta: pushTable, conexaoLiveVerificada: pushValidacao.valido,\n      detalhes: pushValidacao.valido\n        ? "Configuração VAPID validada criptograficamente pelo sistema. O envio usa as chaves salvas no painel."\n        : pushCredenciais\n          ? `Credenciais VAPID presentes, mas inválidas: ${pushValidacao.detalhe}`\n          : "Assinaturas e rotas estão prontas; configure ou gere as chaves VAPID pelo painel.",\n      eventosRegistrados: pushCount,\n      ultimaVerificacao: testePush?.created_at ?? null,\n    },',
    "real web push status",
  ],
]);

patch("src/app/admin/(painel)/integracoes/page.tsx", [
  [
    'import { zipChip, type ZipKind } from "@/components/admin-zip/zipUi";',
    'import { zipChip, type ZipKind } from "@/components/admin-zip/zipUi";\nimport { WebPushSettings } from "@/features/admin/WebPushSettings";',
    "import web push settings",
  ],
  [
    '{i.conexaoLiveVerificada ? "Conectada" : estadoLabel(i.estado)}',
    '{i.conexaoLiveVerificada ? (i.id === "web_push" ? "Validada" : "Conectada") : estadoLabel(i.estado)}',
    "web push row status label",
  ],
  [
    '{drawerAtual.conexaoLiveVerificada ? "Conectada" : estadoLabel(drawerAtual.estado)}',
    '{drawerAtual.conexaoLiveVerificada ? (drawerAtual.id === "web_push" ? "Validada" : "Conectada") : estadoLabel(drawerAtual.estado)}',
    "web push drawer status label",
  ],
  [
    '{provedorDrawer ? (credenciais?.persistenciaPronta ? <FormularioCredenciaisZip provedor={provedorDrawer} onSalvo={() => void atualizar()} /> : <p style={{ fontSize: 10.5, color: "var(--gold)" }}>Estrutura de persistência ainda não aplicada neste ambiente.</p>) : <p style={{ fontSize: 10.5, color: "var(--soft)" }}>Este provedor não tem campos de credencial cadastrados.</p>}',
    '{provedorDrawer ? (credenciais?.persistenciaPronta ? (drawerAtual.id === "web_push" ? <WebPushSettings onChanged={() => void atualizar()} /> : <FormularioCredenciaisZip provedor={provedorDrawer} onSalvo={() => void atualizar()} />) : <p style={{ fontSize: 10.5, color: "var(--gold)" }}>Estrutura de persistência ainda não aplicada neste ambiente.</p>) : <p style={{ fontSize: 10.5, color: "var(--soft)" }}>Este provedor não tem campos de credencial cadastrados.</p>}',
    "dedicated web push form",
  ],
]);

console.log("VAPID configuration patches applied.");
