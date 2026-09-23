/**
 * Agente da "Frase do dia" (Início da cliente).
 *
 * Fluxo: GET /api/cliente/frase-do-dia
 *   1. identifica o segmento da cliente pela jornada (% de parcelas pagas);
 *   2. procura a frase do dia + segmento no cache (tabela frases_do_dia);
 *   3. se não houver, pede ao Gemini (plano gratuito) uma frase nova no tom
 *      Sra. Luck, com o tema do dia, datas especiais e as frases recentes para
 *      não repetir; valida o texto (guardrails) e grava no cache;
 *   4. sem chave, com erro ou com texto reprovado, usa o catálogo local
 *      (src/lib/fraseDoDia.ts) — a cliente nunca fica sem frase.
 *
 * Privacidade: nenhum dado pessoal vai para o provedor. A IA escreve para o
 * segmento ("já passou da metade do plano") e o primeiro nome entra aqui, no
 * backend, trocando o marcador {nome}. São no máximo 4 chamadas por dia
 * (uma por segmento), bem dentro da cota gratuita.
 *
 * A chave fica em Admin → Integrações → Gemini (cofre cifrado) ou na variável
 * GEMINI_API_KEY. Modelo opcional em GEMINI_MODEL / campo "modelo".
 */
import { obterCredencial } from "./integrations-credenciais";
import { getCookie, verificarTokenSessao } from "./session";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { requestLogger } from "./logger";
import { DATAS_ESPECIAIS, TEMAS_SEMANA, fraseDoDia, type FraseDoDia } from "../src/lib/fraseDoDia";

export type SegmentoJornada = "inicio" | "construindo" | "metade" | "quitado";

const SEGMENTOS: Record<SegmentoJornada, string> = {
  inicio: "está começando o plano agora, antes ou logo depois da primeira parcela",
  construindo: "já pagou algumas parcelas e ainda está na primeira metade do plano",
  metade: "já passou da metade das parcelas pagas e está cada vez mais perto do sonho",
  quitado: "concluiu os pagamentos do plano e está na fase de agendar e viver o sonho",
};

const MODELOS_PADRAO = ["gemini-flash-latest", "gemini-2.5-flash"];
const TIMEOUT_MS = 15_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function segmentoPorPercentual(percentual: number): SegmentoJornada {
  const p = Number.isFinite(percentual) ? percentual : 0;
  if (p <= 0) return "inicio";
  if (p < 50) return "construindo";
  if (p < 100) return "metade";
  return "quitado";
}

export function primeiroNome(nome: string | null | undefined) {
  const primeiro = String(nome ?? "").trim().split(/\s+/)[0] ?? "";
  if (!primeiro) return "";
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}

/** Troca {nome}; sem nome, remove o vocativo ("{nome}, ") e ajusta a maiúscula. */
export function aplicarNome(texto: string, nome: string) {
  if (nome) return texto.replace(/\{nome\}/g, nome);
  const semNome = texto.replace(/\{nome\}\s*,\s*/g, "").replace(/,?\s*\{nome\}/g, "").trim();
  return semNome.replace(/^(\*?)(\p{Ll})/u, (_, a: string, b: string) => a + b.toUpperCase());
}

