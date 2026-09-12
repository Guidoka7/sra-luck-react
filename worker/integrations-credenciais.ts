import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenAdmin } from "./session";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function requireAdmin(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const session = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  return session?.adminId ?? null;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

// ----------------------------------------------------------------------------
// Catálogo de provedores configuráveis pelo painel. Cada campo mapeia para a
// mesma variável de ambiente que o Worker já sabe ler — assim, um valor salvo
// aqui substitui a variável de ambiente sem exigir nenhuma mudança de código.
// ----------------------------------------------------------------------------
export type CampoCredencial = { chave: string; label: string; obrigatorio: boolean; envVar: keyof Env };

export const CATALOGO_PROVEDORES: Record<string, { nome: string; grupo: string; campos: CampoCredencial[] }> = {
  mercado_pago: {
    nome: "Mercado Pago",
    grupo: "pagamentos",
    campos: [
      { chave: "access_token", label: "Access Token", obrigatorio: true, envVar: "MERCADO_PAGO_ACCESS_TOKEN" },
      { chave: "webhook_secret", label: "Webhook Secret", obrigatorio: true, envVar: "MERCADO_PAGO_WEBHOOK_SECRET" },
    ],
  },
  conta_azul: {
    nome: "Conta Azul",
    grupo: "pagamentos",
    campos: [
      { chave: "client_id", label: "Client ID", obrigatorio: true, envVar: "CONTA_AZUL_CLIENT_ID" },
      { chave: "client_secret", label: "Client Secret", obrigatorio: true, envVar: "CONTA_AZUL_CLIENT_SECRET" },
      { chave: "access_token", label: "Access Token", obrigatorio: true, envVar: "CONTA_AZUL_ACCESS_TOKEN" },
      { chave: "refresh_token", label: "Refresh Token", obrigatorio: true, envVar: "CONTA_AZUL_REFRESH_TOKEN" },
    ],
  },
  rd_station: {
    nome: "RD Station CRM",
    grupo: "crm",
    campos: [
      { chave: "webhook_secret", label: "Webhook Secret", obrigatorio: true, envVar: "RD_WEBHOOK_SECRET" },
      { chave: "api_access_token", label: "API Access Token", obrigatorio: true, envVar: "RD_API_ACCESS_TOKEN" },
    ],
  },
  web_push: {
    nome: "Web Push",
    grupo: "comunicacao",
    campos: [
      { chave: "vapid_public_key", label: "VAPID Public Key", obrigatorio: true, envVar: "WEB_PUSH_VAPID_PUBLIC_KEY" },
      { chave: "vapid_private_key", label: "VAPID Private Key", obrigatorio: true, envVar: "WEB_PUSH_VAPID_PRIVATE_KEY" },
      { chave: "vapid_subject", label: "Subject (mailto:)", obrigatorio: true, envVar: "WEB_PUSH_VAPID_SUBJECT" },
    ],
  },
  brb: { nome: "BRB", grupo: "bancos", campos: [{ chave: "webhook_secret", label: "Webhook Secret", obrigatorio: true, envVar: "BRB_WEBHOOK_SECRET" }] },
  bb: { nome: "Banco do Brasil", grupo: "bancos", campos: [{ chave: "webhook_secret", label: "Webhook Secret", obrigatorio: true, envVar: "BB_WEBHOOK_SECRET" }] },
  santander: { nome: "Santander", grupo: "bancos", campos: [{ chave: "webhook_secret", label: "Webhook Secret", obrigatorio: true, envVar: "SANTANDER_WEBHOOK_SECRET" }] },
  sicredi: { nome: "Sicredi", grupo: "bancos", campos: [{ chave: "webhook_secret", label: "Webhook Secret", obrigatorio: true, envVar: "SICREDI_WEBHOOK_SECRET" }] },
  efi: { nome: "Efí", grupo: "bancos", campos: [{ chave: "webhook_secret", label: "Webhook Secret", obrigatorio: true, envVar: "EFI_WEBHOOK_SECRET" }] },
};

function campoDoProvedor(provedor: string, chave: string) {
  return CATALOGO_PROVEDORES[provedor]?.campos.find((campo) => campo.chave === chave) ?? null;
}

// ----------------------------------------------------------------------------
// Criptografia simétrica (AES-GCM) com chave derivada de CLIENTE_SESSION_SECRET,
// que já é exigido para o funcionamento do login admin. Nenhum segredo novo
// precisa ser configurado no Worker para que esta camada funcione.
// ----------------------------------------------------------------------------
async function derivarChave(segredo: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(segredo));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function paraBase64(bytes: Uint8Array) {
  let binario = "";
  bytes.forEach((byte) => { binario += String.fromCharCode(byte); });
  return btoa(binario);
}

function deBase64(valor: string) {
  return Uint8Array.from(atob(valor), (caractere) => caractere.charCodeAt(0));
}

async function cifrarValor(segredo: string, valor: string) {
  const chave = await derivarChave(segredo);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, chave, new TextEncoder().encode(valor));
  return { valorCifrado: paraBase64(new Uint8Array(cifrado)), iv: paraBase64(iv) };
}

async function decifrarValor(segredo: string, valorCifrado: string, iv: string) {
  const chave = await derivarChave(segredo);
  const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deBase64(iv) }, chave, deBase64(valorCifrado));
  return new TextDecoder().decode(bytes);
}

