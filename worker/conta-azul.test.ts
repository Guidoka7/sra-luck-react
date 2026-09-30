import { beforeEach, describe, expect, it } from "vitest";
import { bancoFalso } from "./banco-falso.testutil";
import {
  avaliarParcelaCa, caAtual, detectarMudancasSra, lerMudancasContaAzul, enviarParcelasCliente, horaSaoPaulo, marcadorDe, processarFila, resolverConflito,
  tokenAtual, vinculoSeguroParaBaixa, type Deps,
} from "./conta-azul";
import { PADRAO_CONTA_AZUL, validarConfigContaAzul, type ConfigContaAzul } from "./integracoes-registro";
import type { Env } from "./supabase";

const env = {} as Env;
const CONTA = "11111111-2222-4333-8444-555555555555";
const BOLETO = "b0000000-0000-4000-8000-000000000001";
const CLIENTE = "c0000000-0000-4000-8000-000000000001";
const cfg = (p: Partial<ConfigContaAzul> = {}): ConfigContaAzul => ({ ...PADRAO_CONTA_AZUL, contaFinanceiraId: CONTA, ...p });

type Chamada = { metodo: string; url: string; corpo: any; headers: Record<string, string> };

function provedor(rotas: [string, (c: Chamada) => [number, unknown]][]) {
  const chamadas: Chamada[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const c: Chamada = { metodo: init.method ?? "GET", url: String(url), corpo: typeof init.body === "string" ? JSON.parse(init.body) : init.body, headers: (init.headers ?? {}) as Record<string, string> };
    chamadas.push(c);
    const rota = rotas.find(([chave]) => `${c.metodo} ${c.url}`.includes(chave));
    const [status, corpo] = rota ? rota[1](c) : [404, { message: "sem rota" }];
    return new Response(corpo == null ? "" : JSON.stringify(corpo), { status });
  }) as unknown as typeof fetch;
  return { f, chamadas };
}

function credenciais(inicial: Record<string, string>) {
  const mapa = new Map(Object.entries(inicial));
  return { mapa, c: { obter: async (k: string) => mapa.get(k) ?? null, salvar: async (k: string, v: string) => { mapa.set(k, v); } } };
}

const AGORA = new Date("2026-09-24T15:00:00Z");
const TOKEN_OK = { access_token: "tok", token_expires_at: "2026-09-24T16:00:00Z", refresh_token: "r1", client_id: "cid", client_secret: "csec" };

/** RPC conta_azul_registrar_baixa (migration_124) em memória; o SQL real é validado à parte. */
function rpcsContaAzul(ref: { tabela?: (n: string) => any[] }) {
  return {
    conta_azul_registrar_baixa: (a: any) => {
      const recs = ref.tabela!("financeiro_recebimentos");
      const ja = recs.find((r) => r.idempotency_key === a.p_idempotency_key);
      if (ja) return ja;
      const b = ref.tabela!("boletos").find((x) => x.id === a.p_boleto_id);
      if (!b || !["nao_pago", "rejeitado"].includes(b.status)) throw new Error("Parcela nao esta em aberto");
      const rec = { boleto_id: b.id, valor_original: b.valor, juros: a.p_juros, multa: a.p_multa, desconto: a.p_desconto, valor_recebido: b.valor + a.p_juros + a.p_multa - a.p_desconto, forma_pagamento: a.p_forma_pagamento, origem: "conta_azul", status_validacao: "validado", external_payment_id: a.p_ca_baixa_id, idempotency_key: a.p_idempotency_key, data_pagamento: a.p_data_pagamento };
      recs.push(rec);
      Object.assign(b, { status: "pago", data_pagamento: a.p_data_pagamento });
      return rec;
    },
  };
}

