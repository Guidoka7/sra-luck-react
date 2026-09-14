import { describe, expect, it } from "vitest";
import { gerarConfiguracaoVapid, normalizarSubjectVapid, validarConfiguracaoVapid } from "./web-push-config";

describe("Configuração VAPID pelo painel", () => {
  it("normaliza e-mail simples para mailto", () => {
    expect(normalizarSubjectVapid("Financeiro@Exemplo.com.br")).toBe("mailto:financeiro@exemplo.com.br");
  });

  it("rejeita subject inseguro ou inválido", () => {
    expect(normalizarSubjectVapid("ftp://exemplo.com")).toBeNull();
    expect(normalizarSubjectVapid("sem-email")).toBeNull();
  });

  it("gera um par P-256 válido e pareado", async () => {
    const config = await gerarConfiguracaoVapid("push@exemplo.com.br");
    const validacao = await validarConfiguracaoVapid(config);
    expect(validacao.valido).toBe(true);
    expect(validacao.subject).toBe("mailto:push@exemplo.com.br");
    expect(validacao.publicKey).toBeTruthy();
    expect(validacao.privateKey).toBeTruthy();
  });

  it("detecta chave privada que não pertence à chave pública", async () => {
    const a = await gerarConfiguracaoVapid("push@exemplo.com.br");
    const b = await gerarConfiguracaoVapid("push@exemplo.com.br");
    const validacao = await validarConfiguracaoVapid({ ...a, privateKey: b.privateKey });
    expect(validacao.valido).toBe(false);
  });

  it("rejeita material criptográfico malformado", async () => {
    const validacao = await validarConfiguracaoVapid({
      subject: "push@exemplo.com.br",
      publicKey: "abc",
      privateKey: "def",
    });
    expect(validacao.valido).toBe(false);
  });
});
