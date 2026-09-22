import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenAdmin } from "./session";
import { buscarColaboradorAdminAtivo, temPermissaoAdmin, PERMISSOES_ADMIN } from "./admin-auth";
import { forecastLiberacoes } from "./admin-reports";
import { agoraSaoPaulo, calcularPrazoCirurgicoComAjuste } from "./surgery-release";

type Db = ReturnType<typeof createServiceSupabaseClient>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * Motor de relatórios (Fase 10). Todo relatório do catálogo é lido de tabelas
 * reais do Supabase — nada aqui gera números fictícios. Um relatório sem base
 * de dados implementada (ex.: webhooks de integrações, que dependem da tabela
 * `integracao_eventos` ainda não criada) fica marcado com `indisponivel` e
 * nunca retorna uma contagem inventada.
 */

interface Filtros {
  periodoInicio?: string;
  periodoFim?: string;
  status?: string;
  vendedoraId?: string;
  busca?: string;
}

interface ResultadoRelatorio {
  colunas: string[];
  linhas: string[][];
  resumo: { label: string; value: string }[];
  totalRegistros: number;
  indisponivel?: string;
}

interface RelatorioDef {
  id: string;
  modulo: string;
  nome: string;
  desc: string;
  icone: string;
}

const MODULOS: Record<string, { label: string; sub: string; icone: string }> = {
  clientes: { label: "Clientes", sub: "Cadastros, contratos e origem", icone: "☻" },
  financeiro: { label: "Financeiro", sub: "Parcelas, recebimentos e conferência", icone: "$" },
  agenda: { label: "Agenda / Jornada", sub: "Termos, quitação, liberação e cirurgia", icone: "◷" },
  previsoes: { label: "Previsões", sub: "Elegibilidade, janelas e capacidade", icone: "↗" },
  operacao: { label: "Operação", sub: "PWA, notificações e monitoramento", icone: "◎" },
  equipe: { label: "Equipe", sub: "Usuários internos e auditoria", icone: "👥" },
  integracoes: { label: "Integrações", sub: "Conexões, syncs e webhooks", icone: "⌁" },
};