function montar(rotas: [string, (c: Chamada) => [number, unknown]][], tabelas: Record<string, any[]> = {}, config = cfg()) {
  const ref: { tabela?: (n: string) => any[] } = {};
  const banco = bancoFalso({
    clientes: [{ id: CLIENTE, nome_completo: "Ana Souza", cpf: "12345678909" }],
    boletos: [{ id: BOLETO, cliente_id: CLIENTE, numero_parcela: 1, total_parcelas: 3, valor: 100, data_vencimento: "2026-09-10", status: "nao_pago", data_pagamento: null, observacoes: null, suspensa: false }],
    ...tabelas,
  }, rpcsContaAzul(ref));
  ref.tabela = banco.tabela;
  const p = provedor(rotas);
  const cred = credenciais(TOKEN_OK);
  const deps: Partial<Deps> = { db: banco.db, fetch: p.f, credenciais: cred.c, agora: () => AGORA, config };
  return { ...banco, ...p, cred, deps: deps as Deps };
}

const parcelaCa = (p: Record<string, unknown> = {}) => ({
  id: "P1", versao: 3, status: "PENDENTE", valor_pago: 0, nao_pago: 100, data_vencimento: "2026-09-10", descricao: `Parcela 1/3 ${marcadorDe(BOLETO)}`,
  nota: `Sra Luck ${marcadorDe(BOLETO)}`, valor_composicao: { valor_bruto: 100 }, baixas: [], evento: { id: "E1" }, ...p,
});
const vinculo = (p: Record<string, unknown> = {}) => ({
  id: "v1", boleto_id: BOLETO, cliente_id: CLIENTE, marcador: marcadorDe(BOLETO), estado: "vinculado", ca_parcela_id: "P1", ca_evento_id: "E1",
  ca_versao: 3, ca_snapshot: caAtual(parcelaCa()), sra_snapshot: { valor: 100, vencimento: "2026-09-10", status: "nao_pago", dataPagamento: null }, ca_baixa_id: null, baixa_origem: null, ...p,
});

describe("configuração e utilitários", () => {
  it("valida a configuração; ligar exige conta financeira", () => {
    expect(validarConfigContaAzul({ ativo: true })).toMatchObject({ ok: false });
    expect(validarConfigContaAzul({ contaFinanceiraId: "x" })).toMatchObject({ ok: false });
    expect(validarConfigContaAzul({ ativo: true, contaFinanceiraId: CONTA, metodoPagamento: "PIX_PAGAMENTO_INSTANTANEO" })).toMatchObject({ ok: true });
  });
  it("hora de Brasília sem fuso", () => {
    expect(horaSaoPaulo(new Date("2026-09-24T15:04:05Z"))).toBe("2026-09-24T12:04:05");
  });
});

describe("OAuth", () => {
  it("token válido não chama o provedor", async () => {
    const m = montar([]);
    expect(await tokenAtual(m.deps)).toBe("tok");
    expect(m.chamadas).toHaveLength(0);
  });
  it("token vencido renova com Basic e guarda o refresh novo (rotação)", async () => {
    const m = montar([["POST https://api-v2.contaazul.com/oauth/token", () => [200, { access_token: "tok2", refresh_token: "r2", expires_in: 3600 }]]]);
    m.cred.mapa.set("token_expires_at", "2026-09-24T15:01:00Z");
    expect(await tokenAtual(m.deps)).toBe("tok2");
    expect(m.chamadas[0].headers.Authorization).toBe(`Basic ${btoa("cid:csec")}`);
    expect(String(m.chamadas[0].corpo)).toContain("refresh_token=r1");
    expect(m.cred.mapa.get("refresh_token")).toBe("r2");
    expect(m.cred.mapa.get("token_expires_at")).toBe("2026-09-24T16:00:00.000Z");
  });
  it("acesso revogado explica o que fazer", async () => {
    const m = montar([["oauth/token", () => [400, { error: "invalid_grant", error_subtype: "access_revoked" }]]]);
    m.cred.mapa.set("token_expires_at", "2026-09-24T14:00:00Z");
    await expect(tokenAtual(m.deps)).rejects.toThrow(/revogado/);
  });
});

