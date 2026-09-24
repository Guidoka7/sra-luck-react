import { describe, expect, it, vi } from "vitest";
import {
  agruparCandidatos, aprovarLote, cancelarLote, contextoMensagem, dataBrasilia, detalharLote, editarItem, emHorarioSilencioso, explicarLote, fatosDoLote, validarResumoLote,
  gerarMensagens, lerConfigCentral, prepararLote, processarFila, reprocessarFalhas, segmentoDe, validarAlteracaoConfig,
  validarMensagemFinanceira, type BoletoFonte, type Contexto, type EnviarNotificacao,
} from "./notificacoes-lotes";
import type { Env } from "./supabase";

// ---------------------------------------------------------------------------
// Banco falso mínimo (mesma API encadeada do supabase-js usada pelo módulo).
// ---------------------------------------------------------------------------
type Linha = Record<string, any>;

function bancoFalso(inicial: Record<string, Linha[]> = {}) {
  const tabelas: Record<string, Linha[]> = JSON.parse(JSON.stringify(inicial));
  let seq = 0;
  const novoId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  function from(nome: string) {
    tabelas[nome] ??= [];
    const st: { op: string; linhas?: Linha[]; patch?: Linha; filtros: ((l: Linha) => boolean)[]; ordem?: [string, boolean]; limite: number; conflito?: string } = { op: "select", filtros: [], limite: Infinity };
    const executar = async () => {
      const tabela = tabelas[nome];
      if (st.op === "insert") {
        const novas = st.linhas!.map((l) => ({ id: novoId(), created_at: new Date().toISOString(), ...l }));
        tabela.push(...novas);
        return { data: novas, error: null };
      }
      if (st.op === "upsert") {
        const chave = st.conflito!;
        for (const l of st.linhas!) {
          const existente = tabela.find((x) => x[chave] === l[chave]);
          if (existente) Object.assign(existente, l); else tabela.push({ id: novoId(), ...l });
        }
        return { data: st.linhas, error: null };
      }
      let lista = tabela.filter((l) => st.filtros.every((f) => f(l)));
      if (st.op === "update") lista.forEach((l) => Object.assign(l, st.patch));
      if (st.ordem) { const [c, asc] = st.ordem; lista = [...lista].sort((a, b) => (a[c] < b[c] ? -1 : 1) * (asc ? 1 : -1)); }
      return { data: lista.slice(0, st.limite).map((l) => ({ ...l })), error: null };
    };
    const q: any = {
      select: () => q,
      insert: (l: Linha | Linha[]) => { st.op = "insert"; st.linhas = Array.isArray(l) ? l : [l]; return q; },
      update: (p: Linha) => { st.op = "update"; st.patch = p; return q; },
      upsert: (l: Linha, o: { onConflict: string }) => { st.op = "upsert"; st.linhas = [l]; st.conflito = o.onConflict; return q; },
      eq: (c: string, v: unknown) => { st.filtros.push((l) => l[c] === v); return q; },
      neq: (c: string, v: unknown) => { st.filtros.push((l) => l[c] !== v); return q; },
      in: (c: string, vs: unknown[]) => { st.filtros.push((l) => vs.includes(l[c])); return q; },
      gte: (c: string, v: any) => { st.filtros.push((l) => l[c] >= v); return q; },
      lte: (c: string, v: any) => { st.filtros.push((l) => l[c] <= v); return q; },
      lt: (c: string, v: any) => { st.filtros.push((l) => l[c] < v); return q; },
      order: (c: string, o: { ascending: boolean }) => { st.ordem = [c, o.ascending]; return q; },
      limit: (n: number) => { st.limite = n; return q; },
      maybeSingle: async () => { const r = await executar(); return { data: r.data?.[0] ?? null, error: null }; },
      single: async () => { const r = await executar(); return r.data?.length ? { data: r.data[0], error: null } : { data: null, error: { code: "PGRST116" } }; },
      then: (ok: any, erro: any) => executar().then(ok, erro),
    };
    return q;
  }
  return { db: { from } as any, tabelas };
}

// Quarta, 23/09/2026 às 10:00 em Brasília (13:00 UTC).
const AGORA = new Date("2026-09-23T13:00:00Z");
const HOJE = "2026-09-23";
const env = { GEMINI_API_KEY: "chave-teste" } as Env;

