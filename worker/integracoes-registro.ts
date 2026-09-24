/**
 * Padrão de integrações.
 *
 * Cada integração é descrita aqui uma única vez: credenciais (do CATALOGO_PROVEDORES),
 * funções com a situação REAL (disponível no Sra Luck, a API permite mas ainda não foi
 * implementado, ou a API não permite), origem/destino, mapeamento de campos, modos de
 * sincronização, webhooks e limites. O Admin e o Dev Console montam a tela a partir
 * deste registro — integração nova = entrada nova aqui.
 *
 * A configuração operacional (não secreta) fica em integracoes_config (migration_090),
 * por provedor e função, validada pelos esquemas deste arquivo. Segredos continuam no
 * cofre cifrado (integracoes_credenciais) e nunca passam por aqui.
 *
 * Fontes das capacidades: docs/INTEGRACOES-MAPA.md.
 */
import { CATALOGO_PROVEDORES } from "./integrations-credenciais";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { hojeSaoPaulo } from "../src/lib/dataCivil";

export type SituacaoFuncao = "disponivel" | "api_permite" | "api_nao_permite";
export type Direcao = "entrada" | "saida" | "bidirecional" | "interna";

export type FuncaoIntegracao = {
  id: string;
  nome: string;
  descricao: string;
  direcao: Direcao;
  origem: string;
  destino: string;
  situacao: SituacaoFuncao;
  /** Por que não está disponível (obrigatório quando situacao != disponivel). */
  motivo?: string;
  /** Tem configuração própria em integracoes_config (liga/desliga e parâmetros). */
  configuravel?: boolean;
};

export type WebhookIntegracao = { direcao: "entrada" | "saida"; descricao: string; caminho?: string; eventos: string[]; autenticacao: string; situacao: SituacaoFuncao; motivo?: string };
export type ModoSincronizacao = { modo: "manual" | "agendada" | "webhook" | "polling" | "sob_demanda"; descricao: string; situacao: SituacaoFuncao; motivo?: string };
export type CampoMapeado = { origem: string; destino: string; observacao?: string };

export type Integracao = {
  id: string;
  nome: string;
  grupo: string;
  documentacao: string;
  autenticacao: string;
  funcoes: FuncaoIntegracao[];
  webhooks: WebhookIntegracao[];
  sincronizacao: ModoSincronizacao[];
  mapeamento: CampoMapeado[];
  limites: string[];
  regras: string[];
};

