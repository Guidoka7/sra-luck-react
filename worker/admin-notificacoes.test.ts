import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classificarStatusPush } from "./admin-notificacoes";

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

  it("sender remove apenas endpoints expirados e usa VAPID do cofre", () => {
    expect(sender).toContain('obterCredencial(env, "web_push", "vapid_private_key")');
    expect(sender).toContain("response.status === 404 || response.status === 410");
    expect(sender).toContain('from("web_push_subscriptions").delete()');
  });
});

describe("Central de Notificações (lotes) no módulo de notificações", () => {
  it("com a central ligada, a rotina por parcela não envia (evita cobrança dupla)", () => {
    expect(source).toContain("if ((await carregarConfigCentral(db)).ativa)");
    expect(source).toContain('ignorado: "central_de_lotes_ativa"');
  });
  it("o lote usa o mesmo envio (registrarNotificacao) e o cron autenticado da rotina", () => {
    expect(source).toContain("enviar: registrarNotificacao");
    expect(source).toContain('path === "/api/cron/notificacoes-financeiras"');
    expect(source).toContain("rotinaAutorizada(request, env)");
  });
  it("auditoria da central é só leitura e restrita às entidades da central", () => {
    expect(source).toContain('path === "/api/admin/notificacoes/lotes/auditoria" && request.method === "GET"');
    expect(source).toContain('.in("entidade", ["notificacao_lotes", "notificacoes_config"])');
  });
});