const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\{nome\}/g, "").replace(/[^a-z0-9 ]/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();

// Temas proibidos pelo tom da marca: corpo/estética, promessa de resultado,
// cobrança/financeiro agressivo e termos médicos.
const PROIBIDAS = [
  /\bgarant\w*/, /\bemagre\w*/, /\bgord\w*/, /\bmagr[ao]s?\b/, /\bpeso\b/, /\bbarriga\b/, /\bperfeit\w*/,
  /\bdefeito\w*/, /\bfeia\b/, /\bjuros\b/, /\bdesconto\w*/, /\bpromoc\w*/, /\bgratis\b/, /\bmedic\w*/,
  /\bcura\b/, /\bdieta\b/, /\bmedidas\b/, /\bdivida\w*/, /\batras\w* (no|na|de) pagamento/, /\bcobranc\w*/,
];

export type ValidacaoFrase = { ok: true; texto: string } | { ok: false; motivo: string };

/** Guardrails do texto vindo da IA. */
export function validarFraseIa(bruto: string, recentes: string[] = []): ValidacaoFrase {
  const texto = String(bruto ?? "").trim().replace(/^["“”']+|["“”']+$/g, "").replace(/\s+/g, " ").trim();
  const semMarcas = texto.replace(/\{nome\}/g, "").replace(/\*/g, "");
  if (semMarcas.length < 20 || semMarcas.length > 170) return { ok: false, motivo: "tamanho" };
  if ((texto.match(/\*/g) ?? []).length !== 2 || !/\*[^*\s][^*]*\*/.test(texto)) return { ok: false, motivo: "destaque" };
  if ((texto.match(/\{nome\}/g) ?? []).length > 1 || /[{}]/.test(texto.replace(/\{nome\}/g, ""))) return { ok: false, motivo: "marcador" };
  if (/[\n#@<>]|https?:|www\./i.test(texto) || /\p{Extended_Pictographic}/u.test(texto)) return { ok: false, motivo: "caractere" };
  const norm = normalizar(texto);
  if (PROIBIDAS.some((re) => re.test(norm))) return { ok: false, motivo: "termo_proibido" };
  const catalogo = [...TEMAS_SEMANA.flatMap((t) => t.frases), ...DATAS_ESPECIAIS.map((e) => e.texto)];
  if ([...recentes, ...catalogo].some((r) => normalizar(r) === norm)) return { ok: false, motivo: "repetida" };
  return { ok: true, texto };
}

function dataPorExtenso(agora: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" }).format(agora);
}

export function montarPrompt(agora: Date, base: FraseDoDia, segmento: SegmentoJornada, recentes: string[]) {
  const sistema = [
    "Você é a redatora oficial da Sra. Luck Cirurgia Programada, de Brasília.",
    "A Sra. Luck não é clínica: é a empresa que ajuda mulheres a realizar o sonho da cirurgia plástica com planejamento, parcelas que cabem no bolso e acompanhamento em cada etapa. Lema: \"Não vendemos promessas. Nós construímos caminhos.\"",
    "Escreva a frase do dia que aparece no app da cliente. Voz: acolhedora, confiante, elegante, responsável e simples. Fale com ela no feminino, usando \"você\".",
    "Regras obrigatórias:",
    "- Uma única frase curta (até 120 caracteres), em português do Brasil, com pontuação correta.",
    "- Marque UM trecho de destaque (2 a 6 palavras) entre asteriscos, por exemplo: Disciplina hoje, *resultados sempre*.",
    "- Você pode usar o marcador {nome} no máximo uma vez, só quando soar natural (o sistema troca pelo primeiro nome). Não invente nomes.",
    "- Proibido: falar de corpo, peso, medidas ou aparência; prometer resultado estético; termos médicos; medo, culpa, cobrança, dívida, juros ou descontos; emojis, hashtags, aspas e datas numéricas.",
    "- Seja original: não repita as ideias nem a estrutura das frases recentes.",
    "Responda somente com o JSON {\"texto\": \"...\"}.",
  ].join("\n");

  const especial = base.origem === "especial" ? `Hoje é data especial: ${base.tema}. A frase deve celebrar essa data com delicadeza.` : "";
  const mes = base.origem === "mes" ? "Hoje é o primeiro dia do mês: fale de começo de ciclo." : "";
  const temaSemana = TEMAS_SEMANA.find((t) => t.frases.includes(base.texto))?.tema ?? TEMAS_SEMANA[new Date(`${base.data}T12:00:00Z`).getUTCDay()].tema;
  const exemplos = TEMAS_SEMANA.map((t) => t.frases[0]).concat(TEMAS_SEMANA[2].frases[2]);
  const usuario = [
    `Data: ${dataPorExtenso(agora)}.`,
    `Tema do dia: ${temaSemana}.`,
    especial,
    mes,
    `Momento da cliente: ${SEGMENTOS[segmento]}.`,
    `Exemplos do tom da marca (não copie): ${exemplos.join(" | ")}`,
    recentes.length ? `Frases recentes, que você não pode repetir: ${recentes.join(" | ")}` : "",
  ].filter(Boolean).join("\n");

  return { sistema, usuario };
}

type RespostaGemini = { candidates?: { content?: { parts?: { text?: string }[] } }[] };

/** Chama o Gemini (REST generateContent). Retorna o texto bruto e o modelo usado. */
export async function chamarGemini(chave: string, modelos: string[], sistema: string, usuario: string, fetcher: typeof fetch = fetch) {
  let ultimoErro = "sem_modelo";
  for (const modelo of modelos) {
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
      // Modelo inexistente/aposentado: tenta o próximo da lista.
      if (resposta.status === 404) { ultimoErro = `http_404:${modelo}`; continue; }
      if (!resposta.ok) throw new Error(`http_${resposta.status}`);
      const corpo = await resposta.json() as RespostaGemini;
      const bruto = (corpo.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
      let texto = bruto;
      try { texto = String((JSON.parse(bruto) as { texto?: unknown }).texto ?? ""); } catch { /* resposta sem JSON: valida como texto puro */ }
      return { texto, modelo };
    } catch (erro) {
      ultimoErro = erro instanceof Error ? (erro.name === "AbortError" ? "timeout" : erro.message) : "erro";
      throw new Error(ultimoErro);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(ultimoErro);
}

async function credenciaisGemini(env: Env) {
  const [chave, modelo] = await Promise.all([obterCredencial(env, "gemini", "api_key"), obterCredencial(env, "gemini", "modelo")]);
  const modelos = [...new Set([modelo?.trim(), ...MODELOS_PADRAO].filter((m): m is string => Boolean(m)))];
  return { chave: chave?.trim() || null, modelos };
}

/** Gera e valida (até 2 tentativas). Retorna null quando não deu para usar a IA. */
async function gerarComIa(env: Env, agora: Date, base: FraseDoDia, segmento: SegmentoJornada, recentes: string[]) {
  const { chave, modelos } = await credenciaisGemini(env);
  if (!chave) return null;
  const { sistema, usuario } = montarPrompt(agora, base, segmento, recentes);
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    const { texto, modelo } = await chamarGemini(chave, modelos, sistema, usuario);
    const validacao = validarFraseIa(texto, recentes);
    if (validacao.ok) return { texto: validacao.texto, modelo };
  }
  return null;
}

/** Teste de conexão do painel de Integrações: gera uma frase de exemplo sem gravar. */
export async function testarGemini(env: Env) {
  const { chave, modelos } = await credenciaisGemini(env);
  if (!chave) return { conectado: false, detalhe: "Nenhuma chave do Gemini configurada." };
  try {
    const agora = new Date();
    const { sistema, usuario } = montarPrompt(agora, fraseDoDia(agora), "construindo", []);
    const { texto, modelo } = await chamarGemini(chave, modelos, sistema, usuario);
    const validacao = validarFraseIa(texto);
    return validacao.ok
      ? { conectado: true, detalhe: `Gemini respondeu (${modelo}). Exemplo: ${validacao.texto.replace(/\*/g, "")}` }
      : { conectado: true, detalhe: `Gemini respondeu (${modelo}), mas o exemplo foi reprovado pelos filtros (${validacao.motivo}). Em produção o sistema tenta de novo e, se preciso, usa o catálogo.` };
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : "erro";
    const detalhe = motivo === "http_400" || motivo === "http_403" ? "O Gemini recusou a chave (verifique se ela foi copiada inteira)." : motivo === "http_429" ? "Cota gratuita do Gemini esgotada no momento." : `Falha ao contatar o Gemini (${motivo}).`;
    return { conectado: false, detalhe };
  }
}

export async function fraseDoDiaApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/cliente/frase-do-dia" || request.method !== "GET") return null;
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);
  const sessao = await verificarTokenSessao(getCookie(request, "cliente_session"), env.CLIENTE_SESSION_SECRET);
  if (!sessao) return json({ erro: "Sessão expirada." }, 401);

  const log = requestLogger(request).child({ action: "client.daily_phrase" });
  const db = createServiceSupabaseClient(env);
  const agora = new Date();
  const base = fraseDoDia(agora);

  const [{ data: cliente }, { data: percentual }] = await Promise.all([
    db.from("clientes").select("nome").eq("id", sessao.clienteId).maybeSingle(),
    db.rpc("porcentagem_pagamento", { p_cliente_id: sessao.clienteId }),
  ]);
  const nome = primeiroNome((cliente as { nome?: string } | null)?.nome);
  const segmento = segmentoPorPercentual(Number(percentual ?? 0));
  const responder = (texto: string, origem: "ia" | "catalogo") => json({ texto: aplicarNome(texto, nome), tema: base.tema, data: base.data, origem, segmento });

  const { data: salva, error: erroCache } = await db.from("frases_do_dia").select("texto,origem").eq("data", base.data).eq("segmento", segmento).maybeSingle();
  if (erroCache) {
    // Cache indisponível (migration 079 não aplicada): não chama a IA sem cache para não gastar cota.
    log.warn("Cache da frase do dia indisponível", { eventCode: "DAILY_PHRASE_CACHE_UNAVAILABLE" });
    return responder(base.texto, "catalogo");
  }
  if (salva) return responder(salva.texto, salva.origem === "ia" ? "ia" : "catalogo");

  const { data: ultimas } = await db.from("frases_do_dia").select("texto").eq("origem", "ia").order("created_at", { ascending: false }).limit(24);
  const recentes = (ultimas ?? []).map((r: { texto: string }) => r.texto);

  let texto = base.texto;
  let origem: "ia" | "catalogo" = "catalogo";
  let modelo: string | null = null;
  try {
    const gerada = await gerarComIa(env, agora, base, segmento, recentes);
    if (gerada) { texto = gerada.texto; origem = "ia"; modelo = gerada.modelo; }
  } catch (erro) {
    log.warn("Gemini indisponível; usando catálogo", { eventCode: "DAILY_PHRASE_AI_FAILED", motivo: erro instanceof Error ? erro.message : "erro" });
  }

  // Se outra requisição gravou antes, prevalece a que já está no cache.
  await db.from("frases_do_dia").upsert({ data: base.data, segmento, tema: base.tema, texto, origem, modelo }, { onConflict: "data,segmento", ignoreDuplicates: true });
  const { data: final } = await db.from("frases_do_dia").select("texto,origem").eq("data", base.data).eq("segmento", segmento).maybeSingle();
  if (final) return responder(final.texto, final.origem === "ia" ? "ia" : "catalogo");
  return responder(texto, origem);
}
