import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../src/app/admin/(painel)/financeiro/page.tsx", import.meta.url), "utf8");
const pageCss = readFileSync(new URL("../src/app/admin/(painel)/financeiro/FinanceiroPage.module.css", import.meta.url), "utf8");
const adminFinance = readFileSync(new URL("./admin-financeiro.ts", import.meta.url), "utf8");
const clientBoletos = readFileSync(new URL("./client-boletos.ts", import.meta.url), "utf8");
const rpcMigration = readFileSync(new URL("../supabase/migration_033_financeiro_unificado.sql", import.meta.url), "utf8");
const uploadMigration = readFileSync(new URL("../supabase/migration_058_comprovante_enviado_em.sql", import.meta.url), "utf8");
const eligibilityMigration = readFileSync(new URL("../supabase/migration_059_pode_agendar_percentual_cliente.sql", import.meta.url), "utf8");
const profile = readFileSync(new URL("../src/components/admin/clientes/ClienteProfileTab.tsx", import.meta.url), "utf8");
const financeTab = readFileSync(new URL("../src/components/admin/clientes/ClienteFinanceTab.tsx", import.meta.url), "utf8");

describe("Financeiro definitivo — handoff aprovado", () => {
  it("substitui o funil visual antigo pelas quatro abas aprovadas", () => {
    expect(page).toContain('"proofs", label: "Comprovantes"');
    expect(page).toContain('"received", label: "Recebidos"');
    expect(page).toContain('"late", label: "Atrasados"');
    expect(page).toContain('"all", label: "Todas"');
    expect(page).toContain("financeiroApi.painel()");
    expect(page).toContain("<ClienteDetailDrawer");
    expect(page).toContain('financeMode="compact"');
    expect(page).not.toContain("ClienteZipDrawer");
    expect(page).not.toContain("Aguardando conferência");
    expect(page).not.toContain('label: "Ativos"');
    expect(page).not.toContain('label: "Cancelados"');
  });

  it("mantém as dimensões centrais do HTML de handoff", () => {
    expect(pageCss).toContain("padding:18px 28px 28px 30px");
    expect(pageCss).toContain("font-size:41px");
    expect(pageCss).toContain("height:56px");
    expect(pageCss).toContain("grid-template-columns:minmax(340px,1fr) 138px 152px 150px 108px");
    expect(pageCss).toContain("width:min(700px,92vw)");
    expect(pageCss).toContain("height:50px");
  });

  it("usa a data real de upload do comprovante e a mesma tabela de parcelas do app", () => {
    expect(uploadMigration).toContain("comprovante_enviado_em timestamptz");
    expect(adminFinance).toContain("comprovante_enviado_em");
    expect(adminFinance).toContain('path === "/api/admin/financeiro/painel"');
    expect(clientBoletos).toContain('status: "pendente_confirmacao"');
    expect(clientBoletos).toContain("comprovante_enviado_em: comprovanteEnviadoEm");
    expect(clientBoletos).toContain('acao: "enviou_comprovante"');
    expect(adminFinance).toContain('db.from("boletos")');
    expect(clientBoletos).toContain('supabase.from("boletos")');
  });

  it("preserva confirmação atômica, idempotência e auditoria do domínio financeiro", () => {
    expect(rpcMigration).toContain("financeiro_validar_comprovante");
    expect(rpcMigration).toContain("for update");
    expect(rpcMigration).toContain("v_boleto.status <> 'pendente_confirmacao'");
    expect(rpcMigration).toContain("insert into public.financeiro_recebimentos");
    expect(rpcMigration).toContain("set status = 'pago'");
    expect(rpcMigration).toContain("insert into public.logs_alteracoes");
    expect(adminFinance).toContain('db.rpc("financeiro_validar_comprovante"');
  });

  it("usa o percentual mínimo real da cliente na elegibilidade compartilhada com o app", () => {
    expect(eligibilityMigration).toContain("c.percentual_minimo_agendar");
    expect(eligibilityMigration).toContain("public.porcentagem_pagamento(p_cliente_id)");
    expect(eligibilityMigration).toContain("when c.quantidade_parcelas in (12, 18, 24) then 60");
    expect(eligibilityMigration).toContain("when c.quantidade_parcelas = 36 then 70");
    expect(eligibilityMigration).toContain("else 80");
  });

  it("mantém Jornada recolhida no Perfil e Financeiro compacto sem os blocos removidos", () => {
    expect(profile).toContain("useState(false)");
    expect(profile).toContain('aria-expanded={journeyExpanded}');
    expect(profile).toContain("Agora ·");
    expect(profile).toContain('"Expandir"');
    expect(financeTab).toContain("{!compact ? <>");
    expect(financeTab).toContain("<ClienteInstallments");
  });
});
