import { describe, expect, it } from "vitest";
import { rotaExclusivaDoDev } from "./admin-rotas-dev";

const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";

describe("áreas exclusivas do Dev", () => {
  it("chaves, configuração, conexão, testes e monitoramento são só do Dev", () => {
    for (const [rota, metodo] of [
      ["/api/admin/integrations/credenciais", "GET"], ["/api/admin/integrations/credenciais", "POST"],
      ["/api/admin/integrations/config", "POST"], ["/api/admin/integrations/catalogo", "GET"],
      ["/api/admin/integrations/testar-conexao", "POST"], ["/api/admin/integrations/web-push/vapid", "POST"],
      ["/api/admin/integrations/gemini/mensagem-do-dia", "POST"], ["/api/admin/integrations/historico", "GET"],
      ["/api/admin/integrations/rd-station/authorize-url", "GET"], ["/api/admin/integrations/rd-station/sync", "POST"],
      ["/api/admin/integrations/conta-azul/authorize-url", "GET"], ["/api/admin/integrations/conta-azul/opcoes", "GET"],
      ["/api/admin/monitoramento-app", "GET"], ["/api/admin/monitoramento-erros", "GET"], ["/api/admin/diagnostico", "GET"],
    ]) expect(rotaExclusivaDoDev(rota, metodo), `${metodo} ${rota}`).toBe(true);
  });

  it("a operação do dia a dia continua com a equipe", () => {
    for (const [rota, metodo] of [
      ["/api/admin/integrations/status", "GET"],
      ["/api/admin/integrations/rd-station/importacoes", "GET"], ["/api/admin/integrations/rd-station/importacoes/revisao", "GET"],
      [`/api/admin/integrations/rd-station/importacoes/${ID}/itens`, "GET"], [`/api/admin/integrations/rd-station/importacoes/itens/${ID}/importar`, "POST"],
      ["/api/admin/integrations/rd-station/importar", "POST"],
      ["/api/admin/integrations/conta-azul/painel", "GET"], ["/api/admin/integrations/conta-azul/conflitos", "GET"],
      [`/api/admin/integrations/conta-azul/conflitos/${ID}/resolver`, "POST"], [`/api/admin/integrations/conta-azul/fila/${ID}/reprocessar`, "POST"],
      ["/api/admin/integrations/conta-azul/sincronizar", "POST"], ["/api/admin/integrations/conta-azul/vincular", "POST"],
    ]) expect(rotaExclusivaDoDev(rota, metodo), `${metodo} ${rota}`).toBe(false);
  });

  it("não afeta o resto do Admin", () => {
    expect(rotaExclusivaDoDev("/api/admin/clientes", "GET")).toBe(false);
    expect(rotaExclusivaDoDev("/api/admin/notificacoes/automacao", "GET")).toBe(false);
    expect(rotaExclusivaDoDev("/api/admin/visao-geral", "GET")).toBe(false);
  });
});
