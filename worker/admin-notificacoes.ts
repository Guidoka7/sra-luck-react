import { publicError } from "./http-security";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { getCookie, verificarTokenAdmin } from "./session";
import { enviarWebPushParaCliente, type WebPushResultado } from "./web-push-sender";
import { adicionarDiasCivil, hojeSaoPaulo, intervaloDiaOperacionalUtc } from "../src/lib/dataCivil";
import { DEV_CONSOLE_SYNTHETIC_COLABORADOR_ID } from "./dev-console-auth";
import { rotinaAutorizada } from "./frase-do-dia";
import {
  aprovarLote, cancelarLote, carregarConfigCentral, conversarSobreLote, detalharLote, editarItem, gerarMensagens,
  listarLotes, prepararLote, reprocessarFalhas, rotinaFinanceira, SEGMENTOS, validarAlteracaoConfig, type Contexto,
} from "./notificacoes-lotes";

const DEFAULT_CONFIG = { atraso_habilitado: true, frequencia_atraso_horas: 24, max_tentativas: 3 };

type Db = ReturnType<typeof createServiceSupabaseClient>;
type AcaoAutomacao = "verificar_atrasos" | "verificar_momentos_especiais" | "enviar_agora_todas" | "central_rotina";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function parse(request: Request) {
  try { return await request.json() as Record<string, any>; } catch { return {}; }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

function safeEqual(a: string, b: string) {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

function cronAuthorized(request: Request, env: Env) {
  const configured = env.NOTIFICACOES_CRON_SECRET?.trim();
  const provided = request.headers.get("x-notificacoes-cron-secret")?.trim();
  return Boolean(configured && provided && safeEqual(configured, provided));
}

async function adminId(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const session = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  return session?.adminId ?? null;
}

function renderTemplate(text: string, vars: Record<string, string | number>) {
  return Object.entries(vars).reduce((result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)), text);
}

function formatarData(dataISO: string) {
  const [ano, mes, dia] = String(dataISO).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : dataISO;
}

function formatarMoeda(valor: unknown) {
  const numero = Number(valor ?? 0);
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function diferencaDias(dataISO: string, hojeISO: string) {
  const [y, m, d] = dataISO.split("-").map(Number);
  const [hy, hm, hd] = hojeISO.split("-").map(Number);
  if (![y, m, d, hy, hm, hd].every(Number.isFinite)) return null;
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(hy, hm - 1, hd)) / 86_400_000);
}

function clienteDoBoleto(boleto: any) {
  return Array.isArray(boleto?.clientes) ? boleto.clientes[0] : boleto?.clientes;
}

export function boletoPodeReceberCobrancaAutomatica(boleto: any) {
  const cliente = clienteDoBoleto(boleto);
  const statusContrato = String(cliente?.status_contrato ?? "ativo");
  return Boolean(
    boleto?.cliente_id
    && boleto?.status === "nao_pago"
    && boleto?.suspensa !== true
    && cliente
    && cliente.ativo !== false
    && !["cancelado", "suspenso"].includes(statusContrato)
  );
}

export function agruparBoletosNotificaveis(boletos: any[]) {
  const grupos = new Map<string, any[]>();
  for (const boleto of boletos.filter(boletoPodeReceberCobrancaAutomatica)) {
    const atual = grupos.get(String(boleto.cliente_id)) ?? [];
    atual.push(boleto);
    grupos.set(String(boleto.cliente_id), atual);
  }
  return [...grupos.entries()].map(([clienteId, itens]) => ({
    clienteId,
    cliente: clienteDoBoleto(itens[0]),
    boletos: itens.sort((a, b) => String(a.data_vencimento).localeCompare(String(b.data_vencimento))),
  }));
}

function escolherTemplateAtraso(templates: any[], diasAtraso: number) {
  const referencias = [...new Set(templates.map((t) => Number(t.dias_referencia)).filter((d) => Number.isFinite(d) && d <= diasAtraso))].sort((a, b) => b - a);
  const alvo = referencias[0];
  return alvo === undefined ? null : templates.find((t) => Number(t.dias_referencia) === alvo) ?? null;
}

