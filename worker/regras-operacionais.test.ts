import { afterEach, describe, expect, it } from "vitest";
import { requiredPaid } from "./agenda-elegibilidade";
import { getAppAccessRequirements } from "./app-access";
import { DEV_CONSOLE_ADMIN_PREFIX } from "./dev-console-auth";
import { deLinha, percentualMinimoPlano, REGRAS_PADRAO, regrasOperacionaisApi, validarAlteracaoRegras } from "./regras-operacionais";
import { criarTokenAdmin } from "./session";

const SEGREDO = "s".repeat(48);

async function requisicao(adminId: string, body: unknown) {
  const token = await criarTokenAdmin(adminId, SEGREDO);
  return new Request("https://app.test/api/admin/regras-operacionais", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `admin_session=${token}` },
    body: JSON.stringify(body),
  });
}

describe("regras operacionais", () => {
  it("padrões iguais às regras de antes (5 dias úteis, R$ 100.000, 60/70/80%)", () => {
    expect(REGRAS_PADRAO).toMatchObject({ prazoLiberacaoDiasUteis: 5, tetoMensalOperacional: 100000, percentual12a24x: 60, percentual36x: 70, percentual48a72x: 80, appExigeParcela: true, appExigeProcedimento: false });
    expect([12, 18, 24, 36, 48, 60, 72].map((n) => requiredPaid(n))).toEqual([8, 11, 15, 26, 39, 48, 58]);
  });

  it("percentual por plano segue as faixas configuradas", () => {
    const r = deLinha({ percentual_12_24x: 50, percentual_36x: 65, percentual_48_72x: 75 });
    expect([12, 24, 36, 48, 72].map((n) => percentualMinimoPlano(n, r))).toEqual([50, 50, 65, 75, 75]);
  });

  it("valida cada campo e recusa o que não conhece", () => {
    expect(validarAlteracaoRegras({ prazoLiberacaoDiasUteis: 7 })).toEqual({ ok: true, patch: { prazo_liberacao_dias_uteis: 7 } });
    expect(validarAlteracaoRegras({ prazoLiberacaoDiasUteis: 2.5 }).ok).toBe(false);
    expect(validarAlteracaoRegras({ percentual36x: 0 }).ok).toBe(false);
    expect(validarAlteracaoRegras({ tetoMensalOperacional: -1 }).ok).toBe(false);
    expect(validarAlteracaoRegras({ appExigeProcedimento: "sim" }).ok).toBe(false);
    expect(validarAlteracaoRegras({ solicitacaoObrigatoria: false }).ok).toBe(false);
    expect(validarAlteracaoRegras({}).ok).toBe(false);
  });

  it("Admin comum não altera: só a sessão técnica do Dev Console", async () => {
    const env = { CLIENTE_SESSION_SECRET: SEGREDO } as never;
    const admin = await regrasOperacionaisApi(await requisicao("colaborador-123", { prazoLiberacaoDiasUteis: 7 }), env);
    expect(admin?.status).toBe(403);
    // O Dev passa do bloqueio de permissão (aqui para na validação, sem banco).
    const dev = await regrasOperacionaisApi(await requisicao(`${DEV_CONSOLE_ADMIN_PREFIX}gui`, { campoInventado: 1 }), env);
    expect(dev?.status).toBe(400);
  });

  it("requisitos do app respeitam as opções configuradas; CPF e nascimento são sempre exigidos", () => {
    const base = { name: "Maria", cpf: "529.982.247-25", birthDate: "1990-01-01", installmentCount: 0, procedure: "" };
    expect(getAppAccessRequirements(base, "2026-09-24").missing).toEqual(["financeiro"]);
    expect(getAppAccessRequirements(base, "2026-09-24", { requireFinancial: false }).canRelease).toBe(true);
    expect(getAppAccessRequirements(base, "2026-09-24", { requireFinancial: false, requireProcedure: true }).missing).toEqual(["procedimento"]);
    expect(getAppAccessRequirements({ ...base, cpf: "111" }, "2026-09-24", { requireFinancial: false }).missing).toEqual(["cpf"]);
  });
});
