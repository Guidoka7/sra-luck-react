import { describe, expect, it } from "vitest";
import { montarPatchRevisaoFinanceira } from "./admin-api";

const AGORA = "2026-10-10T12:00:00.000Z";
const valido = { decisao: "aprovada", saldoRestante: 4000, formasCusteio: ["pix", "boleto_100"] };

describe("montarPatchRevisaoFinanceira (Etapa 2 — levantamento)", () => {
  it("primeira aprovação grava a configuração e a data de confirmação", () => {
    const r = montarPatchRevisaoFinanceira(valido, "pendente", AGORA);
    if ("erro" in r) throw new Error(r.erro);
    expect(r.patch).toEqual({
      status_revisao_financeira: "aprovada", observacao_revisao_financeira: null,
      financeiro_saldo_restante: 4000, financeiro_formas_custeio: ["pix", "boleto_100"], financeiro_confirmado_em: AGORA,
    });
  });

  it("editar um levantamento já aprovado preserva a data de confirmação (etapa e Agenda de Termos não mudam)", () => {
    const r = montarPatchRevisaoFinanceira({ ...valido, formasCusteio: ["cartao", "pix"], taxaCartao: 4.2, saldoRestante: 3500 }, "aprovada", AGORA);
    if ("erro" in r) throw new Error(r.erro);
    expect(r.patch).not.toHaveProperty("financeiro_confirmado_em");
    expect(r.patch).toMatchObject({ status_revisao_financeira: "aprovada", financeiro_saldo_restante: 3500, financeiro_formas_custeio: ["cartao", "pix"], financeiro_taxa_cartao: 4.2 });
  });

  it("recusa aprovação sem forma, com forma desconhecida, saldo inválido ou taxa fora do intervalo", () => {
    expect(montarPatchRevisaoFinanceira({ ...valido, formasCusteio: [] }, "pendente", AGORA)).toHaveProperty("erro");
    expect(montarPatchRevisaoFinanceira({ ...valido, formasCusteio: ["dinheiro"] }, "pendente", AGORA)).toHaveProperty("erro");
    expect(montarPatchRevisaoFinanceira({ ...valido, saldoRestante: -1 }, "pendente", AGORA)).toHaveProperty("erro");
    expect(montarPatchRevisaoFinanceira({ ...valido, saldoRestante: undefined }, "pendente", AGORA)).toHaveProperty("erro");
    expect(montarPatchRevisaoFinanceira({ ...valido, taxaCartao: 101 }, "pendente", AGORA)).toHaveProperty("erro");
    expect(montarPatchRevisaoFinanceira({ decisao: "outra" }, "pendente", AGORA)).toHaveProperty("erro");
  });

  it("divergência mantém o comportamento anterior e não toca na data de confirmação", () => {
    const r = montarPatchRevisaoFinanceira({ decisao: "recusada", observacao: "Comprovante ilegível" }, "pendente", AGORA);
    if ("erro" in r) throw new Error(r.erro);
    expect(r.patch).toEqual({ status_revisao_financeira: "recusada", observacao_revisao_financeira: "Comprovante ilegível" });
  });
});
