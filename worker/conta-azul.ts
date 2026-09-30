/**
 * Conta Azul → Sra Luck (API v2). A Conta Azul é a ÚNICA fonte de confirmação de pagamento:
 * o Sra Luck não envia baixa, pagamento, estorno, lançamento nem alteração para lá.
 *
 * O que é usado (docs/INTEGRACOES-MAPA.md, developers.contaazul.com):
 * - OAuth2 authorization code em login.contaazul.com; token em api-v2.contaazul.com/oauth/token
 *   com Basic(client_id:client_secret). Access token de 1 h; o refresh token MUDA a cada
 *   renovação e é gravado cifrado no cofre. Renovação serializada por trava no banco.
 * - GET eventos-financeiros/alteracoes (período, com cursor) + GET {evento}/parcelas e
 *   GET parcelas/{id}: detecção das baixas. A API não tem webhook: é leitura periódica.
 *
 * Regras:
 * - Baixa confirmada na Conta Azul entra no ledger do Sra Luck (principal, juros, multa,
 *   desconto, data, IDs da baixa e do evento, origem conta_azul), uma única vez.
 * - Só é aplicada sozinha com vínculo seguro (vinculoSeguroParaBaixa); o resto vira revisão.
 * - Parcela vinculada não recebe baixa manual nem confirmação de comprovante no Admin.
 * - O Sra Luck segue dono da jornada, contrato, elegibilidade, comprovantes e plano exibido.
 */
import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { isDevConsoleSyntheticAdminId } from "./dev-console-auth";
import { configDaFuncao, PADRAO_CONEXAO_CONTA_AZUL, type ConfigContaAzul, type ConfigConexaoContaAzul } from "./integracoes-registro";
import { obterCredencial, obterCredencialParaValidacao, removerCredenciaisInternas, salvarCredencialInterna } from "./integrations-credenciais";
import { criarState, validarState } from "./rd-station-readonly";
import { getCookie, verificarTokenAdmin } from "./session";
import { createServiceSupabaseClient, type Env } from "./supabase";

type Json = Record<string, any>;
type Db = ReturnType<typeof createServiceSupabaseClient>;

export const CA_API = PADRAO_CONEXAO_CONTA_AZUL.apiBaseUrl;
const PROVEDOR = "conta_azul";
const ORCAMENTO_MS = 20_000; // runtime edge: a resposta precisa começar em ~25 s
/** Tempo máximo de cada chamada à Conta Azul: provedor lento não pode travar o Financeiro. */
const TIMEOUT_MS = 15_000;

export class ErroContaAzul extends Error {
  constructor(public codigo: string, mensagem: string, public retentavel = false, public status = 0) { super(mensagem); }
}

// ------------------------------------------------------------------ dependências (injetáveis em teste)

export type Credenciais = {
  obter: (chave: string) => Promise<string | null>;
  salvar: (chave: string, valor: string, ator: string) => Promise<void>;
  remover?: (chaves: string[], ator: string) => Promise<void>;
};
export type Deps = { db: Db; fetch: typeof fetch; credenciais: Credenciais; agora: () => Date; config?: ConfigContaAzul; conexao?: ConfigConexaoContaAzul };

export function depsPadrao(env: Env, parcial: Partial<Deps> = {}): Deps {
  return {
    db: parcial.db ?? createServiceSupabaseClient(env),
    fetch: parcial.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a)),
    credenciais: parcial.credenciais ?? {
      obter: (chave) => obterCredencial(env, PROVEDOR, chave),
      salvar: (chave, valor, ator) => salvarCredencialInterna(env, PROVEDOR, chave, valor, ator),
      remover: (chaves, ator) => removerCredenciaisInternas(env, PROVEDOR, chaves, ator),
    },
    agora: parcial.agora ?? (() => new Date()),
    config: parcial.config,
    conexao: parcial.conexao,
  };
}

/** Credenciais que valem mesmo com a integração desligada (conectar, renovar, testar, desconectar). */
export function credenciaisDeConfiguracao(env: Env): Credenciais {
  return {
    obter: (chave) => obterCredencialParaValidacao(env, PROVEDOR, chave),
    salvar: (chave, valor, ator) => salvarCredencialInterna(env, PROVEDOR, chave, valor, ator),
    remover: (chaves, ator) => removerCredenciaisInternas(env, PROVEDOR, chaves, ator),
  };
}

/** Ambiente e endereços OAuth/API (configuração não secreta, só hosts da Conta Azul). */
export async function conexaoCa(d: Deps): Promise<ConfigConexaoContaAzul> {
  return d.conexao ?? await configDaFuncao<ConfigConexaoContaAzul>({} as Env, PROVEDOR, "conexao", { db: d.db });
}

/** Evento técnico (sem segredo) para a saúde da integração no Dev Console. Nunca derruba o fluxo. */
export async function registrarEvento(d: Deps, tipo: string, status: "processado" | "erro", payload: Json = {}, erro: string | null = null) {
  try {
    await d.db.from("integracao_eventos").insert({ provedor: PROVEDOR, event_type: tipo, payload, status, erro, processado_em: status === "erro" ? null : d.agora().toISOString() });
  } catch { /* observabilidade não bloqueia a operação */ }
}

