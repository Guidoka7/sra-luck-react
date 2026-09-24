/**
 * Mensagem do dia da Início (uma única mensagem por data, igual para todas as clientes).
 *
 * Fluxo:
 *   Vercel Cron (vercel.json, 00:05 de Brasília) → GET /api/cron/mensagem-do-dia
 *     → já existe mensagem pronta ou candidata de hoje? reutiliza;
 *     → não existe: reserva a data, chama o Gemini UMA vez e valida;
 *     → candidata válida fica em "aguardando_aprovacao" e NÃO vai para o app;
 *     → falha/sem chave/texto reprovado fica em "falha_geracao", sem publicação;
 *     → a equipe revisa no Admin/Dev Console e publica por ação explícita;
 *   App → GET /api/cliente/frase-do-dia → só LÊ status "pronta". Enquanto a
 *   candidata aguarda aprovação (ou falha), mostra a frase de reserva do catálogo.
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
import { configDaFuncao, consumirUso, type ConfigGemini } from "./integracoes-registro";
import { getCookie, verificarTokenAdmin } from "./session";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { requestLogger } from "./logger";
import { DATAS_ESPECIAIS, TEMAS_SEMANA, fraseDoDia, type FraseDoDia } from "../src/lib/fraseDoDia";

const MODELO_PADRAO = "gemini-3.5-flash-lite";
/** Máximo de falhas não recuperáveis rapidamente (429/5xx exceto 503, timeout/rede) numa execução. */
const MAX_TENTATIVAS = 3;
/**
 * Máximo de modelos testados numa execução. Respostas 404 e 503 podem ser rápidas e não devem
 * esgotar a busca antes de chegar aos demais modelos listados pela chave.
 */
const MAX_MODELOS = 6;
const TIMEOUT_MS = 12_000;
/** Orçamento total de uma geração (a rota do painel precisa responder antes do limite da função). */
const ORCAMENTO_MS = 22_000;
const BASE_GEMINI = "https://generativelanguage.googleapis.com/v1beta";
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

/**
 * Nome do modelo como a API espera em v1beta/models/{modelo}:generateContent: sem o prefixo
 * "models/" (que o ListModels devolve e às vezes é colado assim no cofre), sem espaços ou aspas.
 * Nome com caractere inválido volta null (a URL ficaria quebrada e o Google responderia 404).
 */
export function normalizarModelo(nome: string | null | undefined): string | null {
  const limpo = String(nome ?? "").trim().replace(/^["'`]+|["'`]+$/g, "").trim().replace(/^models\//i, "").toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{1,79}$/.test(limpo) ? limpo : null;
}

/** Lista (ListModels) os modelos que a chave pode usar. Usada só quando o modelo configurado falha. */
export async function descobrirModelos(chave: string, fetcher: typeof fetch = fetch, timeoutMs = 6_000): Promise<string[]> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), timeoutMs);
  try {
    const resposta = await fetcher(`${BASE_GEMINI}/models?pageSize=1000`, { headers: { "x-goog-api-key": chave }, signal: controle.signal });
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
 * o próximo). Respostas 503 recebem espera progressiva dentro do orçamento total.
 * Chave recusada interrompe na hora.
 */
export type OpcoesGeracao = { schema?: Record<string, unknown>; temperatura?: number; maxTokens?: number };

const SCHEMA_TEXTO = { type: "OBJECT", properties: { texto: { type: "STRING" } }, required: ["texto"] };

