import { describe, expect, it } from "vitest";
import { ErroGemini, descobrirModelos, gerarComGemini, gerarMensagemDoDia, montarPrompt, ordenarModelos, rotinaAutorizada, validarFraseIa } from "./frase-do-dia";
import { fraseDoDia } from "../src/lib/fraseDoDia";
import type { Env } from "./supabase";

type Linha = Record<string, unknown> & { data: string };

/** Banco falso mínimo para a tabela mensagens_do_dia (chave primária = data). */
function bancoFalso(inicial: Linha[] = []) {
  const linhas = new Map(inicial.map((l) => [l.data, { ...l }]));
  function consulta() {
    const filtros: ((l: Linha) => boolean)[] = [];
    let ordem: { campo: string; asc: boolean } | null = null;
    let limite = Infinity;
    let patch: Record<string, unknown> | null = null;
    const resultado = () => {
      let lista = [...linhas.values()].filter((l) => filtros.every((f) => f(l)));
      if (patch) lista.forEach((l) => Object.assign(l, patch));
      if (ordem) { const { campo, asc } = ordem; lista = lista.sort((a, b) => (String(a[campo]) < String(b[campo]) ? -1 : 1) * (asc ? 1 : -1)); }
      return lista.slice(0, limite).map((l) => ({ ...l }));
    };
    const q = {
      select: () => q,
      update: (p: Record<string, unknown>) => { patch = p; return q; },
      eq: (c: string, v: unknown) => { filtros.push((l) => l[c] === v); return q; },
      neq: (c: string, v: unknown) => { filtros.push((l) => l[c] !== v); return q; },
      lt: (c: string, v: unknown) => { filtros.push((l) => String(l[c]) < String(v)); return q; },
      order: (campo: string, o: { ascending: boolean }) => { ordem = { campo, asc: o.ascending }; return q; },
      limit: (n: number) => { limite = n; return q; },
      maybeSingle: async () => ({ data: resultado()[0] ?? null, error: null }),
      then: (ok: (v: { data: Linha[]; error: null }) => unknown) => Promise.resolve({ data: resultado(), error: null }).then(ok),
    };
    return q;
  }
  const db = {
    from: () => ({
      insert: async (l: Linha) => {
        if (linhas.has(l.data)) return { error: { code: "23505" } };
        linhas.set(l.data, { ...l, updated_at: new Date().toISOString() });
        return { error: null };
      },
      select: () => consulta(),
      update: (p: Record<string, unknown>) => consulta().update(p),
    }),
  };
  return { db: db as never, linhas };
}

const HOJE = new Date("2026-09-23T15:00:00Z"); // quarta-feira em Brasília
const DATA = "2026-09-23";
const env = (extra: Partial<Env> = {}) => ({ GEMINI_API_KEY: "chave-teste", ...extra }) as Env;

function geminiFalso(respostas: (string | number)[]) {
  const chamadas: string[] = [];
  const fetcher = (async (url: string) => {
    chamadas.push(url);
    if (url.includes("/models?")) return new Response(JSON.stringify({ models: [] }), { status: 200 });
    const r = respostas.shift() ?? 500;
    if (typeof r === "number") return new Response("{}", { status: r });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ texto: r }) }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetcher, chamadas };
}

