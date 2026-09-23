/**
 * Mensagem do dia da Início (uma única mensagem por data, igual para todas as clientes).
 *
 * Fluxo:
 *   Vercel Cron (vercel.json, 00:05 de Brasília) → GET /api/cron/mensagem-do-dia
 *     → já existe mensagem de hoje? reutiliza, sem chamar o Gemini;
 *     → não existe: reserva a data, chama o Gemini UMA vez, valida e salva
 *       (tabela mensagens_do_dia, migration 080);
 *     → Gemini falhou/sem chave/texto reprovado: salva a frase de reserva do
 *       catálogo (src/lib/fraseDoDia.ts) ou, se ela repetir a de ontem, a
 *       última mensagem válida.
 *   App → GET /api/cliente/frase-do-dia → só LÊ a mensagem salva. Nunca chama
 *   o Gemini. Se a rotina ainda não rodou hoje, mostra a frase do catálogo.
 *
 * Privacidade: o prompt leva só a data, o tema do dia e as mensagens recentes.
 * Nenhum dado de cliente (nome, CPF, nascimento, financeiro, médico) é enviado.
 *
 * Configuração (variáveis de ambiente; chave e modelo também pelo cofre em
 * Admin → Integrações → Gemini):
 *   GEMINI_API_KEY  chave do Google AI Studio (plano gratuito);
 *   GEMINI_MODEL    modelo (padrão gemini-3.5-flash-lite);
 *   GEMINI_PROMPT   substitui as instruções de estilo do prompt padrão;
 *   CRON_SECRET     se definido, a rotina exige "Authorization: Bearer <CRON_SECRET>"
 *                   (o Vercel Cron envia sozinho).
 */
import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { obterCredencial } from "./integrations-credenciais";
import { getCookie, verificarTokenAdmin } from "./session";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { requestLogger } from "./logger";
import { DATAS_ESPECIAIS, TEMAS_SEMANA, fraseDoDia, type FraseDoDia } from "../src/lib/fraseDoDia";

const MODELO_PADRAO = "gemini-3.5-flash-lite";
/** Máximo de chamadas de geração numa execução (só passa ao próximo modelo se o anterior falhar). */
const MAX_TENTATIVAS = 3;
const TIMEOUT_MS = 12_000;
/** Reserva "gerando" abandonada (execução interrompida) pode ser retomada após este prazo. */
const RESERVA_EXPIRA_MS = 5 * 60_000;

export const PROMPT_PADRAO = [
  "Você é a redatora oficial da Sra. Luck Cirurgia Programada, de Brasília.",
  "A Sra. Luck não é clínica: ajuda mulheres a realizar o sonho da cirurgia plástica com planejamento, parcelas que cabem no bolso e acompanhamento em cada etapa. Lema: \"Não vendemos promessas. Nós construímos caminhos.\"",
  "Escreva a mensagem do dia que TODAS as clientes verão no app. Tom: curto, positivo, acolhedor e profissional. Temas: planejamento, constância, confiança e acompanhamento da jornada. Fale no feminino, usando \"você\".",
  "Regras:",
  "- Uma única frase de até 120 caracteres, em português do Brasil, com pontuação correta.",
  "- Marque UM trecho de destaque (2 a 6 palavras) entre asteriscos, por exemplo: Disciplina hoje, *resultados sempre*.",
  "- No máximo 1 emoji, só se combinar; pode não usar nenhum.",
  "- Não use nomes de pessoas, não fale de corpo, peso, medidas ou aparência, não prometa resultado estético, não use termos médicos, medo, culpa, cobrança, dívida, juros ou descontos, nem hashtags, aspas ou datas numéricas.",
  "- Não repita as ideias nem a estrutura das mensagens recentes.",
].join("\n");

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();

// Temas proibidos pelo tom da marca: corpo/estética, promessa de resultado,
// cobrança/financeiro agressivo e termos médicos.
const PROIBIDAS = [
  /\bgarant\w*/, /\bemagre\w*/, /\bgord\w*/, /\bmagr[ao]s?\b/, /\bpeso\b/, /\bbarriga\b/, /\bperfeit\w*/,
  /\bdefeito\w*/, /\bfeia\b/, /\bjuros\b/, /\bdesconto\w*/, /\bpromoc\w*/, /\bgratis\b/, /\bmedic\w*/,
  /\bcura\b/, /\bdieta\b/, /\bmedidas\b/, /\bdivida\w*/, /\batras\w* (no|na|de) pagamento/, /\bcobranc\w*/,
];

