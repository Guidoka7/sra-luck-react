import { describe, expect, it } from "vitest";
import {
  montarVisaoGeral,
  type AgendamentoLinha,
  type BoletoLinha,
  type ClienteLinha,
  type DadosVisaoGeral,
} from "./visao-geral-agregacao";
import { indiceRecebimentos, realizacaoDaParcela, receitaAdministrativaDoValor } from "./financeiro-calculos";

const HOJE = "2026-09-28"; // segunda-feira

function cliente(id: string, extra: Partial<ClienteLinha> = {}): ClienteLinha {
  return {
    id,
    nome_completo: `Cliente ${id.toUpperCase()}`,
    cpf: "52998224725",
    data_nascimento: "1990-05-10",
    procedimento: "Mamoplastia",
    acesso_app_liberado: true,
    status_contrato: "ativo",
    valor_contrato: 1000,
    custo_total: 1250,
    taxa_administrativa_percentual: 25,
    quantidade_parcelas: 12,
    liberacao_financeira_solicitada_em: null,
    ativo: true,
    created_at: "2026-01-10T12:00:00Z",
    ...extra,
  };
}

let seq = 0;
function boleto(clienteId: string, extra: Partial<BoletoLinha> = {}): BoletoLinha {
  seq += 1;
  return {
    id: `b${seq}`,
    cliente_id: clienteId,
    numero_parcela: seq,
    total_parcelas: 12,
    valor: 100,
    status: "nao_pago",
    data_vencimento: "2026-12-10",
    data_pagamento: null,
    suspensa: false,
    updated_at: "2026-09-01T12:00:00Z",
    ...extra,
  };
}

function agendamento(id: string, clienteId: string, extra: Partial<AgendamentoLinha> = {}): AgendamentoLinha {
  return {
    id,
    cliente_id: clienteId,
    status: "confirmado",
    horario_termos: "10:00:00",
    termos_assinados_em: null,
    comparecimento_status: "pendente",
    comparecimento_em: null,
    quitacao_status: "pendente",
    quitacao_em: null,
    agenda_cirurgica_liberada_em: null,
    agenda_cirurgica_prazo_ajuste_dias: 0,
    data_cirurgia: null,
    horario_cirurgia: null,
    processo_concluido_em: null,
    created_at: "2026-08-01T12:00:00Z",
    datas: { data: null },
    ...extra,
  };
}

function cenario(): DadosVisaoGeral {
  seq = 0;
  const clientes = [
    cliente("a"), // 8/12 pagas: elegível sem solicitação
    cliente("b", { liberacao_financeira_solicitada_em: "2026-09-14T13:00:00Z" }), // levantamento vencido
    cliente("c"), // termos passados sem registro
    cliente("d"), // liberação cirúrgica vencida
    cliente("e"), // cirurgia agendada
    cliente("f", { status_contrato: "cancelado", ativo: false }),
    cliente("g", { acesso_app_liberado: false }), // pronto para liberar app
    cliente("h", { acesso_app_liberado: false, cpf: "123" }), // CPF inválido: não entra
    cliente("i", { created_at: "2026-09-20T12:00:00Z" }), // sem parcelas
  ];
  const boletos: BoletoLinha[] = [
    // "a": 8 pagas (jan–ago); a última foi paga em setembro.
    ...Array.from({ length: 8 }, (_, i) => boleto("a", { status: "pago", data_vencimento: `2026-0${i + 1}-10`, data_pagamento: i === 7 ? "2026-09-09" : `2026-0${i + 1}-09` })),
    ...Array.from({ length: 4 }, () => boleto("a")),
    boleto("b", { id: "bb", status: "pago", data_vencimento: "2026-09-05", data_pagamento: "2026-09-05" }),
    boleto("c", { status: "pendente_confirmacao", data_vencimento: "2026-09-20", updated_at: "2026-09-25T15:00:00Z" }),
    boleto("d", { status: "nao_pago", data_vencimento: "2026-09-10" }),
    boleto("d", { status: "rejeitado", data_vencimento: "2026-08-10" }),
    boleto("d", { status: "nao_pago", data_vencimento: "2026-09-01", suspensa: true }),
    boleto("e", { status: "nao_pago", data_vencimento: "2026-10-02" }),
    boleto("f", { status: "nao_pago", data_vencimento: "2026-07-01" }), // cancelada: fora da inadimplência
    boleto("g", { status: "nao_pago", data_vencimento: "2026-10-20" }),
    boleto("h", { status: "nao_pago", data_vencimento: "2026-10-20" }),
  ];
  const agendamentos = [
    agendamento("ag-c", "c", { datas: { data: "2026-09-22" }, quitacao_status: "paga", quitacao_em: "2026-09-22T12:00:00Z" }),
    agendamento("ag-d", "d", { datas: [{ data: "2026-09-15" }], comparecimento_status: "compareceu", comparecimento_em: "2026-09-15", quitacao_status: "paga", quitacao_em: "2026-09-16" }),
    agendamento("ag-e", "e", { datas: { data: "2026-06-10" }, data_cirurgia: "2026-09-30", horario_cirurgia: "07:30:00" }),
    agendamento("ag-g", "g", { datas: { data: "2026-09-28" }, horario_termos: "14:00:00" }),
  ];
  return {
    agora: new Date("2026-09-28T15:00:00Z"),
    hoje: HOJE,
    ano: 2026,
    mes: 9,
    clientes,
    boletos,
    recebimentos: [{ boleto_id: "bb", status_validacao: "validado", data_pagamento: "2026-09-06", valor_recebido: 110, created_at: "2026-09-06T12:00:00Z" }],
    agendamentos,
    vendasAguardando: { itens: [{ id: "v1", nome_completo: "Venda RD", data_venda: "2026-09-20", created_at: null }], total: 3 },
    app: null,
    avisos: [],
  };
}

