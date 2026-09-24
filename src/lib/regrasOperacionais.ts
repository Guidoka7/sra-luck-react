import { useEffect, useState } from "react";

/**
 * Regras operacionais no navegador (espelho de worker/regras-operacionais.ts).
 * O app da cliente lê só percentuais e prazo (GET /api/regras-operacionais);
 * o painel lê tudo (GET /api/admin/regras-operacionais). Até a resposta
 * chegar valem os padrões históricos. Alteração: somente o Dev, pelo Dev Console.
 */
export type RegrasApp = {
  prazoLiberacaoDiasUteis: number;
  percentual12a24x: number;
  percentual36x: number;
  percentual48a72x: number;
  tetoMensalOperacional?: number;
  appExigeParcela?: boolean;
  appExigeProcedimento?: boolean;
  atualizadoEm?: string | null;
  atualizadoPor?: string | null;
};

export const REGRAS_APP_PADRAO: RegrasApp = { prazoLiberacaoDiasUteis: 5, percentual12a24x: 60, percentual36x: 70, percentual48a72x: 80, tetoMensalOperacional: 100000, appExigeParcela: true, appExigeProcedimento: false };

let atuais: RegrasApp = REGRAS_APP_PADRAO;
let pedido: Promise<RegrasApp> | null = null;
const EVENTO = "sra-luck-regras-operacionais";

export function regrasApp(): RegrasApp {
  return atuais;
}

export function definirRegrasApp(parcial: Partial<RegrasApp>) {
  atuais = { ...atuais, ...Object.fromEntries(Object.entries(parcial).filter(([, v]) => v !== undefined && v !== null)) };
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO));
}

/** Busca as regras uma vez por carregamento de página (admin = regras completas). */
export function carregarRegrasApp(admin = false): Promise<RegrasApp> {
  if (!pedido) {
    pedido = fetch(admin ? "/api/admin/regras-operacionais" : "/api/regras-operacionais", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) definirRegrasApp(admin ? d.regras ?? {} : d); return atuais; })
      .catch(() => atuais);
  }
  return pedido;
}

/** Re-renderiza quando as regras chegam do servidor. */
export function useRegrasApp(admin = false) {
  const [regras, setRegras] = useState(atuais);
  useEffect(() => {
    const atualizar = () => setRegras(atuais);
    window.addEventListener(EVENTO, atualizar);
    void carregarRegrasApp(admin);
    return () => window.removeEventListener(EVENTO, atualizar);
  }, [admin]);
  return regras;
}

export function prazoLiberacaoDiasUteis() {
  return atuais.prazoLiberacaoDiasUteis;
}

/** Percentual mínimo de parcelas pagas por plano (mesma regra de pode_agendar). */
export function percentualDoPlano(quantidadeParcelas: number | null | undefined) {
  if ([12, 18, 24].includes(Number(quantidadeParcelas))) return atuais.percentual12a24x;
  if (Number(quantidadeParcelas) === 36) return atuais.percentual36x;
  return atuais.percentual48a72x;
}