export const REPORT_CATALOG: RelatorioDef[] = [
  { id: "c1", modulo: "clientes", nome: "Novas clientes", desc: "Clientes cadastradas no período (data de cadastro real).", icone: "+" },
  { id: "c2", modulo: "clientes", nome: "Aguardando cadastro", desc: "Vendas recebidas que ainda não geraram cadastro completo de cliente.", icone: "…" },
  { id: "c3", modulo: "clientes", nome: "Clientes cadastradas", desc: "Todas as clientes com registro na base.", icone: "✓" },
  { id: "c4", modulo: "clientes", nome: "Clientes ativas", desc: "Clientes com contrato ativo (status_contrato = ativo).", icone: "●" },
  { id: "c5", modulo: "clientes", nome: "Suspensas", desc: "Clientes com contrato suspenso.", icone: "Ⅱ" },
  { id: "c6", modulo: "clientes", nome: "Negativadas", desc: "Clientes com contrato negativado.", icone: "!" },
  { id: "c7", modulo: "clientes", nome: "Canceladas", desc: "Clientes com contrato cancelado.", icone: "×" },
  { id: "c8", modulo: "clientes", nome: "Perfis excluídos do app", desc: "Clientes com acesso removido do app (ativo = false), registro original preservado.", icone: "⌫" },
  { id: "c9", modulo: "clientes", nome: "Clientes por vendedora", desc: "Distribuição de clientes e valor de contrato por vendedora/consultora.", icone: "V" },
  { id: "c10", modulo: "clientes", nome: "Origem das clientes", desc: "Clientes agrupadas pela origem de venda registrada (novas_vendas.origem_venda).", icone: "↗" },
  { id: "c11", modulo: "clientes", nome: "Clientes por procedimento", desc: "Distribuição de clientes por procedimento contratado.", icone: "C" },

  { id: "f1", modulo: "financeiro", nome: "Parcelas em aberto", desc: "Parcelas não pagas (boletos.status = nao_pago).", icone: "○" },
  { id: "f2", modulo: "financeiro", nome: "Parcelas pagas", desc: "Parcelas com pagamento confirmado no período.", icone: "✓" },
  { id: "f3", modulo: "financeiro", nome: "Parcelas vencidas", desc: "Parcelas com vencimento no passado e ainda não pagas.", icone: "!" },
  { id: "f4", modulo: "financeiro", nome: "Aguardando conferência", desc: "Comprovantes/pagamentos aguardando análise do Financeiro (boletos.status = pendente_confirmacao).", icone: "⌕" },
  { id: "f5", modulo: "financeiro", nome: "Comprovantes recebidos", desc: "Recebimentos com comprovante anexado.", icone: "▣" },
  { id: "f6", modulo: "financeiro", nome: "Recebimentos validados", desc: "Resultado das conferências financeiras (financeiro_recebimentos.status_validacao).", icone: "±" },
  { id: "f7", modulo: "financeiro", nome: "Recebimentos por período", desc: "Total recebido por data, forma de pagamento e cliente.", icone: "$" },
  { id: "f8", modulo: "financeiro", nome: "Recebimentos por vendedora", desc: "Recebimentos agrupados pela vendedora/consultora responsável.", icone: "V" },
  { id: "f9", modulo: "financeiro", nome: "Recebimentos por forma de pagamento", desc: "PIX, cartão, boleto e demais formas registradas.", icone: "↔" },
  { id: "f10", modulo: "financeiro", nome: "Contratos suspensos", desc: "Contratos suspensos com data de início da suspensão.", icone: "Ⅱ" },
  { id: "f11", modulo: "financeiro", nome: "Contratos negativados", desc: "Contratos negativados no período.", icone: "!" },
  { id: "f12", modulo: "financeiro", nome: "Contratos cancelados", desc: "Contratos cancelados no período.", icone: "×" },
  { id: "f13", modulo: "financeiro", nome: "Carnês importados", desc: "Carnês gerados e vinculados às clientes.", icone: "PDF" },
  { id: "f14", modulo: "financeiro", nome: "Parcelas sem carnê vinculado", desc: "Parcelas que ainda não possuem carnê associado.", icone: "?" },
  { id: "f15", modulo: "financeiro", nome: "Importações de boletos em revisão", desc: "Páginas de PDF sem evidência suficiente para vínculo automático (status_vinculacao = revisar).", icone: "⌕" },
  { id: "f16", modulo: "financeiro", nome: "Alterações financeiras", desc: "Baixas manuais, validações e ajustes financeiros auditáveis.", icone: "↺" },

  { id: "a1", modulo: "agenda", nome: "Clientes sem termos agendados", desc: "Clientes cadastradas que ainda não possuem agendamento de termos.", icone: "T" },
  { id: "a2", modulo: "agenda", nome: "Revisão financeira pendente", desc: "Clientes em análise para definição da quitação (status_revisao_financeira = pendente).", icone: "$" },
  { id: "a3", modulo: "agenda", nome: "Termos confirmados", desc: "Agendamentos de termos confirmados.", icone: "▣" },
  { id: "a4", modulo: "agenda", nome: "Termos realizados", desc: "Assinaturas de termos concluídas (termos_assinados_em preenchido).", icone: "✓" },
  { id: "a5", modulo: "agenda", nome: "Remarcações de termos", desc: "Solicitações de remarcação do tipo termos.", icone: "↻" },
  { id: "a6", modulo: "agenda", nome: "Quitações confirmadas", desc: "Clientes com quitação financeira confirmada.", icone: "$" },
  { id: "a7", modulo: "agenda", nome: "Solicitações de liberação financeira", desc: "Clientes com solicitação de liberação registrada.", icone: "L" },
  { id: "a8", modulo: "agenda", nome: "Clientes no prazo de 5 dias úteis", desc: "Clientes com termos e quitação confirmados, dentro do prazo de 5 dias úteis para liberação da agenda cirúrgica.", icone: "5" },
  { id: "a9", modulo: "agenda", nome: "Agenda cirúrgica liberada", desc: "Clientes com data de cirurgia já definida.", icone: "★" },
  { id: "a10", modulo: "agenda", nome: "Cirurgias agendadas", desc: "Clientes com status_cirurgia = agendada.", icone: "◷" },
  { id: "a11", modulo: "agenda", nome: "Cirurgias realizadas", desc: "Clientes com status_cirurgia = realizada.", icone: "✓" },
  { id: "a12", modulo: "agenda", nome: "Remarcações de cirurgia", desc: "Solicitações de remarcação do tipo cirurgia.", icone: "↻" },

  { id: "p1", modulo: "previsoes", nome: "Clientes próximas da elegibilidade", desc: "Clientes no ritmo do cronograma, faltando até 2 parcelas para elegibilidade.", icone: "%" },
  { id: "p2", modulo: "previsoes", nome: "Clientes elegíveis", desc: "Clientes que já atingiram o percentual mínimo de parcelas pagas.", icone: "✓" },
  { id: "p3", modulo: "previsoes", nome: "Liberações previstas", desc: "Projeção de liberação financeira conforme cronograma de parcelas.", icone: "↗" },
  { id: "p4", modulo: "previsoes", nome: "Liberações por mês", desc: "Distribuição mensal das liberações projetadas nos próximos 12 meses.", icone: "▥" },
  { id: "p5", modulo: "previsoes", nome: "Previsão x realizado", desc: "Compara a previsão calculada com a data em que a cliente atingiu a elegibilidade.", icone: "≈" },
  { id: "p6", modulo: "previsoes", nome: "Impacto de atrasos", desc: "Clientes com parcelas vencidas que afetam a previsão de liberação.", icone: "!" },
  { id: "p7", modulo: "previsoes", nome: "Impacto de suspensões", desc: "Clientes com contrato suspenso e previsão em aberto.", icone: "Ⅱ" },
  { id: "p8", modulo: "previsoes", nome: "Alterações de previsão", desc: "Histórico de ações administrativas sobre agendamento/cirurgia.", icone: "↺" },
  { id: "p9", modulo: "previsoes", nome: "No dia do prazo de liberação", desc: "Clientes com termos e quitação confirmados cujo prazo de 5 dias úteis se cumpre hoje.", icone: "5" },
  { id: "p10", modulo: "previsoes", nome: "Projeção do teto orçamentário", desc: "Valor previsto por mês comparado à referência de planejamento (meta_orcamento_mensal).", icone: "R$" },

  { id: "o1", modulo: "operacao", nome: "Acessos ao app / PWA", desc: "Dispositivos com acesso registrado ao app da cliente.", icone: "PWA" },
  { id: "o2", modulo: "operacao", nome: "Clientes com PWA instalado", desc: "Dispositivos com instalação do PWA confirmada.", icone: "✓" },
  { id: "o3", modulo: "operacao", nome: "Clientes sem PWA instalado", desc: "Dispositivos sem instalação do PWA.", icone: "×" },
  { id: "o4", modulo: "operacao", nome: "Último acesso das clientes", desc: "Data do último acesso registrado por dispositivo.", icone: "◷" },
  { id: "o5", modulo: "operacao", nome: "Clientes sem acesso recente", desc: "Dispositivos sem acesso nos últimos 30 dias.", icone: "!" },
  { id: "o6", modulo: "operacao", nome: "Web Push enviados", desc: "Notificações com envio de push registrado.", icone: "↗" },
  { id: "o7", modulo: "operacao", nome: "Web Push com falha", desc: "Notificações com falha de entrega registrada.", icone: "!" },
  { id: "o8", modulo: "operacao", nome: "Logs do sistema", desc: "Eventos operacionais e administrativos recentes.", icone: "≡" },
  { id: "o9", modulo: "operacao", nome: "Eventos administrativos", desc: "Ações realizadas por usuários administrativos (usuario iniciado por 'admin:').", icone: "◎" },

  { id: "t1", modulo: "equipe", nome: "Membros da equipe", desc: "Colaboradores internos, cargos e status de acesso.", icone: "👥" },
  { id: "t2", modulo: "equipe", nome: "Ações administrativas", desc: "Ações críticas agrupadas por colaborador administrativo.", icone: "◎" },
  { id: "t3", modulo: "equipe", nome: "Alterações realizadas", desc: "Mudanças relevantes registradas pela equipe (excluindo eventos de sistema).", icone: "↺" },
  { id: "t4", modulo: "equipe", nome: "Operações por usuário", desc: "Total de operações registradas por usuário, sem métricas artificiais de produtividade.", icone: "▥" },

  { id: "i1", modulo: "integracoes", nome: "Status das credenciais", desc: "Provedores com credenciais cadastradas no cofre (não implica conexão live verificada).", icone: "↔" },
  { id: "i2", modulo: "integracoes", nome: "Testes de conexão", desc: "Testes de conexão executados e seus resultados.", icone: "↻" },
  { id: "i3", modulo: "integracoes", nome: "Falhas de conexão", desc: "Testes de conexão que retornaram falha.", icone: "!" },
  { id: "i4", modulo: "integracoes", nome: "Webhooks recebidos", desc: "Depende da tabela integracao_eventos, ainda não implementada nesta fase.", icone: "⌁" },
  { id: "i5", modulo: "integracoes", nome: "Webhooks com erro", desc: "Depende da tabela integracao_eventos, ainda não implementada nesta fase.", icone: "×" },
  { id: "i6", modulo: "integracoes", nome: "Histórico de conexões", desc: "Testes, credenciais e alterações registradas nas integrações.", icone: "◷" },
];