describe("mensagem do dia (uma por data, igual para todas as clientes)", () => {
  it("sem mensagem de hoje: chama o Gemini uma vez e salva com a data", async () => {
    const { db, linhas } = bancoFalso();
    const { fetcher, chamadas } = geminiFalso(["Planejar com calma é *cuidar de você* todos os dias. ✨"]);
    const r = await gerarMensagemDoDia(env(), HOJE, { db, fetcher });
    expect(r).toMatchObject({ data: DATA, origem: "ia", reutilizada: false, chamouGemini: true });
    expect(chamadas).toHaveLength(1);
    expect(linhas.get(DATA)).toMatchObject({ status: "pronta", texto: "Planejar com calma é *cuidar de você* todos os dias. ✨", origem: "ia", tema: "Quarta de foco" });
  });

  it("rotina repetida no mesmo dia reutiliza a mensagem e NÃO chama o Gemini", async () => {
    const { db } = bancoFalso([{ data: DATA, status: "pronta", texto: "Já salva *para hoje* com carinho.", tema: "Quarta de foco", origem: "ia", updated_at: HOJE.toISOString() }]);
    const { fetcher, chamadas } = geminiFalso(["Outra *mensagem* qualquer para hoje."]);
    const r = await gerarMensagemDoDia(env(), HOJE, { db, fetcher });
    expect(r).toMatchObject({ texto: "Já salva *para hoje* com carinho.", reutilizada: true, chamouGemini: false });
    expect(chamadas).toHaveLength(0);
  });

  it("outra execução gerando agora: não chama o Gemini de novo", async () => {
    const { db } = bancoFalso([{ data: DATA, status: "gerando", updated_at: new Date().toISOString() }]);
    const { fetcher, chamadas } = geminiFalso([]);
    const r = await gerarMensagemDoDia(env(), HOJE, { db, fetcher });
    expect(r).toMatchObject({ reutilizada: true, chamouGemini: false, motivo: "geracao_em_andamento" });
    expect(chamadas).toHaveLength(0);
  });

  it("Gemini falhando: salva a frase de reserva do catálogo", async () => {
    const { db, linhas } = bancoFalso();
    const { fetcher } = geminiFalso([503, 503, 503]);
    const r = await gerarMensagemDoDia(env(), HOJE, { db, fetcher });
    expect(r).toMatchObject({ origem: "catalogo", texto: fraseDoDia(HOJE).texto, chamouGemini: true });
    expect(linhas.get(DATA)).toMatchObject({ status: "pronta", origem: "catalogo" });
  });

  it("sem chave: não chama nada e salva a reserva", async () => {
    const { db } = bancoFalso();
    const { fetcher, chamadas } = geminiFalso([]);
    const r = await gerarMensagemDoDia({} as Env, HOJE, { db, fetcher });
    expect(r).toMatchObject({ origem: "catalogo", chamouGemini: false, motivo: "sem_chave" });
    expect(chamadas).toHaveLength(0);
  });

  it("reserva igual à de ontem: usa a última mensagem válida diferente", async () => {
    const reserva = fraseDoDia(HOJE).texto;
    const { db } = bancoFalso([
      { data: "2026-09-22", status: "pronta", texto: reserva, tema: "x", origem: "catalogo" },
      { data: "2026-09-21", status: "pronta", texto: "Mensagem válida *de segunda* aqui.", tema: "x", origem: "ia" },
    ]);
    const r = await gerarMensagemDoDia({} as Env, HOJE, { db });
    expect(r).toMatchObject({ origem: "ultima_valida", texto: "Mensagem válida *de segunda* aqui." });
  });

  it("texto do Gemini igual ao de ontem é reprovado (sem repetição em dias seguidos)", async () => {
    const ontem = "Constância é o *seu melhor caminho* hoje.";
    const { db } = bancoFalso([{ data: "2026-09-22", status: "pronta", texto: ontem, tema: "x", origem: "ia" }]);
    const { fetcher } = geminiFalso([ontem]);
    const r = await gerarMensagemDoDia(env(), HOJE, { db, fetcher });
    expect(r.origem).toBe("catalogo");
    expect(r.motivo).toBe("reprovada:repetida");
  });
});

describe("guardrails e prompt", () => {
  it("aceita até 1 emoji e reprova o que foge das regras", () => {
    expect(validarFraseIa("Seu plano segue *firme e leve* hoje. 💖")).toMatchObject({ ok: true });
    expect(validarFraseIa("Seu plano segue *firme e leve* hoje. 💖✨")).toMatchObject({ ok: false, motivo: "emoji" });
    expect(validarFraseIa("Curta *demais*.")).toMatchObject({ ok: false, motivo: "tamanho" });
    expect(validarFraseIa("Uma frase sem nenhum destaque marcado aqui.")).toMatchObject({ ok: false, motivo: "destaque" });
    expect(validarFraseIa("Seu corpo *perfeito* está chegando, confie no plano.")).toMatchObject({ ok: false, motivo: "termo_proibido" });
    expect(validarFraseIa("Olá {nome}, o seu sonho *está perto* de você.")).toMatchObject({ ok: false, motivo: "caractere" });
    expect(validarFraseIa("Disciplina hoje, *resultados sempre*.")).toMatchObject({ ok: false, motivo: "repetida" });
  });

  it("prompt não leva dado de cliente e aceita instruções por variável de ambiente", () => {
    const { sistema, usuario } = montarPrompt(HOJE, fraseDoDia(HOJE), ["Mensagem *de ontem* aqui."], "INSTRUÇÕES DO AMBIENTE");
    expect(sistema.startsWith("INSTRUÇÕES DO AMBIENTE")).toBe(true);
    expect(usuario).toContain("Quarta de foco");
    expect(usuario).toContain("Mensagem *de ontem*");
    expect(`${sistema}${usuario}`).not.toMatch(/cpf|nascimento|parcela paga|procedimento|\{nome\}/i);
  });
});

