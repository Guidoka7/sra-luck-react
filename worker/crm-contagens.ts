/**
 * Contagem exata das negociações de TODOS os funis do RD, detalhada por status, etapa,
 * responsável e mês de criação.
 *
 * O RD não informa totais e aceita 120 consultas/min. Contar cada combinação (status × etapa ×
 * responsável × mês) custaria centenas de consultas; aqui as negociações são lidas uma única vez,
 * página por página (100 por página, em ordem de criação), e todas as contagens saem da mesma
 * leitura. A varredura roda em etapas (rodada de 5 min, só quando não há importação em andamento),
 * guarda a posição em integracao_catalogos (crm_contagens) e recomeça a cada 6 h. Cada consulta
 * filtra created_at >= posição, então nunca encosta no limite de 10 mil registros por filtro.
 */
import { createServiceSupabaseClient, type Env } from "./supabase";
import { dataRdql, listarSeguro, objectValue, paginaDeals, stringValue, TAMANHO_PAGINA_RD } from "./rd-station-readonly";

type Json = Record<string, any>;
type Db = ReturnType<typeof createServiceSupabaseClient>;

export type ContagemFunil = {
  total: number;
  status: Record<string, number>;
  etapas: Record<string, number>;
  responsaveis: Record<string, number>;
  meses: Record<string, number>;
};

export type EstadoContagens = {
  passada: string;
  iniciadaEm: string;
  concluidaEm: string | null;
  funis: string[];
  indice: number;
  desde: string | null;
  pagina: number;
  /** Já contadas no segundo de `desde` (a consulta seguinte as devolve de novo). */
  noLimite: string[];
  parcial: Record<string, ContagemFunil>;
  /** Nome de cada responsável (owner_id) no momento da contagem. */
  nomes: Record<string, string>;
  resultado: { atualizadoEm: string; porFunil: Record<string, ContagemFunil>; nomes: Record<string, string> } | null;
};

const CHAVE = "crm_contagens";
export const VALIDADE_CONTAGENS_MS = 6 * 60 * 60_000;
const ORCAMENTO_MS = 150_000;

type Deps = {
  db?: Db;
  relogio?: () => number;
  orcamentoMs?: number;
  /** IDs de todos os funis do RD (padrão: catálogo). */
  funis?: () => Promise<string[]>;
  usuarios?: () => Promise<Json[]>;
  pagina?: (filtro: string, desde: string | null, pagina: number) => Promise<Json[]>;
};

const vazia = (): ContagemFunil => ({ total: 0, status: {}, etapas: {}, responsaveis: {}, meses: {} });
const somar = (m: Record<string, number>, chave: string) => { m[chave] = (m[chave] ?? 0) + 1; };

/** Soma uma negociação na contagem do funil. */
export function contar(c: ContagemFunil, deal: Json) {
  c.total++;
  somar(c.status, stringValue(deal.status) || "sem_status");
  somar(c.etapas, stringValue(deal.stage_id ?? objectValue(deal.stage).id) || "sem_etapa");
  somar(c.responsaveis, stringValue(deal.owner_id ?? objectValue(deal.owner).id) || "sem_responsavel");
  somar(c.meses, stringValue(deal.created_at).slice(0, 7) || "sem_data");
}

export async function lerContagens(db: Db): Promise<EstadoContagens | null> {
  const { data } = await db.from("integracao_catalogos").select("dados").eq("provedor", "rd_station").eq("chave", CHAVE).maybeSingle();
  const e = objectValue((data as Json | null)?.dados);
  return typeof e.passada === "string" && Array.isArray(e.funis) ? e as EstadoContagens : null;
}

async function salvar(db: Db, e: EstadoContagens) {
  await db.from("integracao_catalogos").upsert({ provedor: "rd_station", chave: CHAVE, dados: e, atualizado_em: new Date().toISOString() }, { onConflict: "provedor,chave" });
}

async function funisDoCatalogo(db: Db): Promise<string[]> {
  const { data } = await db.from("integracao_catalogos").select("dados").eq("provedor", "rd_station").eq("chave", "crm_funis").maybeSingle();
  return ((objectValue((data as Json | null)?.dados).funis ?? []) as Json[]).map((f) => stringValue(f.id)).filter(Boolean);
}

/**
 * Avança a contagem dentro do orçamento. Começa uma varredura nova quando não há nenhuma ou a última
 * concluída tem mais de 6 h; senão continua de onde parou.
 */