const CLIENTES = [
  { id: "c-ana", nome_completo: "ANA MARIA SOUZA", cpf: "123.456.789-09", ativo: true },
  { id: "c-bia", nome_completo: "Beatriz Lima", cpf: "987.654.321-00", ativo: true },
  { id: "c-cris", nome_completo: "Cristina Alves", cpf: "111.222.333-44", ativo: true },
];

const CONTRATO: Record<string, { status_contrato: string; ativo: boolean }> = {
  "c-ana": { status_contrato: "ativo", ativo: true }, "c-bia": { status_contrato: "ativo", ativo: true }, "c-cris": { status_contrato: "ativo", ativo: true },
};
/** Linha de boleto como a consulta real devolve (status "nao_pago" + cliente embutida). */
const bol = (id: string, cliente: string, venc: string, valor: number, status = "nao_pago", extra: Record<string, unknown> = {}): BoletoFonte =>
  ({ id, cliente_id: cliente, data_vencimento: venc, valor, status, numero_parcela: 1, total_parcelas: 10, suspensa: false, clientes: CONTRATO[cliente] ?? { status_contrato: "ativo", ativo: true }, ...extra } as BoletoFonte);

/** Gemini falso: responde uma mensagem válida por item, usando só os dados recebidos. */
function geminiFalso(opcoes: { falhar?: number; corpo?: (itens: any[]) => unknown } = {}) {
  const chamadas: { sistema: string; usuario: string }[] = [];
  const fetcher = (async (_url: string, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body ?? "{}"));
    const usuario = req.contents[0].parts[0].text as string;
    chamadas.push({ sistema: req.systemInstruction.parts[0].text, usuario });
    if (opcoes.falhar) return new Response("{}", { status: opcoes.falhar });
    const itens = JSON.parse(usuario.slice(usuario.indexOf("["))) as any[];
    const corpo = opcoes.corpo ? opcoes.corpo(itens) : {
      mensagens: itens.map((it) => ({ i: it.i, texto: `Oi, ${it.primeiroNome}! Passando para lembrar ${it.quantidadeParcelas > 1 ? `das suas ${it.quantidadeParcelas} parcelas, total de ${it.valorTotal}` : `da parcela de ${it.parcelas[0].valor} com vencimento em ${it.parcelas[0].vencimento}`}. Se já pagou, envie o comprovante pelo app. 💗` })),
    };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(corpo) }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetcher, chamadas };
}

function envioFalso(falharPara: string[] = [], pushStatus = "enviada") {
  const enviados: { clienteId: string; mensagem: string; tipo: string }[] = [];
  const enviar: EnviarNotificacao = vi.fn(async (_env, _db, input) => {
    if (falharPara.includes(input.clienteId)) throw new Error("push indisponível");
    enviados.push({ clienteId: input.clienteId, mensagem: input.mensagem, tipo: input.tipo });
    return { notificacao: { id: `n-${input.clienteId}` }, pushStatus };
  });
  return { enviar, enviados };
}

function cenario(boletos: BoletoFonte[], extra: Record<string, Linha[]> = {}, silencio: [string, string] = ["22:00", "07:00"]) {
  const { db, tabelas } = bancoFalso({
    boletos, clientes: CLIENTES, notificacao_logs: [], logs_alteracoes: [], notificacao_lotes: [], notificacao_lote_itens: [],
    notificacoes_config: [{ chave: "central_silencio_inicio", valor: silencio[0] }, { chave: "central_silencio_fim", valor: silencio[1] }],
    ...extra,
  });
  const gemini = geminiFalso();
  const envio = envioFalso();
  const ctx: Contexto = { env, db, ator: "dev-console:user-1", agora: AGORA, fetcher: gemini.fetcher, enviar: envio.enviar };
  return { db, tabelas, ctx, gemini, envio };
}

async function loteAprovavel(c: ReturnType<typeof cenario>) {
  const p = await prepararLote(c.ctx);
  if (!p.ok) throw new Error(p.erro);
  const g = await gerarMensagens(c.ctx, p.loteId);
  if (!g.ok) throw new Error(g.erro);
  return p.loteId;
}

// ---------------------------------------------------------------------------

