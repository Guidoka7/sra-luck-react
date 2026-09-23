import { describe, expect, it } from "vitest";
import { consolidarLeituraExterna, lerTextoDaPagina, paginaVazia, type PaginaLida } from "./carne-leitura";
import { planejarVinculos, type ParcelaAlvo } from "./carne-vinculo";
import { formatarLinha, linhaDeTeste, vencimentoMensal } from "./__fixtures__/boletos";

const CPF = "12345678909";
const REF = "2026-09-23";

function parcelas(total: number, valor = 833.33, inicio = "2026-10", comBoletoAte = 0): ParcelaAlvo[] {
  return Array.from({ length: total }, (_, i) => ({
    id: `p${i + 1}`, numero_parcela: i + 1, valor, data_vencimento: vencimentoMensal(inicio, i), identificador_externo: null, temBoleto: i + 1 <= comBoletoAte,
  }));
}

/** Folha de carnê como o texto nativo do PDF a traria. */
function folha(pagina: number, vencimento: string, valor: number, rotulo: string, cpf = CPF, livre = String(pagina)) {
  const linha = formatarLinha(linhaDeTeste(vencimento, valor, livre));
  const [a, m, d] = vencimento.split("-");
  const texto = `Recibo do Pagador\nPagador: MARIA LUZ CPF ${cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}\nParcela ${rotulo}\nVencimento ${d}/${m}/${a}\nValor do documento R$ ${valor.toFixed(2).replace(".", ",")}\n${linha}\nFicha de compensação\n${linha}`;
  return lerTextoDaPagina(texto, pagina, REF);
}

describe("planejarVinculos — carnê inteiro", () => {
  it("carnê de 60 folhas anexa cada folha na parcela certa, mesmo fora de ordem", () => {
    const alvo = parcelas(72);
    const folhas = Array.from({ length: 60 }, (_, i) => folha(i + 1, vencimentoMensal("2026-10", i), 833.33, `${i + 1}/60`));
    const embaralhadas = [...folhas].reverse();
    const decisoes = planejarVinculos(embaralhadas, alvo, CPF);
    expect(decisoes.every((d) => d.acao === "anexar")).toBe(true);
    for (const d of decisoes) expect(d.boletoId).toBe(`p${d.pagina}`);
  });

  it("carnê parcial seguinte (12x impresso como 1/12) cai nas parcelas 61 a 72", () => {
    const alvo = parcelas(72, 833.33, "2026-10", 60);
    const folhas = Array.from({ length: 12 }, (_, i) => folha(i + 1, vencimentoMensal("2026-10", 60 + i), 833.33, `${i + 1}/12`));
    const decisoes = planejarVinculos(folhas, alvo, CPF);
    expect(decisoes.map((d) => [d.acao, d.boletoId])).toEqual(folhas.map((_, i) => ["anexar", `p${61 + i}`]));
  });

  it("vencimento deslocado para dia útil no mesmo mês ainda anexa pelo mês + valor", () => {
    const alvo = parcelas(3);
    const decisoes = planejarVinculos([folha(1, "2026-11-12", 833.33, "2/3")], alvo, CPF);
    expect(decisoes[0]).toMatchObject({ acao: "anexar", boletoId: "p2" });
  });

  it("CPF de outra pessoa na folha força revisão", () => {
    const decisoes = planejarVinculos([folha(1, "2026-10-10", 833.33, "1/3", "98765432100")], parcelas(3), CPF);
    expect(decisoes[0]).toMatchObject({ acao: "revisar", boletoId: null });
    expect(decisoes[0].motivos).toContain("cpf_da_folha_diverge_da_cliente");
  });

  it("boleto repetido no mesmo arquivo: a segunda folha vai para revisão", () => {
    const f1 = folha(1, "2026-10-10", 833.33, "1/3", CPF, "7");
    const f2 = folha(2, "2026-10-10", 833.33, "1/3", CPF, "7");
    const decisoes = planejarVinculos([f1, f2], parcelas(3), CPF);
    expect(decisoes[0].acao).toBe("anexar");
    expect(decisoes[1]).toMatchObject({ acao: "revisar" });
  });

  it("parcela que já tem boleto nunca é substituída automaticamente", () => {
    const decisoes = planejarVinculos([folha(1, "2026-10-10", 833.33, "1/3")], parcelas(3, 833.33, "2026-10", 1), CPF);
    expect(decisoes[0]).toMatchObject({ acao: "sugerir", boletoId: "p1" });
    expect(decisoes[0].motivos).toContain("parcela_ja_tem_boleto_confirme_a_substituicao");
  });

  it("leitura do agente sem linha digitável validada vira sugestão, não anexo", () => {
    const f: PaginaLida = { ...paginaVazia(1), fonte: "agente", boletosNaPagina: 1, valor: 833.33, vencimento: "2026-10-10" };
    const decisoes = planejarVinculos([f], parcelas(3), CPF);
    expect(decisoes[0]).toMatchObject({ acao: "sugerir", boletoId: "p1" });
  });

  it("valor igual em todas as parcelas e sem vencimento na folha não decide por posição", () => {
    const f: PaginaLida = { ...paginaVazia(2), fonte: "texto", valor: 833.33 };
    const decisoes = planejarVinculos([f], parcelas(3), CPF);
    expect(decisoes[0]).toMatchObject({ acao: "revisar", boletoId: null });
  });

  it("folha ilegível vai para revisão", () => {
    const decisoes = planejarVinculos([paginaVazia(1)], parcelas(3), CPF);
    expect(decisoes[0].motivos).toContain("folha_sem_dados_legiveis");
  });

  it("valor diferente da parcela no mesmo vencimento vira sugestão", () => {
    const decisoes = planejarVinculos([folha(1, "2026-10-10", 900, "1/3")], parcelas(3), CPF);
    expect(decisoes[0]).toMatchObject({ acao: "sugerir", boletoId: "p1" });
  });
});

