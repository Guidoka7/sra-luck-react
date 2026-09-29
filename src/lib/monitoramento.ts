type NivelLog = "info" | "warn" | "error" | "fatal";

type EventoErro = {
  mensagem: string;
  stack?: string;
  componente?: string;
  codigo?: string;
  nivel?: NivelLog;
  origem?: "frontend" | "api" | "diagnostico";
  status_http?: number;
  metodo?: string;
  request_id?: string;
  action?: string;
  detalhes?: Record<string, unknown>;
};

/**
 * Falhas que não são defeito do sistema e não entram na Central de Problemas (nível "info"):
 * aparelho sem internet, app em segundo plano durante a chamada e os primeiros segundos após
 * voltar dele (o iOS corta as conexões ao suspender o app). Continuam registradas como info.
 */
let ocultoEm = 0;
let visivelEm = 0;
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") ocultoEm = Date.now();
    else visivelEm = Date.now();
  });
}

export function motivoFalhaDoAparelho(inicio: number): string | null {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "sem_internet";
  if (typeof document === "undefined") return null;
  if (document.visibilityState === "hidden") return "app_em_segundo_plano";
  if (ocultoEm >= inicio) return "app_foi_para_segundo_plano_durante_a_chamada";
  if (visivelEm && Date.now() - visivelEm < 5000) return "retorno_do_segundo_plano";
  return null;
}

/** Chamada cancelada pelo próprio app (troca de tela, fechar gaveta): não é falha. */
export function ehCancelamento(error: unknown) {
  return error instanceof DOMException ? error.name === "AbortError" : (error as { name?: string } | null)?.name === "AbortError";
}

/** Respostas que fazem parte do fluxo normal (credencial errada, trava de importação em andamento). */
const RESPOSTAS_ESPERADAS: { url: RegExp; status: number[] }[] = [
  { url: /\/api\/(cliente|admin|equipe)\/auth$/, status: [401, 429] },
  { url: /\/api\/admin\/integrations\/rd-station\/importar$/, status: [409] },
];

export function respostaEsperada(url: string, status: number) {
  const caminho = url.split("?")[0];
  return RESPOSTAS_ESPERADAS.some((r) => r.url.test(caminho) && r.status.includes(status));
}

let ultimo = "";
let ultimoEm = 0;
let instalado = false;
let fetchOriginal: typeof window.fetch | null = null;
const ENDPOINT = "/api/monitoramento/erro";
const QUEUE_KEY = "sra_luck_monitoramento_pendente";
const SENSITIVE_KEY = /(cpf|senha|password|authorization|cookie|session|token|secret|api[_-]?key|service[_-]?role|data[_-]?nascimento|birth|email|telefone|phone|whatsapp|endereco|address|pix|card|cvv|p256dh|endpoint|auth|payload)/i;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const PHONE_RE = /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\s*)?\d{4}[-\s]?\d{4}/g;

function requestId() {
  try { return crypto.randomUUID(); } catch { return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
}

function sanitizarString(value: string) {
  return value
    .replace(BEARER_RE, "[SECRET_REDACTED]")
    .replace(JWT_RE, "[SECRET_REDACTED]")
    .replace(EMAIL_RE, "[PII_REDACTED]")
    .replace(CPF_RE, "[PII_REDACTED]")
    .replace(PHONE_RE, "[PII_REDACTED]")
    .slice(0, 3000);
}

function sanitizar(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return sanitizarString(value);
  if (value instanceof Error) return { name: value.name, mensagem: sanitizarString(value.message), stack: value.stack ? sanitizarString(value.stack) : undefined };
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizar(item, depth + 1));
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 60);
    return Object.fromEntries(entries.map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizar(item, depth + 1)]));
  }
  return sanitizarString(String(value));
}

function normalizarErro(value: unknown) {
  if (value instanceof Error) return { mensagem: sanitizarString(value.message || "Erro desconhecido"), stack: value.stack ? sanitizarString(value.stack) : undefined };
  if (typeof value === "string") return { mensagem: sanitizarString(value) };
  try { return { mensagem: sanitizarString(JSON.stringify(sanitizar(value)) || "Erro desconhecido") }; } catch { return { mensagem: "Erro desconhecido" }; }
}