describe("chamada ao Gemini", () => {
  it("usa o modelo configurado com uma única chamada quando dá certo", async () => {
    const { fetcher, chamadas } = geminiFalso(["Seu caminho *segue firme* hoje."]);
    const r = await gerarComGemini("k", "gemini-3.5-flash-lite", "s", "u", fetcher);
    expect(r.modelo).toBe("gemini-3.5-flash-lite");
    expect(chamadas).toHaveLength(1);
  });

  it("modelo aposentado (404): descobre os disponíveis e tenta o próximo", async () => {
    const chamadas: string[] = [];
    const fetcher = (async (url: string) => {
      chamadas.push(url);
      if (url.includes("/models?")) return new Response(JSON.stringify({ models: [{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] }] }), { status: 200 });
      if (url.includes("velho")) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{\"texto\": \"ok *deu certo* aqui\"}" }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await gerarComGemini("k", "gemini-velho", "s", "u", fetcher);
    expect(r.modelo).toBe("gemini-3.8-flash");
    expect(chamadas.filter((u) => u.includes(":generateContent"))).toHaveLength(2);
  });

  it("chave recusada para na hora", async () => {
    let chamadas = 0;
    const fetcher = (async () => { chamadas += 1; return new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 }); }) as unknown as typeof fetch;
    const erro = await gerarComGemini("k", "a", "s", "u", fetcher).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroGemini);
    expect((erro as ErroGemini).message).toBe("http_400");
    expect(chamadas).toBe(1);
  });

  it("ordena e descobre só modelos de texto flash", async () => {
    expect(ordenarModelos(["models/gemini-2.5-flash", "models/gemini-3.8-flash", "models/gemini-3.5-flash-lite", "models/gemini-3-flash-latest", "models/gemini-3-flash-preview", "models/gemini-3.8-flash-tts", "models/gemini-2.5-pro"]))
      .toEqual(["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-3-flash-latest", "gemini-3-flash-preview"]);
    const fetcher = (async () => new Response(JSON.stringify({ models: [
      { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-9-flash-sem-texto", supportedGenerationMethods: ["embedContent"] },
    ] }), { status: 200 })) as unknown as typeof fetch;
    expect(await descobrirModelos("k", fetcher)).toEqual(["gemini-3.8-flash"]);
  });
});

describe("autorização da rotina", () => {
  const req = (headers: Record<string, string>) => new Request("https://app/api/cron/mensagem-do-dia", { headers });
  it("com CRON_SECRET exige o Bearer correto", () => {
    const e = { CRON_SECRET: "segredo" } as Env;
    expect(rotinaAutorizada(req({ authorization: "Bearer segredo" }), e)).toBe(true);
    expect(rotinaAutorizada(req({ authorization: "Bearer outro" }), e)).toBe(false);
    expect(rotinaAutorizada(req({ "user-agent": "vercel-cron/1.0" }), e)).toBe(false);
  });
  it("sem CRON_SECRET aceita o Vercel Cron e o segredo interno", () => {
    expect(rotinaAutorizada(req({ "user-agent": "vercel-cron/1.0" }), {} as Env)).toBe(true);
    expect(rotinaAutorizada(req({ "x-notificacoes-cron-secret": "abc" }), { NOTIFICACOES_CRON_SECRET: "abc" } as Env)).toBe(true);
    expect(rotinaAutorizada(req({}), {} as Env)).toBe(false);
  });
});
