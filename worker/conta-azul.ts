/**
 * Conta Azul — sincronização bidirecional das parcelas (API v2).
 *
 * O que a API permite e é usado aqui (docs/INTEGRACOES-MAPA.md):
 * - OAuth2 authorization code em login.contaazul.com; token em api-v2.contaazul.com/oauth/token
 *   com Basic(client_id:client_secret). Access token de 1 h; o refresh token MUDA a cada
 *   renovação e é gravado cifrado no cofre. Renovação serializada por trava no banco.
 * - POST contas-a-receber → 202 + protocolo (sem ID). O vínculo é confirmado lendo
 *   GET contas-a-receber/buscar (descrição com o marcador + vencimento) e a parcela.
 * - GET/PATCH parcelas/{id} (PATCH exige a versão atual).
 * - POST/GET parcelas/{id}/baixa e DELETE parcelas/baixa/{id}.
 * - GET eventos-financeiros/alteracoes (período) + GET {evento}/parcelas: polling.
 * O que a API NÃO permite: webhooks, cancelar/excluir evento, renegociar, ID externo.
 *
 * Regras:
 * - Sra Luck é a fonte de valor, vencimento e encargos.
 * - Baixa da Conta Azul só é aplicada sozinha com vínculo seguro (ver vinculoSeguroParaBaixa).
 * - Toda divergência vira conflito em integracao_conflitos; nada é sobrescrito em silêncio.
 * - Mutação financeira só por sessão humana do Admin (a guarda M2M do Dev Console não libera
 *   nenhuma rota daqui) ou pelo agendador autenticado.
 */
import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { isDevConsoleSyntheticAdminId } from "./dev-console-auth";
import { configDaFuncao, type ConfigContaAzul } from "./integracoes-registro";
import { obterCredencial, obterCredencialParaValidacao, salvarCredencialInterna } from "./integrations-credenciais";
import { criarState, validarState } from "./rd-station-readonly";
import { getCookie, verificarTokenAdmin } from "./session";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { calcularEncargosAtraso } from "../src/lib/financeiro/encargos";

type Json = Record<string, any>;
type Db = ReturnType<typeof createServiceSupabaseClient>;

export const CA_API = "https://api-v2.contaazul.com";
const CA_TOKEN = "https://api-v2.contaazul.com/oauth/token";
const CA_AUTHORIZE = "https://login.contaazul.com/#/oauth/authorize";
const PROVEDOR = "conta_azul";
const ORCAMENTO_MS = 20_000; // runtime edge: a resposta precisa começar em ~25 s

export class ErroContaAzul extends Error {
  constructor(public codigo: string, mensagem: string, public retentavel = false, public status = 0) { super(mensagem); }
}

// ------------------------------------------------------------------ dependências (injetáveis em teste)

export type Credenciais = { obter: (chave: string) => Promise<string | null>; salvar: (chave: string, valor: string, ator: string) => Promise<void> };
export type Deps = { db: Db; fetch: typeof fetch; credenciais: Credenciais; agora: () => Date; config?: ConfigContaAzul };

export function depsPadrao(env: Env, parcial: Partial<Deps> = {}): Deps {
  return {
    db: parcial.db ?? createServiceSupabaseClient(env),
    fetch: parcial.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a)),
    credenciais: parcial.credenciais ?? {
      obter: (chave) => obterCredencial(env, PROVEDOR, chave),
      salvar: (chave, valor, ator) => salvarCredencialInterna(env, PROVEDOR, chave, valor, ator),
    },
    agora: parcial.agora ?? (() => new Date()),
    config: parcial.config,
  };
}

async function configCa(env: Env, d: Deps) {
  return d.config ?? await configDaFuncao<ConfigContaAzul>(env, PROVEDOR, "sincronizacao", { db: d.db });
}

// ------------------------------------------------------------------ OAuth e token

