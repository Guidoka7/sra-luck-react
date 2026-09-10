type EventoErro = {
  mensagem: string;
  stack?: string;
  componente?: string;
  codigo?: string;
  nivel?: "warning" | "error" | "critical";
  origem?: "frontend" | "api";
  status_http?: number;
  metodo?: string;
  detalhes?: Record<string, unknown>;
};

let ultimo = "";
let ultimoEm = 0;
let instalado = false;

function normalizarErro(value: unknown) {
  if (value instanceof Error) return { mensagem: value.message || "Erro desconhecido", stack: value.stack };
  if (typeof value === "string") return { mensagem: value };
  try { return { mensagem: JSON.stringify(value) || "Erro desconhecido" }; } catch { return { mensagem: String(value) }; }
}

export function registrarErro(evento: EventoErro) {
  if (typeof window === "undefined") return;
  const mensagem = evento.mensagem.trim().slice(0, 1200);
  if (!mensagem) return;
  const agora = Date.now();
  const assinatura = `${evento.origem || "frontend"}|${evento.codigo || ""}|${evento.metodo || ""}|${evento.status_http || ""}|${window.location.pathname}|${mensagem}`;
  if (assinatura === ultimo && agora - ultimoEm < 5000) return;
  ultimo = assinatura;
  ultimoEm = agora;
  const payload = JSON.stringify({
    ...evento,
    mensagem,
    origem: evento.origem || "frontend",
    rota: window.location.pathname,
    ambiente: import.meta.env.MODE,
    detalhes: evento.detalhes || {},
  });
  try {
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon("/api/monitoramento/erro", new Blob([payload], { type: "application/json" }));
      if (ok) return;
    }
  } catch { /* fallback abaixo */ }
  void fetch("/api/monitoramento/erro", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}

export function instalarMonitoramentoGlobal() {
  if (typeof window === "undefined" || instalado) return () => undefined;
  instalado = true;

  const onError = (event: ErrorEvent) => registrarErro({
    mensagem: event.message || "Erro JavaScript não identificado",
    stack: event.error?.stack,
    nivel: "critical",
    codigo: "GLOBAL_JS_ERROR",
    detalhes: { arquivo: event.filename, linha: event.lineno, coluna: event.colno },
  });

  const onResourceError = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (!target || target === document.documentElement) return;
    const source = (target as HTMLImageElement).src || (target as HTMLScriptElement).src || (target as HTMLLinkElement).href || "";
    registrarErro({
      mensagem: `Falha ao carregar recurso${source ? `: ${source}` : ""}`,
      codigo: "RESOURCE_LOAD_ERROR",
      nivel: "error",
      detalhes: { tag: target.tagName, recurso: source.slice(0, 500) },
    });
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    const erro = normalizarErro(event.reason);
    registrarErro({ mensagem: erro.mensagem, stack: erro.stack, codigo: "UNHANDLED_REJECTION", nivel: "critical" });
  };

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    originalConsoleError(...args);
    const erro = normalizarErro(args[0]);
    registrarErro({
      mensagem: erro.mensagem,
      stack: erro.stack,
      codigo: "CONSOLE_ERROR",
      nivel: "error",
      detalhes: { argumentos: args.slice(1).map((x) => normalizarErro(x).mensagem).join(" | ").slice(0, 2500) },
    });
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const metodo = init?.method || (input instanceof Request ? input.method : "GET");
    if (url.includes("/api/monitoramento/erro")) return originalFetch(input, init);
    const inicio = Date.now();
    try {
      const response = await originalFetch(input, init);
      if (!response.ok) {
        registrarErro({
          mensagem: `API retornou HTTP ${response.status}`,
          codigo: "API_HTTP_ERROR",
          origem: "api",
          status_http: response.status,
          metodo,
          nivel: response.status >= 500 ? "critical" : "error",
          detalhes: { url: url.slice(0, 700), duracao_ms: Date.now() - inicio },
        });
      }
      return response;
    } catch (error) {
      const erro = normalizarErro(error);
      registrarErro({
        mensagem: erro.mensagem || "Falha de rede",
        stack: erro.stack,
        codigo: "API_NETWORK_ERROR",
        origem: "api",
        metodo,
        nivel: "critical",
        detalhes: { url: url.slice(0, 700), duracao_ms: Date.now() - inicio },
      });
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
    window.fetch = originalFetch;
    instalado = false;
  };
}
