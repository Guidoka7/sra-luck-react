import { describe, expect, it } from "vitest";
import { validarCampanha } from "./home-campanhas";
import { adminReadPermissions } from "./admin-route-permissions";
import { PERMISSOES_ADMIN as P } from "./admin-auth";

describe("validação do carrossel", () => {
  it("aceita ajuste de cartão padrão", () => {
    const v = validarCampanha("clube-vantagens", { ativo: false, ordem: 3, title: "Olá", tema: "vinho", action: "clube" });
    expect(v).toMatchObject({ linha: { id: "clube-vantagens", base_id: null, ativo: false, ordem: 3, dados: { title: "Olá", tema: "vinho", action: "clube" } } });
  });
  it("recusa cartão desconhecido, tema/destino inválidos e textos longos", () => {
    expect(validarCampanha("nao-existe", {})).toMatchObject({ erro: expect.any(String) });
    expect(validarCampanha("clube-vantagens", { tema: "neon" })).toMatchObject({ erro: "Tema inválido." });
    expect(validarCampanha("clube-vantagens", { action: "campanhas" })).toMatchObject({ erro: "Destino inválido." });
    expect(validarCampanha("clube-vantagens", { title: "x".repeat(81) })).toMatchObject({ erro: expect.stringContaining("title") });
    expect(validarCampanha("clube-vantagens", { ordem: 1.5 })).toMatchObject({ erro: "Ordem inválida." });
  });
  it("cartão novo precisa de modelo e dos textos principais", () => {
    expect(validarCampanha("custom-abc123", { title: "a", description: "b", cta: "c" })).toMatchObject({ erro: expect.stringContaining("modelo") });
    expect(validarCampanha("custom-abc123", { baseId: "clube-vantagens", title: "a" })).toMatchObject({ erro: expect.stringContaining("título") });
    expect(validarCampanha("custom-abc123", { baseId: "clube-vantagens", title: "a", description: "b", cta: "c" })).toMatchObject({ linha: { base_id: "clube-vantagens" } });
  });
  it("leitura do Admin exige permissão de configurações", () => {
    expect(adminReadPermissions("/api/admin/home-campanhas")).toEqual([P.CONFIGURACOES_GERENCIAR]);
  });
});