function basic(clientId: string, clientSecret: string) {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

async function pedirToken(d: Deps, params: Record<string, string>) {
  const clientId = await d.credenciais.obter("client_id");
  const clientSecret = await d.credenciais.obter("client_secret");
  if (!clientId || !clientSecret) throw new ErroContaAzul("cliente_oauth_ausente", "Configure Client ID e Client Secret da Conta Azul no cofre.");
  const resposta = await d.fetch(CA_TOKEN, {
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

async function gravarTokens(d: Deps, t: { access: string; refresh: string; expiresIn: number }, ator: string) {
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
    return await gravarTokens(d, await pedirToken(d, { grant_type: "refresh_token", refresh_token: refresh }), ator);
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
  // A URL de autorização da Conta Azul é uma rota com # (SPA); os parâmetros vão depois dela.
  const q = `response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state)}&scope=openid+profile+aws.cognito.signin.user.admin`;
  return { url: `${CA_AUTHORIZE}?${q}`, redirectUri: redirect };
}

// ------------------------------------------------------------------ cliente HTTP

export async function caRequest(d: Deps, metodo: "GET" | "POST" | "PATCH" | "DELETE", caminho: string, corpo?: unknown): Promise<Json | Json[] | null> {
  let token = await tokenAtual(d);
  const executar = (t: string) => d.fetch(`${CA_API}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${t}`, Accept: "application/json", ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  let resposta: Response;
  try { resposta = await executar(token); } catch { throw new ErroContaAzul("rede", "Falha de rede ao falar com a Conta Azul.", true); }
  if (resposta.status === 401) {
    token = await renovarToken(d);
    try { resposta = await executar(token); } catch { throw new ErroContaAzul("rede", "Falha de rede ao falar com a Conta Azul.", true); }
  }
  const texto = await resposta.text();
  let dados: any = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = null; }
  if (resposta.ok) return dados;
  const detalhe = typeof dados?.message === "string" ? dados.message.slice(0, 200) : typeof dados?.error === "string" ? dados.error.slice(0, 200) : "";
  if (resposta.status === 404) throw new ErroContaAzul("nao_encontrado", "Registro não encontrado na Conta Azul.", false, 404);
  if (resposta.status === 429 || resposta.status >= 500) throw new ErroContaAzul("provedor_indisponivel", `Conta Azul HTTP ${resposta.status}. ${detalhe}`.trim(), true, resposta.status);
  if (resposta.status === 409) throw new ErroContaAzul("versao", `Versão desatualizada na Conta Azul. ${detalhe}`.trim(), true, 409);
  throw new ErroContaAzul("recusado", `Conta Azul recusou (HTTP ${resposta.status}). ${detalhe}`.trim(), false, resposta.status);
}

// ------------------------------------------------------------------ estados comparáveis

const centavos = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const dia = (v: unknown) => (v ? String(v).slice(0, 10) : null);

export type SraParcela = { valor: number; vencimento: string | null; status: string; dataPagamento: string | null };
export type CaParcela = { status: string; valorBruto: number; vencimento: string | null; valorPago: number; naoPago: number; versao: number | null; baixas: { id: string; dataPagamento: string | null; observacao: string; valor: number }[]; nota: string; descricao: string; eventoId: string | null };

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
    baixas: (Array.isArray(p.baixas) ? p.baixas : []).map((b: Json) => ({ id: String(b.id), dataPagamento: dia(b.data_pagamento), observacao: String(b.observacao || ""), valor: Number(b.valor_composicao?.valor_bruto ?? 0) })),
    nota: String(p.nota || ""),
    descricao: String(p.descricao || ""),
    eventoId: p.evento?.id ? String(p.evento.id) : null,
  };
}

export const marcadorDe = (boletoId: string) => `SLK-${boletoId.replace(/-/g, "").slice(0, 16).toUpperCase()}`;
const quitada = (c: CaParcela) => c.status === "QUITADO" || (c.valorPago > 0 && c.naoPago === 0 && c.status !== "RECEBIDO_PARCIAL");
const aberta = (c: CaParcela) => c.status === "PENDENTE" || c.status === "ATRASADO";

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
  if (!["nao_pago", "pendente_confirmacao"].includes(String(boleto.status))) motivos.push(`Parcela do Sra Luck está ${boleto.status}.`);
  if (boleto.suspensa) motivos.push("Parcela suspensa no Sra Luck.");
  return motivos;
}

// ------------------------------------------------------------------ fila, conflitos e vínculos

export async function enfileirar(db: Db, op: { operacao: string; referencia: string; chave: string; payload?: Json; atrasoMin?: number; ator?: string; maxTentativas?: number; agora?: Date }) {
  const { error } = await db.from("integracao_fila").insert({
    provedor: PROVEDOR, operacao: op.operacao, referencia: op.referencia, payload: op.payload ?? {}, chave_idempotencia: op.chave,
    proxima_tentativa_em: new Date((op.agora ?? new Date()).getTime() + (op.atrasoMin ?? 0) * 60_000).toISOString(), criado_por: op.ator ?? "sistema:conta_azul",
    ...(op.maxTentativas ? { max_tentativas: op.maxTentativas } : {}),
  });
  if (error && (error as { code?: string }).code !== "23505") throw new ErroContaAzul("fila", "Não foi possível enfileirar a operação.", true);
  return !error;
}

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
  const { data } = await db.from("conta_azul_vinculos").select("*, boletos(id,cliente_id,numero_parcela,total_parcelas,valor,data_vencimento,status,data_pagamento,observacoes,suspensa), clientes(nome_completo,cpf)").eq("boleto_id", boletoId).maybeSingle();
  if (!data) return null;
  const v = data as Json;
  const boleto = Array.isArray(v.boletos) ? v.boletos[0] : v.boletos;
  const cliente = Array.isArray(v.clientes) ? v.clientes[0] : v.clientes;
  return { v, boleto: boleto as Json | null, cliente: cliente as Json | null };
}

const agoraIso = (d: Deps) => d.agora().toISOString();

async function atualizarVinculo(d: Deps, id: string, patch: Json) {
  await d.db.from("conta_azul_vinculos").update({ ...patch, updated_at: agoraIso(d) }).eq("id", id);
}

async function lerParcela(d: Deps, parcelaId: string) {
  return caAtual(await caRequest(d, "GET", `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(parcelaId)}`) as Json);
}

// ------------------------------------------------------------------ operações

type Resultado = { reagendarMin?: number; nota?: string };