export async function avancarContagens(env: Env, deps: Deps = {}) {
  const db = deps.db ?? createServiceSupabaseClient(env);
  const relogio = deps.relogio ?? Date.now;
  const prazo = relogio() + (deps.orcamentoMs ?? ORCAMENTO_MS);
  const { data: trava } = await db.rpc("integracao_tentar_trava", { p_nome: "crm_contagens", p_segundos: 240 });
  if (trava === false) return { executada: false, motivo: "em_andamento" };
  try {
    let e = await lerContagens(db);
    const agora = new Date(relogio()).toISOString();
    if (!e || (e.concluidaEm && relogio() - Date.parse(e.concluidaEm) >= VALIDADE_CONTAGENS_MS)) {
      const funis = await (deps.funis ?? (() => funisDoCatalogo(db)))();
      if (!funis.length) return { executada: false, motivo: "catalogo_vazio" };
      const usuarios = await (deps.usuarios ?? (() => listarSeguro(env, "users")))();
      const nomes = Object.fromEntries(usuarios.map((u) => [stringValue(u.id), stringValue(u.name)]).filter(([id, nome]) => id && nome));
      e = { passada: crypto.randomUUID(), iniciadaEm: agora, concluidaEm: null, funis, indice: 0, desde: null, pagina: 1, noLimite: [], parcial: {}, nomes, resultado: e?.resultado ?? null };
    } else if (e.concluidaEm) {
      return { executada: false, motivo: "em_dia", atualizadoEm: e.resultado?.atualizadoEm ?? null };
    }
    const lerPagina = deps.pagina ?? ((f: string, d: string | null, p: number) => paginaDeals(env, f, d, p));
    let lidas = 0;
    while (e.indice < e.funis.length && relogio() < prazo) {
      const funil = e.funis[e.indice];
      const pagina = await lerPagina(`pipeline_id:${funil}`, e.desde, e.pagina);
      const contagem = e.parcial[funil] ?? (e.parcial[funil] = vazia());
      const vistas = new Set(e.noLimite);
      for (const deal of pagina) {
        const id = stringValue(deal.id);
        if (id && vistas.has(id)) continue;
        if (id) vistas.add(id);
        contar(contagem, deal);
        lidas++;
      }
      if (pagina.length < TAMANHO_PAGINA_RD) {
        e.indice++; e.desde = null; e.pagina = 1; e.noLimite = [];
      } else {
        const ultima = dataRdql(pagina[pagina.length - 1].created_at);
        if (ultima && ultima !== e.desde) { e.desde = ultima; e.pagina = 1; } else e.pagina++;
        e.noLimite = [...vistas].filter((id) => pagina.some((d) => stringValue(d.id) === id && dataRdql(d.created_at) === e!.desde));
      }
      await salvar(db, e);
    }
    if (e.indice >= e.funis.length) {
      e.concluidaEm = new Date(relogio()).toISOString();
      e.resultado = { atualizadoEm: e.concluidaEm, porFunil: e.parcial, nomes: e.nomes };
      e.parcial = {};
      await salvar(db, e);
    }
    return { executada: true, lidas, concluida: Boolean(e.concluidaEm), funil: Math.min(e.indice + 1, e.funis.length), funis: e.funis.length };
  } finally {
    await db.rpc("integracao_liberar_trava", { p_nome: "crm_contagens" });
  }
}

/** Contagens prontas para a tela: nomes de etapa (do catálogo) e de responsável. */
export function contagensParaTela(e: EstadoContagens | null, funis: { id: string; etapas?: { id: string; nome: string }[] }[]) {
  const r = e?.resultado;
  if (!r) return { atualizadoEm: null, emAndamento: Boolean(e && !e.concluidaEm), porFunil: {} as Record<string, Json> };
  const porFunil: Record<string, Json> = {};
  for (const f of funis) {
    const c = r.porFunil[f.id];
    if (!c) continue;
    const nomeEtapa = new Map((f.etapas ?? []).map((x) => [x.id, x.nome]));
    const lista = (m: Record<string, number>, nome: (k: string) => string) => Object.entries(m)
      .map(([chave, negociacoes]) => ({ chave, nome: nome(chave), negociacoes })).sort((a, b) => b.negociacoes - a.negociacoes);
    porFunil[f.id] = {
      total: c.total,
      status: c.status,
      etapas: lista(c.etapas, (k) => nomeEtapa.get(k) ?? (k === "sem_etapa" ? "Sem etapa" : "Etapa removida do funil")),
      responsaveis: lista(c.responsaveis, (k) => r.nomes[k] ?? (k === "sem_responsavel" ? "Sem responsável" : "Usuário removido do RD")),
      meses: Object.entries(c.meses).map(([mes, negociacoes]) => ({ mes, negociacoes })).sort((a, b) => a.mes.localeCompare(b.mes)),
    };
  }
  return { atualizadoEm: r.atualizadoEm, emAndamento: Boolean(e && !e.concluidaEm), porFunil };
}
