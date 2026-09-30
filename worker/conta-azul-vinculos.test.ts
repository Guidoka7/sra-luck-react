import { afterEach, describe, expect, it, vi } from "vitest";
import { bancoFalso } from "./banco-falso.testutil";
import { caAtual, caRequest, detectarMudancasSra, marcadorDe, processarFila, type Deps } from "./conta-azul";
import {
  buscarPessoasPorCpf, conciliar, confirmarVinculos, desconectar, importarFinanceiro, previaImportacao, statusCentral, vincularPessoa,
  type BoletoConc, type Lancamento,
} from "./conta-azul-vinculos";
import { PADRAO_CONEXAO_CONTA_AZUL, PADRAO_CONTA_AZUL, validarConfigConexaoContaAzul } from "./integracoes-registro";
import type { Env } from "./supabase";

const env = {} as Env;
const CONTA = "11111111-2222-4333-8444-555555555555";
const CLIENTE = "c0000000-0000-4000-8000-000000000001";
const B1 = "b0000000-0000-4000-8000-000000000001";
const B2 = "b0000000-0000-4000-8000-000000000002";
const AGORA = new Date("2026-09-30T15:00:00Z");
const API = "https://api-v2.contaazul.com";

type Chamada = { metodo: string; url: string; corpo: any; headers: Record<string, string> };

function montar(rotas: [string, (c: Chamada) => [number, unknown]][], tabelas: Record<string, any[]> = {}) {
  const rpcArgs: Record<string, any[]> = {};
  const banco = bancoFalso({
    clientes: [{ id: CLIENTE, nome_completo: "Ana Souza", cpf: "123.456.789-09" }],
    boletos: [],
    ...tabelas,
  }, {
    conta_azul_importar_financeiro: (a: any) => { (rpcArgs.importar ??= []).push(a); return { parcelas: a.p_parcelas.length, pagas: a.p_parcelas.filter((p: any) => p.pago).length }; },
  });
  const chamadas: Chamada[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const c: Chamada = { metodo: init.method ?? "GET", url: String(url), corpo: typeof init.body === "string" ? JSON.parse(init.body) : init.body, headers: (init.headers ?? {}) as Record<string, string> };
    chamadas.push(c);
    const rota = rotas.find(([chave]) => `${c.metodo} ${c.url}`.includes(chave));
    const [status, corpo] = rota ? rota[1](c) : [404, { message: "sem rota" }];
    return new Response(corpo == null ? null : JSON.stringify(corpo), { status, headers: status === 429 ? { "Retry-After": "7" } : {} });
  }) as unknown as typeof fetch;
  const mapa = new Map(Object.entries({ access_token: "tok-secreto", token_expires_at: "2026-09-30T16:00:00Z", refresh_token: "refresh-secreto", client_id: "cid", client_secret: "csec-secreto" }));
  const removidas: string[] = [];
  const deps = {
    db: banco.db, fetch: f, agora: () => AGORA, config: { ...PADRAO_CONTA_AZUL, contaFinanceiraId: CONTA }, conexao: PADRAO_CONEXAO_CONTA_AZUL,
    credenciais: { obter: async (k: string) => mapa.get(k) ?? null, salvar: async (k: string, v: string) => { mapa.set(k, v); }, remover: async (ks: string[]) => { ks.forEach((k) => { mapa.delete(k); removidas.push(k); }); } },
  } as Deps;
  return { ...banco, chamadas, deps, mapa, removidas, rpcArgs };
}

const pessoaAtiva = { id: "pv1", provedor: "conta_azul", cliente_id: CLIENTE, id_externo: "PESSOA", documento: "12345678909", nome_externo: "Ana Souza", estado: "vinculado" };
const boleto = (id: string, numero: number, p: Record<string, unknown> = {}) => ({ id, cliente_id: CLIENTE, numero_parcela: numero, total_parcelas: 2, valor: 500, data_vencimento: "2026-10-15", status: "nao_pago", data_pagamento: null, ...p });
const parcelaCa = (id: string, p: Record<string, unknown> = {}) => ({ id, versao: 2, status: "PENDENTE", valor_pago: 0, nao_pago: 500, data_vencimento: "2026-10-15", descricao: "Mensalidade", nota: "", valor_composicao: { valor_bruto: 500 }, baixas: [], anexos: [], evento: { id: "EV1" }, ...p });
const buscar = (itens: unknown[]) => ["contas-a-receber/buscar", () => [200, { itens_totais: itens.length, itens }]] as [string, (c: Chamada) => [number, unknown]];

