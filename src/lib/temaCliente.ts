import { useCallback, useEffect, useState } from "react";

/**
 * Tema do app da cliente (independente do painel administrativo).
 *
 * - "claro": o visual aprovado da Sra. Luck (padrão);
 * - "escuro": modo escuro premium (paleta em src/styles/client-dark.generated.css,
 *   gerada por scripts/tema-escuro-cliente.mjs);
 * - "sistema": acompanha o modo claro/escuro do celular.
 *
 * A escolha é deste aparelho (localStorage), como os demais ajustes do app.
 * O tema efetivo é aplicado em <html data-tema-cliente>, para alcançar também
 * as folhas e modais abertos fora da árvore do app (portais).
 */
export type PreferenciaTema = "claro" | "escuro" | "sistema";
export type TemaEfetivo = "claro" | "escuro";

const CHAVE = "sra-luck-tema-cliente";
const EVENTO = "sra-luck-tema-cliente";

export function lerPreferenciaTema(): PreferenciaTema {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo === "claro" || salvo === "escuro" || salvo === "sistema") return salvo;
  } catch { /* armazenamento indisponível: usa o padrão */ }
  return "claro";
}

function sistemaEscuro() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolverTema(preferencia: PreferenciaTema, sistemaEhEscuro: boolean): TemaEfetivo {
  if (preferencia === "sistema") return sistemaEhEscuro ? "escuro" : "claro";
  return preferencia;
}

/**
 * Aplica o tema no documento. A cor da barra do celular e o fundo externo são
 * sincronizados pelo script de index.html (syncClientChrome), que já considera
 * o modo escuro; o evento "app:navigate" pede essa sincronização na hora.
 */
export function aplicarTemaCliente(tema: TemaEfetivo | null) {
  const raiz = document.documentElement;
  if (tema) raiz.setAttribute("data-tema-cliente", tema);
  else raiz.removeAttribute("data-tema-cliente");
  window.dispatchEvent(new Event("app:navigate"));
}

/** Preferência e tema efetivo, sincronizados entre todos os componentes e abas. */
export function useTemaCliente() {
  const [preferencia, setPreferencia] = useState<PreferenciaTema>(lerPreferenciaTema);
  const [sistema, setSistema] = useState<boolean>(sistemaEscuro);

  useEffect(() => {
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const aoMudarSistema = () => setSistema(Boolean(mq?.matches));
    const aoMudarPreferencia = () => setPreferencia(lerPreferenciaTema());
    mq?.addEventListener?.("change", aoMudarSistema);
    window.addEventListener(EVENTO, aoMudarPreferencia);
    window.addEventListener("storage", aoMudarPreferencia);
    return () => {
      mq?.removeEventListener?.("change", aoMudarSistema);
      window.removeEventListener(EVENTO, aoMudarPreferencia);
      window.removeEventListener("storage", aoMudarPreferencia);
    };
  }, []);

  const definir = useCallback((proxima: PreferenciaTema) => {
    try { localStorage.setItem(CHAVE, proxima); } catch { /* segue só nesta sessão */ }
    setPreferencia(proxima);
    window.dispatchEvent(new Event(EVENTO));
  }, []);

  const efetivo = resolverTema(preferencia, sistema);
  return { preferencia, efetivo, definir, alternar: () => definir(efetivo === "escuro" ? "claro" : "escuro") };
}