function mascarar(valor: string) {
  const limpo = valor.trim();
  if (limpo.length <= 4) return "••••";
  return `•••• ${limpo.slice(-4)}`;
}

async function tabelaDisponivel(db: ReturnType<typeof createServiceSupabaseClient>) {
  const { error } = await db.from("integracoes_credenciais").select("id", { count: "exact", head: true });
  return !error;
}

// ----------------------------------------------------------------------------
// Leitura de credencial: usada pelos handlers de integração (Mercado Pago,
// Conta Azul, RD Station...) no lugar de `env.X` direto. Prioriza o valor
// configurado pelo painel; cai para a variável de ambiente do Worker quando
// nada foi salvo ainda, e nunca lança erro se a tabela ainda não existir.
// ----------------------------------------------------------------------------
export async function obterCredencial(env: Env, provedor: string, chave: string): Promise<string | null> {
  const campo = campoDoProvedor(provedor, chave);
  const doAmbiente = campo ? (env[campo.envVar] as string | undefined) || null : null;

  if (!env.CLIENTE_SESSION_SECRET) return doAmbiente;
  try {
    const db = createServiceSupabaseClient(env);
    const { data, error } = await db
      .from("integracoes_credenciais")
      .select("valor_cifrado,valor_iv")
      .eq("provedor", provedor)
      .eq("chave", chave)
      .eq("ativo", true)
      .maybeSingle();
    if (error || !data) return doAmbiente;
    const valor = await decifrarValor(env.CLIENTE_SESSION_SECRET, data.valor_cifrado, data.valor_iv);
    return valor || doAmbiente;
  } catch {
    return doAmbiente;
  }
}

export async function credenciaisApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/integrations/credenciais") return null;

  const admin = await requireAdmin(request, env);
  if (!admin) return json({ erro: "Sessão administrativa expirada." }, 401);
  if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);

  const db = createServiceSupabaseClient(env);

  if (request.method === "GET") {
    const disponivel = await tabelaDisponivel(db);
    const { data: linhas } = disponivel
      ? await db.from("integracoes_credenciais").select("provedor,chave,valor_mascarado,ativo,atualizado_em").eq("ativo", true)
      : { data: [] as { provedor: string; chave: string; valor_mascarado: string; ativo: boolean; atualizado_em: string }[] };
    const salvos = new Map((linhas ?? []).map((linha) => [`${linha.provedor}:${linha.chave}`, linha]));

    const provedores = Object.entries(CATALOGO_PROVEDORES).map(([id, config]) => ({
      id,
      nome: config.nome,
      grupo: config.grupo,
      campos: config.campos.map((campo: CampoCredencial) => {
        const salvo = salvos.get(`${id}:${campo.chave}`);
        const noAmbiente = Boolean(env[campo.envVar as keyof Env]);
        return {
          chave: campo.chave,
          label: campo.label,
          obrigatorio: campo.obrigatorio,
          origem: salvo ? "painel" : noAmbiente ? "variavel_de_ambiente" : "nao_configurado",
          mascara: salvo?.valor_mascarado ?? null,
          atualizadoEm: salvo?.atualizado_em ?? null,
        };
      }),
    }));

    return json({ provedores, persistenciaPronta: disponivel });
  }

  if (request.method === "POST") {
    if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Segredo de sessão do Worker não configurado." }, 500);
    const disponivel = await tabelaDisponivel(db);
    if (!disponivel) {
      return json({ erro: "A estrutura para armazenar credenciais ainda não foi aplicada neste ambiente (migration_035). Peça para aplicá-la antes de configurar por aqui." }, 409);
    }

    const body = await request.json().catch(() => ({})) as { provedor?: string; chave?: string; valor?: string; remover?: boolean };
    const provedor = String(body.provedor || "");
    const chave = String(body.chave || "");
    const campo = campoDoProvedor(provedor, chave);
    if (!campo) return json({ erro: "Provedor ou campo de credencial desconhecido." }, 400);

    if (body.remover) {
      await db.from("integracoes_credenciais").delete().eq("provedor", provedor).eq("chave", chave);
      await db.from("logs_alteracoes").insert({
        usuario: String(admin),
        acao: "removeu_credencial_integracao",
        entidade: "integracoes_credenciais",
        detalhes: { provedor, chave },
      });
      return json({ ok: true });
    }

    const valor = String(body.valor || "").trim();
    if (!valor) return json({ erro: "Informe um valor para a credencial." }, 400);
    if (valor.length > 4000) return json({ erro: "Valor de credencial excede o tamanho permitido." }, 400);

    const { valorCifrado, iv } = await cifrarValor(env.CLIENTE_SESSION_SECRET, valor);
    const { error } = await db.from("integracoes_credenciais").upsert({
      provedor,
      chave,
      valor_cifrado: valorCifrado,
      valor_iv: iv,
      valor_mascarado: mascarar(valor),
      ativo: true,
      atualizado_por: String(admin),
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "provedor,chave" });
    if (error) return json({ erro: "Não foi possível salvar a credencial." }, 500);

    await db.from("logs_alteracoes").insert({
      usuario: String(admin),
      acao: "atualizou_credencial_integracao",
      entidade: "integracoes_credenciais",
      detalhes: { provedor, chave },
    });
    return json({ ok: true });
  }

  return json({ erro: "Método não suportado." }, 405);
}