export const REGISTRO_INTEGRACOES: Integracao[] = [
  {
    id: "gemini",
    nome: "Gemini",
    grupo: "ia",
    documentacao: "https://ai.google.dev/api/generate-content",
    autenticacao: "Chave de API (Google AI Studio) no cofre ou GEMINI_API_KEY.",
    funcoes: [
      { id: "mensagem_diaria", nome: "Mensagem diária", descricao: "Gera a candidata da mensagem do dia (aguarda aprovação), \"pedir outra opção\" e teste de conexão.", direcao: "saida", origem: "Tema do dia e mensagens recentes (sem dados de clientes)", destino: "Candidata em mensagens_do_dia (nunca publicada sozinha)", situacao: "disponivel", configuravel: true },
      { id: "notificacoes", nome: "Notificações financeiras", descricao: "Escreve as mensagens dos lotes, responde a conversa sobre o lote e explica o lote.", direcao: "saida", origem: "Primeiro nome, faixa, parcelas e valores do lote (sem CPF)", destino: "Rascunho das mensagens do lote (aprovação humana)", situacao: "disponivel", configuravel: true },
    ],
    webhooks: [
      { direcao: "entrada", descricao: "Eventos do Google", eventos: [], autenticacao: "—", situacao: "api_nao_permite", motivo: "A API do Gemini é síncrona: não envia eventos." },
    ],
    sincronizacao: [{ modo: "sob_demanda", descricao: "Uma chamada por geração, com fallback de modelo em 404.", situacao: "disponivel" }],
    mapeamento: [
      { origem: "Configuração da função", destino: "modelo, instruções, temperatura, tokens", observacao: "Sem configuração salva, valem os padrões do código." },
    ],
    limites: ["Cota por modelo definida pelo Google (HTTP 429 quando esgota).", "Limite diário por função contado pelo Sra Luck (integracao_uso)."],
    regras: ["Nenhum dado de cliente identificável (CPF, dados médicos) é enviado.", "Texto gerado sempre passa pelos validadores e pela aprovação humana."],
  },
  {
    id: "rd_station",
    nome: "RD Station CRM",
    grupo: "crm",
    documentacao: "https://developers.rdstation.com/reference",
    autenticacao: "OAuth2 (authorize + refresh com rotação), tokens cifrados no cofre.",
    funcoes: [
      { id: "importar_ganhas", nome: "Importar negociações ganhas", descricao: "Lê negociações com status won e grava/atualiza a conferência de novas vendas.", direcao: "entrada", origem: "RD Station: deals (status:won), contacts, users, campaigns, sources", destino: "novas_vendas (conferência humana)", situacao: "disponivel" },
      { id: "webhook_negociacoes", nome: "Receber eventos de negociação", descricao: "Recebe o webhook do RD com segredo e idempotência por transaction_uuid.", direcao: "entrada", origem: "RD Station: evento de negociação", destino: "crm_vendas_entrada / novas_vendas", situacao: "disponivel" },
      { id: "escolher_funil_etapa", nome: "Escolher funil e etapa", descricao: "Importar só um funil e as etapas escolhidas.", direcao: "entrada", origem: "RD Station: GET /pipelines e /pipelines/{id}/stages", destino: "Filtro RDQL da importação", situacao: "api_permite", motivo: "A API tem os endpoints; a escolha ainda não foi implementada." },
      { id: "campos_personalizados", nome: "Campos personalizados", descricao: "Escolher e mapear campos personalizados do RD.", direcao: "entrada", origem: "RD Station: GET /custom_fields", destino: "Campos locais de novas_vendas", situacao: "api_permite", motivo: "A API tem o endpoint; o mapeamento configurável ainda não foi implementado." },
      { id: "sincronizacao_agendada", nome: "Sincronização agendada", descricao: "Buscar negociações alteradas desde a última execução.", direcao: "entrada", origem: "RD Station: deals com filtro por data de alteração (RDQL)", destino: "novas_vendas", situacao: "api_permite", motivo: "Hoje a sincronização é manual." },
      { id: "escrever_no_rd", nome: "Escrever no RD", descricao: "Criar ou alterar negociações/contatos no RD.", direcao: "saida", origem: "Sra Luck", destino: "RD Station", situacao: "api_nao_permite", motivo: "A API permite, mas a regra do projeto proíbe: RD é somente leitura (docs/AUDIT-RD-INTEGRACOES-2026-09-14.md §5)." },
    ],
    webhooks: [
      { direcao: "entrada", descricao: "Eventos de negociação do RD", caminho: "/api/integrations/rd-station/webhook", eventos: ["crm_deal_created", "crm_deal_updated", "crm_deal_deleted"], autenticacao: "Segredo no header (x-sra-luck-rd-key)", situacao: "disponivel" },
    ],
    sincronizacao: [
      { modo: "manual", descricao: "Sincronizar agora (GET paginado, somente leitura).", situacao: "disponivel" },
      { modo: "webhook", descricao: "Evento do RD a cada negociação criada/alterada.", situacao: "disponivel" },
      { modo: "agendada", descricao: "Busca incremental por data de alteração.", situacao: "api_permite", motivo: "Ainda não implementada." },
    ],
    mapeamento: [
      { origem: "deal.id", destino: "novas_vendas.rd_station_id", observacao: "Chave única: evita duplicidade." },
      { origem: "contato (nome, CPF, telefone, e-mail)", destino: "novas_vendas.nome_completo/cpf/telefone/email", observacao: "Só na primeira entrada; depois o RD atualiza só o snapshot rd_*." },
      { origem: "campanha, fonte, dono", destino: "novas_vendas.campanha_local/origem_venda/vendedora_responsavel" },
      { origem: "valor, parcelas", destino: "novas_vendas (valores originais)" },
    ],
    limites: ["Paginação de 100 itens, até 100 páginas por sincronização."],
    regras: ["Somente leitura dos dados comerciais do RD.", "Exclusão no RD marca o snapshot como excluído; não apaga cliente/venda local."],
  },
  {
    id: "conta_azul",
    nome: "Conta Azul",
    grupo: "financeiro",
    documentacao: "https://developers.contaazul.com",
    autenticacao: "OAuth2 authorization code. Hoje o Sra Luck usa CONTA_AZUL_ACCESS_TOKEN (variável de ambiente), sem renovação automática.",
    funcoes: [
      { id: "criar_conta_receber", nome: "Criar conta a receber", descricao: "Cria o evento de contas a receber de uma parcela (vencimento, valor bruto, multa, juros, desconto).", direcao: "saida", origem: "Parcela (boletos) do Sra Luck", destino: "Conta Azul: POST /v1/financeiro/eventos-financeiros/contas-a-receber", situacao: "disponivel", motivo: "Manual pelo Admin; sem garantia contra duplicidade (auditoria P1.4)." },
      { id: "alterar_parcela", nome: "Alterar parcela", descricao: "Altera vencimento, composição de valor, nota ou método com controle de versão.", direcao: "saida", origem: "Sra Luck", destino: "Conta Azul: PATCH /v1/financeiro/eventos-financeiros/parcelas/{id}", situacao: "disponivel", motivo: "Manual pelo Admin." },
      { id: "baixa_sra_para_ca", nome: "Baixa no Sra Luck → Conta Azul", descricao: "Registrar a baixa (data, valor, juros, multa, desconto, conta, método) na parcela da Conta Azul.", direcao: "saida", origem: "Baixa da parcela no Sra Luck", destino: "Conta Azul: POST .../parcelas/{id}/baixa", situacao: "api_permite", motivo: "Endpoint existe; falta o vínculo exato de IDs e a fila." },
      { id: "estorno_baixa", nome: "Estorno de baixa", descricao: "Desfazer uma baixa registrada.", direcao: "saida", origem: "Sra Luck", destino: "Conta Azul: DELETE .../parcelas/baixa/{id}", situacao: "api_permite", motivo: "Endpoint existe; ainda não implementado." },
      { id: "ler_situacao", nome: "Ler situação da parcela", descricao: "Status (PENDENTE, QUITADO, CANCELADO, RENEGOCIADO, RECEBIDO_PARCIAL, ATRASADO, PERDIDO), valor pago e baixas.", direcao: "entrada", origem: "Conta Azul: GET .../parcelas/{id} e /alteracoes", destino: "Sra Luck", situacao: "api_permite", motivo: "Endpoints existem; ainda não implementado." },
      { id: "webhook_baixa", nome: "Baixa na Conta Azul → webhook", descricao: "Ser avisado na hora de uma baixa feita na Conta Azul.", direcao: "entrada", origem: "Conta Azul", destino: "Sra Luck", situacao: "api_nao_permite", motivo: "A Conta Azul não tem webhooks (\"ainda não está disponível nativamente\"). Alternativa: polling em /alteracoes." },
      { id: "cancelar_renegociar", nome: "Cancelar ou renegociar na Conta Azul", descricao: "Cancelar evento/parcela ou renegociar pela API.", direcao: "saida", origem: "Sra Luck", destino: "Conta Azul", situacao: "api_nao_permite", motivo: "Não há endpoint de cancelamento/exclusão de evento; renegociação é só leitura. Vira pendência manual." },
    ],
    webhooks: [
      { direcao: "entrada", descricao: "Eventos da Conta Azul", eventos: [], autenticacao: "—", situacao: "api_nao_permite", motivo: "A API não oferece webhooks; usar polling." },
    ],
    sincronizacao: [
      { modo: "manual", descricao: "Criar recebível / alterar parcela pelo Admin.", situacao: "disponivel" },
      { modo: "polling", descricao: "Ler /v1/financeiro/eventos-financeiros/alteracoes por período e atualizar as parcelas vinculadas.", situacao: "api_permite", motivo: "Ainda não implementado." },
      { modo: "webhook", descricao: "Aviso imediato da Conta Azul.", situacao: "api_nao_permite", motivo: "Sem webhooks na API." },
    ],
    mapeamento: [
      { origem: "boletos.data_vencimento", destino: "parcelas[].data_vencimento" },
      { origem: "boletos.valor", destino: "parcelas[].detalhe_valor.valor_bruto" },
      { origem: "encargos (multa, juros) e desconto", destino: "detalhe_valor.multa / juros / desconto" },
      { origem: "cliente", destino: "contato (UUID da pessoa na Conta Azul)", observacao: "Obrigatório; exige pessoa criada/encontrada na Conta Azul." },
      { origem: "id da parcela no Sra Luck", destino: "nota da parcela (marcador)", observacao: "A API não tem campo de ID externo; a criação devolve só protocolo." },
    ],
    limites: ["600 chamadas/min e 10/s por conta conectada.", "Criação assíncrona (202 + protocolo)."],
    regras: ["Baixas idempotentes e vinculadas à parcela correta (BUSINESS-RULES §9).", "Cancelamento/renegociação no Sra Luck não replicam pela API."],
  },
  {
    id: "mercado_pago",
    nome: "Mercado Pago",
    grupo: "financeiro",
    documentacao: "https://www.mercadopago.com.br/developers",
    autenticacao: "Access token + segredo do webhook no cofre.",
    funcoes: [
      { id: "checkout_parcela", nome: "Checkout da parcela", descricao: "Cria a preferência de pagamento com o valor calculado no backend.", direcao: "saida", origem: "Parcela do Sra Luck", destino: "Mercado Pago", situacao: "disponivel" },
      { id: "webhook_pagamento", nome: "Receber pagamento", descricao: "Valida a assinatura, consulta o pagamento e registra para conferência.", direcao: "entrada", origem: "Mercado Pago", destino: "pagamentos_externos (conferência humana)", situacao: "disponivel" },
    ],
    webhooks: [
      { direcao: "entrada", descricao: "Notificação de pagamento", caminho: "/api/integrations/mercado-pago/webhook", eventos: ["payment"], autenticacao: "Assinatura x-signature (HMAC)", situacao: "disponivel" },
    ],
    sincronizacao: [{ modo: "webhook", descricao: "Evento a cada pagamento.", situacao: "disponivel" }],
    mapeamento: [{ origem: "payment.external_reference", destino: "boletos.id" }],
    limites: [],
    regras: ["Webhook nunca dá baixa: confirmação humana no Financeiro."],
  },
  {
    id: "web_push",
    nome: "Web Push",
    grupo: "comunicacao",
    documentacao: "https://datatracker.ietf.org/doc/html/rfc8292",
    autenticacao: "Par de chaves VAPID + subject.",
    funcoes: [
      { id: "enviar_notificacao", nome: "Enviar notificação ao aparelho", descricao: "Entrega as notificações do app às clientes inscritas.", direcao: "saida", origem: "notificacoes_cliente", destino: "Serviço de push do navegador", situacao: "disponivel" },
    ],
    webhooks: [],
    sincronizacao: [{ modo: "sob_demanda", descricao: "Um envio por notificação.", situacao: "disponivel" }],
    mapeamento: [],
    limites: ["Aceito pelo serviço de push não significa lido pela cliente."],
    regras: [],
  },
];

