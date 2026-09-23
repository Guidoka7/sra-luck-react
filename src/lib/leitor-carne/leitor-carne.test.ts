import { describe, expect, it } from "vitest";
import { lerCarne } from "./leitor";
import { compararComExistentes } from "./duplicidade";
import { decodificarBoleto, encontrarBoletos } from "./febraban";
import { campoDeCandidatos, nivelDaConfianca } from "./confianca";
import { cpfValido, encontrarNumerosParcela, normalizarCpf, parseCentavos, parseData, similaridadeNomes, encontrarNumeroIsolado } from "./normalizadores";
import { CPF_FICTICIO, CPF_FICTICIO_2, NOME_FICTICIO, carne, formatarLinha, linha, linhaDigitavelSintetica, linhasBoleto, mensal, pagina } from "./__fixtures__/sinteticos";
import type { ContextoLeitura, PaginaTexto, ParcelaExistente } from "./tipos";

const CTX = (paginas: PaginaTexto[], extra: Partial<ContextoLeitura> = {}): ContextoLeitura => ({
  tipoDocumento: paginas.every((p) => p.fonte === "PDF_TEXT") ? "PDF_TEXT" : paginas.every((p) => p.fonte === "OCR") ? "PDF_SCANNED" : "MIXED_PDF",
  totalPaginas: paginas.length,
  paginasIlegiveis: [],
  referenciaIso: "2026-01-15",
  ...extra,
});
const codigos = (alertas: { codigo: string }[]) => alertas.map((a) => a.codigo);

describe("normalizadores", () => {
  it("CPF: normaliza e valida dígitos", () => {
    expect(normalizarCpf("529.982.247-25")).toBe("52998224725");
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("529.982.247-24")).toBe(false);
    expect(cpfValido("111.111.111-11")).toBe(false);
  });
  it("moeda em centavos inteiros", () => {
    expect(parseCentavos("R$ 427,78")).toBe(42778);
    expect(parseCentavos("427,78")).toBe(42778);
    expect(parseCentavos("427.78")).toBe(42778);
    expect(parseCentavos("R$427,78")).toBe(42778);
    expect(parseCentavos("R$ 4.277,80")).toBe(427780);
    expect(parseCentavos("1.234")).toBeNull();
  });
  it("datas para YYYY-MM-DD, rejeitando datas impossíveis", () => {
    expect(parseData("15/08/2026")).toBe("2026-08-15");
    expect(parseData("15-08-26")).toBe("2026-08-15");
    expect(parseData("31/02/2026")).toBeNull();
  });
  it("número da parcela em vários formatos, sem confundir datas", () => {
    const f = (t: string) => encontrarNumerosParcela(t).map((p) => `${p.numero}/${p.total}`);
    expect(f("Parcela 1/12")).toEqual(["1/12"]);
    expect(f("01/12")).toEqual(["1/12"]);
    expect(f("1 de 12")).toEqual(["1/12"]);
    expect(f("01-12")).toEqual(["1/12"]);
    expect(f("18/36 - Venda 31416")).toEqual(["18/36"]);
    expect(f("Vencimento 15/08/2026")).toEqual([]);
    expect(encontrarNumeroIsolado("Parcela: 01")?.numero).toBe(1);
  });
  it("nomes: acentos/caixa não importam; compartilhar só o primeiro nome não basta", () => {
    expect(similaridadeNomes("ANA CAROLYNA RODRIGUES CABRAL", "Ana Carolyna Rodrigues Cabral")).toBeGreaterThan(0.95);
    expect(similaridadeNomes("ANA CAROLYNA RODRIGUES CABRAL", "ANA CAROLINA SILVA")).toBeLessThan(0.85);
  });
});

describe("linha digitável", () => {
  it("valida DV e decodifica valor e vencimento", () => {
    const l = linhaDigitavelSintetica("2026-08-15", 42778, "123");
    const b = decodificarBoleto(formatarLinha(l), "2026-01-01")!;
    expect(b.valorCentavos).toBe(42778);
    expect(b.vencimento).toBe("2026-08-15");
  });
  it("OCR confundindo 0/O e 1/I: sugere correção, não aplica", () => {
    const l = formatarLinha(linhaDigitavelSintetica("2026-08-15", 42778, "10"));
    const comO = l.replace(/0/, "O");
    const r = encontrarBoletos(comO, "2026-01-01");
    expect(r.validos).toHaveLength(0);
    expect(r.sugestoes[0].sugerida.valorCentavos).toBe(42778);
    const comI = l.replace(/1(?=[^1]*$)/, "I");
    expect(encontrarBoletos(comI, "2026-01-01").sugestoes.length).toBe(1);
  });
});