describe("criação e vínculo", () => {
  it("envia as parcelas em aberto (pessoa confirmada), localiza pelo marcador e vincula", async () => {
    const m = montar([
      ["POST https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/contas-a-receber", () => [202, { protocolo: "PROT", status: "PENDING" }]],
      ["contas-a-receber/buscar", () => [200, { itens: [{ id: "P1", descricao: `Parcela 1/3 · Ana · ${marcadorDe(BOLETO)}` }] }]],
      ["GET https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/P1", () => [200, parcelaCa()]],
    ], { cliente_vinculos_externos: [{ provedor: "conta_azul", cliente_id: CLIENTE, id_externo: "PESSOA", estado: "vinculado" }] });
    const r = await enviarParcelasCliente(env, CLIENTE, "col-1", m.deps);
    expect(r).toMatchObject({ ok: true, enfileiradas: 1 });
    const post = m.chamadas.find((c) => c.metodo === "POST" && c.url.endsWith("contas-a-receber"))!;
    expect(post.corpo.descricao).toContain(marcadorDe(BOLETO));
    expect(post.corpo.condicao_pagamento.parcelas[0]).toMatchObject({ nota: `Sra Luck ${marcadorDe(BOLETO)}`, data_vencimento: "2026-09-10", detalhe_valor: { valor_bruto: 100 } });
    expect(m.tabela("conta_azul_vinculos")[0]).toMatchObject({ estado: "aguardando_protocolo", protocolo: "PROT", ca_contato_id: "PESSOA" });
    // O localizar foi agendado para depois; roda a fila "mais tarde".
    m.tabela("integracao_fila").forEach((o) => { o.proxima_tentativa_em = AGORA.toISOString(); });
    await processarFila(env, m.deps);
    expect(m.tabela("conta_azul_vinculos")[0]).toMatchObject({ estado: "vinculado", ca_parcela_id: "P1", ca_evento_id: "E1", ca_versao: 3 });
  });

  it("sem pessoa confirmada pelo CPF não cria nada (nem procura por conta própria)", async () => {
    const m = montar([["/v1/pessoas?", () => [200, { itens: [{ id: "PESSOA", documento: "12345678909" }] }]]]);
    expect(await enviarParcelasCliente(env, CLIENTE, "col-1", m.deps)).toMatchObject({ ok: false, status: 409 });
    expect(m.tabela("conta_azul_vinculos")).toHaveLength(0);
    expect(m.chamadas).toHaveLength(0);
  });

  it("falha de rede no envio não reenvia: procura pelo marcador", async () => {
    let posts = 0;
    const m = montar([
      ["POST https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/contas-a-receber", () => { posts++; return [503, {}]; }],
      ["contas-a-receber/buscar", () => [200, { itens: [] }]],
    ], { cliente_vinculos_externos: [{ provedor: "conta_azul", cliente_id: CLIENTE, id_externo: "PESSOA", estado: "vinculado" }] });
    await enviarParcelasCliente(env, CLIENTE, "col-1", m.deps);
    m.tabela("integracao_fila").forEach((o) => { o.proxima_tentativa_em = AGORA.toISOString(); });
    await processarFila(env, m.deps);
    expect(posts).toBe(1);
    expect(m.tabela("conta_azul_vinculos")[0].estado).toBe("enviando");
    expect(m.tabela("integracao_fila").find((o) => o.operacao === "localizar")).toMatchObject({ estado: "pendente", tentativas: 1 });
  });

});