describe("pessoa pelo CPF", () => {
  it("só documento idêntico é candidato; mostra se já está vinculada a outra cliente", async () => {
    const m = montar([["/v1/pessoas?", (c) => { expect(c.url).toContain("documentos=12345678909"); return [200, { itens: [
      { id: "PESSOA", nome: "Ana Souza", documento: "123.456.789-09", email: "ana@x.com", tipo_pessoa: "Física" },
      { id: "OUTRA", nome: "Ana S.", documento: "123.456.789-00" },
    ] }]; }]], { cliente_vinculos_externos: [{ ...pessoaAtiva, cliente_id: "outra-cliente" }] });
    const r = await buscarPessoasPorCpf(m.deps, CLIENTE);
    expect(r).toMatchObject({ ok: true, situacao: "encontrada" });
    if (!r.ok) return;
    expect(r.pessoas).toHaveLength(1);
    expect(r.pessoas[0]).toMatchObject({ id: "PESSOA", documento: "12345678909", vinculadaA: { clienteId: "outra-cliente" } });
  });

  it("mais de uma pessoa com o mesmo CPF: pede escolha, nada é gravado", async () => {
    const m = montar([["/v1/pessoas?", () => [200, { itens: [{ id: "A", documento: "12345678909" }, { id: "B", documento: "12345678909" }] }]]]);
    expect(await buscarPessoasPorCpf(m.deps, CLIENTE)).toMatchObject({ ok: true, situacao: "mais_de_uma" });
    expect(m.tabela("cliente_vinculos_externos")).toHaveLength(0);
  });

  it("vincular relê a pessoa e exige o mesmo CPF", async () => {
    const errado = montar([["/v1/pessoas/PESSOA", () => [200, { id: "PESSOA", nome: "Outra", documento: "98765432100" }]]]);
    expect(await vincularPessoa(env, CLIENTE, "PESSOA", "col-1", errado.deps)).toMatchObject({ ok: false, status: 409 });
    expect(errado.tabela("cliente_vinculos_externos")).toHaveLength(0);
    const certo = montar([["/v1/pessoas/PESSOA", () => [200, { id: "PESSOA", nome: "Ana Souza", documento: "12345678909" }]]]);
    expect(await vincularPessoa(env, CLIENTE, "PESSOA", "col-1", certo.deps)).toMatchObject({ ok: true, jaVinculada: false });
    expect(certo.tabela("cliente_vinculos_externos")[0]).toMatchObject({ provedor: "conta_azul", cliente_id: CLIENTE, id_externo: "PESSOA", documento: "12345678909", confirmado_por: "col-1" });
  });
});

describe("conciliação (não grava nada)", () => {
  const b = (id: string, numero: number, valor: number, venc: string, status = "nao_pago"): BoletoConc => ({ id, numero, total: 4, valor, vencimento: venc, status, dataPagamento: null });
  const l = (id: string, valor: number, venc: string, status = "EM_ABERTO"): Lancamento => ({ id, eventoId: null, descricao: "", vencimento: venc, valor, pago: 0, naoPago: valor, status, quitado: status === "RECEBIDO" });
  it("separa correspondências, divergências, só no Sra Luck e só na Conta Azul", () => {
    const r = conciliar(
      [b("s1", 1, 500, "2026-09-15", "pago"), b("s2", 2, 500, "2026-10-15"), b("s3", 3, 500, "2026-11-15"), b("s4", 4, 999, "2027-06-01")],
      [{ boleto_id: "s1", ca_parcela_id: "c1", estado: "vinculado" }],
      [l("c1", 500, "2026-09-15", "RECEBIDO"), l("c2", 500, "2026-10-15"), l("c3", 500, "2026-11-20"), l("c9", 120, "2028-01-01")],
    );
    expect(r.vinculadas.map((x) => x.boleto.id)).toEqual(["s1"]);
    expect(r.correspondencias.map((x) => [x.boleto.id, x.lancamento.id])).toEqual([["s2", "c2"]]);
    expect(r.divergencias).toHaveLength(1);
    expect(r.divergencias[0]).toMatchObject({ boleto: { id: "s3" } });
    expect(r.divergencias[0].candidatos[0]).toMatchObject({ lancamento: { id: "c3" }, diferencas: { vencimento: true, valor: false, diasVencimento: 5 } });
    expect(r.somenteSra.map((x) => x.id)).toEqual(["s4"]);
    expect(r.somenteContaAzul.map((x) => x.id)).toEqual(["c3", "c9"]);
  });
  it("dois lançamentos idênticos para uma parcela: não sugere par automático", () => {
    const r = conciliar([b("s1", 1, 500, "2026-10-15")], [], [l("c1", 500, "2026-10-15"), l("c2", 500, "2026-10-15")]);
    expect(r.correspondencias).toHaveLength(0);
    expect(r.divergencias[0].candidatos).toHaveLength(2);
  });
});

