import { describe, expect, it } from "vitest";
import { validarItens, type ItemImportacao } from "../../../worker/admin-carne-leitor";
import { carne, linhaDigitavelSintetica, mensal } from "./__fixtures__/sinteticos";
import { lerCarne } from "./leitor";
import { definirAcao, editarCampo, montarRevisao, pendenciasItem, podeConfirmar, resumoDecisoes } from "./revisao";
import type { ParcelaExistente } from "./tipos";

const ctx = (n: number) => ({ tipoDocumento: "PDF_TEXT" as const, totalPaginas: n, paginasIlegiveis: [], referenciaIso: "2026-01-10" });

function existente(numero: number, total: number, extra: Partial<ParcelaExistente> = {}): ParcelaExistente {
  return { id: `00000000-0000-4000-8000-${String(numero).padStart(12, "0")}`, numero, total, vencimento: mensal("2026-02-16", numero - 1), valorCentavos: 42778, temBoleto: false, identificador: null, status: "nao_pago", ...extra };
}

describe("revisão humana", () => {
  it("parcelas novas e completas são propostas para criar, mas nada é importado sem confirmação", () => {
    const lido = lerCarne(carne(3), ctx(3));
    const { itens } = montarRevisao(lido, []);
    expect(itens.map((i) => i.acao)).toEqual(["criar", "criar", "criar"]);
    expect(podeConfirmar(itens, [], false, false)).toBe(true);
    expect(resumoDecisoes(itens, []).criar).toBe(3);
  });

  it("parcela existente sem boleto e com mesmos dados é proposta para anexar", () => {
    const lido = lerCarne(carne(3), ctx(3));
    const existentes = [1, 2, 3].map((n) => existente(n, 3));
    const { itens } = montarRevisao(lido, existentes);
    expect(itens.every((i) => i.acao === "anexar" && i.boletoId === existentes[i.numero! - 1].id)).toBe(true);
  });

  it("parcela que já tem boleto fica como não importar; substituir exige escolha explícita", () => {
    const lido = lerCarne(carne(2), ctx(2));
    const existentes = [existente(1, 2, { temBoleto: true }), existente(2, 2)];
    const { itens } = montarRevisao(lido, existentes);
    expect(itens[0].acao).toBe("ignorar");
    const trocado = definirAcao(itens[0], "substituir", existentes[0].id);
    expect(pendenciasItem(trocado, itens, existentes)).toEqual([]);
    const pago = [existente(1, 2, { temBoleto: true, status: "pago" }), existentes[1]];
    expect(pendenciasItem(trocado, itens, pago).join(" ")).toMatch(/paga/);
  });

  it("vencimento ausente não é presumido: item sem decisão até a equipe informar", () => {
    const paginas = carne(3);
    paginas[1] = { ...paginas[1], linhas: paginas[1].linhas.map((l) => (/\d{2}\/\d{2}\/\d{4}/.test(l.texto) ? { ...l, texto: l.texto.replace(/\d{2}\/\d{2}\/\d{4}/, "??/??/????"), palavras: undefined } : l)).filter((l) => !/^\d{5}\.\d{5}/.test(l.texto)) };
    const lido = lerCarne(paginas, ctx(3));
    const { itens } = montarRevisao(lido, []);
    const sem = itens.find((i) => i.numero === 2)!;
    expect(sem.vencimento).toBeNull();
    expect(sem.acao).toBeNull();
    expect(podeConfirmar(itens, [], false, false)).toBe(false);
    let corrigido = definirAcao(editarCampo(sem, "vencimento", "2026-03-16"), "criar");
    expect(corrigido.corrigidos).toEqual(["vencimento"]);
    const lista = itens.map((i) => (i.id === sem.id ? corrigido : i));
    expect(pendenciasItem(corrigido, lista, [])).toEqual([]);
    corrigido = editarCampo(corrigido, "linhaDigitavel", "123");
    expect(pendenciasItem(corrigido, lista, []).join(" ")).toMatch(/não confere/);
  });

  it("sem número impresso, vencimento exato e valor únicos pré-vinculam à parcela cadastrada", () => {
    const lidoBase = lerCarne(carne(3), ctx(3));
    const lido = {
      ...lidoBase,
      parcelas: lidoBase.parcelas.map((p) => ({
        ...p,
        numero: { ...p.numero, valor: null, confianca: 0, nivel: "BAIXA" as const },
        total: { ...p.total, valor: null, confianca: 0, nivel: "BAIXA" as const },
        confianca: 0,
        nivel: "BAIXA" as const,
      })),
    };
    const existentes = [1, 2, 3].map((n) => existente(n, 3));
    const { itens } = montarRevisao(lido, existentes);
    expect(itens.map((i) => i.acao)).toEqual(["anexar", "anexar", "anexar"]);
    expect(itens.map((i) => i.boletoId)).toEqual(existentes.map((e) => e.id));
    expect(itens.every((i) => i.numero == null && i.total == null)).toBe(true);
    expect(podeConfirmar(itens, existentes, false, false)).toBe(true);
  });

  it("mesmo mês e valor, mas dia diferente, continua apenas como sugestão manual", () => {
    const lidoBase = lerCarne(carne(1), ctx(1));
    const lido = {
      ...lidoBase,
      parcelas: lidoBase.parcelas.map((p) => ({
        ...p,
        numero: { ...p.numero, valor: null, confianca: 0, nivel: "BAIXA" as const },
        total: { ...p.total, valor: null, confianca: 0, nivel: "BAIXA" as const },
        vencimento: { ...p.vencimento, valor: "2026-02-20" },
        confianca: 0,
        nivel: "BAIXA" as const,
      })),
    };
    const existentes = [existente(1, 1, { vencimento: "2026-02-16" })];
    const { itens } = montarRevisao(lido, existentes);
    expect(itens[0].acao).toBeNull();
    expect(itens[0].sugestaoAnexo?.numero).toBe(1);
    expect(podeConfirmar(itens, existentes, false, false)).toBe(false);
  });

  it("carnê complementar impresso como 1/12 sugere a parcela 61/72 sem trocar sozinho", () => {
    const lido = lerCarne(carne(12, { inicio: "2031-02-16" }), ctx(12));
    const existentes = Array.from({ length: 72 }, (_, i) => existente(i + 1, 72, { vencimento: mensal("2026-02-16", i), temBoleto: i < 60 }));
    const { itens } = montarRevisao(lido, existentes);
    const primeira = itens[0];
    expect(primeira.numero).toBe(1);
    expect(primeira.acao).toBeNull();
    expect(primeira.sugestaoAnexo?.numero).toBe(61);
    const aceito = definirAcao(primeira, "anexar", primeira.sugestaoAnexo!.boletoId);
    expect(pendenciasItem(aceito, itens, existentes)).toEqual([]);
  });

  it("CPF divergente bloqueia até confirmação explícita", () => {
    const lido = lerCarne(carne(1), ctx(1));
    const { itens } = montarRevisao(lido, []);
    expect(podeConfirmar(itens, [], true, false)).toBe(false);
    expect(podeConfirmar(itens, [], true, true)).toBe(true);
  });

  it("duas folhas não podem criar a mesma parcela nem ir para a mesma parcela existente", () => {
    const lido = lerCarne(carne(2, { numeros: [1, 1] }), ctx(2));
    const { itens } = montarRevisao(lido, []);
    const criar = itens.map((i) => definirAcao(i, "criar"));
    expect(pendenciasItem(criar[0], criar, []).join(" ")).toMatch(/Outra folha/);
  });
});

