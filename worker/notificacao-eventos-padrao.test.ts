import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validarTextoTemplate } from "./admin-notificacoes";
import { EVENTOS_PADRAO } from "./notificacao-eventos-padrao";

it("recusa variável que não pertence ao aviso", () => {
  expect(validarTextoTemplate("Mensagem", "Oi {{valor_total}}", 300, true, new Set(["nome"]))).toMatch(/neste aviso/);
});
import { despacharPushPendentes, urlDoDestino } from "./notificacoes-despacho";

const migration = readFileSync(new URL("../supabase/migration_093_avisos_jornada_cliente.sql", import.meta.url), "utf8");

describe("catálogo dos avisos da jornada", () => {
  it("tem chaves únicas e textos válidos, só com as variáveis de cada aviso", () => {
    expect(new Set(EVENTOS_PADRAO.map((e) => e.chave)).size).toBe(EVENTOS_PADRAO.length);
    for (const e of EVENTOS_PADRAO) {
      const permitidas = new Set(e.variaveis);
      expect(validarTextoTemplate("Título", e.titulo, 80, true, permitidas), e.chave).toBeNull();
      expect(validarTextoTemplate("Mensagem", e.corpo, 300, true, permitidas), e.chave).toBeNull();
    }
  });

  it("não promete prazo ou condição fora da regra documentada", () => {
    for (const e of EVENTOS_PADRAO) {
      expect(`${e.titulo} ${e.corpo}`).not.toMatch(/desconto|renegoci|garantid|negativ|juros|multa/i);
    }
    // Regra: após termos + quitação, agenda cirúrgica em até 5 dias úteis.
    expect(EVENTOS_PADRAO.find((e) => e.chave === "quitacao_confirmada")?.corpo).toContain("até 5 dias úteis");
  });

  it("todo aviso disparado pela migration existe no catálogo e é semeado", () => {
    const disparados = new Set([...migration.matchAll(/notificar_cliente\([^,]+,\s*'([a-z_]+)'/g)].map((m) => m[1]).filter((c) => !c.endsWith("_")));
    for (const status of ["aprovado", "separacao", "entregue", "cancelado"]) disparados.add(`clube_resgate_${status}`);
    for (const chave of ["termos_lembrete_dia", "termos_lembrete_vespera", "cirurgia_agendada", "cirurgia_remarcada", "clube_voucher_disponivel"]) disparados.add(chave);
    const catalogo = new Set(EVENTOS_PADRAO.map((e) => e.chave));
    for (const chave of disparados) expect(catalogo.has(chave), chave).toBe(true);
    for (const chave of catalogo) expect(migration, `seed de ${chave}`).toContain(`('${chave}',`);
  });

  it("aviso nunca derruba a operação que o disparou", () => {
    expect(migration).toContain("exception when others then\n  -- Aviso nunca derruba");
    expect(migration).toContain("on conflict (cliente_id, evento, chave_dedupe) where chave_dedupe is not null do nothing");
  });
});

describe("entrega do Web Push dos avisos", () => {
  it("abre a aba certa do app", () => {
    expect(urlDoDestino("parcelas")).toBe("/agenda?destino=parcelas");
    expect(urlDoDestino("clube")).toBe("/agenda?destino=clube");
    expect(urlDoDestino("jornada")).toBe("/agenda?destino=jornada");
    expect(urlDoDestino("agenda")).toBe("/agenda?destino=agenda");
    expect(urlDoDestino(null)).toBe("/agenda?destino=agenda");
  });

  it("sem Supabase configurado não faz nada", async () => {
    await expect(despacharPushPendentes({} as never)).resolves.toEqual({ processados: 0, enviados: 0 });
  });

  it("reserva o registro (pendente → enviando) antes de enviar, para não duplicar", () => {
    const fonte = readFileSync(new URL("./notificacoes-despacho.ts", import.meta.url), "utf8");
    expect(fonte).toMatch(/update\(\{ push_status: "enviando" \}\)\s*\n?\s*\.eq\("id", log\.id\)\.eq\("push_status", "pendente"\)/);
    const registrar = readFileSync(new URL("./admin-notificacoes.ts", import.meta.url), "utf8");
    expect(registrar).toContain('push_status: "enviando",');
  });
});
