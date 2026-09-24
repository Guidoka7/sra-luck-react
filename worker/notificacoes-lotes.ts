/**
 * Central de Notificações — lotes financeiros com aprovação (migration_088).
 *
 * Fluxo:
 *   preparar  → busca as parcelas em aberto, agrupa POR CLIENTE (uma mensagem
 *               por cliente), aplica a régua, a deduplicação e as regras.
 *               Nada é enviado (dry run). Lote PREPARED.
 *   gerar     → o Gemini escreve uma mensagem por cliente a partir de um
 *               contexto estruturado (primeiro nome + parcelas reais já
 *               formatadas). Cada texto passa por um validador que recusa
 *               valor, data, dias ou quantidade que não existam no contexto.
 *               Tudo aprovado → AWAITING_APPROVAL; falhou → AI_GENERATION_FAILED
 *               (sem texto genérico automático).
 *   aprovar   → uma pessoa aprova. Em horário silencioso o lote fica
 *               QUEUED_FOR_ALLOWED_WINDOW; senão é processado na hora pelo
 *               mesmo envio já existente (notificacoes_cliente + Web Push).
 *   reprocessar → só itens FAILED; quem já foi aceito nunca recebe de novo.
 *
 * Este módulo não conhece o envio: ele recebe `enviar`/`reenviarPush` por
 * injeção (admin-notificacoes.ts), para existir um único caminho de envio.
 * Nenhum dado financeiro é alterado aqui.
 */
import { publicError } from "./http-security";
import { boletoPodeReceberCobrancaAutomatica } from "./admin-notificacoes";
import { adicionarDiasCivil, hojeSaoPaulo } from "../src/lib/dataCivil";
import { configuracaoGemini, ErroGemini, gerarComGemini, opcoesDaFuncao, reservarChamadaGemini, type ConfiguracaoGemini } from "./frase-do-dia";
import type { createServiceSupabaseClient, Env } from "./supabase";

type Db = ReturnType<typeof createServiceSupabaseClient>;

export const PROMPT_VERSION = "financeiro-v1";
const FUSO = "America/Sao_Paulo";
const LOTE_CHUNK = 15;

// ---------------------------------------------------------------------------
// Régua
// ---------------------------------------------------------------------------

export type Segmento = "vence_amanha" | "vence_hoje" | "atraso_1" | "atraso_2_5" | "atraso_6_10" | "atraso_11_30";

export const SEGMENTOS: readonly { id: Segmento; nome: string }[] = [
  { id: "vence_amanha", nome: "Vence amanhã" },
  { id: "vence_hoje", nome: "Vence hoje" },
  { id: "atraso_1", nome: "1 dia de atraso" },
  { id: "atraso_2_5", nome: "2 a 5 dias de atraso" },
  { id: "atraso_6_10", nome: "6 a 10 dias de atraso" },
  { id: "atraso_11_30", nome: "11 a 30 dias de atraso" },
];

const SEGMENTO_IDS = new Set<string>(SEGMENTOS.map((s) => s.id));

/** Status de parcela que nunca recebem cobrança (paga ou comprovante em conferência). */
const STATUS_FORA = new Set(["pago", "pendente_confirmacao", "cancelado", "cancelada"]);

/** maiorAtraso: dias desde o vencimento da parcela mais antiga (−1 = vence amanhã). */
export function segmentoDe(maiorAtraso: number): Segmento | null {
  if (maiorAtraso > 30) return null;
  if (maiorAtraso >= 11) return "atraso_11_30";
  if (maiorAtraso >= 6) return "atraso_6_10";
  if (maiorAtraso >= 2) return "atraso_2_5";
  if (maiorAtraso === 1) return "atraso_1";
  if (maiorAtraso === 0) return "vence_hoje";
  if (maiorAtraso === -1) return "vence_amanha";
  return null;
}

export function tituloPara(segmento: Segmento, quantidade: number) {
  if (segmento === "vence_amanha") return quantidade > 1 ? "Lembrete das suas parcelas" : "Sua parcela vence amanhã";
  if (segmento === "vence_hoje") return quantidade > 1 ? "Lembrete das suas parcelas" : "Sua parcela vence hoje";
  return quantidade > 1 ? "Parcelas em aberto" : "Parcela em aberto";
}

// ---------------------------------------------------------------------------
// Datas (sempre no fuso de Brasília)
// ---------------------------------------------------------------------------

/** Mesma data civil de Brasília usada pelo restante do backend (src/lib/dataCivil). */
export function dataBrasilia(agora: Date) {
  return hojeSaoPaulo(agora);
}

export function horaBrasilia(agora: Date) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hour12: false }).format(agora);
}


/** Dias de `de` até `ate` (positivo quando `ate` é depois). */
export function diasEntre(de: string, ate: string) {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
}

/** Janela silenciosa [inicio, fim) em HH:MM; atravessa a meia-noite quando inicio > fim. inicio == fim = sem silêncio. */
export function emHorarioSilencioso(hhmm: string, inicio: string, fim: string) {
  if (!/^\d{2}:\d{2}$/.test(inicio) || !/^\d{2}:\d{2}$/.test(fim) || inicio === fim) return false;
  return inicio < fim ? hhmm >= inicio && hhmm < fim : hhmm >= inicio || hhmm < fim;
}

// ---------------------------------------------------------------------------
// Agrupamento
// ---------------------------------------------------------------------------

export type BoletoFonte = {
  id: string;
  cliente_id: string;
  valor: number | string | null;
  data_vencimento: string;
  status: string | null;
  numero_parcela?: number | null;
  total_parcelas?: number | null;
};

type BoletoComCliente = BoletoFonte & { suspensa?: boolean | null; clientes?: { status_contrato?: string | null; ativo?: boolean | null } | { status_contrato?: string | null; ativo?: boolean | null }[] | null };

function motivoInelegivel(b: BoletoComCliente) {
  const cliente = Array.isArray(b.clientes) ? b.clientes[0] : b.clientes;
  if (!cliente || cliente.ativo === false) return "cliente_inativa";
  if (["cancelado", "suspenso"].includes(String(cliente.status_contrato ?? ""))) return "contrato_cancelado_ou_suspenso";
  if (b.suspensa === true) return "parcela_suspensa";
  return "fora_da_regra_de_cobranca";
}

export type ParcelaAgrupada = { boletoId: string; vencimento: string; valor: number; diasAtraso: number; numero: number | null; total: number | null };

export type Candidato = {
  clienteId: string;
  parcelas: ParcelaAgrupada[];
  quantidade: number;
  valorTotal: number;
  maiorAtraso: number;
  menorAtraso: number;
  segmento: Segmento | null;
};

const centavos = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

/**
 * Agrupa as parcelas em aberto por cliente. Entra só parcela que vence até
 * amanhã (ou já venceu) e que não está paga nem em conferência. A faixa da
 * cliente é a da parcela mais antiga.
 */
export function agruparCandidatos(boletos: BoletoFonte[], hoje: string): Candidato[] {
  const porCliente = new Map<string, ParcelaAgrupada[]>();
  for (const b of boletos) {
    if (!b?.cliente_id || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.data_vencimento))) continue;
    if (STATUS_FORA.has(String(b.status ?? "").toLowerCase())) continue;
    const diasAtraso = diasEntre(String(b.data_vencimento), hoje);
    if (diasAtraso < -1) continue;
    const lista = porCliente.get(b.cliente_id) ?? [];
    lista.push({ boletoId: b.id, vencimento: String(b.data_vencimento), valor: centavos(b.valor), diasAtraso, numero: b.numero_parcela ?? null, total: b.total_parcelas ?? null });
    porCliente.set(b.cliente_id, lista);
  }
  return [...porCliente.entries()].map(([clienteId, parcelas]) => {
    parcelas.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    const atrasos = parcelas.map((p) => p.diasAtraso);
    const maiorAtraso = Math.max(...atrasos);
    return {
      clienteId,
      parcelas,
      quantidade: parcelas.length,
      valorTotal: centavos(parcelas.reduce((s, p) => s + p.valor, 0)),
      maiorAtraso,
      menorAtraso: Math.min(...atrasos),
      segmento: segmentoDe(maiorAtraso),
    };
  }).sort((a, b) => b.maiorAtraso - a.maiorAtraso || a.clienteId.localeCompare(b.clienteId));
}

