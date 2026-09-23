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

// Limiares de desempenho: só exceções são enviadas, nunca amostras saudáveis.
const MEMORIA_LIMIAR_USO = 0.8;
const TAREFA_LONGA_LIMIAR_MS = 3000;
const CARREGAMENTO_LENTO_LIMIAR_MS = 4000;
const DESEMPENHO_INTERVALO_REPORTE_MS = 10 * 60 * 1000;
const ultimoReporteDesempenho = new Map<string, number>();

function reportarDesempenho(codigo: string, mensagem: string, detalhes: Record<string, unknown>) {
  const agora = Date.now();
  if (agora - (ultimoReporteDesempenho.get(codigo) ?? 0) < DESEMPENHO_INTERVALO_REPORTE_MS) return;
  ultimoReporteDesempenho.set(codigo, agora);
  const displayMode = window.matchMedia?.("(display-mode: standalone)").matches ? "standalone" : "browser";
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  registrarErro({ mensagem, nivel: "warn", codigo, action: "frontend.performance", detalhes: { ...detalhes, display_mode: displayMode, device_memory_gb: deviceMemory } });
}

function observarDesempenho() {
  const cleanups: Array<() => void> = [];
  const mb = (bytes: number) => Math.round(bytes / 1048576);

  const verificarMemoria = () => {
    const memoria = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    if (!memoria?.jsHeapSizeLimit) return;
    const uso = memoria.usedJSHeapSize / memoria.jsHeapSizeLimit;
    if (uso >= MEMORIA_LIMIAR_USO) {
      reportarDesempenho("APP_MEMORY_PRESSURE", "Uso de memória do app acima do limite seguro", { heap_usado_mb: mb(memoria.usedJSHeapSize), heap_limite_mb: mb(memoria.jsHeapSizeLimit), uso_pct: Math.round(uso * 100) });
    }
  };
  const intervalo = window.setInterval(verificarMemoria, 60 * 1000);
  cleanups.push(() => window.clearInterval(intervalo));

  if (typeof PerformanceObserver !== "undefined") {
    const observar = (tipo: string, callback: (entries: PerformanceEntryList) => void) => {
      try {
        const observer = new PerformanceObserver((list) => callback(list.getEntries()));
        observer.observe({ type: tipo, buffered: true });
        cleanups.push(() => observer.disconnect());
      } catch { /* tipo não suportado neste navegador */ }
    };
    observar("longtask", (entries) => {
      const maior = entries.reduce((max, entry) => Math.max(max, entry.duration), 0);
      if (maior >= TAREFA_LONGA_LIMIAR_MS) reportarDesempenho("APP_MAIN_THREAD_BLOCKED", "Tela do app travou por vários segundos", { duracao_ms: Math.round(maior) });
    });
    observar("largest-contentful-paint", (entries) => {
      const ultimo = entries[entries.length - 1];
      if (ultimo && ultimo.startTime >= CARREGAMENTO_LENTO_LIMIAR_MS) reportarDesempenho("APP_SLOW_LOAD", "Carregamento da tela do app lento", { lcp_ms: Math.round(ultimo.startTime) });
    });
  }

  return () => cleanups.forEach((cleanup) => cleanup());
}

export function instalarMonitoramentoGlobal() {
  if (typeof window === "undefined" || instalado) return () => undefined;
  instalado = true;
  fetchOriginal = window.fetch.bind(window);
  void reenviarFila();
  const originalConsoleError = console.error;

  const onError = (event: ErrorEvent) => registrarErro({ mensagem: event.message || "Erro JavaScript não identificado", stack: event.error?.stack, nivel: "fatal", codigo: "GLOBAL_JS_ERROR", action: "frontend.global.error", detalhes: { arquivo: event.filename, linha: event.lineno, coluna: event.colno } });
  const onRejection = (event: PromiseRejectionEvent) => { const erro = normalizarErro(event.reason); registrarErro({ mensagem: erro.mensagem, stack: erro.stack, codigo: "UNHANDLED_REJECTION", action: "frontend.promise.unhandled", nivel: "fatal" }); };
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
    if (url.includes(ENDPOINT)) return fetchOriginal!(input, init);
    const inicio = Date.now();
    try {
      const response = await fetchOriginal!(input, init);
      if (!response.ok) registrarErro({ origem: "api", nivel: response.status >= 500 ? "error" : "warn", codigo: "API_HTTP_ERROR", action: "api.request.failed", mensagem: `API retornou HTTP ${response.status}`, status_http: response.status, metodo, request_id: response.headers.get("x-request-id") || undefined, detalhes: { url: url.split("?")[0].slice(0, 700), duracao_ms: Date.now() - inicio } });
      return response;
    } catch (error) {
      const erro = normalizarErro(error);
      registrarErro({ origem: "api", nivel: "error", codigo: "API_NETWORK_ERROR", action: "api.network.failed", mensagem: erro.mensagem, stack: erro.stack, metodo, detalhes: { url: url.split("?")[0].slice(0, 700), duracao_ms: Date.now() - inicio } });
      throw error;
    }
  };

  window.addEventListener("error", onError);
  window.addEventListener("error", onResourceError, true);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("online", () => void reenviarFila());
  const pararDesempenho = observarDesempenho();
  return () => {
    pararDesempenho();
    window.removeEventListener("error", onError);
    window.removeEventListener("error", onResourceError, true);
    window.removeEventListener("unhandledrejection", onRejection);
    console.error = originalConsoleError;
    if (fetchOriginal) window.fetch = fetchOriginal;
    fetchOriginal = null;
    instalado = false;
  };
}
