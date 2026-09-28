import { describe, expect, it } from "vitest";
import "./integracoes-registro-rd-slug-patch";
import { ESQUEMAS_CONFIG } from "./integracoes-registro";

const PIPELINE = "a".repeat(24);

function validar(config: unknown) {
  return ESQUEMAS_CONFIG.rd_station.importacao.validar(config) as { ok: boolean; config?: any; erro?: string };
}

describe("slugs reais do RD na configuração", () => {
  it("preserva hífen em campos selecionados e no preenchimento do funil", () => {
    const fonte = "deal:quantidade-de-parcelas";
    const r = validar({
      ativo: false,
      frequenciaMinutos: 60,
      status: "won",
      mapeamento: {},
      funis: [{
        pipelineId: PIPELINE,
        etapas: [],
        mapeamento: { quantidade_parcelas: fonte },
        camposSelecionados: [{ fonte, rotulo: "Quantidade de parcelas" }],
      }],
      deduplicarPor: { cpf: true, telefone: true, email: true },
    });
    expect(r.ok).toBe(true);
    expect(r.config.funis[0].mapeamento.quantidade_parcelas).toBe(fonte);
    expect(r.config.funis[0].camposSelecionados).toEqual([{ fonte, rotulo: "Quantidade de parcelas" }]);
  });

  it("continua rejeitando origem fora do formato permitido", () => {
    const r = validar({
      ativo: false,
      frequenciaMinutos: 60,
      status: "won",
      mapeamento: {},
      funis: [{ pipelineId: PIPELINE, etapas: [], mapeamento: {}, camposSelecionados: [{ fonte: "deal:campo.invalido", rotulo: "Inválido" }] }],
      deduplicarPor: { cpf: true, telefone: true, email: true },
    });
    expect(r.ok).toBe(false);
  });
});