function listarParcelas(itens: any[], hoje: string, atraso: boolean) {
  const exibidas = itens.slice(0, 4).map((b) => {
    const numero = `${b.numero_parcela ?? "—"}/${b.total_parcelas ?? "—"}`;
    const data = formatarData(String(b.data_vencimento));
    if (!atraso) return `${numero} · ${data}`;
    const diff = diferencaDias(String(b.data_vencimento), hoje);
    const dias = diff == null ? 0 : Math.max(0, -diff);
    return `${numero} · ${dias}d`;
  });
  if (itens.length > 4) exibidas.push(`+ ${itens.length - 4} outra(s)`);
  return exibidas.join(", ");
}

function mensagemAgrupadaVencimento(nome: string, itens: any[], hoje: string) {
  const total = itens.reduce((s, b) => s + Number(b.valor ?? 0), 0);
  return `Olá, ${nome}! Você tem ${itens.length} parcelas com vencimento próximo: ${listarParcelas(itens, hoje, false)}. Valor base total: ${formatarMoeda(total)}. Programe-se para manter seu contrato em dia. 💛`;
}

function mensagemAgrupadaAtraso(nome: string, itens: any[], hoje: string) {
  const total = itens.reduce((s, b) => s + Number(b.valor ?? 0), 0);
  const atrasos = itens.map((b) => {
    const diff = diferencaDias(String(b.data_vencimento), hoje);
    return diff == null ? 0 : Math.max(0, -diff);
  });
  const maior = Math.max(0, ...atrasos);
  return `Olá, ${nome}. Identificamos ${itens.length} parcelas em atraso: ${listarParcelas(itens, hoje, true)}. A mais antiga está há ${maior} dias em atraso. Valor base total: ${formatarMoeda(total)}. Se já regularizou alguma delas, desconsidere o item correspondente. Estamos à disposição para ajudar.`;
}

export function classificarStatusPush(push: WebPushResultado) {
  if (!push.configurado) return "nao_configurado";
  if (push.enviadas > 0 && push.falhas > 0) return "parcial";
  if (push.enviadas > 0) return "enviada";
  if (push.falhas > 0) return "falhou";
  return "sem_dispositivo";
}

function acumularPush(total: WebPushResultado, atual: WebPushResultado) {
  total.configurado = total.configurado || atual.configurado;
  total.assinaturas += atual.assinaturas;
  total.enviadas += atual.enviadas;
  total.falhas += atual.falhas;
  total.removidas += atual.removidas;
  total.erros.push(...atual.erros.slice(0, Math.max(0, 20 - total.erros.length)));
}

function novoResumoPush(): WebPushResultado {
  return { configurado: false, assinaturas: 0, enviadas: 0, falhas: 0, removidas: 0, erros: [] };
}

async function carregarConfig(db: Db) {
  const { data } = await db.from("notificacoes_config").select("chave,valor,tipo");
  const config: Record<string, any> = { ...DEFAULT_CONFIG };
  for (const item of data ?? []) {
    if (item.tipo === "boolean") config[item.chave] = item.valor === "true";
    else if (item.tipo === "number") config[item.chave] = Number(item.valor);
    else config[item.chave] = item.valor;
  }
  return config as typeof DEFAULT_CONFIG;
}

