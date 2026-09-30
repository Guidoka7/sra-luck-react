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
      { id: "importacao", nome: "Importar vendas do CRM", descricao: "Lê as negociações do funil e das etapas escolhidos e grava cada cliente nova em Aguardando cadastro. Nunca cria cliente nem encaminha ao Financeiro.", direcao: "entrada", origem: "RD Station: GET /crm/v2/deals (RDQL por funil, etapa e status), contacts, users, campaigns, sources", destino: "novas_vendas (status aguardando_cadastro) + histórico da importação", situacao: "disponivel", configuravel: true },
      { id: "escolher_funil_etapa", nome: "Escolher funil e etapas", descricao: "Funis, etapas, campos e valores de cada funil ficam pré-calculados e são renovados pelo agendador (ou em Atualizar do RD).", direcao: "entrada", origem: "RD Station: GET /crm/v2/pipelines e /pipelines/{id}/stages", destino: "Filtro RDQL pipeline_id / stage_id", situacao: "disponivel" },
      { id: "campos_personalizados", nome: "Escolher e mapear campos", descricao: "Cada campo do Sra Luck vem da leitura automática, de um campo personalizado da negociação ou do contato, ou é ignorado.", direcao: "entrada", origem: "RD Station: GET /crm/v2/custom_fields (slug)", destino: "Campos de novas_vendas", situacao: "disponivel" },
      { id: "deduplicacao", nome: "Deduplicação por CPF, telefone e e-mail", descricao: "Negociação cujo CPF, telefone ou e-mail já pertence a uma cliente ou a outra venda pendente não vira venda nova: fica no histórico para revisão humana.", direcao: "interna", origem: "Dados normalizados do contato", destino: "Histórico (duplicada / cliente existente)", situacao: "disponivel" },
      { id: "avanco_da_venda", nome: "Avanço da venda", descricao: "A venda só passa a Financeiro concluído quando a cliente tem parcelas cadastradas E acesso ao app liberado.", direcao: "interna", origem: "clientes.acesso_app_liberado + boletos", destino: "novas_vendas.status", situacao: "disponivel" },
      { id: "webhook_negociacoes", nome: "Receber eventos de negociação", descricao: "Recebe o webhook do RD com segredo e idempotência por transaction_uuid, com os mesmos filtros e a mesma deduplicação.", direcao: "entrada", origem: "RD Station: evento de negociação", destino: "crm_vendas_entrada / novas_vendas", situacao: "disponivel" },
      { id: "escrever_no_rd", nome: "Escrever no RD", descricao: "Criar ou alterar negociações/contatos no RD.", direcao: "saida", origem: "Sra Luck", destino: "RD Station", situacao: "api_nao_permite", motivo: "A API permite, mas a regra do projeto proíbe: RD é somente leitura (docs/AUDIT-RD-INTEGRACOES-2026-09-14.md §5)." },
    ],
    webhooks: [
      { direcao: "entrada", descricao: "Eventos de negociação do RD", caminho: "/api/integrations/rd-station/webhook", eventos: ["crm_deal_created", "crm_deal_updated", "crm_deal_deleted"], autenticacao: "Segredo no header (x-sra-luck-rd-key)", situacao: "disponivel" },
    ],
    sincronizacao: [
      { modo: "manual", descricao: "Importar agora (GET paginado, somente leitura).", situacao: "disponivel" },
      { modo: "agendada", descricao: "Na frequência configurada (15 min a 24 h), pelo agendador a cada 15 min.", situacao: "disponivel" },
      { modo: "webhook", descricao: "Evento do RD a cada negociação criada/alterada.", situacao: "disponivel" },
    ],
    mapeamento: [
      { origem: "deal.id", destino: "novas_vendas.rd_station_id", observacao: "Chave única: a mesma negociação nunca entra duas vezes." },
      { origem: "contato: nome", destino: "novas_vendas.nome_completo", observacao: "Sempre importado." },
      { origem: "CPF, telefone, e-mail, valor, parcelas, valor da parcela, taxa, tipo de venda, procedimento, banco", destino: "novas_vendas (cópia local)", observacao: "Fonte configurável por campo: automática, campo personalizado (negociação ou contato) ou ignorar." },
      { origem: "campanha, fonte, dono", destino: "novas_vendas.campanha_local/origem_venda/vendedora_responsavel" },
      { origem: "alterações posteriores no RD", destino: "somente o snapshot rd_*", observacao: "A cópia local editada no Admin não é sobrescrita." },
    ],
    limites: ["Paginação de 100 itens, até 100 páginas por importação.", "Filtro RDQL: pipeline_id, stage_id:(…), status."],
    regras: [
      "Somente leitura dos dados comerciais do RD.",
      "Toda cliente nova entra em Aguardando cadastro; a importação nunca cria cliente nem encaminha ao Financeiro.",
      "Duplicidade (CPF, telefone ou e-mail) nunca sobrescreve nada: vai para revisão.",
      "Exclusão no RD marca o snapshot como excluído; não apaga cliente/venda local.",
    ],
  },
  {
    id: "conta_azul",
    nome: "Conta Azul",
    grupo: "financeiro",
    documentacao: "https://developers.contaazul.com",
    autenticacao: "OAuth2 authorization code (login.contaazul.com) com renovação automática: access token de 1 h, refresh token trocado a cada renovação e guardado cifrado no cofre.",
    funcoes: [
      { id: "conexao", nome: "Conexão (ambiente e endereços)", descricao: "Ambiente teste/produção e URLs OAuth/API (só HTTPS em *.contaazul.com). Client ID/Secret e tokens ficam no cofre cifrado.", direcao: "interna", origem: "Dev Console", destino: "integracoes_config", situacao: "disponivel", configuravel: true },
      { id: "vinculo_pessoa", nome: "Vínculo da cliente pelo CPF", descricao: "Busca a pessoa pelo CPF (documento idêntico), a equipe confirma e o ID da pessoa fica gravado. Nunca por nome; mais de uma pessoa ou CPF diferente não vinculam.", direcao: "entrada", origem: "Conta Azul: GET /v1/pessoas?documentos= e GET /v1/pessoas/{id}", destino: "cliente_vinculos_externos", situacao: "disponivel" },
      { id: "importar_financeiro", nome: "Financeiro a partir da Conta Azul", descricao: "Cliente sem parcelas no Sra Luck: monta o financeiro com os lançamentos da pessoa (pagas com a composição das baixas, abertas, vencidas), numa transação, sem duplicar.", direcao: "entrada", origem: "Conta Azul: contas-a-receber/buscar + parcelas/{id}", destino: "boletos + financeiro_recebimentos + conta_azul_vinculos", situacao: "disponivel" },
      { id: "conciliacao", nome: "Conferência de vínculos", descricao: "Cliente com financeiro: compara valores, vencimentos e status e separa correspondências, divergências, só no Sra Luck e só na Conta Azul. A equipe confirma cada par; vencimento diferente pode ser aceito sem alterar nenhum dos lados.", direcao: "interna", origem: "Sra Luck × Conta Azul", destino: "conta_azul_vinculos", situacao: "disponivel" },
      { id: "sincronizacao", nome: "Sincronização de parcelas", descricao: "A cada 15 min e sob demanda: envia alterações do Sra Luck, lê as alterações da Conta Azul, processa a fila e abre conflitos.", direcao: "bidirecional", origem: "Sra Luck (boletos) e Conta Azul (/alteracoes)", destino: "Conta Azul e Sra Luck", situacao: "disponivel", configuravel: true },
      { id: "criar_conta_receber", nome: "Criar conta a receber vinculada", descricao: "Cria o lançamento da parcela com um marcador único; como a API devolve só protocolo, o vínculo é confirmado lendo a Conta Azul (busca pelo marcador).", direcao: "saida", origem: "Parcela (boletos) do Sra Luck", destino: "Conta Azul: POST /v1/financeiro/eventos-financeiros/contas-a-receber", situacao: "disponivel" },
      { id: "vinculo", nome: "Vínculo permanente", descricao: "Cada parcela guarda o ID do evento e da parcela na Conta Azul. Também é possível vincular um lançamento já existente (só se valor e vencimento baterem).", direcao: "interna", origem: "Sra Luck", destino: "conta_azul_vinculos", situacao: "disponivel" },
      { id: "alterar_parcela", nome: "Valor, vencimento e encargos", descricao: "O Sra Luck é a fonte: mudança de valor ou vencimento no Sra Luck atualiza a Conta Azul com controle de versão. Mudança feita na Conta Azul vira conflito.", direcao: "saida", origem: "Sra Luck", destino: "Conta Azul: PATCH .../parcelas/{id} (versao)", situacao: "disponivel" },
      { id: "baixa_sra_para_ca", nome: "Baixa no Sra Luck → Conta Azul", descricao: "Parcela paga no Sra Luck registra a baixa na Conta Azul com a composição do recebimento (principal, juros, multa, desconto e forma), sem duplicar. Pagamento que veio da Conta Azul não volta para lá.", direcao: "saida", origem: "Baixa da parcela no Sra Luck", destino: "Conta Azul: POST .../parcelas/{id}/baixa", situacao: "disponivel" },
      { id: "baixa_ca_para_sra", nome: "Baixa na Conta Azul → Sra Luck e app", descricao: "Parcela quitada na Conta Azul entra no ledger do Sra Luck com juros, multa e desconto das baixas (e aparece no app) quando o vínculo é seguro; caso contrário, vai para revisão.", direcao: "entrada", origem: "Conta Azul: GET /alteracoes + GET /{evento}/parcelas", destino: "financeiro_recebimentos (origem conta_azul) + boletos.status = pago", situacao: "disponivel" },
      { id: "estorno_baixa", nome: "Estorno de baixa", descricao: "Baixa desfeita no Sra Luck apaga a baixa que o Sra Luck criou na Conta Azul. Baixa removida na Conta Azul vira conflito (nunca estorna sozinho no Sra Luck).", direcao: "bidirecional", origem: "Sra Luck / Conta Azul", destino: "Conta Azul: DELETE .../parcelas/baixa/{id}", situacao: "disponivel" },
      { id: "webhook_baixa", nome: "Aviso imediato da Conta Azul", descricao: "Ser avisado na hora de uma baixa feita na Conta Azul.", direcao: "entrada", origem: "Conta Azul", destino: "Sra Luck", situacao: "api_nao_permite", motivo: "A Conta Azul não tem webhooks (\"ainda não está disponível nativamente\"). O Sra Luck lê /alteracoes a cada 15 min." },
      { id: "cancelar_renegociar", nome: "Cancelar ou renegociar na Conta Azul", descricao: "Cancelar evento/parcela ou renegociar pela API.", direcao: "saida", origem: "Sra Luck", destino: "Conta Azul", situacao: "api_nao_permite", motivo: "Não há endpoint de cancelamento/exclusão de evento; renegociação é só leitura. Cancelado/renegociado/perdido na Conta Azul vira conflito para revisão." },
      { id: "anexos", nome: "Comprovante como anexo na Conta Azul", descricao: "Enviar o comprovante da cliente para o lançamento.", direcao: "saida", origem: "Sra Luck", destino: "Conta Azul", situacao: "api_nao_permite", motivo: "A parcela só lista anexos (campo anexos); não há endpoint para enviar arquivo a um lançamento. O comprovante continua no Sra Luck." },
      { id: "id_externo", nome: "ID externo na Conta Azul", descricao: "Gravar o ID do Sra Luck num campo próprio da Conta Azul.", direcao: "saida", origem: "Sra Luck", destino: "Conta Azul", situacao: "api_nao_permite", motivo: "A API não tem campo de ID externo. O Sra Luck usa um marcador na descrição/nota e guarda os IDs da Conta Azul no vínculo." },
    ],
    webhooks: [
      { direcao: "entrada", descricao: "Eventos da Conta Azul", eventos: [], autenticacao: "—", situacao: "api_nao_permite", motivo: "A API não oferece webhooks; o Sra Luck faz polling em /alteracoes." },
    ],
    sincronizacao: [
      { modo: "polling", descricao: "A cada 15 min: /v1/financeiro/eventos-financeiros/alteracoes desde a última leitura + verificação dos vínculos mais antigos.", situacao: "disponivel" },
      { modo: "manual", descricao: "Sincronizar agora, enviar as parcelas de uma cliente, vincular lançamento existente, reprocessar a fila.", situacao: "disponivel" },
      { modo: "webhook", descricao: "Aviso imediato da Conta Azul.", situacao: "api_nao_permite", motivo: "Sem webhooks na API." },
    ],
    mapeamento: [
      { origem: "boletos.data_vencimento", destino: "parcela.data_vencimento / vencimento", observacao: "Fonte: Sra Luck." },
      { origem: "boletos.valor", destino: "detalhe_valor.valor_bruto / composicao_valor.valor_bruto", observacao: "Fonte: Sra Luck." },
      { origem: "recebimento validado (valor_original, juros, multa, desconto, forma)", destino: "baixa: composicao_valor.valor_bruto / juros / multa / desconto + metodo_pagamento", observacao: "Nos dois sentidos; nada é recalculado." },
      { origem: "boletos.data_pagamento", destino: "baixa.data_pagamento" },
      { origem: "cliente (CPF) → pessoa confirmada", destino: "cliente_vinculos_externos.id_externo = pessoa.id", observacao: "Busca por documento exato + confirmação humana." },
      { origem: "marcador SLK-… (id da parcela)", destino: "descrição e nota da parcela", observacao: "Usado para localizar o lançamento criado (a API devolve só protocolo)." },
      { origem: "IDs da Conta Azul (evento, parcela, versão, baixa)", destino: "conta_azul_vinculos" },
    ],
    limites: ["600 chamadas/min e 10/s por conta conectada.", "Criação assíncrona (202 + protocolo, sem ID).", "Consulta de alterações por período (data/hora de Brasília)."],
    regras: [
      "Sra Luck é a fonte de valor, vencimento e encargos.",
      "Baixa da Conta Azul só é aplicada sozinha com vínculo seguro: vínculo confirmado, parcela quitada por inteiro, mesmo valor bruto, soma das baixas fechando o valor e parcela do Sra Luck em aberto (com comprovante aguardando conferência, vai para revisão).",
      "Vencimento diferente entre os sistemas pode ser aceito no vínculo; nenhum vencimento é alterado para \"fazer bater\".",
      "Qualquer divergência vai para a fila de revisão; nada é sobrescrito em silêncio.",
      "Baixas idempotentes: o Sra Luck confere as baixas existentes antes de criar e só apaga baixa que ele mesmo criou.",
      "Parcela vinculada não pode ser excluída no Sra Luck.",
    ],
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

// ------------------------------------------------------------------ CRM (RD Station) → importação

export const CAMPOS_CRM = ["cpf", "telefone", "email", "vendedora", "origem", "campanha", "valor_contrato", "quantidade_parcelas", "valor_parcela", "taxa_administrativa", "tipo_venda", "procedimento", "banco"] as const;
export type CampoCrm = typeof CAMPOS_CRM[number];
/** auto = leitura automática atual; ignorar = não importa; deal:<slug> / contact:<slug> = campo personalizado. */
export type FonteCampoCrm = string;
export const FREQUENCIAS_CRM = [15, 30, 60, 180, 360, 720, 1440] as const;

export type CampoSelecionadoCrm = { fonte: string; rotulo: string };
/** Campos padrão do RD (não personalizados), com nome legível. */
const ROTULOS_NATIVOS_CRM: Record<string, string> = {
  "deal_field:name": "Negociação: Nome",
  "deal_field:owner_id": "Negociação: Responsável (vendedora)",
  "deal_field:source_id": "Negociação: Fonte",
  "deal_field:campaign_id": "Negociação: Campanha",
  "deal_field:total_price": "Negociação: Valor total",
  "deal_field:one_time_price": "Negociação: Valor único",
  "deal_field:recurrence_price": "Negociação: Valor recorrente",
  "deal_field:closed_at": "Negociação: Data de fechamento",
  "deal_field:expected_close_date": "Negociação: Previsão de fechamento",
  "deal_field:created_at": "Negociação: Data de criação",
  "deal_field:updated_at": "Negociação: Última atualização",
  "deal_field:status": "Negociação: Status",
  "deal_field:pipeline_id": "Negociação: Funil",
  "deal_field:stage_id": "Negociação: Etapa",
  "deal_field:user_id": "Negociação: Responsável (formato antigo)",
  "contact_field:name": "Contato: Nome",
  "contact_field:emails": "Contato: E-mail",
  "contact_field:phones": "Contato: Telefone",
  "contact_field:whatsapp_username": "Contato: Nome de usuário no WhatsApp",
  "contact_field:job_title": "Contato: Cargo",
  "contact_field:birthday": "Contato: Data de aniversário",
};
export const CAMPOS_NATIVOS_CRM = Object.entries(ROTULOS_NATIVOS_CRM).map(([fonte, rotulo]) => ({ fonte, rotulo }));
export const rotuloNativoCrm = (fonte: string) => ROTULOS_NATIVOS_CRM[fonte] ?? fonte;
const ehNativoCrm = (fonte: string) => fonte in ROTULOS_NATIVOS_CRM;

/** Filtros por valor aceitos dentro de um funil (valores = IDs do RD ou opções do campo). */
export type FiltroCrmFunil = { fonte: string; valores: string[] };
const FONTE_FILTRO_CRM = /^(deal_field:(owner_id|source_id|campaign_id)|deal:[a-z0-9_-]{1,100})$/;

export function validarFiltrosCrm(bruto: unknown): Validacao<FiltroCrmFunil[]> {
  if (bruto === undefined || bruto === null) return { ok: true, config: [] };
  if (!Array.isArray(bruto) || bruto.length > 10) return { ok: false, erro: "Use no máximo 10 filtros por funil." };
  const fontes = new Set<string>();
  const out: FiltroCrmFunil[] = [];
  for (const item of bruto) {
    const f = objeto(item);
    if (!f || Object.keys(f).some((k) => !["fonte", "valores"].includes(k)) || typeof f.fonte !== "string" || !FONTE_FILTRO_CRM.test(f.fonte))
      return { ok: false, erro: "Filtro de funil inválido." };
    if (fontes.has(f.fonte)) return { ok: false, erro: "O mesmo filtro foi usado duas vezes no funil." };
    if (!Array.isArray(f.valores) || f.valores.length > 300 || f.valores.some((v) => typeof v !== "string" || !v.trim() || v.length > 200))
      return { ok: false, erro: "Valores de filtro inválidos." };
    const valores = [...new Set((f.valores as string[]).map((v) => v.trim()))];
    // Filtro sem valor marcado = sem filtro: não é gravado.
    if (!valores.length) continue;
    fontes.add(f.fonte);
    out.push({ fonte: f.fonte, valores });
  }
  return { ok: true, config: out };
}

export function validarCamposSelecionadosCrm(bruto: unknown): Validacao<CampoSelecionadoCrm[]> {
  if (bruto === undefined) return { ok: true, config: [] };
  if (!Array.isArray(bruto) || bruto.length > 100) return { ok: false, erro: "Selecione até 100 campos por funil." };
  const fontes = new Set<string>();
  const config: CampoSelecionadoCrm[] = [];
  for (const item of bruto) {
    const c = objeto(item);
    if (!c || Object.keys(c).some((k) => !["fonte", "rotulo"].includes(k)) || typeof c.fonte !== "string" ||
      (!/^(deal|contact):[a-z0-9_]{1,60}$/.test(c.fonte) && !ehNativoCrm(c.fonte)))
      return { ok: false, erro: "Origem de campo selecionado inválida." };
    if (typeof c.rotulo !== "string" || !c.rotulo.trim() || c.rotulo.trim().length > 100)
      return { ok: false, erro: "Dê um nome de até 100 caracteres a cada campo selecionado." };
    if (fontes.has(c.fonte)) return { ok: false, erro: "O mesmo campo foi selecionado duas vezes no funil." };
    fontes.add(c.fonte);
    config.push({ fonte: c.fonte, rotulo: c.rotulo.trim() });
  }
  return { ok: true, config };
}

export type ConfigCrmFunil = {
  /** Campos escolhidos livremente; não criam colunas nem sobrescrevem o cadastro. */
  camposSelecionados?: CampoSelecionadoCrm[];
  /** Importa só negociações cujos valores estejam entre os marcados (vazio = sem filtro). */
  filtros?: FiltroCrmFunil[];
  pipelineId: string;
  /** Vazio = todas as etapas desse funil. */
  etapas: string[];
  /** Mapeamento específico deste funil. */
  mapeamento: Record<CampoCrm, FonteCampoCrm>;
};

export type ConfigCrm = {
  /** Importação agendada ligada (a manual e o webhook funcionam sempre). */
  ativo: boolean;
  frequenciaMinutos: number;
  /**
   * Configuração nova: vários funis, cada um com etapas e mapeamento próprios.
   * Vazio = todos os funis usando o mapeamento padrão.
   */
  funis: ConfigCrmFunil[];
  /** Lê todos os funis/etapas; funis selecionados conservam apenas mapeamentos próprios. */
  todosFunis: boolean;
  /**
   * Compatibilidade com configurações antigas. Quando `funis` é salvo,
   * estes dois campos ficam limpos.
   */
  pipelineId: string | null;
  etapas: string[];
  status: "won" | "ongoing" | "qualquer";
  /** Padrão/fallback quando não há override por funil. */
  mapeamento: Record<CampoCrm, FonteCampoCrm>;
  deduplicarPor: { cpf: boolean; telefone: boolean; email: boolean };
};

const MAPEAMENTO_CRM_PADRAO = () =>
  Object.fromEntries(CAMPOS_CRM.map((c) => [c, "auto"])) as Record<CampoCrm, FonteCampoCrm>;

export const PADRAO_CRM: ConfigCrm = {
  ativo: false,
  frequenciaMinutos: 60,
  funis: [],
  todosFunis: false,
  pipelineId: null,
  etapas: [],
  status: "won",
  mapeamento: MAPEAMENTO_CRM_PADRAO(),
  // Duplicata = mesmo telefone (decisão do responsável, 29/09/2026). cpf/email ficam só por compatibilidade.
  deduplicarPor: { cpf: false, telefone: true, email: false },
};

const ID_RD = /^[0-9a-f]{24}$/;
const FONTE_CRM = /^(auto|ignorar|(deal|contact):[a-z0-9_]{1,60})$/;
/** IDs internos do RD não viram dado da venda. */
const NATIVOS_SEM_VALOR = new Set(["deal_field:pipeline_id", "deal_field:stage_id", "deal_field:status", "deal_field:updated_at"]);

function objeto(bruto: unknown): Record<string, unknown> | null {
  return bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto as Record<string, unknown> : null;
}

function validarMapaCrm(bruto: unknown, base: Record<CampoCrm, FonteCampoCrm>): Validacao<Record<CampoCrm, FonteCampoCrm>> {
  if (bruto === undefined || bruto === null) return { ok: true, config: { ...base } };
  const m = objeto(bruto);
  if (!m) return { ok: false, erro: "Mapeamento inválido." };
  const out = { ...base };
  for (const [campo, fonte] of Object.entries(m)) {
    if (!(CAMPOS_CRM as readonly string[]).includes(campo)) return { ok: false, erro: `Campo do Sra Luck desconhecido: ${campo}.` };
    if (typeof fonte !== "string" || (!FONTE_CRM.test(fonte) && !(ehNativoCrm(fonte) && !NATIVOS_SEM_VALOR.has(fonte)))) return { ok: false, erro: `Fonte inválida para ${campo}.` };
    out[campo as CampoCrm] = fonte;
  }
  return { ok: true, config: out };
}

export function validarConfigCrm(bruto: unknown): Validacao<ConfigCrm> {
  const c = objeto(bruto);
  if (!c) return { ok: false, erro: "Configuração inválida." };
  const extra = Object.keys(c).find((k) => !(k in PADRAO_CRM));
  if (extra) return { ok: false, erro: `Campo não permitido: ${extra}.` };

  const out: ConfigCrm = {
    ...PADRAO_CRM,
    funis: [],
    mapeamento: MAPEAMENTO_CRM_PADRAO(),
    deduplicarPor: { ...PADRAO_CRM.deduplicarPor },
    etapas: [],
  };

  if (c.ativo !== undefined) {
    if (typeof c.ativo !== "boolean") return { ok: false, erro: "ativo deve ser verdadeiro ou falso." };
    out.ativo = c.ativo;
  }
  if (c.todosFunis !== undefined) {
    if (typeof c.todosFunis !== "boolean") return { ok: false, erro: "todosFunis deve ser verdadeiro ou falso." };
    out.todosFunis = c.todosFunis;
  }
  if (c.frequenciaMinutos !== undefined && c.frequenciaMinutos !== null) {
    const f = Number(c.frequenciaMinutos);
    if (!(FREQUENCIAS_CRM as readonly number[]).includes(f)) return { ok: false, erro: `Frequência deve ser uma de: ${FREQUENCIAS_CRM.join(", ")} minutos.` };
    out.frequenciaMinutos = f;
  }

  if (c.status !== undefined && c.status !== null) {
    if (!["won", "ongoing", "qualquer"].includes(String(c.status))) return { ok: false, erro: "Status inválido." };
    out.status = c.status as ConfigCrm["status"];
  }

  const mapaPadrao = validarMapaCrm(c.mapeamento, MAPEAMENTO_CRM_PADRAO());
  if (!mapaPadrao.ok) return mapaPadrao;
  out.mapeamento = mapaPadrao.config;

  // Formato antigo: um único funil.
  if (c.pipelineId !== undefined && c.pipelineId !== null && c.pipelineId !== "") {
    if (typeof c.pipelineId !== "string" || !ID_RD.test(c.pipelineId)) return { ok: false, erro: "Funil inválido." };
    out.pipelineId = c.pipelineId;
  }
  if (c.etapas !== undefined && c.etapas !== null) {
    if (!Array.isArray(c.etapas) || c.etapas.length > 50 || c.etapas.some((e) => typeof e !== "string" || !ID_RD.test(e))) return { ok: false, erro: "Etapas inválidas." };
    out.etapas = [...new Set(c.etapas as string[])];
  }
  if (out.etapas.length && !out.pipelineId && c.funis === undefined) return { ok: false, erro: "Escolha o funil antes das etapas." };

  // Formato novo: vários funis com etapas e mapeamento independentes.
  if (c.funis !== undefined && c.funis !== null) {
    if (!Array.isArray(c.funis) || c.funis.length > 20) return { ok: false, erro: "Selecione no máximo 20 funis." };
    const ids = new Set<string>();
    for (const brutoFunil of c.funis) {
      const funil = objeto(brutoFunil);
      if (!funil) return { ok: false, erro: "Configuração de funil inválida." };
      if (Object.keys(funil).some((k) => !["pipelineId", "etapas", "mapeamento", "camposSelecionados", "filtros"].includes(k))) return { ok: false, erro: "Configuração de funil possui campo não permitido." };

      const pipelineId = typeof funil.pipelineId === "string" ? funil.pipelineId : "";
      if (!ID_RD.test(pipelineId)) return { ok: false, erro: "Funil inválido." };
      if (ids.has(pipelineId)) return { ok: false, erro: "O mesmo funil não pode ser selecionado duas vezes." };
      ids.add(pipelineId);

      const etapas = funil.etapas == null ? [] : funil.etapas;
      if (!Array.isArray(etapas) || etapas.length > 50 || etapas.some((e) => typeof e !== "string" || !ID_RD.test(e))) return { ok: false, erro: "Etapas inválidas em um dos funis." };

      const mapa = validarMapaCrm(funil.mapeamento, out.mapeamento);
      if (!mapa.ok) return mapa;
      const selecionados = validarCamposSelecionadosCrm(funil.camposSelecionados);
      if (!selecionados.ok) return selecionados;
      const filtros = validarFiltrosCrm(funil.filtros);
      if (!filtros.ok) return filtros;
      out.funis.push({
        camposSelecionados: selecionados.config,
        filtros: filtros.config,
        pipelineId,
        etapas: [...new Set(etapas as string[])],
        mapeamento: mapa.config,
      });
    }
    // A configuração nova é a fonte de verdade; limpa o legado para não haver ambiguidade.
    out.pipelineId = null;
    out.etapas = [];
  } else if (out.pipelineId) {
    // Migra em memória a configuração antiga sem exigir alteração imediata no banco.
    out.funis = [{
      pipelineId: out.pipelineId,
      etapas: [...out.etapas],
      mapeamento: { ...out.mapeamento },
    }];
  }

  if (c.deduplicarPor !== undefined && c.deduplicarPor !== null) {
    const d = objeto(c.deduplicarPor);
    if (!d || Object.keys(d).some((k) => !["cpf", "telefone", "email"].includes(k)) || Object.values(d).some((v) => typeof v !== "boolean")) return { ok: false, erro: "Deduplicação inválida." };
    Object.assign(out.deduplicarPor, d);
  }
  return { ok: true, config: out };
}

// ------------------------------------------------------------------ Conta Azul → sincronização

export const METODOS_CONTA_AZUL = ["BOLETO_BANCARIO", "PIX_PAGAMENTO_INSTANTANEO", "TRANSFERENCIA_BANCARIA", "CARTAO_CREDITO", "CARTAO_DEBITO", "DINHEIRO", "DEPOSITO_BANCARIO", "OUTRO"] as const;

export type ConfigContaAzul = {
  /** Sincronização automática a cada 15 min (a manual funciona sempre). */
  ativo: boolean;
  contaFinanceiraId: string | null;
  categoriaId: string | null;
  metodoPagamento: typeof METODOS_CONTA_AZUL[number];
  /** Sra Luck → Conta Azul: valor e vencimento. */
  enviarAlteracoes: boolean;
  /** Sra Luck → Conta Azul: baixas e estornos. */
  enviarBaixas: boolean;
  /** Conta Azul → Sra Luck: baixa automática quando o vínculo é seguro. */
  baixaAutomatica: boolean;
};

export const PADRAO_CONTA_AZUL: ConfigContaAzul = {
  ativo: false, contaFinanceiraId: null, categoriaId: null, metodoPagamento: "BOLETO_BANCARIO",
  enviarAlteracoes: true, enviarBaixas: true, baixaAutomatica: true,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validarConfigContaAzul(bruto: unknown): Validacao<ConfigContaAzul> {
  const c = objeto(bruto);
  if (!c) return { ok: false, erro: "Configuração inválida." };
  const extra = Object.keys(c).find((k) => !(k in PADRAO_CONTA_AZUL));
  if (extra) return { ok: false, erro: `Campo não permitido: ${extra}.` };
  const out: ConfigContaAzul = { ...PADRAO_CONTA_AZUL };
  for (const k of ["ativo", "enviarAlteracoes", "enviarBaixas", "baixaAutomatica"] as const) {
    if (c[k] !== undefined) { if (typeof c[k] !== "boolean") return { ok: false, erro: `${k} deve ser verdadeiro ou falso.` }; out[k] = c[k] as boolean; }
  }
  for (const k of ["contaFinanceiraId", "categoriaId"] as const) {
    const v = c[k];
    if (v !== undefined && v !== null && v !== "") {
      if (typeof v !== "string" || !UUID.test(v)) return { ok: false, erro: `${k === "contaFinanceiraId" ? "Conta financeira" : "Categoria"} inválida.` };
      out[k] = v.toLowerCase();
    }
  }
  if (c.metodoPagamento !== undefined && c.metodoPagamento !== null) {
    if (!(METODOS_CONTA_AZUL as readonly string[]).includes(String(c.metodoPagamento))) return { ok: false, erro: "Método de pagamento inválido." };
    out.metodoPagamento = c.metodoPagamento as ConfigContaAzul["metodoPagamento"];
  }
  if (out.ativo && !out.contaFinanceiraId) return { ok: false, erro: "Escolha a conta financeira antes de ligar a sincronização." };
  return { ok: true, config: out };
}

// ------------------------------------------------------------------ Conta Azul → conexão (ambiente e endereços)

export type ConfigConexaoContaAzul = {
  /** teste = conta ERP do App de Desenvolvimento (30 dias); producao = conta real da Sra. Luck. */
  ambiente: "teste" | "producao";
  authorizeUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
};

/** Endereços oficiais (developers.contaazul.com, changelog de 14/08/2026). */
export const PADRAO_CONEXAO_CONTA_AZUL: ConfigConexaoContaAzul = {
  ambiente: "teste",
  authorizeUrl: "https://login.contaazul.com/#/oauth/authorize",
  tokenUrl: "https://api-v2.contaazul.com/oauth/token",
  apiBaseUrl: "https://api-v2.contaazul.com",
};

/**
 * Só HTTPS em hosts da Conta Azul: o Client Secret vai no cabeçalho da troca de token, então um
 * endereço livre seria um jeito de vazar a credencial.
 */
function urlContaAzul(v: unknown, comHash: boolean): string | null {
  if (typeof v !== "string" || v.length > 300) return null;
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  if (!(u.hostname === "contaazul.com" || u.hostname.endsWith(".contaazul.com"))) return null;
  if (u.search || (!comHash && u.hash)) return null;
  return v.replace(/\/$/, "");
}

export function validarConfigConexaoContaAzul(bruto: unknown): Validacao<ConfigConexaoContaAzul> {
  const c = objeto(bruto);
  if (!c) return { ok: false, erro: "Configuração inválida." };
  const extra = Object.keys(c).find((k) => !(k in PADRAO_CONEXAO_CONTA_AZUL));
  if (extra) return { ok: false, erro: `Campo não permitido: ${extra}.` };
  const out: ConfigConexaoContaAzul = { ...PADRAO_CONEXAO_CONTA_AZUL };
  if (c.ambiente !== undefined) {
    if (c.ambiente !== "teste" && c.ambiente !== "producao") return { ok: false, erro: "Ambiente deve ser teste ou produção." };
    out.ambiente = c.ambiente;
  }
  const rotulos = { authorizeUrl: "URL de autorização", tokenUrl: "URL de token", apiBaseUrl: "URL base da API" } as const;
  for (const k of ["authorizeUrl", "tokenUrl", "apiBaseUrl"] as const) {
    if (c[k] === undefined || c[k] === null || c[k] === "") continue;
    const url = urlContaAzul(c[k], k === "authorizeUrl");
    if (!url) return { ok: false, erro: `${rotulos[k]} precisa ser HTTPS num endereço *.contaazul.com.` };
    out[k] = url;
  }
  return { ok: true, config: out };
}

const CAMPOS_CONEXAO_CONTA_AZUL: CampoFormulario[] = [
  { chave: "ambiente", rotulo: "Ambiente", tipo: "selecao", opcoes: [{ valor: "teste", rotulo: "Teste (conta ERP de desenvolvimento)" }, { valor: "producao", rotulo: "Produção (conta real)" }], ajuda: "A conta conectada pelo OAuth define os dados; troque para Produção só com autorização." },
  { chave: "authorizeUrl", rotulo: "URL de autorização (OAuth)", tipo: "texto", placeholder: PADRAO_CONEXAO_CONTA_AZUL.authorizeUrl, maxLength: 300 },
  { chave: "tokenUrl", rotulo: "URL de token (OAuth)", tipo: "texto", placeholder: PADRAO_CONEXAO_CONTA_AZUL.tokenUrl, maxLength: 300 },
  { chave: "apiBaseUrl", rotulo: "URL base da API", tipo: "texto", placeholder: PADRAO_CONEXAO_CONTA_AZUL.apiBaseUrl, maxLength: 300 },
];

// ------------------------------------------------------------------ descrição dos formulários (telas genéricas)

/** Como as telas desenham o formulário de cada função. opcoesDe = lista lida na hora do provedor. */
export type CampoFormulario = {
  chave: string;
  rotulo: string;
  tipo: "booleano" | "numero" | "texto" | "texto_longo" | "selecao" | "multi_selecao" | "mapeamento" | "grupo_booleano" | "rd_funis";
  ajuda?: string;
  camposLivres?: boolean;
  /** Backend aceita filtros por valor e origens nativas explícitas em cada funil. */
  filtrosPorFunil?: boolean;
  placeholder?: string;
  min?: number; max?: number; passo?: number; maxLength?: number;
  opcoes?: { valor: string; rotulo: string }[];
  opcoesDe?: "rd_funis" | "rd_etapas" | "rd_campos" | "ca_contas" | "ca_categorias";
  itens?: { chave: string; rotulo: string }[];
};

const CAMPOS_GEMINI: CampoFormulario[] = [
  { chave: "ativo", rotulo: "Função ligada", tipo: "booleano" },
  { chave: "modelo", rotulo: "Modelo", tipo: "texto", placeholder: "em branco = modelo geral", maxLength: 80 },
  { chave: "temperatura", rotulo: "Temperatura", tipo: "numero", min: 0, max: 2, passo: 0.1, placeholder: "padrão" },
  { chave: "maxTokens", rotulo: "Máx. tokens", tipo: "numero", min: 64, max: 8192, passo: 1, placeholder: "padrão" },
  { chave: "limiteDiario", rotulo: "Limite diário", tipo: "numero", min: 1, max: 1000, passo: 1, placeholder: "sem limite" },
  { chave: "prompt", rotulo: "Prompt / base", tipo: "texto_longo", maxLength: 1500 },
];

const ROTULO_CAMPO_CRM: Record<CampoCrm, string> = {
  cpf: "CPF", telefone: "Telefone", email: "E-mail", vendedora: "Vendedora / responsável", origem: "Origem", campanha: "Campanha",
  valor_contrato: "Valor do contrato", quantidade_parcelas: "Quantidade de parcelas", valor_parcela: "Valor da parcela",
  taxa_administrativa: "Taxa administrativa", tipo_venda: "Tipo de venda", procedimento: "Procedimento", banco: "Banco",
};

const CAMPOS_CRM_FORM: CampoFormulario[] = [
  { chave: "ativo", rotulo: "Importação automática ligada", tipo: "booleano", ajuda: "A importação manual e o webhook funcionam mesmo desligada." },
  { chave: "todosFunis", rotulo: "Trazer todas as clientes de todos os funis e etapas", tipo: "booleano", ajuda: "Os funis abaixo continuam com seu preenchimento próprio. Os demais usam o preenchimento padrão; nenhum filtro de etapa ou responsável limita a importação." },
  { chave: "frequenciaMinutos", rotulo: "Frequência", tipo: "selecao", opcoes: FREQUENCIAS_CRM.map((m) => ({ valor: String(m), rotulo: m < 60 ? `${m} min` : m < 1440 ? `${m / 60} h` : "1 vez por dia" })) },
  { chave: "status", rotulo: "Status da negociação", tipo: "selecao", opcoes: [{ valor: "won", rotulo: "Ganhas" }, { valor: "ongoing", rotulo: "Em andamento" }, { valor: "qualquer", rotulo: "Qualquer status" }] },
  { chave: "mapeamento", rotulo: "Preenchimento padrão", tipo: "mapeamento", opcoesDe: "rd_campos", itens: CAMPOS_CRM.map((c) => ({ chave: c, rotulo: ROTULO_CAMPO_CRM[c] })), ajuda: "Fallback para todos os funis. Cada funil selecionado pode sobrescrever este preenchimento campo a campo." },
  { chave: "funis", rotulo: "Funis sincronizados", tipo: "rd_funis", camposLivres: true, filtrosPorFunil: true, opcoesDe: "rd_funis", itens: CAMPOS_CRM.map((c) => ({ chave: c, rotulo: ROTULO_CAMPO_CRM[c] })), ajuda: "Marque vários funis. Dentro de cada um, escolha etapas, filtros (vendedora, fonte, campanha, campos de opção) e a origem de cada dado. Nenhum funil marcado = todos os funis usando o preenchimento padrão." },
  { chave: "deduplicarPor", rotulo: "Duplicatas por telefone", tipo: "grupo_booleano", itens: [{ chave: "telefone", rotulo: "Mesmo telefone (com ou sem +55, DDD e zero)" }], ajuda: "Só o telefone identifica a mesma pessoa. Entre duplicatas, fica a negociação mais completa; ela completa o que faltar na venda pendente." },
];

const CAMPOS_CONTA_AZUL_FORM: CampoFormulario[] = [
  { chave: "ativo", rotulo: "Sincronização automática (a cada 15 min)", tipo: "booleano" },
  { chave: "contaFinanceiraId", rotulo: "Conta financeira", tipo: "selecao", opcoesDe: "ca_contas", ajuda: "Usada na criação dos lançamentos e nas baixas enviadas." },
  { chave: "categoriaId", rotulo: "Categoria de receita", tipo: "selecao", opcoesDe: "ca_categorias", ajuda: "Opcional." },
  { chave: "metodoPagamento", rotulo: "Método de pagamento", tipo: "selecao", opcoes: METODOS_CONTA_AZUL.map((m) => ({ valor: m, rotulo: m.replace(/_/g, " ").toLowerCase() })) },
  { chave: "enviarAlteracoes", rotulo: "Enviar valor e vencimento do Sra Luck", tipo: "booleano" },
  { chave: "enviarBaixas", rotulo: "Enviar baixas e estornos do Sra Luck", tipo: "booleano" },
  { chave: "baixaAutomatica", rotulo: "Aplicar baixas da Conta Azul quando o vínculo for seguro", tipo: "booleano", ajuda: "Desligado, toda baixa vinda da Conta Azul vai para revisão." },
];

type Esquema = { padrao: unknown; validar: (bruto: unknown) => Validacao<unknown>; campos: CampoFormulario[]; permissao?: "financeiro" };

/** Esquemas de configuração por provedor/função. Só estas combinações podem ser gravadas. */
export const ESQUEMAS_CONFIG: Record<string, Record<string, Esquema>> = {
  gemini: {
    mensagem_diaria: { padrao: PADRAO_GEMINI, validar: validarConfigGemini, campos: CAMPOS_GEMINI },
    notificacoes: { padrao: PADRAO_GEMINI, validar: validarConfigGemini, campos: CAMPOS_GEMINI },
  },
  rd_station: {
    importacao: { padrao: PADRAO_CRM, validar: validarConfigCrm, campos: CAMPOS_CRM_FORM },
  },
  conta_azul: {
    sincronizacao: { padrao: PADRAO_CONTA_AZUL, validar: validarConfigContaAzul, campos: CAMPOS_CONTA_AZUL_FORM, permissao: "financeiro" },
    conexao: { padrao: PADRAO_CONEXAO_CONTA_AZUL, validar: validarConfigConexaoContaAzul, campos: CAMPOS_CONEXAO_CONTA_AZUL },
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
    return { ok: false as const, status: 409, codigo: "conflito_versao", versaoAtual, erro: `A configuração foi alterada enquanto você editava (agora na versão ${versaoAtual}). Suas escolhas continuam na tela: confira e salve de novo.` };
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
          campos: esquema?.campos,
          versao: linha?.versao ?? 0,
          atualizadoEm: linha?.atualizado_em ?? null,
          atualizadoPor: linha?.atualizado_por ?? null,
          usoHoje: uso.find((u) => u.provedor === i.id && u.funcao === f.id)?.chamadas ?? 0,
        };
      }),
    })),
  };
}