export type ValidacaoFrase = { ok: true; texto: string } | { ok: false; motivo: string };

/** Guardrails do texto vindo da IA. `recentes` = mensagens dos últimos dias (a primeira é a de ontem). */
export function validarFraseIa(bruto: string, recentes: string[] = []): ValidacaoFrase {
  const texto = String(bruto ?? "").trim().replace(/^["“”']+|["“”']+$/g, "").replace(/\s+/g, " ").trim();
  const emojis = texto.match(/\p{Extended_Pictographic}/gu) ?? [];
  const semMarcas = texto.replace(/\*/g, "").replace(/\p{Extended_Pictographic}|️/gu, "").trim();
  if (semMarcas.length < 20 || semMarcas.length > 170) return { ok: false, motivo: "tamanho" };
  if ((texto.match(/\*/g) ?? []).length !== 2 || !/\*[^*\s][^*]*\*/.test(texto)) return { ok: false, motivo: "destaque" };
  if (emojis.length > 1) return { ok: false, motivo: "emoji" };
  if (/[\n#@<>{}]|https?:|www\./i.test(texto)) return { ok: false, motivo: "caractere" };
  const norm = normalizar(texto);
  if (PROIBIDAS.some((re) => re.test(norm))) return { ok: false, motivo: "termo_proibido" };
  const catalogo = [...TEMAS_SEMANA.flatMap((t) => t.frases), ...DATAS_ESPECIAIS.map((e) => e.texto)];
  if ([...recentes, ...catalogo].some((r) => normalizar(r) === norm)) return { ok: false, motivo: "repetida" };
  return { ok: true, texto };
}

function dataPorExtenso(agora: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" }).format(agora);
}

/** Prompt sem nenhum dado de cliente: data, tema do dia e mensagens recentes. */
export function montarPrompt(agora: Date, base: FraseDoDia, recentes: string[], instrucoes: string = PROMPT_PADRAO) {
  const especial = base.origem === "especial" ? `Hoje é data especial: ${base.tema}. Celebre com delicadeza.` : "";
  const mes = base.origem === "mes" ? "Hoje é o primeiro dia do mês: fale de começo de ciclo." : "";
  const temaSemana = TEMAS_SEMANA[new Date(`${base.data}T12:00:00Z`).getUTCDay()].tema;
  const exemplos = TEMAS_SEMANA.map((t) => t.frases[0]);
  const usuario = [
    `Data: ${dataPorExtenso(agora)}.`,
    `Tema do dia: ${temaSemana}.`,
    especial,
    mes,
    `Exemplos do tom da marca (não copie): ${exemplos.join(" | ")}`,
    recentes.length ? `Mensagens recentes, que você não pode repetir: ${recentes.join(" | ")}` : "",
  ].filter(Boolean).join("\n");
  const sistema = `${instrucoes.trim()}\nResponda somente com o JSON {"texto": "..."}.`;
  return { sistema, usuario };
}

type RespostaGemini = { candidates?: { content?: { parts?: { text?: string }[] } }[] };

export class ErroGemini extends Error {
  constructor(public motivo: string, public tentativas: string[]) { super(motivo); }
}

const NAO_TEXTO = /(image|tts|live|audio|transcri|embedding|translate|omni|robotic|computer|vision|aqa|thinking)/;

function versao(modelo: string) {
  const m = modelo.match(/gemini-(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

/** Ordena modelos de texto "flash": leves estáveis, flash estáveis, apelidos -latest, prévias; mais novo antes. */
export function ordenarModelos(nomes: string[]) {
  const candidatos = [...new Set(nomes.map((n) => n.replace(/^models\//, "")))]
    .filter((n) => /^gemini-/.test(n) && /flash/.test(n) && !NAO_TEXTO.test(n));
  const grupo = (n: string) => {
    if (/preview|exp/.test(n) || /-\d{2,}$/.test(n)) return 4;
    if (/latest/.test(n)) return 3;
    return /lite/.test(n) ? 1 : 2;
  };
  return candidatos.sort((a, b) => grupo(a) - grupo(b) || versao(b) - versao(a) || a.localeCompare(b));
}

/** Lista (ListModels) os modelos que a chave pode usar. Usada só quando o modelo configurado falha. */
export async function descobrirModelos(chave: string, fetcher: typeof fetch = fetch): Promise<string[]> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), 6_000);
  try {
    const resposta = await fetcher("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": chave }, signal: controle.signal });
    if (!resposta.ok) return [];
    const corpo = await resposta.json() as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
    return ordenarModelos((corpo.models ?? []).filter((m) => m.name && (m.supportedGenerationMethods ?? []).includes("generateContent")).map((m) => m.name!));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Erro 400/403 de chave inválida ou API desativada (não adianta tentar outro modelo). */
function erroDeChave(corpo: string) {
  return /api[ _-]?key|API_KEY_INVALID|SERVICE_DISABLED|has not been used|permission denied on resource project/i.test(corpo);
}

/**
 * Uma geração: chama o modelo configurado. Só passa para outro modelo quando a
 * chamada falha (404/429/5xx/timeout → consulta os modelos disponíveis e tenta
 * o próximo), no máximo MAX_TENTATIVAS chamadas. Chave recusada interrompe na hora.
 */
export async function gerarComGemini(chave: string, modeloPreferido: string, sistema: string, usuario: string, fetcher: typeof fetch = fetch) {
  const fila = [modeloPreferido];
  const tentados = new Set<string>();
  const tentativas: string[] = [];
  let descobriu = false;
  while (tentativas.length < MAX_TENTATIVAS) {
    if (!fila.length) {
      if (descobriu) break;
      descobriu = true;
      fila.push(...(await descobrirModelos(chave, fetcher)));
      continue;
    }
    const modelo = fila.shift()!;
    if (tentados.has(modelo)) continue;
    tentados.add(modelo);
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), TIMEOUT_MS);
    try {
      const resposta = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
        signal: controle.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sistema }] },
          contents: [{ role: "user", parts: [{ text: usuario }] }],
          generationConfig: {
            temperature: 1,
            maxOutputTokens: 2048,
            responseMimeType: "application/json",
            responseSchema: { type: "OBJECT", properties: { texto: { type: "STRING" } }, required: ["texto"] },
          },
        }),
      });
      const status = resposta.status;
      if (status === 401 || ((status === 400 || status === 403) && erroDeChave(await resposta.text().catch(() => "")))) {
        tentativas.push(`${modelo}:${status}`);
        throw new ErroGemini(`http_${status}`, tentativas);
      }
      if (!resposta.ok) { tentativas.push(`${modelo}:${status}`); continue; }
      const corpo = await resposta.json() as RespostaGemini;
      const bruto = (corpo.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
      if (!bruto) { tentativas.push(`${modelo}:vazio`); continue; }
      let texto = bruto;
      try { texto = String((JSON.parse(bruto) as { texto?: unknown }).texto ?? ""); } catch { /* sem JSON: valida como texto */ }
      return { texto, modelo, tentativas: [...tentativas, `${modelo}:200`] };
    } catch (erro) {
      if (erro instanceof ErroGemini) throw erro;
      tentativas.push(`${modelo}:${erro instanceof Error && erro.name === "AbortError" ? "timeout" : "rede"}`);
    } finally {
      clearTimeout(timer);
    }
  }
  const ultimo = tentativas[tentativas.length - 1]?.split(":")[1] ?? "sem_modelo";
  throw new ErroGemini(/^\d+$/.test(ultimo) ? `http_${ultimo}` : ultimo, tentativas);
}

