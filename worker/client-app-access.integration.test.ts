import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminApiSource = readFileSync(new URL("./admin-api.ts", import.meta.url), "utf8");
const workerIndexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const clientAgendaSource = readFileSync(new URL("./client-agenda.ts", import.meta.url), "utf8");
const agendaPageSource = readFileSync(new URL("../src/pages/AgendaPage.tsx", import.meta.url), "utf8");
const drawerSource = readFileSync(new URL("../src/components/admin/clientes/ClienteDetailDrawer.tsx", import.meta.url), "utf8");
const profileHeaderSource = readFileSync(new URL("../src/components/cliente/home/ClientProfileHeader.tsx", import.meta.url), "utf8");
const paymentProgressSource = readFileSync(new URL("../src/components/cliente/parcelas/PagamentoProgressBar.tsx", import.meta.url), "utf8");

describe("integração do acesso ao app e procedimento", () => {
  it("endpoint de liberação revalida requisitos no servidor usando parcelas persistidas", () => {
    const start = adminApiSource.indexOf("const liberarAcessoApp=");
    const end = adminApiSource.indexOf("const jornadaCliente=", start);
    const route = adminApiSource.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(route).toContain('from("boletos").select("id",{count:"exact",head:true})');
    expect(route).toContain("getAppAccessRequirements");
    expect(route).toContain("installmentCount:parcelasCount??0");
    expect(route).toContain("if(!requisitos.canRelease)");
    expect(route).toContain("faltando:requisitos.missing");
    expect(route).toContain("acesso_app_liberado:true");
  });

  it("login continua CPF+nascimento e exige acesso_app_liberado", () => {
    expect(workerIndexSource).toContain('.eq("data_nascimento", nascimento)');
    expect(workerIndexSource).toContain('.select("id,ativo,acesso_app_liberado")');
    expect(workerIndexSource).toContain("if (!cliente.acesso_app_liberado)");
    expect(workerIndexSource).not.toContain("nome_completo", nascimento");
  });

  it("editar procedimento persiste somente em clientes.procedimento e não altera parcelas", () => {
    const start = adminApiSource.indexOf('const cliente=path.match(/^\\/api\\/admin\\/clientes\\/([^/]+)$/);');
    const end = adminApiSource.indexOf('if(cliente&&request.method==="DELETE")', start);
    const patchRoute = adminApiSource.slice(start, end);

    expect(patchRoute).toContain('procedimento:"procedimento"');
    expect(patchRoute).not.toContain('from("boletos")');
    expect(patchRoute).not.toContain("salvar_plano_financeiro");
  });

  it("app lê o procedimento do mesmo campo real e o entrega à Home e às Parcelas", () => {
    expect(clientAgendaSource).toContain('select("id,nome_completo,procedimento,valor_contrato');
    expect(clientAgendaSource).toContain("procedimento: cliente.procedimento");
    expect(agendaPageSource).toContain("procedimento={agenda.cliente.procedimento}");
    expect(agendaPageSource).toContain('<ParcelasTab procedimento={agenda.cliente.procedimento} />');
  });

  it("procedimento vazio permanece seguro na Home e no progresso de parcelas", () => {
    expect(profileHeaderSource).toContain('procedimento ?? "Procedimento a definir"');
    expect(paymentProgressSource).toContain('procedimento ? `Cada parcela aproxima você do seu grande sonho: ${procedimento}.` : "Cada parcela aproxima você do seu tão sonhado procedimento."');
  });

  it("drawer usa a mesma regra central para habilitar a liberação", () => {
    expect(drawerSource).toContain("getAppAccessRequirements");
    expect(drawerSource).toContain("installmentCount: installments.length");
    expect(drawerSource).toContain("!appAccessRequirements.canRelease");
  });

  it("app mantém fallback de planejamento sem expor abas dependentes de parcelas", () => {
    expect(agendaPageSource).toContain("shouldShowPlanningFallback(boletos.boletos.length)");
    expect(agendaPageSource).toContain("Estamos preparando seu planejamento");
    expect(agendaPageSource).toContain("Estamos gerando o seu planejamento. Por favor, aguarde.");
    expect(agendaPageSource).toContain("Assim que estiver pronto, suas parcelas e próximas etapas aparecerão por aqui.");
  });
});
