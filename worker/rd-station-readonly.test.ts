import { describe, expect, it } from "vitest";
import { assertRdCommercialReadOnly, normalizarDealRd, snapshotUpdatePreservandoLocal } from "./rd-station-readonly";

describe("RD Station CRM — barreira comercial somente leitura", () => {
  it("permite GET", () => {
    expect(() => assertRdCommercialReadOnly("GET")).not.toThrow();
  });

  it.each(["POST", "PATCH", "PUT", "DELETE"])("bloqueia %s em recursos comerciais", (method) => {
    expect(() => assertRdCommercialReadOnly(method)).toThrow("RD_COMMERCIAL_WRITE_FORBIDDEN");
  });
});

describe("RD Station CRM — normalização e separação snapshot/local", () => {
  const deal = {
    id: "deal-123",
    status: "won",
    contact_id: "contact-1",
    campaign_id: "campaign-1",
    source_id: "source-1",
    owner_id: "user-1",
    pipeline_id: "pipeline-1",
    stage_id: "stage-1",
    total_price: 25000,
    created_at: "2026-09-01T12:00:00Z",
    updated_at: "2026-09-14T12:00:00Z",
    custom_fields: [
      { label: "Quantidade parcelas", value: "36" },
      { label: "Valor parcela", value: "900,00" },
    ],
  };

  const snapshot = normalizarDealRd(deal, {
    contatos: new Map([["contact-1", { id: "contact-1", name: "Maria RD", email: "maria@example.com", phone: "61999999999", cpf: "123.456.789-00" }]]),
    campanhas: new Map([["campaign-1", { id: "campaign-1", name: "Campanha RD" }]]),
    fontes: new Map([["source-1", { id: "source-1", name: "Instagram" }]]),
    usuarios: new Map([["user-1", { id: "user-1", name: "Vendedora RD" }]]),
  });

  it("normaliza negócio ganho e preserva IDs externos", () => {
    expect(snapshot).not.toBeNull();
    expect(snapshot).toMatchObject({
      rdStationId: "deal-123",
      rdContactId: "contact-1",
      rdCampaignId: "campaign-1",
      rdSourceId: "source-1",
      rdOwnerId: "user-1",
      rdPipelineId: "pipeline-1",
      rdStageId: "stage-1",
      rdStatus: "won",
      nomeOriginal: "Maria RD",
      emailOriginal: "maria@example.com",
      campanhaOriginal: "Campanha RD",
      origemOriginal: "Instagram",
      vendedoraOriginal: "Vendedora RD",
      valorOriginal: 25000,
    });
  });

  it("atualização posterior do RD produz somente campos externos/snapshot", () => {
    expect(snapshot).not.toBeNull();
    const patch = snapshotUpdatePreservandoLocal(snapshot!);
    expect(patch.rd_nome_original).toBe("Maria RD");
    expect(patch.rd_campanha_original).toBe("Campanha RD");
    expect(patch.rd_snapshot).toEqual(deal);
    expect(patch.payload_original).toEqual(deal);

    const chaves = Object.keys(patch);
    expect(chaves).not.toContain("nome_completo");
    expect(chaves).not.toContain("telefone");
    expect(chaves).not.toContain("email");
    expect(chaves).not.toContain("campanha_local");
    expect(chaves).not.toContain("origem_venda");
    expect(chaves).not.toContain("vendedora_responsavel");
    expect(chaves).not.toContain("valor_contrato");
  });

  it("recusa payload sem ID de negócio", () => {
    expect(normalizarDealRd({ status: "won" })).toBeNull();
  });
});
