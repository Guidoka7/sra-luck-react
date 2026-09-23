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
 * GEMINI_API_KEY. O modelo é escolhido sozinho entre os disponíveis para a
 * chave (ListModels); dá para fixar um em GEMINI_MODEL / campo "modelo".
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

// Reserva quando a listagem de modelos do Google não responde (todos com plano
// gratuito em set/2026). Normalmente a lista vem de descobrirModelos(), que
// acompanha sozinha os modelos que o Google lança e aposenta.
const MODELOS_PADRAO = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3-flash-latest", "gemini-3.8-flash", "gemini-3.5-flash"];
const MAX_MODELOS = 5;
const TIMEOUT_MS = 10_000;
const PRAZO_TOTAL_MS = 24_000;
const VALIDADE_LISTA_MS = 6 * 3_600_000;
const NOVA_TENTATIVA_MS = 30 * 60_000;

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

export class ErroGemini extends Error {
  constructor(public motivo: string, public tentativas: string[]) { super(motivo); }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NAO_TEXTO = /(image|tts|live|audio|transcri|embedding|translate|omni|robotic|computer|vision|aqa|thinking)/;

function versao(modelo: string) {
  const m = modelo.match(/gemini-(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

/**
 * Ordena os modelos de texto "flash" disponíveis para a chave: primeiro os
 * estáveis leves (rápidos e com mais cota gratuita), depois os flash estáveis,
 * os apelidos "-latest" e por último as prévias. Dentro de cada grupo, o mais novo antes.
 */
export function ordenarModelos(nomes: string[]) {
  const candidatos = [...new Set(nomes.map((n) => n.replace(/^models\//, "")))]
    .filter((n) => /^gemini-/.test(n) && /flash/.test(n) && !NAO_TEXTO.test(n));
  const grupo = (n: string) => {
    if (/preview|exp/.test(n)) return 4;
    if (/latest/.test(n)) return 3;
    if (/-\d{2,}$/.test(n)) return 4; // versões datadas/fixas antigas
    return /lite/.test(n) ? 1 : 2;
  };
  return candidatos.sort((a, b) => grupo(a) - grupo(b) || versao(b) - versao(a) || a.localeCompare(b));
}

let listaEmCache: { chave: string; modelos: string[]; ate: number } | null = null;

/** Lista (ListModels) os modelos que esta chave pode usar. Guarda por 6 h na memória do servidor. */
export async function descobrirModelos(chave: string, fetcher: typeof fetch = fetch): Promise<string[] | null> {
  if (listaEmCache && listaEmCache.chave === chave && listaEmCache.ate > Date.now()) return listaEmCache.modelos;
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), 6_000);
  try {
    const resposta = await fetcher("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": chave }, signal: controle.signal });
    if (!resposta.ok) return null;
    const corpo = await resposta.json() as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
    const nomes = (corpo.models ?? []).filter((m) => m.name && (m.supportedGenerationMethods ?? []).includes("generateContent")).map((m) => m.name!);
    const modelos = ordenarModelos(nomes);
    if (!modelos.length) return null;
    listaEmCache = { chave, modelos, ate: Date.now() + VALIDADE_LISTA_MS };
    return modelos;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Erro 400/403 que indica chave inválida ou API desativada (não adianta tentar outro modelo). */
function erroDeChave(corpo: string) {
  return /api[ _-]?key|API_KEY_INVALID|SERVICE_DISABLED|has not been used|permission denied on resource project/i.test(corpo);
}

/**
 * Chama o Gemini (REST generateContent). Tenta os modelos em ordem: 404, 429,
 * 5xx, timeout e 400/403 sem relação com a chave passam para o próximo; chave
 * recusada para na hora. Se todos estiverem só sobrecarregados, faz mais uma rodada após 1,5 s.
 */
export async function chamarGemini(chave: string, modelos: string[], sistema: string, usuario: string, fetcher: typeof fetch = fetch, pausaMs = 1_500) {
  const inicio = Date.now();
  const tentativas: string[] = [];
  for (let rodada = 0; rodada < 2; rodada += 1) {
    for (const modelo of modelos) {
      if (Date.now() - inicio > PRAZO_TOTAL_MS) throw new ErroGemini("prazo_esgotado", tentativas);
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
        if (resposta.status === 401 || ((resposta.status === 400 || resposta.status === 403) && erroDeChave(await resposta.text().catch(() => "")))) {
          tentativas.push(`${modelo}:${resposta.status}`);
          throw new ErroGemini(`http_${resposta.status}`, tentativas);
        }
        if (!resposta.ok) { tentativas.push(`${modelo}:${resposta.status}`); continue; }
        const corpo = await resposta.json() as RespostaGemini;
        const bruto = (corpo.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
        if (!bruto) { tentativas.push(`${modelo}:vazio`); continue; }
        let texto = bruto;
        try { texto = String((JSON.parse(bruto) as { texto?: unknown }).texto ?? ""); } catch { /* resposta sem JSON: valida como texto puro */ }
        return { texto, modelo };
      } catch (erro) {
        if (erro instanceof ErroGemini) throw erro;
        tentativas.push(`${modelo}:${erro instanceof Error && erro.name === "AbortError" ? "timeout" : "rede"}`);
      } finally {
        clearTimeout(timer);
      }
    }
    const soSobrecarga = tentativas.every((t) => /:(5\d\d|timeout|vazio)$/.test(t));
    if (!soSobrecarga || rodada === 1) break;
    await esperar(pausaMs);
  }
  const ultimo = tentativas[tentativas.length - 1]?.split(":")[1] ?? "erro";
  throw new ErroGemini(/^\d+$/.test(ultimo) ? `http_${ultimo}` : ultimo, tentativas);
}

async function credenciaisGemini(env: Env) {
  const [chave, modelo] = await Promise.all([obterCredencial(env, "gemini", "api_key"), obterCredencial(env, "gemini", "modelo")]);
  const chaveLimpa = chave?.trim() || null;
  const disponiveis = chaveLimpa ? await descobrirModelos(chaveLimpa) : null;
  const modelos = [...new Set([modelo?.trim(), ...(disponiveis ?? MODELOS_PADRAO)].filter((m): m is string => Boolean(m)))].slice(0, MAX_MODELOS);
  return { chave: chaveLimpa, modelos };
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
    const tentativas = erro instanceof ErroGemini && erro.tentativas.length ? ` Tentativas: ${erro.tentativas.join(", ")}.` : "";
    const detalhe = motivo === "http_400" || motivo === "http_401" || motivo === "http_403"
      ? "O Gemini recusou a chave (verifique se ela foi copiada inteira e se a Generative Language API está ativa)."
      : motivo === "http_429"
        ? "Cota gratuita do Gemini esgotada no momento. Tente mais tarde."
        : /^http_5\d\d$|timeout|prazo_esgotado/.test(motivo)
          ? "O Gemini está sobrecarregado agora (erro do Google, não da chave). O app segue com o catálogo e tenta de novo no próximo dia."
          : `Falha ao contatar o Gemini (${motivo}).`;
    return { conectado: false, detalhe: detalhe + tentativas };
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

  const { data: salva, error: erroCache } = await db.from("frases_do_dia").select("id,texto,origem,created_at").eq("data", base.data).eq("segmento", segmento).maybeSingle();
  if (erroCache) {
    // Cache indisponível (migration 079 não aplicada): não chama a IA sem cache para não gastar cota.
    log.warn("Cache da frase do dia indisponível", { eventCode: "DAILY_PHRASE_CACHE_UNAVAILABLE" });
    return responder(base.texto, "catalogo");
  }
  if (salva?.origem === "ia") return responder(salva.texto, "ia");
  // Frase de reserva (catálogo) gravada após uma falha: tenta a IA de novo a cada 30 min.
  if (salva && Date.now() - new Date(salva.created_at).getTime() < NOVA_TENTATIVA_MS) return responder(salva.texto, "catalogo");

  const { data: ultimas } = await db.from("frases_do_dia").select("texto").eq("origem", "ia").order("created_at", { ascending: false }).limit(24);
  const recentes = (ultimas ?? []).map((r: { texto: string }) => r.texto);

  let gerada: { texto: string; modelo: string } | null = null;
  try {
    gerada = await gerarComIa(env, agora, base, segmento, recentes);
  } catch (erro) {
    log.warn("Gemini indisponível; usando catálogo", {
      eventCode: "DAILY_PHRASE_AI_FAILED",
      motivo: erro instanceof Error ? erro.message : "erro",
      tentativas: erro instanceof ErroGemini ? erro.tentativas.join(",") : undefined,
    });
  }

  if (salva) {
    // Reserva antiga: sobe para a frase da IA (ou renova o prazo da próxima tentativa).
    const patch = gerada ? { texto: gerada.texto, origem: "ia", modelo: gerada.modelo, created_at: new Date().toISOString() } : { created_at: new Date().toISOString() };
    await db.from("frases_do_dia").update(patch).eq("id", salva.id).eq("origem", "catalogo");
  } else {
    // Se outra requisição gravou antes, prevalece a que já está no cache.
    await db.from("frases_do_dia").upsert(
      { data: base.data, segmento, tema: base.tema, texto: gerada?.texto ?? base.texto, origem: gerada ? "ia" : "catalogo", modelo: gerada?.modelo ?? null },
      { onConflict: "data,segmento", ignoreDuplicates: true },
    );
  }
  const { data: final } = await db.from("frases_do_dia").select("texto,origem").eq("data", base.data).eq("segmento", segmento).maybeSingle();
  if (final) return responder(final.texto, final.origem === "ia" ? "ia" : "catalogo");
  return gerada ? responder(gerada.texto, "ia") : responder(base.texto, "catalogo");
}