async function configuracaoGemini(env: Env) {
  const [chave, modelo] = await Promise.all([obterCredencial(env, "gemini", "api_key"), obterCredencial(env, "gemini", "modelo")]);
  return {
    chave: chave?.trim() || null,
    modelo: modelo?.trim() || MODELO_PADRAO,
    instrucoes: env.GEMINI_PROMPT?.trim() || PROMPT_PADRAO,
  };
}

export type ResultadoRotina = {
  data: string;
  texto: string;
  tema: string;
  origem: "ia" | "catalogo" | "ultima_valida";
  reutilizada: boolean;
  chamouGemini: boolean;
  motivo?: string;
};

type Db = ReturnType<typeof createServiceSupabaseClient>;
type Linha = { data: string; status: "gerando" | "pronta"; texto: string | null; tema: string | null; origem: ResultadoRotina["origem"] | null; updated_at: string };

/**
 * Rotina diária idempotente. Chama o Gemini no máximo uma vez por data: se a
 * mensagem de hoje já existe (ou outra execução está gerando), reutiliza.
 */
export async function gerarMensagemDoDia(env: Env, agora = new Date(), deps: { db?: Db; fetcher?: typeof fetch } = {}): Promise<ResultadoRotina> {
  const db = deps.db ?? createServiceSupabaseClient(env);
  const base = fraseDoDia(agora);
  const colunas = "data,status,texto,tema,origem,updated_at";
  const emAndamento: ResultadoRotina = { data: base.data, texto: base.texto, tema: base.tema, origem: "catalogo", reutilizada: true, chamouGemini: false, motivo: "geracao_em_andamento" };

  // 1) Reserva a data. A chave primária garante uma única mensagem por dia.
  const { error: erroReserva } = await db.from("mensagens_do_dia").insert({ data: base.data, status: "gerando" });
  if (erroReserva) {
    if (erroReserva.code !== "23505") throw new Error(`reserva_falhou:${erroReserva.code ?? "?"}`);
    const { data: existente } = await db.from("mensagens_do_dia").select(colunas).eq("data", base.data).maybeSingle<Linha>();
    if (existente?.status === "pronta") {
      return { data: existente.data, texto: existente.texto!, tema: existente.tema!, origem: existente.origem!, reutilizada: true, chamouGemini: false };
    }
    // Outra execução está gerando agora: não chama o Gemini de novo.
    if (!existente || Date.now() - new Date(existente.updated_at).getTime() <= RESERVA_EXPIRA_MS) return emAndamento;
    // Reserva abandonada (execução interrompida): retoma só se ninguém retomou antes.
    const { data: retomada } = await db.from("mensagens_do_dia").update({ updated_at: new Date().toISOString() })
      .eq("data", base.data).eq("status", "gerando").eq("updated_at", existente.updated_at).select("data");
    if (!retomada?.length) return emAndamento;
  }

  // 2) Mensagens recentes (a primeira é a de ontem) para evitar repetição.
  const { data: ultimas } = await db.from("mensagens_do_dia").select("texto").eq("status", "pronta").lt("data", base.data).order("data", { ascending: false }).limit(14);
  const recentes = (ultimas ?? []).map((r: { texto: string | null }) => r.texto).filter((t): t is string => Boolean(t));

  // 3) Uma geração no Gemini.
  let texto: string | null = null;
  let modelo: string | null = null;
  let motivo: string | undefined;
  let chamouGemini = false;
  const config = await configuracaoGemini(env);
  if (!config.chave) motivo = "sem_chave";
  else {
    chamouGemini = true;
    try {
      const { sistema, usuario } = montarPrompt(agora, base, recentes, config.instrucoes);
      const gerada = await gerarComGemini(config.chave, config.modelo, sistema, usuario, deps.fetcher);
      const validacao = validarFraseIa(gerada.texto, recentes);
      if (validacao.ok) { texto = validacao.texto; modelo = gerada.modelo; }
      else motivo = `reprovada:${validacao.motivo}`;
    } catch (erro) {
      motivo = erro instanceof ErroGemini ? `${erro.motivo} (${erro.tentativas.join(", ")})` : "erro";
    }
  }

  // 4) Reserva: frase do catálogo do dia; se ela repetir a de ontem, a última mensagem válida.
  let origem: ResultadoRotina["origem"] = "ia";
  if (!texto) {
    const ontem = recentes[0];
    origem = "catalogo";
    texto = base.texto;
    if (ontem && normalizar(ontem) === normalizar(base.texto)) {
      const anterior = recentes.find((r) => normalizar(r) !== normalizar(ontem));
      if (anterior) { texto = anterior; origem = "ultima_valida"; }
    }
  }

  const { error: erroSalvar } = await db.from("mensagens_do_dia")
    .update({ status: "pronta", texto, tema: base.tema, origem, modelo, updated_at: new Date().toISOString() })
    .eq("data", base.data).eq("status", "gerando");
  if (erroSalvar) throw new Error(`salvar_falhou:${erroSalvar.code ?? "?"}`);
  return { data: base.data, texto, tema: base.tema, origem, reutilizada: false, chamouGemini, motivo };
}

