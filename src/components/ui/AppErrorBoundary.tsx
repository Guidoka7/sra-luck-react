import { Component, type ErrorInfo, type ReactNode } from "react";
import { registrarErro } from "@/lib/monitoramento";

type Props = { children: ReactNode };
type State = { erro: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    const evento = {
      mensagem: erro.message || "Falha de renderização",
      stack: erro.stack,
      codigo: "REACT_RENDER_ERROR",
      componente: info.componentStack?.slice(0, 3000),
      nivel: "critical" as const,
      detalhes: { pathname: window.location.pathname, horario: new Date().toISOString() },
    };

    try {
      registrarErro(evento);
    } catch {
      // O fallback de armazenamento abaixo mantém o diagnóstico mesmo se o monitor falhar.
    }

    try {
      const fila = JSON.parse(localStorage.getItem("sra_luck_monitoramento_pendente") || "[]");
      const item = { ...evento, origem: "frontend", rota: window.location.pathname, criado_em: new Date().toISOString() };
      localStorage.setItem("sra_luck_monitoramento_pendente", JSON.stringify([...fila.slice(-4), item]));
    } catch {
      // Não impedir o fallback visual por causa do próprio monitoramento.
    }
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <main className="min-h-screen bg-bloom px-6 flex items-center justify-center">
        <section className="surface-glass luxury-ring max-w-lg rounded-3xl p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-alert/10 text-alert text-xl">!</div>
          <h1 className="text-xl font-semibold text-burgundy">Ocorreu uma falha inesperada</h1>
          <p className="mt-2 text-sm text-clay/60">A falha foi capturada pelo sistema de diagnóstico. Recarregue a página para continuar.</p>
          <button onClick={() => window.location.reload()} className="mt-5 rounded-full bg-burgundy px-5 py-2.5 text-xs font-semibold uppercase tracking-label text-pearl">Recarregar</button>
        </section>
      </main>
    );
  }
}