// ---------------------------------------------------------------------------
// Configuração (tabela notificacoes_config, já existente)
// ---------------------------------------------------------------------------

export type ConfigCentral = {
  ativa: boolean;
  janelaDedupHoras: number;
  silencioInicio: string;
  silencioFim: string;
  aprovacaoObrigatoria: boolean;
  segmentos: Segmento[];
};

export const CONFIG_PADRAO: ConfigCentral = {
  ativa: false,
  janelaDedupHoras: 24,
  silencioInicio: "21:00",
  silencioFim: "08:00",
  aprovacaoObrigatoria: true,
  segmentos: SEGMENTOS.map((s) => s.id),
};

export const CHAVES_CONFIG = {
  ativa: "central_lotes_ativa",
  janelaDedupHoras: "central_dedup_horas",
  silencioInicio: "central_silencio_inicio",
  silencioFim: "central_silencio_fim",
  aprovacaoObrigatoria: "central_aprovacao_obrigatoria",
  segmentos: "central_segmentos",
} as const;

export function lerConfigCentral(linhas: { chave: string; valor: string | null }[]): ConfigCentral {
  const raw = Object.fromEntries(linhas.map((l) => [l.chave, l.valor ?? ""]));
  const hora = (v: string | undefined, padrao: string) => (v && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : padrao);
  const segmentos = raw[CHAVES_CONFIG.segmentos] !== undefined
    ? String(raw[CHAVES_CONFIG.segmentos]).split(",").map((s) => s.trim()).filter((s): s is Segmento => SEGMENTO_IDS.has(s))
    : CONFIG_PADRAO.segmentos;
  const horas = Number(raw[CHAVES_CONFIG.janelaDedupHoras]);
  return {
    ativa: raw[CHAVES_CONFIG.ativa] === "true",
    janelaDedupHoras: Number.isFinite(horas) && horas >= 1 && horas <= 168 ? Math.round(horas) : CONFIG_PADRAO.janelaDedupHoras,
    silencioInicio: hora(raw[CHAVES_CONFIG.silencioInicio], CONFIG_PADRAO.silencioInicio),
    silencioFim: hora(raw[CHAVES_CONFIG.silencioFim], CONFIG_PADRAO.silencioFim),
    aprovacaoObrigatoria: raw[CHAVES_CONFIG.aprovacaoObrigatoria] !== "false",
    segmentos,
  };
}

/** Valida uma alteração de configuração vinda do painel. Retorna as linhas a gravar. */
export function validarAlteracaoConfig(body: Record<string, unknown>): { ok: true; linhas: { chave: string; valor: string; tipo: string }[] } | { ok: false; erro: string } {
  const permitidas = Object.keys(CHAVES_CONFIG);
  const chaves = Object.keys(body);
  if (!chaves.length || chaves.some((c) => !permitidas.includes(c))) return { ok: false, erro: "Configuração inválida." };
  const linhas: { chave: string; valor: string; tipo: string }[] = [];
  for (const c of chaves) {
    const v = body[c];
    if (c === "ativa" || c === "aprovacaoObrigatoria") {
      if (typeof v !== "boolean") return { ok: false, erro: `"${c}" precisa ser verdadeiro ou falso.` };
      linhas.push({ chave: CHAVES_CONFIG[c], valor: String(v), tipo: "boolean" });
    } else if (c === "janelaDedupHoras") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 168) return { ok: false, erro: "A janela de deduplicação deve ter entre 1 e 168 horas." };
      linhas.push({ chave: CHAVES_CONFIG.janelaDedupHoras, valor: String(v), tipo: "number" });
    } else if (c === "silencioInicio" || c === "silencioFim") {
      if (typeof v !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return { ok: false, erro: "Horário no formato HH:MM." };
      linhas.push({ chave: CHAVES_CONFIG[c], valor: v, tipo: "string" });
    } else if (c === "segmentos") {
      if (!Array.isArray(v) || v.some((s) => typeof s !== "string" || !SEGMENTO_IDS.has(s))) return { ok: false, erro: "Faixa da régua desconhecida." };
      linhas.push({ chave: CHAVES_CONFIG.segmentos, valor: [...new Set(v as string[])].join(","), tipo: "string" });
    }
  }
  return { ok: true, linhas };
}

export async function carregarConfigCentral(db: Db) {
  const { data } = await db.from("notificacoes_config").select("chave,valor");
  return lerConfigCentral((data ?? []) as { chave: string; valor: string | null }[]);
}

// ---------------------------------------------------------------------------
// Contexto para o Gemini e validador da mensagem
// ---------------------------------------------------------------------------

export function primeiroNome(nomeCompleto: unknown) {
  const nome = String(nomeCompleto ?? "").trim().split(/\s+/)[0] ?? "";
  return nome ? nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase() : "";
}

