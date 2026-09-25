/**
 * Regras operacionais configuráveis (migration_094, tabela regras_operacionais).
 *
 * Fonte única do prazo de liberação cirúrgica, do teto mensal operacional,
 * dos percentuais mínimos por plano e dos requisitos opcionais do acesso ao
 * app. O banco aplica as mesmas regras nas funções transacionais
 * (pode_agendar, calcular_prazo_cirurgico_v46, agenda_confirmar_previsao,
 * agenda_reservar_cirurgia).
 *
 * Leitura: qualquer Admin (GET /api/admin/regras-operacionais); o app da
 * cliente recebe só percentuais e prazo (GET /api/regras-operacionais).
 * Alteração: SOMENTE o Dev, pelo Dev Console (sessão técnica "dev-console:"
 * com papel owner/developer, validada em dev-console-auth.ts). O painel Admin
 * mostra os valores com cadeado e nunca envia alteração.
 */
import { DEV_CONSOLE_ADMIN_PREFIX } from "./dev-console-auth";
import { getCookie, verificarTokenAdmin } from "./session";
import { createServiceSupabaseClient, type Env } from "./supabase";

export type RegrasOperacionais = {
  prazoLiberacaoDiasUteis: number;
  tetoMensalOperacional: number;
  percentual12a24x: number;
  percentual36x: number;
  percentual48a72x: number;
  appExigeParcela: boolean;
  appExigeProcedimento: boolean;
  atualizadoEm: string | null;
  atualizadoPor: string | null;
};

/** Valores de antes da configuração (e de reserva se o banco não responder). */
export const REGRAS_PADRAO: RegrasOperacionais = {
  prazoLiberacaoDiasUteis: 5,
  tetoMensalOperacional: 100000,
  percentual12a24x: 60,
  percentual36x: 70,
  percentual48a72x: 80,
  appExigeParcela: true,
  appExigeProcedimento: false,
  atualizadoEm: null,
  atualizadoPor: null,
};

const COLUNAS: Record<Exclude<keyof RegrasOperacionais, "atualizadoEm" | "atualizadoPor">, string> = {
  prazoLiberacaoDiasUteis: "prazo_liberacao_dias_uteis",
  tetoMensalOperacional: "teto_mensal_operacional",
  percentual12a24x: "percentual_12_24x",
  percentual36x: "percentual_36x",
  percentual48a72x: "percentual_48_72x",
  appExigeParcela: "app_exige_parcela",
  appExigeProcedimento: "app_exige_procedimento",
};

let atuais: RegrasOperacionais = REGRAS_PADRAO;
let carregadoEm = 0;
const VALIDADE_MS = 60_000;
let atualizacaoEmCurso: Promise<RegrasOperacionais> | null = null;

export function regrasOperacionais(): RegrasOperacionais {
  return atuais;
}

export function deLinha(linha: Record<string, unknown> | null | undefined): RegrasOperacionais {
  if (!linha) return REGRAS_PADRAO;
  const num = (v: unknown, padrao: number) => (Number.isFinite(Number(v)) && v !== null ? Number(v) : padrao);
  return {
    prazoLiberacaoDiasUteis: num(linha.prazo_liberacao_dias_uteis, REGRAS_PADRAO.prazoLiberacaoDiasUteis),
    tetoMensalOperacional: num(linha.teto_mensal_operacional, REGRAS_PADRAO.tetoMensalOperacional),
    percentual12a24x: num(linha.percentual_12_24x, REGRAS_PADRAO.percentual12a24x),
    percentual36x: num(linha.percentual_36x, REGRAS_PADRAO.percentual36x),
    percentual48a72x: num(linha.percentual_48_72x, REGRAS_PADRAO.percentual48a72x),
    appExigeParcela: typeof linha.app_exige_parcela === "boolean" ? linha.app_exige_parcela : REGRAS_PADRAO.appExigeParcela,
    appExigeProcedimento: typeof linha.app_exige_procedimento === "boolean" ? linha.app_exige_procedimento : REGRAS_PADRAO.appExigeProcedimento,
    atualizadoEm: typeof linha.atualizado_em === "string" ? linha.atualizado_em : null,
    atualizadoPor: typeof linha.atualizado_por === "string" ? linha.atualizado_por : null,
  };
}

/** Recarrega do banco no máximo uma vez por minuto por instância. */
export async function atualizarRegrasOperacionais(env: Env, forcar = false) {
  if (atualizacaoEmCurso) return atualizacaoEmCurso;
  if (!forcar && Date.now() - carregadoEm < VALIDADE_MS) return atuais;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return atuais;
  // A cold isolate can receive many requests at once. Coalesce the refresh,
  // then offset the next refresh across isolates to avoid a synchronized wave.
  const pending = (async () => {
    const { data, error } = await createServiceSupabaseClient(env).from("regras_operacionais")
      .select("prazo_liberacao_dias_uteis,teto_mensal_operacional,percentual_12_24x,percentual_36x,percentual_48_72x,app_exige_parcela,app_exige_procedimento,atualizado_em,atualizado_por")
      .eq("id", 1).maybeSingle();
    if (!error) atuais = deLinha(data as Record<string, unknown> | null);
    carregadoEm = Date.now() - Math.floor(Math.random() * (VALIDADE_MS / 4));
    return atuais;
  })();
  atualizacaoEmCurso = pending;
  try { return await pending; } finally { atualizacaoEmCurso = null; }
}