describe("régua e agrupamento", () => {
  it("3 parcelas abertas da mesma cliente viram 1 candidata com o total real", () => {
    const [c, ...resto] = agruparCandidatos([
      bol("b1", "c-ana", "2026-08-15", 150), bol("b2", "c-ana", "2026-09-15", 150), bol("b3", "c-ana", "2026-09-24", 150.5),
    ], HOJE);
    expect(resto).toHaveLength(0);
    expect(c).toMatchObject({ clienteId: "c-ana", quantidade: 3, valorTotal: 450.5, maiorAtraso: 39, menorAtraso: -1 });
  });

  it("faixas da régua pelo atraso da parcela mais antiga", () => {
    expect([-1, 0, 1, 2, 5, 6, 10, 11, 30, 31, -2].map(segmentoDe)).toEqual([
      "vence_amanha", "vence_hoje", "atraso_1", "atraso_2_5", "atraso_2_5", "atraso_6_10", "atraso_6_10", "atraso_11_30", "atraso_11_30", null, null,
    ]);
  });

  it("parcela paga ou com comprovante em conferência nunca entra na cobrança", () => {
    const r = agruparCandidatos([bol("b1", "c-ana", "2026-09-20", 100, "pago"), bol("b2", "c-ana", "2026-09-21", 100, "pendente_confirmacao"), bol("b3", "c-bia", "2026-09-30", 100)], HOJE);
    expect(r).toHaveLength(0);
  });

  it("data de referência no fuso de Brasília (22h de Brasília ainda é hoje)", () => {
    expect(dataBrasilia(new Date("2026-09-24T01:00:00Z"))).toBe("2026-09-23");
  });

  it("horário silencioso atravessando a meia-noite", () => {
    expect(emHorarioSilencioso("23:30", "21:00", "08:00")).toBe(true);
    expect(emHorarioSilencioso("07:59", "21:00", "08:00")).toBe(true);
    expect(emHorarioSilencioso("08:00", "21:00", "08:00")).toBe(false);
    expect(emHorarioSilencioso("12:00", "13:00", "14:00")).toBe(false);
    expect(emHorarioSilencioso("12:00", "10:00", "10:00")).toBe(false);
  });
});

describe("validador: o Gemini não inventa dado financeiro", () => {
  const ctx = contextoMensagem({ segmento: "atraso_6_10", parcelas: [{ boletoId: "b1", vencimento: "2026-09-15", valor: 150, diasAtraso: 8, numero: 1, total: 10 }], valor_total: 150, maior_atraso: 8 }, "Ana");
  it("aceita valor, data e dias que existem no contexto", () => {
    expect(validarMensagemFinanceira("Oi, Ana! Sua parcela de R$ 150,00 de 15/09 está em aberto há 8 dias. Se já pagou, envie o comprovante no app.", ctx).ok).toBe(true);
  });
  it.each([
    ["valor_inventado", "Oi, Ana! Sua parcela de R$ 180,00 está em aberto. Confira no app, por favor."],
    ["data_inventada", "Oi, Ana! Sua parcela de 20/09 está em aberto. Confira no app, por favor."],
    ["dias_inventados", "Oi, Ana! Sua parcela está em aberto há 12 dias. Confira no app, por favor."],
    ["quantidade_inventada", "Oi, Ana! Você tem 3 parcelas em aberto. Confira no app, por favor."],
    ["tom_de_cobranca", "Ana, evite juros e multa: regularize sua parcela hoje pelo app."],
    ["documento", "Ana (CPF 123.456.789-09), sua parcela está em aberto no app."],
  ])("recusa %s", (motivo, texto) => {
    expect(validarMensagemFinanceira(texto, ctx)).toEqual({ ok: false, motivo });
  });
});

