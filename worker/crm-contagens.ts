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
 * A mesma leitura grava o espelho do RD (crm-espelho): cada negociação e, depois dos funis,
 * todos os contatos.
 */
import { createServiceSupabaseClient, type Env } from "./supabase";
import { dataRdql, listarSeguro, objectValue, paginaContatos, paginaDeals, stringValue, TAMANHO_PAGINA_RD } from "./rd-station-readonly";
import { gravarContatos, gravarNegociacoes, limparEspelho } from "./crm-espelho";

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
  /**
   * Depois dos funis, a mesma varredura lê todos os contatos do RD para o espelho (migration_122).
   * `semFiltroData`: o RD recusou o filtro por data e a leitura seguiu pelo número da página.
   */
  contatos?: { desde: string | null; pagina: number; noLimite: string[]; lidos: number; concluidos: boolean; semFiltroData?: boolean; semOrdem?: boolean; incompleta?: boolean };
  /** Negociações e contatos gravados no espelho nesta varredura. */
  espelho?: { negociacoes: number; contatos: number; concluidoEm: string | null; erro?: string | null };
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
  paginaContatos?: (desde: string | null, pagina: number, ordenar?: boolean) => Promise<Json[]>;
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
      e = {
        passada: crypto.randomUUID(), iniciadaEm: agora, concluidaEm: null, funis, indice: 0, desde: null, pagina: 1, noLimite: [], parcial: {}, nomes, resultado: e?.resultado ?? null,
        contatos: { desde: null, pagina: 1, noLimite: [], lidos: 0, concluidos: false }, espelho: { negociacoes: 0, contatos: 0, concluidoEm: null },
      };
    } else if (e.concluidaEm) {
      return { executada: false, motivo: "em_dia", atualizadoEm: e.resultado?.atualizadoEm ?? null };
    }
    const lerPagina = deps.pagina ?? ((f: string, d: string | null, p: number) => paginaDeals(env, f, d, p));
    const lerContatos = deps.paginaContatos ?? ((d: string | null, p: number, o?: boolean) => paginaContatos(env, d, p, o));
    e.espelho ??= { negociacoes: 0, contatos: 0, concluidoEm: null };
    e.contatos ??= { desde: null, pagina: 1, noLimite: [], lidos: 0, concluidos: false };
    let lidas = 0;
    while (e.indice < e.funis.length && relogio() < prazo) {
      const funil = e.funis[e.indice];
      const pagina = await lerPagina(`pipeline_id:${funil}`, e.desde, e.pagina);
      const contagem = e.parcial[funil] ?? (e.parcial[funil] = vazia());
      const vistas = new Set(e.noLimite);
      const novas: Json[] = [];
      for (const deal of pagina) {
        const id = stringValue(deal.id);
        if (id && vistas.has(id)) continue;
        if (id) vistas.add(id);
        contar(contagem, deal);
        novas.push(deal);
        lidas++;
      }
      // Espelho: a mesma leitura grava a negociação (nenhuma consulta a mais ao RD).
      await gravarNegociacoes(db, novas, e.iniciadaEm);
      e.espelho.negociacoes += novas.length;
      if (pagina.length < TAMANHO_PAGINA_RD) {
        e.indice++; e.desde = null; e.pagina = 1; e.noLimite = [];
      } else {
        const ultima = dataRdql(pagina[pagina.length - 1].created_at);
        if (ultima && ultima !== e.desde) { e.desde = ultima; e.pagina = 1; } else e.pagina++;
        e.noLimite = [...vistas].filter((id) => pagina.some((d) => stringValue(d.id) === id && dataRdql(d.created_at) === e!.desde));
      }
      await salvar(db, e);
    }
    if (e.indice >= e.funis.length && Object.keys(e.parcial).length) {
      // Contagem pronta assim que os funis acabam; os contatos vêm em seguida.
      e.resultado = { atualizadoEm: new Date(relogio()).toISOString(), porFunil: e.parcial, nomes: e.nomes };
      e.parcial = {};
      await salvar(db, e);
    }
    // Todos os contatos do RD (para reconhecer cadastros da mesma pessoa), na mesma ordem por data.
    const ct = e.contatos;
    while (e.indice >= e.funis.length && !ct.concluidos && relogio() < prazo) {
      let pagina: Json[];
      try {
        pagina = await lerContatos(ct.semFiltroData ? null : ct.desde, ct.pagina, !ct.semOrdem);
      } catch (erro) {
        const recusado = erro instanceof Error && /^RD_HTTP_(400|422)$/.test(erro.message);
        // O RD recusou o filtro por data: segue pelo número da página; recusou a ordenação: lê sem ela.
        // Se nada for aceito, os contatos ficam de fora desta varredura, mas a contagem e as negociações nunca travam.
        if (recusado && !ct.semFiltroData && ct.desde) { ct.semFiltroData = true; ct.desde = null; ct.pagina = 1; ct.noLimite = []; continue; }
        if (recusado && !ct.semOrdem) { ct.semOrdem = true; ct.semFiltroData = true; ct.desde = null; ct.pagina = 1; ct.noLimite = []; continue; }
        if (recusado) { ct.concluidos = true; ct.incompleta = true; break; }
        throw erro;
      }
      const vistos = new Set(ct.noLimite);
      const novos = pagina.filter((c) => { const id = stringValue(c.id); if (!id || vistos.has(id)) return false; vistos.add(id); return true; });
      await gravarContatos(db, novos, e.iniciadaEm);
      ct.lidos += novos.length;
      e.espelho.contatos += novos.length;
      if (pagina.length < TAMANHO_PAGINA_RD) {
        ct.concluidos = true;
      } else if (ct.semFiltroData) {
        // Sem filtro por data o RD só deixa navegar 10 mil registros.
        if (ct.pagina >= 100) { ct.concluidos = true; ct.incompleta = true; } else ct.pagina++;
      } else {
        const ultima = dataRdql(pagina[pagina.length - 1].created_at);
        if (ultima && ultima !== ct.desde) { ct.desde = ultima; ct.pagina = 1; } else ct.pagina++;
        ct.noLimite = [...vistos].filter((id) => pagina.some((c) => stringValue(c.id) === id && dataRdql(c.created_at) === ct.desde));
      }
      await salvar(db, e);
    }
    if (e.indice >= e.funis.length && ct.concluidos) {
      // Varredura completa: o que não foi visto não existe mais no RD. Contatos só com a leitura inteira.
      await limparEspelho(db, e.iniciadaEm, { contatos: !ct.incompleta });
      e.concluidaEm = new Date(relogio()).toISOString();
      e.espelho.concluidoEm = e.concluidaEm;
      e.espelho.erro = ct.incompleta ? "O RD não permitiu ler todos os contatos nesta varredura (filtro por data recusado): outros cadastros da mesma pessoa podem ficar de fora até a próxima." : null;
      await salvar(db, e);
    }
    return { executada: true, lidas, contatos: ct.lidos, concluida: Boolean(e.concluidaEm), funil: Math.min(e.indice + 1, e.funis.length), funis: e.funis.length };
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