export function integracao(id: string) {
  return REGISTRO_INTEGRACOES.find((i) => i.id === id) ?? null;
}

// ------------------------------------------------------------------ configuração por função

export type ConfigGemini = {
  ativo: boolean;
  /** null = usa o modelo geral (cofre/ambiente/padrão). */
  modelo: string | null;
  /** Mensagem diária: substitui as instruções de estilo. Notificações: instruções extras de tom (as regras de segurança não mudam). */
  prompt: string | null;
  temperatura: number | null;
  maxTokens: number | null;
  /** Chamadas por dia (data de Brasília); null = sem limite. */
  limiteDiario: number | null;
};

const PADRAO_GEMINI: ConfigGemini = { ativo: true, modelo: null, prompt: null, temperatura: null, maxTokens: null, limiteDiario: null };

type Validacao<T> = { ok: true; config: T } | { ok: false; erro: string };

function validarConfigGemini(bruto: unknown): Validacao<ConfigGemini> {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return { ok: false, erro: "Configuração inválida." };
  const c = bruto as Record<string, unknown>;
  const permitidas = new Set(Object.keys(PADRAO_GEMINI));
  const extra = Object.keys(c).find((k) => !permitidas.has(k));
  if (extra) return { ok: false, erro: `Campo não permitido: ${extra}.` };
  const out: ConfigGemini = { ...PADRAO_GEMINI };
  if (c.ativo !== undefined) { if (typeof c.ativo !== "boolean") return { ok: false, erro: "ativo deve ser verdadeiro ou falso." }; out.ativo = c.ativo; }
  if (c.modelo !== undefined && c.modelo !== null && c.modelo !== "") {
    const m = String(c.modelo).trim().replace(/^models\//i, "").toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(m)) return { ok: false, erro: "Nome de modelo inválido." };
    out.modelo = m;
  }
  if (c.prompt !== undefined && c.prompt !== null && c.prompt !== "") {
    if (typeof c.prompt !== "string" || c.prompt.trim().length > 1500) return { ok: false, erro: "O prompt deve ter até 1500 caracteres." };
    out.prompt = c.prompt.trim();
  }
  const numero = (v: unknown, min: number, max: number, nome: string, inteiro = false): number | null | string => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max || (inteiro && !Number.isInteger(n))) return `${nome} deve estar entre ${min} e ${max}.`;
    return n;
  };
  const t = numero(c.temperatura, 0, 2, "temperatura"); if (typeof t === "string") return { ok: false, erro: t }; out.temperatura = t;
  const mt = numero(c.maxTokens, 64, 8192, "maxTokens", true); if (typeof mt === "string") return { ok: false, erro: mt }; out.maxTokens = mt;
  const ld = numero(c.limiteDiario, 1, 1000, "limiteDiario", true); if (typeof ld === "string") return { ok: false, erro: ld }; out.limiteDiario = ld;
  return { ok: true, config: out };
}

