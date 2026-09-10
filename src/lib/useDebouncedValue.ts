import { useEffect, useState } from "react";

/** Atrasa a propagação de um valor que muda rápido (ex.: campo de busca),
 *  evitando recalcular filtros/consultas a cada tecla digitada. */
export function useDebouncedValue<T>(valor: T, atrasoMs = 250): T {
  const [valorAtrasado, setValorAtrasado] = useState(valor);

  useEffect(() => {
    const timer = setTimeout(() => setValorAtrasado(valor), atrasoMs);
    return () => clearTimeout(timer);
  }, [valor, atrasoMs]);

  return valorAtrasado;
}