describe("lerTextoDaPagina", () => {
  it("lê valor e vencimento da linha digitável e o número da parcela do rótulo", () => {
    const f = folha(3, "2026-12-10", 833.33, "03/60");
    expect(f).toMatchObject({ linhaValidada: true, valor: 833.33, vencimento: "2026-12-10", numeroParcela: 3, totalParcelas: 60, boletosNaPagina: 1 });
    expect(f.cpfs).toEqual([CPF]);
  });
});

describe("consolidarLeituraExterna (leitura do agente)", () => {
  it("linha digitável com DVs válidos vira leitura confiável e define valor/vencimento", () => {
    const linha = linhaDeTeste("2027-01-10", 833.33, "9");
    const base: PaginaLida = { ...paginaVazia(4), fonte: "agente", boletosNaPagina: 1, valor: 833.33, vencimento: "2027-01-10" };
    const r = consolidarLeituraExterna(base, linha, REF);
    expect(r).toMatchObject({ linhaValidada: true, valor: 833.33, vencimento: "2027-01-10" });
  });

  it("um dígito lido errado pelo agente é rejeitado e a folha não fica confiável", () => {
    const linha = linhaDeTeste("2027-01-10", 833.33, "9");
    const errada = linha.slice(0, 15) + ((Number(linha[15]) + 3) % 10) + linha.slice(16);
    const base: PaginaLida = { ...paginaVazia(4), fonte: "agente", boletosNaPagina: 1, valor: 833.33, vencimento: "2027-01-10" };
    const r = consolidarLeituraExterna(base, errada, REF);
    expect(r.linhaValidada).toBe(false);
    expect(r.observacoes).toContain("linha_digitavel_lida_nao_confere_dv");
    expect(planejarVinculos([r], parcelas(12, 833.33, "2026-10"), CPF)[0].acao).toBe("sugerir");
  });
});