async function opCriar(env: Env, d: Deps, op: Json): Promise<Resultado> {
  const r = await vinculoComBoleto(d.db, op.referencia);
  if (!r || !r.boleto) return { nota: "Vínculo ou parcela não existe mais." };
  const { v, boleto, cliente } = r;
  if (v.ca_parcela_id) return { nota: "Já vinculada." };
  if (v.estado === "enviando" || v.estado === "aguardando_protocolo") {
    await enfileirar(d.db, { agora: d.agora(), operacao: "localizar", referencia: v.boleto_id, chave: `localizar:${v.boleto_id}` });
    return { nota: "Já enviada antes; localizando." };
  }
  const config = await configCa(env, d);
  if (!config.contaFinanceiraId) throw new ErroContaAzul("config", "Escolha a conta financeira da Conta Azul nas Integrações.");
  if (!v.ca_contato_id) throw new ErroContaAzul("contato", "Cliente sem pessoa correspondente na Conta Azul.");
  const s = sraAtual(boleto);
  const rotulo = `Parcela ${boleto.numero_parcela}/${boleto.total_parcelas || ""}`;
  const primeiroNome = String(cliente?.nome_completo || "Cliente").split(/\s+/)[0];
  const payload = {
    data_competencia: s.vencimento,
    valor: s.valor,
    observacao: `Sra. Luck ${v.marcador}`,
    descricao: `${rotulo} · ${primeiroNome} · ${v.marcador}`,
    contato: v.ca_contato_id,
    conta_financeira: config.contaFinanceiraId,
    rateio: config.categoriaId ? [{ id_categoria: config.categoriaId, valor: s.valor }] : [],
    condicao_pagamento: { parcelas: [{
      descricao: `${rotulo} ${v.marcador}`, data_vencimento: s.vencimento, nota: `Sra Luck ${v.marcador}`,
      conta_financeira: config.contaFinanceiraId,
      detalhe_valor: { valor_bruto: s.valor, valor_liquido: s.valor, multa: 0, juros: 0, desconto: 0, taxa: 0 },
      metodo_pagamento: config.metodoPagamento,
    }] },
  };
  // Marca ANTES de enviar: se cair no meio, a próxima tentativa localiza em vez de duplicar.
  await atualizarVinculo(d, v.id, { estado: "enviando", enviado_em: agoraIso(d), sra_snapshot: s, ultimo_erro: null });
  let resposta: Json;
  try {
    resposta = await caRequest(d, "POST", "/v1/financeiro/eventos-financeiros/contas-a-receber", payload) as Json;
  } catch (e) {
    const erro = e as ErroContaAzul;
    if (erro.retentavel) {
      await enfileirar(d.db, { agora: d.agora(), operacao: "localizar", referencia: v.boleto_id, chave: `localizar:${v.boleto_id}`, atrasoMin: 2 });
      return { nota: "Envio sem confirmação; o lançamento será procurado pelo marcador." };
    }
    await atualizarVinculo(d, v.id, { estado: "erro_criacao", ultimo_erro: erro.message });
    throw erro;
  }
  if (String(resposta?.status) === "ERROR") {
    await atualizarVinculo(d, v.id, { estado: "erro_criacao", protocolo: resposta?.protocolo ?? null, ultimo_erro: "Conta Azul devolveu protocolo com erro." });
    throw new ErroContaAzul("protocolo_erro", "A Conta Azul não criou o lançamento (protocolo com ERROR).");
  }
  await atualizarVinculo(d, v.id, { estado: "aguardando_protocolo", protocolo: resposta?.protocolo ?? null });
  await enfileirar(d.db, { agora: d.agora(), operacao: "localizar", referencia: v.boleto_id, chave: `localizar:${v.boleto_id}`, atrasoMin: 1 });
  return { nota: `Protocolo ${resposta?.protocolo ?? "—"} (${resposta?.status ?? "?"}).` };
}

async function opLocalizar(env: Env, d: Deps, op: Json): Promise<Resultado> {
  const r = await vinculoComBoleto(d.db, op.referencia);
  if (!r || !r.boleto) return { nota: "Vínculo não existe mais." };
  const { v } = r;
  if (v.ca_parcela_id) return { nota: "Já vinculada." };
  const venc = v.sra_snapshot?.vencimento ?? dia(r.boleto.data_vencimento);
  const q = new URLSearchParams({ pagina: "1", tamanho_pagina: "10", data_vencimento_de: venc, data_vencimento_ate: venc, descricao: v.marcador });
  const busca = await caRequest(d, "GET", `/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?${q}`) as Json;
  const candidatos = (Array.isArray(busca?.itens) ? busca.itens : []).filter((i: Json) => String(i.descricao || "").includes(v.marcador));
  if (candidatos.length === 0) throw new ErroContaAzul("ainda_nao_localizado", "Lançamento ainda não aparece na Conta Azul.", true);
  if (candidatos.length > 1) {
    await abrirConflito(d.db, { referencia: v.boleto_id, vinculoId: v.id, tipo: "marcador_duplicado", descricao: `Há ${candidatos.length} lançamentos com o marcador ${v.marcador} na Conta Azul. Nenhum foi vinculado.`, dadosExternos: { ids: candidatos.map((c: Json) => c.id) } });
    return { nota: "Mais de um lançamento com o marcador: conflito aberto." };
  }
  const id = String(candidatos[0].id);
  let parcela: CaParcela | null = null, parcelaId = id;
  try {
    parcela = await lerParcela(d, id);
  } catch (e) {
    if ((e as ErroContaAzul).codigo !== "nao_encontrado") throw e;
    // O id da busca pode ser do evento: procura a parcela com o marcador.
    const lista = await caRequest(d, "GET", `/v1/financeiro/eventos-financeiros/${encodeURIComponent(id)}/parcelas`) as Json[];
    const achada = (Array.isArray(lista) ? lista : []).find((p) => `${p.nota || ""} ${p.descricao || ""}`.includes(v.marcador));
    if (achada) { parcela = caAtual(achada); parcelaId = String(achada.id); }
  }
  if (!parcela || !`${parcela.nota} ${parcela.descricao}`.includes(v.marcador)) {
    await abrirConflito(d.db, { referencia: v.boleto_id, vinculoId: v.id, tipo: "nao_confirmado", descricao: "O lançamento encontrado não tem o marcador na parcela. Vínculo não confirmado.", dadosExternos: { id } });
    return { nota: "Parcela sem marcador: conflito aberto." };
  }
  await atualizarVinculo(d, v.id, { estado: "vinculado", ca_parcela_id: parcelaId, ca_evento_id: parcela.eventoId ?? id, ca_versao: parcela.versao, ca_snapshot: parcela, ultima_sincronizacao_em: agoraIso(d) });
  await d.db.from("logs_alteracoes").insert({ usuario: "sistema:conta_azul", acao: "vinculou_parcela_conta_azul", entidade: "boletos", entidade_id: v.boleto_id, detalhes: { marcador: v.marcador, caParcelaId: parcelaId, caEventoId: parcela.eventoId ?? id } });
  const enviado = v.sra_snapshot as SraParcela;
  if (enviado?.valor != null && (centavos(parcela.valorBruto) !== centavos(enviado.valor) || parcela.vencimento !== enviado.vencimento)) {
    await abrirConflito(d.db, { referencia: v.boleto_id, vinculoId: v.id, tipo: "divergente_na_criacao", descricao: "O lançamento vinculado tem valor ou vencimento diferente do enviado.", dadosSra: enviado, dadosExternos: parcela });
  }
  return { nota: `Vinculada à parcela ${parcelaId}.` };
}