describe("confirmar vínculo de parcela", () => {
  const rotas = (parcela: Record<string, unknown>) => [
    buscar([{ id: "CP8", data_vencimento: parcela.data_vencimento ?? "2026-10-20", total: 500, status: "EM_ABERTO" }]),
    ["GET https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/CP8", () => [200, parcelaCa("CP8", parcela)]],
  ] as [string, (c: Chamada) => [number, unknown]][];

  it("vencimento divergente: sem aceite não vincula; com aceite vincula, registra e não altera nenhum vencimento", async () => {
    const m = montar(rotas({ data_vencimento: "2026-10-20" }), { cliente_vinculos_externos: [pessoaAtiva], boletos: [boleto(B1, 8)] });
    const sem = await confirmarVinculos(env, CLIENTE, [{ boletoId: B1, caParcelaId: "CP8" }], "col-1", m.deps);
    expect(sem).toMatchObject({ vinculadas: 0, resultados: [{ ok: false, divergencias: ["vencimento"] }] });
    expect(m.tabela("conta_azul_vinculos")).toHaveLength(0);

    const com = await confirmarVinculos(env, CLIENTE, [{ boletoId: B1, caParcelaId: "CP8", aceitarDivergencias: true }], "col-1", m.deps);
    expect(com).toMatchObject({ vinculadas: 1 });
    const v = m.tabela("conta_azul_vinculos")[0];
    expect(v).toMatchObject({ estado: "vinculado", ca_parcela_id: "CP8", ca_contato_id: "PESSOA", origem_vinculo: "confirmado_manual", confirmado_por: "col-1", marcador: marcadorDe(B1) });
    expect(v.divergencias_aceitas[0]).toMatchObject({ campo: "vencimento", sraLuck: "2026-10-15", contaAzul: "2026-10-20" });
    expect(m.tabela("boletos")[0].data_vencimento).toBe("2026-10-15");
    // Nada vai para a Conta Azul só por causa da divergência aceita.
    expect(await detectarMudancasSra(env, m.deps)).toMatchObject({ enfileiradas: 0 });
    expect(m.chamadas.some((c) => c.metodo !== "GET")).toBe(false);
  });

  it("mudança de valor depois do vínculo não 'corrige' o vencimento aceito", async () => {
    const m = montar([
      ...rotas({ data_vencimento: "2026-10-20" }),
      ["PATCH https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/CP8", () => [200, { versao: 3 }]],
    ], { cliente_vinculos_externos: [pessoaAtiva], boletos: [boleto(B1, 8)] });
    await confirmarVinculos(env, CLIENTE, [{ boletoId: B1, caParcelaId: "CP8", aceitarDivergencias: true }], "col-1", m.deps);
    m.tabela("boletos")[0].valor = 520;
    await detectarMudancasSra(env, m.deps);
    await processarFila(env, m.deps);
    const patch = m.chamadas.find((c) => c.metodo === "PATCH")!;
    expect(patch.corpo).toMatchObject({ vencimento: "2026-10-20", composicao_valor: { valor_bruto: 520 } });
  });

  it("quitada só na Conta Azul: vincula e abre conflito; nada é baixado sozinho", async () => {
    const m = montar(rotas({ data_vencimento: "2026-10-15", status: "QUITADO", valor_pago: 500, nao_pago: 0, baixas: [{ id: "BX", data_pagamento: "2026-10-14", valor_composicao: { valor_bruto: 500 } }] }), { cliente_vinculos_externos: [pessoaAtiva], boletos: [boleto(B1, 8)] });
    expect(await confirmarVinculos(env, CLIENTE, [{ boletoId: B1, caParcelaId: "CP8" }], "col-1", m.deps)).toMatchObject({ vinculadas: 1, resultados: [{ conflito: "baixa_na_conta_azul" }] });
    expect(m.tabela("boletos")[0].status).toBe("nao_pago");
    expect(m.tabela("integracao_conflitos")[0]).toMatchObject({ tipo: "baixa_na_conta_azul", estado: "aberto" });
    expect(m.tabela("conta_azul_vinculos")[0].estado).toBe("conflito");
  });

  it("lançamento de outra pessoa não vincula", async () => {
    const m = montar([buscar([]), ["parcelas/CP8", () => [200, parcelaCa("CP8")]]], { cliente_vinculos_externos: [pessoaAtiva], boletos: [boleto(B1, 8)] });
    expect(await confirmarVinculos(env, CLIENTE, [{ boletoId: B1, caParcelaId: "CP8" }], "col-1", m.deps)).toMatchObject({ vinculadas: 0, resultados: [{ ok: false, erro: expect.stringMatching(/não pertence/) }] });
  });
});