describe("Sra Luck → Conta Azul", () => {
  it("valor alterado no Sra Luck vai para a Conta Azul com a versão atual", async () => {
    const m = montar([
      ["GET https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/P1", () => [200, parcelaCa()]],
      ["PATCH https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/P1", () => [200, { versao: 4 }]],
    ], { conta_azul_vinculos: [vinculo()] });
    m.tabela("boletos")[0].valor = 120;
    expect(await detectarMudancasSra(env, m.deps)).toMatchObject({ enfileiradas: 1 });
    await processarFila(env, m.deps);
    const patch = m.chamadas.find((c) => c.metodo === "PATCH")!;
    expect(patch.corpo).toMatchObject({ versao: 3, vencimento: "2026-09-10", composicao_valor: { valor_bruto: 120 } });
    expect(m.tabela("conta_azul_vinculos")[0]).toMatchObject({ ca_versao: 4, sra_snapshot: { valor: 120 } });
    // Repetir não reenvia.
    expect(await detectarMudancasSra(env, m.deps)).toMatchObject({ enfileiradas: 0 });
  });

  it("alterada também na Conta Azul: conflito, nada enviado", async () => {
    const m = montar([["parcelas/P1", () => [200, parcelaCa({ valor_composicao: { valor_bruto: 95 }, versao: 5 })]]], { conta_azul_vinculos: [vinculo()] });
    m.tabela("boletos")[0].valor = 120;
    await detectarMudancasSra(env, m.deps);
    await processarFila(env, m.deps);
    expect(m.chamadas.some((c) => c.metodo === "PATCH")).toBe(false);
    expect(m.tabela("integracao_conflitos")[0]).toMatchObject({ tipo: "alterada_nos_dois_lados" });
    expect(m.tabela("conta_azul_vinculos")[0].estado).toBe("conflito");
  });

  it("baixa no Sra Luck: envia a composição registrada (principal + juros + multa), confere relendo, uma vez só", async () => {
    let gravada: any = null;
    const m = montar([
      ["GET https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/P1", () => [200, gravada ? parcelaCa({ status: "QUITADO", valor_pago: 130, nao_pago: 0, baixas: [gravada] }) : parcelaCa()]],
      ["POST https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/P1/baixa", (c) => { gravada = { id: "BX1", data_pagamento: c.corpo.data_pagamento, observacao: c.corpo.observacao, metodo_pagamento: c.corpo.metodo_pagamento, valor_composicao: c.corpo.composicao_valor }; return [200, { id: "BX1", versao: 1 }]; }],
    ], {
      conta_azul_vinculos: [vinculo()],
      financeiro_recebimentos: [{ boleto_id: BOLETO, valor_original: 100, juros: 20, multa: 10, desconto: 0, forma_pagamento: "pix", data_pagamento: "2026-09-20", origem: "manual", status_validacao: "validado" }],
    });
    Object.assign(m.tabela("boletos")[0], { status: "pago", data_pagamento: "2026-09-20" });
    await detectarMudancasSra(env, m.deps);
    await processarFila(env, m.deps);
    const baixa = m.chamadas.find((c) => c.url.endsWith("/baixa"))!;
    expect(baixa.corpo).toMatchObject({ data_pagamento: "2026-09-20", conta_financeira: CONTA, metodo_pagamento: "PIX_PAGAMENTO_INSTANTANEO", composicao_valor: { valor_bruto: 100, juros: 20, multa: 10, desconto: 0 } });
    expect(baixa.corpo.observacao).toContain(marcadorDe(BOLETO));
    expect(m.tabela("conta_azul_vinculos")[0]).toMatchObject({ ca_baixa_id: "BX1", baixa_origem: "sra" });
    expect(m.tabela("integracao_conflitos")).toHaveLength(0);
    expect(m.tabela("logs_alteracoes").find((l) => l.acao === "enviou_baixa_conta_azul")?.detalhes).toMatchObject({ conferidaNaContaAzul: true, statusDepois: "QUITADO" });
    expect(await detectarMudancasSra(env, m.deps)).toMatchObject({ enfileiradas: 0 });
  });

  it("baixa aceita (2xx) mas diferente na releitura: conflito, não sucesso", async () => {
    let gravada: any = null;
    const m = montar([
      ["GET https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/P1", () => [200, gravada ? parcelaCa({ status: "QUITADO", baixas: [gravada] }) : parcelaCa()]],
      ["POST https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/P1/baixa", (c) => { gravada = { id: "BX1", data_pagamento: c.corpo.data_pagamento, observacao: c.corpo.observacao, valor_composicao: { valor_bruto: 100, juros: 0, multa: 0 } }; return [200, { id: "BX1" }]; }],
    ], {
      conta_azul_vinculos: [vinculo()],
      financeiro_recebimentos: [{ boleto_id: BOLETO, valor_original: 100, juros: 20, multa: 10, desconto: 0, forma_pagamento: "pix", data_pagamento: "2026-09-20", origem: "manual", status_validacao: "validado" }],
    });
    Object.assign(m.tabela("boletos")[0], { status: "pago", data_pagamento: "2026-09-20" });
    await detectarMudancasSra(env, m.deps);
    await processarFila(env, m.deps);
    expect(m.tabela("integracao_conflitos")[0]).toMatchObject({ tipo: "baixa_divergente_apos_envio" });
  });

  it("Conta Azul fora do ar: o pagamento local continua válido, a baixa fica pendente e o retry não duplica", async () => {
    let fora = true, posts = 0, gravada: any = null;
    const m = montar([
      ["GET https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/P1", () => fora ? [503, {}] : [200, gravada ? parcelaCa({ status: "QUITADO", baixas: [gravada] }) : parcelaCa()]],
      ["POST https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/P1/baixa", (c) => { posts++; gravada = { id: "BX1", data_pagamento: c.corpo.data_pagamento, observacao: c.corpo.observacao, valor_composicao: c.corpo.composicao_valor }; return [200, { id: "BX1" }]; }],
    ], { conta_azul_vinculos: [vinculo()] });
    Object.assign(m.tabela("boletos")[0], { status: "pago", data_pagamento: "2026-09-20" });
    await detectarMudancasSra(env, m.deps);
    await processarFila(env, m.deps);
    expect(m.tabela("boletos")[0].status).toBe("pago");
    expect(m.tabela("integracao_fila")[0]).toMatchObject({ operacao: "registrar_baixa", estado: "pendente", tentativas: 1 });
    // Nova detecção não enfileira de novo (chave de idempotência).
    expect(await detectarMudancasSra(env, m.deps)).toMatchObject({ enfileiradas: 0 });
    fora = false;
    m.tabela("integracao_fila").forEach((o) => { o.proxima_tentativa_em = AGORA.toISOString(); });
    await processarFila(env, m.deps);
    expect(posts).toBe(1);
    expect(m.tabela("integracao_fila")[0].estado).toBe("concluida");
    // Mais uma rodada: nada novo.
    await detectarMudancasSra(env, m.deps);
    await processarFila(env, m.deps);
    expect(posts).toBe(1);
  });

  it("baixa já criada numa tentativa anterior (marcador) não duplica", async () => {
    const m = montar([["GET https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/P1", () => [200, parcelaCa({ status: "QUITADO", baixas: [{ id: "BX0", observacao: `Sra Luck ${marcadorDe(BOLETO)} baixa` }] })]]], { conta_azul_vinculos: [vinculo()] });
    Object.assign(m.tabela("boletos")[0], { status: "pago", data_pagamento: "2026-09-20" });
    await detectarMudancasSra(env, m.deps);
    await processarFila(env, m.deps);
    expect(m.chamadas.some((c) => c.metodo === "POST")).toBe(false);
    expect(m.tabela("conta_azul_vinculos")[0]).toMatchObject({ ca_baixa_id: "BX0", baixa_origem: "sra" });
  });

  it("estorno: apaga só a baixa que o Sra Luck criou", async () => {
    const m = montar([
      ["DELETE https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/baixa/BX1", () => [200, null]],
      ["GET https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/P1", () => [200, parcelaCa()]],
    ], { conta_azul_vinculos: [vinculo({ ca_baixa_id: "BX1", baixa_origem: "sra", sra_snapshot: { valor: 100, vencimento: "2026-09-10", status: "pago", dataPagamento: "2026-09-20" } })] });
    await detectarMudancasSra(env, m.deps);
    await processarFila(env, m.deps);
    expect(m.chamadas.some((c) => c.metodo === "DELETE")).toBe(true);
    expect(m.tabela("conta_azul_vinculos")[0]).toMatchObject({ ca_baixa_id: null, baixa_origem: null });
  });

  it("estorno de baixa que veio da Conta Azul vira conflito", async () => {
    const m = montar([], { conta_azul_vinculos: [vinculo({ ca_baixa_id: "BXCA", baixa_origem: "conta_azul", sra_snapshot: { valor: 100, vencimento: "2026-09-10", status: "pago", dataPagamento: "2026-09-20" } })] });
    await detectarMudancasSra(env, m.deps);
    await processarFila(env, m.deps);
    expect(m.chamadas.some((c) => c.metodo === "DELETE")).toBe(false);
    expect(m.tabela("integracao_conflitos")[0]).toMatchObject({ tipo: "estorno_de_baixa_externa" });
  });
});