describe("motor de confiança", () => {
  it("faixas e conflito entre candidatos", () => {
    expect(nivelDaConfianca(0.96)).toBe("ALTA");
    expect(nivelDaConfianca(0.85)).toBe("MEDIA");
    expect(nivelDaConfianca(0.5)).toBe("BAIXA");
    const { campo, conflito } = campoDeCandidatos([
      { valor: "2026-08-15", bruto: "15/08/2026", pontuacao: 0.9, motivos: [], pagina: 1, fonte: "OCR" },
      { valor: "2026-08-10", bruto: "10/08/2026", pontuacao: 0.82, motivos: [], pagina: 1, fonte: "OCR" },
    ]);
    expect(conflito).toBe(true);
    expect(campo.confianca).toBeLessThan(0.9);
  });
});

describe("documentos sintéticos", () => {
  it("1. PDF textual perfeito: tudo lido com alta confiança", () => {
    const r = lerCarne(carne(3), CTX(carne(3)));
    expect(r.parcelas).toHaveLength(3);
    const p = r.parcelas[0];
    expect([p.numero.valor, p.total.valor, p.vencimento.valor, p.valorCentavos.valor]).toEqual([1, 3, "2026-02-16", 42778]);
    expect(p.nivel).toBe("ALTA");
    expect(r.cpf.valor).toBe(CPF_FICTICIO);
    expect(r.nomeCliente.valor).toBe(NOME_FICTICIO);
    expect(r.venda.valor).toBe("31416");
    expect(r.banco.valor).toContain("BRB");
    expect(r.nivelDocumento).toBe("ALTA");
  });

  it("4 e 5. documentos com 12 e 24 parcelas: sequência completa e mensal", () => {
    for (const total of [12, 24]) {
      const pags = carne(total);
      const r = lerCarne(pags, CTX(pags));
      expect(r.resumo.encontradas).toBe(total);
      expect(r.resumo.totalInformado).toBe(total);
      expect(r.resumo.periodicidade).toBe("MENSAL");
      expect(r.resumo.valorPredominanteCentavos).toBe(42778);
      expect(r.resumo.valorTotalCentavos).toBe(42778 * total);
      expect(r.resumo.ultimoVencimento).toBe(mensal("2026-02-16", total - 1));
      expect(codigos(r.alertas)).not.toContain("MISSING_INSTALLMENT");
    }
  });

  it("6. parcela ausente: alerta e NÃO cria a parcela", () => {
    const pags = carne(24, { numeros: [1, 2, 3, 5] });
    const r = lerCarne(pags, CTX(pags));
    expect(r.parcelas.map((p) => p.numero.valor)).toEqual([1, 2, 3, 5]);
    expect(r.alertas.find((a) => a.codigo === "MISSING_INSTALLMENT")?.parcela).toBe(4);
    expect(r.resumo.ausentes).toEqual([4]);
  });

  it("7. parcela duplicada", () => {
    const pags = carne(12, { numeros: [1, 2, 2, 3] });
    const r = lerCarne(pags, CTX(pags));
    expect(codigos(r.alertas)).toContain("DUPLICATE_INSTALLMENT");
    expect(r.resumo.duplicadas).toEqual([2]);
  });

  it("8. data ilegível e sem linha digitável: vencimento null, não inventado pela sequência", () => {
    const pags = [
      pagina(1, linhasBoleto({ numero: 1, total: 3, vencimento: "2026-02-16", centavos: 42778 })),
      pagina(2, linhasBoleto({ numero: 2, total: 3, vencimento: "2026-03-16", centavos: 42778, vencimentoIlegivel: true, semLinhaDigitavel: true })),
      pagina(3, linhasBoleto({ numero: 3, total: 3, vencimento: "2026-04-16", centavos: 42778 })),
    ];
    const r = lerCarne(pags, CTX(pags));
    const p2 = r.parcelas.find((p) => p.numero.valor === 2)!;
    expect(p2.vencimento.valor).toBeNull();
    expect(p2.nivel).toBe("BAIXA");
    expect(p2.alertas.some((a) => a.codigo === "FIELD_NOT_FOUND" && a.campo === "vencimento")).toBe(true);
  });

  it("9. valor divergente (4.277,80 × 427,78) sem linha: sinaliza, não altera", () => {
    const pags = carne(4, { semLinhaDigitavel: true });
    pags[2] = pagina(3, linhasBoleto({ numero: 3, total: 4, vencimento: mensal("2026-02-16", 2), centavos: 427780, semLinhaDigitavel: true }));
    const r = lerCarne(pags, CTX(pags));
    const p3 = r.parcelas.find((p) => p.numero.valor === 3)!;
    expect(p3.valorCentavos.valor).toBe(427780);
    const outlier = r.alertas.find((a) => a.codigo === "VALUE_OUTLIER")!;
    expect(outlier.parcela).toBe(3);
    expect(outlier.detalhes?.possivelErroDeEscala).toBe(true);
  });

  it("10. documento de outra cliente: CPF divergente bloqueia (ERRO) e nome alerta", () => {
    const pags = carne(2, { cpf: CPF_FICTICIO_2, nome: "BEATRIZ TESTE MORAES" });
    const r = lerCarne(pags, CTX(pags, { cliente: { nome: NOME_FICTICIO, cpf: CPF_FICTICIO } }));
    expect(r.alertas.find((a) => a.codigo === "CLIENT_CPF_MISMATCH")?.severidade).toBe("ERRO");
    expect(codigos(r.alertas)).toContain("CLIENT_NAME_MISMATCH");
  });

  it("12. CPF inválido não recebe confiança alta", () => {
    const pags = carne(2, { cpf: "52998224724" });
    const r = lerCarne(pags, CTX(pags));
    expect(r.cpf.nivel).toBe("BAIXA");
    expect(codigos(r.alertas)).toContain("INVALID_CPF");
  });

  it("13. documento parcialmente ilegível: página ilegível vira alerta, o resto segue", () => {
    const pags = carne(3);
    pags[1] = { ...pags[1], linhas: [] };
    const r = lerCarne(pags, CTX(pags, { paginasIlegiveis: [2] }));
    expect(r.parcelas.map((p) => p.numero.valor)).toEqual([1, 3]);
    expect(codigos(r.alertas)).toEqual(expect.arrayContaining(["UNREADABLE_PAGE", "MISSING_INSTALLMENT"]));
  });

  it("14. PDF misto (texto + OCR): lê as duas origens e marca a fonte", () => {
    const pags = [...carne(2), pagina(3, linhasBoleto({ numero: 3, total: 3, vencimento: "2026-04-16", centavos: 42778, confianca: 0.9 }), "OCR")];
    const r = lerCarne(pags, CTX(pags, { tipoDocumento: "MIXED_PDF" }));
    expect(r.paginasOcr).toBe(1);
    expect(r.paginasTexto).toBe(2);
    expect(r.parcelas[2].vencimento.fonte).toBe("OCR");
    expect(r.parcelas[2].valorCentavos.valor).toBe(42778);
  });

  it("15 e 16. OCR trocando 0/O e 1/I na linha: sugestão separada + revisão", () => {
    const pags = [pagina(1, linhasBoleto({ numero: 1, total: 2, vencimento: "2026-02-16", centavos: 42778, confianca: 0.88, linhaCorrompida: (l) => l.replace("0", "O").replace(/1(?=[^1]*$)/, "I") }), "OCR")];
    const r = lerCarne(pags, CTX(pags));
    const p = r.parcelas[0];
    expect(p.linhaDigitavel.valor).toBeNull();
    expect(p.linhaDigitavel.sugestao?.valor).toMatch(/^\d{47}$/);
    expect(p.alertas.some((a) => a.codigo === "INVALID_BARCODE")).toBe(true);
    expect(p.valorCentavos.valor).toBe(42778);
  });

  it("17. emissão + vencimento na mesma página: a data de emissão não vira vencimento", () => {
    const pags = [pagina(1, linhasBoleto({ numero: 1, total: 1, vencimento: "2026-02-16", centavos: 42778, emissao: "2026-01-05", semLinhaDigitavel: true }))];
    const r = lerCarne(pags, CTX(pags));
    expect(r.parcelas[0].vencimento.valor).toBe("2026-02-16");
    const emissao = r.parcelas[0].vencimento.candidatos?.find((c) => c.valor === "2026-01-05");
    expect(emissao ? emissao.pontuacao : 0).toBeLessThan(0.3);
  });

  it("18. valor do documento + desconto: o desconto não vira valor", () => {
    const pags = [pagina(1, linhasBoleto({ numero: 1, total: 1, vencimento: "2026-02-16", centavos: 42778, outraCobranca: 2000, semLinhaDigitavel: true }))];
    const r = lerCarne(pags, CTX(pags));
    expect(r.parcelas[0].valorCentavos.valor).toBe(42778);
  });

  it("várias parcelas na MESMA página são separadas", () => {
    const linhas = [0, 1, 2].flatMap((i) => linhasBoleto({ numero: i + 1, total: 3, vencimento: mensal("2026-02-16", i), centavos: 42778 }, 0.03 + i * 0.32));
    const pags = [pagina(1, linhas)];
    const r = lerCarne(pags, CTX(pags));
    expect(r.parcelas.map((p) => [p.numero.valor, p.vencimento.valor])).toEqual([[1, "2026-02-16"], [2, "2026-03-16"], [3, "2026-04-16"]]);
  });

  it("vencimento fora da sequência vira DATE_SEQUENCE_ANOMALY (sem corrigir)", () => {
    const pags = carne(5);
    pags[3] = pagina(4, linhasBoleto({ numero: 4, total: 5, vencimento: "2026-11-16", centavos: 42778 }));
    const r = lerCarne(pags, CTX(pags));
    const a = r.alertas.find((x) => x.codigo === "DATE_SEQUENCE_ANOMALY")!;
    expect(a.parcela).toBe(4);
    expect(r.parcelas.find((p) => p.numero.valor === 4)!.vencimento.valor).toBe("2026-11-16");
  });

  it("valor impresso diferente da linha digitável: alerta, valor com DV prevalece com confiança reduzida", () => {
    const pags = [pagina(1, linhasBoleto({ numero: 1, total: 1, vencimento: "2026-02-16", centavos: 42778, valorImpresso: 42878 }))];
    const r = lerCarne(pags, CTX(pags));
    expect(r.parcelas[0].valorCentavos.valor).toBe(42778);
    expect(r.parcelas[0].valorCentavos.nivel).not.toBe("ALTA");
    expect(codigos(r.parcelas[0].alertas)).toContain("PRINTED_VALUE_DIVERGES");
  });
});