describe("financeiro que nasce da Conta Azul", () => {
  const rotasImport = () => [
    buscar([{ id: "P1", data_vencimento: "2026-09-15" }, { id: "P2", data_vencimento: "2026-10-15" }, { id: "P3", data_vencimento: "2026-11-15" }]),
    ["parcelas/P1", () => [200, parcelaCa("P1", { data_vencimento: "2026-09-15", status: "QUITADO", valor_pago: 530, nao_pago: 0, baixas: [{ id: "BX1", data_pagamento: "2026-09-20", metodo_pagamento: "PIX_PAGAMENTO_INSTANTANEO", valor_composicao: { valor_bruto: 500, juros: 20, multa: 10, desconto: 0 } }] })]],
    ["parcelas/P2", () => [200, parcelaCa("P2", { data_vencimento: "2026-10-15" })]],
    ["parcelas/P3", () => [200, parcelaCa("P3", { data_vencimento: "2026-11-15", status: "CANCELADO" })]],
  ] as [string, (c: Chamada) => [number, unknown]][];

  it("prévia: pagas com a composição das baixas, abertas, e o que não entra com o motivo", async () => {
    const m = montar(rotasImport(), { cliente_vinculos_externos: [pessoaAtiva] });
    const r = await previaImportacao(m.deps, CLIENTE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parcelas.map((p) => [p.caParcelaId, p.pago])).toEqual([["P1", true], ["P2", false]]);
    expect(r.parcelas[0]).toMatchObject({ juros: 20, multa: 10, desconto: 0, forma: "pix", caBaixaId: "BX1", dataPagamento: "2026-09-20" });
    expect(r.naoImportadas).toEqual([expect.objectContaining({ caParcelaId: "P3", motivo: expect.stringMatching(/CANCELADO/) })]);
    expect(r.totais).toMatchObject({ parcelas: 2, pagas: 1, abertas: 1, recebido: 530 });
  });

  it("cliente que já tem financeiro não importa (nunca duplica)", async () => {
    const m = montar(rotasImport(), { cliente_vinculos_externos: [pessoaAtiva], boletos: [boleto(B1, 1)] });
    expect(await previaImportacao(m.deps, CLIENTE)).toMatchObject({ ok: false, status: 409 });
  });

  it("importa só o que foi conferido; se a Conta Azul mudou, pede nova conferência", async () => {
    const m = montar(rotasImport(), { cliente_vinculos_externos: [pessoaAtiva] });
    expect(await importarFinanceiro(env, CLIENTE, ["P1"], "col-1", m.deps)).toMatchObject({ ok: false, status: 409 });
    expect(m.rpcArgs.importar).toBeUndefined();
    expect(await importarFinanceiro(env, CLIENTE, ["P2", "P1"], "col-1", m.deps)).toMatchObject({ ok: true, resultado: { parcelas: 2, pagas: 1 } });
    expect(m.rpcArgs.importar[0]).toMatchObject({ p_cliente_id: CLIENTE, p_ca_pessoa_id: "PESSOA", p_usuario: "col-1" });
    expect(m.rpcArgs.importar[0].p_parcelas[0]).toMatchObject({ caParcelaId: "P1", pago: true, juros: 20, multa: 10, caBaixaId: "BX1", valor: 500 });
  });
});