describe("validação autoritativa do servidor", () => {
  const prefixo = "carnes/c/sha/";
  const arquivos = new Set(["f1.pdf", "f2.pdf"]);
  const linha = linhaDigitavelSintetica("2026-02-16", 42778, "11");
  const base: ItemImportacao = { item: "p1-s1", acao: "criar", numero: 1, total: 2, vencimento: "2026-02-16", valorCentavos: 42778, arquivoPath: `${prefixo}f1.pdf`, identificador: linha };

  it("aceita item coerente", () => {
    expect(validarItens([base], prefixo, arquivos)).toBeNull();
  });
  it("recusa vencimento ou valor ausente, arquivo não enviado e linha inválida", () => {
    expect(validarItens([{ ...base, vencimento: null }], prefixo, arquivos)).toMatch(/vencimento/);
    expect(validarItens([{ ...base, valorCentavos: 0 }], prefixo, arquivos)).toMatch(/valor/);
    expect(validarItens([{ ...base, arquivoPath: `${prefixo}f9.pdf` }], prefixo, arquivos)).toMatch(/não foi enviado/);
    expect(validarItens([{ ...base, arquivoPath: "carnes/outra/f1.pdf" }], prefixo, arquivos)).toMatch(/não foi enviado/);
    expect(validarItens([{ ...base, identificador: `${linha.slice(0, -1)}0` }], prefixo, arquivos)).toMatch(/dígitos/);
  });
  it("valor diferente do código de barras só passa quando corrigido pela equipe", () => {
    expect(validarItens([{ ...base, valorCentavos: 42779 }], prefixo, arquivos)).toMatch(/código de barras/);
    expect(validarItens([{ ...base, valorCentavos: 42779, corrigidos: ["valorCentavos"] }], prefixo, arquivos)).toBeNull();
  });
  it("recusa parcela criada em duplicidade e duas folhas para a mesma parcela existente", () => {
    expect(validarItens([base, { ...base, item: "p2-s1", arquivoPath: `${prefixo}f2.pdf`, identificador: null }], prefixo, arquivos)).toMatch(/mais de uma vez/);
    const anexo = { item: "p1-s1", acao: "anexar" as const, boletoId: "00000000-0000-4000-8000-000000000001", arquivoPath: `${prefixo}f1.pdf` };
    expect(validarItens([anexo, { ...anexo, item: "p2-s1", arquivoPath: `${prefixo}f2.pdf` }], prefixo, arquivos)).toMatch(/mesma parcela/);
  });
});