function iguais(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * Quem pode disparar a rotina: Vercel Cron (Authorization: Bearer CRON_SECRET),
 * agendador externo (x-notificacoes-cron-secret) ou, sem CRON_SECRET definido,
 * o próprio Vercel Cron pelo user-agent. A rotina é idempotente: repetir no
 * mesmo dia nunca chama o Gemini de novo.
 */
export function rotinaAutorizada(request: Request, env: Env) {
  const cronSecret = env.CRON_SECRET?.trim();
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (cronSecret && bearer && iguais(bearer, cronSecret)) return true;
  const interno = env.NOTIFICACOES_CRON_SECRET?.trim();
  const cabecalho = request.headers.get("x-notificacoes-cron-secret")?.trim() ?? "";
  if (interno && cabecalho && iguais(cabecalho, interno)) return true;
  return !cronSecret && /^vercel-cron\//i.test(request.headers.get("user-agent") ?? "");
}

/** Teste de conexão do painel de Integrações: gera um exemplo sem gravar nada. */
export async function testarGemini(env: Env) {
  const config = await configuracaoGemini(env);
  if (!config.chave) return { conectado: false, detalhe: "Nenhuma chave do Gemini configurada." };
  try {
    const agora = new Date();
    const { sistema, usuario } = montarPrompt(agora, fraseDoDia(agora), [], config.instrucoes);
    const { texto, modelo } = await gerarComGemini(config.chave, config.modelo, sistema, usuario);
    const validacao = validarFraseIa(texto);
    return validacao.ok
      ? { conectado: true, detalhe: `Gemini respondeu (${modelo}). Exemplo: ${validacao.texto.replace(/\*/g, "")}` }
      : { conectado: true, detalhe: `Gemini respondeu (${modelo}), mas o exemplo foi reprovado pelos filtros (${validacao.motivo}). Na rotina diária, isso vira a frase de reserva.` };
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : "erro";
    const tentativas = erro instanceof ErroGemini && erro.tentativas.length ? ` Tentativas: ${erro.tentativas.join(", ")}.` : "";
    const detalhe = /^http_(400|401|403)$/.test(motivo)
      ? "O Gemini recusou a chave (verifique se ela foi copiada inteira e se a Generative Language API está ativa)."
      : motivo === "http_429"
        ? "Cota gratuita do Gemini esgotada no momento. Tente mais tarde."
        : /^http_5\d\d$|timeout/.test(motivo)
          ? "O Gemini está sobrecarregado agora (erro do Google, não da chave)."
          : `Falha ao contatar o Gemini (${motivo}).`;
    return { conectado: false, detalhe: detalhe + tentativas };
  }
}

async function adminAutorizado(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return false;
  const sessao = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  if (!sessao?.adminId) return false;
  const colaborador = await buscarColaboradorAdminAtivo(sessao.adminId, env).catch(() => null);
  return Boolean(colaborador && temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.INTEGRACOES_GERENCIAR_CREDENCIAIS));
}

