import { Component, type ErrorInfo, type ReactNode } from "react";
import { registrarErro } from "@/lib/monitoramento";
import { ehFalhaDeVersao, recarregarParaVersaoNova } from "@/lib/recargaVersao";

type Props = { children: ReactNode };
type State = { erro: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    // Versão antiga do app pedindo arquivos que o deploy novo já removeu: recarrega.
    if (ehFalhaDeVersao(erro) && recarregarParaVersaoNova()) return;
    const evento = {
      mensagem: erro.message || "Falha de renderização",
      stack: erro.stack,
      codigo: "REACT_RENDER_ERROR",
      action: "frontend.react.render",
      componente: info.componentStack?.slice(0, 3000),
      nivel: "fatal" as const,
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
    // Estilos em linha: esta tela precisa ficar legível mesmo quando o CSS do app não carregou.
    const escuro = typeof document !== "undefined" && document.documentElement.dataset.temaCliente === "escuro";
    const cor = escuro ? { fundo: "#111013", cartao: "#1C1B1E", texto: "#F2EEF0", suave: "#A7A0A5", botao: "#B0526A" } : { fundo: "#FBF7F5", cartao: "#FFFFFF", texto: "#3D2426", suave: "#8A7471", botao: "#6B1F2E" };
    return (
      <main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: cor.fundo, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
        <section style={{ maxWidth: 380, width: "100%", padding: 28, borderRadius: 24, background: cor.cartao, textAlign: "center", boxShadow: "0 12px 30px rgba(0,0,0,.12)" }}>
          <h1 style={{ margin: 0, fontFamily: "Georgia, serif", fontSize: 22, color: cor.texto }}>Ocorreu uma falha inesperada</h1>
          <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.5, color: cor.suave }}>A falha foi registrada pela equipe. Toque em recarregar para continuar.</p>
          <button type="button" onClick={() => void recarregarLimpo()} style={{ marginTop: 20, padding: "12px 24px", border: 0, borderRadius: 999, background: cor.botao, color: "#FFF", fontSize: 14, fontWeight: 700 }}>Recarregar</button>
        </section>
      </main>
    );
  }
}

/** Limpa o cache de arquivos do app (versões antigas) e recarrega. */
async function recarregarLimpo() {
  try {
    const chaves = await caches.keys();
    await Promise.all(chaves.filter((c) => c.startsWith("sra-luck-pwa-")).map((c) => caches.delete(c)));
  } catch {
    // Sem Cache Storage: só recarrega.
  }
  window.location.reload();
}
