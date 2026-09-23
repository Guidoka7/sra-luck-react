import { describe, expect, it } from "vitest";
import { caminhoAteMeta, descreverEvento, estadoVoucher, etapaIndicacao, linkConviteWhatsApp, mascaraTelefone, pontosACaminho, proximoPremio } from "./clubeRegras";

const premio = (id: string, pontos: number, estoque: number | null = 5) => ({ id, titulo: id, pontos, estoque, descricao: null, categoria: null, ativo: true, ordem: 0, icone_key: null, instrucoes_pos_resgate: null });

describe("Clube — regras de exibição", () => {
  it("mostra o próximo prêmio ainda não alcançado e quanto falta", () => {
    const r = proximoPremio([premio("b", 900), premio("a", 450), premio("esgotado", 100, 0)], 320);
    expect(r.alvo?.id).toBe("a");
    expect(r.faltam).toBe(130);
    expect(r.progresso).toBe(71);
    expect(proximoPremio([premio("a", 450)], 500)).toEqual({ alvo: null, faltam: 0, progresso: 100 });
  });

  it("descreve o extrato pelo motivo real do crédito", () => {
    expect(descreverEvento({ id: "1", tipo: "bonus", pontos: 10, referencia: null, metadata: { motivo: "parcela_em_dia", numero_parcela: 3 }, created_at: "" })).toBe("Parcela 3 paga em dia");
    expect(descreverEvento({ id: "2", tipo: "indicacao", pontos: 200, referencia: null, metadata: { motivo: "indicacao_venda", nome_indicado: "Bia" }, created_at: "" })).toBe("Indicação: Bia fechou");
    expect(descreverEvento({ id: "3", tipo: "resgate", pontos: -450, referencia: null, metadata: { titulo: "Nécessaire" }, created_at: "" })).toBe("Resgate: Nécessaire");
  });

  it("acompanha a indicação até os pontos", () => {
    const base = { id: "i", nome_indicado: "Bia", pontos_creditados: 0, created_at: "" };
    expect(etapaIndicacao({ ...base, status: "enviada" }, 200).passo).toBe(0);
    expect(etapaIndicacao({ ...base, status: "qualificada" }, 200).rotulo).toBe("Em conversa");
    expect(etapaIndicacao({ ...base, status: "venda" }, 200).detalhe).toContain("200 pontos");
    expect(etapaIndicacao({ ...base, status: "venda", pontos_creditados: 200 }, 200)).toMatchObject({ rotulo: "+200 pontos", passo: 3 });
    expect(etapaIndicacao({ ...base, status: "invalidada" }, 200).tom).toBe("encerrada");
  });

  it("estado do voucher da consulta", () => {
    const v = { id: "v", beneficio_key: "voucher_consulta_doutor", status: "disponivel" as const, origem: "primeira_parcela", created_at: "" };
    expect(estadoVoucher(null)).toBe("bloqueado");
    expect(estadoVoucher(v)).toBe("liberado");
    expect(estadoVoucher({ ...v, solicitado_em: "2026-09-23" })).toBe("solicitado");
    expect(estadoVoucher({ ...v, solicitado_em: "2026-09-23", arquivo_disponivel: true })).toBe("pronto");
    expect(estadoVoucher({ ...v, status: "utilizado" })).toBe("utilizado");
  });

  it("WhatsApp: máscara e convite para a amiga", () => {
    expect(mascaraTelefone("61999990000")).toBe("(61) 99999-0000");
    expect(mascaraTelefone("6133334444")).toBe("(61) 3333-4444");
    const link = linkConviteWhatsApp("Bia Souza", "(61) 99999-0000", "Maria Luz");
    expect(link.startsWith("https://wa.me/5561999990000?text=")).toBe(true);
    expect(decodeURIComponent(link)).toContain("Oi, Bia, aqui é a Maria!");
  });
});

describe("inteligência do cartão de pontos", () => {
  const base = { aCaminho: 0, primeiraParcelaConcluida: true, pontosPrimeiraParcela: 50, pontosParcelaEmDia: 10, pontosIndicacao: 200 };

  it("soma só as indicações que fecharam e ainda não creditaram", () => {
    const itens = [
      { status: "venda", pontos_creditados: 0 }, { status: "venda", pontos_creditados: 200 },
      { status: "qualificada", pontos_creditados: 0 }, { status: "venda", pontos_creditados: 0 },
    ] as Parameters<typeof pontosACaminho>[0];
    expect(pontosACaminho(itens, 200)).toBe(400);
  });

  it("sugere o caminho mais curto com as regras reais", () => {
    expect(caminhoAteMeta({ ...base, faltam: 20 })).toBe("Caminho mais rápido: 2 parcelas em dia.");
    expect(caminhoAteMeta({ ...base, faltam: 400 })).toBe("Caminho mais rápido: 2 amigas indicadas que fecharem.");
    expect(caminhoAteMeta({ ...base, faltam: 220 })).toBe("Caminho mais rápido: 1 amiga indicada e 2 parcelas em dia.");
    expect(caminhoAteMeta({ ...base, faltam: 290 })).toBe("Caminho mais rápido: 2 amigas indicadas que fecharem.");
    expect(caminhoAteMeta({ ...base, faltam: 150 })).toBe("Caminho mais rápido: 1 amiga indicada que fechar.");
  });

  it("considera a missão da 1ª parcela e os pontos a caminho", () => {
    expect(caminhoAteMeta({ ...base, primeiraParcelaConcluida: false, faltam: 40 })).toBe("Pague a 1ª parcela e ele é seu.");
    expect(caminhoAteMeta({ ...base, primeiraParcelaConcluida: false, faltam: 70 })).toBe("Caminho mais rápido: a 1ª parcela e 2 parcelas em dia.");
    expect(caminhoAteMeta({ ...base, aCaminho: 200, faltam: 150 })).toBe("Os pontos a caminho já completam este prêmio.");
    expect(caminhoAteMeta({ ...base, aCaminho: 200, faltam: 210 })).toBe("Caminho mais rápido: 1 parcela em dia.");
    expect(caminhoAteMeta({ ...base, faltam: 0 })).toBeNull();
  });
});