export async function registrarNotificacao(env: Env, db: Db, input: {
  clienteId: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  emoji?: string;
  destino?: string;
  referenciaId?: string | null;
  url?: string;
  tag?: string;
  action?: string | null;
}) {
  const { data: notificacao, error } = await db.from("notificacoes_cliente").insert({
    cliente_id: input.clienteId,
    tipo: input.tipo,
    titulo: input.titulo,
    mensagem: input.mensagem,
    emoji: input.emoji ?? "🔔",
    destino: input.destino ?? "agenda",
    referencia_id: input.referenciaId ?? null,
  }).select("id,cliente_id,tipo,titulo,mensagem,emoji,destino,referencia_id,created_at").single();
  if (error || !notificacao) throw new Error(error?.message || "Falha ao registrar notificação.");

  const { error: logError } = await db.from("notificacao_logs").insert({
    cliente_id: input.clienteId,
    notificacao_id: notificacao.id,
    referencia_id: input.referenciaId ?? null,
    tipo: input.tipo,
    titulo: input.titulo,
    corpo: input.mensagem,
    status: "enviada",
    push_enviadas: 0,
    push_falhas: 0,
    push_status: "pendente",
  });
  if (logError) console.error("Falha ao registrar log da notificação:", logError.message);

  try {
    await db.channel(`notificacoes-cliente:${input.clienteId}`).send({
      type: "broadcast",
      event: "nova_notificacao",
      payload: notificacao,
    });
  } catch (error) {
    console.warn("Realtime da notificação indisponível:", error);
  }

  let push: WebPushResultado;
  try {
    push = await enviarWebPushParaCliente(env, db, input.clienteId, {
      title: input.titulo,
      body: input.mensagem,
      url: input.url ?? "/agenda",
      tag: input.tag ?? `notificacao-${notificacao.id}`,
      notificationId: notificacao.id,
      installmentId: input.referenciaId ?? null,
      action: input.action ?? null,
      destino: input.destino ?? "agenda",
    });
  } catch (error) {
    push = {
      configurado: true,
      assinaturas: 0,
      enviadas: 0,
      falhas: 1,
      removidas: 0,
      erros: [publicError(error, "Falha ao enviar Web Push.")],
    };
  }

  const pushStatus = classificarStatusPush(push);
  const erroPush = push.erros.length ? push.erros.join(" | ").slice(0, 1000) : null;
  const { error: updateLogError } = await db.from("notificacao_logs").update({
    push_enviadas: push.enviadas,
    push_falhas: push.falhas,
    push_status: pushStatus,
    erro_mensagem: erroPush,
  }).eq("notificacao_id", notificacao.id);
  if (updateLogError) console.error("Falha ao atualizar resultado do Web Push:", updateLogError.message);

  return { notificacao, push, pushStatus };
}

async function executarVencimentos(env: Env, db: Db) {
  const hoje = hojeSaoPaulo();
  const limite = adicionarDiasCivil(hoje, 2);
  const { inicio: inicioHoje, fimExclusivo: fimHoje } = intervaloDiaOperacionalUtc(hoje);
  const [{ data: templates, error: templatesError }, { data: boletos, error: boletosError }] = await Promise.all([
    db.from("notificacao_templates")
      .select("id,dias_referencia,titulo,corpo,emoji,updated_at")
      .eq("tipo", "parcela_vencer").eq("is_active", true)
      .order("dias_referencia", { ascending: true }).order("updated_at", { ascending: false }),
    db.from("boletos")
      .select("id,cliente_id,numero_parcela,total_parcelas,valor,status,suspensa,data_vencimento,clientes(nome_completo,status_contrato,ativo)")
      .gte("data_vencimento", hoje).lte("data_vencimento", limite).eq("status", "nao_pago"),
  ]);
  if (templatesError) throw new Error(templatesError.message);
  if (boletosError) throw new Error(boletosError.message);

  let enviadas = 0, ignoradas = 0, falhas = 0, parcelasIncluidas = 0;
  const porDiasParaVencer: Record<string, number> = {};
  const push = novoResumoPush();

  for (const grupo of agruparBoletosNotificaveis((boletos ?? []) as any[])) {
    const principal = grupo.boletos[0];
    const diasParaVencer = diferencaDias(String(principal.data_vencimento), hoje);
    if (diasParaVencer == null) continue;
    const template = (templates ?? []).find((t: any) => Number(t.dias_referencia) === diasParaVencer);
    if (!template) continue;

    const { data: recent, error: recentError } = await db.from("notificacao_logs").select("id")
      .eq("cliente_id", grupo.clienteId).eq("tipo", "parcela_vencer")
      .gte("created_at", inicioHoje).lt("created_at", fimHoje).limit(1);
    if (recentError) throw new Error(recentError.message);
    if (recent?.length) { ignoradas++; continue; }

    const nome = grupo.cliente?.nome_completo ?? "cliente";
    const vars = {
      cliente: nome,
      parcela: principal.numero_parcela ?? "—",
      total: principal.total_parcelas ?? "—",
      vencimento: formatarData(String(principal.data_vencimento)),
      valor: formatarMoeda(principal.valor),
    };
    const titulo = renderTemplate(String(template.titulo), vars);
    const mensagem = grupo.boletos.length > 1
      ? mensagemAgrupadaVencimento(nome, grupo.boletos, hoje)
      : renderTemplate(String(template.corpo), vars);
    try {
      const unica = grupo.boletos.length === 1;
      const resultado = await registrarNotificacao(env, db, {
        clienteId: grupo.clienteId,
        tipo: "parcela_vencer",
        titulo,
        mensagem,
        emoji: template.emoji ?? "💳",
        destino: "pagamentos",
        referenciaId: unica ? principal.id : null,
        url: unica ? `/agenda?abrirComprovante=${encodeURIComponent(principal.id)}` : "/agenda?destino=pagamentos",
        tag: `parcelas-vencer-${grupo.clienteId}-${hoje}`,
        action: unica ? "upload_receipt" : null,
      });
      acumularPush(push, resultado.push);
      enviadas++;
      parcelasIncluidas += grupo.boletos.length;
      porDiasParaVencer[String(diasParaVencer)] = (porDiasParaVencer[String(diasParaVencer)] ?? 0) + 1;
    } catch (error) {
      falhas++;
      console.error("Falha ao registrar lembrete de vencimento:", error);
    }
  }
  return { executado: true, enviadas, clientesNotificadas: enviadas, parcelasIncluidas, ignoradas, falhas, porDiasParaVencer, push, data: hoje };
}

