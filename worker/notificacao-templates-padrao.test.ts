import { describe, expect, it } from "vitest";
import { escolherTemplateAtraso, montarMensagemUnificada, validarTextoTemplate } from "./admin-notificacoes";
import { DIA_RECORRENTE, TEMPLATES_PADRAO } from "./notificacao-templates-padrao";

const atraso = TEMPLATES_PADRAO.filter((t) => t.tipo === "parcela_atrasada");
const vencer = TEMPLATES_PADRAO.filter((t) => t.tipo === "parcela_vencer");

describe("catálogo padrão da régua de parcelas", () => {
  it("tem um texto por dia de 1 a 30 e um único 31+", () => {
    expect(atraso.map((t) => t.dias)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(vencer.map((t) => t.dias).sort()).toEqual([0, 1, 2]);
  });

  it("não repete título dentro da faixa de 1 a 30 dias", () => {
    const titulos = atraso.filter((t) => t.dias <= 30).map((t) => t.titulo);
    expect(new Set(titulos).size).toBe(titulos.length);
  });

  it("todos os textos passam na validação do painel (tamanho e variáveis)", () => {
    for (const t of TEMPLATES_PADRAO) {
      expect(validarTextoTemplate("Título", t.titulo, 80, true)).toBeNull();
      expect(validarTextoTemplate("Mensagem", t.corpo, 300, true)).toBeNull();
      expect(validarTextoTemplate("Título", t.titulo_multiplas, 80, true)).toBeNull();
      expect(validarTextoTemplate("Mensagem", t.corpo_multiplas, 300, true)).toBeNull();
      expect(t.corpo_multiplas).toContain("{{quantidade}}");
    }
  });

  it("não promete condição nem constrange", () => {
    const proibidos = /desconto|renegoci|parcelar diferente|negativ|serasa|spc|cancelad|juros|multa|amiga|😢/i;
    for (const t of TEMPLATES_PADRAO) for (const texto of [t.titulo, t.corpo, t.titulo_multiplas, t.corpo_multiplas]) expect(texto).not.toMatch(proibidos);
  });
});

describe("envio unificado", () => {
  const templates = atraso.map((t, i) => ({ ...t, id: String(i), dias_referencia: t.dias }));

  it("usa o texto do dia exato até 30 e o texto único a partir de 31", () => {
    expect(escolherTemplateAtraso(templates, 0)).toBeNull();
    expect(escolherTemplateAtraso(templates, 7)?.dias).toBe(7);
    expect(escolherTemplateAtraso(templates, 30)?.dias).toBe(30);
    expect(escolherTemplateAtraso(templates, 31)?.dias).toBe(DIA_RECORRENTE);
    expect(escolherTemplateAtraso(templates, 190)?.dias).toBe(DIA_RECORRENTE);
  });

  it("dia desligado não envia (não cai no texto de outro dia)", () => {
    expect(escolherTemplateAtraso(templates.filter((t) => t.dias !== 8), 8)).toBeNull();
  });

  it("uma parcela usa a versão simples; várias parcelas viram uma mensagem só", () => {
    const t = templates.find((x) => x.dias === DIA_RECORRENTE)!;
    const b1 = { data_vencimento: "2026-08-01", numero_parcela: 3, total_parcelas: 12, valor: 500 };
    const b2 = { data_vencimento: "2026-09-01", numero_parcela: 4, total_parcelas: 12, valor: 500 };
    const uma = montarMensagemUnificada(t, [b1], "2026-09-24", "MARIA DA SILVA");
    expect(uma.mensagem).toContain("Maria, a parcela 3/12 está em aberto há 54 dias");
    const varias = montarMensagemUnificada(t, [b1, b2], "2026-09-24", "MARIA DA SILVA");
    expect(varias.titulo).toBe("Seu plano tem 2 parcelas em aberto");
    expect(varias.mensagem).toContain("somando R$");
    expect(varias.mensagem).not.toMatch(/\{\{/);
  });

  it("recusa variável desconhecida e texto longo", () => {
    expect(validarTextoTemplate("Mensagem", "Olá {{cliente_nome}}", 300, true)).toMatch(/não existe/);
    expect(validarTextoTemplate("Título", "x".repeat(81), 80, true)).toMatch(/até 80/);
    expect(validarTextoTemplate("Título", "", 80, false)).toBeNull();
  });
});
