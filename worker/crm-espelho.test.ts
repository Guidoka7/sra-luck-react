import { describe, expect, it } from "vitest";
import { bancoFalso } from "./banco-falso.testutil";
import { carregarContatosDoEspelho } from "./crm-espelho";
import type { Env } from "./supabase";

const env = {} as Env;

describe("carga única dos contatos do RD no espelho", () => {
  it("lê todos os contatos 100 por consulta, em etapas, com o contato completo; depois não roda mais", async () => {
    const contatos = Array.from({ length: 250 }, (_, i) => ({
      id: `c${i}`, name: `Pessoa ${i}`, emails: [{ email: `p${i}@x.com` }], phones: [{ phone: `55619${String(i).padStart(8, "0")}` }],
      custom_fields: { "produto-servico": ["Lipo"] }, created_at: new Date(Date.UTC(2025, 0, 1) + Math.floor(i / 3) * 1000).toISOString(),
    }));
    const seg = (v: unknown) => new Date(String(v)).toISOString().slice(0, 19).replace("T", " ");
    let consultas = 0, t = 0;
    const pagina = async (desde: string | null, p: number) => { consultas++; t += 60; return contatos.filter((c) => !desde || seg(c.created_at) >= desde).slice((p - 1) * 100, p * 100) as never[]; };
    const { db, tabela } = bancoFalso();
    const deps = { db, pagina, relogio: () => t, orcamentoMs: 100 };
    let r = await carregarContatosDoEspelho(env, deps);
    expect(r).toMatchObject({ executada: true, concluida: false });
    for (let i = 0; i < 10 && !r.concluida; i++) { t = 0; r = await carregarContatosDoEspelho(env, deps); }
    expect(r).toMatchObject({ concluida: true, lidos: 250 });
    expect(tabela("crm_rd_contatos")).toHaveLength(250);
    expect(tabela("crm_rd_contatos").find((c) => c.id === "c7")!.dados).toMatchObject({ id: "c7", name: "Pessoa 7", custom_fields: { "produto-servico": ["Lipo"] } });
    const antes = consultas;
    expect(await carregarContatosDoEspelho(env, deps)).toMatchObject({ executada: false, concluida: true });
    expect(consultas).toBe(antes);
  });
});