describe("lote financeiro", () => {
  const boletos = [
    bol("b1", "c-ana", "2026-08-30", 150), bol("b2", "c-ana", "2026-09-10", 150), bol("b3", "c-ana", "2026-09-15", 150),
    bol("b4", "c-bia", "2026-09-24", 320),
  ];

  it("preparar é dry run: agrupa, grava o lote e não envia nada", async () => {
    const c = cenario(boletos);
    const p = await prepararLote(c.ctx);
    expect(p.ok).toBe(true);
    expect(c.tabelas.notificacao_lote_itens).toHaveLength(2);
    expect(c.tabelas.notificacao_lote_itens.find((i) => i.cliente_id === "c-ana")).toMatchObject({ quantidade_parcelas: 3, valor_total: 450, segmento: "atraso_11_30", status: "PREPARED" });
    expect(c.envio.enviar).not.toHaveBeenCalled();
    expect(c.tabelas.logs_alteracoes.map((l) => l.acao)).toContain("preparou_lote_notificacoes");
  });

  it("duas clientes geram duas mensagens distintas, com os dados persistidos", async () => {
    const c = cenario(boletos);
    const id = await loteAprovavel(c);
    const itens = c.tabelas.notificacao_lote_itens.filter((i) => i.lote_id === id);
    expect(itens.map((i) => i.status)).toEqual(["AWAITING_APPROVAL", "AWAITING_APPROVAL"]);
    expect(new Set(itens.map((i) => i.mensagem)).size).toBe(2);
    expect(itens.find((i) => i.cliente_id === "c-ana")!.mensagem).toContain("R$ 450,00");
    expect(c.gemini.chamadas[0].usuario).toContain("R$ 320,00");
    expect(c.gemini.chamadas[0].usuario).toContain("24/09/2026");
  });

  it("o Gemini não recebe CPF, sobrenome nem id da cliente", async () => {
    const c = cenario(boletos);
    await loteAprovavel(c);
    const enviado = c.gemini.chamadas.map((x) => x.usuario).join("\n");
    expect(enviado).toContain("Ana");
    for (const proibido of ["123.456.789-09", "987.654.321-00", "SOUZA", "Lima", "c-ana", "c-bia"]) expect(enviado).not.toContain(proibido);
  });

  it("Gemini indisponível: lote AI_GENERATION_FAILED, sem mensagem e sem envio", async () => {
    const c = cenario(boletos);
    c.ctx.fetcher = geminiFalso({ falhar: 503 }).fetcher;
    const p = await prepararLote(c.ctx);
    const g = await gerarMensagens(c.ctx, (p as any).loteId);
    expect(g).toMatchObject({ ok: true, status: "AI_GENERATION_FAILED", geradas: 0 });
    expect(c.tabelas.notificacao_lote_itens.every((i) => i.mensagem == null && String(i.motivo).startsWith("ia_falhou"))).toBe(true);
    expect((await aprovarLote(c.ctx, (p as any).loteId)).ok).toBe(false);
    expect(c.envio.enviar).not.toHaveBeenCalled();
  });

  it("mensagem do Gemini com valor inventado é reprovada, não vira texto genérico", async () => {
    const c = cenario(boletos);
    c.ctx.fetcher = geminiFalso({ corpo: (itens) => ({ mensagens: itens.map((it) => ({ i: it.i, texto: `Oi, ${it.primeiroNome}! Sua parcela de R$ 999,00 está em aberto no app.` })) }) }).fetcher;
    const p = await prepararLote(c.ctx);
    const g = await gerarMensagens(c.ctx, (p as any).loteId);
    expect(g).toMatchObject({ status: "AI_GENERATION_FAILED", reprovadas: 2 });
    expect(c.tabelas.notificacao_lote_itens.every((i) => i.motivo === "ia_reprovada:valor_inventado" && i.mensagem == null)).toBe(true);
  });

  it("sem chave do Gemini: nada é gerado e o motivo é real", async () => {
    const c = cenario(boletos);
    c.ctx.env = {} as Env;
    const p = await prepararLote(c.ctx);
    expect(await gerarMensagens(c.ctx, (p as any).loteId)).toMatchObject({ ok: false, codigo: "sem_chave" });
    expect(c.tabelas.notificacao_lotes[0].status).toBe("AI_GENERATION_FAILED");
  });

  it("lote aguardando aprovação não envia; aprovado envia só as elegíveis", async () => {
    const c = cenario([...boletos, bol("b5", "c-cris", "2026-07-01", 90)]);
    const id = await loteAprovavel(c);
    expect(c.envio.enviar).not.toHaveBeenCalled();
    const itemCris = c.tabelas.notificacao_lote_itens.find((i) => i.cliente_id === "c-cris")!;
    expect(itemCris).toMatchObject({ status: "SKIPPED_RULE", motivo: "atraso_acima_de_30_dias" });
    const r = await aprovarLote(c.ctx, id);
    expect(r).toMatchObject({ ok: true, status: "COMPLETED", contagem: { aceitas: 2 } });
    expect(c.envio.enviados.map((e) => e.clienteId).sort()).toEqual(["c-ana", "c-bia"]);
    expect(c.envio.enviados.find((e) => e.clienteId === "c-bia")!.tipo).toBe("parcela_vencer");
  });

  it("PROVIDER_ACCEPTED não vira OPENED; cliente sem aparelho fica IN_APP_ONLY", async () => {
    const c = cenario(boletos);
    c.ctx.enviar = vi.fn(async (_e, _d, input) => ({ notificacao: { id: `n-${input.clienteId}` }, pushStatus: input.clienteId === "c-bia" ? "sem_dispositivo" : "enviada" }));
    const id = await loteAprovavel(c);
    await aprovarLote(c.ctx, id);
    const status = Object.fromEntries(c.tabelas.notificacao_lote_itens.map((i) => [i.cliente_id, i.status]));
    expect(status).toEqual({ "c-ana": "PROVIDER_ACCEPTED", "c-bia": "IN_APP_ONLY" });
  });

  it("falha de uma cliente não cancela o lote; reprocessar pega só as falhas", async () => {
    const c = cenario(boletos);
    const envio = envioFalso(["c-bia"]);
    c.ctx.enviar = envio.enviar;
    const id = await loteAprovavel(c);
    expect(await aprovarLote(c.ctx, id)).toMatchObject({ contagem: { aceitas: 1, falhas: 1 } });
    expect(c.tabelas.notificacao_lotes[0].status).toBe("COMPLETED");

    const segunda = envioFalso();
    c.ctx.enviar = segunda.enviar;
    expect(await reprocessarFalhas(c.ctx, id)).toMatchObject({ ok: true, contagem: { aceitas: 1 } });
    expect(segunda.enviados.map((e) => e.clienteId)).toEqual(["c-bia"]);
    expect(c.tabelas.notificacao_lote_itens.every((i) => i.status === "PROVIDER_ACCEPTED")).toBe(true);
  });

  it("aprovar duas vezes não envia duas vezes", async () => {
    const c = cenario(boletos);
    const id = await loteAprovavel(c);
    await aprovarLote(c.ctx, id);
    expect(await aprovarLote(c.ctx, id)).toMatchObject({ ok: false, codigo: "lote_nao_aguarda_aprovacao" });
    expect(c.envio.enviar).toHaveBeenCalledTimes(2);
  });

  it("mesma elegibilidade da rotina automática: parcela suspensa, contrato cancelado e cliente inativa ficam de fora, com motivo", async () => {
    const c = cenario([
      bol("b1", "c-ana", "2026-09-15", 150, "nao_pago", { suspensa: true }),
      bol("b2", "c-bia", "2026-09-15", 320, "nao_pago", { clientes: { status_contrato: "cancelado", ativo: true } }),
      bol("b3", "c-cris", "2026-09-15", 90, "nao_pago", { clientes: { status_contrato: "ativo", ativo: false } }),
    ]);
    await prepararLote(c.ctx);
    const motivos = Object.fromEntries(c.tabelas.notificacao_lote_itens.map((i) => [i.cliente_id, [i.status, i.motivo]]));
    expect(motivos).toEqual({
      "c-ana": ["SKIPPED_RULE", "parcela_suspensa"],
      "c-bia": ["SKIPPED_RULE", "contrato_cancelado_ou_suspenso"],
      "c-cris": ["SKIPPED_RULE", "cliente_inativa"],
    });
  });

  it("contrato suspenso também fica de fora (mesma regra da rotina automática)", async () => {
    const c = cenario([bol("b1", "c-ana", "2026-09-15", 150, "nao_pago", { clientes: { status_contrato: "suspenso", ativo: true } })]);
    await prepararLote(c.ctx);
    expect(c.tabelas.notificacao_lote_itens[0]).toMatchObject({ status: "SKIPPED_RULE", motivo: "contrato_cancelado_ou_suspenso" });
  });

  it("cliente deduplicada (lembrete nas últimas 24h) não recebe de novo", async () => {
    const c = cenario(boletos, { notificacao_logs: [{ cliente_id: "c-ana", tipo: "parcela_atrasada", created_at: new Date(AGORA.getTime() - 3_600_000).toISOString() }] });
    const id = await loteAprovavel(c);
    expect(c.tabelas.notificacao_lote_itens.find((i) => i.cliente_id === "c-ana")).toMatchObject({ status: "SKIPPED_DEDUPLICATION", motivo: "lembrete_nas_ultimas_24h" });
    await aprovarLote(c.ctx, id);
    expect(c.envio.enviados.map((e) => e.clienteId)).toEqual(["c-bia"]);
  });

  it("parcela paga entre a preparação e o envio: não manda mensagem desatualizada", async () => {
    const c = cenario(boletos);
    const id = await loteAprovavel(c);
    c.tabelas.boletos.find((b) => b.id === "b4")!.status = "pendente_confirmacao";
    await aprovarLote(c.ctx, id);
    expect(c.tabelas.notificacao_lote_itens.find((i) => i.cliente_id === "c-bia")).toMatchObject({ status: "SKIPPED_RULE", motivo: "parcelas_mudaram_antes_do_envio" });
    expect(c.envio.enviados.map((e) => e.clienteId)).toEqual(["c-ana"]);
  });

  it("horário silencioso segura o envio; a fila libera depois", async () => {
    const c = cenario(boletos, {}, ["09:00", "11:00"]);
    const id = await loteAprovavel(c);
    expect(await aprovarLote(c.ctx, id)).toMatchObject({ ok: true, status: "QUEUED_FOR_ALLOWED_WINDOW" });
    expect(c.envio.enviar).not.toHaveBeenCalled();
    expect(await processarFila(c.ctx)).toMatchObject({ processados: 0, motivo: "horario_silencioso" });
    c.ctx.agora = new Date("2026-09-23T14:30:00Z"); // 11:30 em Brasília
    expect(await processarFila(c.ctx)).toMatchObject({ processados: 1 });
    expect(c.envio.enviados).toHaveLength(2);
  });

  it("auditoria registra preparação, geração, aprovação e resultado", async () => {
    const c = cenario(boletos);
    const id = await loteAprovavel(c);
    await aprovarLote(c.ctx, id);
    const acoes = c.tabelas.logs_alteracoes.map((l) => l.acao);
    expect(acoes).toEqual(["preparou_lote_notificacoes", "gerou_mensagens_lote", "aprovou_lote_notificacoes", "processou_lote_notificacoes"]);
    expect(c.tabelas.logs_alteracoes.every((l) => l.usuario === "dev-console:user-1")).toBe(true);
    expect(c.tabelas.notificacao_lotes[0]).toMatchObject({ aprovado_por: "dev-console:user-1", prompt_version: "financeiro-v1" });
    expect(JSON.stringify(c.tabelas.logs_alteracoes)).not.toContain("R$");
  });

  it("edição humana passa pelo mesmo validador", async () => {
    const c = cenario(boletos);
    const id = await loteAprovavel(c);
    const item = c.tabelas.notificacao_lote_itens.find((i) => i.cliente_id === "c-bia")!;
    expect(await editarItem(c.ctx, id, item.id, "Beatriz, sua parcela de R$ 500,00 vence amanhã.")).toMatchObject({ ok: false, codigo: "valor_inventado" });
    expect(await editarItem(c.ctx, id, item.id, "Beatriz, sua parcela de R$ 320,00 vence amanhã. Qualquer dúvida, fale com a gente pelo app.")).toMatchObject({ ok: true, status: "AWAITING_APPROVAL" });
    expect(c.tabelas.notificacao_lote_itens.find((i) => i.id === item.id)!.editada_por).toBe("dev-console:user-1");
  });

  it("não abre um segundo lote enquanto houver um em aberto; cancelar libera", async () => {
    const c = cenario(boletos);
    const p1 = await prepararLote(c.ctx);
    expect(await prepararLote(c.ctx)).toMatchObject({ ok: true, existente: true, loteId: (p1 as any).loteId });
    expect(await cancelarLote(c.ctx, (p1 as any).loteId)).toMatchObject({ ok: true });
    expect(await prepararLote(c.ctx)).toMatchObject({ ok: true, existente: false });
  });

  it("relatório conta por status, faixa e clientes com 2+ parcelas", async () => {
    const c = cenario(boletos);
    const id = await loteAprovavel(c);
    await aprovarLote(c.ctx, id);
    const d = await detalharLote(c.db, id);
    expect(d!.contagem).toMatchObject({ total: 2, elegiveis: 2, multiplasParcelas: 1, porStatus: { PROVIDER_ACCEPTED: 2 }, porSegmento: { atraso_11_30: 1, vence_amanha: 1 } });
    expect(d!.itens.map((i) => i.nome).sort()).toEqual(["ANA MARIA SOUZA", "Beatriz Lima"]);
  });
});