describe("duplicidade contra o cadastro", () => {
  const existentes: ParcelaExistente[] = [
    { id: "b1", numero: 1, total: 3, vencimento: "2026-02-16", valorCentavos: 42778, temBoleto: false, identificador: null, status: "nao_pago" },
    { id: "b2", numero: 2, total: 3, vencimento: "2026-03-16", valorCentavos: 42778, temBoleto: true, identificador: null, status: "nao_pago" },
  ];
  it("identifica igual, já com boleto e nova", () => {
    const pags = carne(3);
    const r = lerCarne(pags, CTX(pags));
    const { comparacoes } = compararComExistentes(r.parcelas, existentes);
    expect(comparacoes.map((c) => c.situacao)).toEqual(["JA_EXISTE_IGUAL", "JA_TEM_BOLETO", "NOVA"]);
  });
  it("mesmo boleto já anexado é reconhecido pela linha digitável", () => {
    const pags = carne(1);
    const r = lerCarne(pags, CTX(pags));
    const linhaLida = r.parcelas[0].linhaDigitavel.valor!;
    const { comparacoes } = compararComExistentes(r.parcelas, [{ ...existentes[0], temBoleto: true, identificador: linhaLida }]);
    expect(comparacoes[0].situacao).toBe("MESMO_BOLETO_JA_ANEXADO");
  });
  it("carnê complementar impresso como 1/12: sugere a parcela 61 pelo vencimento + valor, sem trocar", () => {
    const cadastro: ParcelaExistente[] = Array.from({ length: 72 }, (_, i) => ({ id: `b${i + 1}`, numero: i + 1, total: 72, vencimento: mensal("2026-02-16", i), valorCentavos: 42778, temBoleto: i < 60, identificador: null, status: "nao_pago" }));
    const pags = [pagina(1, linhasBoleto({ numero: 1, total: 12, vencimento: mensal("2026-02-16", 60), centavos: 42778 }))];
    const r = lerCarne(pags, CTX(pags));
    const { comparacoes } = compararComExistentes(r.parcelas, cadastro);
    expect(r.parcelas[0].numero.valor).toBe(1);
    expect(comparacoes[0].correspondenciaProvavel?.numero).toBe(61);
  });
});

describe("linhas sintéticas", () => {
  it("helper de linha posiciona palavras", () => {
    expect(linha(0.1, [["Vencimento", 0.05]]).palavras).toHaveLength(1);
  });
});
