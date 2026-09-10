"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renderiza os filhos direto no <body>, fora da árvore da página.
 *
 * Necessário para qualquer modal/overlay com `fixed inset-0`: como as
 * páginas usam animações de entrada (animate-fadeUp) com `transform`,
 * e esse transform permanece aplicado após a animação (`forwards`), o
 * CSS passa a tratar essa div como referência de posicionamento para
 * filhos com `position: fixed` — o modal fica preso dentro da página
 * em vez de cobrir a tela inteira. O Portal resolve isso de raiz.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    setMontado(true);
  }, []);

  if (!montado) return null;
  return createPortal(children, document.body);
}
