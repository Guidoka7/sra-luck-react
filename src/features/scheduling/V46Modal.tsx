import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Modal da Central (markup `.modal-backdrop > .modal` do V46). Fecha com ESC
 * ou clique fora; o ESC é tratado em captura para não fechar também o drawer
 * que estiver aberto por baixo. O foco vai para o modal ao abrir e volta
 * para o elemento anterior ao fechar.
 */
export function V46Modal({ titulo, subtitulo, onClose, children, footer, bloqueado = false, className = "" }: {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Enquanto uma ação está em andamento, ESC/clique fora não fecham. */
  bloqueado?: boolean;
  className?: string;
}) {
  const tituloId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const fecharRef = useRef(onClose);
  fecharRef.current = onClose;
  const bloqueadoRef = useRef(bloqueado);
  bloqueadoRef.current = bloqueado;

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const alvo = ref.current?.querySelector<HTMLElement>("input,select,textarea,button:not([data-modal-close])") ?? ref.current;
    alvo?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!bloqueadoRef.current) fecharRef.current();
    }
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); anterior?.focus?.(); };
  }, []);

  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !bloqueado) onClose(); }}>
    <div ref={ref} className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={tituloId} tabIndex={-1}>
      <div className="modal-head">
        <div>
          <h2 id={tituloId}>{titulo}</h2>
          {subtitulo && <small className="modal-subtitle">{subtitulo}</small>}
        </div>
        <button type="button" className="icon-btn" data-modal-close aria-label="Fechar" onClick={onClose} disabled={bloqueado}>✕</button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </div>
  </div>;
}

/** Confirmação genérica (V46 `confirmModal`) que aguarda a ação real terminar. */
export function ConfirmModal({ titulo, mensagem, rotuloConfirmar = "Confirmar", perigo = false, onConfirmar, onClose }: {
  titulo: string;
  mensagem: ReactNode;
  rotuloConfirmar?: string;
  perigo?: boolean;
  onConfirmar: () => Promise<boolean | void>;
  onClose: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  async function confirmar() {
    if (enviando) return;
    setEnviando(true);
    try { const ok = await onConfirmar(); if (ok !== false) onClose(); }
    finally { setEnviando(false); }
  }
  return <V46Modal titulo={titulo} onClose={onClose} bloqueado={enviando} footer={<>
    <button type="button" className="secondary-btn" onClick={onClose} disabled={enviando}>Cancelar</button>
    <button type="button" className={perigo ? "danger-btn" : "primary-btn"} onClick={confirmar} disabled={enviando} aria-busy={enviando}>{enviando ? "Salvando…" : rotuloConfirmar}</button>
  </>}>
    <p>{mensagem}</p>
  </V46Modal>;
}