describe("montarVisaoGeral", () => {
  const r = montarVisaoGeral(cenario());
  const p = (id: string) => r.pendencias.find((x) => x.id === id)!;

  it("classifica a jornada com a mesma etapa da Central V46", () => {
    const total = Object.fromEntries(r.jornada.etapas.map((e) => [e.id, e.total]));
    expect(total).toEqual({ preEligibility: 3, financialReview: 1, termsConfirmed: 0, financialRelease: 3, surgeryConfirmed: 1 });
    expect(r.jornada.elegiveisSemSolicitacao).toBe(1);
    expect(p("elegiveis").itens[0].clienteId).toBe("a");
    expect(p("elegiveis").severidade).toBe("info");
  });

  it("marca como crítico o levantamento que passou dos 5 dias úteis", () => {
    const lev = p("levantamentos");
    expect(lev.total).toBe(1);
    expect(lev.severidade).toBe("critica");
    // 14/09 (seg) + 5 dias úteis = 21/09; hoje 28/09 → 7 dias em atraso.
    expect(lev.itens[0].meta).toBe("prazo 21/09 · 7 dias em atraso");
    expect(lev.itens[0].atrasado).toBe(true);
  });

  it("aponta termos passados sem comparecimento/quitação e liberação cirúrgica vencida", () => {
    expect(p("registro_termos").itens.map((i) => i.clienteId)).toEqual(["c"]);
    expect(p("registro_termos").itens[0].detalhe).toContain("falta registrar comparecimento");
    const lib = p("liberacoes_cirurgicas");
    expect(lib.itens.map((i) => i.clienteId)).toEqual(["d"]);
    expect(lib.severidade).toBe("critica");
    // base = quitação 16/09 (mais recente) + 5 dias úteis = 23/09.
    expect(lib.itens[0].meta).toBe("prazo 23/09 · 5 dias em atraso");
  });

  it("ordena a fila por severidade (críticas primeiro)", () => {
    const ordem = r.pendencias.map((x) => x.severidade);
    const peso = { critica: 0, atencao: 1, info: 2, ok: 3 } as const;
    expect(ordem.map((s) => peso[s])).toEqual([...ordem.map((s) => peso[s])].sort((a, b) => a - b));
    expect(r.pendencias[0].severidade).toBe("critica");
  });

  it("calcula inadimplência só na carteira ativa, sem suspensas nem comprovantes em conferência", () => {
    expect(r.financeiro.atraso).toMatchObject({ parcelas: 2, valor: 200, clientes: 1 });
    const inad = p("inadimplencia");
    expect(inad.itens[0].detalhe.replace(/\s/g, " ")).toBe("2 parcelas · R$ 200,00");
    expect(inad.itens[0].meta).toBe("vencida desde 10/08 · 49 dias em atraso");
  });

  it("usa o recebimento validado e calcula a receita administrativa pela taxa do contrato", () => {
    // Setembro: parcela de "a" (100, paga 09/09) + recebimento validado de "b" (110, não 100).
    expect(r.financeiro.mes.recebido).toBe(210);
    expect(r.financeiro.mes.parcelasRecebidas).toBe(2);
    // taxa = 1250 - 1000 = 250 → 20% do valor pago.
    expect(r.financeiro.mes.receitaAdministrativaRealizada).toBe(42);
    const setembro = r.financeiro.serie.find((m) => m.mes === "2026-09")!;
    expect(setembro.recebido).toBe(210);
    expect(r.financeiro.serie).toHaveLength(6);
    expect(r.financeiro.serie.at(-1)).toMatchObject({ mes: "2026-10", futuro: true });
  });

  it("lista comprovantes em conferência com tempo na fila", () => {
    const comp = p("comprovantes");
    expect(comp.total).toBe(1);
    expect(comp.valor).toBe(100);
    expect(comp.itens[0].meta).toBe("na fila há 3 dias");
    expect(r.financeiro.conferencia).toEqual({ valor: 100, parcelas: 1 });
  });

  it("conta cadastros pendentes, acesso ao app pronto e carteira", () => {
    expect(p("cadastros").total).toBe(4); // 3 vendas + cliente "i" sem parcelas
    expect(p("acesso_app").itens.map((i) => i.clienteId)).toEqual(["g"]);
    expect(r.carteira).toMatchObject({ ativas: 8, canceladas: 1, novasNoMes: 1, creditoContratadoAtivo: 8000, ticketMedio: 1000 });
  });

  it("monta a agenda dos próximos 7 dias em ordem cronológica", () => {
    expect(r.agenda.hoje.map((e) => e.id)).toEqual(["termos:ag-g"]);
    expect(r.agenda.proximos.map((e) => `${e.tipo}:${e.data}:${e.horario}`)).toEqual(["termos:2026-09-28:14:00", "cirurgia:2026-09-30:07:30"]);
    expect(r.agenda.mes).toEqual({ termos: 3, cirurgias: 1 });
  });

  it("marca pendências vazias como ok", () => {
    const vazio = montarVisaoGeral({ ...cenario(), clientes: [], boletos: [], agendamentos: [], recebimentos: [], vendasAguardando: { itens: [], total: 0 } });
    expect(vazio.pendencias.every((x) => x.severidade === "ok" && x.total === 0)).toBe(true);
    expect(vazio.financeiro.atraso.percentualParcelas).toBe(0);
  });
});