async function executarAtrasos(env: Env, db: Db, forcar = false) {
  const config = await carregarConfig(db);
  if (!config.atraso_habilitado && !forcar) {
    return { executado: true, habilitado: false, enviadas: 0, clientesNotificadas: 0, parcelasIncluidas: 0, ignoradas: 0, falhas: 0, porDiasAtraso: {}, push: novoResumoPush() };
  }

  const frequenciaHoras = Math.max(1, Number(config.frequencia_atraso_horas || 24));
  const cutoff = new Date(Date.now() - frequenciaHoras * 60 * 60 * 1000).toISOString();
  const hoje = hojeSaoPaulo();
  const [{ data: templates, error: templatesError }, { data: boletos, error: boletosError }] = await Promise.all([
    db.from("notificacao_templates")
      .select("id,dias_referencia,titulo,corpo,emoji,updated_at")
      .eq("tipo", "parcela_atrasada").eq("is_active", true)
      .order("dias_referencia", { ascending: true }).order("updated_at", { ascending: false }),
    db.from("boletos")
      .select("id,cliente_id,numero_parcela,total_parcelas,valor,status,suspensa,data_vencimento,clientes(nome_completo,status_contrato,ativo)")
      .lt("data_vencimento", hoje).eq("status", "nao_pago"),
  ]);
  if (templatesError) throw new Error(templatesError.message);
  if (boletosError) throw new Error(boletosError.message);

  let enviadas = 0, ignoradas = 0, falhas = 0, parcelasIncluidas = 0;
  const porDiasAtraso: Record<string, number> = {};
  const push = novoResumoPush();

  for (const grupo of agruparBoletosNotificaveis((boletos ?? []) as any[])) {
    const principal = grupo.boletos[0];
    const diff = diferencaDias(String(principal.data_vencimento), hoje);
    const diasAtraso = diff == null ? 0 : Math.max(0, -diff);
    const template = escolherTemplateAtraso((templates ?? []) as any[], diasAtraso);
    if (!template) continue;

    if (!forcar) {
      const { data: recent, error: recentError } = await db.from("notificacao_logs").select("id")
        .eq("cliente_id", grupo.clienteId).eq("tipo", "parcela_atrasada")
        .gte("created_at", cutoff).limit(1);
      if (recentError) throw new Error(recentError.message);
      if (recent?.length) { ignoradas++; continue; }
    }

    const nome = grupo.cliente?.nome_completo ?? "cliente";
    const vars = {
      cliente: nome,
      parcela: principal.numero_parcela ?? "—",
      total: principal.total_parcelas ?? "—",
      vencimento: formatarData(String(principal.data_vencimento)),
      valor: formatarMoeda(principal.valor),
      dias_atraso: diasAtraso,
    };
    const titulo = renderTemplate(String(template.titulo), vars);
    const mensagem = grupo.boletos.length > 1
      ? mensagemAgrupadaAtraso(nome, grupo.boletos, hoje)
      : renderTemplate(String(template.corpo), vars);
    try {
      const unica = grupo.boletos.length === 1;
      const resultado = await registrarNotificacao(env, db, {
        clienteId: grupo.clienteId,
        tipo: "parcela_atrasada",
        titulo,
        mensagem,
        emoji: template.emoji ?? "💳",
        destino: "pagamentos",
        referenciaId: unica ? principal.id : null,
        url: unica ? `/agenda?abrirComprovante=${encodeURIComponent(principal.id)}` : "/agenda?destino=pagamentos",
        tag: `parcelas-atrasadas-${grupo.clienteId}`,
        action: unica ? "upload_receipt" : null,
      });
      acumularPush(push, resultado.push);
      enviadas++;
      parcelasIncluidas += grupo.boletos.length;
      porDiasAtraso[String(diasAtraso)] = (porDiasAtraso[String(diasAtraso)] ?? 0) + 1;
    } catch (error) {
      falhas++;
      console.error("Falha ao registrar notificação de atraso:", error);
    }
  }

  return { executado: true, habilitado: true, enviadas, clientesNotificadas: enviadas, parcelasIncluidas, ignoradas, falhas, frequencia_horas: frequenciaHoras, forcaram_envio: forcar, porDiasAtraso, push };
}