function enfileirar(payload: string) {
  try {
    const fila = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    const atualizada = [...fila.slice(-19), JSON.parse(payload)];
    localStorage.setItem(QUEUE_KEY, JSON.stringify(atualizada));
  } catch { /* monitoramento nunca interrompe a aplicação */ }
}

async function enviar(payload: string) {
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }))) return true;
  } catch { /* fallback abaixo */ }
  if (!fetchOriginal) return false;
  try {
    const response = await fetchOriginal(ENDPOINT, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true });
    return response.ok;
  } catch { return false; }
}

async function reenviarFila() {
  if (typeof window === "undefined") return;
  try {
    const fila = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]") as unknown[];
    if (!fila.length) return;
    const restantes: unknown[] = [];
    for (const item of fila.slice(-20)) {
      const ok = await enviar(JSON.stringify(sanitizar(item)));
      if (!ok) restantes.push(item);
    }
    if (restantes.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(restantes));
    else localStorage.removeItem(QUEUE_KEY);
  } catch { /* manter a fila para a próxima oportunidade */ }
}

export function registrarErro(evento: EventoErro) {
  if (typeof window === "undefined") return;
  const mensagem = sanitizarString(evento.mensagem?.trim() || "").slice(0, 1200);
  if (!mensagem) return;
  const agora = Date.now();
  const assinatura = `${evento.origem || "frontend"}|${evento.codigo || ""}|${evento.metodo || ""}|${evento.status_http || ""}|${window.location.pathname}|${mensagem}`;
  if (assinatura === ultimo && agora - ultimoEm < 5000) return;
  ultimo = assinatura;
  ultimoEm = agora;
  const payload = JSON.stringify(sanitizar({
    ...evento,
    mensagem,
    stack: evento.stack ? sanitizarString(evento.stack) : undefined,
    origem: evento.origem || "frontend",
    nivel: evento.nivel || "error",
    request_id: evento.request_id || requestId(),
    rota: window.location.pathname,
    ambiente: import.meta.env.MODE,
    detalhes: evento.detalhes || {},
  }));
  void enviar(payload).then((ok) => { if (!ok) enfileirar(payload); });
}

const ACESSO_ENDPOINT = "/api/monitoramento/acesso";
const DEVICE_KEY = "sra-luck-device-key";
const SESSAO_KEY = "sra_luck_sessao_navegacao";
let ultimoAcesso = "";
let ultimoAcessoEm = 0;

function idSessaoNavegacao() {
  try {
    let id = sessionStorage.getItem(SESSAO_KEY);
    if (!id) { id = requestId(); sessionStorage.setItem(SESSAO_KEY, id); }
    return id;
  } catch { return null; }
}

/**
 * Registra a tela aberta (histórico de acesso da cliente ou do colaborador).
 * O backend identifica quem é pela sessão; sem sessão o evento é ignorado.
 */
export function registrarAcesso(tela: string) {
  if (typeof window === "undefined" || !tela) return;
  const agora = Date.now();
  const chave = `${window.location.pathname}|${tela}`;
  if (chave === ultimoAcesso && agora - ultimoAcessoEm < 5000) return;
  ultimoAcesso = chave;
  ultimoAcessoEm = agora;
  let deviceKey: string | null = null;
  try { deviceKey = localStorage.getItem(DEVICE_KEY); } catch { /* armazenamento indisponível */ }
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const largura = window.innerWidth;
  const payload = JSON.stringify({
    tela: tela.slice(0, 200),
    rota: window.location.pathname.slice(0, 300),
    sessaoId: idSessaoNavegacao(),
    deviceKey,
    deviceType: largura < 768 ? "mobile" : largura < 1024 ? "tablet" : "desktop",
    displayMode: standalone ? "standalone" : "browser",
    isPwaInstalled: standalone,
  });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(ACESSO_ENDPOINT, new Blob([payload], { type: "application/json" }))) return;
  } catch { /* fallback abaixo */ }
  const envio = fetchOriginal ?? window.fetch.bind(window);
  void envio(ACESSO_ENDPOINT, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => undefined);
}