async function comPrazo(d: Deps, url: string, init: RequestInit) {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS);
  try {
    return await d.fetch(url, { ...init, signal: controle.signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw new ErroContaAzul("timeout", `A Conta Azul não respondeu em ${TIMEOUT_MS / 1000} s.`, true);
    throw new ErroContaAzul("rede", "Falha de rede ao falar com a Conta Azul.", true);
  } finally {
    clearTimeout(relogio);
  }
}

export async function configCa(env: Env, d: Deps) {
  return d.config ?? await configDaFuncao<ConfigContaAzul>(env, PROVEDOR, "sincronizacao", { db: d.db });
}

// ------------------------------------------------------------------ OAuth e token

function basic(clientId: string, clientSecret: string) {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

export async function pedirToken(d: Deps, params: Record<string, string>) {
  const clientId = await d.credenciais.obter("client_id");
  const clientSecret = await d.credenciais.obter("client_secret");
  if (!clientId || !clientSecret) throw new ErroContaAzul("cliente_oauth_ausente", "Configure Client ID e Client Secret da Conta Azul no cofre.");
  const { tokenUrl } = await conexaoCa(d);
  const resposta = await comPrazo(d, tokenUrl, {
    method: "POST",
    headers: { Authorization: basic(clientId, clientSecret), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const corpo = await resposta.json().catch(() => ({})) as Json;
  if (!resposta.ok) {
    const sub = String(corpo.error_subtype || "");
    const motivo = sub === "access_revoked" ? "O acesso à Conta Azul foi revogado. Conecte de novo."
      : sub === "invalid_refresh_token" ? "O refresh token não vale mais. Conecte de novo."
      : sub === "invalid_client" ? "Client ID/Secret da Conta Azul inválidos."
      : `A Conta Azul recusou o token (HTTP ${resposta.status}).`;
    throw new ErroContaAzul(sub || "token_recusado", motivo, resposta.status >= 500, resposta.status);
  }
  const access = String(corpo.access_token || ""), refresh = String(corpo.refresh_token || "");
  if (!access || !refresh) throw new ErroContaAzul("token_invalido", "Resposta de token incompleta da Conta Azul.");
  return { access, refresh, expiresIn: Number(corpo.expires_in || 3600) };
}

export async function gravarTokens(d: Deps, t: { access: string; refresh: string; expiresIn: number }, ator: string) {
  // O refresh primeiro: se a gravação do access falhar, o próximo ciclo ainda renova.
  await d.credenciais.salvar("refresh_token", t.refresh, ator);
  await d.credenciais.salvar("access_token", t.access, ator);
  const expira = new Date(d.agora().getTime() + Math.max(60, t.expiresIn) * 1000).toISOString();
  await d.credenciais.salvar("token_expires_at", expira, ator);
  return t.access;
}

/** Renova com trava: o refresh token é de uso único; duas renovações simultâneas quebrariam a conexão. */
export async function renovarToken(d: Deps, ator = "sistema:conta_azul_refresh"): Promise<string> {
  const { data: pegou } = await d.db.rpc("integracao_tentar_trava", { p_nome: "conta_azul_token", p_segundos: 60 });
  if (pegou === false) {
    // Outra execução está renovando: espera o token novo aparecer.
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const expira = await d.credenciais.obter("token_expires_at");
      const token = await d.credenciais.obter("access_token");
      if (token && expira && Date.parse(expira) - d.agora().getTime() > 120_000) return token;
    }
    throw new ErroContaAzul("renovacao_ocupada", "Renovação do token em andamento.", true);
  }
  try {
    const refresh = await d.credenciais.obter("refresh_token");
    if (!refresh) throw new ErroContaAzul("sem_autorizacao", "A Conta Azul ainda não foi conectada (OAuth).");
    try {
      const t = await pedirToken(d, { grant_type: "refresh_token", refresh_token: refresh });
      const token = await gravarTokens(d, t, ator);
      await registrarEvento(d, "token_renovado", "processado", { expiraEmSegundos: t.expiresIn, ator });
      return token;
    } catch (e) {
      const erro = e instanceof ErroContaAzul ? e : new ErroContaAzul("renovacao", "Falha ao renovar o token.", true);
      await registrarEvento(d, "token_falhou", "erro", { codigo: erro.codigo, status: erro.status }, erro.message);
      throw erro;
    }
  } finally {
    await d.db.rpc("integracao_liberar_trava", { p_nome: "conta_azul_token" });
  }
}

export async function tokenAtual(d: Deps): Promise<string> {
  const token = await d.credenciais.obter("access_token");
  const expira = await d.credenciais.obter("token_expires_at");
  if (token && expira && Date.parse(expira) - d.agora().getTime() > 120_000) return token;
  if (token && !expira && !(await d.credenciais.obter("refresh_token"))) return token; // token manual antigo
  return renovarToken(d);
}

export async function urlDeAutorizacao(env: Env, adminId: string, d: Deps) {
  if (!env.CLIENTE_SESSION_SECRET) throw new ErroContaAzul("segredo_sessao", "Segredo de sessão não configurado.");
  const clientId = await d.credenciais.obter("client_id");
  const redirect = await d.credenciais.obter("redirect_uri") || `${(env.PUBLIC_APP_URL || "").replace(/\/$/, "")}/api/integrations/conta-azul/oauth/callback`;
  if (!clientId || !redirect.startsWith("https://")) throw new ErroContaAzul("cliente_oauth_ausente", "Configure Client ID e Redirect URI HTTPS da Conta Azul.");
  const state = await criarState(adminId, env.CLIENTE_SESSION_SECRET);
  const { authorizeUrl, ambiente } = await conexaoCa(d);
  // A URL de autorização da Conta Azul é uma rota com # (SPA); os parâmetros vão depois dela.
  const q = `response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state)}&scope=openid+profile+aws.cognito.signin.user.admin`;
  return { url: `${authorizeUrl}?${q}`, redirectUri: redirect, ambiente };
}

// ------------------------------------------------------------------ cliente HTTP

export async function caRequest(d: Deps, metodo: MetodoPermitido, caminho: string): Promise<Json | Json[] | null> {
  return (await caRequestComCabecalhos(d, metodo, caminho)).dados;
}

/**
 * O Sra Luck só LÊ a Conta Azul. A única escrita permitida é administrar a própria conexão
 * (revogar o OAuth). Qualquer outra tentativa é recusada aqui, antes de sair do servidor.
 */
type MetodoPermitido = "GET" | "DELETE";
function escritaPermitida(metodo: MetodoPermitido, caminho: string) {
  return metodo === "GET" || /^\/oauth\/connections\/[^/?#]+$/.test(caminho);
}

/** Cabeçalhos de limite/paginação que interessam ao diagnóstico (nunca Authorization). */
const CABECALHOS_UTEIS = /^(x-ratelimit|ratelimit|retry-after|x-rate-limit|x-total|x-request-id)/i;

export async function caRequestComCabecalhos(d: Deps, metodo: MetodoPermitido, caminho: string): Promise<{ dados: any; status: number; cabecalhos: Record<string, string> }> {
  if (!escritaPermitida(metodo, caminho)) throw new ErroContaAzul("escrita_bloqueada", "O Sra Luck não altera o financeiro da Conta Azul.");
  let token = await tokenAtual(d);
  const { apiBaseUrl } = await conexaoCa(d);
  const executar = (t: string) => comPrazo(d, `${apiBaseUrl}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${t}`, Accept: "application/json" },
  });
  let resposta = await executar(token);
  if (resposta.status === 401) {
    token = await renovarToken(d);
    resposta = await executar(token);
  }
  if (resposta.status === 429) {
    // 600/min e 10/s por conta conectada: a fila reagenda com espera crescente.
    const espera = Number(resposta.headers.get("Retry-After") || 0);
    throw new ErroContaAzul("limite", `Limite de requisições da Conta Azul atingido${espera ? `; tente em ${espera} s` : ""}.`, true, 429);
  }
  const texto = await resposta.text();
  let dados: any = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = null; }
  const cabecalhos: Record<string, string> = {};
  resposta.headers?.forEach?.((v, k) => { if (CABECALHOS_UTEIS.test(k)) cabecalhos[k.toLowerCase()] = v; });
  if (resposta.ok) return { dados, status: resposta.status, cabecalhos };
  const detalhe = typeof dados?.message === "string" ? dados.message.slice(0, 200) : typeof dados?.error === "string" ? dados.error.slice(0, 200) : "";
  if (resposta.status === 404) throw new ErroContaAzul("nao_encontrado", "Registro não encontrado na Conta Azul.", false, 404);
  if (resposta.status === 429 || resposta.status >= 500) throw new ErroContaAzul("provedor_indisponivel", `Conta Azul HTTP ${resposta.status}. ${detalhe}`.trim(), true, resposta.status);
  if (resposta.status === 409) throw new ErroContaAzul("versao", `Versão desatualizada na Conta Azul. ${detalhe}`.trim(), true, 409);
  throw new ErroContaAzul("recusado", `Conta Azul recusou (HTTP ${resposta.status}). ${detalhe}`.trim(), false, resposta.status);
}

// ------------------------------------------------------------------ estados comparáveis

export const centavos = (v: unknown) => Math.round(Number(v ?? 0) * 100);
export const dia = (v: unknown) => (v ? String(v).slice(0, 10) : null);

export type SraParcela = { valor: number; vencimento: string | null; status: string; dataPagamento: string | null };
export type CaBaixa = { id: string; dataPagamento: string | null; observacao: string; valor: number; juros: number; multa: number; desconto: number; metodo: string | null };
export type CaParcela = { status: string; valorBruto: number; vencimento: string | null; valorPago: number; naoPago: number; versao: number | null; baixas: CaBaixa[]; nota: string; descricao: string; eventoId: string | null; anexos: number };

export function sraAtual(b: Json): SraParcela {
  return { valor: centavos(b.valor) / 100, vencimento: dia(b.data_vencimento), status: String(b.status), dataPagamento: dia(b.data_pagamento) };
}

export function caAtual(p: Json): CaParcela {
  const comp = p.valor_composicao ?? {};
  return {
    status: String(p.status || ""),
    valorBruto: centavos(comp.valor_bruto ?? p.valor ?? 0) / 100,
    vencimento: dia(p.data_vencimento ?? p.vencimento),
    valorPago: Number(p.valor_pago ?? 0),
    naoPago: Number(p.nao_pago ?? 0),
    versao: p.versao == null ? null : Number(p.versao),
    baixas: (Array.isArray(p.baixas) ? p.baixas : []).map((b: Json) => ({
      id: String(b.id), dataPagamento: dia(b.data_pagamento), observacao: String(b.observacao || ""),
      valor: Number(b.valor_composicao?.valor_bruto ?? 0), juros: Number(b.valor_composicao?.juros ?? 0),
      multa: Number(b.valor_composicao?.multa ?? 0), desconto: Number(b.valor_composicao?.desconto ?? 0),
      metodo: b.metodo_pagamento ? String(b.metodo_pagamento) : null,
    })),
    nota: String(p.nota || ""),
    descricao: String(p.descricao || ""),
    eventoId: p.evento?.id ? String(p.evento.id) : null,
    anexos: Array.isArray(p.anexos) ? p.anexos.length : 0,
  };
}

export const marcadorDe = (boletoId: string) => `SLK-${boletoId.replace(/-/g, "").slice(0, 16).toUpperCase()}`;
export const quitada = (c: CaParcela) => c.status === "QUITADO" || (c.valorPago > 0 && c.naoPago === 0 && c.status !== "RECEBIDO_PARCIAL");
export const aberta = (c: CaParcela) => c.status === "PENDENTE" || c.status === "ATRASADO";

export function formaDoMetodo(metodo: string | null): string {
  const m = String(metodo || "");
  if (m.startsWith("PIX")) return "pix";
  if (m === "DINHEIRO") return "dinheiro";
  if (m === "TRANSFERENCIA_BANCARIA" || m === "DEPOSITO_BANCARIO") return "transferencia";
  if (m === "BOLETO_BANCARIO") return "boleto";
  if (m.startsWith("CARTAO")) return "cartao";
  if (m === "CHEQUE") return "cheque";
  return "outro";
}

/** Soma das baixas de uma parcela quitada: é o que entra no ledger do Sra Luck. */
export function composicaoDasBaixas(ca: CaParcela) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const ultima = [...ca.baixas].sort((a, b) => String(a.dataPagamento).localeCompare(String(b.dataPagamento))).at(-1) ?? null;
  return {
    principal: r2(ca.baixas.reduce((t, b) => t + b.valor, 0)),
    juros: r2(ca.baixas.reduce((t, b) => t + b.juros, 0)),
    multa: r2(ca.baixas.reduce((t, b) => t + b.multa, 0)),
    desconto: r2(ca.baixas.reduce((t, b) => t + b.desconto, 0)),
    dataPagamento: ultima?.dataPagamento ?? null,
    forma: formaDoMetodo(ultima?.metodo ?? null),
    baixaId: ultima?.id ?? null,
  };
}

/**
 * Baixa vinda da Conta Azul só é aplicada sozinha quando TUDO bate. Devolve os motivos que
 * impedem (vazio = seguro).
 */
export function vinculoSeguroParaBaixa(v: Json, boleto: Json, ca: CaParcela, config: ConfigContaAzul): string[] {
  const motivos: string[] = [];
  if (!config.baixaAutomatica) motivos.push("Baixa automática desligada na configuração.");
  if (v.estado !== "vinculado") motivos.push(`Vínculo em estado ${v.estado}.`);
  if (!v.ca_parcela_id) motivos.push("Vínculo sem parcela confirmada.");
  if (!quitada(ca)) motivos.push(`Parcela na Conta Azul está ${ca.status}.`);
  if (!ca.baixas.length) motivos.push("Sem baixa registrada na Conta Azul.");
  if (centavos(ca.valorBruto) !== centavos(boleto.valor)) motivos.push(`Valor diferente (Conta Azul ${ca.valorBruto.toFixed(2)} × Sra Luck ${Number(boleto.valor).toFixed(2)}).`);
  if (ca.baixas.length && centavos(composicaoDasBaixas(ca).principal) !== centavos(ca.valorBruto)) motivos.push("A soma das baixas não fecha o valor da parcela.");
  // Em aberto, em conferência (comprovante enviado) ou com comprovante rejeitado: a confirmação da
  // Conta Azul é o que vale. Já paga no Sra Luck não é baixada de novo.
  if (!["nao_pago", "pendente_confirmacao", "rejeitado"].includes(String(boleto.status))) motivos.push(`Parcela do Sra Luck está ${boleto.status}.`);
  if (boleto.suspensa) motivos.push("Parcela suspensa no Sra Luck.");
  return motivos;
}

// ------------------------------------------------------------------ fila, conflitos e vínculos

export async function abrirConflito(db: Db, c: { referencia: string; vinculoId: string | null; tipo: string; descricao: string; dadosSra?: Json; dadosExternos?: Json }) {
  const { error } = await db.from("integracao_conflitos").insert({
    provedor: PROVEDOR, referencia: c.referencia, vinculo_id: c.vinculoId, tipo: c.tipo, descricao: c.descricao,
    dados_sra: c.dadosSra ?? {}, dados_externos: c.dadosExternos ?? {},
  });
  const novo = !error;
  if (c.vinculoId) await db.from("conta_azul_vinculos").update({ estado: "conflito", updated_at: new Date().toISOString() }).eq("id", c.vinculoId).in("estado", ["vinculado", "aguardando_protocolo", "enviando"]);
  return novo;
}

async function vinculoComBoleto(db: Db, boletoId: string) {
  const { data } = await db.from("conta_azul_vinculos").select("*, boletos(id,cliente_id,numero_parcela,total_parcelas,valor,data_vencimento,status,data_pagamento,observacoes,suspensa,juros_recebidos,multa_recebida,desconto_recebido,origem_baixa), clientes(nome_completo,cpf)").eq("boleto_id", boletoId).maybeSingle();
  if (!data) return null;
  const v = data as Json;
  const boleto = Array.isArray(v.boletos) ? v.boletos[0] : v.boletos;
  const cliente = Array.isArray(v.clientes) ? v.clientes[0] : v.clientes;
  return { v, boleto: boleto as Json | null, cliente: cliente as Json | null };
}

export const agoraIso = (d: Deps) => d.agora().toISOString();

/**
 * Parcela cujo pagamento é controlado pela Conta Azul (vínculo ativo com parcela confirmada).
 * Nela o Admin não registra baixa nem confirma comprovante. Falha de leitura = não bloqueia
 * (sem a estrutura da integração, o Financeiro segue como antes).
 */
export async function parcelaControladaPelaContaAzul(db: Db, boletoId: string): Promise<boolean> {
  try {
    const { data, error } = await db.from("conta_azul_vinculos").select("estado,ca_parcela_id").eq("boleto_id", boletoId).maybeSingle();
    if (error || !data) return false;
    return (data as Json).estado !== "desvinculado" && Boolean((data as Json).ca_parcela_id);
  } catch {
    return false;
  }
}
export const MENSAGEM_PAGAMENTO_CONTA_AZUL = "Pagamento controlado pela Conta Azul: confirme a baixa na Conta Azul e use Sincronizar agora.";

export async function atualizarVinculo(d: Deps, id: string, patch: Json) {
  await d.db.from("conta_azul_vinculos").update({ ...patch, updated_at: agoraIso(d) }).eq("id", id);
}

export async function lerParcela(d: Deps, parcelaId: string) {
  return caAtual(await caRequest(d, "GET", `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(parcelaId)}`) as Json);
}

// ------------------------------------------------------------------ leitura Conta Azul → Sra Luck

/** Data/hora de Brasília sem fuso, como a API pede (ISO 8601, São Paulo/GMT-3). */
export function horaSaoPaulo(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/**
 * Baixa da Conta Azul → ledger do Sra Luck (RPC conta_azul_registrar_baixa, migration_124): mesma
 * trava e idempotência da baixa manual, origem 'conta_azul' e a composição somada das baixas.
 * Devolve false quando a parcela não está mais em aberto no Sra Luck.
 */
export async function aplicarBaixaDaConta(d: Deps, v: Json, boleto: Json, ca: CaParcela, ator: string) {
  const comp = composicaoDasBaixas(ca);
  if (!comp.baixaId || !comp.dataPagamento) return false;
  const { error } = await d.db.rpc("conta_azul_registrar_baixa", {
    p_boleto_id: boleto.id, p_data_pagamento: comp.dataPagamento, p_juros: comp.juros, p_multa: comp.multa, p_desconto: comp.desconto,
    p_forma_pagamento: comp.forma, p_ca_baixa_id: comp.baixaId, p_ca_evento_id: ca.eventoId ?? v.ca_evento_id ?? null,
    p_usuario: ator, p_idempotency_key: `conta_azul:baixa:${comp.baixaId}`,
  });
  if (error) {
    if (/nao esta em aberto|ja liquidada/i.test(String(error.message))) return false;
    throw new ErroContaAzul("estrutura", "Não foi possível registrar a baixa da Conta Azul no Financeiro (confira a migration_124).");
  }
  // Base nova dos dois lados = pago: o detector do Sra Luck não devolve essa baixa para a Conta Azul.
  await atualizarVinculo(d, v.id, { ca_baixa_id: comp.baixaId, baixa_origem: "conta_azul", ca_snapshot: ca, ca_versao: ca.versao, sra_snapshot: { ...(v.sra_snapshot ?? {}), status: "pago", dataPagamento: comp.dataPagamento }, ultima_sincronizacao_em: agoraIso(d) });
  return true;
}

export async function avaliarParcelaCa(env: Env, d: Deps, v: Json, boleto: Json, bruto: Json) {
  const config = await configCa(env, d);
  const ca = caAtual(bruto);
  const antes = (v.ca_snapshot ?? {}) as Partial<CaParcela>;
  const s = sraAtual(boleto);
  const ref = { referencia: v.boleto_id as string, vinculoId: v.id as string };
  let acao = "sem_mudanca";

  if (["CANCELADO", "RENEGOCIADO", "PERDIDO"].includes(ca.status)) {
    if (antes.status !== ca.status) {
      await abrirConflito(d.db, { ...ref, tipo: `ca_${ca.status.toLowerCase()}`, descricao: `A parcela foi marcada como ${ca.status} na Conta Azul. O Sra Luck não muda nada sozinho.`, dadosSra: s, dadosExternos: ca });
      acao = "conflito";
    }
  } else if (ca.status === "RECEBIDO_PARCIAL") {
    if (antes.status !== ca.status) {
      await abrirConflito(d.db, { ...ref, tipo: "recebido_parcial", descricao: `Recebimento parcial na Conta Azul (${ca.valorPago.toFixed(2)} de ${ca.valorBruto.toFixed(2)}). O Sra Luck não tem baixa parcial.`, dadosSra: s, dadosExternos: ca });
      acao = "conflito";
    }
  } else if (quitada(ca)) {
    const nossa = v.ca_baixa_id && ca.baixas.some((b) => b.id === v.ca_baixa_id);
    if (s.status === "pago") {
      // A confirmação chegou na Conta Azul para uma parcela que já estava paga aqui: concilia.
      const { data: abertos } = await d.db.from("integracao_conflitos").update({ estado: "resolvido", resolucao: "confirmado_na_conta_azul", resolvido_por: "sistema:conta_azul", resolvido_em: agoraIso(d) })
        .eq("provedor", PROVEDOR).eq("referencia", v.boleto_id).eq("tipo", "paga_so_no_sra").eq("estado", "aberto").select("id");
      if ((abertos ?? []).length) await atualizarVinculo(d, v.id, { estado: "vinculado", ca_baixa_id: composicaoDasBaixas(ca).baixaId });
    } else if (!nossa) {
      const motivos = vinculoSeguroParaBaixa(v, boleto, ca, config);
      if (!motivos.length && await aplicarBaixaDaConta(d, v, boleto, ca, "sistema:conta_azul")) return "baixa_aplicada";
      await abrirConflito(d.db, { ...ref, tipo: "baixa_na_conta_azul", descricao: `Quitada na Conta Azul e em aberto no Sra Luck. Não aplicada sozinha: ${motivos.join(" ") || "a parcela mudou durante a aplicação."}`, dadosSra: s, dadosExternos: ca });
      acao = "conflito";
    }
  } else if (aberta(ca) && antes.status === "QUITADO" && s.status === "pago") {
    await abrirConflito(d.db, { ...ref, tipo: "baixa_removida_na_conta_azul", descricao: "A baixa foi removida na Conta Azul, mas a parcela está paga no Sra Luck. O Sra Luck não estorna sozinho.", dadosSra: s, dadosExternos: ca });
    acao = "conflito";
  }

  const mudouNaConta = antes.versao != null && (centavos(ca.valorBruto) !== centavos(antes.valorBruto) || ca.vencimento !== antes.vencimento);
  const divergeDoSra = centavos(ca.valorBruto) !== centavos(s.valor) || ca.vencimento !== s.vencimento;
  if (mudouNaConta && divergeDoSra && s.status !== "pago") {
    await abrirConflito(d.db, { ...ref, tipo: "alterada_na_conta_azul", descricao: "Valor ou vencimento foi alterado na Conta Azul e não bate com o Sra Luck (fonte desses dados).", dadosSra: s, dadosExternos: ca });
    acao = "conflito";
  }
  await atualizarVinculo(d, v.id, { ca_snapshot: ca, ca_versao: ca.versao, ultima_sincronizacao_em: agoraIso(d) });
  return acao;
}

export async function lerMudancasContaAzul(env: Env, d: Deps, prazo: number) {
  const res = { eventos: 0, parcelas: 0, baixasAplicadas: 0, conflitos: 0, verificadas: 0 };
  const agora = d.agora();
  const { data: cursor } = await d.db.from("integracao_cursores").select("valor").eq("provedor", PROVEDOR).eq("nome", "alteracoes").maybeSingle();
  const inicio = new Date(Math.max(Date.parse(String((cursor as Json | null)?.valor ?? 0)) - 5 * 60_000, agora.getTime() - 7 * 86_400_000));
  const ids = new Set<string>();
  for (let pagina = 1; pagina <= 20; pagina++) {
    const q = new URLSearchParams({ pagina: String(pagina), tamanho_pagina: "100", data_inicio: horaSaoPaulo(inicio), data_fim: horaSaoPaulo(agora) });
    const r = await caRequest(d, "GET", `/v1/financeiro/eventos-financeiros/alteracoes?${q}`) as Json;
    const itens = Array.isArray(r?.itens) ? r.itens : [];
    itens.forEach((i: Json) => i?.id && ids.add(String(i.id)));
    if (itens.length < 100) break;
  }
  res.eventos = ids.size;
  const avaliar = async (v: Json, parcela: Json) => {
    const b = Array.isArray(v.boletos) ? v.boletos[0] : v.boletos;
    if (!b) return;
    res.parcelas++;
    const a = await avaliarParcelaCa(env, d, v, b, parcela);
    if (a === "baixa_aplicada") res.baixasAplicadas++;
    if (a === "conflito") res.conflitos++;
  };
  const lista = [...ids];
  for (let i = 0; i < lista.length && Date.now() < prazo; i += 100) {
    const { data: vinculos } = await d.db.from("conta_azul_vinculos").select("*, boletos(id,valor,data_vencimento,status,data_pagamento,observacoes,suspensa)").in("ca_evento_id", lista.slice(i, i + 100)).not("ca_parcela_id", "is", null);
    const porEvento = new Map<string, Json[]>();
    for (const v of (vinculos ?? []) as Json[]) porEvento.set(v.ca_evento_id, [...(porEvento.get(v.ca_evento_id) ?? []), v]);
    for (const [evento, vs] of porEvento) {
      if (Date.now() > prazo) break;
      const parcelas = await caRequest(d, "GET", `/v1/financeiro/eventos-financeiros/${encodeURIComponent(evento)}/parcelas`) as Json[];
      for (const p of Array.isArray(parcelas) ? parcelas : []) {
        const v = vs.find((x) => x.ca_parcela_id === String(p.id));
        if (v) await avaliar(v, p);
      }
    }
  }
  // Só avança o cursor se leu tudo dentro do prazo.
  if (Date.now() < prazo) {
    await d.db.from("integracao_cursores").upsert({ provedor: PROVEDOR, nome: "alteracoes", valor: agora.toISOString(), atualizado_em: agora.toISOString() }, { onConflict: "provedor,nome" });
  }
  // Rede de segurança: confere os vínculos mais antigos, alguns por execução.
  const { data: antigos } = await d.db.from("conta_azul_vinculos").select("*, boletos(id,valor,data_vencimento,status,data_pagamento,observacoes,suspensa)")
    .in("estado", ["vinculado", "conflito"]).not("ca_parcela_id", "is", null).order("ultima_sincronizacao_em", { ascending: true, nullsFirst: true }).limit(15);
  for (const v of (antigos ?? []) as Json[]) {
    if (Date.now() > prazo) break;
    try {
      const p = await caRequest(d, "GET", `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(v.ca_parcela_id)}`) as Json;
      res.verificadas++;
      await avaliar(v, p);
    } catch (e) {
      if ((e as ErroContaAzul).codigo === "nao_encontrado") {
        await abrirConflito(d.db, { referencia: v.boleto_id, vinculoId: v.id, tipo: "parcela_sumiu", descricao: "A parcela vinculada não existe mais na Conta Azul (excluída lá)." });
        res.conflitos++;
      } else throw e;
    }
  }
  return res;
}

// ------------------------------------------------------------------ execução completa

/**
 * Trava de ambiente: num Preview da Vercel a Conta Azul só funciona com CONTA_AZUL_PREVIEW_PERMITIDO=1,
 * definido apenas no Preview ligado ao banco de TESTE. Evita que um Preview que herdou as variáveis
 * de produção fale com a Conta Azul usando dados reais.
 */
export function contaAzulBloqueadaNoAmbiente(env: Env) {
  if (env.VERCEL_ENV === "preview") return env.CONTA_AZUL_PREVIEW_PERMITIDO !== "1";
  // Produção: DESLIGADA até autorização explícita (CONTA_AZUL_PRODUCAO_PERMITIDA=1 na Vercel).
  if (env.VERCEL_ENV === "production") return env.CONTA_AZUL_PRODUCAO_PERMITIDA !== "1";
  return false;
}
export const MENSAGEM_PREVIEW_BLOQUEADO = "Conta Azul desligada neste ambiente (Production só com autorização; Preview só no banco de teste).";

export async function sincronizarContaAzul(env: Env, opcoes: { origem: "manual" | "agendada"; ator: string }, parcial: Partial<Deps> = {}) {
  if (contaAzulBloqueadaNoAmbiente(env)) return { executada: false, motivo: "ambiente_desligado" };
  const d = depsPadrao(env, parcial);
  const prazo = Date.now() + ORCAMENTO_MS;
  const config = await configCa(env, d);
  if (opcoes.origem === "agendada" && !config.ativo) return { executada: false, motivo: "desligada" };
  const { data: pegou } = await d.db.rpc("integracao_tentar_trava", { p_nome: "conta_azul_sync", p_segundos: 840 });
  if (pegou === false) return { executada: false, motivo: "em_andamento" };
  const resumo: Json = { origem: opcoes.origem };
  let status = "processado", erro: string | null = null;
  try {
    await tokenAtual(d);
    resumo.leitura = await lerMudancasContaAzul(env, d, prazo);
  } catch (e) {
    status = "erro";
    erro = e instanceof ErroContaAzul ? e.message : "Falha inesperada na sincronização.";
  } finally {
    await d.db.rpc("integracao_liberar_trava", { p_nome: "conta_azul_sync" });
  }
  await d.db.from("integracao_eventos").insert({ provedor: PROVEDOR, event_type: `sync_${opcoes.origem}`, payload: resumo, status, erro, processado_em: status === "erro" ? null : agoraIso(d) });
  if (opcoes.origem === "manual") await d.db.from("logs_alteracoes").insert({ usuario: opcoes.ator, acao: "sincronizou_conta_azul", entidade: "integracoes", entidade_id: PROVEDOR, detalhes: { ...resumo, status, erro } });
  return { executada: true, status, erro, ...resumo };
}

// ------------------------------------------------------------------ ações do Admin

export const ACOES_CONFLITO = ["aplicar_baixa_conta_azul", "estornar_no_sra", "manter", "desvincular"] as const;
export type AcaoConflito = typeof ACOES_CONFLITO[number];
/** Ações que mexem no status financeiro da parcela no Sra Luck exigem a permissão de baixa manual. */
export const ACOES_QUE_ALTERAM_SRA: readonly AcaoConflito[] = ["aplicar_baixa_conta_azul", "estornar_no_sra"];

export async function resolverConflito(env: Env, id: string, acao: AcaoConflito, ator: string, nota: string | null, parcial: Partial<Deps> = {}) {
  const d = depsPadrao(env, parcial);
  const { data: c } = await d.db.from("integracao_conflitos").select("*").eq("id", id).eq("provedor", PROVEDOR).maybeSingle();
  if (!c || (c as Json).estado !== "aberto") return { ok: false as const, status: 404, erro: "Conflito não encontrado ou já resolvido." };
  const conflito = c as Json;
  const r = conflito.referencia ? await vinculoComBoleto(d.db, conflito.referencia) : null;
  if (!r || !r.boleto) {
    if (acao !== "manter") return { ok: false as const, status: 409, erro: "Sem vínculo: só dá para marcar como verificado." };
  }
  const v = r?.v, boleto = r?.boleto;
  if (acao === "aplicar_baixa_conta_azul") {
    if (!v?.ca_parcela_id) return { ok: false as const, status: 409, erro: "Vínculo sem parcela confirmada." };
    const ca = await lerParcela(d, v.ca_parcela_id);
    if (!quitada(ca) || !ca.baixas.length) return { ok: false as const, status: 409, erro: `A parcela não está quitada na Conta Azul agora (${ca.status}).` };
    if (!(await aplicarBaixaDaConta(d, v, boleto!, ca, ator))) return { ok: false as const, status: 409, erro: "A parcela do Sra Luck não está em aberto." };
  } else if (acao === "estornar_no_sra") {
    if (boleto!.status !== "pago") return { ok: false as const, status: 409, erro: "A parcela do Sra Luck não está paga." };
    await d.db.from("financeiro_recebimentos").update({ status_validacao: "rejeitado", motivo_rejeicao: `Estornado na revisão do conflito ${id} (Conta Azul).` })
      .eq("boleto_id", boleto!.id).eq("status_validacao", "validado").eq("origem", "conta_azul");
    await d.db.from("boletos").update({ status: "nao_pago", data_pagamento: null }).eq("id", boleto!.id).eq("status", "pago");
    await atualizarVinculo(d, v!.id, { ca_baixa_id: null, baixa_origem: null, sra_snapshot: { ...(v!.sra_snapshot ?? {}), status: "nao_pago", dataPagamento: null } });
    await d.db.from("logs_alteracoes").insert({ usuario: ator, acao: "estornou_baixa_por_conflito_conta_azul", entidade: "boletos", entidade_id: boleto!.id, detalhes: { conflitoId: id } });
  } else if (acao === "desvincular") {
    if (v) await atualizarVinculo(d, v.id, { estado: "desvinculado" });
  }
  // "manter": nada muda; a base passa a ser o estado atual para não reabrir o mesmo conflito.
  if (v && acao !== "desvincular") {
    const { count } = await d.db.from("integracao_conflitos").select("id", { count: "exact", head: true }).eq("referencia", conflito.referencia).eq("estado", "aberto").neq("id", id);
    if (!count) await atualizarVinculo(d, v.id, { estado: v.ca_parcela_id ? "vinculado" : v.estado });
  }
  await d.db.from("integracao_conflitos").update({ estado: acao === "manter" ? "descartado" : "resolvido", resolucao: acao, nota, resolvido_por: ator, resolvido_em: agoraIso(d) }).eq("id", id);
  await d.db.from("logs_alteracoes").insert({ usuario: ator, acao: "resolveu_conflito_conta_azul", entidade: "integracoes", entidade_id: id, detalhes: { tipo: conflito.tipo, acao, boletoId: conflito.referencia, nota } });
  return { ok: true as const };
}

// ------------------------------------------------------------------ leituras para as telas

export async function painel(env: Env, d: Deps) {
  const [cfg, token, refresh, expira, clientId, eventos, cursor] = await Promise.all([
    configCa(env, d), d.credenciais.obter("access_token"), d.credenciais.obter("refresh_token"), d.credenciais.obter("token_expires_at"),
    d.credenciais.obter("client_id"),
    d.db.from("integracao_eventos").select("event_type,status,erro,payload,created_at").eq("provedor", PROVEDOR).like("event_type", "sync_%").order("created_at", { ascending: false }).limit(1),
    d.db.from("integracao_cursores").select("valor").eq("provedor", PROVEDOR).eq("nome", "alteracoes").maybeSingle(),
  ]);
  const contar = async (valores: string[]) => Object.fromEntries(await Promise.all(valores.map(async (e) => {
    const { count, error } = await d.db.from("conta_azul_vinculos").select("id", { count: "exact", head: true }).eq("estado", e);
    return [e, error ? null : count ?? 0];
  })));
  const estrutura = await d.db.from("conta_azul_vinculos").select("id", { count: "exact", head: true });
  return {
    estruturaAplicada: !estrutura.error,
    conexao: { clientConfigurado: Boolean(clientId), autorizada: Boolean(refresh), tokenManual: Boolean(token && !refresh), expiraEm: expira ?? null },
    config: cfg,
    vinculos: await contar(["vinculado", "conflito", "desvinculado"]),
    conflitosAbertos: (await d.db.from("integracao_conflitos").select("id", { count: "exact", head: true }).eq("provedor", PROVEDOR).eq("estado", "aberto")).count ?? null,
    ultimaSincronizacao: (eventos.data ?? [])[0] ?? null,
    cursorAlteracoes: (cursor.data as Json | null)?.valor ?? null,
  };
}

export async function listar(d: Deps, tipo: "vinculos" | "conflitos" | "historico", filtro: string | null) {
  if (tipo === "vinculos") {
    let q = d.db.from("conta_azul_vinculos").select("id,boleto_id,cliente_id,marcador,estado,ca_parcela_id,ca_evento_id,baixa_origem,ultima_sincronizacao_em,ultimo_erro,updated_at,boletos(numero_parcela,total_parcelas,valor,data_vencimento,status),clientes(nome_completo)").order("updated_at", { ascending: false }).limit(300);
    if (filtro) q = q.eq("estado", filtro);
    return (await q).data ?? [];
  }
  if (tipo === "conflitos") {
    let q = d.db.from("integracao_conflitos").select("*").eq("provedor", PROVEDOR).order("created_at", { ascending: false }).limit(200);
    q = q.eq("estado", filtro || "aberto");
    return (await q).data ?? [];
  }
  return (await d.db.from("integracao_eventos").select("id,event_type,status,erro,payload,created_at,processado_em").eq("provedor", PROVEDOR).order("created_at", { ascending: false }).limit(60)).data ?? [];
}

// ------------------------------------------------------------------ rotas

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

async function oauthCallback(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço indisponível." }, 503);
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const adminId = await validarState(url.searchParams.get("state") || "", env.CLIENTE_SESSION_SECRET);
  if (!code || !adminId) return json({ erro: "Retorno OAuth inválido ou expirado." }, 400);
  const ehDev = isDevConsoleSyntheticAdminId(adminId);
  const colaborador = ehDev ? null : await buscarColaboradorAdminAtivo(adminId, env).catch(() => null);
  if (!ehDev && (!colaborador || !temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.INTEGRACOES_GERENCIAR_CREDENCIAIS))) return json({ erro: "Sem permissão para conectar a Conta Azul." }, 403);
  const ator = ehDev ? adminId : colaborador!.id;
  const credenciaisConfiguracao = {
    obter: (chave: string) => obterCredencialParaValidacao(env, PROVEDOR, chave),
    salvar: (chave: string, valor: string, actor: string) => salvarCredencialInterna(env, PROVEDOR, chave, valor, actor),
  };
  const d = depsPadrao(env, { credenciais: credenciaisConfiguracao });
  const redirect = await d.credenciais.obter("redirect_uri") || `${(env.PUBLIC_APP_URL || url.origin).replace(/\/$/, "")}/api/integrations/conta-azul/oauth/callback`;
  try {
    await gravarTokens(d, await pedirToken(d, { grant_type: "authorization_code", code, redirect_uri: redirect }), ator);
    await d.db.from("logs_alteracoes").insert({ usuario: ator, acao: "autorizou_oauth_conta_azul", entidade: "integracoes", entidade_id: PROVEDOR, detalhes: { origem: ehDev ? "dev_console" : "admin" } });
    if (ehDev) return new Response("<!doctype html><meta charset='utf-8'><title>Conta Azul conectada</title><body style='font-family:system-ui;padding:32px'><h2>Conta Azul autorizada</h2><p>Os tokens OAuth foram salvos. Volte ao Dev Console e clique em Validar e ativar.</p><script>setTimeout(()=>window.close(),1800)</script></body>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
    return Response.redirect(`${(env.PUBLIC_APP_URL || url.origin).replace(/\/$/, "")}/admin/integracoes?contaAzul=conectado`, 302);
  } catch (e) {
    return json({ erro: e instanceof ErroContaAzul ? e.message : "Não foi possível concluir a autorização da Conta Azul." }, 502);
  }
}

export async function exigir(request: Request, env: Env, permissoes: string[]) {
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço indisponível." }, 503);
  const sessao = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  if (!sessao) return json({ erro: "Sessão administrativa expirada." }, 401);
  const colaborador = await buscarColaboradorAdminAtivo(sessao.adminId, env).catch(() => null);
  if (!colaborador) return json({ erro: "Acesso administrativo não autorizado." }, 403);
  if (!permissoes.every((p) => temPermissaoAdmin(colaborador, p))) return json({ erro: "Seu papel não tem permissão para esta operação da Conta Azul." }, 403);
  return { adminId: sessao.adminId, colaboradorId: colaborador.id };
}

export async function contaAzulApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/admin/integrations/conta-azul/") && path !== "/api/integrations/conta-azul/oauth/callback") return null;
  if (contaAzulBloqueadaNoAmbiente(env)) return json({ erro: MENSAGEM_PREVIEW_BLOQUEADO, codigo: "CONTA_AZUL_PREVIEW_BLOQUEADO" }, 503);
  if (path === "/api/integrations/conta-azul/oauth/callback" && request.method === "GET") return oauthCallback(request, env);
  const rota = path.slice("/api/admin/integrations/conta-azul/".length);
  const d = depsPadrao(env);

  if (request.method === "GET") {
    const auth = await exigir(request, env, [PERMISSOES_ADMIN.INTEGRACOES_OPERAR_FINANCEIRO]);
    if (auth instanceof Response) return auth;
    if (rota === "painel") return json(await painel(env, d));
    if (rota === "vinculos" || rota === "conflitos" || rota === "historico") return json({ itens: await listar(d, rota, url.searchParams.get("estado")) });
    if (rota === "authorize-url") {
      const cred = await exigir(request, env, [PERMISSOES_ADMIN.INTEGRACOES_GERENCIAR_CREDENCIAIS]);
      if (cred instanceof Response) return cred;
      const dConfig = depsPadrao(env, { credenciais: {
        obter: (chave: string) => obterCredencialParaValidacao(env, PROVEDOR, chave),
        salvar: (chave: string, valor: string, ator: string) => salvarCredencialInterna(env, PROVEDOR, chave, valor, ator),
      } });
      try { return json(await urlDeAutorizacao(env, auth.adminId, dConfig)); } catch (e) { return json({ erro: (e as Error).message }, 409); }
    }
    return json({ erro: "Rota da Conta Azul não encontrada." }, 404);
  }

  if (request.method !== "POST") return json({ erro: "Método não permitido." }, 405);
  if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  const body = await request.json().catch(() => ({})) as Json;
  const auth = await exigir(request, env, [PERMISSOES_ADMIN.INTEGRACOES_OPERAR_FINANCEIRO]);
  if (auth instanceof Response) return auth;
  // Sincronizar é a mesma rodada do agendador (só regras automáticas seguras): o Dev Console
  // pode disparar. As demais mutações financeiras nunca vêm da identidade técnica do Console.
  if (rota === "sincronizar") return json(await sincronizarContaAzul(env, { origem: "manual", ator: isDevConsoleSyntheticAdminId(auth.adminId) ? auth.adminId : auth.colaboradorId }));
  if (isDevConsoleSyntheticAdminId(auth.adminId)) return json({ erro: "Operações da Conta Azul são feitas no Admin do Sra Luck." }, 403);
  const ator = auth.colaboradorId;

  const resolver = rota.match(/^conflitos\/([0-9a-f-]{36})\/resolver$/);
  if (resolver) {
    const acao = String(body.acao || "") as AcaoConflito;
    if (!ACOES_CONFLITO.includes(acao)) return json({ erro: "Ação inválida." }, 400);
    if (ACOES_QUE_ALTERAM_SRA.includes(acao)) {
      const baixa = await exigir(request, env, [PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL]);
      if (baixa instanceof Response) return baixa;
    }
    const nota = typeof body.nota === "string" ? body.nota.trim().slice(0, 500) || null : null;
    try {
      const r = await resolverConflito(env, resolver[1], acao, ator, nota);
      return r.ok ? json(r) : json({ erro: r.erro }, r.status);
    } catch (e) {
      return json({ erro: e instanceof ErroContaAzul ? e.message : "Falha ao resolver o conflito." }, 502);
    }
  }
  return json({ erro: "Rota da Conta Azul não encontrada." }, 404);
}
