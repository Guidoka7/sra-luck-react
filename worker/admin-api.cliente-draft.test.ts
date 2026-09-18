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
      origem_venda: null,
      banco: null,
      observacoes_internas: null,
    });
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

  it("o mesmo ClienteDetailDrawer atende lista e modo criação sem required nativo", () => {
    expect(clientesPageSource).toContain('import { ClienteDetailDrawer }');
    expect(clientesPageSource).toContain("creating={modal === null}");
    expect(clientesPageSource).not.toContain("ClienteZipDrawer");
    expect(drawerSource).not.toContain(" required");
    expect(installmentsSource).not.toContain(" required");
  });
});