describe("baixas sem loop", () => {
  it("pagamento que veio da Conta Azul não volta para a Conta Azul", async () => {
    const m = montar([["GET https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/P1", () => [200, parcelaCa("P1")]]], {
      boletos: [boleto(B1, 1, { status: "pago", data_pagamento: "2026-10-14" })],
      conta_azul_vinculos: [{ id: "v1", boleto_id: B1, cliente_id: CLIENTE, marcador: marcadorDe(B1), estado: "vinculado", ca_parcela_id: "P1", ca_evento_id: "EV1", ca_snapshot: caAtual(parcelaCa("P1")), sra_snapshot: { valor: 500, vencimento: "2026-10-15", status: "nao_pago", dataPagamento: null } }],
      financeiro_recebimentos: [{ boleto_id: B1, valor_original: 500, juros: 0, multa: 0, desconto: 0, origem: "conta_azul", status_validacao: "validado", data_pagamento: "2026-10-14" }],
    });
    await detectarMudancasSra(env, m.deps);
    await processarFila(env, m.deps);
    expect(m.chamadas.some((c) => c.metodo === "POST")).toBe(false);
    expect(m.tabela("conta_azul_vinculos")[0]).toMatchObject({ baixa_origem: "conta_azul" });
  });
});

describe("resiliência e central técnica", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("429 vira erro retentável com a espera informada", async () => {
    const m = montar([["/v1/pessoas/conta-conectada", () => [429, {}]]]);
    await expect(caRequest(m.deps, "GET", "/v1/pessoas/conta-conectada")).rejects.toMatchObject({ codigo: "limite", retentavel: true, status: 429, message: expect.stringMatching(/7 s/) });
  });

  it("provedor que não responde: timeout retentável (não trava o Financeiro)", async () => {
    vi.useFakeTimers();
    const m = montar([]);
    m.deps.fetch = ((_: string, init: RequestInit) => new Promise((_ok, erro) => init.signal?.addEventListener("abort", () => erro(Object.assign(new Error("abort"), { name: "AbortError" }))))) as unknown as typeof fetch;
    const p = caRequest(m.deps, "GET", "/v1/pessoas/conta-conectada");
    const verificacao = expect(p).rejects.toMatchObject({ codigo: "timeout", retentavel: true });
    await vi.advanceTimersByTimeAsync(15_001);
    await verificacao;
  });

  it("URLs só HTTPS em *.contaazul.com (o Client Secret vai na troca de token)", () => {
    expect(validarConfigConexaoContaAzul({ ambiente: "teste" })).toMatchObject({ ok: true, config: PADRAO_CONEXAO_CONTA_AZUL });
    expect(validarConfigConexaoContaAzul({ tokenUrl: "https://evil.example.com/oauth/token" })).toMatchObject({ ok: false });
    expect(validarConfigConexaoContaAzul({ tokenUrl: "http://api-v2.contaazul.com/oauth/token" })).toMatchObject({ ok: false });
    expect(validarConfigConexaoContaAzul({ apiBaseUrl: "https://contaazul.com.evil.io" })).toMatchObject({ ok: false });
    expect(validarConfigConexaoContaAzul({ ambiente: "sandbox" })).toMatchObject({ ok: false });
  });

  it("desconectar: revoga pelo id_empresa e apaga os tokens do cofre", async () => {
    const m = montar([
      ["GET https://api-v2.contaazul.com/v1/pessoas/conta-conectada", () => [200, { id_empresa: "EMP-9", razao_social: "Empresa Teste", documento: "12345678000199" }]],
      ["DELETE https://api-v2.contaazul.com/oauth/connections/EMP-9", () => [204, null]],
    ]);
    expect(await desconectar(m.deps, "dev-console:owner")).toMatchObject({ ok: true, revogadaNaContaAzul: true });
    expect(m.removidas.sort()).toEqual(["access_token", "refresh_token", "token_expires_at"]);
    expect(m.tabela("integracao_eventos")[0]).toMatchObject({ event_type: "desconectado", status: "processado" });
  });

  it("status da central nunca devolve segredo nem token", async () => {
    const m = montar([]);
    const r = await statusCentral(env, m.deps);
    expect(r).toMatchObject({ ambiente: "teste", configurado: true, conectado: true, token: { estado: "valido", renovacaoAutomatica: true }, webhooks: { disponivel: false }, anexos: { disponivel: false } });
    const texto = JSON.stringify(r);
    for (const segredo of ["tok-secreto", "refresh-secreto", "csec-secreto"]) expect(texto).not.toContain(segredo);
    expect(r.urls.apiBaseUrl).toBe(API);
  });
});
