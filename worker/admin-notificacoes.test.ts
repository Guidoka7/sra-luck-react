import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agruparBoletosNotificaveis, boletoPodeReceberCobrancaAutomatica, classificarStatusPush } from "./admin-notificacoes";

const source = readFileSync(new URL("./admin-notificacoes.ts", import.meta.url), "utf8");
const sender = readFileSync(new URL("./web-push-sender.ts", import.meta.url), "utf8");

function push(overrides: Partial<Parameters<typeof classificarStatusPush>[0]> = {}) {
  return {
    configurado: true,
    assinaturas: 1,
    enviadas: 0,
    falhas: 0,
    removidas: 0,
    erros: [],
    ...overrides,
  };
}

describe("Web Push administrativo", () => {
  it("classifica envio bem-sucedido", () => {
    expect(classificarStatusPush(push({ enviadas: 1 }))).toBe("enviada");
  });

  it("classifica envio parcial", () => {
    expect(classificarStatusPush(push({ assinaturas: 2, enviadas: 1, falhas: 1 }))).toBe("parcial");
  });

  it("classifica ausência de dispositivo sem fingir envio", () => {
    expect(classificarStatusPush(push({ assinaturas: 0 }))).toBe("sem_dispositivo");
  });

  it("classifica VAPID ausente explicitamente", () => {
    expect(classificarStatusPush(push({ configurado: false, assinaturas: 0 }))).toBe("nao_configurado");
  });

  it("classifica falha real do push", () => {
    expect(classificarStatusPush(push({ falhas: 1, erros: ["HTTP 500"] }))).toBe("falhou");
  });

  it("persiste notificação in-app, log e resultado real do push", () => {
    expect(source).toContain('from("notificacoes_cliente").insert');
    expect(source).toContain('from("notificacao_logs").insert');
    expect(source).toContain("enviarWebPushParaCliente(env, db");
    expect(source).toContain("push_enviadas: push.enviadas");
    expect(source).toContain("push_status: pushStatus");
  });

  it("cron usa endpoint interno com segredo, fora do gate /api/admin", () => {
    expect(source).toContain('path === "/api/internal/notificacoes/automacao"');
    expect(source).toContain("cronAuthorized(request, env)");
  });


  it("não cobra automaticamente parcela suspensa ou contrato suspenso/cancelado", () => {
    const base = { id: "b1", cliente_id: "c1", status: "nao_pago", suspensa: false, clientes: { nome_completo: "Ana", ativo: true, status_contrato: "ativo" } };
    expect(boletoPodeReceberCobrancaAutomatica(base)).toBe(true);
    expect(boletoPodeReceberCobrancaAutomatica({ ...base, suspensa: true })).toBe(false);
    expect(boletoPodeReceberCobrancaAutomatica({ ...base, clientes: { ...base.clientes, status_contrato: "suspenso" } })).toBe(false);
    expect(boletoPodeReceberCobrancaAutomatica({ ...base, clientes: { ...base.clientes, status_contrato: "cancelado" } })).toBe(false);
    expect(boletoPodeReceberCobrancaAutomatica({ ...base, status: "pendente_confirmacao" })).toBe(false);
  });

  it("agrupa várias parcelas da mesma cliente em um único envio lógico", () => {
    const cliente = { nome_completo: "Ana", ativo: true, status_contrato: "ativo" };
    const grupos = agruparBoletosNotificaveis([
      { id: "b2", cliente_id: "c1", status: "nao_pago", suspensa: false, data_vencimento: "2026-09-20", clientes: cliente },
      { id: "b1", cliente_id: "c1", status: "nao_pago", suspensa: false, data_vencimento: "2026-08-20", clientes: cliente },
      { id: "b3", cliente_id: "c2", status: "nao_pago", suspensa: false, data_vencimento: "2026-09-22", clientes: { ...cliente, nome_completo: "Bia" } },
    ]);
    expect(grupos).toHaveLength(2);
    expect(grupos.find((g) => g.clienteId === "c1")?.boletos.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("sender remove apenas endpoints expirados e usa VAPID do cofre", () => {
    expect(sender).toContain('obterCredencial(env, "web_push", "vapid_private_key")');
    expect(sender).toContain("response.status === 404 || response.status === 410");
    expect(sender).toContain('from("web_push_subscriptions").delete()');
  });
});
