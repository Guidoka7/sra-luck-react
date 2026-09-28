import { describe, expect, it } from "vitest";
import { argumentosRpcLevantamento, erroRpcLevantamento, montarPatchRevisaoFinanceira } from "./admin-api";

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

describe("levantamento atômico (RPC agenda_registrar_levantamento)", () => {
  it("aprovação vira os argumentos da RPC com o responsável", () => {
    const r = montarPatchRevisaoFinanceira({ ...valido, taxaCartao: 4.2 }, "pendente", AGORA);
    if ("erro" in r) throw new Error(r.erro);
    expect(argumentosRpcLevantamento("c1", r.patch, "staff:x")).toEqual({
      p_cliente_id: "c1", p_decisao: "aprovada", p_saldo_restante: 4000, p_formas: ["pix", "boleto_100"],
      p_taxa_cartao: 4.2, p_observacao: null, p_usuario: "staff:x",
    });
  });

  it("divergência sem valores envia nulos (o banco preserva os atuais)", () => {
    const r = montarPatchRevisaoFinanceira({ decisao: "recusada", observacao: "Comprovante ilegível" }, "pendente", AGORA);
    if ("erro" in r) throw new Error(r.erro);
    expect(argumentosRpcLevantamento("c1", r.patch, "staff:x")).toMatchObject({ p_decisao: "recusada", p_saldo_restante: null, p_formas: null, p_taxa_cartao: null, p_observacao: "Comprovante ilegível" });
  });

  it("erros de regra viram 4xx; falha de auditoria ou qualquer outra vira 500 e nunca sucesso", () => {
    expect(erroRpcLevantamento("CLIENTE_NAO_ENCONTRADA").status).toBe(404);
    expect(erroRpcLevantamento("FORMA_QUITACAO_INVALIDA").status).toBe(400);
    const auditoria = erroRpcLevantamento('new row for relation "logs_alteracoes" violates check constraint');
    expect(auditoria.status).toBe(500);
    expect(auditoria.erro).toContain("Nada foi gravado");
    expect(erroRpcLevantamento(undefined).status).toBe(500);
  });
});