export function instalarMonitoramentoGlobal() {
  if (typeof window === "undefined" || instalado) return () => undefined;
  instalado = true;
  fetchOriginal = window.fetch.bind(window);
  void reenviarFila();
  const originalConsoleError = console.error;

  // "Script error." sem arquivo nem linha: o navegador esconde o erro de um script de outro domínio
  // (extensão ou navegador embutido, como o do Instagram). O app não carrega scripts externos,
  // então fica como aviso com o motivo, não como falha fatal do app.
  const onError = (event: ErrorEvent) => {
    const opaco = event.message === "Script error." && !event.filename && !event.error;
    registrarErro({ mensagem: event.message || "Erro JavaScript não identificado", stack: event.error?.stack, nivel: opaco ? "warn" : "fatal", codigo: "GLOBAL_JS_ERROR", action: opaco ? "frontend.global.opaque" : "frontend.global.error", detalhes: { arquivo: event.filename, linha: event.lineno, coluna: event.colno, ...(opaco ? { motivo: "erro_de_script_externo_sem_detalhes" } : {}) } });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    if (ehCancelamento(event.reason)) return;
    const erro = normalizarErro(event.reason);
    const motivo = event.reason instanceof TypeError ? motivoFalhaDoAparelho(Date.now()) : null;
    registrarErro({ mensagem: erro.mensagem, stack: erro.stack, codigo: "UNHANDLED_REJECTION", action: "frontend.promise.unhandled", nivel: motivo ? "info" : "fatal", detalhes: motivo ? { motivo } : undefined });
  };
  const onResourceError = (event: Event) => {
    const target = event.target as HTMLImageElement | HTMLScriptElement | HTMLLinkElement | null;
    if (!target || target === document.documentElement) return;
    const source = target instanceof HTMLImageElement || target instanceof HTMLScriptElement ? target.src : target.href;
    registrarErro({ mensagem: "Falha ao carregar recurso", codigo: "RESOURCE_LOAD_ERROR", action: "frontend.resource.load", nivel: "error", detalhes: { tag: target.tagName, recurso: source?.split("?")[0]?.slice(0, 500) } });
  };

  console.error = (...args: unknown[]) => {
    originalConsoleError(...args);
    const erro = normalizarErro(args[0]);
    registrarErro({ mensagem: erro.mensagem, stack: erro.stack, codigo: "CONSOLE_ERROR", action: "frontend.console.error", nivel: "error", detalhes: { argumentos: args.slice(1).map((x) => normalizarErro(x).mensagem).join(" | ").slice(0, 2500) } });
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const metodo = init?.method || (input instanceof Request ? input.method : "GET");
    if (url.includes(ENDPOINT) || url.includes(ACESSO_ENDPOINT)) return fetchOriginal!(input, init);
    const inicio = Date.now();
    try {
      const response = await fetchOriginal!(input, init);
      if (!response.ok) {
        const esperada = respostaEsperada(url, response.status);
        registrarErro({ origem: "api", nivel: esperada ? "info" : response.status >= 500 ? "error" : "warn", codigo: "API_HTTP_ERROR", action: esperada ? "api.request.expected" : "api.request.failed", mensagem: `API retornou HTTP ${response.status}`, status_http: response.status, metodo, request_id: response.headers.get("x-request-id") || undefined, detalhes: { url: url.split("?")[0].slice(0, 700), duracao_ms: Date.now() - inicio } });
      }
      return response;
    } catch (error) {
      if (ehCancelamento(error)) throw error;
      // Tentativa que quem chamou vai repetir (apiJson): só a última falha é registrada.
      if ((init as (RequestInit & { sraLuckVaiRepetir?: boolean }) | undefined)?.sraLuckVaiRepetir) throw error;
      const erro = normalizarErro(error);
      const motivo = motivoFalhaDoAparelho(inicio);
      registrarErro({ origem: "api", nivel: motivo ? "info" : "error", codigo: motivo ? "CONEXAO_DO_APARELHO" : "API_NETWORK_ERROR", action: "api.network.failed", mensagem: erro.mensagem, stack: erro.stack, metodo, detalhes: { url: url.split("?")[0].slice(0, 700), duracao_ms: Date.now() - inicio, ...(motivo ? { motivo } : {}) } });
      throw error;
    }
  };

  window.addEventListener("error", onError);
  window.addEventListener("error", onResourceError, true);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("online", () => void reenviarFila());
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("error", onResourceError, true);
    window.removeEventListener("unhandledrejection", onRejection);
    console.error = originalConsoleError;
    if (fetchOriginal) window.fetch = fetchOriginal;
    fetchOriginal = null;
    instalado = false;
  };
}