function contextoCentral(env: Env, db: Db, ator: string): Contexto {
  return { env, db, ator, enviar: registrarNotificacao, reenviarPush: enviarWebPushParaCliente };
}

export async function executarAutomacaoNotificacoes(env: Env, acao: AcaoAutomacao) {
  const db = createServiceSupabaseClient(env);
  if (acao === "central_rotina") return rotinaFinanceira(contextoCentral(env, db, "sistema:rotina"));
  // Com a Central de lotes ligada, a rotina automática direta não envia (evita cobrança dupla).
  if ((await carregarConfigCentral(db)).ativa) {
    return { executado: false, ignorado: "central_de_lotes_ativa", mensagem: "A Central de Notificações (lotes com aprovação) está ligada; a rotina automática direta não envia." };
  }
  if (acao === "verificar_momentos_especiais") return executarVencimentos(env, db);
  return executarAtrasos(env, db, acao === "enviar_agora_todas");
}

export async function adminNotificacoes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (path === "/api/internal/notificacoes/automacao") {
    if (request.method !== "POST") return json({ erro: "Método não suportado." }, 405);
    if (!cronAuthorized(request, env)) return json({ erro: "Cron não autorizado." }, 401);
    const body = await parse(request);
    const acao = String(body.acao || "") as AcaoAutomacao;
    if (!["verificar_atrasos", "verificar_momentos_especiais", "enviar_agora_todas", "central_rotina"].includes(acao)) return json({ erro: "Ação inválida." }, 400);
    try { return json(await executarAutomacaoNotificacoes(env, acao)); }
    catch (error) { console.error("Falha na automação de notificações:", error); return json({ erro: "Falha ao executar automação." }, 500); }
  }

  // Vercel Cron: rotina diária da Central (libera a fila e prepara o lote do dia; não aprova sozinha por padrão).
  if (path === "/api/cron/notificacoes-financeiras") {
    if (request.method !== "GET") return json({ erro: "Método não suportado." }, 405);
    if (!rotinaAutorizada(request, env)) return json({ erro: "Rotina não autorizada." }, 401);
    try { return json(await executarAutomacaoNotificacoes(env, "central_rotina")); }
    catch (error) { console.error("Falha na rotina da Central de Notificações:", error); return json({ erro: "Falha ao executar a rotina." }, 500); }
  }

  if (path.match(/^\/api\/admin\/boletos\/[^/]+\/comprovante$/) && request.method === "GET") {
    const admin = await adminId(request, env); if (!admin) return json({ erro: "Sessão administrativa expirada." }, 401);
    const colaborador = await buscarColaboradorAdminAtivo(admin, env).catch(() => null);
    if (!colaborador || (!temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.FINANCEIRO_VALIDAR_COMPROVANTE) && !temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL))) {
      return json({ erro: "Seu papel não tem permissão para visualizar comprovantes financeiros." }, 403);
    }
    const match = path.match(/^\/api\/admin\/boletos\/([^/]+)\/comprovante$/); const id = decodeURIComponent(match![1]);
    const db = createServiceSupabaseClient(env);
    const { data: boleto, error: boletoError } = await db.from("boletos").select("comprovante_url").eq("id", id).maybeSingle();
    if (boletoError) return json({ erro: "Não foi possível localizar o comprovante." }, 500);
    if (!boleto?.comprovante_url) return json({ erro: "Comprovante não encontrado." }, 404);
    const { data, error } = await db.storage.from("boletos-clientes").createSignedUrl(boleto.comprovante_url, 300);
    if (error || !data?.signedUrl) return json({ erro: "Não foi possível gerar o link do comprovante." }, 500);
    return Response.redirect(data.signedUrl, 302);
  }

  if (!path.startsWith("/api/admin/notificacoes")) return null;
  const admin = await adminId(request, env);
  if (!admin) return json({ erro: "Sessão administrativa expirada." }, 401);
  const mutating = ["POST", "PATCH", "DELETE"].includes(request.method);
  if (mutating && !sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  let atorNotificacoes: string | null = null;
  if (mutating) {
    const colaborador = await buscarColaboradorAdminAtivo(admin, env).catch(() => null);
    if (!colaborador || !temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.NOTIFICACOES_GERENCIAR)) {
      return json({ erro: "Seu papel não tem permissão para gerenciar notificações." }, 403);
    }
    // Ações vindas do Dev Console ficam com o operador técnico (dev-console:<id>) na auditoria.
    atorNotificacoes = colaborador.id === DEV_CONSOLE_SYNTHETIC_COLABORADOR_ID ? colaborador.auth_user_id : colaborador.id;
  }
  const db = createServiceSupabaseClient(env);

  if (path === "/api/admin/notificacoes/lotes" || path.startsWith("/api/admin/notificacoes/lotes/")) {
    return lotesApi(request, env, db, path, atorNotificacoes ?? `admin:${admin}`);
  }

  if (path === "/api/admin/notificacoes/automacao") {
    if (request.method === "GET") {
      const [cfg, templates, logs, clientes, atrasadas, aVencer, subscriptions] = await Promise.all([
        db.from("notificacoes_config").select("chave,valor,tipo"),
        db.from("notificacao_templates").select("id,tipo,dias_referencia,titulo,corpo,emoji,is_active,updated_at").order("tipo").order("dias_referencia"),
        db.from("notificacao_logs").select("id,cliente_id,tipo,titulo,corpo,status,erro_mensagem,push_enviadas,push_falhas,push_status,created_at,clientes(nome_completo)").order("created_at", { ascending: false }).limit(200),
        db.from("clientes").select("id,nome_completo,telefone,ativo").eq("ativo", true).order("nome_completo"),
        db.from("boletos").select("id", { count: "exact", head: true }).lt("data_vencimento", hojeSaoPaulo()).eq("status", "nao_pago"),
        db.from("boletos").select("id", { count: "exact", head: true }).gte("data_vencimento", hojeSaoPaulo()).lte("data_vencimento", adicionarDiasCivil(hojeSaoPaulo(), 2)).eq("status", "nao_pago"),
        db.from("web_push_subscriptions").select("id", { count: "exact", head: true }),
      ]);
      if (cfg.error || templates.error || logs.error || clientes.error || atrasadas.error || aVencer.error || subscriptions.error) return json({ erro: "Não foi possível carregar o painel de notificações." }, 500);
      const raw = Object.fromEntries((cfg.data ?? []).map((x: any) => [x.chave, x.valor]));
      return json({
        config: { atraso_habilitado: raw.atraso_habilitado !== "false", frequencia_atraso_horas: Number(raw.frequencia_atraso_horas ?? 24), max_tentativas: Number(raw.max_tentativas ?? 3) },
        templates: templates.data ?? [], logs: logs.data ?? [], clientes: clientes.data ?? [], atrasadas: atrasadas.count ?? 0, aVencer: aVencer.count ?? 0,
        pushSubscriptions: subscriptions.count ?? 0,
      });
    }

    if (request.method === "PATCH") {
      const b = await parse(request);
      const values = {
        atraso_habilitado: b.atraso_habilitado !== undefined ? Boolean(b.atraso_habilitado) : undefined,
        frequencia_atraso_horas: b.frequencia_atraso_horas !== undefined ? Math.max(1, Number(b.frequencia_atraso_horas) || 24) : undefined,
        max_tentativas: b.max_tentativas !== undefined ? Math.max(1, Number(b.max_tentativas) || 3) : undefined,
      };
      let alterou = false;
      for (const [chave, valor] of Object.entries(values)) {
        if (valor === undefined) continue;
        alterou = true;
        const { error } = await db.from("notificacoes_config").upsert({ chave, valor: String(valor), tipo: typeof valor === "boolean" ? "boolean" : "number" }, { onConflict: "chave" });
        if (error) return json({ erro: publicError(error) }, 400);
      }
      if (!alterou) return json({ erro: "Configuração inválida." }, 400);
      return json({ config: await carregarConfig(db), mensagem: "Configurações salvas." });
    }

    if (request.method === "POST") {
      const b = await parse(request);
      const acao = String(b.acao || "") as AcaoAutomacao;
      if (!["verificar_atrasos", "verificar_momentos_especiais", "enviar_agora_todas"].includes(acao)) return json({ erro: "Ação inválida." }, 400);
      try { return json(await executarAutomacaoNotificacoes(env, acao)); }
      catch (error) { return json({ erro: publicError(error, "Falha ao executar automação.") }, 500); }
    }
  }

  if (path === "/api/admin/notificacoes/templates" && request.method === "PATCH") {
    const b = await parse(request); if (!b.id) return json({ erro: "Template não informado." }, 400);
    const patch: Record<string, unknown> = {}; for (const k of ["titulo", "corpo", "emoji", "is_active"]) if (b[k] !== undefined) patch[k] = b[k];
    const { data, error } = await db.from("notificacao_templates").update(patch).eq("id", b.id).select("*").single();
    if (error) return json({ erro: publicError(error) }, 400);
    return json({ template: data, mensagem: "Template atualizado." });
  }

  if (path === "/api/admin/notificacoes/templates" && request.method === "POST") {
    const b = await parse(request);
    const tipo = String(b.tipo ?? "").trim(), titulo = String(b.titulo ?? "").trim(), corpo = String(b.corpo ?? "").trim();
    if (!tipo || !titulo || !corpo) return json({ erro: "Tipo, título e corpo são obrigatórios." }, 400);
    const { data, error } = await db.from("notificacao_templates").insert({ tipo, dias_referencia: b.diasReferencia != null ? Number(b.diasReferencia) : null, titulo, corpo, emoji: b.emoji ?? "💬", is_active: b.isActive !== false }).select("*").single();
    if (error) return json({ erro: publicError(error) }, 400);
    return json({ template: data, mensagem: "Template criado." }, 201);
  }

  if (path === "/api/admin/notificacoes/enviar" && request.method === "POST") {
    const b = await parse(request);
    const clienteId = String(b.clienteId || ""), titulo = String(b.titulo || "").trim(), mensagem = String(b.mensagem || "").trim();
    if (!clienteId || !titulo || !mensagem) return json({ erro: "Cliente, título e mensagem são obrigatórios." }, 400);
    const { data: cliente, error: ce } = await db.from("clientes").select("id,nome_completo").eq("id", clienteId).maybeSingle();
    if (ce || !cliente) return json({ erro: "Cliente não encontrada." }, 404);
    try {
      const resultado = await registrarNotificacao(env, db, { clienteId, tipo: "manual", titulo: titulo.slice(0, 200), mensagem: mensagem.slice(0, 5000), emoji: "📬", destino: "agenda", url: "/agenda" });
      await db.from("logs_alteracoes").insert({
        usuario: atorNotificacoes ?? `admin:${admin}`,
        acao: "enviou_notificacao_manual",
        entidade: "notificacoes_cliente",
        entidade_id: resultado.notificacao.id,
        detalhes: { cliente_id: cliente.id, pushStatus: resultado.pushStatus, pushEnviadas: resultado.push.enviadas },
      });
      return json({ notificacao: resultado.notificacao, cliente: { id: cliente.id, nome: cliente.nome_completo }, push: resultado.push, pushStatus: resultado.pushStatus, mensagem: "Notificação registrada e Web Push processado." });
    } catch (error) {
      return json({ erro: publicError(error, "Não foi possível enviar a notificação.") }, 500);
    }
  }

  return null;
}