describe("Conta Azul → Sra Luck", () => {
  const quitadaCa = (p: Record<string, unknown> = {}) => parcelaCa({ status: "QUITADO", valor_pago: 106, nao_pago: 0, baixas: [{ id: "BXCA", data_pagamento: "2026-09-18", metodo_pagamento: "PIX_PAGAMENTO_INSTANTANEO", valor_composicao: { valor_bruto: 100, juros: 4, multa: 2, desconto: 0 } }], ...p });
  let m: ReturnType<typeof montar>;
  beforeEach(() => { m = montar([], { conta_azul_vinculos: [vinculo()] }); });

  it("baixa segura é aplicada no Sra Luck (e no app) sem voltar para a Conta Azul", async () => {
    const v = m.tabela("conta_azul_vinculos")[0], b = m.tabela("boletos")[0];
    expect(await avaliarParcelaCa(env, m.deps, v, b, quitadaCa())).toBe("baixa_aplicada");
    expect(m.tabela("boletos")[0]).toMatchObject({ status: "pago", data_pagamento: "2026-09-18" });
    // Entra no ledger com a composição das baixas, origem conta_azul e chave pelo ID da baixa.
    expect(m.tabela("financeiro_recebimentos")[0]).toMatchObject({ origem: "conta_azul", valor_original: 100, juros: 4, multa: 2, desconto: 0, valor_recebido: 106, forma_pagamento: "pix", idempotency_key: "conta_azul:baixa:BXCA" });
    // Ler a mesma alteração de novo não duplica.
    expect(await avaliarParcelaCa(env, m.deps, m.tabela("conta_azul_vinculos")[0], m.tabela("boletos")[0], quitadaCa())).toBe("sem_mudanca");
    expect(m.tabela("financeiro_recebimentos")).toHaveLength(1);
    expect(m.tabela("conta_azul_vinculos")[0]).toMatchObject({ baixa_origem: "conta_azul", ca_baixa_id: "BXCA" });
    expect(await detectarMudancasSra(env, m.deps)).toMatchObject({ enfileiradas: 0 });
  });

  it("valor diferente: conflito e parcela intocada", async () => {
    const v = m.tabela("conta_azul_vinculos")[0], b = m.tabela("boletos")[0];
    expect(await avaliarParcelaCa(env, m.deps, v, b, quitadaCa({ valor_composicao: { valor_bruto: 80 } }))).toBe("conflito");
    expect(m.tabela("boletos")[0].status).toBe("nao_pago");
    expect(m.tabela("integracao_conflitos")[0]).toMatchObject({ tipo: "baixa_na_conta_azul" });
  });

  it("baixa automática desligada ou parcela rejeitada: não aplica", () => {
    const ca = caAtual(quitadaCa());
    expect(vinculoSeguroParaBaixa(vinculo(), { valor: 100, status: "nao_pago" }, ca, cfg({ baixaAutomatica: false }))).toContain("Baixa automática desligada na configuração.");
    expect(vinculoSeguroParaBaixa(vinculo(), { valor: 100, status: "rejeitado" }, ca, cfg()).join(" ")).toMatch(/rejeitado/);
  });

  it("cancelada, renegociada ou recebida parcialmente na Conta Azul: conflito", async () => {
    const b = m.tabela("boletos")[0];
    await avaliarParcelaCa(env, m.deps, m.tabela("conta_azul_vinculos")[0], b, parcelaCa({ status: "CANCELADO" }));
    expect(m.tabela("integracao_conflitos").map((c) => c.tipo)).toContain("ca_cancelado");
    const m2 = montar([], { conta_azul_vinculos: [vinculo()] });
    await avaliarParcelaCa(env, m2.deps, m2.tabela("conta_azul_vinculos")[0], m2.tabela("boletos")[0], parcelaCa({ status: "RECEBIDO_PARCIAL", valor_pago: 40, nao_pago: 60 }));
    expect(m2.tabela("integracao_conflitos")[0].tipo).toBe("recebido_parcial");
    expect(m2.tabela("boletos")[0].status).toBe("nao_pago");
  });

  it("baixa removida na Conta Azul com parcela paga no Sra Luck: conflito, sem estorno automático", async () => {
    const m3 = montar([], { conta_azul_vinculos: [vinculo({ ca_snapshot: caAtual(quitadaCa()), baixa_origem: "conta_azul", ca_baixa_id: "BXCA" })] });
    Object.assign(m3.tabela("boletos")[0], { status: "pago", data_pagamento: "2026-09-18" });
    await avaliarParcelaCa(env, m3.deps, m3.tabela("conta_azul_vinculos")[0], m3.tabela("boletos")[0], parcelaCa());
    expect(m3.tabela("boletos")[0].status).toBe("pago");
    expect(m3.tabela("integracao_conflitos")[0].tipo).toBe("baixa_removida_na_conta_azul");
  });

  it("vencimento mudado na Conta Azul: conflito; resolver com 'aplicar Sra Luck' força o envio", async () => {
    await avaliarParcelaCa(env, m.deps, m.tabela("conta_azul_vinculos")[0], m.tabela("boletos")[0], parcelaCa({ data_vencimento: "2026-09-30", versao: 4 }));
    const conflito = m.tabela("integracao_conflitos")[0];
    expect(conflito.tipo).toBe("alterada_na_conta_azul");
    expect(await resolverConflito(env, conflito.id, "aplicar_sra", "col-1", "Sra Luck manda", m.deps)).toMatchObject({ ok: true });
    expect(m.tabela("integracao_fila")[0]).toMatchObject({ operacao: "atualizar_parcela", payload: { forcar: true } });
    expect(m.tabela("integracao_conflitos")[0]).toMatchObject({ estado: "resolvido", resolucao: "aplicar_sra" });
    expect(m.tabela("conta_azul_vinculos")[0].estado).toBe("vinculado");
  });

  it("polling em /alteracoes aplica a baixa e avança o cursor", async () => {
    const m4 = montar([
      ["eventos-financeiros/alteracoes?", (c) => { expect(c.url).toContain("data_fim=2026-09-24T12%3A00%3A00"); return [200, { itens_totais: 1, itens: [{ id: "E1" }] }]; }],
      ["GET https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/E1/parcelas", () => [200, [quitadaCa()]]],
      ["GET https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/P1", () => [200, quitadaCa()]],
    ], { conta_azul_vinculos: [vinculo()] });
    const r = await lerMudancasContaAzul(env, m4.deps, Date.now() + 10_000);
    expect(r).toMatchObject({ eventos: 1, baixasAplicadas: 1 });
    expect(m4.tabela("boletos")[0].status).toBe("pago");
    expect(m4.tabela("integracao_cursores")[0]).toMatchObject({ provedor: "conta_azul", nome: "alteracoes", valor: AGORA.toISOString() });
  });
});