describe("financeiro-calculos", () => {
  it("receita administrativa usa custo total, ou a taxa percentual como reserva", () => {
    expect(receitaAdministrativaDoValor({ valor_contrato: 1000, custo_total: 1250 }, 125)).toBe(25);
    expect(receitaAdministrativaDoValor({ valor_contrato: 1000, custo_total: 0, taxa_administrativa_percentual: 25 }, 125)).toBe(0);
    expect(receitaAdministrativaDoValor(null, 100)).toBe(0);
  });

  it("recebimento validado prevalece sobre o valor nominal", () => {
    const indice = indiceRecebimentos([
      { boleto_id: "x", status_validacao: "validado", data_pagamento: "2026-09-02", valor_recebido: 105, created_at: "2026-09-02T10:00:00Z" },
      { boleto_id: "x", status_validacao: "rejeitado", data_pagamento: "2026-09-01", valor_recebido: 100, created_at: "2026-09-01T10:00:00Z" },
    ]);
    expect(realizacaoDaParcela({ status: "pago", valor: 100, data_pagamento: "2026-09-01" }, indice.get("x"))).toEqual({ data: "2026-09-02", valor: 105 });
    expect(realizacaoDaParcela({ status: "nao_pago", valor: 100, data_pagamento: null })).toEqual({ data: null, valor: 0 });
  });
});
