type EventoErro = {
  mensagem: string;
  stack?: string;
  componente?: string;
  codigo?: string;
  nivel?: "warning" | "error" | "critical";
  origem?: "frontend" | "api";
  status_http?: number;
  detalhes?: Record<string, unknown>;
};

let ultimo = "";
let ultimoEm = 0;

export function registrarErro(evento: EventoErro) {
  if (typeof window === "undefined") return;
  const mensagem = evento.mensagem.trim().slice(0, 1200);
  if (!mensagem) return;
  const agora = Date.now();
  const assinatura = `${evento.origem || "frontend"}|${evento.codigo || ""}|${mensagem}`;
  if (assinatura === ultimo && agora - ultimoEm < 5000) return;
  ultimo = assinatura;
  ultimoEm = agora;
  const payload = {
    ...evento,
    mensagem,
    origem: evento.origem || "frontend",
    rota: window.location.pathname,
    ambiente: import.meta.env.MODE,
    detalhes: evento.detalhes || {},
  };
  void fetch("/api/monitoramento/erro", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
}

export function instalarMonitoramentoGlobal() {
  if (typeof window === "undefined") return () => undefined;
  const onError = (event: ErrorEvent) => registrarErro({
    mensagem: event.message || "Erro JavaScript não identificado",
    stack: event.error?.stack,
    detalhes: { arquivo: event.filename, linha: event.lineno, coluna: event.colno },
  });
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    registrarErro({
      mensagem: reason instanceof Error ? reason.message : String(reason || "Promise rejeitada"),
      stack: reason instanceof Error ? reason.stack : undefined,
      codigo: "UNHANDLED_REJECTION",
    });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