describe("configuração da central", () => {
  it("padrão: desligada, aprovação obrigatória, 24h de deduplicação", () => {
    expect(lerConfigCentral([])).toMatchObject({ ativa: false, aprovacaoObrigatoria: true, janelaDedupHoras: 24, silencioInicio: "21:00", silencioFim: "08:00" });
  });
  it("aceita só chaves e valores conhecidos", () => {
    expect(validarAlteracaoConfig({ ativa: true, janelaDedupHoras: 48 })).toMatchObject({ ok: true });
    expect(validarAlteracaoConfig({ ativa: "sim" })).toMatchObject({ ok: false });
    expect(validarAlteracaoConfig({ janelaDedupHoras: 0 })).toMatchObject({ ok: false });
    expect(validarAlteracaoConfig({ segmentos: ["atraso_90"] })).toMatchObject({ ok: false });
    expect(validarAlteracaoConfig({ outra: 1 })).toMatchObject({ ok: false });
  });
});

describe("Explicar este lote (Gemini resume só os dados persistidos)", () => {
  const boletos = [
    bol("b1", "c-ana", "2026-08-30", 150), bol("b2", "c-ana", "2026-09-10", 150),
    bol("b4", "c-bia", "2026-09-24", 320),
  ];
  const resumoFalso = (texto: string) => (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ texto }) }] } }] }), { status: 200 })) as unknown as typeof fetch;

  it("fatos vêm só dos itens gravados", async () => {
    const c = cenario(boletos, { notificacao_logs: [{ cliente_id: "c-bia", tipo: "parcela_vencer", created_at: new Date(AGORA.getTime() - 3_600_000).toISOString() }] });
    const id = await loteAprovavel(c);
    await aprovarLote(c.ctx, id);
    const d = await detalharLote(c.db, id);
    expect(fatosDoLote(d!.lote as { status: string }, d!.itens)).toMatchObject({ clientesAnalisadas: 2, elegiveis: 1, comMaisDeUmaParcela: 1, aceitasPeloProvedor: 1, deduplicadas: 1, motivos: { lembrete_nas_ultimas_24h: 1 } });
  });

  it("aceita resumo que só cita números do lote", async () => {
    const c = cenario(boletos);
    const id = await loteAprovavel(c);
    await aprovarLote(c.ctx, id);
    c.ctx.fetcher = resumoFalso("Foram analisadas 2 clientes. 1 tinha mais de uma parcela e recebeu uma mensagem só. As 2 foram aceitas pelo serviço de push.");
    expect(await explicarLote(c.ctx, id)).toMatchObject({ ok: true, fatos: { clientesAnalisadas: 2 } });
  });

  it("descarta resumo com número inventado e devolve os fatos reais", async () => {
    const c = cenario(boletos);
    const id = await loteAprovavel(c);
    c.ctx.fetcher = resumoFalso("Foram analisadas 15 clientes e 4 receberam mensagem consolidada.");
    const r = await explicarLote(c.ctx, id);
    expect(r).toMatchObject({ ok: false, codigo: "resumo_reprovado:numero_inventado", fatos: { clientesAnalisadas: 2 } });
  });

  it("sem chave do Gemini: não inventa resumo, devolve só os fatos", async () => {
    const c = cenario(boletos);
    const id = await loteAprovavel(c);
    c.ctx.env = {} as Env;
    expect(await explicarLote(c.ctx, id)).toMatchObject({ ok: false, codigo: "sem_chave", fatos: { elegiveis: 2 } });
  });

  it("validarResumoLote aceita horas citadas no motivo de deduplicação", () => {
    const fatos = fatosDoLote({ status: "COMPLETED" }, [{ status: "SKIPPED_DEDUPLICATION", segmento: "atraso_1", quantidade_parcelas: 1, motivo: "lembrete_nas_ultimas_24h" }]);
    expect(validarResumoLote("1 cliente já tinha recebido lembrete nas últimas 24 horas.", fatos).ok).toBe(true);
  });
});
