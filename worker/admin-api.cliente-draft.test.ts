import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizarNovoCliente } from "./admin-api";

const adminApiSource = readFileSync(new URL("./admin-api.ts", import.meta.url), "utf8");
const drawerSource = readFileSync(new URL("../src/components/admin/clientes/ClienteDetailDrawer.tsx", import.meta.url), "utf8");
const installmentsSource = readFileSync(new URL("../src/components/admin/clientes/ClienteInstallments.tsx", import.meta.url), "utf8");
const clientesPageSource = readFileSync(new URL("../src/app/admin/(painel)/clientes/page.tsx", import.meta.url), "utf8");

describe("ClienteDetailDrawer - criação administrativa opcional", () => {
  it("aceita primeiro salvamento sem nenhum campo visível preenchido", () => {
    const result = normalizarNovoCliente({});
    if ("erro" in result) throw new Error(result.erro);

    expect(result.dados).toMatchObject({
      nome_completo: null,
      cpf: null,
      data_nascimento: null,
      telefone: null,
      email: null,
      procedimento: null,
      consultora: null,
      valor_contrato: null,
      quantidade_parcelas: null,
      origem_venda: null,
      banco: null,
      observacoes_internas: null,
    });
  });

  it("permite salvar draft sem nome", () => {
    const result = normalizarNovoCliente({ cpf: "52998224725", dataNascimento: "1992-04-18" });
    if ("erro" in result) throw new Error(result.erro);
    expect(result.dados.nome_completo).toBeNull();
  });

  it("permite salvar draft sem CPF", () => {
    const result = normalizarNovoCliente({ nomeCompleto: "Maria", dataNascimento: "1992-04-18" });
    if ("erro" in result) throw new Error(result.erro);
    expect(result.dados.cpf).toBeNull();
  });

  it("permite salvar draft sem data de nascimento", () => {
    const result = normalizarNovoCliente({ nomeCompleto: "Maria", cpf: "52998224725" });
    if ("erro" in result) throw new Error(result.erro);
    expect(result.dados.data_nascimento).toBeNull();
  });

  it("normaliza strings vazias para null e nunca fabrica identidade", () => {
    const result = normalizarNovoCliente({
      nomeCompleto: "   ",
      cpf: "",
      dataNascimento: null,
      valorContrato: "",
    });
    if ("erro" in result) throw new Error(result.erro);

    expect(result.dados.nome_completo).toBeNull();
    expect(result.dados.cpf).toBeNull();
    expect(result.dados.data_nascimento).toBeNull();
    expect(result.dados.valor_contrato).toBeNull();
  });

  it("valida CPF somente quando ele é efetivamente informado", () => {
    const invalid = normalizarNovoCliente({ cpf: "123" });
    expect(invalid).toHaveProperty("erro");

    const valid = normalizarNovoCliente({ cpf: "123.456.789-01" });
    if ("erro" in valid) throw new Error(valid.erro);
    expect(valid.dados.cpf).toBe("12345678901");
  });

  it("a criação de cliente não dispara criação de parcelas ou financeiro", () => {
    const start = adminApiSource.indexOf('if(path==="/api/admin/clientes"&&request.method==="POST")');
    const end = adminApiSource.indexOf("const cliente=path.match", start);
    const createRoute = adminApiSource.slice(start, end);

    expect(createRoute).not.toContain('from("boletos")');
    expect(createRoute).not.toContain("salvar_plano_financeiro");
    expect(createRoute).not.toContain("gerarParcelas");
  });

  it("invalida carregamentos financeiros antigos ao trocar a cliente selecionada", () => {
    expect(drawerSource).toContain("useLayoutEffect");
    expect(drawerSource).toContain("financeRequestRef.current += 1");
    expect(drawerSource).toContain("const requestId = ++financeRequestRef.current");
    expect(drawerSource).toContain("if (financeRequestRef.current !== requestId) return");
    expect(drawerSource).toContain('setActiveTab("profile")');
    expect(drawerSource).toContain("setInstallments([])");
    expect(drawerSource).toContain("setHistory([])");
    expect(drawerSource).toContain("setEditing(emptyEditing)");
    expect(drawerSource).toContain("setStatusOpen(false)");
  });

  it("o mesmo ClienteDetailDrawer atende lista e modo criação sem required nativo", () => {
    expect(clientesPageSource).toContain('import { ClienteDetailDrawer }');
    expect(clientesPageSource).toContain("creating={modal === null}");
    expect(clientesPageSource).not.toContain("ClienteZipDrawer");
    expect(drawerSource).not.toContain(" required");
    expect(installmentsSource).not.toContain(" required");
  });
});
