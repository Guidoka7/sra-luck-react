import { describe, expect, it } from "vitest";
import { aplicarNome, chamarGemini, montarPrompt, segmentoPorPercentual, validarFraseIa } from "./frase-do-dia";
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

  it("propaga erro de cota para o chamador usar o catálogo", async () => {
    const fetcher = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    await expect(chamarGemini("k", ["gemini-flash-latest"], "s", "u", fetcher)).rejects.toThrow("http_429");
  });
});