/** Esquemas de configuração por provedor/função. Só estas combinações podem ser gravadas. */
export const ESQUEMAS_CONFIG: Record<string, Record<string, { padrao: unknown; validar: (bruto: unknown) => Validacao<unknown> }>> = {
  gemini: {
    mensagem_diaria: { padrao: PADRAO_GEMINI, validar: validarConfigGemini },
    notificacoes: { padrao: PADRAO_GEMINI, validar: validarConfigGemini },
  },
};

type Db = ReturnType<typeof createServiceSupabaseClient>;
type LinhaConfig = { provedor: string; funcao: string; config: unknown; versao: number; atualizado_por: string | null; atualizado_em: string };

let cacheConfig: { em: number; linhas: LinhaConfig[] } | null = null;
/** Para testes e após gravar. */
export function limparCacheConfig() { cacheConfig = null; }
const CACHE_MS = 30_000;

async function linhasConfig(db: Db, fresco = false): Promise<LinhaConfig[]> {
  if (!fresco && cacheConfig && Date.now() - cacheConfig.em < CACHE_MS) return cacheConfig.linhas;
  const { data, error } = await db.from("integracoes_config").select("provedor,funcao,config,versao,atualizado_por,atualizado_em");
  // Sem a migration_090 aplicada: tudo no padrão (comportamento anterior).
  const linhas = error ? [] : (data ?? []) as LinhaConfig[];
  cacheConfig = { em: Date.now(), linhas };
  return linhas;
}

