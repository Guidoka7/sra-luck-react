import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../src/app/admin/(painel)/clientes/page.tsx", import.meta.url), "utf8");
const pageCss = readFileSync(new URL("../src/app/admin/(painel)/clientes/ClientesPage.module.css", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../src/styles/admin-reference-shell.css", import.meta.url), "utf8");

describe("Clientes — referência visual e estrutural aprovada", () => {
  it("mantém somente Cadastradas, Aguardando cadastro e Canceladas", () => {
    expect(page).toContain('"cadastradas"');
    expect(page).toContain('"aguardando"');
    expect(page).toContain('"canceladas"');
    expect(page).toContain('aguardando: "Aguardando cadastro"');
    expect(page).not.toContain('"Novas"');
    expect(page).not.toContain('type Funil = "novas"');
  });

  it("não volta ao staging visual antigo nem aos prompts do fluxo anterior", () => {
    expect(page).not.toContain("NovaVenda");
    expect(page).not.toContain("/api/admin/novas-vendas");
    expect(page).not.toContain("window.prompt");
    expect(page).not.toContain("zipChip");
    expect(page).not.toContain("Cadastro em");
    expect(page).toContain("separarClientesAdmin(clientes)");
  });

  it("preserva dimensões centrais do HTML aprovado", () => {
    expect(pageCss).toContain("padding:17px 27px 30px 29px");
    expect(pageCss).toContain("font-size:41px");
    expect(pageCss).toContain("height:53px");
    expect(pageCss).toContain("grid-template-columns:1.05fr 1.2fr .9fr");
    expect(shellCss).toContain("--ref-sidebar:244px");
    expect(shellCss).toContain("--ref-topbar:68px");
  });

  it("mantém a mesma tabela e filtros em todas as abas", () => {
    expect(page).toContain("Todos os bancos");
    expect(page).toContain("Todos os status");
    expect(page).toContain("Qualquer período");
    expect(page).toContain("<th>Vendedora</th>");
    expect(page).toContain("<th>Campanha</th>");
    expect(page).toContain("<th>Banco</th>");
    expect(page).toContain("<th>Status</th>");
  });
});