export async function fraseDoDiaApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);

  // Rotina diária (Vercel Cron) e execução manual pelo admin — ambas idempotentes.
  const rotina = url.pathname === "/api/cron/mensagem-do-dia" && request.method === "GET";
  const manual = url.pathname === "/api/admin/integrations/gemini/mensagem-do-dia" && request.method === "POST";
  if (rotina || manual) {
    const log = requestLogger(request).child({ action: "daily_message.routine" });
    if (rotina && !rotinaAutorizada(request, env)) return json({ erro: "Rotina não autorizada." }, 401);
    if (manual) {
      const origem = request.headers.get("Origin");
      if (origem && origem !== url.origin) return json({ erro: "Requisição de origem não autorizada." }, 403);
      if (!(await adminAutorizado(request, env))) return json({ erro: "Sem permissão." }, 403);
    }
    try {
      const resultado = await gerarMensagemDoDia(env);
      log.info("Mensagem do dia verificada", { eventCode: "DAILY_MESSAGE_ROUTINE", origem: resultado.origem, reutilizada: resultado.reutilizada, chamouGemini: resultado.chamouGemini, motivo: resultado.motivo });
      return json(resultado);
    } catch (erro) {
      log.error("Falha na rotina da mensagem do dia", { eventCode: "DAILY_MESSAGE_ROUTINE_FAILED", error: erro });
      return json({ erro: "Falha ao preparar a mensagem do dia." }, 500);
    }
  }

  // App da cliente: só LÊ a mensagem salva (a sessão da cliente já foi validada no roteador).
  if (url.pathname !== "/api/cliente/frase-do-dia" || request.method !== "GET") return null;
  const base = fraseDoDia();
  const { data, error } = await createServiceSupabaseClient(env).from("mensagens_do_dia")
    .select("texto,tema,origem").eq("data", base.data).eq("status", "pronta").maybeSingle<{ texto: string; tema: string; origem: string }>();
  if (error) requestLogger(request).warn("Mensagem do dia indisponível", { eventCode: "DAILY_MESSAGE_READ_FAILED" });
  if (!data) return json({ texto: base.texto, tema: base.tema, data: base.data, origem: "reserva" });
  return json({ texto: data.texto, tema: data.tema, data: base.data, origem: data.origem });
}
