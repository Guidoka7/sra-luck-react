import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration060 = readFileSync(new URL("../supabase/migration_060_agenda_operacional_definitiva.sql", import.meta.url), "utf8");
const migration061 = readFileSync(new URL("../supabase/migration_061_agenda_percentual_parcelas_reais.sql", import.meta.url), "utf8");
const migration062 = readFileSync(new URL("../supabase/migration_062_agenda_quitacao_valor_editado.sql", import.meta.url), "utf8");
const migration063 = readFileSync(new URL("../supabase/migration_063_agenda_liberada_etapa_4.sql", import.meta.url), "utf8");
const adminAgenda = readFileSync(new URL("./admin-agenda.ts", import.meta.url), "utf8");
const clientAgenda = readFileSync(new URL("./client-agenda.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/app/admin/(painel)/agenda/page.tsx", import.meta.url), "utf8");
const pageCss = readFileSync(new URL("../src/app/admin/(painel)/agenda/AgendaPage.module.css", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../src/components/admin/clientes/ClienteDetailDrawer.tsx", import.meta.url), "utf8");
const finance = readFileSync(new URL("../src/components/admin/clientes/ClienteFinanceTab.tsx", import.meta.url), "utf8");
const panels = readFileSync(new URL("../src/components/admin/clientes/ClienteAgendaFinancePanels.tsx", import.meta.url), "utf8");
const stages = readFileSync(new URL("../src/components/cliente/AgendaEtapasInterativas.tsx", import.meta.url), "utf8");
const blocked = readFileSync(new URL("../src/components/cliente/AgendaBloqueadaShell.tsx", import.meta.url), "utf8");
const surgeryCalendar = readFileSync(new URL("../src/components/cliente/CalendarioCirurgia.tsx", import.meta.url), "utf8");
const boletoTab = readFileSync(new URL("../src/components/cliente/TabBoletos.tsx", import.meta.url), "utf8");
const paymentProgress = readFileSync(new URL("../src/components/cliente/parcelas/PagamentoProgressBar.tsx", import.meta.url), "utf8");
const clientBoletos = readFileSync(new URL("./client-boletos.ts", import.meta.url), "utf8");

describe("Agenda definitiva — regras críticas do PR #48", () => {
  it("calcula 70% pelas parcelas reais persistidas, sem total_parcelas ou quantidade_parcelas como denominador", () => {
    const fn = migration061.match(/create or replace function public\.porcentagem_pagamento[\s\S]*?\$\$;/i)?.[0] ?? "";
    const gate = migration061.match(/create or replace function public\.pode_agendar[\s\S]*?\$\$;/i)?.[0] ?? "";
    expect(fn).toContain("count(*) filter (where status = 'pago')");
    expect(fn).toContain("nullif(count(*)::numeric, 0)");
    expect(fn).not.toContain("max(total_parcelas)");
    expect(gate).toContain("public.percentual_minimo_fluxo_agenda()");
    expect(gate).toContain("exists(select 1 from public.boletos");
    expect(gate).not.toContain("quantidade_parcelas");
  });

  it("exibe a mesma meta central de 70% também nas barras financeiras do app", () => {
    expect(clientBoletos).toContain("percentual_minimo_agenda: Number(percentualMinimo ?? 70)");
    expect(boletoTab).toContain("progresso.percentual_minimo_agenda || 70");
    expect(paymentProgress).toContain("progresso.percentual_minimo_agenda || 70");
    expect(boletoTab).not.toContain("percentualNecessario");
    expect(paymentProgress).not.toContain("percentualNecessario");
    expect(boletoTab).not.toContain("Sua agenda já está liberada");
    expect(paymentProgress).not.toContain("Sua agenda já está liberada");
    expect(boletoTab).toContain("segue para o levantamento financeiro");
    expect(paymentProgress).toContain("segue para o levantamento financeiro");
  });

  it("mantém o helper legado de agenda alinhado à Etapa 4", () => {
    expect(migration063).toContain("public.pode_agendar(p_cliente_id)");
    expect(migration063).toContain("c.status_revisao_financeira = 'aprovada'");
    expect(migration063).toContain("c.financeiro_confirmado_em is not null");
    expect(migration063).toContain("solicitacoes_liberacao_financeira");
    expect(migration063).toContain("s.status in ('pendente','em_analise','aprovada')");
  });

  it("deriva valor total e saldo das parcelas reais, incluindo valores individuais diferentes", () => {
    expect(adminAgenda).toContain("const total = bills.reduce((sum, item) => sum + number(item.valor), 0)");
    expect(adminAgenda).toContain("bills.filter((item) => item.status !== \"pago\").reduce((sum, item) => sum + number(item.valor), 0)");
    expect(adminAgenda).toContain("settlementBalance: client.financeiro_saldo_restante == null ? summary.open : number(client.financeiro_saldo_restante)");
    expect(migration060).toContain("coalesce(sum(valor),0)::numeric(12,2)");
    expect(migration060).toContain("coalesce(sum(valor) filter (where status <> 'pago'),0)::numeric(12,2)");
  });

  it("persiste levantamento editável e publica somente formas explicitamente escolhidas", () => {
    expect(migration060).toContain("financeiro_saldo_restante = round(p_saldo_final,2)");
    expect(migration060).toContain("financeiro_formas_custeio = p_formas");
    expect(migration060).toContain("('cartao','pix','boleto_100','cheques')");
    expect(clientAgenda).toContain("formasPermitidas.includes(formaCusteio)");
    expect(clientAgenda).toContain('status: "aprovada"');
  });


  it("persiste saldo final editado sem violar a escrituração financeira", () => {
    expect(migration062).toContain("financeiro_saldo_restante");
    expect(migration062).toContain("v_desconto := round(v_boleto.valor - v_valor,2)");
    expect(migration062).toContain("v_juros := round(v_valor - v_boleto.valor,2)");
    expect(migration062).toContain("valor_original,juros,multa,desconto,valor_recebido");
    expect(migration062).toContain("round(v_alocado,2) <> round(v_total_final,2)");
    expect(migration062).toContain("'valor_recebido',v_total_final");
  });

  it("mantém filtros mensais determinísticos e datas civis em America/Sao_Paulo", () => {
    expect(adminAgenda).toContain('timeZone: "America/Sao_Paulo"');
    expect(adminAgenda).toContain("const returnedMonth = returnToStage4");
    expect(adminAgenda).toContain("const operationalMonth = returnToStage4 ? returnedMonth");
    expect(adminAgenda).toContain("if (operationalMonth === month)");
    expect(adminAgenda).toContain("appointment.horario_termos");
    expect(adminAgenda).toContain('client.status_revisao_financeira === "aprovada"');
    expect(adminAgenda).toContain("client.financeiro_confirmado_em");
    expect(adminAgenda).toContain("date?.slice(0,7) === month");
    expect(adminAgenda).toContain("appointment.data_cirurgia.slice(0,7) !== month");
    expect(page).toContain('timeZone: "America/Sao_Paulo"');
    expect(panels).toContain('timeZone: "America/Sao_Paulo"');
  });

  it("fila de liberação financeira exige fatos explícitos antes de listar a cliente", () => {
    expect(adminAgenda).toContain('client.status_revisao_financeira !== "aprovada"');
    expect(adminAgenda).toContain("!client.financeiro_confirmado_em");
    expect(adminAgenda).toContain('choice.status === "recusada"');
    expect(adminAgenda).toContain("!date || !appointment.horario_termos");
  });

  it("gateia a Agenda de Termos pela Etapa 4 e reserva com lock de banco", () => {
    const fn = migration060.match(/create or replace function public\.agendar_data[\s\S]*?exception[\s\S]*?end;\n\$\$;/i)?.[0] ?? "";
    expect(fn).toContain("for update");
    expect(fn).toContain("LEVANTAMENTO_NAO_CONCLUIDO");
    expect(fn).toContain("FORMA_QUITACAO_NAO_ESCOLHIDA");
    expect(fn).toContain("VAGAS_ESGOTADAS");
    expect(fn).toContain("v_ocupadas >= v_data.vagas_totais");
    expect(clientAgenda).toContain("if (etapa4 && !agendaAtual)");
  });

  it("reserva cirurgia com capacidade transacional e corte individual da previsão", () => {
    const fn = migration060.match(/create or replace function public\.agenda_reservar_cirurgia[\s\S]*?end;\n\$\$;/i)?.[0] ?? "";
    expect(fn).toContain("for update");
    expect(fn).toContain("p_data < v.previsao_cirurgia");
    expect(fn).toContain("VAGAS_ESGOTADAS");
    expect(fn).toContain("HORARIO_OCUPADO");
    expect(clientAgenda).toContain('const status = beforeForecast || full ? "lotada"');
    expect(surgeryCalendar).toContain('status==="lotada"?"LOTADA":"FECHADA"');
  });

  it("libera cirurgia somente pela condição AND persistida no backend", () => {
    const gate = migration060.match(/create or replace function public\.agenda_tentar_liberar_cirurgia[\s\S]*?end;\n\$\$;/i)?.[0] ?? "";
    expect(gate).toContain("v.previsao_cirurgia_confirmada_em is not null");
    expect(gate).toContain("v.comparecimento_status = 'compareceu'");
    expect(gate).toContain("v.quitacao_status = 'paga'");
    expect(gate).toContain("agenda_cirurgica_liberada_em");
    expect(migration060).toContain("PREVISAO_NAO_CONFIRMADA");
  });

  it("retorna automaticamente à Etapa 4 por ausência ou não pagamento preservando auditoria", () => {
    expect(migration060).toContain("'registrou_ausencia_termos'");
    expect(migration060).toContain("'registrou_pagamento_nao_realizado'");
    expect(migration060).toContain("'retorno','etapa_4'");
    expect(migration060).toContain("set agendamento_id = null");
    expect(migration060).toContain("status = 'cancelado'");
  });

  it("usa exclusivamente a carta de crédito no teto mensal e evita dupla contagem previsão + cirurgia", () => {
    const committed = migration060.match(/create or replace function public\.agenda_comprometimento_mes[\s\S]*?\$\$;/i)?.[0] ?? "";
    expect(committed).toContain("c.valor_contrato");
    expect(committed).toContain("when a.data_cirurgia is not null then a.data_cirurgia");
    expect(committed).toContain("when a.previsao_cirurgia_confirmada_em is not null then a.previsao_cirurgia");
    expect(committed).toContain("distinct on (cliente_id)");
    expect(migration060).toContain("if v_projecao > 100000 then raise exception 'TETO_MENSAL_EXCEDIDO'");
    expect(panels).toContain("Carta de crédito");
    expect(panels).toContain("row.creditLetter");
    expect(panels).toContain('disabled={row.classification === "over"}');
    expect(panels).toContain("forecastOverCap");
    expect(panels).toContain("ultrapassa o teto de R$ 100.000,00");
  });

  it("força o drawer por clientId + context sem reutilizar a última aba visual", () => {
    expect(drawer).toContain('context?: "default" | "terms-flow" | "finance-release" | "surgery-final"');
    expect(drawer).toContain('const forcedFinance = context === "finance-release" || context === "surgery-final"');
    expect(drawer).toContain('forcedFinance ? "finance" : initialTab');
    expect(page).toContain('openClient(row,"finance-release")');
    expect(page).toContain('?"surgery-final":"terms-flow"');
    expect(page).toContain('context={drawer?.context ?? "default"}');
    expect(finance).toContain('agendaContext === "finance-release" || agendaContext === "surgery-final"');
    expect(finance).toContain('!["formacao_saldo", "levantamento"].includes(agendaFlow.client.stage)');
    expect(finance).toContain("allowInteraction={installmentsInteractive}");
  });

  it("mantém etapas 1–3 expandidas e deixa apenas a Etapa 4 recolhível", () => {
    expect(stages).toContain('useState(atual!=="data")');
    expect(stages).toContain('if(atual!=="data") return card');
    expect(blocked).not.toContain("setAberta");
    expect(blocked).toContain("A agenda dos termos será liberada somente na Etapa 4.");
  });

  it("preserva o handoff visual da Agenda sem uma segunda barra de tabs antiga", () => {
    expect(page).toContain(">Termos cirúrgicos</button>");
    expect(page).toContain(">Liberação financeira</button>");
    expect(page).toContain(">Cirurgias</button>");
    expect(page).toContain('<span className={styles.listFilterLabel}>Exibir</span>');
    expect(page).toContain('<option value="eligible">Levantamentos</option>');
    expect(page).toContain('<option value="confirmed">Termos confirmados</option>');
    expect(page).not.toContain("styles.secondary");
    expect(pageCss).not.toContain(".secondary{");
    expect(pageCss).toContain("padding:18px 22px 32px");
    expect(pageCss).toContain("max-width:1570px");
    expect(pageCss).toContain("font-size:39px");
    expect(pageCss).toContain("grid-template-columns:minmax(0,1.38fr) minmax(430px,1fr)");
    expect(pageCss).toContain("grid-template-columns:minmax(0,1fr) 205px");
    expect(pageCss).toContain("min-height:434px");
    expect(pageCss).toContain("height:40px");
    expect(pageCss).toContain("min-height:61px");
  });

  it("a rota principal não renderiza os módulos antigos da Agenda", () => {
    expect(page).toContain('from "@/features/agenda/agendaApi"');
    expect(page).toContain('from "./AgendaPage.module.css"');
    expect(page).not.toContain("RevisaoFinanceiraCard");
    expect(page).not.toContain("PrevisaoLiberacaoFinanceiraInteligente");
    expect(page).not.toContain("createClientSupabaseClient");
    expect(page).not.toContain("ClienteZipDrawer");
  });

  it("gráfico final soma carta de crédito somente de cirurgias finais", () => {
    expect(adminAgenda).toContain("if (!appointment?.data_cirurgia || appointment.data_cirurgia.slice(0,7) !== month) continue");
    expect(adminAgenda).toContain("appointment.quitacao_status !== \"paga\"");
    expect(adminAgenda).toContain("appointment.comparecimento_status !== \"compareceu\"");
    expect(adminAgenda).toContain("sum += number(client.valor_contrato)");
    expect(adminAgenda).toContain("!appointment.termos_assinados_em");
    expect(adminAgenda).toContain("!appointment.cirurgia_escolhida_em");
    expect(adminAgenda).toContain('choice.status === "recusada"');
    expect(page).toContain("Soma das cartas de crédito das clientes com cirurgia confirmada no último estágio.");
  });
});
