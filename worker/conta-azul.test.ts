import { beforeEach, describe, expect, it } from "vitest";
import { bancoFalso } from "./banco-falso.testutil";
import {
  avaliarParcelaCa, caAtual, contaAzulBloqueadaNoAmbiente, horaSaoPaulo, lerMudancasContaAzul, marcadorDe, parcelaControladaPelaContaAzul, resolverConflito,
  sincronizarContaAzul, tokenAtual, vinculoSeguroParaBaixa, type Deps,
} from "./conta-azul";
import { PADRAO_CONTA_AZUL, validarConfigContaAzul, type ConfigContaAzul } from "./integracoes-registro";
import type { Env } from "./supabase";

const env = {} as Env;
const CONTA = "11111111-2222-4333-8444-555555555555";
const BOLETO = "b0000000-0000-4000-8000-000000000001";
const CLIENTE = "c0000000-0000-4000-8000-000000000001";
const cfg = (p: Partial<ConfigContaAzul> = {}): ConfigContaAzul => ({ ...PADRAO_CONTA_AZUL, ...p });

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
      if (!b || !["nao_pago", "pendente_confirmacao", "rejeitado"].includes(b.status)) throw new Error("Parcela nao esta em aberto");
      const rec = { boleto_id: b.id, valor_original: b.valor, juros: a.p_juros, multa: a.p_multa, desconto: a.p_desconto, valor_recebido: b.valor + a.p_juros + a.p_multa - a.p_desconto, forma_pagamento: a.p_forma_pagamento, origem: "conta_azul", status_validacao: "validado", external_payment_id: a.p_ca_baixa_id, external_reference: `conta_azul:evento:${a.p_ca_evento_id ?? "?"}`, comprovante_url: b.comprovante_url ?? null, idempotency_key: a.p_idempotency_key, data_pagamento: a.p_data_pagamento };
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
  it("configuração só de leitura; campos antigos de envio são ignorados, não recusados", () => {
    expect(validarConfigContaAzul({ ativo: true })).toMatchObject({ ok: true, config: { ativo: true, baixaAutomatica: true } });
    expect(validarConfigContaAzul({ ativo: true, contaFinanceiraId: CONTA, enviarBaixas: true, metodoPagamento: "PIX_PAGAMENTO_INSTANTANEO" })).toEqual({ ok: true, config: { ativo: true, baixaAutomatica: true } });
    expect(validarConfigContaAzul({ ativo: "sim" })).toMatchObject({ ok: false });
    expect(validarConfigContaAzul({ outroCampo: 1 })).toMatchObject({ ok: false });
  });
  it("Conta Azul desligada em Production sem autorização e em Preview sem banco de teste", () => {
    expect(contaAzulBloqueadaNoAmbiente({ VERCEL_ENV: "production" } as Env)).toBe(true);
    expect(contaAzulBloqueadaNoAmbiente({ VERCEL_ENV: "production", CONTA_AZUL_PRODUCAO_PERMITIDA: "1" } as Env)).toBe(false);
    expect(contaAzulBloqueadaNoAmbiente({ VERCEL_ENV: "preview" } as Env)).toBe(true);
    expect(contaAzulBloqueadaNoAmbiente({ VERCEL_ENV: "preview", CONTA_AZUL_PREVIEW_PERMITIDO: "1" } as Env)).toBe(false);
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
    // Nada é escrito na Conta Azul.
    expect(m.chamadas.every((c) => c.metodo === "GET")).toBe(true);
    // Ler a mesma alteração de novo não duplica.
    expect(await avaliarParcelaCa(env, m.deps, m.tabela("conta_azul_vinculos")[0], m.tabela("boletos")[0], quitadaCa())).toBe("sem_mudanca");
    expect(m.tabela("financeiro_recebimentos")).toHaveLength(1);
    expect(m.tabela("conta_azul_vinculos")[0]).toMatchObject({ baixa_origem: "conta_azul", ca_baixa_id: "BXCA" });
  });

  it("valor diferente: conflito e parcela intocada", async () => {
    const v = m.tabela("conta_azul_vinculos")[0], b = m.tabela("boletos")[0];
    expect(await avaliarParcelaCa(env, m.deps, v, b, quitadaCa({ valor_composicao: { valor_bruto: 80 } }))).toBe("conflito");
    expect(m.tabela("boletos")[0].status).toBe("nao_pago");
    expect(m.tabela("integracao_conflitos")[0]).toMatchObject({ tipo: "baixa_na_conta_azul" });
  });

  it("vínculo seguro: em aberto, em conferência ou com comprovante rejeitado aceitam a baixa; suspensa, já paga ou chave desligada não", () => {
    const ca = caAtual(quitadaCa());
    for (const status of ["nao_pago", "pendente_confirmacao", "rejeitado"]) expect(vinculoSeguroParaBaixa(vinculo(), { valor: 100, status }, ca, cfg())).toEqual([]);
    expect(vinculoSeguroParaBaixa(vinculo(), { valor: 100, status: "nao_pago", suspensa: true }, ca, cfg()).join(" ")).toMatch(/suspensa/);
    expect(vinculoSeguroParaBaixa(vinculo(), { valor: 100, status: "pago" }, ca, cfg()).join(" ")).toMatch(/pago/);
    expect(vinculoSeguroParaBaixa(vinculo(), { valor: 100, status: "nao_pago" }, ca, cfg({ baixaAutomatica: false }))).toContain("Baixa automática desligada na configuração.");
  });

  it("parcela em conferência (comprovante enviado) fecha como paga quando a Conta Azul confirma, preservando o comprovante", async () => {
    Object.assign(m.tabela("boletos")[0], { status: "pendente_confirmacao", comprovante_url: "cliente/c1/comp.pdf" });
    expect(await avaliarParcelaCa(env, m.deps, m.tabela("conta_azul_vinculos")[0], m.tabela("boletos")[0], quitadaCa())).toBe("baixa_aplicada");
    expect(m.tabela("boletos")[0]).toMatchObject({ status: "pago", comprovante_url: "cliente/c1/comp.pdf" });
    expect(m.tabela("financeiro_recebimentos")).toHaveLength(1);
    expect(m.tabela("integracao_conflitos")).toHaveLength(0);
  });

  it("paga só no Sra Luck: a revisão fecha sozinha quando a Conta Azul confirma, sem novo recebimento", async () => {
    Object.assign(m.tabela("boletos")[0], { status: "pago", data_pagamento: "2026-09-18" });
    m.tabela("integracao_conflitos").push({ id: "cf1", provedor: "conta_azul", referencia: BOLETO, vinculo_id: "v1", tipo: "paga_so_no_sra", estado: "aberto" });
    await avaliarParcelaCa(env, m.deps, m.tabela("conta_azul_vinculos")[0], m.tabela("boletos")[0], quitadaCa());
    expect(m.tabela("integracao_conflitos")[0]).toMatchObject({ estado: "resolvido", resolucao: "confirmado_na_conta_azul" });
    expect(m.tabela("financeiro_recebimentos")).toHaveLength(0);
  });

  it("parcela vinculada é reconhecida como controlada pela Conta Azul; desvinculada ou sem estrutura, não", async () => {
    expect(await parcelaControladaPelaContaAzul(m.db, BOLETO)).toBe(true);
    m.tabela("conta_azul_vinculos")[0].estado = "desvinculado";
    expect(await parcelaControladaPelaContaAzul(m.db, BOLETO)).toBe(false);
    expect(await parcelaControladaPelaContaAzul({ from: () => { throw new Error("sem tabela"); } } as never, BOLETO)).toBe(false);
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

  it("vencimento mudado na Conta Azul: revisão; 'manter' fecha sem enviar nada", async () => {
    await avaliarParcelaCa(env, m.deps, m.tabela("conta_azul_vinculos")[0], m.tabela("boletos")[0], parcelaCa({ data_vencimento: "2026-09-30", versao: 4 }));
    const conflito = m.tabela("integracao_conflitos")[0];
    expect(conflito.tipo).toBe("alterada_na_conta_azul");
    expect(await resolverConflito(env, conflito.id, "manter", "col-1", "ok", m.deps)).toMatchObject({ ok: true });
    expect(m.tabela("integracao_conflitos")[0]).toMatchObject({ estado: "descartado", resolucao: "manter" });
    expect(m.tabela("integracao_fila")).toHaveLength(0);
    expect(m.chamadas.some((c) => c.metodo !== "GET")).toBe(false);
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

  it("sincronização completa: só GET na Conta Azul, aplica a baixa uma vez e registra a origem", async () => {
    const m5 = montar([
      ["eventos-financeiros/alteracoes?", () => [200, { itens_totais: 1, itens: [{ id: "E1" }] }]],
      ["GET https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/E1/parcelas", () => [200, [quitadaCa()]]],
      ["GET https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/P1", () => [200, quitadaCa()]],
    ], { conta_azul_vinculos: [vinculo()] });
    const r1 = await sincronizarContaAzul(env, { origem: "manual", ator: "dev-console:owner" }, m5.deps);
    const r2 = await sincronizarContaAzul(env, { origem: "manual", ator: "dev-console:owner" }, m5.deps);
    expect(r1).toMatchObject({ executada: true, status: "processado", leitura: { baixasAplicadas: 1 } });
    expect(r2).toMatchObject({ executada: true, leitura: { baixasAplicadas: 0 } });
    expect(m5.tabela("financeiro_recebimentos")).toHaveLength(1);
    expect(m5.tabela("financeiro_recebimentos")[0]).toMatchObject({ origem: "conta_azul", external_payment_id: "BXCA" });
    expect(m5.chamadas.every((c) => c.metodo === "GET")).toBe(true);
  });
});
