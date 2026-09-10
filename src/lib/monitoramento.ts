type EventoErro = {
  mensagem: string;
  stack?: string;
  componente?: string;
  codigo?: string;
  nivel?: "warning" | "error" | "critical";
  origem?: "frontend" | "api" | "diagnostico";
  status_http?: number;
  metodo?: string;
  detalhes?: Record<string, unknown>;
};

let ultimo = "";
let ultimoEm = 0;
let instalado = false;
let fetchOriginal: typeof window.fetch | null = null;
const ENDPOINT = "/api/monitoramento/erro";
const SENSIVE = /cpf|senha|password|token|secret|authorization|cookie|session|payload/i;

function normalizarErro(value: unknown) {
  if (value instanceof Error) return { mensagem: value.message || "Erro desconhecido", stack: value.stack };
  if (typeof value === "string") return { mensagem: value };
  try { return { mensagem: JSON.stringify(value) || "Erro desconhecido" }; } catch { return { mensagem: String(value) }; }
}

function sanitizarDetalhes(value?: Record<string, unknown>) {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SENSIVE.test(key)).slice(0, 30));
}

export function registrarErro(evento: EventoErro) {
  if (typeof window === "undefined") return;
  const mensagem = evento.mensagem?.trim().slice(0, 1200);
  if (!mensagem) return;
  const agora = Date.now();
  const assinatura = `${evento.origem || "frontend"}|${evento.codigo || ""}|${evento.metodo || ""}|${evento.status_http || ""}|${window.location.pathname}|${mensagem}`;
  if (assinatura === ultimo && agora - ultimoEm < 5000) return;
  ultimo = assinatura;
  ultimoEm = agora;
  const payload = JSON.stringify({ ...evento, mensagem, origem: evento.origem || "frontend", rota: window.location.pathname, ambiente: import.meta.env.MODE, detalhes: sanitizarDetalhes(evento.detalhes) });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }))) return;
  } catch { /* fallback */ }
  void fetchOriginal?.(ENDPOINT, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => undefined);
}

export function instalarMonitoramentoGlobal() {
  if (typeof window === "undefined" || instalado) return () => undefined;
  instalado = true;
  fetchOriginal = window.fetch.bind(window);
  const originalConsoleError = console.error;

  const onError = (event: ErrorEvent) => registrarErro({ mensagem: event.message || "Erro JavaScript não identificado", stack: event.error?.stack, nivel: "critical", codigo: "GLOBAL_JS_ERROR", detalhes: { arquivo: event.filename, linha: event.lineno, coluna: event.colno } });
  const onRejection = (event: PromiseRejectionEvent) => { const erro = normalizarErro(event.reason); registrarErro({ mensagem: erro.mensagem, stack: erro.stack, codigo: "UNHANDLED_REJECTION", nivel: "critical" }); };
  const onResourceError = (event: Event) => {
    const target = event.target as HTMLImageElement | HTMLScriptElement | HTMLLinkElement | null;
    if (!target || target === document.documentElement) return;
    const source = target instanceof HTMLImageElement || target instanceof HTMLScriptElement ? target.src : target.href;
    registrarErro({ mensagem: `Falha ao carregar recurso${source ? `: ${source}` : ""}`, codigo: "RESOURCE_LOAD_ERROR", nivel: "error", detalhes: { tag: target.tagName, recurso: source?.slice(0, 500) } });
  };

  console.error = (...args: unknown[]) => {
    originalConsoleError(...args);
    const erro = normalizarErro(args[0]);
    registrarErro({ mensagem: erro.mensagem, stack: erro.stack, codigo: "CONSOLE_ERROR", nivel: "error", detalhes: { argumentos: args.slice(1).map((x) => normalizarErro(x).mensagem).join(" | ").slice(0, 2500) } });
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const metodo = init?.method || (input instanceof Request ? input.method : "GET");
    if (url.includes(ENDPOINT)) return fetchOriginal!(input, init);
    const inicio = Date.now();
    try {
      const response = await fetchOriginal!(input, init);
      if (!response.ok) registrarErro({ origem: "api", nivel: response.status >= 500 ? "critical" : "error", codigo: "API_HTTP_ERROR", mensagem: `API retornou HTTP ${response.status}`, status_http: response.status, metodo, detalhes: { url: url.split("?")[0].slice(0, 700), duracao_ms: Date.now() - inicio } });
      return response;
    } catch (error) {
      const erro = normalizarErro(error);
      registrarErro({ origem: "api", nivel: "critical", codigo: "API_NETWORK_ERROR", mensagem: erro.mensagem, stack: erro.stack, metodo, detalhes: { url: url.split("?")[0].slice(0, 700), duracao_ms: Date.now() - inicio } });
      throw error;
    }
  };

  window.addEventListener("error", onError);
  window.addEventListener("error", onResourceError, true);
  window.addEventListener("unhandledrejection", onRejection);
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