async function opAtualizar(env: Env, d: Deps, op: Json): Promise<Resultado> {
  const r = await vinculoComBoleto(d.db, op.referencia);
  if (!r || !r.boleto || !r.v.ca_parcela_id) return { nota: "Sem vínculo confirmado." };
  const { v, boleto } = r;
  const s = sraAtual(boleto);
  if (s.status === "pago") return { nota: "Parcela já paga no Sra Luck; valor não é mais alterado." };
  const ca = await lerParcela(d, v.ca_parcela_id);
  const anterior = v.ca_snapshot as CaParcela;
  if (!aberta(ca)) {
    await abrirConflito(d.db, { referencia: v.boleto_id, vinculoId: v.id, tipo: "parcela_nao_editavel", descricao: `A parcela na Conta Azul está ${ca.status}; valor/vencimento do Sra Luck não foram enviados.`, dadosSra: s, dadosExternos: ca });
    return { nota: "Parcela não editável: conflito aberto." };
  }
  const mudouNaConta = anterior?.versao != null && (centavos(ca.valorBruto) !== centavos(anterior.valorBruto) || ca.vencimento !== anterior.vencimento);
  if (mudouNaConta && !op.payload?.forcar) {
    await abrirConflito(d.db, { referencia: v.boleto_id, vinculoId: v.id, tipo: "alterada_nos_dois_lados", descricao: "Valor ou vencimento mudou no Sra Luck e também na Conta Azul. Nada foi enviado.", dadosSra: s, dadosExternos: ca });
    return { nota: "Alterada nos dois lados: conflito aberto." };
  }
  const resposta = await caRequest(d, "PATCH", `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(v.ca_parcela_id)}`, {
    versao: ca.versao, vencimento: s.vencimento,
    composicao_valor: { valor_bruto: s.valor, valor_liquido: s.valor, multa: 0, juros: 0, desconto: 0, taxa: 0 },
  }) as Json;
  const novo = { ...ca, valorBruto: s.valor, vencimento: s.vencimento, versao: resposta?.versao ?? ca.versao };
  await atualizarVinculo(d, v.id, { ca_versao: novo.versao, ca_snapshot: novo, sra_snapshot: { ...(v.sra_snapshot ?? {}), valor: s.valor, vencimento: s.vencimento }, ultima_sincronizacao_em: agoraIso(d) });
  await d.db.from("logs_alteracoes").insert({ usuario: "sistema:conta_azul", acao: "atualizou_parcela_conta_azul", entidade: "boletos", entidade_id: v.boleto_id, detalhes: { valor: s.valor, vencimento: s.vencimento, forcado: Boolean(op.payload?.forcar) } });
  return { nota: `Valor ${s.valor.toFixed(2)} e vencimento ${s.vencimento} enviados.` };
}

async function opBaixar(env: Env, d: Deps, op: Json): Promise<Resultado> {
  const r = await vinculoComBoleto(d.db, op.referencia);
  if (!r || !r.boleto || !r.v.ca_parcela_id) return { nota: "Sem vínculo confirmado." };
  const { v, boleto } = r;
  const s = sraAtual(boleto);
  if (s.status !== "pago") return { nota: "A parcela não está mais paga no Sra Luck; baixa não enviada." };
  const config = await configCa(env, d);
  if (!config.contaFinanceiraId) throw new ErroContaAzul("config", "Escolha a conta financeira da Conta Azul nas Integrações.");
  const ca = await lerParcela(d, v.ca_parcela_id);
  // Idempotência: baixa com o marcador já existe (tentativa anterior chegou lá).
  const nossa = ca.baixas.find((b) => b.id === v.ca_baixa_id || b.observacao.includes(v.marcador));
  if (nossa) {
    await atualizarVinculo(d, v.id, { ca_baixa_id: nossa.id, baixa_origem: "sra", ca_snapshot: ca, sra_snapshot: { ...(v.sra_snapshot ?? {}), status: "pago", dataPagamento: s.dataPagamento } });
    return { nota: "Baixa já existia na Conta Azul." };
  }
  if (quitada(ca)) {
    await atualizarVinculo(d, v.id, { ca_baixa_id: ca.baixas.at(-1)?.id ?? null, baixa_origem: "conta_azul", ca_snapshot: ca, sra_snapshot: { ...(v.sra_snapshot ?? {}), status: "pago", dataPagamento: s.dataPagamento } });
    return { nota: "A parcela já estava quitada na Conta Azul; nada enviado." };
  }
  if (!aberta(ca)) {
    await abrirConflito(d.db, { referencia: v.boleto_id, vinculoId: v.id, tipo: "baixa_nao_enviada", descricao: `Paga no Sra Luck, mas a parcela na Conta Azul está ${ca.status}.`, dadosSra: s, dadosExternos: ca });
    return { nota: "Conflito aberto." };
  }
  const pagoEm = s.dataPagamento ?? agoraIso(d).slice(0, 10);
  const enc = calcularEncargosAtraso(s.valor, s.vencimento ?? pagoEm, pagoEm);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const resposta = await caRequest(d, "POST", `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(v.ca_parcela_id)}/baixa`, {
    data_pagamento: pagoEm,
    composicao_valor: { valor_bruto: s.valor, juros: r2(enc.juros), multa: r2(enc.multa), desconto: 0, taxa: 0 },
    conta_financeira: config.contaFinanceiraId,
    metodo_pagamento: config.metodoPagamento,
    observacao: `Sra Luck ${v.marcador} baixa`,
  }) as Json;
  await atualizarVinculo(d, v.id, { ca_baixa_id: resposta?.id ?? null, baixa_origem: "sra", ca_snapshot: { ...ca, status: "QUITADO" }, sra_snapshot: { ...(v.sra_snapshot ?? {}), status: "pago", dataPagamento: pagoEm }, ultima_sincronizacao_em: agoraIso(d) });
  await d.db.from("logs_alteracoes").insert({ usuario: "sistema:conta_azul", acao: "enviou_baixa_conta_azul", entidade: "boletos", entidade_id: v.boleto_id, detalhes: { caBaixaId: resposta?.id ?? null, dataPagamento: pagoEm, juros: r2(enc.juros), multa: r2(enc.multa) } });
  return { nota: `Baixa ${resposta?.id ?? ""} registrada na Conta Azul.` };
}

