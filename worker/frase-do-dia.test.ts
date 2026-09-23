import { describe, expect, it } from "vitest";
import { ErroGemini, aplicarNome, chamarGemini, descobrirModelos, ordenarModelos, montarPrompt, segmentoPorPercentual, validarFraseIa } from "./frase-do-dia";
import { fraseDoDia } from "../src/lib/fraseDoDia";

describe("agente da frase do dia", () => {
  it("segmenta a jornada pelo percentual de parcelas pagas", () => {
    expect(segmentoPorPercentual(0)).toBe("inicio");
    expect(segmentoPorPercentual(20)).toBe("construindo");
    expect(segmentoPorPercentual(50)).toBe("metade");
    expect(segmentoPorPercentual(100)).toBe("quitado");
    expect(segmentoPorPercentual(Number.NaN)).toBe("inicio");
  });

  it("aplica o primeiro nome no backend e remove o vocativo quando não há nome", () => {
    expect(aplicarNome("{nome}, cada passo *conta muito* hoje.", "Maria")).toBe("Maria, cada passo *conta muito* hoje.");
    expect(aplicarNome("{nome}, cada passo *conta muito* hoje.", "")).toBe("Cada passo *conta muito* hoje.");
    expect(aplicarNome("Hoje é seu dia, {nome}. *Siga firme*.", "")).toBe("Hoje é seu dia. *Siga firme*.");
  });

  it("aceita frase no tom da marca", () => {
    const r = validarFraseIa("\"{nome}, o seu sonho cresce a cada *escolha consciente*.\"");
    expect(r).toEqual({ ok: true, texto: "{nome}, o seu sonho cresce a cada *escolha consciente*." });
  });

  it("reprova o que foge das regras", () => {
    expect(validarFraseIa("Curta *demais*.")).toMatchObject({ ok: false, motivo: "tamanho" });
    expect(validarFraseIa("Uma frase sem nenhum destaque marcado aqui.")).toMatchObject({ ok: false, motivo: "destaque" });
    expect(validarFraseIa("Seu corpo *perfeito* está chegando, confie no plano.")).toMatchObject({ ok: false, motivo: "termo_proibido" });
    expect(validarFraseIa("Resultado *garantido* para quem planeja com calma.")).toMatchObject({ ok: false, motivo: "termo_proibido" });
    expect(validarFraseIa("Planeje hoje e sorria *amanhã* 😊 com a Sra. Luck.")).toMatchObject({ ok: false, motivo: "caractere" });
    expect(validarFraseIa("Olá {cliente}, o seu sonho *está perto* de você.")).toMatchObject({ ok: false, motivo: "marcador" });
    expect(validarFraseIa("Disciplina hoje, *resultados sempre*.")).toMatchObject({ ok: false, motivo: "repetida" });
    const recente = "O seu sonho cresce a cada *escolha consciente*.";
    expect(validarFraseIa(recente, [recente])).toMatchObject({ ok: false, motivo: "repetida" });
  });

  it("não envia dados pessoais no prompt", () => {
    const agora = new Date("2026-09-23T15:00:00Z");
    const { sistema, usuario } = montarPrompt(agora, fraseDoDia(agora), "metade", ["Frase antiga *de ontem* aqui."]);
    expect(usuario).toContain("Quarta de foco");
    expect(usuario).toContain("passou da metade");
    expect(usuario).toContain("Frase antiga");
    expect(`${sistema}${usuario}`).not.toMatch(/cpf|telefone|procedimento|@/i);
  });

  it("chama o Gemini, lê o JSON e troca de modelo quando o primeiro não existe", async () => {
    const chamadas: string[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      chamadas.push(url);
      expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("chave-teste");
      if (url.includes("modelo-velho")) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{\"texto\": \"Seu plano é *o seu caminho*, siga firme hoje.\"}" }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await chamarGemini("chave-teste", ["modelo-velho", "gemini-flash-latest"], "s", "u", fetcher);
    expect(r).toEqual({ texto: "Seu plano é *o seu caminho*, siga firme hoje.", modelo: "gemini-flash-latest" });
    expect(chamadas).toHaveLength(2);
  });

  it("com modelo sobrecarregado (503) ou sem cota (429), tenta o próximo", async () => {
    const status: Record<string, number> = { a: 503, b: 429 };
    const fetcher = (async (url: string) => {
      const modelo = url.match(/models\/([^:]+)/)![1];
      if (status[modelo]) return new Response("{}", { status: status[modelo] });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{\"texto\": \"ok *deu certo* aqui\"}" }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(chamarGemini("k", ["a", "b", "c"], "s", "u", fetcher, 0)).resolves.toEqual({ texto: "ok *deu certo* aqui", modelo: "c" });
  });

  it("tudo sobrecarregado: faz mais uma rodada e depois desiste com o motivo", async () => {
    let chamadas = 0;
    const fetcher = (async () => { chamadas += 1; return new Response("{}", { status: 503 }); }) as unknown as typeof fetch;
    const erro = await chamarGemini("k", ["a", "b"], "s", "u", fetcher, 0).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroGemini);
    expect(erro.message).toBe("http_503");
    expect(chamadas).toBe(4);
  });

  it("chave recusada para na hora, sem tentar outros modelos", async () => {
    let chamadas = 0;
    const fetcher = (async () => { chamadas += 1; return new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 403 }); }) as unknown as typeof fetch;
    await expect(chamarGemini("k", ["a", "b"], "s", "u", fetcher, 0)).rejects.toThrow("http_403");
    expect(chamadas).toBe(1);
  });

  it("ordena os modelos disponíveis: leves estáveis, flash estáveis, apelidos e prévias", () => {
    const nomes = [
      "models/gemini-2.5-flash", "models/gemini-3.8-flash", "models/gemini-3.5-flash-lite", "models/gemini-3.1-flash-lite",
      "models/gemini-3-flash-latest", "models/gemini-3-flash-preview", "models/gemini-3.8-flash-tts", "models/gemini-3.1-flash-image",
      "models/gemini-2.5-pro", "models/gemini-3.8-live", "models/gemini-embedding-2",
    ];
    expect(ordenarModelos(nomes)).toEqual([
      "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-3-flash-latest", "gemini-3-flash-preview",
    ]);
  });

  it("descobre pela ListModels só os modelos que geram texto", async () => {
    const fetcher = (async (url: string) => {
      expect(url).toContain("/v1beta/models?");
      return new Response(JSON.stringify({ models: [
        { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
        { name: "models/gemini-3.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-9-flash-sem-texto", supportedGenerationMethods: ["embedContent"] },
      ] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await descobrirModelos("chave-lista", fetcher)).toEqual(["gemini-3.5-flash-lite", "gemini-3.8-flash"]);
  });

  it("erro 400 que não é da chave passa para o próximo modelo", async () => {
    const fetcher = (async (url: string) => url.includes("/a:")
      ? new Response(JSON.stringify({ error: { message: "Invalid JSON payload: unknown field" } }), { status: 400 })
      : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{\"texto\": \"ok *deu certo* aqui\"}" }] } }] }), { status: 200 })) as unknown as typeof fetch;
    await expect(chamarGemini("k", ["a", "b"], "s", "u", fetcher, 0)).resolves.toMatchObject({ modelo: "b" });
    const chaveRuim = (async () => new Response(JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }), { status: 400 })) as unknown as typeof fetch;
    await expect(chamarGemini("k", ["a", "b"], "s", "u", chaveRuim, 0)).rejects.toThrow("http_400");
  });
});