function respostaLote(resultado: { ok: boolean; status?: number | string } & Record<string, unknown>, sucesso = 200) {
  if (!resultado.ok) return json({ erro: resultado.erro, codigo: resultado.codigo }, Number(resultado.status) || 400);
  return json(resultado, sucesso);
}

/** Rotas da Central de Notificações (lotes). O gate de sessão e de permissão já rodou em adminNotificacoes. */
async function lotesApi(request: Request, env: Env, db: Db, path: string, ator: string): Promise<Response> {
  const ctx = contextoCentral(env, db, ator);
  const url = new URL(request.url);

  if (path === "/api/admin/notificacoes/lotes" && request.method === "GET") {
    const lotes = await listarLotes(db, Number(url.searchParams.get("limite")) || 20);
    if (!lotes) return json({ erro: "A estrutura de lotes ainda não foi aplicada neste ambiente (migration_088).", codigo: "migration_088" }, 409);
    return json({ lotes, config: await carregarConfigCentral(db), segmentos: SEGMENTOS });
  }
  if (path === "/api/admin/notificacoes/lotes/config") {
    if (request.method === "GET") return json({ config: await carregarConfigCentral(db), segmentos: SEGMENTOS });
    if (request.method !== "POST") return json({ erro: "Método não suportado." }, 405);
    const validacao = validarAlteracaoConfig(await parse(request));
    if (!validacao.ok) return json({ erro: validacao.erro }, 400);
    const antes = await carregarConfigCentral(db);
    for (const linha of validacao.linhas) {
      const { error } = await db.from("notificacoes_config").upsert(linha, { onConflict: "chave" });
      if (error) return json({ erro: publicError(error) }, 400);
    }
    const depois = await carregarConfigCentral(db);
    await db.from("logs_alteracoes").insert({ usuario: ator, acao: "alterou_config_central_notificacoes", entidade: "notificacoes_config", detalhes: { antes, depois } });
    return json({ config: depois, mensagem: "Configuração salva." });
  }
  if (path === "/api/admin/notificacoes/lotes/auditoria" && request.method === "GET") {
    const { data, error } = await db.from("logs_alteracoes").select("usuario,acao,entidade,detalhes,created_at")
      .in("entidade", ["notificacao_lotes", "notificacoes_config"]).order("created_at", { ascending: false }).limit(100);
    if (error) return json({ erro: "Não foi possível ler a auditoria agora." }, 500);
    return json({ eventos: data ?? [] });
  }
  if (path === "/api/admin/notificacoes/lotes/preparar" && request.method === "POST") {
    return respostaLote(await prepararLote(ctx, "manual"), 201);
  }

  const m = path.match(/^\/api\/admin\/notificacoes\/lotes\/([0-9a-f-]{36})(?:\/(gerar|aprovar|cancelar|reprocessar-falhas|chat|itens\/([0-9a-f-]{36})\/editar))?$/);
  if (!m) return json({ erro: "Rota não encontrada." }, 404);
  const [, loteId, acao, itemId] = m;
  if (!acao) {
    if (request.method !== "GET") return json({ erro: "Método não suportado." }, 405);
    const detalhe = await detalharLote(db, loteId);
    return detalhe ? json(detalhe) : json({ erro: "Lote não encontrado." }, 404);
  }
  if (request.method !== "POST") return json({ erro: "Método não suportado." }, 405);
  const body = await parse(request);
  try {
    if (acao === "gerar") return respostaLote(await gerarMensagens(ctx, loteId, { instrucao: body.instrucao, segmento: body.segmento }));
    if (acao === "aprovar") return respostaLote(await aprovarLote(ctx, loteId));
    if (acao === "cancelar") return respostaLote(await cancelarLote(ctx, loteId));
    if (acao === "reprocessar-falhas") return respostaLote(await reprocessarFalhas(ctx, loteId));
    if (acao === "chat") return respostaLote(await conversarSobreLote(ctx, loteId, body.mensagem, body.historico));
    return respostaLote(await editarItem(ctx, loteId, itemId, body.mensagem));
  } catch (error) {
    return json({ erro: publicError(error, "Falha ao processar o lote.") }, 500);
  }
}