async function opEstornar(env: Env, d: Deps, op: Json): Promise<Resultado> {
  const r = await vinculoComBoleto(d.db, op.referencia);
  if (!r || !r.boleto || !r.v.ca_parcela_id) return { nota: "Sem vínculo confirmado." };
  const { v, boleto } = r;
  const s = sraAtual(boleto);
  if (s.status === "pago") return { nota: "A parcela voltou a ficar paga no Sra Luck; estorno cancelado." };
  if (v.baixa_origem !== "sra" || !v.ca_baixa_id) {
    await abrirConflito(d.db, { referencia: v.boleto_id, vinculoId: v.id, tipo: "estorno_de_baixa_externa", descricao: "A baixa foi desfeita no Sra Luck, mas ela veio da Conta Azul. O Sra Luck não apaga baixa que não criou.", dadosSra: s, dadosExternos: v.ca_snapshot });
    return { nota: "Conflito aberto." };
  }
  try {
    await caRequest(d, "DELETE", `/v1/financeiro/eventos-financeiros/parcelas/baixa/${encodeURIComponent(v.ca_baixa_id)}`);
  } catch (e) {
    if ((e as ErroContaAzul).codigo !== "nao_encontrado") throw e;
  }
  const ca = await lerParcela(d, v.ca_parcela_id).catch(() => null);
  await atualizarVinculo(d, v.id, { ca_baixa_id: null, baixa_origem: null, ca_snapshot: ca ?? v.ca_snapshot, sra_snapshot: { ...(v.sra_snapshot ?? {}), status: s.status, dataPagamento: null }, ultima_sincronizacao_em: agoraIso(d) });
  await d.db.from("logs_alteracoes").insert({ usuario: "sistema:conta_azul", acao: "estornou_baixa_conta_azul", entidade: "boletos", entidade_id: v.boleto_id, detalhes: { caBaixaId: v.ca_baixa_id } });
  return { nota: "Baixa removida da Conta Azul." };
}

const OPERACOES: Record<string, (env: Env, d: Deps, op: Json) => Promise<Resultado>> = {
  criar_receber: opCriar, localizar: opLocalizar, atualizar_parcela: opAtualizar, registrar_baixa: opBaixar, estornar_baixa: opEstornar,
};

/** Processa a fila dentro do orçamento de tempo. Retentativa com espera exponencial. */
export async function processarFila(env: Env, d: Deps, limite = 30, prazo = Date.now() + ORCAMENTO_MS) {
  const { data } = await d.db.from("integracao_fila").select("*").eq("provedor", PROVEDOR).eq("estado", "pendente")
    .lte("proxima_tentativa_em", agoraIso(d)).order("created_at", { ascending: true }).limit(limite);
  const res = { processadas: 0, concluidas: 0, reagendadas: 0, erros: 0 };
  for (const op of (data ?? []) as Json[]) {
    if (Date.now() > prazo) break;
    const { data: pegou } = await d.db.from("integracao_fila").update({ estado: "processando", tentativas: Number(op.tentativas) + 1, updated_at: agoraIso(d) })
      .eq("id", op.id).eq("estado", "pendente").select("id").maybeSingle();
    if (!pegou) continue;
    res.processadas++;
    const tentativa = Number(op.tentativas) + 1;
    try {
      const executar = OPERACOES[op.operacao];
      if (!executar) throw new ErroContaAzul("operacao", `Operação desconhecida: ${op.operacao}.`);
      const r = await executar(env, d, op);
      await d.db.from("integracao_fila").update({ estado: "concluida", ultimo_erro: r.nota ?? null, concluida_em: agoraIso(d), updated_at: agoraIso(d) }).eq("id", op.id);
      res.concluidas++;
    } catch (e) {
      const erro = e instanceof ErroContaAzul ? e : new ErroContaAzul("inesperado", "Falha inesperada.", true);
      if (erro.retentavel && tentativa < Number(op.max_tentativas || 6)) {
        const espera = Math.min(360, 2 ** tentativa);
        await d.db.from("integracao_fila").update({ estado: "pendente", ultimo_erro: erro.message, proxima_tentativa_em: new Date(d.agora().getTime() + espera * 60_000).toISOString(), updated_at: agoraIso(d) }).eq("id", op.id);
        res.reagendadas++;
      } else {
        await d.db.from("integracao_fila").update({ estado: "erro", ultimo_erro: erro.message, updated_at: agoraIso(d) }).eq("id", op.id);
        res.erros++;
        if (op.operacao === "localizar" && erro.codigo === "ainda_nao_localizado") {
          await abrirConflito(d.db, { referencia: op.referencia, vinculoId: null, tipo: "nao_localizado", descricao: "O lançamento enviado não apareceu na Conta Azul depois de várias buscas. Confira antes de reenviar para não duplicar." });
        }
      }
    }
  }
  return res;
}

// ------------------------------------------------------------------ detecção Sra Luck → Conta Azul

