import { describe, expect, it } from "vitest";
import { configDoBanco, montarMissoes } from "./clube";

const config = configDoBanco({ pontos_primeira_parcela: 50, pontos_parcela_em_dia: 10, pontos_indicacao_venda: 200 });

describe("Clube — configuração", () => {
  it("usa os valores do banco e cai no padrão aprovado quando a coluna ainda não existe", () => {
    expect(config).toEqual({ pontosPrimeiraParcela: 50, pontosParcelaEmDia: 10, pontosIndicacao: 200 });
    expect(configDoBanco(null)).toEqual({ pontosPrimeiraParcela: 50, pontosParcelaEmDia: 10, pontosIndicacao: 200 });
    expect(configDoBanco({ pontos_parcela_em_dia: -5 }).pontosParcelaEmDia).toBe(10);
  });
});

describe("Clube — missões a partir do extrato real", () => {
  const eventos = [
    { pontos: 50, metadata: { motivo: "primeira_parcela" } },
    { pontos: 10, metadata: { motivo: "parcela_em_dia" } },
    { pontos: 10, metadata: { motivo: "parcela_em_dia" } },
    { pontos: 200, metadata: { motivo: "indicacao_venda" } },
    { pontos: -450, metadata: { titulo: "Nécessaire" } },
  ];
  const parcelas = [
    { numero_parcela: 1, status: "pago", data_vencimento: "2026-08-10" },
    { numero_parcela: 3, status: "nao_pago", data_vencimento: "2026-10-10" },
    { numero_parcela: 2, status: "pendente_confirmacao", data_vencimento: "2026-09-10" },
  ];

  it("conta parcelas em dia, indicações creditadas e a próxima parcela a vencer", () => {
    const m = montarMissoes(eventos, parcelas, config);
    expect(m.primeiraParcela).toEqual({ concluida: true, pontos: 50 });
    expect(m.parcelaEmDia).toEqual({ vezes: 2, pontosGanhos: 20, pontosPorParcela: 10, proxima: { numero: 2, vencimento: "2026-09-10" } });
    expect(m.indicacao).toEqual({ creditadas: 1, pontosGanhos: 200, pontosPorIndicacao: 200 });
  });

  it("sem histórico: nada concluído e sem próxima parcela", () => {
    const m = montarMissoes([], [], config);
    expect(m.primeiraParcela.concluida).toBe(false);
    expect(m.parcelaEmDia.proxima).toBeNull();
    expect(m.indicacao.creditadas).toBe(0);
  });
});