/** Configuração efetiva de uma função (padrão + o que foi salvo, revalidado). */
export async function configDaFuncao<T>(env: Env, provedor: string, funcao: string, deps: { db?: Db } = {}): Promise<T & { versao: number }> {
  const esquema = ESQUEMAS_CONFIG[provedor]?.[funcao];
  if (!esquema) throw new Error(`Função sem configuração: ${provedor}.${funcao}`);
  let linhas: LinhaConfig[] = [];
  try { linhas = await linhasConfig(deps.db ?? createServiceSupabaseClient(env)); } catch { linhas = []; }
  const linha = linhas.find((l) => l.provedor === provedor && l.funcao === funcao);
  const validado = linha ? esquema.validar(linha.config) : null;
  return { ...(validado?.ok ? validado.config : esquema.padrao) as T, versao: linha?.versao ?? 0 };
}

export async function salvarConfig(env: Env, entrada: { provedor?: unknown; funcao?: unknown; config?: unknown; versao?: unknown }, autor: string, deps: { db?: Db } = {}) {
  const provedor = String(entrada.provedor ?? ""), funcao = String(entrada.funcao ?? "");
  const esquema = ESQUEMAS_CONFIG[provedor]?.[funcao];
  if (!esquema) return { ok: false as const, status: 400, codigo: "funcao_desconhecida", erro: "Essa função não tem configuração." };
  const validado = esquema.validar(entrada.config);
  if (!validado.ok) return { ok: false as const, status: 400, codigo: "config_invalida", erro: validado.erro };
  const db = deps.db ?? createServiceSupabaseClient(env);
  const { data: atual, error: erroLeitura } = await db.from("integracoes_config").select("versao").eq("provedor", provedor).eq("funcao", funcao).maybeSingle<{ versao: number }>();
  if (erroLeitura) return { ok: false as const, status: 409, codigo: "migration_090", erro: "A estrutura de configuração ainda não foi aplicada neste ambiente (migration_090)." };
  const versaoAtual = atual?.versao ?? 0;
  if (entrada.versao !== undefined && Number(entrada.versao) !== versaoAtual) {
    return { ok: false as const, status: 409, codigo: "conflito_versao", erro: "Outra pessoa alterou esta configuração. Recarregue antes de salvar." };
  }
  const agora = new Date().toISOString();
  const linha = { provedor, funcao, config: validado.config, versao: versaoAtual + 1, atualizado_por: autor, atualizado_em: agora };
  const { error } = atual
    ? await db.from("integracoes_config").update(linha).eq("provedor", provedor).eq("funcao", funcao).eq("versao", versaoAtual)
    : await db.from("integracoes_config").insert(linha);
  if (error) return { ok: false as const, status: 409, codigo: "conflito_versao", erro: "Não foi possível salvar (conflito ou estrutura ausente). Recarregue e tente de novo." };
  cacheConfig = null;
  await db.from("logs_alteracoes").insert({ usuario: autor, acao: "configurou_funcao_integracao", entidade: "integracoes", entidade_id: `${provedor}.${funcao}`, detalhes: { versao: linha.versao, config: validado.config } });
  return { ok: true as const, provedor, funcao, versao: linha.versao, config: validado.config };
}