export async function detectarMudancasSra(env: Env, d: Deps) {
  const config = await configCa(env, d);
  const { data } = await d.db.from("conta_azul_vinculos").select("id,boleto_id,sra_snapshot,ca_baixa_id,baixa_origem,boletos(valor,data_vencimento,status,data_pagamento)").eq("estado", "vinculado").limit(2000);
  let enfileiradas = 0;
  for (const v of (data ?? []) as Json[]) {
    const b = Array.isArray(v.boletos) ? v.boletos[0] : v.boletos;
    if (!b) continue;
    const s = sraAtual(b), snap = (v.sra_snapshot ?? {}) as Partial<SraParcela>;
    if (config.enviarAlteracoes && s.status !== "pago" && (centavos(s.valor) !== centavos(snap.valor) || s.vencimento !== snap.vencimento)) {
      if (await enfileirar(d.db, { agora: d.agora(), operacao: "atualizar_parcela", referencia: v.boleto_id, chave: `atualizar:${v.boleto_id}:${s.valor}:${s.vencimento}` })) enfileiradas++;
    }
    if (config.enviarBaixas && s.status === "pago" && snap.status !== "pago") {
      if (await enfileirar(d.db, { agora: d.agora(), operacao: "registrar_baixa", referencia: v.boleto_id, chave: `baixa:${v.boleto_id}:${s.dataPagamento}` })) enfileiradas++;
    }
    if (config.enviarBaixas && s.status !== "pago" && snap.status === "pago") {
      if (await enfileirar(d.db, { agora: d.agora(), operacao: "estornar_baixa", referencia: v.boleto_id, chave: `estorno:${v.boleto_id}:${v.ca_baixa_id ?? "externa"}:${snap.dataPagamento ?? ""}` })) enfileiradas++;
    }
  }
  return { enfileiradas };
}

// ------------------------------------------------------------------ leitura Conta Azul → Sra Luck