export async function gerarComGemini(chave: string, modeloPreferido: string, sistema: string, usuario: string, fetcher: typeof fetch = fetch, opcoes: OpcoesGeracao = {}) {
  const tentativas: string[] = [];
  const configurado = normalizarModelo(modeloPreferido);
  if (!configurado) tentativas.push(`${String(modeloPreferido ?? "").slice(0, 60) || "(vazio)"}:nome_invalido`);
  const fila = [configurado ?? MODELO_PADRAO];
  const tentados = new Set<string>();
  let descobriu = false, lentas = 0, falhas503 = 0, espera503 = 0;
  const inicio = Date.now();
  while (lentas < MAX_TENTATIVAS && tentados.size < MAX_MODELOS && Date.now() - inicio < ORCAMENTO_MS - 250) {
    if (!fila.length) {
      if (descobriu) break;
      descobriu = true;
      const restante = ORCAMENTO_MS - (Date.now() - inicio);
      if (restante <= 1_000) break;
      fila.push(...(await descobrirModelos(chave, fetcher, Math.min(6_000, restante - 1_000))));
      continue;
    }
    const modelo = fila.shift()!;
    if (tentados.has(modelo)) continue;
    if (espera503) {
      // O Google recomenda backoff em 503. Não iniciar uma chamada que já ultrapassaria o orçamento.
      if (Date.now() - inicio + espera503 + 1_000 >= ORCAMENTO_MS) break;
      await new Promise((resolve) => setTimeout(resolve, espera503));
      espera503 = 0;
    }
    tentados.add(modelo);
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), Math.max(1, Math.min(TIMEOUT_MS, ORCAMENTO_MS - (Date.now() - inicio) - 250)));
    try {
      const resposta = await fetcher(`${BASE_GEMINI}/models/${encodeURIComponent(modelo)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
        signal: controle.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sistema }] },
          contents: [{ role: "user", parts: [{ text: usuario }] }],
          generationConfig: {
            temperature: opcoes.temperatura ?? 1,
            maxOutputTokens: opcoes.maxTokens ?? 2048,
            responseMimeType: "application/json",
            responseSchema: opcoes.schema ?? SCHEMA_TEXTO,
          },
        }),
      });
      const status = resposta.status;
      if (status === 401 || ((status === 400 || status === 403) && erroDeChave(await resposta.text().catch(() => "")))) {
        tentativas.push(`${modelo}:${status}`);
        throw new ErroGemini(`http_${status}`, tentativas);
      }
      if (!resposta.ok) {
        tentativas.push(`${modelo}:${status}`);
        if (status === 503) {
          falhas503 += 1;
          espera503 = Math.min(4_000, 500 * 2 ** (falhas503 - 1));
        } else if (status !== 404) lentas += 1;
        continue;
      }
      const corpo = await resposta.json() as RespostaGemini;
      const bruto = (corpo.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
      if (!bruto) { tentativas.push(`${modelo}:vazio`); lentas += 1; continue; }
      let texto = bruto;
      try { texto = String((JSON.parse(bruto) as { texto?: unknown }).texto ?? ""); } catch { /* sem JSON: valida como texto */ }
      return { texto, bruto, modelo, tentativas: [...tentativas, `${modelo}:200`] };
    } catch (erro) {
      if (erro instanceof ErroGemini) throw erro;
      tentativas.push(`${modelo}:${erro instanceof Error && erro.name === "AbortError" ? "timeout" : "rede"}`);
      lentas += 1;
    } finally {
      clearTimeout(timer);
    }
  }
  const ultimo = tentativas[tentativas.length - 1]?.split(":").pop() ?? "sem_modelo";
  throw new ErroGemini(/^\d+$/.test(ultimo) ? `http_${ultimo}` : ultimo, tentativas);
}

/** Funções do Sra Luck que usam o Gemini; cada uma tem configuração própria (integracoes_config). */
export type FuncaoGemini = "mensagem_diaria" | "notificacoes";

/**
 * Configuração efetiva do Gemini para uma função: chave e modelo geral (cofre/ambiente)
 * + a configuração da função (liga/desliga, modelo, prompt, temperatura, tokens, limite).
 * Sem configuração salva, o comportamento é o de antes.
 */
export async function configuracaoGemini(env: Env, funcao: FuncaoGemini = "mensagem_diaria", deps: { db?: Db } = {}) {
  const [chave, modelo, cfg] = await Promise.all([
    obterCredencial(env, "gemini", "api_key"),
    obterCredencial(env, "gemini", "modelo"),
    configDaFuncao<ConfigGemini>(env, "gemini", funcao, deps).catch(() => null),
  ]);
  const ativo = cfg?.ativo !== false;
  return {
    funcao,
    chave: ativo ? chave?.trim() || null : null,
    /** Motivo de não haver chave quando ela existe mas a função foi desligada. */
    indisponivel: ativo ? null : "funcao_desativada" as const,
    modelo: normalizarModelo(cfg?.modelo) ?? normalizarModelo(modelo) ?? MODELO_PADRAO,
    // Mensagem diária: o prompt da função substitui as instruções de estilo.
    instrucoes: (funcao === "mensagem_diaria" ? cfg?.prompt : null) || env.GEMINI_PROMPT?.trim() || PROMPT_PADRAO,
    // Outras funções: orientação extra de tom, somada às regras fixas de segurança.
    instrucoesExtras: funcao === "mensagem_diaria" ? null : cfg?.prompt ?? null,
    temperatura: cfg?.temperatura ?? null,
    maxTokens: cfg?.maxTokens ?? null,
    limiteDiario: cfg?.limiteDiario ?? null,
  };
}

export type ConfiguracaoGemini = Awaited<ReturnType<typeof configuracaoGemini>>;

/** Reserva uma chamada no limite diário da função; false = limite do dia atingido. */
export function reservarChamadaGemini(env: Env, config: ConfiguracaoGemini, deps: { db?: Db } = {}) {
  return consumirUso(env, "gemini", config.funcao, config.limiteDiario, deps);
}

/** Opções de geração da função, com o padrão de cada chamada quando não configurado. */
export function opcoesDaFuncao(config: ConfiguracaoGemini, padrao: OpcoesGeracao = {}): OpcoesGeracao {
  return { ...padrao, temperatura: config.temperatura ?? padrao.temperatura, maxTokens: config.maxTokens ?? padrao.maxTokens };
}

export type ResultadoRotina = {
  data: string;
  texto: string;
  tema: string;
  origem: "ia" | "catalogo" | "ultima_valida" | "admin";
  reutilizada: boolean;
  chamouGemini: boolean;
  motivo?: string;
};

type Db = ReturnType<typeof createServiceSupabaseClient>;
type StatusMensagem = "gerando" | "aguardando_aprovacao" | "pronta" | "falha_geracao";
type Linha = { data: string; status: StatusMensagem; texto: string | null; tema: string | null; origem: ResultadoRotina["origem"] | null; modelo?: string | null; erro?: string | null; updated_at: string };

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
  const config = await configuracaoGemini(env, "mensagem_diaria", { db });
  if (!config.chave) motivo = config.indisponivel ?? "sem_chave";
  else if (!(await reservarChamadaGemini(env, config, { db }))) motivo = "limite_diario";
  else {
    chamouGemini = true;
    try {
      const { sistema, usuario } = montarPrompt(agora, base, recentes, config.instrucoes);
      const gerada = await gerarComGemini(config.chave, config.modelo, sistema, usuario, deps.fetcher, opcoesDaFuncao(config));
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

export type ResultadoPreparacao = ResultadoRotina & {
  status: StatusMensagem;
  aguardandoAprovacao: boolean;
};

/**
 * Rotina usada pelo cron e pelo botão "Mensagem de hoje".
 *
 * Ela gera no máximo uma candidata por data, mas nunca publica sozinha.
 * Somente `definirMensagem` muda o status para "pronta".
 */
export async function prepararMensagemDoDia(env: Env, agora = new Date(), deps: { db?: Db; fetcher?: typeof fetch } = {}): Promise<ResultadoPreparacao> {
  const db = deps.db ?? createServiceSupabaseClient(env);
  const base = fraseDoDia(agora);
  const colunas = "data,status,texto,tema,origem,modelo,erro,updated_at";
  const emAndamento: ResultadoPreparacao = {
    data: base.data,
    texto: base.texto,
    tema: base.tema,
    origem: "catalogo",
    reutilizada: true,
    chamouGemini: false,
    motivo: "geracao_em_andamento",
    status: "gerando",
    aguardandoAprovacao: false,
  };

  const { error: erroReserva } = await db.from("mensagens_do_dia").insert({ data: base.data, status: "gerando" });
  if (erroReserva) {
    if (erroReserva.code !== "23505") throw new Error(`reserva_falhou:${erroReserva.code ?? "?"}`);
    const { data: existente } = await db.from("mensagens_do_dia").select(colunas).eq("data", base.data).maybeSingle<Linha>();

    if (existente?.status === "pronta") {
      return {
        data: existente.data,
        texto: existente.texto!,
        tema: existente.tema!,
        origem: existente.origem!,
        reutilizada: true,
        chamouGemini: false,
        status: "pronta",
        aguardandoAprovacao: false,
      };
    }

    if (existente?.status === "aguardando_aprovacao") {
      return {
        data: existente.data,
        texto: existente.texto!,
        tema: existente.tema!,
        origem: existente.origem ?? "ia",
        reutilizada: true,
        chamouGemini: false,
        status: "aguardando_aprovacao",
        aguardandoAprovacao: true,
      };
    }

    if (!existente) return emAndamento;

    if (existente.status === "gerando" && Date.now() - new Date(existente.updated_at).getTime() <= RESERVA_EXPIRA_MS) {
      return emAndamento;
    }

    const statusRetomavel = existente.status === "falha_geracao" ? "falha_geracao" : "gerando";
    const { data: retomada } = await db.from("mensagens_do_dia")
      .update({ status: "gerando", erro: null, updated_at: new Date().toISOString() })
      .eq("data", base.data)
      .eq("status", statusRetomavel)
      .select("data");
    if (!retomada?.length) return emAndamento;
  }

  const { data: ultimas } = await db.from("mensagens_do_dia").select("texto")
    .eq("status", "pronta").lt("data", base.data).order("data", { ascending: false }).limit(14);
  const recentes = (ultimas ?? []).map((r: { texto: string | null }) => r.texto).filter((t): t is string => Boolean(t));

  let texto: string | null = null;
  let modelo: string | null = null;
  let motivo: string | undefined;
  let chamouGemini = false;
  const config = await configuracaoGemini(env, "mensagem_diaria", { db });

  if (!config.chave) {
    motivo = config.indisponivel ?? "sem_chave";
  } else if (!(await reservarChamadaGemini(env, config, { db }))) {
    motivo = "limite_diario";
  } else {
    chamouGemini = true;
    try {
      const { sistema, usuario } = montarPrompt(agora, base, recentes, config.instrucoes);
      const gerada = await gerarComGemini(config.chave, config.modelo, sistema, usuario, deps.fetcher, opcoesDaFuncao(config));
      const validacao = validarFraseIa(gerada.texto, recentes);
      if (validacao.ok) {
        texto = validacao.texto;
        modelo = gerada.modelo;
      } else {
        motivo = `reprovada:${validacao.motivo}`;
      }
    } catch (erro) {
      motivo = erro instanceof ErroGemini ? `${erro.motivo} (${erro.tentativas.join(", ")})` : "erro";
    }
  }

  if (!texto) {
    const erroTexto = String(motivo || "erro").slice(0, 500);
    const { error: erroSalvar } = await db.from("mensagens_do_dia")
      .update({
        status: "falha_geracao",
        texto: null,
        tema: base.tema,
        origem: null,
        modelo: null,
        erro: erroTexto,
        updated_at: new Date().toISOString(),
      })
      .eq("data", base.data)
      .eq("status", "gerando");
    if (erroSalvar) throw new Error(`salvar_falhou:${erroSalvar.code ?? "?"}`);
    return {
      data: base.data,
      texto: base.texto,
      tema: base.tema,
      origem: "catalogo",
      reutilizada: false,
      chamouGemini,
      motivo,
      status: "falha_geracao",
      aguardandoAprovacao: false,
    };
  }

  const { error: erroSalvar } = await db.from("mensagens_do_dia")
    .update({
      status: "aguardando_aprovacao",
      texto,
      tema: base.tema,
      origem: "ia",
      modelo,
      erro: null,
      updated_at: new Date().toISOString(),
    })
    .eq("data", base.data)
    .eq("status", "gerando");
  if (erroSalvar) throw new Error(`salvar_falhou:${erroSalvar.code ?? "?"}`);

  return {
    data: base.data,
    texto,
    tema: base.tema,
    origem: "ia",
    reutilizada: false,
    chamouGemini,
    status: "aguardando_aprovacao",
    aguardandoAprovacao: true,
  };
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
  const config = await configuracaoGemini(env, "mensagem_diaria");
  if (!config.chave) return { conectado: false, detalhe: config.indisponivel ? "A função Mensagem diária do Gemini está desligada nas Integrações." : "Nenhuma chave do Gemini configurada." };
  if (!(await reservarChamadaGemini(env, config))) return { conectado: false, detalhe: `Limite diário da função Mensagem diária atingido (${config.limiteDiario} chamadas). O teste conta como chamada.` };
  try {
    const agora = new Date();
    const { sistema, usuario } = montarPrompt(agora, fraseDoDia(agora), [], config.instrucoes);
    const { texto, modelo } = await gerarComGemini(config.chave, config.modelo, sistema, usuario, fetch, opcoesDaFuncao(config));
    const validacao = validarFraseIa(texto);
    return validacao.ok
      ? { conectado: true, detalhe: `Gemini respondeu (${modelo}). Exemplo: ${validacao.texto.replace(/\*/g, "")}` }
      : { conectado: true, detalhe: `Gemini respondeu (${modelo}), mas o exemplo foi reprovado pelos filtros (${validacao.motivo}). Na rotina diária, nada é publicado automaticamente.` };
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : "erro";
    return { conectado: false, detalhe: explicarFalhaGemini(motivo, config.modelo, erro instanceof ErroGemini ? erro.tentativas : []) };
  }
}

/** Colaborador com permissão de integrações, ou null. */
async function adminDaRequisicao(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const sessao = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  if (!sessao?.adminId) return null;
  const colaborador = await buscarColaboradorAdminAtivo(sessao.adminId, env).catch(() => null);
  return colaborador && temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.INTEGRACOES_GERENCIAR_CREDENCIAIS) ? colaborador : null;
}

async function adminAutorizado(request: Request, env: Env) {
  return Boolean(await adminDaRequisicao(request, env));
}

// ---------------------------------------------------------------------------
// Conversa com o Gemini no painel: ver a candidata do cron, pedir outra e
// escolher/publicar a mensagem do dia. O cron só prepara; publicar é ação humana.
// ---------------------------------------------------------------------------

export const LIMITE_PEDIDO = 200;

/** Pedido livre da equipe ("mais curta", "fale de constância"): texto simples e curto. */
export function limparPedido(bruto: unknown) {
  return String(bruto ?? "").replace(/[\u0000-\u001f\u007f<>{}]/g, " ").replace(/\s+/g, " ").trim().slice(0, LIMITE_PEDIDO);
}

export type MensagemSalva = { data: string; status: string; texto: string | null; tema: string | null; origem: string | null; modelo: string | null; erro: string | null; updated_at: string };

export async function historicoMensagens(env: Env, limite = 14, deps: { db?: Db } = {}) {
  const db = deps.db ?? createServiceSupabaseClient(env);
  const { data, error } = await db.from("mensagens_do_dia").select("data,status,texto,tema,origem,modelo,erro,updated_at")
    .order("data", { ascending: false }).limit(Math.min(Math.max(limite, 1), 60));
  if (error) throw new Error(`historico_falhou:${error.code ?? "?"}`);
  return (data ?? []) as MensagemSalva[];
}

async function textosRecentes(db: Db, dataBase: string, incluirHoje: boolean) {
  let consulta = db.from("mensagens_do_dia").select("texto").eq("status", "pronta");
  consulta = incluirHoje ? consulta.lt("data", proximoDia(dataBase)) : consulta.lt("data", dataBase);
  const { data } = await consulta.order("data", { ascending: false }).limit(14);
  return (data ?? []).map((r: { texto: string | null }) => r.texto).filter((t): t is string => Boolean(t));
}

function proximoDia(data: string) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export type Sugestao =
  | { ok: true; texto: string; aprovada: boolean; motivo?: string; modelo: string }
  | { ok: false; codigo: string; erro: string; tentativas?: string[] };

/** Gera uma candidata SEM salvar. O painel mostra e a equipe decide se usa. */
export async function sugerirMensagem(env: Env, pedidoBruto: unknown, agora = new Date(), deps: { db?: Db; fetcher?: typeof fetch } = {}): Promise<Sugestao> {
  const db = deps.db ?? createServiceSupabaseClient(env);
  const config = await configuracaoGemini(env, "mensagem_diaria", { db });
  if (!config.chave) {
    return config.indisponivel
      ? { ok: false, codigo: "funcao_desativada", erro: "A função Mensagem diária do Gemini está desligada nas Integrações." }
      : { ok: false, codigo: "sem_chave", erro: "O Gemini não tem chave configurada (ou a integração está desligada)." };
  }
  if (!(await reservarChamadaGemini(env, config, { db }))) return { ok: false, codigo: "limite_diario", erro: `Limite diário da função Mensagem diária atingido (${config.limiteDiario} chamadas). Ajuste o limite nas Integrações ou tente amanhã.` };
  const base = fraseDoDia(agora);
  const recentes = await textosRecentes(db, base.data, true);
  const pedido = limparPedido(pedidoBruto);
  const { sistema, usuario } = montarPrompt(agora, base, recentes, config.instrucoes);
  const usuarioFinal = pedido ? `${usuario}\nPedido da equipe (siga sem quebrar nenhuma regra): ${pedido}` : usuario;
  try {
    const gerada = await gerarComGemini(config.chave, config.modelo, sistema, usuarioFinal, deps.fetcher, opcoesDaFuncao(config));
    const validacao = validarFraseIa(gerada.texto, recentes);
    return validacao.ok
      ? { ok: true, texto: validacao.texto, aprovada: true, modelo: gerada.modelo }
      : { ok: true, texto: String(gerada.texto || "").trim().slice(0, 300), aprovada: false, motivo: validacao.motivo, modelo: gerada.modelo };
  } catch (erro) {
    const motivo = erro instanceof ErroGemini ? erro.motivo : "erro";
    const tentativas = erro instanceof ErroGemini ? erro.tentativas : [];
    return { ok: false, codigo: motivo, erro: explicarFalhaGemini(motivo, config.modelo, tentativas), tentativas };
  }
}

/** Mensagem para a equipe; sempre cita o modelo configurado e cada tentativa (modelo:resultado). */
export function explicarFalhaGemini(motivo: string, modelo: string, tentativas: string[]) {
  const lista = tentativas.length ? ` Tentativas: ${tentativas.join(", ")}.` : "";
  const texto = /^http_(400|401|403)$/.test(motivo) ? "O Gemini recusou a chave (confira se foi copiada inteira e se a Generative Language API está ativa)."
    : motivo === "http_404" ? `O modelo "${modelo}" não existe ou não está disponível para esta chave, e nenhum modelo alternativo listado pela chave respondeu. Configure um modelo válido em Admin → Integrações → Gemini.`
      : motivo === "http_429" ? "Cota gratuita do Gemini esgotada no momento. Tente mais tarde."
        : /^http_5\d\d$|timeout/.test(motivo) ? "O Gemini está sobrecarregado agora (erro do Google)."
          : `Falha ao contatar o Gemini (${motivo}).`;
  return texto + lista;
}

export type Definicao = { ok: true; data: string; texto: string; tema: string; origem: "ia" | "admin" } | { ok: false; codigo: string; erro: string };

const MOTIVOS: Record<string, string> = {
  tamanho: "A frase precisa ter entre 20 e 170 caracteres.",
  destaque: "Marque exatamente um trecho de destaque entre asteriscos, por exemplo: Disciplina hoje, *resultados sempre*.",
  emoji: "Use no máximo 1 emoji.",
  caractere: "Sem quebras de linha, links, # ou @.",
  termo_proibido: "A frase usa um termo proibido pelo tom da marca (corpo, promessa, cobrança ou termos médicos).",
  repetida: "Essa frase repete uma mensagem recente ou do catálogo.",
};

/**
 * Define a mensagem de HOJE (vale para todas as clientes). Passa pelos mesmos
 * filtros da IA. origem "ia" = candidata do Gemini; "admin" = escrita pela equipe.
 */
export async function definirMensagem(env: Env, textoBruto: unknown, opcoes: { origem?: unknown; modelo?: unknown } = {}, agora = new Date(), deps: { db?: Db } = {}): Promise<Definicao> {
  const db = deps.db ?? createServiceSupabaseClient(env);
  const base = fraseDoDia(agora);
  const recentes = await textosRecentes(db, base.data, false);
  const validacao = validarFraseIa(String(textoBruto ?? ""), recentes);
  if (!validacao.ok) return { ok: false, codigo: validacao.motivo, erro: MOTIVOS[validacao.motivo] ?? "A frase não passou nos filtros." };
  const origem = opcoes.origem === "ia" ? "ia" : "admin";
  const modelo = origem === "ia" ? String(opcoes.modelo ?? "").replace(/[^a-z0-9.\-]/gi, "").slice(0, 80) || null : null;
  const { error } = await db.from("mensagens_do_dia").upsert(
    { data: base.data, status: "pronta", texto: validacao.texto, tema: base.tema, origem, modelo, erro: null, updated_at: new Date().toISOString() },
    { onConflict: "data" },
  );
  if (error) {
    return error.code === "23514"
      ? { ok: false, codigo: "migration_087", erro: "Aplique a migration_087 para permitir mensagens escritas pela equipe." }
      : { ok: false, codigo: `salvar_falhou:${error.code ?? "?"}`, erro: "Não foi possível salvar a mensagem do dia." };
  }
  return { ok: true, data: base.data, texto: validacao.texto, tema: base.tema, origem };
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
      const resultado = await prepararMensagemDoDia(env);
      log.info("Mensagem do dia preparada para revisão", { eventCode: "DAILY_MESSAGE_PREPARED", status: resultado.status, origem: resultado.origem, reutilizada: resultado.reutilizada, chamouGemini: resultado.chamouGemini, motivo: resultado.motivo });
      return json(resultado);
    } catch (erro) {
      log.error("Falha na rotina da mensagem do dia", { eventCode: "DAILY_MESSAGE_ROUTINE_FAILED", error: erro });
      return json({ erro: "Falha ao preparar a mensagem do dia." }, 500);
    }
  }

  // Conversa do painel com o Gemini (histórico, pedir outra, escolher a do dia).
  const conversa = url.pathname.match(/^\/api\/admin\/integrations\/gemini\/(mensagens|sugerir|definir)$/)?.[1];
  if (conversa) {
    const log = requestLogger(request).child({ action: `daily_message.${conversa}` });
    const esperado = conversa === "mensagens" ? "GET" : "POST";
    if (request.method !== esperado) return json({ erro: "Método não suportado." }, 405);
    if (esperado === "POST") {
      const origem = request.headers.get("Origin");
      if (origem && origem !== url.origin) return json({ erro: "Requisição de origem não autorizada." }, 403);
    }
    const colaborador = await adminDaRequisicao(request, env);
    if (!colaborador) return json({ erro: "Sem permissão." }, 403);
    try {
      if (conversa === "mensagens") {
        const config = await configuracaoGemini(env, "mensagem_diaria");
        const mensagens = await historicoMensagens(env, Number(url.searchParams.get("limite")) || 14);
        return json({ hoje: fraseDoDia().data, configurado: Boolean(config.chave), modelo: config.modelo, mensagens });
      }
      const corpo = await request.json().catch(() => ({})) as { pedido?: unknown; texto?: unknown; origem?: unknown; modelo?: unknown };
      if (conversa === "sugerir") {
        const sugestao = await sugerirMensagem(env, corpo.pedido);
        log.info("Sugestão de mensagem do dia", { eventCode: "DAILY_MESSAGE_SUGGESTED", ok: sugestao.ok, aprovada: sugestao.ok ? sugestao.aprovada : false, codigo: sugestao.ok ? undefined : sugestao.codigo, tentativas: sugestao.ok ? undefined : sugestao.tentativas });
        return json(sugestao, sugestao.ok ? 200 : ["sem_chave", "funcao_desativada"].includes(sugestao.codigo) ? 409 : sugestao.codigo === "limite_diario" ? 429 : 502);
      }
      const definicao = await definirMensagem(env, corpo.texto, { origem: corpo.origem, modelo: corpo.modelo });
      if (!definicao.ok) return json(definicao, definicao.codigo.startsWith("salvar_falhou") ? 500 : definicao.codigo === "migration_087" ? 409 : 400);
      const { error: auditoria } = await createServiceSupabaseClient(env).from("logs_alteracoes").insert({ usuario: colaborador.id, acao: "definiu_mensagem_do_dia", entidade: "integracoes", detalhes: { provedor: "gemini", data: definicao.data, origem: definicao.origem } });
      if (auditoria) log.warn("Mensagem do dia definida, mas auditoria não foi persistida", { eventCode: "DAILY_MESSAGE_AUDIT_FAILED" });
      log.info("Mensagem do dia definida pela equipe", { eventCode: "DAILY_MESSAGE_SET", origem: definicao.origem });
      return json(definicao);
    } catch (erro) {
      log.error("Falha na conversa da mensagem do dia", { eventCode: "DAILY_MESSAGE_ADMIN_FAILED", error: erro });
      return json({ erro: "Falha ao processar a mensagem do dia." }, 500);
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

