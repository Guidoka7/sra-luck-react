import { useCallback, useEffect, useRef, useState } from "react";

/** Aba do app correspondente ao destino de uma notificação (sininho ou push). */
export function abaDoDestino(destino: string | null | undefined): { aba: "agenda" | "parcelas" | "premios" | "mais"; maisSubTela?: "jornada" } | null {
  switch (String(destino ?? "").toLowerCase()) {
    case "agenda": return { aba: "agenda" };
    case "parcelas": case "pagamentos": case "financeiro": return { aba: "parcelas" };
    case "clube": case "premios": return { aba: "premios" };
    case "jornada": return { aba: "mais", maisSubTela: "jornada" };
    default: return null;
  }
}

/** Destino a partir da URL de um push (ex.: /agenda?abrirComprovante=... abre o Financeiro). */
export function destinoDaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, "https://app.local");
    if (parsed.searchParams.get("abrirComprovante")) return "pagamentos";
    return parsed.searchParams.get("destino") ?? parsed.searchParams.get("aba");
  } catch {
    return null;
  }
}

export interface NotificacaoCliente {
  id: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  emoji: string | null;
  destino: string | null;
  referencia_id: string | null;
  lida: boolean;
  created_at: string;
}

/**
 * Fonte única das notificações da cliente — usada pelo sininho fixo (badge e balão)
 * e pelo bloco compacto da Jornada, para que
 * "lida em um lugar" reflita em todos.
 */
export function useNotificacoesCliente() {
  const [notificacoes, setNotificacoes] = useState<NotificacaoCliente[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const carregouUmaVez = useRef(false);

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch("/api/cliente/notificacoes", { cache: "no-store" });
      if (!resposta.ok) return;
      const dados = await resposta.json() as { notificacoes?: NotificacaoCliente[]; naoLidas?: number };
      setNotificacoes(dados.notificacoes ?? []);
      setNaoLidas(dados.naoLidas ?? 0);
    } finally {
      carregouUmaVez.current = true;
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
    const intervalo = window.setInterval(() => void carregar(), 15_000);
    function aoFocar() {
      if (document.visibilityState === "visible") void carregar();
    }
    document.addEventListener("visibilitychange", aoFocar);
    window.addEventListener("focus", aoFocar);
    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoFocar);
      window.removeEventListener("focus", aoFocar);
    };
  }, [carregar]);

  async function marcarLida(id: string) {
    setNotificacoes((atual) => atual.map((item) => (item.id === id ? { ...item, lida: true } : item)));
    setNaoLidas((atual) => Math.max(0, atual - 1));
    try {
      await fetch(`/api/cliente/notificacoes/${id}/ler`, { method: "POST" });
    } catch {
      // Best-effort: o próximo polling corrige o estado se a chamada falhar.
    }
  }

  async function marcarTodasLidas() {
    setNotificacoes((atual) => atual.map((item) => ({ ...item, lida: true })));
    setNaoLidas(0);
    try {
      await fetch("/api/cliente/notificacoes/ler-todas", { method: "POST" });
    } catch {
      // Best-effort: idem.
    }
  }

  return { notificacoes, naoLidas, carregando, carregar, marcarLida, marcarTodasLidas };
}