// ------------------------------------------------------------------ uso e limites

/**
 * Reserva uma chamada da função no dia (Brasília). Sem limite: só conta.
 * Retorna false quando o limite do dia já foi atingido. Sem a migration_090,
 * não bloqueia (mantém o comportamento anterior).
 */
export async function consumirUso(env: Env, provedor: string, funcao: string, limite: number | null, deps: { db?: Db; agora?: Date } = {}) {
  try {
    const db = deps.db ?? createServiceSupabaseClient(env);
    const { data, error } = await db.rpc("integracao_consumir_uso", { p_provedor: provedor, p_funcao: funcao, p_dia: hojeSaoPaulo(deps.agora), p_limite: limite });
    if (error) return true;
    return Number(data) !== -1;
  } catch {
    return true;
  }
}

export async function usoDeHoje(db: Db, agora = new Date()) {
  const { data, error } = await db.from("integracao_uso").select("provedor,funcao,chamadas").eq("dia", hojeSaoPaulo(agora));
  return error ? [] : (data ?? []) as { provedor: string; funcao: string; chamadas: number }[];
}

// ------------------------------------------------------------------ catálogo para as telas

export async function catalogo(env: Env, deps: { db?: Db } = {}) {
  const db = deps.db ?? createServiceSupabaseClient(env);
  const [linhas, uso] = await Promise.all([linhasConfig(db, true).catch(() => [] as LinhaConfig[]), usoDeHoje(db).catch(() => [])]);
  return {
    integracoes: REGISTRO_INTEGRACOES.map((i) => ({
      ...i,
      credenciais: (CATALOGO_PROVEDORES[i.id]?.campos ?? []).map((c) => ({ chave: c.chave, label: c.label, obrigatorio: c.obrigatorio })),
      funcoes: i.funcoes.map((f) => {
        const esquema = f.configuravel ? ESQUEMAS_CONFIG[i.id]?.[f.id] : undefined;
        const linha = linhas.find((l) => l.provedor === i.id && l.funcao === f.id);
        const validado = esquema && linha ? esquema.validar(linha.config) : null;
        return {
          ...f,
          config: esquema ? (validado?.ok ? validado.config : esquema.padrao) : undefined,
          versao: linha?.versao ?? 0,
          atualizadoEm: linha?.atualizado_em ?? null,
          atualizadoPor: linha?.atualizado_por ?? null,
          usoHoje: uso.find((u) => u.provedor === i.id && u.funcao === f.id)?.chamadas ?? 0,
        };
      }),
    })),
  };
}
