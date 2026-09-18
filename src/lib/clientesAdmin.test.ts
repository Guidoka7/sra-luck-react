import { describe, expect, it } from "vitest";
import type { Cliente } from "@/types/database";
import { clienteAdminTab, clienteTemFinanceiro, separarClientesAdmin } from "./clientesAdmin";

function cliente(overrides: Partial<Cliente>): Cliente {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    nome_completo: overrides.nome_completo ?? null,
    cpf: overrides.cpf ?? null,
    data_nascimento: overrides.data_nascimento ?? null,
    telefone: overrides.telefone ?? null,
    email: overrides.email ?? null,
    procedimento: overrides.procedimento ?? null,
    medico: null,
    hospital: null,
    consultora: null,
    valor_contrato: null,
    taxa_administrativa_percentual: 0,
    custo_total: 0,
    status_cirurgia: "nao_agendada",
    status_financeiro: "a_pagar",
    quantidade_parcelas: null,
    ativo: true,
    observacoes_internas: null,
    created_at: "2026-09-18T12:00:00Z",
    updated_at: "2026-09-18T12:00:00Z",
    ...overrides,
  };
}

describe("agrupamento oficial de Clientes", () => {
  it("cliente sem parcelas reais fica em Aguardando cadastro", () => {
    const draft = cliente({ tem_financeiro: false, parcelas_total: 0, status_contrato: "ativo" });
    expect(clienteTemFinanceiro(draft)).toBe(false);
    expect(clienteAdminTab(draft)).toBe("aguardando");
  });

  it("cliente com ao menos uma parcela real fica em Cadastradas", () => {
    const comFinanceiro = cliente({ tem_financeiro: true, parcelas_total: 1, status_contrato: "ativo" });
    expect(clienteTemFinanceiro(comFinanceiro)).toBe(true);
    expect(clienteAdminTab(comFinanceiro)).toBe("cadastradas");
  });

  it("cancelada nunca aparece em Cadastradas nem Aguardando", () => {
    const cancelada = cliente({ tem_financeiro: true, parcelas_total: 12, status_contrato: "cancelado" });
    expect(clienteAdminTab(cancelada)).toBe("canceladas");

    const grupos = separarClientesAdmin([
      cancelada,
      cliente({ id: "aguardando", tem_financeiro: false }),
      cliente({ id: "cadastrada", tem_financeiro: true }),
    ]);

    expect(grupos.canceladas.map((item) => item.id)).toContain(cancelada.id);
    expect(grupos.cadastradas.map((item) => item.id)).not.toContain(cancelada.id);
    expect(grupos.aguardando.map((item) => item.id)).not.toContain(cancelada.id);
  });
});
