import { describe, expect, it } from "vitest";
import { bancoFalso } from "./banco-falso.testutil";
import { avancarContagens, contagensParaTela, lerContagens } from "./crm-contagens";
import type { Env } from "./supabase";

const env = {} as Env;
const F1 = "a".repeat(24), F2 = "b".repeat(24);
const E1 = "1".repeat(24), E2 = "2".repeat(24), U1 = "9".repeat(24);

/** RD simulado: filtra por funil e created_at >= desde, página de 100, ordem de criação. */
function rdFalso(deals: Record<string, unknown>[]) {
  const seg = (v: unknown) => new Date(String(v)).toISOString().slice(0, 19).replace("T", " ");
  const ordenadas = deals.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return async (filtro: string, desde: string | null, pagina: number) => {
    const funil = filtro.replace("pipeline_id:", "");
    const lista = ordenadas.filter((d) => d.pipeline_id === funil && (!desde || seg(d.created_at) >= desde));
    return lista.slice((pagina - 1) * 100, pagina * 100) as never[];
  };
}

function gerar(n: number, funil: string, inicio: number, porSegundo = 1) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${funil.slice(0, 2)}-${i}`, pipeline_id: funil,
    status: i % 3 === 0 ? "won" : i % 3 === 1 ? "lost" : "ongoing",
    stage_id: i % 2 ? E1 : E2, owner_id: i % 5 ? U1 : null,
    created_at: new Date(inicio + Math.floor(i / porSegundo) * 1000).toISOString(),
  }));
}

describe("contagem exata de todos os funis do RD", () => {
  it("conta status, etapa, responsável e mês lendo cada negociação uma vez, em etapas", async () => {
    const { db } = bancoFalso();
    // 3 negociações por segundo: páginas terminam no meio de um segundo (sem contar duas vezes).
    const deals = [...gerar(250, F1, Date.UTC(2025, 0, 31, 23, 59, 30), 3), ...gerar(7, F2, Date.UTC(2026, 5, 1))];
    let t = 0;
    const pagina = rdFalso(deals);
    const deps = { db, relogio: () => t, orcamentoMs: 100, funis: async () => [F1, F2], usuarios: async () => [{ id: U1, name: "Raissa" }],
      pagina: async (f: string, d: string | null, p: number) => { t += 60; return pagina(f, d, p); } };
    const r1 = await avancarContagens(env, deps);
    expect(r1).toMatchObject({ executada: true, concluida: false });
    t = 0;
    let r = r1;
    for (let i = 0; i < 10 && !(r as { concluida?: boolean }).concluida; i++) { t = 0; r = await avancarContagens(env, deps); }
    expect(r).toMatchObject({ concluida: true });
    const estado = await lerContagens(db);
    const c1 = estado!.resultado!.porFunil[F1];
    expect(c1.total).toBe(250);
    expect(c1.status).toEqual({ won: 84, lost: 83, ongoing: 83 });
    expect(c1.etapas).toEqual({ [E1]: 125, [E2]: 125 });
    expect(c1.responsaveis).toEqual({ [U1]: 200, sem_responsavel: 50 });
    expect(Object.values(c1.meses).reduce((a, b) => a + b, 0)).toBe(250);
    expect(Object.keys(c1.meses).sort()).toEqual(["2025-01", "2025-02"]);
    expect(estado!.resultado!.porFunil[F2].total).toBe(7);
    // Para a tela: nomes das etapas (catálogo) e das pessoas.
    const tela = contagensParaTela(estado, [{ id: F1, etapas: [{ id: E1, nome: "Reunião" }, { id: E2, nome: "Contrato" }] }]);
    expect(tela.porFunil[F1].etapas).toHaveLength(2);
    expect(tela.porFunil[F1].etapas).toEqual(expect.arrayContaining([{ chave: E1, nome: "Reunião", negociacoes: 125 }, { chave: E2, nome: "Contrato", negociacoes: 125 }]));
    expect(tela.porFunil[F1].responsaveis[0]).toEqual({ chave: U1, nome: "Raissa", negociacoes: 200 });
  });

  it("contagem concluída vale 6 h; depois recomeça mantendo o último resultado até terminar", async () => {
    const { db } = bancoFalso();
    let agora = Date.UTC(2026, 8, 30, 12);
    const deps = { db, relogio: () => agora, funis: async () => [F2], usuarios: async () => [], pagina: rdFalso(gerar(7, F2, Date.UTC(2026, 5, 1))) };
    expect(await avancarContagens(env, deps)).toMatchObject({ concluida: true });
    expect(await avancarContagens(env, deps)).toMatchObject({ executada: false, motivo: "em_dia" });
    agora += 6 * 60 * 60_000 + 1;
    const antes = (await lerContagens(db))!.resultado;
    expect(await avancarContagens(env, { ...deps, orcamentoMs: 0 })).toMatchObject({ executada: true, concluida: false });
    expect((await lerContagens(db))!.resultado).toEqual(antes);
  });
});