/** Data/hora de Brasília sem fuso, como a API pede (ISO 8601, São Paulo/GMT-3). */
export function horaSaoPaulo(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

async function aplicarBaixaDaConta(d: Deps, v: Json, boleto: Json, ca: CaParcela, ator: string) {
  const baixa = ca.baixas.at(-1)!;
  const marcador = `[Conta Azul baixa ${baixa.id}]`;
  const obs = String(boleto.observacoes || "");
  const { data } = await d.db.from("boletos").update({
    status: "pago",
    data_pagamento: baixa.dataPagamento ?? agoraIso(d).slice(0, 10),
    observacoes: obs.includes(marcador) ? obs : [obs, `${marcador} Baixa registrada na Conta Azul.`].filter(Boolean).join("\n"),
  }).eq("id", boleto.id).in("status", ["nao_pago", "pendente_confirmacao", "rejeitado"]).select("id").maybeSingle();
  if (!data) return false;
  await atualizarVinculo(d, v.id, { ca_baixa_id: baixa.id, baixa_origem: "conta_azul", ca_snapshot: ca, ca_versao: ca.versao, sra_snapshot: { ...(v.sra_snapshot ?? {}), status: "pago", dataPagamento: baixa.dataPagamento }, ultima_sincronizacao_em: agoraIso(d) });
  await d.db.from("logs_alteracoes").insert({ usuario: ator, acao: "baixa_vinda_da_conta_azul", entidade: "boletos", entidade_id: boleto.id, detalhes: { caBaixaId: baixa.id, dataPagamento: baixa.dataPagamento, valor: ca.valorBruto, automatica: ator === "sistema:conta_azul" } });
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
    if (s.status !== "pago" && !nossa) {
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

export async function sincronizarContaAzul(env: Env, opcoes: { origem: "manual" | "agendada"; ator: string }, parcial: Partial<Deps> = {}) {
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
    resumo.envio = await detectarMudancasSra(env, d);
    resumo.leitura = await lerMudancasContaAzul(env, d, prazo);
    resumo.fila = await processarFila(env, d, 40, prazo);
    if (resumo.fila.erros) status = "parcial";
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

async function pessoaPorCpf(d: Deps, cpf: string) {
  const r = await caRequest(d, "GET", `/v1/pessoas?${new URLSearchParams({ pagina: "1", tamanho_pagina: "10", documentos: cpf })}`) as Json;
  const itens: Json[] = Array.isArray(r) ? r : Array.isArray(r?.itens) ? r.itens : Array.isArray(r?.items) ? r.items : [];
  return itens.filter((p) => String(p.documento || "").replace(/\D/g, "") === cpf);
}

export async function enviarParcelasCliente(env: Env, clienteId: string, ator: string, parcial: Partial<Deps> = {}) {
  const d = depsPadrao(env, parcial);
  const config = await configCa(env, d);
  if (!config.contaFinanceiraId) return { ok: false as const, status: 409, erro: "Escolha a conta financeira da Conta Azul antes de enviar." };
  const { data: cliente } = await d.db.from("clientes").select("id,nome_completo,cpf").eq("id", clienteId).maybeSingle();
  if (!cliente) return { ok: false as const, status: 404, erro: "Cliente não encontrada." };
  const cpf = String((cliente as Json).cpf || "").replace(/\D/g, "");
  if (cpf.length !== 11) return { ok: false as const, status: 409, erro: "Cliente sem CPF válido: não dá para achar a pessoa na Conta Azul." };
  let pessoas: Json[];
  try { pessoas = await pessoaPorCpf(d, cpf); } catch (e) { return { ok: false as const, status: 502, erro: (e as Error).message }; }
  if (pessoas.length === 0) return { ok: false as const, status: 409, erro: "Não há pessoa com esse CPF na Conta Azul. Cadastre a cliente lá e tente de novo." };
  if (pessoas.length > 1) return { ok: false as const, status: 409, erro: "Há mais de uma pessoa com esse CPF na Conta Azul. Resolva a duplicidade lá antes." };
  const contato = String(pessoas[0].id);
  const { data: boletos } = await d.db.from("boletos").select("id,status").eq("cliente_id", clienteId);
  const { data: existentes } = await d.db.from("conta_azul_vinculos").select("boleto_id").eq("cliente_id", clienteId);
  const ja = new Set(((existentes ?? []) as Json[]).map((x) => x.boleto_id));
  const novos = ((boletos ?? []) as Json[]).filter((b) => !ja.has(b.id) && b.status !== "pago");
  for (const b of novos) {
    const { error } = await d.db.from("conta_azul_vinculos").insert({ boleto_id: b.id, cliente_id: clienteId, marcador: marcadorDe(b.id), ca_contato_id: contato, criado_por: ator });
    if (!error) await enfileirar(d.db, { agora: d.agora(), operacao: "criar_receber", referencia: b.id, chave: `criar:${b.id}`, ator });
  }
  await d.db.from("logs_alteracoes").insert({ usuario: ator, acao: "enviou_parcelas_conta_azul", entidade: "clientes", entidade_id: clienteId, detalhes: { parcelas: novos.length, jaVinculadas: ja.size, pagasNaoEnviadas: ((boletos ?? []) as Json[]).filter((b) => b.status === "pago" && !ja.has(b.id)).length } });
  const fila = novos.length ? await processarFila(env, d, 12) : null;
  return { ok: true as const, enfileiradas: novos.length, jaVinculadas: ja.size, fila };
}

export async function vincularExistente(env: Env, boletoId: string, caParcelaId: string, ator: string, parcial: Partial<Deps> = {}) {
  const d = depsPadrao(env, parcial);
  if (!/^[0-9a-f-]{36}$/i.test(caParcelaId)) return { ok: false as const, status: 400, erro: "ID da parcela na Conta Azul inválido." };
  const { data: boleto } = await d.db.from("boletos").select("id,cliente_id,valor,data_vencimento,status,data_pagamento").eq("id", boletoId).maybeSingle();
  if (!boleto) return { ok: false as const, status: 404, erro: "Parcela não encontrada." };
  const { data: usado } = await d.db.from("conta_azul_vinculos").select("id,boleto_id").or(`boleto_id.eq.${boletoId},ca_parcela_id.eq.${caParcelaId}`).limit(1);
  if (usado && usado.length) return { ok: false as const, status: 409, erro: "Esta parcela (ou o lançamento da Conta Azul) já tem vínculo." };
  let ca: CaParcela;
  try { ca = await lerParcela(d, caParcelaId); } catch (e) { return { ok: false as const, status: 502, erro: (e as Error).message }; }
  const b = boleto as Json, s = sraAtual(b);
  const bate = centavos(ca.valorBruto) === centavos(s.valor) && ca.vencimento === s.vencimento;
  // Base = o que a Conta Azul tem: a diferença de status (ex.: pago só no Sra Luck) é enviada no próximo ciclo.
  const base: SraParcela = { valor: ca.valorBruto, vencimento: ca.vencimento, status: quitada(ca) ? "pago" : "nao_pago", dataPagamento: ca.baixas.at(-1)?.dataPagamento ?? null };
  const { data: v, error } = await d.db.from("conta_azul_vinculos").insert({
    boleto_id: boletoId, cliente_id: b.cliente_id, marcador: marcadorDe(boletoId), estado: bate ? "vinculado" : "conflito",
    ca_parcela_id: caParcelaId, ca_evento_id: ca.eventoId, ca_versao: ca.versao, ca_snapshot: ca, sra_snapshot: base,
    ca_baixa_id: quitada(ca) ? ca.baixas.at(-1)?.id ?? null : null, baixa_origem: quitada(ca) ? "conta_azul" : null,
    ultima_sincronizacao_em: agoraIso(d), criado_por: ator,
  }).select("id").single();
  if (error || !v) return { ok: false as const, status: 409, erro: "Não foi possível gravar o vínculo." };
  if (!bate) await abrirConflito(d.db, { referencia: boletoId, vinculoId: (v as Json).id, tipo: "vinculo_divergente", descricao: "Vínculo manual com valor ou vencimento diferentes. Nada foi enviado.", dadosSra: s, dadosExternos: ca });
  await d.db.from("logs_alteracoes").insert({ usuario: ator, acao: "vinculou_lancamento_existente_conta_azul", entidade: "boletos", entidade_id: boletoId, detalhes: { caParcelaId, bate } });
  return { ok: true as const, vinculado: bate, conflito: !bate };
}

export const ACOES_CONFLITO = ["aplicar_sra", "aplicar_baixa_conta_azul", "estornar_no_sra", "manter", "desvincular"] as const;
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
  if (acao === "aplicar_sra") {
    if (!v?.ca_parcela_id) return { ok: false as const, status: 409, erro: "Vínculo sem parcela confirmada." };
    await atualizarVinculo(d, v.id, { estado: "vinculado" });
    const s = sraAtual(boleto!);
    if (s.status === "pago") await enfileirar(d.db, { agora: d.agora(), operacao: "registrar_baixa", referencia: v.boleto_id, chave: `baixa:${v.boleto_id}:${s.dataPagamento}:resolucao:${id}`, ator });
    else await enfileirar(d.db, { agora: d.agora(), operacao: "atualizar_parcela", referencia: v.boleto_id, chave: `atualizar:${v.boleto_id}:resolucao:${id}`, payload: { forcar: true }, ator });
  } else if (acao === "aplicar_baixa_conta_azul") {
    if (!v?.ca_parcela_id) return { ok: false as const, status: 409, erro: "Vínculo sem parcela confirmada." };
    const ca = await lerParcela(d, v.ca_parcela_id);
    if (!quitada(ca) || !ca.baixas.length) return { ok: false as const, status: 409, erro: `A parcela não está quitada na Conta Azul agora (${ca.status}).` };
    if (!(await aplicarBaixaDaConta(d, v, boleto!, ca, ator))) return { ok: false as const, status: 409, erro: "A parcela do Sra Luck não está em aberto." };
  } else if (acao === "estornar_no_sra") {
    if (boleto!.status !== "pago") return { ok: false as const, status: 409, erro: "A parcela do Sra Luck não está paga." };
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
  const contar = async (tabela: "conta_azul_vinculos" | "integracao_fila", valores: string[]) => Object.fromEntries(await Promise.all(valores.map(async (e) => {
    let q = d.db.from(tabela).select("id", { count: "exact", head: true }).eq("estado", e);
    if (tabela === "integracao_fila") q = q.eq("provedor", PROVEDOR);
    const { count, error } = await q;
    return [e, error ? null : count ?? 0];
  })));
  const estrutura = await d.db.from("conta_azul_vinculos").select("id", { count: "exact", head: true });
  return {
    estruturaAplicada: !estrutura.error,
    conexao: { clientConfigurado: Boolean(clientId), autorizada: Boolean(refresh), tokenManual: Boolean(token && !refresh), expiraEm: expira ?? null },
    config: cfg,
    vinculos: await contar("conta_azul_vinculos", ["aguardando_criacao", "enviando", "aguardando_protocolo", "vinculado", "conflito", "erro_criacao", "desvinculado"]),
    fila: await contar("integracao_fila", ["pendente", "processando", "erro"]),
    conflitosAbertos: (await d.db.from("integracao_conflitos").select("id", { count: "exact", head: true }).eq("provedor", PROVEDOR).eq("estado", "aberto")).count ?? null,
    ultimaSincronizacao: (eventos.data ?? [])[0] ?? null,
    cursorAlteracoes: (cursor.data as Json | null)?.valor ?? null,
  };
}

export async function listar(d: Deps, tipo: "vinculos" | "fila" | "conflitos" | "historico", filtro: string | null) {
  if (tipo === "vinculos") {
    let q = d.db.from("conta_azul_vinculos").select("id,boleto_id,cliente_id,marcador,estado,ca_parcela_id,ca_evento_id,baixa_origem,ultima_sincronizacao_em,ultimo_erro,updated_at,boletos(numero_parcela,total_parcelas,valor,data_vencimento,status),clientes(nome_completo)").order("updated_at", { ascending: false }).limit(300);
    if (filtro) q = q.eq("estado", filtro);
    return (await q).data ?? [];
  }
  if (tipo === "fila") {
    let q = d.db.from("integracao_fila").select("id,operacao,referencia,estado,tentativas,max_tentativas,proxima_tentativa_em,ultimo_erro,criado_por,created_at,concluida_em").eq("provedor", PROVEDOR).order("created_at", { ascending: false }).limit(200);
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

export async function opcoesContaAzul(d: Deps) {
  const contas = await caRequest(d, "GET", `/v1/conta-financeira?${new URLSearchParams({ pagina: "1", tamanho_pagina: "100", apenas_ativo: "true" })}`) as Json;
  const categorias = await caRequest(d, "GET", `/v1/categorias?${new URLSearchParams({ pagina: "1", tamanho_pagina: "200", tipo: "RECEITA", permite_apenas_filhos: "false" })}`).catch(() => ({ itens: [] })) as Json;
  return {
    contas: (Array.isArray(contas?.itens) ? contas.itens : []).map((c: Json) => ({ id: String(c.id), nome: String(c.nome || c.id), tipo: c.tipo ?? null })),
    categorias: (Array.isArray(categorias?.itens) ? categorias.itens : []).map((c: Json) => ({ id: String(c.id), nome: String(c.nome || c.id) })),
  };
}

// ------------------------------------------------------------------ rotas

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
function sameOrigin(request: Request) {
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

async function exigir(request: Request, env: Env, permissoes: string[]) {
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
  if (path === "/api/integrations/conta-azul/oauth/callback" && request.method === "GET") return oauthCallback(request, env);
  if (!path.startsWith("/api/admin/integrations/conta-azul/")) return null;
  const rota = path.slice("/api/admin/integrations/conta-azul/".length);
  const d = depsPadrao(env);

  if (request.method === "GET") {
    const auth = await exigir(request, env, [PERMISSOES_ADMIN.INTEGRACOES_OPERAR_FINANCEIRO]);
    if (auth instanceof Response) return auth;
    if (rota === "painel") return json(await painel(env, d));
    if (rota === "vinculos" || rota === "fila" || rota === "conflitos" || rota === "historico") return json({ itens: await listar(d, rota, url.searchParams.get("estado")) });
    if (rota === "opcoes") { try { return json(await opcoesContaAzul(d)); } catch (e) { return json({ erro: (e as Error).message }, 502); } }
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
  // Mutações financeiras: nunca pela identidade técnica do Dev Console.
  if (isDevConsoleSyntheticAdminId(auth.adminId)) return json({ erro: "Operações da Conta Azul são feitas no Admin do Sra Luck." }, 403);
  const ator = auth.colaboradorId;

  if (rota === "sincronizar") return json(await sincronizarContaAzul(env, { origem: "manual", ator }));
  if (rota === "enviar-cliente") {
    const r = await enviarParcelasCliente(env, String(body.clienteId || ""), ator);
    return r.ok ? json(r) : json({ erro: r.erro }, r.status);
  }
  if (rota === "vincular") {
    const r = await vincularExistente(env, String(body.boletoId || ""), String(body.contaAzulParcelaId || ""), ator);
    return r.ok ? json(r) : json({ erro: r.erro }, r.status);
  }
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
  const reprocessar = rota.match(/^fila\/([0-9a-f-]{36})\/reprocessar$/);
  if (reprocessar) {
    const { data } = await d.db.from("integracao_fila").update({ estado: "pendente", tentativas: 0, proxima_tentativa_em: agoraIso(d), updated_at: agoraIso(d) })
      .eq("id", reprocessar[1]).eq("provedor", PROVEDOR).eq("estado", "erro").select("id,operacao,referencia").maybeSingle();
    if (!data) return json({ erro: "Operação não encontrada ou não está em erro." }, 409);
    await d.db.from("logs_alteracoes").insert({ usuario: ator, acao: "reprocessou_fila_conta_azul", entidade: "integracoes", entidade_id: reprocessar[1], detalhes: data });
    return json({ ok: true, fila: await processarFila(env, d, 5) });
  }
  return json({ erro: "Rota da Conta Azul não encontrada." }, 404);
}
