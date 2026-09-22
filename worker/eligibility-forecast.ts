export type ParcelaForecast = {
  numero_parcela?: number | null;
  total_parcelas?: number | null;
  status?: string | null;
  data_vencimento?: string | null;
  data_pagamento?: string | null;
  suspensa?: boolean | null;
};

export type PrevisaoElegibilidade = {
  data: string | null;
  totalParcelas: number;
  percentual: number | null;
  parcelasNecessarias: number | null;
  parcelasPagas: number;
  parcelasRestantes: number | null;
  atingida: boolean;
  fonte: "atingida" | "cronograma" | "projecao" | "sem_base";
  suspensasConsideradas: number;
};

export const REGRAS_ELEGIBILIDADE_V46: Readonly<Record<number, number>> = {
  12: 60,
  18: 60,
  24: 60,
  36: 70,
  48: 80,
  60: 80,
  72: 80,
};

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const iso = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

export function addMonthsIsoClamped(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, lastDay));
  return base.toISOString().slice(0, 10);
}

function numero(row: ParcelaForecast) {
  const n = Number(row.numero_parcela ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function ordenarPorCronograma(a: ParcelaForecast, b: ParcelaForecast) {
  const ad = isoDate(a.data_vencimento) ?? "9999-12-31";
  const bd = isoDate(b.data_vencimento) ?? "9999-12-31";
  const byDate = ad.localeCompare(bd);
  return byDate || numero(a) - numero(b);
}

/**
 * Previsão operacional da elegibilidade financeira.
 *
 * Fonte de verdade:
 * - quantidade REAL de parcelas persistidas;
 * - quantidade REAL de parcelas pagas;
 * - vencimentos atuais do cronograma;
 * - parcelas suspensas ficam depois das parcelas ativas.
 *
 * Assim a previsão muda automaticamente quando o Financeiro altera vencimento,
 * suspende/realoca parcela, reabre parcela ou muda a quantidade real do plano.
 */
export function calcularPrevisaoElegibilidade(
  parcelasEntrada: ParcelaForecast[],
  dataAtingiuPercentual?: string | null,
): PrevisaoElegibilidade {
  const parcelas = [...parcelasEntrada];
  const totalParcelas = parcelas.length;
  const percentual = REGRAS_ELEGIBILIDADE_V46[totalParcelas] ?? null;
  const parcelasNecessarias = percentual == null ? null : Math.ceil((totalParcelas * percentual) / 100);
  const pagas = parcelas.filter((row) => String(row.status ?? "") === "pago");
  const parcelasPagas = pagas.length;
  const parcelasRestantes = parcelasNecessarias == null ? null : Math.max(0, parcelasNecessarias - parcelasPagas);
  const suspensas = parcelas.filter((row) => row.suspensa && String(row.status ?? "") !== "pago");

  if (parcelasNecessarias == null || totalParcelas === 0) {
    return {
      data: null,
      totalParcelas,
      percentual,
      parcelasNecessarias,
      parcelasPagas,
      parcelasRestantes,
      atingida: false,
      fonte: "sem_base",
      suspensasConsideradas: suspensas.length,
    };
  }

  if (parcelasPagas >= parcelasNecessarias) {
    const atingidaPersistida = isoDate(dataAtingiuPercentual);
    const pagasOrdenadas = [...pagas].sort((a, b) => {
      const ad = isoDate(a.data_pagamento) ?? isoDate(a.data_vencimento) ?? "9999-12-31";
      const bd = isoDate(b.data_pagamento) ?? isoDate(b.data_vencimento) ?? "9999-12-31";
      return ad.localeCompare(bd) || numero(a) - numero(b);
    });
    const alvo = pagasOrdenadas[parcelasNecessarias - 1];
    return {
      data: atingidaPersistida ?? isoDate(alvo?.data_pagamento) ?? isoDate(alvo?.data_vencimento),
      totalParcelas,
      percentual,
      parcelasNecessarias,
      parcelasPagas,
      parcelasRestantes: 0,
      atingida: true,
      fonte: "atingida",
      suspensasConsideradas: suspensas.length,
    };
  }

  const abertas = parcelas.filter((row) => String(row.status ?? "") !== "pago");
  const ativas = abertas.filter((row) => !row.suspensa).sort(ordenarPorCronograma);
  const suspensasOrdenadas = abertas.filter((row) => row.suspensa).sort(ordenarPorCronograma);

  const cronograma: { row: ParcelaForecast; vencimento: string | null; projetado: boolean }[] = ativas.map((row) => ({
    row,
    vencimento: isoDate(row.data_vencimento),
    projetado: false,
  }));

  // Se houver parcela suspensa antiga ainda com vencimento no meio do plano,
  // a previsão já a trata como realocada ao final, mesmo antes de o registro
  // legado ser normalizado no banco.
  let cursor = cronograma
    .map((item) => item.vencimento)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  for (const row of suspensasOrdenadas) {
    const original = isoDate(row.data_vencimento);
    let vencimento = original;
    let projetado = false;

    if (cursor) {
      if (!original || original <= cursor) {
        vencimento = addMonthsIsoClamped(cursor, 1);
        projetado = true;
      }
    }

    if (vencimento) cursor = vencimento;
    cronograma.push({ row, vencimento, projetado });
  }

  // Datas nulas são completadas somente para previsão, sem alterar o banco.
  let anterior: string | null = null;
  for (const item of cronograma) {
    if (item.vencimento) {
      anterior = item.vencimento;
      continue;
    }
    if (anterior) {
      item.vencimento = addMonthsIsoClamped(anterior, 1);
      item.projetado = true;
      anterior = item.vencimento;
    }
  }

  const indiceAlvo = Math.max(0, parcelasRestantes! - 1);
  const alvo = cronograma[indiceAlvo];
  const data = alvo?.vencimento ?? null;
  const usouProjecao = Boolean(alvo?.projetado);

  return {
    data,
    totalParcelas,
    percentual,
    parcelasNecessarias,
    parcelasPagas,
    parcelasRestantes,
    atingida: false,
    fonte: data ? (usouProjecao ? "projecao" : "cronograma") : "sem_base",
    suspensasConsideradas: suspensas.length,
  };
}