function rel<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return (v[0] ?? null) as T | null;
  return v ?? null;
}

export function moeda(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function dataBr(iso: string | null | undefined) {
  if (!iso) return "—";
  const dia = String(iso).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia.split("-").reverse().join("/") : "—";
}

function dataHoraBr(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

export function dentroPeriodo(iso: string | null | undefined, filtros: Filtros) {
  const dia = iso ? String(iso).slice(0, 10) : null;
  if (!dia) return !filtros.periodoInicio && !filtros.periodoFim;
  if (filtros.periodoInicio && dia < filtros.periodoInicio) return false;
  if (filtros.periodoFim && dia > filtros.periodoFim) return false;
  return true;
}

export function combinaBusca(valores: (string | null | undefined)[], filtros: Filtros) {
  if (!filtros.busca) return true;
  const termo = filtros.busca.trim().toLowerCase();
  if (!termo) return true;
  return valores.some((v) => String(v ?? "").toLowerCase().includes(termo));
}

const LABEL_STATUS_CONTRATO: Record<string, string> = { ativo: "Ativo", suspenso: "Suspenso", negativado: "Negativado", cancelado: "Cancelado" };
const LABEL_STATUS_BOLETO: Record<string, string> = { nao_pago: "Não pago", pago: "Pago", pendente_confirmacao: "Aguardando conferência", rejeitado: "Rejeitado" };
const LABEL_STATUS_AGENDAMENTO: Record<string, string> = { confirmado: "Confirmado", realizado: "Realizado", cancelado: "Cancelado" };
const LABEL_STATUS_CIRURGIA: Record<string, string> = { nao_agendada: "Não agendada", agendada: "Agendada", realizada: "Realizada", cancelada: "Cancelada" };
const LABEL_STATUS_NOVA_VENDA: Record<string, string> = { aguardando_cadastro: "Aguardando cadastro", aguardando_boletos: "Aguardando boletos", financeiro_concluido: "Financeiro concluído" };
const LABEL_SITUACAO_FORECAST: Record<string, string> = { sem_regra: "Sem regra", elegivel: "Elegível", em_risco: "Em risco", no_ritmo: "No ritmo", sem_previsao: "Sem previsão" };

async function fetchClientes(db: Db) {
  const { data, error } = await db.from("clientes").select(
    "id,nome_completo,cpf,status_contrato,consultora,vendedora_id,procedimento,valor_contrato,ativo,created_at,suspenso_desde,financeiro_confirmado_em,status_revisao_financeira",
  );
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchBoletos(db: Db) {
  const { data, error } = await db
    .from("boletos")
    .select("id,cliente_id,numero_parcela,total_parcelas,valor,data_vencimento,status,data_pagamento,carne_id,clientes(nome_completo,cpf,consultora)");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchRecebimentos(db: Db) {
  const { data, error } = await db
    .from("financeiro_recebimentos")
    .select("id,cliente_id,valor_recebido,data_pagamento,forma_pagamento,origem,status_validacao,comprovante_url,clientes(nome_completo,cpf,consultora)");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchAgendamentos(db: Db) {
  const { data, error } = await db
    .from("agendamentos")
    .select("id,cliente_id,status,termos_assinados_em,data_cirurgia,previsao_liberacao_financeira,prazo_cirurgico_dias_extras,created_at,clientes(nome_completo,cpf,status_cirurgia,consultora,custeio_confirmado_em)");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchLogs(db: Db, entidade?: string) {
  let query = db.from("logs_alteracoes").select("id,usuario,acao,entidade,entidade_id,detalhes,created_at").order("created_at", { ascending: false }).limit(2000);
  if (entidade) query = query.eq("entidade", entidade);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchDevices(db: Db) {
  const { data, error } = await db
    .from("cliente_app_devices")
    .select("id,cliente_id,device_type,is_pwa_installed,notification_permission,first_access_at,last_access_at,clientes(nome_completo)");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchColaboradores(db: Db) {
  const { data, error } = await db.from("colaboradores").select("id,nome,email,cargo,ativo,permissoes,created_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchCarnes(db: Db) {
  const { data, error } = await db.from("carnes").select("id,cliente_id,instituicao_financeira,quantidade_parcelas,valor_total,status,data_geracao,clientes(nome_completo)");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchImportacoes(db: Db) {
  const { data, error } = await db
    .from("importacoes_boletos")
    .select("id,cliente_id,status,status_vinculacao,nivel_confianca,arquivo_nome,created_at,clientes(nome_completo)");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchSolicitacoesLiberacao(db: Db) {
  const { data, error } = await db
    .from("solicitacoes_liberacao_financeira")
    .select("id,cliente_id,status,saldo_restante,forma_custeio,created_at,clientes(nome_completo,cpf)");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchRemarcacoes(db: Db) {
  const { data, error } = await db
    .from("solicitacoes_remarcacao_agendamento")
    .select("id,cliente_id,tipo,data_solicitada,status,created_at,clientes(nome_completo)");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchNotificacaoLogs(db: Db) {
  const { data, error } = await db
    .from("notificacao_logs")
    .select("id,cliente_id,tipo,titulo,status,push_enviadas,push_falhas,created_at,clientes(nome_completo)");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchNovasVendas(db: Db) {
  const { data, error } = await db
    .from("novas_vendas")
    .select("id,cliente_id,nome_completo,cpf,vendedora_responsavel,valor_contrato,status,origem_venda,created_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchCredenciaisIntegracoes(db: Db) {
  const { data, error } = await db.from("integracoes_credenciais").select("provedor,chave,ativo,atualizado_em").order("provedor", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

function resumoContagem(total: number, extra: { label: string; value: string }[] = []) {
  return [{ label: "Registros encontrados", value: String(total) }, ...extra];
}

function agrupar<T>(rows: T[], chave: (row: T) => string) {
  const mapa = new Map<string, T[]>();
  for (const row of rows) {
    const k = chave(row) || "—";
    const atual = mapa.get(k) ?? [];
    atual.push(row);
    mapa.set(k, atual);
  }
  return mapa;
}

async function executarRelatorio(id: string, db: Db, filtros: Filtros): Promise<ResultadoRelatorio> {
  switch (id) {
    case "c1": {
      const rows = (await fetchClientes(db)).filter((c) => dentroPeriodo(c.created_at, filtros) && combinaBusca([c.nome_completo, c.cpf], filtros));
      return { colunas: ["Cadastro", "Nome", "CPF", "Status contrato", "Vendedora", "Valor contrato"], linhas: rows.map((c) => [dataBr(c.created_at), c.nome_completo ?? "—", c.cpf ?? "—", LABEL_STATUS_CONTRATO[String(c.status_contrato)] ?? String(c.status_contrato ?? "—"), c.consultora ?? "—", moeda(c.valor_contrato)]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "c2": {
      const rows = (await fetchNovasVendas(db)).filter((v) => v.status === "aguardando_cadastro" && dentroPeriodo(v.created_at, filtros) && combinaBusca([v.nome_completo, v.cpf], filtros));
      return { colunas: ["Recebido em", "Nome", "CPF", "Vendedora", "Valor contrato", "Status"], linhas: rows.map((v) => [dataBr(v.created_at), v.nome_completo ?? "—", v.cpf ?? "—", v.vendedora_responsavel ?? "—", moeda(v.valor_contrato), LABEL_STATUS_NOVA_VENDA[String(v.status)] ?? String(v.status ?? "—")]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "c3": {
      const rows = (await fetchClientes(db)).filter((c) => combinaBusca([c.nome_completo, c.cpf], filtros));
      return { colunas: ["Cadastro", "Nome", "CPF", "Status contrato", "Vendedora", "Valor contrato"], linhas: rows.map((c) => [dataBr(c.created_at), c.nome_completo ?? "—", c.cpf ?? "—", LABEL_STATUS_CONTRATO[String(c.status_contrato)] ?? String(c.status_contrato ?? "—"), c.consultora ?? "—", moeda(c.valor_contrato)]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "c4":
    case "c5":
    case "c6":
    case "c7": {
      const alvo: Record<string, string> = { c4: "ativo", c5: "suspenso", c6: "negativado", c7: "cancelado" };
      const rows = (await fetchClientes(db)).filter((c) => c.status_contrato === alvo[id] && combinaBusca([c.nome_completo, c.cpf], filtros));
      return { colunas: ["Cadastro", "Nome", "CPF", "Vendedora", "Valor contrato", "Suspenso desde"], linhas: rows.map((c) => [dataBr(c.created_at), c.nome_completo ?? "—", c.cpf ?? "—", c.consultora ?? "—", moeda(c.valor_contrato), dataBr(c.suspenso_desde)]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "c8": {
      const rows = (await fetchClientes(db)).filter((c) => c.ativo === false && combinaBusca([c.nome_completo, c.cpf], filtros));
      return { colunas: ["Cadastro", "Nome", "CPF", "Status contrato"], linhas: rows.map((c) => [dataBr(c.created_at), c.nome_completo ?? "—", c.cpf ?? "—", LABEL_STATUS_CONTRATO[String(c.status_contrato)] ?? String(c.status_contrato ?? "—")]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "c9": {
      const rows = await fetchClientes(db);
      const grupos = agrupar(rows, (c) => c.consultora ?? "Sem vendedora");
      const linhas = [...grupos.entries()].map(([vendedora, itens]) => [vendedora, String(itens.length), moeda(itens.reduce((s, c) => s + Number(c.valor_contrato ?? 0), 0))]);
      return { colunas: ["Vendedora", "Quantidade de clientes", "Valor total de contratos"], linhas, resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "c10": {
      const [clientes, vendas] = await Promise.all([fetchClientes(db), fetchNovasVendas(db)]);
      const origemPorCliente = new Map<string, string>();
      for (const v of vendas) if (v.cliente_id) origemPorCliente.set(v.cliente_id as unknown as string, v.origem_venda ?? "Sem origem");
      const grupos = agrupar(clientes, (c) => origemPorCliente.get(c.id) ?? "Sem origem registrada");
      const linhas = [...grupos.entries()].map(([origem, itens]) => [origem, String(itens.length)]);
      return { colunas: ["Origem", "Quantidade de clientes"], linhas, resumo: resumoContagem(clientes.length), totalRegistros: clientes.length };
    }
    case "c11": {
      const rows = await fetchClientes(db);
      const grupos = agrupar(rows, (c) => c.procedimento ?? "Não informado");
      const linhas = [...grupos.entries()].map(([procedimento, itens]) => [procedimento, String(itens.length), moeda(itens.reduce((s, c) => s + Number(c.valor_contrato ?? 0), 0))]);
      return { colunas: ["Procedimento", "Quantidade de clientes", "Valor total"], linhas, resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }

    case "f1":
    case "f2":
    case "f3":
    case "f4": {
      const boletos = await fetchBoletos(db);
      const hoje = new Date().toISOString().slice(0, 10);
      const rows = boletos.filter((b) => {
        const c = rel<any>(b.clientes);
        if (!combinaBusca([c?.nome_completo, c?.cpf], filtros)) return false;
        if (id === "f1") return b.status === "nao_pago";
        if (id === "f2") return b.status === "pago" && dentroPeriodo(b.data_pagamento, filtros);
        if (id === "f3") return b.data_vencimento != null && String(b.data_vencimento) < hoje && b.status !== "pago";
        return b.status === "pendente_confirmacao";
      });
      return { colunas: ["Vencimento", "Cliente", "CPF", "Parcela", "Valor", "Status", "Pagamento"], linhas: rows.map((b) => { const c = rel<any>(b.clientes); return [dataBr(b.data_vencimento), c?.nome_completo ?? "—", c?.cpf ?? "—", `${b.numero_parcela}/${b.total_parcelas}`, moeda(b.valor), LABEL_STATUS_BOLETO[String(b.status)] ?? String(b.status ?? "—"), dataBr(b.data_pagamento)]; }), resumo: resumoContagem(rows.length, [{ label: "Valor total", value: moeda(rows.reduce((s, b) => s + Number(b.valor ?? 0), 0)) }]), totalRegistros: rows.length };
    }
    case "f5": {
      const rows = (await fetchRecebimentos(db)).filter((r) => Boolean(r.comprovante_url) && dentroPeriodo(r.data_pagamento, filtros));
      return { colunas: ["Pagamento", "Cliente", "Forma", "Valor recebido", "Validação"], linhas: rows.map((r) => { const c = rel<any>(r.clientes); return [dataBr(r.data_pagamento), c?.nome_completo ?? "—", r.forma_pagamento ?? "—", moeda(r.valor_recebido), r.status_validacao ?? "—"]; }), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "f6": {
      const rows = (await fetchRecebimentos(db)).filter((r) => dentroPeriodo(r.data_pagamento, filtros));
      const grupos = agrupar(rows, (r) => r.status_validacao ?? "Sem validação");
      const linhas = [...grupos.entries()].map(([status, itens]) => [status, String(itens.length), moeda(itens.reduce((s, r) => s + Number(r.valor_recebido ?? 0), 0))]);
      return { colunas: ["Status de validação", "Quantidade", "Valor total"], linhas, resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "f7": {
      const rows = (await fetchRecebimentos(db)).filter((r) => dentroPeriodo(r.data_pagamento, filtros) && combinaBusca([rel<any>(r.clientes)?.nome_completo], filtros));
      return { colunas: ["Pagamento", "Cliente", "Vendedora", "Forma", "Valor recebido"], linhas: rows.map((r) => { const c = rel<any>(r.clientes); return [dataBr(r.data_pagamento), c?.nome_completo ?? "—", c?.consultora ?? "—", r.forma_pagamento ?? "—", moeda(r.valor_recebido)]; }), resumo: resumoContagem(rows.length, [{ label: "Total recebido", value: moeda(rows.reduce((s, r) => s + Number(r.valor_recebido ?? 0), 0)) }]), totalRegistros: rows.length };
    }
    case "f8": {
      const rows = (await fetchRecebimentos(db)).filter((r) => dentroPeriodo(r.data_pagamento, filtros));
      const grupos = agrupar(rows, (r) => rel<any>(r.clientes)?.consultora ?? "Sem vendedora");
      const linhas = [...grupos.entries()].map(([vendedora, itens]) => [vendedora, String(itens.length), moeda(itens.reduce((s, r) => s + Number(r.valor_recebido ?? 0), 0))]);
      return { colunas: ["Vendedora", "Recebimentos", "Valor total"], linhas, resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "f9": {
      const rows = (await fetchRecebimentos(db)).filter((r) => dentroPeriodo(r.data_pagamento, filtros));
      const grupos = agrupar(rows, (r) => r.forma_pagamento ?? "Não informado");
      const linhas = [...grupos.entries()].map(([forma, itens]) => [forma, String(itens.length), moeda(itens.reduce((s, r) => s + Number(r.valor_recebido ?? 0), 0))]);
      return { colunas: ["Forma de pagamento", "Quantidade", "Valor total"], linhas, resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "f10":
    case "f11":
    case "f12": {
      const alvo: Record<string, string> = { f10: "suspenso", f11: "negativado", f12: "cancelado" };
      const rows = (await fetchClientes(db)).filter((c) => c.status_contrato === alvo[id]);
      return { colunas: ["Cliente", "CPF", "Vendedora", "Valor contrato", "Suspenso desde"], linhas: rows.map((c) => [c.nome_completo ?? "—", c.cpf ?? "—", c.consultora ?? "—", moeda(c.valor_contrato), dataBr(c.suspenso_desde)]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "f13": {
      const rows = (await fetchCarnes(db)).filter((c) => dentroPeriodo(c.data_geracao, filtros));
      return { colunas: ["Geração", "Cliente", "Instituição", "Parcelas", "Valor total", "Status"], linhas: rows.map((c) => { const cl = rel<any>(c.clientes); return [dataBr(c.data_geracao), cl?.nome_completo ?? "—", c.instituicao_financeira ?? "—", String(c.quantidade_parcelas ?? "—"), moeda(c.valor_total), c.status ?? "—"]; }), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "f14": {
      const rows = (await fetchBoletos(db)).filter((b) => !b.carne_id);
      return { colunas: ["Cliente", "CPF", "Parcela", "Valor", "Vencimento", "Status"], linhas: rows.map((b) => { const c = rel<any>(b.clientes); return [c?.nome_completo ?? "—", c?.cpf ?? "—", `${b.numero_parcela}/${b.total_parcelas}`, moeda(b.valor), dataBr(b.data_vencimento), LABEL_STATUS_BOLETO[String(b.status)] ?? String(b.status ?? "—")]; }), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "f15": {
      const rows = (await fetchImportacoes(db)).filter((i) => i.status_vinculacao === "revisar" || i.status === "erro");
      return { colunas: ["Recebido em", "Cliente sugerido", "Arquivo", "Confiança", "Status"], linhas: rows.map((i) => { const c = rel<any>(i.clientes); return [dataHoraBr(i.created_at), c?.nome_completo ?? "—", i.arquivo_nome ?? "—", i.nivel_confianca ?? "—", i.status ?? "—"]; }), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "f16": {
      const rows = (await fetchLogs(db)).filter((l) => ["boletos", "financeiro_recebimentos", "importacoes_boletos", "carnes"].includes(String(l.entidade)) && dentroPeriodo(l.created_at, filtros));
      return { colunas: ["Data/hora", "Usuário", "Ação", "Entidade"], linhas: rows.map((l) => [dataHoraBr(l.created_at), l.usuario ?? "—", l.acao ?? "—", l.entidade ?? "—"]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }

    case "a1": {
      const [clientes, agendamentos] = await Promise.all([fetchClientes(db), fetchAgendamentos(db)]);
      const comAgendamento = new Set(agendamentos.map((a) => a.cliente_id));
      const rows = clientes.filter((c) => !comAgendamento.has(c.id));
      return { colunas: ["Cadastro", "Nome", "CPF", "Status contrato"], linhas: rows.map((c) => [dataBr(c.created_at), c.nome_completo ?? "—", c.cpf ?? "—", LABEL_STATUS_CONTRATO[String(c.status_contrato)] ?? String(c.status_contrato ?? "—")]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "a2": {
      const rows = (await fetchClientes(db)).filter((c) => c.status_revisao_financeira === "pendente");
      return { colunas: ["Nome", "CPF", "Vendedora", "Valor contrato"], linhas: rows.map((c) => [c.nome_completo ?? "—", c.cpf ?? "—", c.consultora ?? "—", moeda(c.valor_contrato)]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "a3":
    case "a4": {
      const rows = (await fetchAgendamentos(db)).filter((a) => id === "a3" ? a.status === "confirmado" : Boolean(a.termos_assinados_em));
      return { colunas: ["Cliente", "CPF", "Status", "Termos assinados", "Vendedora"], linhas: rows.map((a) => { const c = rel<any>(a.clientes); return [c?.nome_completo ?? "—", c?.cpf ?? "—", LABEL_STATUS_AGENDAMENTO[String(a.status)] ?? String(a.status ?? "—"), dataHoraBr(a.termos_assinados_em), c?.consultora ?? "—"]; }), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "a5":
    case "a12": {
      const tipoAlvo = id === "a5" ? "termos" : "cirurgia";
      const rows = (await fetchRemarcacoes(db)).filter((r) => r.tipo === tipoAlvo);
      return { colunas: ["Solicitação", "Cliente", "Data solicitada", "Status"], linhas: rows.map((r) => { const c = rel<any>(r.clientes); return [dataHoraBr(r.created_at), c?.nome_completo ?? "—", dataBr(r.data_solicitada), r.status ?? "—"]; }), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "a6": {
      const rows = (await fetchClientes(db)).filter((c) => Boolean(c.financeiro_confirmado_em));
      return { colunas: ["Confirmação", "Cliente", "CPF", "Vendedora"], linhas: rows.map((c) => [dataHoraBr(c.financeiro_confirmado_em), c.nome_completo ?? "—", c.cpf ?? "—", c.consultora ?? "—"]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "a7": {
      const rows = await fetchSolicitacoesLiberacao(db);
      return { colunas: ["Solicitação", "Cliente", "CPF", "Forma custeio", "Saldo restante", "Status"], linhas: rows.map((s) => { const c = rel<any>(s.clientes); return [dataHoraBr(s.created_at), c?.nome_completo ?? "—", c?.cpf ?? "—", s.forma_custeio ?? "—", moeda(s.saldo_restante), s.status ?? "—"]; }), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "a8":
    case "p9": {
      const agendamentos = await fetchAgendamentos(db);
      const hoje = agoraSaoPaulo().data;
      const rows = agendamentos
        .filter((a) => a.termos_assinados_em && rel<any>(a.clientes)?.custeio_confirmado_em)
        .map((a) => {
          const c = rel<any>(a.clientes);
          const prazo = calcularPrazoCirurgicoComAjuste(a.termos_assinados_em, c?.custeio_confirmado_em ?? null, (a as any).prazo_cirurgico_dias_extras ?? 0);
          const diasRestantes = prazo ? Math.max(0, Math.round((new Date(`${prazo}T00:00:00Z`).getTime() - new Date(`${hoje}T00:00:00Z`).getTime()) / 86400000)) : null;
          return { a, c, prazo, diasRestantes };
        })
        .filter(({ diasRestantes }) => diasRestantes != null && (id === "a8" ? diasRestantes >= 0 : diasRestantes === 0));
      return { colunas: ["Cliente", "CPF", "Termos assinados em", "Prazo (5 dias úteis)", "Dias restantes"], linhas: rows.map(({ a, c, prazo, diasRestantes }) => [c?.nome_completo ?? "—", c?.cpf ?? "—", dataHoraBr(a.termos_assinados_em), prazo ? dataBr(prazo) : "—", String(diasRestantes)]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "a9": {
      const rows = (await fetchAgendamentos(db)).filter((a) => Boolean(a.data_cirurgia));
      return { colunas: ["Cliente", "CPF", "Data da cirurgia"], linhas: rows.map((a) => { const c = rel<any>(a.clientes); return [c?.nome_completo ?? "—", c?.cpf ?? "—", dataBr(a.data_cirurgia)]; }), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "a10":
    case "a11": {
      const alvo = id === "a10" ? "agendada" : "realizada";
      const rows = (await fetchClientes(db)).filter((c) => (c as any).status_cirurgia === alvo);
      return { colunas: ["Cliente", "CPF", "Vendedora"], linhas: rows.map((c) => [c.nome_completo ?? "—", c.cpf ?? "—", c.consultora ?? "—"]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }

    case "p1":
    case "p2":
    case "p3":
    case "p6":
    case "p7": {
      const forecast = await forecastLiberacoes(db);
      const clientesForecast = forecast.clientes as any[];
      const rows = clientesForecast.filter((f) => {
        if (id === "p1") return f.situacao === "no_ritmo" && f.parcelasRestantes != null && f.parcelasRestantes <= 2;
        if (id === "p2") return f.situacao === "elegivel";
        if (id === "p3") return f.previsao != null && f.situacao !== "elegivel";
        if (id === "p6") return f.situacao === "elegivel" && f.atingiuEm;
        return f.parcelasVencidas > 0;
      });
      return { colunas: ["Cliente", "Pagas/Total", "Situação", "Previsão", "Atingiu em", "Vendedora"], linhas: rows.map((f) => [f.nome, `${f.parcelasPagas}/${f.totalParcelas}`, LABEL_SITUACAO_FORECAST[f.situacao] ?? f.situacao, dataBr(f.previsao), dataBr(f.atingiuEm), f.responsavel ?? "—"]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "p4": {
      const forecast = await forecastLiberacoes(db);
      return { colunas: ["Mês", "Total previsto", "No ritmo", "Em risco"], linhas: (forecast.meses as any[]).map((m) => [m.mes, String(m.total), String(m.noRitmo), String(m.emRisco)]), resumo: resumoContagem((forecast.meses as any[]).length, [{ label: "Próximos 12 meses", value: String(forecast.resumo.proximos12Meses) }]), totalRegistros: (forecast.meses as any[]).length };
    }
    case "p8": {
      const rows = (await fetchLogs(db, "agendamentos")).filter((l) => dentroPeriodo(l.created_at, filtros));
      return { colunas: ["Data/hora", "Usuário", "Ação", "Detalhes"], linhas: rows.map((l) => [dataHoraBr(l.created_at), l.usuario ?? "—", l.acao ?? "—", JSON.stringify(l.detalhes ?? {}).slice(0, 120)]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "p10": {
      const forecast = await forecastLiberacoes(db);
      const { data: config } = await db.from("configuracoes").select("meta_orcamento_mensal").limit(1).maybeSingle();
      const meta = Number(config?.meta_orcamento_mensal ?? 100000);
      const linhas = (forecast.meses as any[]).map((m) => {
        const valorMes = (forecast.clientes as any[]).filter((c) => c.previsao?.slice(0, 7) === m.mes).reduce((s, c) => s + Number(c.valorCarta ?? 0), 0);
        return [m.mes, moeda(valorMes), moeda(meta), valorMes > meta ? "Acima da referência" : "Dentro da referência"];
      });
      return { colunas: ["Mês", "Valor previsto", "Referência mensal", "Situação"], linhas, resumo: resumoContagem(linhas.length, [{ label: "Referência", value: moeda(meta) }]), totalRegistros: linhas.length };
    }

    case "o1":
    case "o2":
    case "o3": {
      const rows = (await fetchDevices(db)).filter((d) => id === "o1" ? true : id === "o2" ? d.is_pwa_installed === true : d.is_pwa_installed !== true);
      return { colunas: ["Cliente", "Dispositivo", "PWA instalado", "Primeiro acesso", "Último acesso"], linhas: rows.map((d) => { const c = rel<any>(d.clientes); return [c?.nome_completo ?? "—", d.device_type ?? "—", d.is_pwa_installed ? "Sim" : "Não", dataHoraBr(d.first_access_at), dataHoraBr(d.last_access_at)]; }), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "o4": {
      const rows = (await fetchDevices(db)).sort((a, b) => String(b.last_access_at ?? "").localeCompare(String(a.last_access_at ?? "")));
      return { colunas: ["Cliente", "Dispositivo", "Último acesso"], linhas: rows.map((d) => { const c = rel<any>(d.clientes); return [c?.nome_completo ?? "—", d.device_type ?? "—", dataHoraBr(d.last_access_at)]; }), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "o5": {
      const limite = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const rows = (await fetchDevices(db)).filter((d) => !d.last_access_at || new Date(d.last_access_at).getTime() < limite);
      return { colunas: ["Cliente", "Dispositivo", "Último acesso"], linhas: rows.map((d) => { const c = rel<any>(d.clientes); return [c?.nome_completo ?? "—", d.device_type ?? "—", dataHoraBr(d.last_access_at)]; }), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "o6":
    case "o7": {
      const rows = (await fetchNotificacaoLogs(db)).filter((n) => id === "o6" ? Number(n.push_enviadas ?? 0) > 0 : Number(n.push_falhas ?? 0) > 0);
      return { colunas: ["Data", "Cliente", "Tipo", "Título", "Enviadas", "Falhas"], linhas: rows.map((n) => { const c = rel<any>(n.clientes); return [dataHoraBr(n.created_at), c?.nome_completo ?? "—", n.tipo ?? "—", n.titulo ?? "—", String(n.push_enviadas ?? 0), String(n.push_falhas ?? 0)]; }), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "o8": {
      const rows = (await fetchLogs(db)).filter((l) => dentroPeriodo(l.created_at, filtros));
      return { colunas: ["Data/hora", "Usuário", "Ação", "Entidade"], linhas: rows.map((l) => [dataHoraBr(l.created_at), l.usuario ?? "—", l.acao ?? "—", l.entidade ?? "—"]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "o9": {
      const rows = (await fetchLogs(db)).filter((l) => String(l.usuario ?? "").startsWith("admin:") && dentroPeriodo(l.created_at, filtros));
      return { colunas: ["Data/hora", "Usuário", "Ação", "Entidade"], linhas: rows.map((l) => [dataHoraBr(l.created_at), l.usuario ?? "—", l.acao ?? "—", l.entidade ?? "—"]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }

    case "t1": {
      const rows = await fetchColaboradores(db);
      return { colunas: ["Nome", "Email", "Cargo", "Ativo"], linhas: rows.map((c) => [c.nome ?? "—", c.email ?? "—", c.cargo ?? "—", c.ativo ? "Sim" : "Não"]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "t2": {
      const rows = (await fetchLogs(db)).filter((l) => String(l.usuario ?? "").startsWith("admin:") && dentroPeriodo(l.created_at, filtros));
      const grupos = agrupar(rows, (l) => l.usuario ?? "—");
      const linhas = [...grupos.entries()].map(([usuario, itens]) => [usuario, String(itens.length)]);
      return { colunas: ["Usuário", "Ações registradas"], linhas, resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "t3": {
      const rows = (await fetchLogs(db)).filter((l) => dentroPeriodo(l.created_at, filtros));
      return { colunas: ["Data/hora", "Usuário", "Ação", "Entidade"], linhas: rows.map((l) => [dataHoraBr(l.created_at), l.usuario ?? "—", l.acao ?? "—", l.entidade ?? "—"]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }
    case "t4": {
      const rows = (await fetchLogs(db)).filter((l) => dentroPeriodo(l.created_at, filtros));
      const grupos = agrupar(rows, (l) => l.usuario ?? "Sem usuário");
      const linhas = [...grupos.entries()].map(([usuario, itens]) => [usuario, String(itens.length)]);
      return { colunas: ["Usuário", "Total de operações"], linhas, resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }

    case "i1": {
      const rows = await fetchCredenciaisIntegracoes(db);
      const grupos = agrupar(rows, (c) => c.provedor ?? "—");
      const linhas = [...grupos.entries()].map(([provedor, itens]) => [provedor, String(itens.length), itens.some((i) => i.ativo) ? "Credenciais presentes" : "Não configurada", dataHoraBr(itens[0]?.atualizado_em)]);
      return { colunas: ["Provedor", "Chaves cadastradas", "Status", "Última atualização"], linhas, resumo: resumoContagem(grupos.size), totalRegistros: grupos.size };
    }
    case "i2":
    case "i3": {
      const rows = (await fetchLogs(db, "integracoes")).filter((l) => l.acao === "testou_conexao_integracao" && dentroPeriodo(l.created_at, filtros) && (id === "i3" ? (l.detalhes as any)?.conectado === false : true));
      return { colunas: ["Data/hora", "Provedor", "Resultado", "Detalhe"], linhas: rows.map((l) => [dataHoraBr(l.created_at), l.entidade_id ?? "—", (l.detalhes as any)?.conectado ? "Conectado" : "Falhou", String((l.detalhes as any)?.detalhe ?? "—")]), resumo: resumoContagem(rows.length), totalRegistros: rows.length, indisponivel: rows.length === 0 ? undefined : undefined };
    }
    case "i4":
    case "i5": {
      return { colunas: ["—"], linhas: [], resumo: [{ label: "Registros encontrados", value: "0" }], totalRegistros: 0, indisponivel: "Depende da tabela integracao_eventos, ainda não implementada. Nenhum dado é exibido até que essa estrutura exista." };
    }
    case "i6": {
      const rows = (await fetchLogs(db)).filter((l) => ["integracoes", "integracoes_credenciais"].includes(String(l.entidade)) && dentroPeriodo(l.created_at, filtros));
      return { colunas: ["Data/hora", "Usuário", "Ação", "Entidade"], linhas: rows.map((l) => [dataHoraBr(l.created_at), l.usuario ?? "—", l.acao ?? "—", l.entidade ?? "—"]), resumo: resumoContagem(rows.length), totalRegistros: rows.length };
    }

    default:
      throw new Error(`Relatório desconhecido: ${id}`);
  }
}

export async function gerarPdfBuffer(titulo: string, subtitulo: string, colunas: string[], linhas: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const fonteBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const largura = 841.89;
  const altura = 595.28;
  const margem = 32;
  const larguraUtil = largura - margem * 2;
  const larguraColuna = larguraUtil / Math.max(1, colunas.length);
  const linhaAltura = 16;

  let pagina = doc.addPage([largura, altura]);
  let y = altura - margem;

  const desenharCabecalho = () => {
    pagina.drawText(titulo, { x: margem, y, size: 14, font: fonteBold, color: rgb(0.48, 0.15, 0.2) });
    y -= 16;
    pagina.drawText(subtitulo, { x: margem, y, size: 9, font: fonte, color: rgb(0.4, 0.35, 0.35) });
    y -= 18;
    colunas.forEach((coluna, i) => {
      pagina.drawText(coluna.slice(0, 28), { x: margem + i * larguraColuna, y, size: 8, font: fonteBold, color: rgb(0.48, 0.15, 0.2) });
    });
    y -= 12;
    pagina.drawLine({ start: { x: margem, y }, end: { x: largura - margem, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    y -= 10;
  };

  desenharCabecalho();

  for (const linha of linhas) {
    if (y < margem + linhaAltura) {
      pagina = doc.addPage([largura, altura]);
      y = altura - margem;
      desenharCabecalho();
    }
    linha.forEach((celula, i) => {
      pagina.drawText(String(celula ?? "—").slice(0, 40), { x: margem + i * larguraColuna, y, size: 7.5, font: fonte, color: rgb(0.2, 0.15, 0.15) });
    });
    y -= linhaAltura;
  }

  if (linhas.length === 0) {
    pagina.drawText("Nenhum registro encontrado para os filtros selecionados.", { x: margem, y, size: 9, font: fonte, color: rgb(0.4, 0.35, 0.35) });
  }

  return doc.save();
}

export function gerarXlsxBuffer(colunas: string[], linhas: string[][]): Uint8Array {
  const planilha = XLSX.utils.aoa_to_sheet([colunas, ...linhas]);
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, planilha, "Relatório");
  const arrayBuffer = XLSX.write(livro, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(arrayBuffer);
}

function slugArquivo(nome: string) {
  return nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function adminRelatorios(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/admin/relatorios/")) return null;

  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);
  const token = getCookie(request, "admin_session");
  const session = await verificarTokenAdmin(token, env.CLIENTE_SESSION_SECRET);
  if (!session) return json({ erro: "Sessão administrativa expirada." }, 401);
  const colaborador = await buscarColaboradorAdminAtivo(session.adminId, env);
  if (!colaborador) return json({ erro: "Acesso administrativo não autorizado." }, 403);
  if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
    const origin = request.headers.get("Origin");
    if (origin) {
      try {
        if (new URL(origin).origin !== new URL(request.url).origin) return json({ erro: "Requisição de origem não autorizada." }, 403);
      } catch {
        return json({ erro: "Requisição de origem não autorizada." }, 403);
      }
    }
  }

  const db = createServiceSupabaseClient(env);

  if (url.pathname === "/api/admin/relatorios/catalogo" && request.method === "GET") {
    const grupos = ["clientes", "financeiro", "agenda", "previsoes", "operacao", "equipe", "integracoes"].map((modulo) => ({
      modulo,
      ...MODULOS[modulo],
      itens: REPORT_CATALOG.filter((r) => r.modulo === modulo),
    }));
    return json({ modulos: MODULOS, grupos, total: REPORT_CATALOG.length });
  }

  if (url.pathname === "/api/admin/relatorios/preview" && request.method === "POST") {
    if (!temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.RELATORIOS_VISUALIZAR)) {
      return json({ erro: "Seu papel não tem permissão para visualizar relatórios." }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as { relatorioId?: string; filtros?: Filtros };
    const def = REPORT_CATALOG.find((r) => r.id === body.relatorioId);
    if (!def) return json({ erro: "Relatório não encontrado." }, 404);
    try {
      const resultado = await executarRelatorio(def.id, db, body.filtros ?? {});
      return json({
        relatorio: def,
        colunas: resultado.colunas,
        linhas: resultado.linhas.slice(0, 8),
        resumo: resultado.resumo,
        totalRegistros: resultado.totalRegistros,
        indisponivel: resultado.indisponivel,
      });
    } catch (error) {
      console.error("Falha ao gerar prévia de relatório:", error);
      return json({ erro: "Não foi possível gerar a prévia." }, 500);
    }
  }

  if (url.pathname === "/api/admin/relatorios/gerar" && request.method === "POST") {
    if (!temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.RELATORIOS_EXPORTAR)) {
      return json({ erro: "Seu papel não tem permissão para exportar relatórios." }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as { relatorioId?: string; formato?: "pdf" | "xlsx"; filtros?: Filtros; periodoLabel?: string };
    const def = REPORT_CATALOG.find((r) => r.id === body.relatorioId);
    if (!def) return json({ erro: "Relatório não encontrado." }, 404);
    if (body.formato !== "pdf" && body.formato !== "xlsx") return json({ erro: "Formato inválido." }, 400);

    let resultado: ResultadoRelatorio;
    try {
      resultado = await executarRelatorio(def.id, db, body.filtros ?? {});
    } catch (error) {
      console.error("Falha ao gerar relatório:", error);
      return json({ erro: "Não foi possível gerar o relatório." }, 500);
    }
    if (resultado.indisponivel) {
      return json({ erro: resultado.indisponivel }, 501);
    }

    const nomeArquivo = `${slugArquivo(def.nome)}-${new Date().toISOString().slice(0, 10)}.${body.formato}`;
    const bytes = body.formato === "pdf"
      ? await gerarPdfBuffer(def.nome, body.periodoLabel ?? "Todos os registros", resultado.colunas, resultado.linhas)
      : gerarXlsxBuffer(resultado.colunas, resultado.linhas);

    await db.from("relatorios_exportacoes").insert({
      modulo: def.modulo,
      relatorio_id: def.id,
      formato: body.formato,
      filtros: body.filtros ?? {},
      colunas: resultado.colunas,
      total_linhas: resultado.linhas.length,
      nome_arquivo: nomeArquivo,
      gerado_por: colaborador.id,
    });

    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Response(new Blob([arrayBuffer]), {
      status: 200,
      headers: {
        "Content-Type": body.formato === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nomeArquivo}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (url.pathname === "/api/admin/relatorios/historico" && request.method === "GET") {
    if (!temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.RELATORIOS_VISUALIZAR)) {
      return json({ erro: "Seu papel não tem permissão para visualizar o histórico de relatórios." }, 403);
    }
    const { data, error } = await db
      .from("relatorios_exportacoes")
      .select("id,modulo,relatorio_id,formato,total_linhas,nome_arquivo,gerado_por,created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return json({ erro: error.message }, 500);

    const geradoresIds = [...new Set((data ?? []).map((h) => h.gerado_por))];
    const { data: colaboradoresData } = geradoresIds.length
      ? await db.from("colaboradores").select("id,nome").in("id", geradoresIds)
      : { data: [] as any[] };
    const nomesPorId = new Map((colaboradoresData ?? []).map((c: any) => [c.id, c.nome]));

    return json({
      historico: (data ?? []).map((h) => ({
        ...h,
        relatorioNome: REPORT_CATALOG.find((r) => r.id === h.relatorio_id)?.nome ?? h.relatorio_id,
        geradoPorNome: nomesPorId.get(h.gerado_por) ?? h.gerado_por,
      })),
    });
  }

  return json({ erro: "Rota de relatórios não encontrada." }, 404);
}
