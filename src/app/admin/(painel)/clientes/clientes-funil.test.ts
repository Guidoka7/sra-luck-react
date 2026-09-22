import { describe, expect, it } from "vitest";
import { clienteAguardandoCadastroFinanceiro, clienteComCadastroCompleto } from "./page";

describe("funil de clientes — cadastro financeiro", () => {
  it("mantém todo perfil ativo sem parcelas em Aguardando cadastro", () => {
    expect(clienteAguardandoCadastroFinanceiro({ ativo: true, status_contrato: "ativo", parcelas_total: 0 })).toBe(true);
    expect(clienteAguardandoCadastroFinanceiro({ ativo: true, status_contrato: "ativo", parcelas_total: null })).toBe(true);
  });

  it("só considera Cadastrada quando há ao menos uma parcela real persistida", () => {
    expect(clienteComCadastroCompleto({ ativo: true, status_contrato: "ativo", parcelas_total: 1 })).toBe(true);
    expect(clienteComCadastroCompleto({ ativo: true, status_contrato: "ativo", parcelas_total: 0 })).toBe(false);
  });

  it("não mistura canceladas ou arquivadas no funil de aguardando/cadastradas", () => {
    expect(clienteAguardandoCadastroFinanceiro({ ativo: true, status_contrato: "cancelado", parcelas_total: 0 })).toBe(false);
    expect(clienteComCadastroCompleto({ ativo: true, status_contrato: "cancelado", parcelas_total: 12 })).toBe(false);
    expect(clienteAguardandoCadastroFinanceiro({ ativo: false, status_contrato: "ativo", parcelas_total: 0 })).toBe(false);
    expect(clienteComCadastroCompleto({ ativo: false, status_contrato: "ativo", parcelas_total: 12 })).toBe(false);
  });
});