describe("regressões encontradas com OCR real", () => {
  it("linha de cabeçalhos de outras células nunca vira valor (nome do pagador)", async () => {
    const { linha, pagina } = await import("./__fixtures__/sinteticos");
    const { lerCamposDocumento } = await import("./documento");
    const p = pagina(1, [
      linha(0.10, [["Pagador", 0.05], ["CPF", 0.62]], 0.9),
      linha(0.12, [["ANA EXEMPLO DA SILVA", 0.05], ["529.982.247-25", 0.62]], 0.9),
      linha(0.14, [["Data de emissão", 0.05], ["Venda", 0.38], ["(-) Desconto", 0.62]], 0.9),
      linha(0.16, [["05/01/2026", 0.05], ["31416", 0.38]], 0.9),
    ], "OCR");
    expect(lerCamposDocumento([p]).nomeCliente.valor).toBe("ANA EXEMPLO DA SILVA");
    const semNome = pagina(1, [linha(0.10, [["Pagador", 0.05], ["CPF", 0.62]], 0.9), linha(0.12, [["Data de emissão", 0.05], ["Venda", 0.38]], 0.9)], "OCR");
    expect(lerCamposDocumento([semNome]).nomeCliente.valor).toBeNull();
  });

  it("sequência mensal coerente reforça o número lido, sem criar número", () => {
    const seis = lerCarne(carne(6, { confianca: 0.75, fonte: "OCR" }), { ...ctx(6), tipoDocumento: "PDF_SCANNED" });
    expect(seis.parcelas.every((p) => p.numero.fatores?.includes("coerente_com_sequencia_mensal"))).toBe(true);
    const duas = lerCarne(carne(2, { confianca: 0.75, fonte: "OCR" }), { ...ctx(2), tipoDocumento: "PDF_SCANNED" });
    expect(duas.parcelas.some((p) => p.numero.fatores?.includes("coerente_com_sequencia_mensal"))).toBe(false);
  });
});