/** Percentual mínimo de parcelas pagas para o plano (mesma regra de pode_agendar). */
export function percentualMinimoPlano(quantidadeParcelas: number | null | undefined, regras = atuais) {
  if ([12, 18, 24].includes(Number(quantidadeParcelas))) return regras.percentual12a24x;
  if (Number(quantidadeParcelas) === 36) return regras.percentual36x;
  return regras.percentual48a72x;
}

/** Requisitos opcionais do acesso ao app, no formato de getAppAccessRequirements. */
export function opcoesAcessoApp(regras = atuais) {
  return { requireFinancial: regras.appExigeParcela, requireProcedure: regras.appExigeProcedimento };
}

type Campo = keyof typeof COLUNAS;
const LIMITES: Record<Campo, { tipo: "inteiro" | "numero" | "booleano"; min?: number; max?: number; nome: string }> = {
  prazoLiberacaoDiasUteis: { tipo: "inteiro", min: 1, max: 30, nome: "Prazo de liberação (dias úteis)" },
  tetoMensalOperacional: { tipo: "numero", min: 1, max: 100_000_000, nome: "Teto mensal operacional" },
  percentual12a24x: { tipo: "numero", min: 1, max: 100, nome: "Percentual 12x, 18x e 24x" },
  percentual36x: { tipo: "numero", min: 1, max: 100, nome: "Percentual 36x" },
  percentual48a72x: { tipo: "numero", min: 1, max: 100, nome: "Percentual 48x, 60x e 72x" },
  appExigeParcela: { tipo: "booleano", nome: "Acesso ao app exige parcela" },
  appExigeProcedimento: { tipo: "booleano", nome: "Acesso ao app exige procedimento" },
};

export const CAMPOS_REGRAS = Object.keys(COLUNAS) as Campo[];

/** Valida um pedido de alteração vindo do Dev Console. Retorna o patch em colunas do banco. */
export function validarAlteracaoRegras(body: Record<string, unknown>): { ok: true; patch: Record<string, unknown> } | { ok: false; erro: string } {
  const chaves = Object.keys(body);
  if (!chaves.length) return { ok: false, erro: "Informe ao menos uma regra para alterar." };
  const desconhecida = chaves.find((c) => !(c in COLUNAS));
  if (desconhecida) return { ok: false, erro: `Regra desconhecida: ${desconhecida}.` };
  const patch: Record<string, unknown> = {};
  for (const chave of chaves as Campo[]) {
    const regra = LIMITES[chave];
    const valor = body[chave];
    if (regra.tipo === "booleano") {
      if (typeof valor !== "boolean") return { ok: false, erro: `${regra.nome}: use verdadeiro ou falso.` };
    } else {
      if (typeof valor !== "number" || !Number.isFinite(valor) || (regra.tipo === "inteiro" && !Number.isInteger(valor))) return { ok: false, erro: `${regra.nome}: valor inválido.` };
      if (valor < (regra.min ?? -Infinity) || valor > (regra.max ?? Infinity)) return { ok: false, erro: `${regra.nome}: use um valor entre ${regra.min} e ${regra.max}.` };
    }
    patch[COLUNAS[chave]] = valor;
  }
  return { ok: true, patch };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function regrasOperacionaisApi(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  // App da cliente: só o que a cliente vê (percentuais e prazo). Teto e requisitos ficam internos.
  if (path === "/api/regras-operacionais" && request.method === "GET") {
    const r = await atualizarRegrasOperacionais(env);
    return json({ percentual12a24x: r.percentual12a24x, percentual36x: r.percentual36x, percentual48a72x: r.percentual48a72x, prazoLiberacaoDiasUteis: r.prazoLiberacaoDiasUteis });
  }

  if (path !== "/api/admin/regras-operacionais") return null;
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Sessão administrativa indisponível." }, 503);
  const sessao = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  if (!sessao?.adminId) return json({ erro: "Sessão administrativa expirada." }, 401);
  const ehDev = sessao.adminId.startsWith(DEV_CONSOLE_ADMIN_PREFIX);

  if (request.method === "GET") return json({ regras: await atualizarRegrasOperacionais(env, true), editavelPorVoce: ehDev, alteracao: "Somente o Dev, pelo Dev Console." });

  if (request.method !== "POST") return json({ erro: "Método não suportado." }, 405);
  if (!ehDev) return json({ erro: "Estas regras são protegidas: somente o Dev pode alterá-las, pelo Dev Console." }, 403);

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return json({ erro: "Payload inválido." }, 400); }
  const validacao = validarAlteracaoRegras(body);
  if (!validacao.ok) return json({ erro: validacao.erro }, 400);

  const db = createServiceSupabaseClient(env);
  const antes = await atualizarRegrasOperacionais(env, true);
  const { data, error } = await db.from("regras_operacionais")
    .update({ ...validacao.patch, atualizado_em: new Date().toISOString(), atualizado_por: sessao.adminId })
    .eq("id", 1).select("*").single();
  if (error) return json({ erro: "Não foi possível salvar as regras." }, 500);
  const depois = deLinha(data as Record<string, unknown>);
  atuais = depois; carregadoEm = Date.now();
  await db.from("logs_alteracoes").insert({ usuario: sessao.adminId, acao: "alterou_regras_operacionais", entidade: "regras_operacionais", detalhes: { antes, depois, campos: Object.keys(body) } });
  return json({ regras: depois, mensagem: "Regras operacionais atualizadas." });
}
