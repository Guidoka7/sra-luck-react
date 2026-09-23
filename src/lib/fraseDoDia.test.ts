import { describe, expect, it } from "vitest";
import { DATAS_ESPECIAIS, FRASES_MES, TEMAS_SEMANA, diaLocal, fraseDoDia, trechosDaFrase } from "./fraseDoDia";

/** Meio-dia em Brasília (15h UTC) do dia informado. */
const dia = (iso: string) => new Date(`${iso}T15:00:00Z`);

describe("fraseDoDia", () => {
  it("todas as frases do catálogo são únicas e têm um destaque", () => {
    const todas = [...TEMAS_SEMANA.flatMap((t) => t.frases), ...FRASES_MES, ...DATAS_ESPECIAIS.map((e) => e.texto)];
    expect(new Set(todas).size).toBe(todas.length);
    for (const f of todas) expect(trechosDaFrase(f).some((t) => t.destaque)).toBe(true);
  });

  it("nunca repete a frase em dois dias seguidos (3 anos)", () => {
    let anterior = "";
    for (let i = 0; i < 365 * 3; i += 1) {
      const atual = fraseDoDia(new Date(Date.UTC(2026, 0, 1, 15) + i * 86_400_000)).texto;
      expect(atual).not.toBe(anterior);
      anterior = atual;
    }
  });

  it("usa o tema do dia da semana e gira a frase a cada semana", () => {
    const terca = fraseDoDia(dia("2026-09-22"));
    const proxima = fraseDoDia(dia("2026-09-29"));
    expect(terca.tema).toBe("Terça de constância");
    expect(proxima.tema).toBe("Terça de constância");
    expect(proxima.texto).not.toBe(terca.texto);
    // Uma frase de terça só volta depois de passar por todas as outras.
    const vistas = new Set<string>();
    for (let s = 0; s < 8; s += 1) vistas.add(fraseDoDia(new Date(dia("2026-09-22").getTime() + s * 7 * 86_400_000)).texto);
    expect(vistas.size).toBe(8);
  });

  it("datas especiais e dia 1 do mês têm frase própria", () => {
    expect(fraseDoDia(dia("2027-03-08")).tema).toBe("Dia da Mulher");
    expect(fraseDoDia(dia("2026-05-10")).tema).toBe("Dia das Mães"); // 2º domingo de maio
    expect(fraseDoDia(dia("2026-05-03")).tema).not.toBe("Dia das Mães");
    expect(fraseDoDia(dia("2026-12-25")).tema).toBe("Feliz Natal");
    const outubro = fraseDoDia(dia("2026-10-01"));
    expect(outubro.origem).toBe("mes");
    expect(outubro.texto).toContain("Outubro Rosa");
    expect(fraseDoDia(dia("2027-01-01")).tema).toBe("Feliz Ano Novo");
  });

  it("vira o dia pela meia-noite de Brasília, não pelo UTC", () => {
    // 23/09 às 23h30 em Brasília = 24/09 02:30 UTC.
    const noite = new Date("2026-09-24T02:30:00Z");
    expect(diaLocal(noite)).toMatchObject({ ano: 2026, mes: 9, dia: 23, diaSemana: 3 });
    expect(fraseDoDia(noite).data).toBe("2026-09-23");
    expect(fraseDoDia(new Date("2026-09-24T03:05:00Z")).data).toBe("2026-09-24");
  });

  it("separa os trechos de destaque", () => {
    expect(trechosDaFrase("Disciplina hoje, *resultados sempre*.")).toEqual([
      { texto: "Disciplina hoje, ", destaque: false },
      { texto: "resultados sempre", destaque: true },
      { texto: ".", destaque: false },
    ]);
  });
});