export const formatarMoeda = (valor: number) => `R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const formatarData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export type ContextoMensagem = {
  primeiroNome: string;
  faixa: string;
  quantidadeParcelas: number;
  parcelas: { vencimento: string; valor: string; diasAtraso: number }[];
  valorTotal: string;
  maiorAtraso: number;
};

/** Só o necessário: primeiro nome e parcelas já formatadas. Sem CPF, sem id, sem sobrenome. */
export function contextoMensagem(item: { segmento: string; parcelas: ParcelaAgrupada[]; valor_total: number | string; maior_atraso: number }, nome: string): ContextoMensagem {
  const faixa = SEGMENTOS.find((s) => s.id === item.segmento)?.nome ?? item.segmento;
  return {
    primeiroNome: nome,
    faixa,
    quantidadeParcelas: item.parcelas.length,
    parcelas: item.parcelas.map((p) => ({ vencimento: formatarData(p.vencimento), valor: formatarMoeda(p.valor), diasAtraso: p.diasAtraso })),
    valorTotal: formatarMoeda(centavos(item.valor_total)),
    maiorAtraso: item.maior_atraso,
  };
}

const PROIBIDAS_COBRANCA = [
  /\bjuros\b/, /\bmulta/, /\bprotest/, /\bserasa\b/, /\bspc\b/, /\bnegativ/, /\bjudicia/, /\badvogad/,
  /\bbloque/, /\bsuspens/, /\bcancelad/, /\bprocesso\b/, /\bultima chance\b/, /\bultimo aviso\b/, /\bdesconto/,
  /\bdivida/, /\bdevedor/, /\bcalote/, /\bimediatamente\b/,
];

const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const soDigitos = (t: string) => t.replace(/\D/g, "");

export type ValidacaoMensagem = { ok: true; texto: string } | { ok: false; motivo: string };

/**
 * O Gemini só reescreve o que já está no contexto. Qualquer valor, data,
 * número de dias ou de parcelas que não exista nele reprova a mensagem.
 */
export function validarMensagemFinanceira(bruto: unknown, ctx: ContextoMensagem): ValidacaoMensagem {
  const texto = String(bruto ?? "").trim().replace(/^["“”']+|["“”']+$/g, "").replace(/\s+/g, " ").trim();
  if (texto.length < 20 || texto.length > 300) return { ok: false, motivo: "tamanho" };
  if (/[\n#<>{}]|https?:|www\.|@/i.test(texto)) return { ok: false, motivo: "caractere" };
  if ((texto.match(/\p{Extended_Pictographic}/gu) ?? []).length > 1) return { ok: false, motivo: "emoji" };
  const norm = normalizar(texto);
  if (PROIBIDAS_COBRANCA.some((re) => re.test(norm))) return { ok: false, motivo: "tom_de_cobranca" };
  if (/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(texto)) return { ok: false, motivo: "documento" };

  const valores = new Set([...ctx.parcelas.map((p) => soDigitos(p.valor)), soDigitos(ctx.valorTotal)]);
  for (const m of texto.match(/R\$\s?[\d.]+(,\d{2})?/g) ?? []) {
    const d = soDigitos(m.includes(",") ? m : `${m},00`);
    if (!valores.has(d)) return { ok: false, motivo: "valor_inventado" };
  }
  const datas = ctx.parcelas.map((p) => p.vencimento);
  for (const m of texto.match(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g) ?? []) {
    const [d, mm, a] = m.split("/");
    const alvo = `${d.padStart(2, "0")}/${mm.padStart(2, "0")}`;
    if (!datas.some((v) => v.startsWith(alvo) && (!a || v.endsWith(a.length === 2 ? `20${a}` : a)))) return { ok: false, motivo: "data_inventada" };
  }
  const dias = new Set(ctx.parcelas.map((p) => Math.abs(p.diasAtraso)));
  for (const m of norm.matchAll(/(\d+)\s*dias?\b/g)) if (!dias.has(Number(m[1]))) return { ok: false, motivo: "dias_inventados" };
  for (const m of norm.matchAll(/(\d+)\s*parcelas?\b/g)) if (Number(m[1]) !== ctx.quantidadeParcelas) return { ok: false, motivo: "quantidade_inventada" };
  if (ctx.quantidadeParcelas > 1 && /\b(uma|1) parcela\b/.test(norm) && !/\bparcelas\b/.test(norm)) return { ok: false, motivo: "quantidade_inventada" };
  return { ok: true, texto };
}

const SISTEMA_FINANCEIRO = [
  "Você escreve lembretes financeiros do app da Sra. Luck Cirurgia Programada (Brasília).",
  "A Sra. Luck ajuda mulheres a realizar a cirurgia plástica com planejamento e parcelas; o tom é humano, profissional, acolhedor e objetivo.",
  "Para CADA item recebido escreva UMA mensagem curta (até 240 caracteres) em português do Brasil, falando com a cliente pelo primeiro nome, no feminino.",
  "Use SOMENTE os dados do item: valores, datas, dias de atraso e quantidade de parcelas exatamente como vieram. Nunca invente, arredonde nem calcule números novos.",
  "Quando houver mais de uma parcela, resuma de forma natural numa única mensagem (pode citar o total).",
  "Proibido: ameaça, cobrança agressiva, juros, multa, protesto, SPC/Serasa, negativação, bloqueio, cancelamento, desconto, culpa, urgência exagerada, links, hashtags ou mais de 1 emoji.",
  "Convide com gentileza a conferir as parcelas no app ou enviar o comprovante se já pagou.",
  "Varie o texto entre as clientes; não pareça robótico.",
].join("\n");

const SCHEMA_LOTE = {
  type: "OBJECT",
  properties: { mensagens: { type: "ARRAY", items: { type: "OBJECT", properties: { i: { type: "INTEGER" }, texto: { type: "STRING" } }, required: ["i", "texto"] } } },
  required: ["mensagens"],
};

export function montarPromptLote(itens: { i: number; ctx: ContextoMensagem }[], instrucao?: string | null) {
  const usuario = [
    instrucao ? `Pedido da equipe (siga sem quebrar nenhuma regra): ${instrucao}` : "",
    "Itens (responda com o mesmo i de cada item):",
    JSON.stringify(itens.map(({ i, ctx }) => ({ i, ...ctx }))),
  ].filter(Boolean).join("\n");
  return { sistema: `${SISTEMA_FINANCEIRO}\nResponda somente com o JSON {"mensagens": [{"i": 0, "texto": "..."}]}.`, usuario };
}

export function limparInstrucao(bruto: unknown) {
  return String(bruto ?? "").replace(/[\u0000-\u001f\u007f<>{}]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

// ---------------------------------------------------------------------------
// Persistência e orquestração
// ---------------------------------------------------------------------------

export type EnviarNotificacao = (env: Env, db: Db, input: {
  clienteId: string; tipo: string; titulo: string; mensagem: string; emoji?: string; destino?: string;
  referenciaId?: string | null; url?: string; tag?: string; action?: string | null;
}) => Promise<{ notificacao: { id: string }; pushStatus: string }>;

export type ReenviarPush = (env: Env, db: Db, clienteId: string, payload: {
  title: string; body: string; url?: string; tag?: string; notificationId?: string | null; installmentId?: string | null; action?: string | null; destino?: string | null;
}) => Promise<{ configurado: boolean; enviadas: number; falhas: number; assinaturas: number }>;

export type Contexto = {
  env: Env;
  db: Db;
  ator: string;
  agora?: Date;
  fetcher?: typeof fetch;
  enviar?: EnviarNotificacao;
  reenviarPush?: ReenviarPush;
};

type Falha = { ok: false; status: number; codigo: string; erro: string };
type Resultado<T> = ({ ok: true } & T) | Falha;

type ItemLinha = {
  id: string; lote_id: string; cliente_id: string; segmento: string; parcelas: ParcelaAgrupada[];
  quantidade_parcelas: number; valor_total: number | string; maior_atraso: number;
  titulo: string | null; mensagem: string | null; status: string; motivo: string | null; notificacao_id: string | null;
};

type LoteLinha = { id: string; status: string; data_referencia: string; aprovado_por: string | null; config: Record<string, unknown> };

const LOTE_ABERTO = ["PREPARED", "AI_GENERATION_FAILED", "AWAITING_APPROVAL", "QUEUED_FOR_ALLOWED_WINDOW", "PROCESSING"];
const EDITAVEL = ["PREPARED", "AI_GENERATION_FAILED", "AWAITING_APPROVAL"];
const TIPOS_FINANCEIROS = ["parcela_atrasada", "parcela_vencer"];

const falha = (status: number, codigo: string, erro: string): Falha => ({ ok: false, status, codigo, erro });

async function auditar(db: Db, ator: string, acao: string, detalhes: Record<string, unknown>) {
  const { error } = await db.from("logs_alteracoes").insert({ usuario: ator, acao, entidade: "notificacao_lotes", detalhes });
  if (error) console.warn("Auditoria da central de notificações não persistida:", error.message);
}

async function buscarLote(db: Db, id: string) {
  const { data } = await db.from("notificacao_lotes").select("id,status,data_referencia,aprovado_por,config").eq("id", id).maybeSingle();
  return (data ?? null) as LoteLinha | null;
}

async function itensDoLote(db: Db, loteId: string) {
  const { data, error } = await db.from("notificacao_lote_itens")
    .select("id,lote_id,cliente_id,segmento,parcelas,quantidade_parcelas,valor_total,maior_atraso,titulo,mensagem,status,motivo,notificacao_id")
    .eq("lote_id", loteId);
  if (error) throw new Error(`itens_indisponiveis:${error.code ?? "?"}`);
  return (data ?? []) as ItemLinha[];
}

async function clientesRecentes(db: Db, clienteIds: string[], janelaHoras: number, agora: Date) {
  if (!clienteIds.length) return new Set<string>();
  const desde = new Date(agora.getTime() - janelaHoras * 3_600_000).toISOString();
  const { data, error } = await db.from("notificacao_logs").select("cliente_id")
    .in("cliente_id", clienteIds).in("tipo", TIPOS_FINANCEIROS).gte("created_at", desde);
  if (error) throw new Error(`deduplicacao_indisponivel:${error.code ?? "?"}`);
  return new Set(((data ?? []) as { cliente_id: string }[]).map((l) => l.cliente_id));
}

/** Dry run: monta o lote (quem recebe, por quê e quem fica de fora) sem enviar nada. */
export async function prepararLote(ctx: Contexto, origem: "manual" | "rotina" = "manual"): Promise<Resultado<{ loteId: string; existente: boolean }>> {
  const agora = ctx.agora ?? new Date();
  const hoje = dataBrasilia(agora);
  const { data: aberto } = await ctx.db.from("notificacao_lotes").select("id").eq("tipo", "financeiro").in("status", LOTE_ABERTO).limit(1);
  if ((aberto ?? []).length) return { ok: true, loteId: (aberto as { id: string }[])[0].id, existente: true };

  const config = await carregarConfigCentral(ctx.db);
  // Mesma regra de elegibilidade da rotina automática (boletoPodeReceberCobrancaAutomatica):
  // só parcela "nao_pago", não suspensa, de cliente ativa com contrato válido.
  const { data: boletos, error: erroBoletos } = await ctx.db.from("boletos")
    .select("id,cliente_id,valor,data_vencimento,status,suspensa,numero_parcela,total_parcelas,clientes(status_contrato,ativo)")
    .lte("data_vencimento", adicionarDiasCivil(hoje, 1)).eq("status", "nao_pago");
  if (erroBoletos) return falha(502, "parcelas_indisponiveis", "Não foi possível ler as parcelas agora.");
  const todos = (boletos ?? []) as BoletoComCliente[];
  const candidatos = agruparCandidatos(todos.filter(boletoPodeReceberCobrancaAutomatica), hoje);
  const ids = candidatos.map((c) => c.clienteId);
  // Quem tem parcela em aberto mas nenhuma elegível aparece como "fora da regra", com o motivo.
  const comElegivel = new Set(ids);
  const motivoFora = new Map<string, string>();
  for (const b of todos) if (!comElegivel.has(b.cliente_id) && !boletoPodeReceberCobrancaAutomatica(b)) motivoFora.set(b.cliente_id, motivoInelegivel(b));
  const excluidos = agruparCandidatos(todos.filter((b) => motivoFora.has(b.cliente_id)), hoje);
  const recentes = await clientesRecentes(ctx.db, ids, config.janelaDedupHoras, agora);

  const { data: lote, error: erroLote } = await ctx.db.from("notificacao_lotes").insert({
    tipo: "financeiro", status: "PREPARED", data_referencia: hoje, origem, criado_por: ctx.ator, prompt_version: PROMPT_VERSION,
    config: { janelaDedupHoras: config.janelaDedupHoras, silencioInicio: config.silencioInicio, silencioFim: config.silencioFim, segmentos: config.segmentos, aprovacaoObrigatoria: config.aprovacaoObrigatoria },
  }).select("id").single();
  if (erroLote || !lote) return falha(409, "migration_088", "A estrutura de lotes ainda não foi aplicada neste ambiente (migration_088).");

  const itens = [...candidatos, ...excluidos].map((c) => {
    let status = "PREPARED";
    let motivo: string | null = null;
    if (motivoFora.has(c.clienteId)) { status = "SKIPPED_RULE"; motivo = motivoFora.get(c.clienteId)!; }
    else if (!c.segmento) { status = "SKIPPED_RULE"; motivo = "atraso_acima_de_30_dias"; }
    else if (!config.segmentos.includes(c.segmento)) { status = "SKIPPED_RULE"; motivo = "faixa_desligada"; }
    else if (recentes.has(c.clienteId)) { status = "SKIPPED_DEDUPLICATION"; motivo = `lembrete_nas_ultimas_${config.janelaDedupHoras}h`; }
    return {
      lote_id: (lote as { id: string }).id, cliente_id: c.clienteId, segmento: c.segmento ?? "fora_da_regua", parcelas: c.parcelas,
      quantidade_parcelas: c.quantidade, valor_total: c.valorTotal, maior_atraso: c.maiorAtraso,
      titulo: c.segmento ? tituloPara(c.segmento, c.quantidade) : null, status, motivo,
    };
  });
  if (itens.length) {
    const { error } = await ctx.db.from("notificacao_lote_itens").insert(itens);
    if (error) {
      await ctx.db.from("notificacao_lotes").update({ status: "CANCELLED", erro: "falha_ao_gravar_itens", updated_at: new Date().toISOString() }).eq("id", (lote as { id: string }).id);
      return falha(500, "itens_nao_gravados", "Não foi possível gravar os itens do lote.");
    }
  }
  await auditar(ctx.db, ctx.ator, "preparou_lote_notificacoes", { lote_id: (lote as { id: string }).id, origem, candidatas: itens.length, elegiveis: itens.filter((i) => i.status === "PREPARED").length });
  return { ok: true, loteId: (lote as { id: string }).id, existente: false };
}

async function recalcularStatusLote(db: Db, loteId: string, extra: Record<string, unknown> = {}) {
  const itens = await itensDoLote(db, loteId);
  const pendentes = itens.filter((i) => i.status === "PREPARED").length;
  const prontos = itens.filter((i) => i.status === "AWAITING_APPROVAL").length;
  const status = pendentes ? "AI_GENERATION_FAILED" : prontos ? "AWAITING_APPROVAL" : "PREPARED";
  const erro = pendentes ? `${pendentes} cliente(s) ainda sem mensagem aprovada.` : null;
  await db.from("notificacao_lotes").update({ status, erro, updated_at: new Date().toISOString(), ...extra }).eq("id", loteId).in("status", EDITAVEL);
  return { status, pendentes, prontos };
}

/** Gera (ou regenera) as mensagens com o Gemini. Sem chave ou com falha: nada de texto genérico. */
/** Orientação de tom configurada para a função Notificações; as regras de segurança do prompt não mudam. */
function comTomDaEquipe(sistema: string, gemini: ConfiguracaoGemini) {
  return gemini.instrucoesExtras ? `${sistema}\nOrientação de tom da equipe (não muda nenhuma regra acima): ${gemini.instrucoesExtras}` : sistema;
}
function semGemini(gemini: ConfiguracaoGemini) {
  return gemini.indisponivel === "funcao_desativada"
    ? falha(409, "funcao_desativada", "A função Notificações do Gemini está desligada nas Integrações.")
    : falha(409, "sem_chave", "O Gemini não tem chave configurada (ou a integração está desligada).");
}
function limiteAtingido(gemini: ConfiguracaoGemini) {
  return falha(429, "limite_diario", `Limite diário da função Notificações do Gemini atingido (${gemini.limiteDiario} chamadas). Ajuste nas Integrações ou tente amanhã.`);
}

export async function gerarMensagens(ctx: Contexto, loteId: string, opcoes: { instrucao?: unknown; segmento?: unknown } = {}): Promise<Resultado<{ status: string; geradas: number; reprovadas: number; falhas: number; modelo: string | null }>> {
  const lote = await buscarLote(ctx.db, loteId);
  if (!lote) return falha(404, "lote_nao_encontrado", "Lote não encontrado.");
  if (!EDITAVEL.includes(lote.status)) return falha(409, "lote_nao_editavel", "Este lote não aceita novas mensagens.");
  const segmento = typeof opcoes.segmento === "string" && SEGMENTO_IDS.has(opcoes.segmento) ? opcoes.segmento : null;
  const instrucao = limparInstrucao(opcoes.instrucao) || null;
  const alvo = (await itensDoLote(ctx.db, loteId)).filter((i) => ["PREPARED", "AWAITING_APPROVAL"].includes(i.status) && (!segmento || i.segmento === segmento));
  if (!alvo.length) return falha(409, "sem_itens", "Não há clientes elegíveis para gerar mensagem neste lote.");

  const gemini = await configuracaoGemini(ctx.env, "notificacoes", { db: ctx.db });
  if (!gemini.chave) {
    const desligada = gemini.indisponivel === "funcao_desativada";
    await ctx.db.from("notificacao_lotes").update({ status: "AI_GENERATION_FAILED", erro: desligada ? "Função Notificações do Gemini desligada nas Integrações." : "Gemini sem chave configurada (ou integração desligada).", updated_at: new Date().toISOString() }).eq("id", loteId).in("status", EDITAVEL);
    return desligada
      ? falha(409, "funcao_desativada", "A função Notificações do Gemini está desligada nas Integrações. Nenhuma mensagem foi gerada.")
      : falha(409, "sem_chave", "O Gemini não tem chave configurada (ou a integração está desligada). Nenhuma mensagem foi gerada.");
  }

  const { data: clientes } = await ctx.db.from("clientes").select("id,nome_completo").in("id", alvo.map((i) => i.cliente_id));
  const nomes = new Map(((clientes ?? []) as { id: string; nome_completo: string | null }[]).map((c) => [c.id, primeiroNome(c.nome_completo)]));

  let geradas = 0, reprovadas = 0, falhas = 0;
  let modelo: string | null = null;
  const agora = new Date().toISOString();
  for (let inicio = 0; inicio < alvo.length; inicio += LOTE_CHUNK) {
    const bloco = alvo.slice(inicio, inicio + LOTE_CHUNK).map((item, i) => ({ i, item, ctx: contextoMensagem(item, nomes.get(item.cliente_id) || "cliente") }));
    const { sistema, usuario } = montarPromptLote(bloco.map(({ i, ctx: c }) => ({ i, ctx: c })), instrucao);
    let textos = new Map<number, string>();
    try {
      if (!(await reservarChamadaGemini(ctx.env, gemini, { db: ctx.db }))) throw new ErroGemini("limite_diario", []);
      const r = await gerarComGemini(gemini.chave, gemini.modelo, comTomDaEquipe(sistema, gemini), usuario, ctx.fetcher, opcoesDaFuncao(gemini, { schema: SCHEMA_LOTE, temperatura: 0.9, maxTokens: 4096 }));
      modelo = r.modelo;
      const corpo = JSON.parse(r.bruto) as { mensagens?: { i?: number; texto?: string }[] };
      textos = new Map((corpo.mensagens ?? []).filter((m) => Number.isInteger(m.i)).map((m) => [m.i as number, String(m.texto ?? "")]));
    } catch (erro) {
      const motivo = erro instanceof ErroGemini ? erro.motivo : "resposta_invalida";
      for (const { item } of bloco) {
        falhas++;
        await ctx.db.from("notificacao_lote_itens").update({ status: "PREPARED", mensagem: null, motivo: `ia_falhou:${motivo}`, updated_at: agora }).eq("id", item.id);
      }
      continue;
    }
    for (const { i, item, ctx: c } of bloco) {
      const validacao = validarMensagemFinanceira(textos.get(i), c);
      if (validacao.ok) {
        geradas++;
        await ctx.db.from("notificacao_lote_itens").update({ status: "AWAITING_APPROVAL", mensagem: validacao.texto, motivo: null, gerada_por: `gemini:${modelo}`, gerada_em: agora, editada_por: null, updated_at: agora }).eq("id", item.id);
      } else {
        reprovadas++;
        await ctx.db.from("notificacao_lote_itens").update({ status: "PREPARED", mensagem: null, motivo: `ia_reprovada:${validacao.motivo}`, updated_at: agora }).eq("id", item.id);
      }
    }
  }
  const { status } = await recalcularStatusLote(ctx.db, loteId, { modelo, prompt_version: PROMPT_VERSION, instrucao });
  await auditar(ctx.db, ctx.ator, "gerou_mensagens_lote", { lote_id: loteId, modelo, prompt_version: PROMPT_VERSION, geradas, reprovadas, falhas, segmento, com_instrucao: Boolean(instrucao) });
  return { ok: true, status, geradas, reprovadas, falhas, modelo };
}

/** Edição humana: o texto passa pelo mesmo validador (a pessoa também não pode inventar número). */
export async function editarItem(ctx: Contexto, loteId: string, itemId: string, mensagem: unknown): Promise<Resultado<{ status: string }>> {
  const lote = await buscarLote(ctx.db, loteId);
  if (!lote) return falha(404, "lote_nao_encontrado", "Lote não encontrado.");
  if (!EDITAVEL.includes(lote.status)) return falha(409, "lote_nao_editavel", "Este lote não aceita mais edição.");
  const item = (await itensDoLote(ctx.db, loteId)).find((i) => i.id === itemId);
  if (!item || !["PREPARED", "AWAITING_APPROVAL"].includes(item.status)) return falha(404, "item_nao_editavel", "Cliente não encontrada neste lote ou fora da régua.");
  const { data: cliente } = await ctx.db.from("clientes").select("nome_completo").eq("id", item.cliente_id).maybeSingle();
  const validacao = validarMensagemFinanceira(mensagem, contextoMensagem(item, primeiroNome((cliente as { nome_completo?: string } | null)?.nome_completo)));
  if (!validacao.ok) return falha(400, validacao.motivo, "A mensagem não passou nas regras (valores, datas e dias precisam ser os do sistema; sem tom de cobrança).");
  await ctx.db.from("notificacao_lote_itens").update({ status: "AWAITING_APPROVAL", mensagem: validacao.texto, motivo: null, editada_por: ctx.ator, updated_at: new Date().toISOString() }).eq("id", itemId);
  const { status } = await recalcularStatusLote(ctx.db, loteId);
  await auditar(ctx.db, ctx.ator, "editou_mensagem_lote", { lote_id: loteId, item_id: itemId });
  return { ok: true, status };
}

type Contagem = { aceitas: number; somenteApp: number; falhas: number; deduplicadas: number; ignoradas: number };

async function enviarItem(ctx: Contexto, item: ItemLinha, config: ConfigCentral, agora: Date, reprocesso: boolean): Promise<keyof Contagem> {
  const marcar = (patch: Record<string, unknown>) => ctx.db.from("notificacao_lote_itens").update({ ...patch, processado_em: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", item.id);

  // Parcelas mudaram desde a preparação (paga ou comprovante enviado): a mensagem já não é verdadeira.
  const { data: atuais } = await ctx.db.from("boletos").select("id,cliente_id,status,suspensa,clientes(status_contrato,ativo)").in("id", item.parcelas.map((p) => p.boletoId));
  const abertas = ((atuais ?? []) as BoletoComCliente[]).filter(boletoPodeReceberCobrancaAutomatica);
  if (abertas.length !== item.parcelas.length) { await marcar({ status: "SKIPPED_RULE", motivo: "parcelas_mudaram_antes_do_envio" }); return "ignoradas"; }

  if (!reprocesso && (await clientesRecentes(ctx.db, [item.cliente_id], config.janelaDedupHoras, agora)).has(item.cliente_id)) {
    await marcar({ status: "SKIPPED_DEDUPLICATION", motivo: `lembrete_nas_ultimas_${config.janelaDedupHoras}h` });
    return "deduplicadas";
  }

  // Trava o item antes de enviar: dois processos nunca enviam o mesmo item.
  const { data: travado } = await ctx.db.from("notificacao_lote_itens").update({ status: "PROCESSING", updated_at: new Date().toISOString() })
    .eq("id", item.id).in("status", reprocesso ? ["FAILED"] : ["AWAITING_APPROVAL", "QUEUED"]).select("id");
  if (!(travado ?? []).length) return "ignoradas";

  const primeira = item.parcelas[0];
  const atrasada = item.maior_atraso >= 1;
  const titulo = item.titulo || tituloPara(item.segmento as Segmento, item.quantidade_parcelas);
  try {
    let pushStatus: string;
    let notificacaoId = item.notificacao_id;
    if (reprocesso && notificacaoId && ctx.reenviarPush) {
      // A notificação no app já existe: só tenta o push de novo (sem duplicar no app).
      const r = await ctx.reenviarPush(ctx.env, ctx.db, item.cliente_id, { title: titulo, body: item.mensagem!, url: `/agenda?abrirComprovante=${encodeURIComponent(primeira.boletoId)}`, tag: `lote-${item.lote_id}-${item.cliente_id}`, notificationId: notificacaoId, installmentId: primeira.boletoId, action: "upload_receipt", destino: "pagamentos" });
      pushStatus = !r.configurado ? "nao_configurado" : r.enviadas > 0 ? (r.falhas > 0 ? "parcial" : "enviada") : r.falhas > 0 ? "falhou" : "sem_dispositivo";
    } else {
      const enviar = ctx.enviar;
      if (!enviar) throw new Error("envio_indisponivel");
      const r = await enviar(ctx.env, ctx.db, {
        clienteId: item.cliente_id, tipo: atrasada ? "parcela_atrasada" : "parcela_vencer", titulo, mensagem: item.mensagem!, emoji: "💳",
        destino: "pagamentos", referenciaId: primeira.boletoId, url: `/agenda?abrirComprovante=${encodeURIComponent(primeira.boletoId)}`,
        tag: `lote-${item.lote_id}-${item.cliente_id}`, action: "upload_receipt",
      });
      pushStatus = r.pushStatus;
      notificacaoId = r.notificacao.id;
    }
    const aceito = pushStatus === "enviada" || pushStatus === "parcial";
    const semPush = pushStatus === "sem_dispositivo";
    await marcar({ status: aceito ? "PROVIDER_ACCEPTED" : semPush ? "IN_APP_ONLY" : "FAILED", motivo: aceito ? null : semPush ? "cliente_sem_dispositivo_push" : `push_${pushStatus}`, notificacao_id: notificacaoId, push_status: pushStatus });
    return aceito ? "aceitas" : semPush ? "somenteApp" : "falhas";
  } catch (erro) {
    await marcar({ status: "FAILED", motivo: publicError(erro, "falha_no_envio").slice(0, 200) });
    return "falhas";
  }
}

async function processar(ctx: Contexto, loteId: string, reprocesso: boolean): Promise<Contagem> {
  const agora = ctx.agora ?? new Date();
  const config = await carregarConfigCentral(ctx.db);
  await ctx.db.from("notificacao_lotes").update({ processamento_iniciado_em: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", loteId);
  const alvo = (await itensDoLote(ctx.db, loteId)).filter((i) => (reprocesso ? i.status === "FAILED" : ["AWAITING_APPROVAL", "QUEUED"].includes(i.status)) && i.mensagem);
  const contagem: Contagem = { aceitas: 0, somenteApp: 0, falhas: 0, deduplicadas: 0, ignoradas: 0 };
  for (const item of alvo) contagem[await enviarItem(ctx, item, config, agora, reprocesso)]++;
  await ctx.db.from("notificacao_lotes").update({ status: "COMPLETED", concluido_em: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", loteId).eq("status", "PROCESSING");
  await auditar(ctx.db, ctx.ator, reprocesso ? "reprocessou_falhas_lote" : "processou_lote_notificacoes", { lote_id: loteId, ...contagem });
  return contagem;
}

/** Aprovação humana (ou automática, se a configuração permitir). Transição condicional: aprovar duas vezes não envia duas vezes. */
export async function aprovarLote(ctx: Contexto, loteId: string): Promise<Resultado<{ status: string; contagem?: Contagem }>> {
  const agora = ctx.agora ?? new Date();
  const config = await carregarConfigCentral(ctx.db);
  const silencio = emHorarioSilencioso(horaBrasilia(agora), config.silencioInicio, config.silencioFim);
  const novoStatus = silencio ? "QUEUED_FOR_ALLOWED_WINDOW" : "PROCESSING";
  const { data: mudou } = await ctx.db.from("notificacao_lotes").update({ status: novoStatus, aprovado_por: ctx.ator, aprovado_em: agora.toISOString(), updated_at: agora.toISOString() })
    .eq("id", loteId).eq("status", "AWAITING_APPROVAL").select("id");
  if (!(mudou ?? []).length) {
    const lote = await buscarLote(ctx.db, loteId);
    return lote ? falha(409, "lote_nao_aguarda_aprovacao", `Este lote está em ${lote.status} e não pode ser aprovado agora.`) : falha(404, "lote_nao_encontrado", "Lote não encontrado.");
  }
  await auditar(ctx.db, ctx.ator, "aprovou_lote_notificacoes", { lote_id: loteId, fila: silencio });
  if (silencio) {
    await ctx.db.from("notificacao_lote_itens").update({ status: "QUEUED", updated_at: agora.toISOString() }).eq("lote_id", loteId).eq("status", "AWAITING_APPROVAL");
    return { ok: true, status: novoStatus };
  }
  return { ok: true, status: "COMPLETED", contagem: await processar(ctx, loteId, false) };
}

/** Reenvia só o que falhou. PROVIDER_ACCEPTED nunca recebe de novo. */
export async function reprocessarFalhas(ctx: Contexto, loteId: string): Promise<Resultado<{ contagem: Contagem }>> {
  const agora = ctx.agora ?? new Date();
  const config = await carregarConfigCentral(ctx.db);
  if (emHorarioSilencioso(horaBrasilia(agora), config.silencioInicio, config.silencioFim)) return falha(409, "horario_silencioso", `Agora é horário silencioso (${config.silencioInicio}–${config.silencioFim}). Tente depois.`);
  const { data: mudou } = await ctx.db.from("notificacao_lotes").update({ status: "PROCESSING", updated_at: agora.toISOString() }).eq("id", loteId).eq("status", "COMPLETED").select("id");
  if (!(mudou ?? []).length) return falha(409, "lote_nao_concluido", "Só dá para reprocessar falhas de um lote concluído.");
  return { ok: true, contagem: await processar(ctx, loteId, true) };
}

export async function cancelarLote(ctx: Contexto, loteId: string): Promise<Resultado<{ status: string }>> {
  const agora = new Date().toISOString();
  const { data: mudou } = await ctx.db.from("notificacao_lotes").update({ status: "CANCELLED", cancelado_por: ctx.ator, cancelado_em: agora, updated_at: agora })
    .eq("id", loteId).in("status", ["PREPARED", "AI_GENERATION_FAILED", "AWAITING_APPROVAL", "QUEUED_FOR_ALLOWED_WINDOW"]).select("id");
  if (!(mudou ?? []).length) return falha(409, "lote_nao_cancelavel", "Este lote já está sendo processado, foi concluído ou já foi cancelado.");
  await ctx.db.from("notificacao_lote_itens").update({ status: "CANCELLED", updated_at: agora }).eq("lote_id", loteId).in("status", ["PREPARED", "AWAITING_APPROVAL", "QUEUED"]);
  await auditar(ctx.db, ctx.ator, "cancelou_lote_notificacoes", { lote_id: loteId });
  return { ok: true, status: "CANCELLED" };
}

/** Rotina (cron): libera lotes aprovados que esperavam o fim do horário silencioso. */
export async function processarFila(ctx: Contexto) {
  const agora = ctx.agora ?? new Date();
  const config = await carregarConfigCentral(ctx.db);
  if (emHorarioSilencioso(horaBrasilia(agora), config.silencioInicio, config.silencioFim)) return { processados: 0, motivo: "horario_silencioso" };
  const { data } = await ctx.db.from("notificacao_lotes").select("id").eq("status", "QUEUED_FOR_ALLOWED_WINDOW");
  let processados = 0;
  for (const { id } of (data ?? []) as { id: string }[]) {
    const { data: mudou } = await ctx.db.from("notificacao_lotes").update({ status: "PROCESSING", updated_at: agora.toISOString() }).eq("id", id).eq("status", "QUEUED_FOR_ALLOWED_WINDOW").select("id");
    if (!(mudou ?? []).length) continue;
    await processar(ctx, id, false);
    processados++;
  }
  return { processados };
}

/** Rotina diária: fila → prepara → gera. Só aprova sozinha se a configuração permitir. */
export async function rotinaFinanceira(ctx: Contexto) {
  const config = await carregarConfigCentral(ctx.db);
  if (!config.ativa) return { executado: false, motivo: "central_desligada" };
  const fila = await processarFila(ctx);
  const preparado = await prepararLote(ctx, "rotina");
  if (!preparado.ok) return { executado: false, fila, motivo: preparado.codigo };
  if (preparado.existente) return { executado: true, fila, loteId: preparado.loteId, motivo: "lote_aberto_existente" };
  const gerado = await gerarMensagens(ctx, preparado.loteId);
  if (!gerado.ok) return { executado: true, fila, loteId: preparado.loteId, geracao: gerado.codigo };
  if (!config.aprovacaoObrigatoria && gerado.status === "AWAITING_APPROVAL") {
    const aprovado = await aprovarLote(ctx, preparado.loteId);
    return { executado: true, fila, loteId: preparado.loteId, aprovado: aprovado.ok };
  }
  return { executado: true, fila, loteId: preparado.loteId, status: gerado.status };
}

// ---------------------------------------------------------------------------
// Leitura (Operação, Relatórios)
// ---------------------------------------------------------------------------

export function contarItens(itens: { status: string; segmento: string; quantidade_parcelas: number }[]) {
  const porStatus: Record<string, number> = {};
  const porSegmento: Record<string, number> = {};
  let multiplas = 0;
  for (const i of itens) {
    porStatus[i.status] = (porStatus[i.status] ?? 0) + 1;
    if (!["SKIPPED_RULE", "SKIPPED_DEDUPLICATION", "CANCELLED"].includes(i.status)) {
      porSegmento[i.segmento] = (porSegmento[i.segmento] ?? 0) + 1;
      if (i.quantidade_parcelas > 1) multiplas++;
    }
  }
  const elegiveis = Object.values(porSegmento).reduce((a, b) => a + b, 0);
  return { total: itens.length, elegiveis, multiplasParcelas: multiplas, porStatus, porSegmento };
}

export async function detalharLote(db: Db, loteId: string) {
  const { data: lote } = await db.from("notificacao_lotes").select("*").eq("id", loteId).maybeSingle();
  if (!lote) return null;
  const itens = await itensDoLote(db, loteId);
  const { data: clientes } = itens.length ? await db.from("clientes").select("id,nome_completo").in("id", itens.map((i) => i.cliente_id)) : { data: [] };
  const nomes = new Map(((clientes ?? []) as { id: string; nome_completo: string | null }[]).map((c) => [c.id, c.nome_completo ?? "—"]));
  const l = lote as Record<string, string | null>;
  const duracaoMs = l.processamento_iniciado_em && l.concluido_em ? Date.parse(l.concluido_em) - Date.parse(l.processamento_iniciado_em) : null;
  return {
    lote,
    duracaoMs,
    contagem: contarItens(itens),
    segmentos: SEGMENTOS,
    itens: itens.map((i) => ({ ...i, nome: nomes.get(i.cliente_id) ?? "—" })),
  };
}

export async function listarLotes(db: Db, limite = 20) {
  const { data: lotes, error } = await db.from("notificacao_lotes")
    .select("id,tipo,status,origem,data_referencia,criado_por,aprovado_por,aprovado_em,concluido_em,processamento_iniciado_em,modelo,prompt_version,erro,created_at")
    .order("created_at", { ascending: false }).limit(Math.min(Math.max(limite, 1), 60));
  if (error) return null;
  const ids = ((lotes ?? []) as { id: string }[]).map((l) => l.id);
  const { data: itens } = ids.length ? await db.from("notificacao_lote_itens").select("lote_id,status,segmento,quantidade_parcelas").in("lote_id", ids) : { data: [] };
  const grupos = new Map<string, { status: string; segmento: string; quantidade_parcelas: number }[]>();
  for (const i of (itens ?? []) as { lote_id: string; status: string; segmento: string; quantidade_parcelas: number }[]) {
    grupos.set(i.lote_id, [...(grupos.get(i.lote_id) ?? []), i]);
  }
  return ((lotes ?? []) as { id: string }[]).map((l) => ({ ...l, contagem: contarItens(grupos.get(l.id) ?? []) }));
}

// ---------------------------------------------------------------------------
// Chat do lote: o Gemini responde sobre o lote com os dados reais e só SUGERE
// ações (quem executa é a pessoa, pelo botão de confirmação).
// ---------------------------------------------------------------------------

const ACOES_CHAT = ["nenhuma", "aprovar", "gerar_novamente", "cancelar", "preparar_novamente", "mostrar_segmento", "mostrar_falhas", "reprocessar_falhas"] as const;

const SCHEMA_CHAT = {
  type: "OBJECT",
  properties: {
    resposta: { type: "STRING" },
    acao: { type: "OBJECT", properties: { tipo: { type: "STRING", enum: [...ACOES_CHAT] }, segmento: { type: "STRING" }, instrucao: { type: "STRING" } }, required: ["tipo"] },
  },
  required: ["resposta", "acao"],
};

const SISTEMA_CHAT = [
  "Você é a assistente da Central de Notificações do Dev Console da Sra. Luck. Fale em português do Brasil, informal e curto.",
  "Responda SOMENTE com base no JSON do lote que você recebe. Nunca invente números, nomes, valores, datas ou status. Se a resposta não estiver nos dados, diga que não há evidência suficiente.",
  "Você NÃO executa nada. Quando a pessoa pedir para enviar/aprovar, gerar outra versão, cancelar, recalcular, ver um grupo ou ver falhas, preencha 'acao' e diga que ela precisa confirmar no botão.",
  "Para pedidos de ajuste de texto (ex.: 'deixa a de 6 a 10 dias mais acolhedora'), use acao.tipo = gerar_novamente, acao.segmento com o id da faixa e acao.instrucao com o pedido.",
  "Faixas: vence_amanha, vence_hoje, atraso_1, atraso_2_5, atraso_6_10, atraso_11_30.",
].join("\n");

export async function conversarSobreLote(ctx: Contexto, loteId: string, mensagemBruta: unknown, historicoBruto: unknown) {
  const pergunta = limparInstrucao(mensagemBruta);
  if (!pergunta) return falha(400, "mensagem_vazia", "Escreva uma mensagem.");
  const detalhe = await detalharLote(ctx.db, loteId);
  if (!detalhe) return falha(404, "lote_nao_encontrado", "Lote não encontrado.");
  const gemini = await configuracaoGemini(ctx.env, "notificacoes", { db: ctx.db });
  if (!gemini.chave) return semGemini(gemini);
  const historico = (Array.isArray(historicoBruto) ? historicoBruto : []).slice(-8)
    .map((h) => ({ autor: (h as { autor?: string })?.autor === "gemini" ? "gemini" : "equipe", texto: limparInstrucao((h as { texto?: unknown })?.texto) }))
    .filter((h) => h.texto);
  const l = detalhe.lote as Record<string, unknown>;
  const dados = {
    lote: { status: l.status, dataReferencia: l.data_referencia, origem: l.origem, aprovadoEm: l.aprovado_em, modelo: l.modelo, erro: l.erro },
    contagem: detalhe.contagem,
    clientes: detalhe.itens.slice(0, 80).map((i) => ({
      primeiroNome: primeiroNome(i.nome), faixa: i.segmento, parcelas: i.quantidade_parcelas, valorTotal: formatarMoeda(centavos(i.valor_total)),
      maiorAtraso: i.maior_atraso, status: i.status, motivo: i.motivo, mensagem: i.mensagem,
    })),
  };
  const usuario = [
    `Dados do lote: ${JSON.stringify(dados)}`,
    historico.length ? `Conversa até aqui: ${historico.map((h) => `${h.autor}: ${h.texto}`).join(" | ")}` : "",
    `Pergunta da equipe: ${pergunta}`,
  ].filter(Boolean).join("\n");
  try {
    if (!(await reservarChamadaGemini(ctx.env, gemini, { db: ctx.db }))) return limiteAtingido(gemini);
    const r = await gerarComGemini(gemini.chave, gemini.modelo, `${SISTEMA_CHAT}\nResponda só com o JSON pedido.`, usuario, ctx.fetcher, { schema: SCHEMA_CHAT, temperatura: 0.4, maxTokens: 1024 });
    const corpo = JSON.parse(r.bruto) as { resposta?: string; acao?: { tipo?: string; segmento?: string; instrucao?: string } };
    const tipo = ACOES_CHAT.includes(corpo.acao?.tipo as typeof ACOES_CHAT[number]) ? corpo.acao!.tipo! : "nenhuma";
    const segmento = corpo.acao?.segmento && SEGMENTO_IDS.has(corpo.acao.segmento) ? corpo.acao.segmento : null;
    return { ok: true as const, resposta: String(corpo.resposta ?? "").slice(0, 2000), acao: { tipo, segmento, instrucao: limparInstrucao(corpo.acao?.instrucao) || null }, modelo: r.modelo };
  } catch (erro) {
    const motivo = erro instanceof ErroGemini ? erro.motivo : "resposta_invalida";
    return falha(502, motivo, motivo === "http_429" ? "Limite do Gemini atingido agora. Tente de novo em alguns minutos." : `O Gemini não respondeu (${motivo}).`);
  }
}

// ---------------------------------------------------------------------------
// "Explicar este lote": o Gemini só resume FATOS já calculados a partir dos
// dados persistidos. Qualquer número no texto que não esteja nos fatos
// reprova o resumo (não há texto genérico de reserva).
// ---------------------------------------------------------------------------

export type FatosLote = {
  status: string;
  clientesAnalisadas: number;
  elegiveis: number;
  comMaisDeUmaParcela: number;
  aceitasPeloProvedor: number;
  somenteNoApp: number;
  falhas: number;
  deduplicadas: number;
  foraDaRegra: number;
  semMensagem: number;
  motivos: Record<string, number>;
};

export function fatosDoLote(lote: { status: string }, itens: { status: string; segmento: string; quantidade_parcelas: number; motivo: string | null }[]): FatosLote {
  const c = contarItens(itens);
  const s = c.porStatus;
  const motivos: Record<string, number> = {};
  for (const i of itens) if (i.motivo) motivos[i.motivo] = (motivos[i.motivo] ?? 0) + 1;
  return {
    status: lote.status,
    clientesAnalisadas: c.total,
    elegiveis: c.elegiveis,
    comMaisDeUmaParcela: c.multiplasParcelas,
    aceitasPeloProvedor: s.PROVIDER_ACCEPTED ?? 0,
    somenteNoApp: s.IN_APP_ONLY ?? 0,
    falhas: s.FAILED ?? 0,
    deduplicadas: s.SKIPPED_DEDUPLICATION ?? 0,
    foraDaRegra: s.SKIPPED_RULE ?? 0,
    semMensagem: s.PREPARED ?? 0,
    motivos,
  };
}

/** Todo número citado no resumo precisa existir nos fatos (contagens ou horas de deduplicação nos motivos). */
export function validarResumoLote(texto: unknown, fatos: FatosLote): ValidacaoMensagem {
  const t = String(texto ?? "").trim();
  if (t.length < 20 || t.length > 1200) return { ok: false, motivo: "tamanho" };
  const permitidos = new Set<number>([
    fatos.clientesAnalisadas, fatos.elegiveis, fatos.comMaisDeUmaParcela, fatos.aceitasPeloProvedor, fatos.somenteNoApp,
    fatos.falhas, fatos.deduplicadas, fatos.foraDaRegra, fatos.semMensagem, ...Object.values(fatos.motivos),
    ...Object.keys(fatos.motivos).flatMap((m) => (m.match(/\d+/g) ?? []).map(Number)),
    1,
  ]);
  for (const n of t.match(/\d+/g) ?? []) if (!permitidos.has(Number(n))) return { ok: false, motivo: "numero_inventado" };
  return { ok: true, texto: t };
}

const SISTEMA_EXPLICAR = [
  "Você resume um lote de lembretes financeiros para a equipe da Sra. Luck, em português do Brasil, informal e curto (3 a 6 frases).",
  "Use SOMENTE os números e motivos do JSON recebido. Não calcule números novos, não arredonde, não invente causas.",
  "Traduza os motivos técnicos para linguagem simples (ex.: lembrete_nas_ultimas_24h = já tinha recebido lembrete nas últimas 24 horas; cliente_sem_dispositivo_push = não tem celular com notificação ativa).",
  "PROVIDER_ACCEPTED significa que o serviço de push aceitou a mensagem, não que a cliente viu. Diga isso se citar esse número.",
].join("\n");

export async function explicarLote(ctx: Contexto, loteId: string) {
  const detalhe = await detalharLote(ctx.db, loteId);
  if (!detalhe) return falha(404, "lote_nao_encontrado", "Lote não encontrado.");
  const fatos = fatosDoLote(detalhe.lote as { status: string }, detalhe.itens);
  const gemini = await configuracaoGemini(ctx.env, "notificacoes", { db: ctx.db });
  if (!gemini.chave) return { ...semGemini(gemini), fatos };
  if (!(await reservarChamadaGemini(ctx.env, gemini, { db: ctx.db }))) return { ...limiteAtingido(gemini), fatos };
  try {
    const r = await gerarComGemini(gemini.chave, gemini.modelo, `${SISTEMA_EXPLICAR}\nResponda só com o JSON {"texto": "..."}.`, `Fatos do lote: ${JSON.stringify(fatos)}`, ctx.fetcher, { temperatura: 0.2, maxTokens: 1024 });
    const validacao = validarResumoLote(r.texto, fatos);
    if (!validacao.ok) return { ...falha(502, `resumo_reprovado:${validacao.motivo}`, "O resumo do Gemini citou um número que não está no lote e foi descartado. Veja os fatos abaixo."), fatos };
    return { ok: true as const, texto: validacao.texto, modelo: r.modelo, fatos };
  } catch (erro) {
    const motivo = erro instanceof ErroGemini ? erro.motivo : "resposta_invalida";
    return { ...falha(502, motivo, motivo === "http_429" ? "Limite do Gemini atingido agora. Tente de novo em alguns minutos." : `O Gemini não respondeu (${motivo}).`), fatos };
  }
}
