/**
 * Catálogo do RD Station CRM pré-calculado por funil.
 *
 * Antes, abrir a configuração lia TODOS os contatos e TODAS as negociações de cada funil
 * no RD (dezenas de páginas em sequência) só para descobrir os campos: passava de 30 s.
 * Agora o catálogo é montado com poucas leituras e guardado em `integracao_catalogos`:
 *
 *   - funis e etapas;
 *   - campos personalizados do funil: as regras de exibição do próprio RD
 *     (`display_rules` → `deal_pipeline_id`) + as chaves vistas nas 100 negociações
 *     mais recentes do funil e nos contatos delas (sem catálogo global);
 *   - valores selecionáveis para filtro (responsável/vendedora, fonte, campanha e
 *     campos de opção);
 *   - sugestão explícita de origem para cada dado do Sra Luck.
 *
 * A tela lê o catálogo guardado (instantâneo). O agendador o renova quando vence e o
 * Dev pode pedir "Atualizar do RD". Sem a migration_115, o catálogo fica só em memória.
 */
import { configDaFuncao, rotuloNativoCrm, type CampoCrm, type ConfigCrm } from "./integracoes-registro";
import { camposDisponiveisDoFunil, type CampoCatalogoCrm } from "./crm-opcoes-por-funil";
import { arrayValue, lerContatosPorId, listarTudo, objectValue, rdGet, stringValue } from "./rd-station-readonly";
import { createServiceSupabaseClient, type Env } from "./supabase";

type Json = Record<string, any>;
type Db = ReturnType<typeof createServiceSupabaseClient>;

export const CATALOGO_VALIDADE_MS = 6 * 60 * 60_000;
export const AMOSTRA_NEGOCIACOES = 100;
const CONCORRENCIA_FUNIS = 4;
const TIPOS_OPCAO = new Set(["option", "multiple_choice"]);

/** Origens nativas que fazem sentido como dado da venda (IDs internos ficam de fora). */
const NATIVOS_NAO_MAPEAVEIS = new Set(["deal_field:pipeline_id", "deal_field:stage_id", "deal_field:user_id", "deal_field:updated_at", "deal_field:status"]);

export type FonteCatalogo = {
  fonte: string;
  rotulo: string;
  grupo: "deal_nativo" | "deal_personalizado" | "contact_nativo" | "contact_personalizado";
  tipo: string;
  mapeavel: boolean;
  /** Negociações (ou contatos) da amostra com valor preenchido. */
  preenchidas: number;
};
export type ValorFiltro = { valor: string; rotulo: string; negociacoes: number };
export type FiltroCatalogo = { fonte: string; rotulo: string; valores: ValorFiltro[] };
export type FunilCatalogo = {
  id: string;
  nome: string;
  etapas: { id: string; nome: string }[];
  /** Compatibilidade com o editor atual. */
  campos: CampoCatalogoCrm[];
  camposNativos: { fonte: string; rotulo: string }[];
  fontes: FonteCatalogo[];
  filtros: FiltroCatalogo[];
  sugestoes: Partial<Record<CampoCrm, string>>;
  amostra: { negociacoes: number; contatos: number; contatosIndisponiveis: boolean };
};
export type CatalogoCrm = {
  funis: FunilCatalogo[];
  campos: [];
  camposNativos: [];
  escopoCampos: "por_funil";
  catalogo: { atualizadoEm: string; duracaoMs: number; origem: "armazenado" | "recalculado" | "memoria"; vencido: boolean; erro: string | null; persistido: boolean };
};

export type LeitorRd = {
  get: (path: string) => Promise<Json>;
  listar: (recurso: string) => Promise<Json[]>;
};

function leitorRd(env: Env): LeitorRd {
  return { get: (path) => rdGet(env, path), listar: (recurso) => listarTudo(env, recurso) };
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** O RD limita rajadas (429): tenta de novo com espera curta antes de desistir. */
async function comRetentativa<T>(fn: () => Promise<T>, esperas = [800, 2000]): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= esperas.length || !(e instanceof Error) || e.message !== "RD_HTTP_429") throw e;
      await espera(esperas[i]);
    }
  }
}

async function emLotes<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      out[i] = await fn(itens[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return out;
}

function semAcentos(v: string) {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const preenchido = (v: unknown) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);

function customFields(registro: Json): Json {
  const cf = registro.custom_fields;
  if (cf && typeof cf === "object" && !Array.isArray(cf)) return cf as Json;
  const out: Json = {};
  for (const raw of arrayValue(cf)) {
    const item = objectValue(raw);
    const slug = stringValue(item.slug) || stringValue(objectValue(item.custom_field).slug);
    if (slug) out[slug] = item.value;
  }
  return out;
}

/** Campo com regra de exibição por funil: só vale nos funis listados. */
function funisDaRegra(campo: Json): string[] | null {
  const regras = arrayValue(campo.display_rules).map(objectValue).filter((r) => stringValue(r.property) === "deal_pipeline_id");
  if (!regras.length) return null;
  return regras.map((r) => stringValue(r.value)).filter(Boolean);
}

async function amostraDoFunil(rd: LeitorRd, pipelineId: string): Promise<Json[]> {
  const base = `/deals?filter=${encodeURIComponent(`pipeline_id:${pipelineId}`)}&page[number]=1&page[size]=${AMOSTRA_NEGOCIACOES}`;
  try {
    return arrayValue((await comRetentativa(() => rd.get(`${base}&sort[updated_at]=desc`))).data).map(objectValue);
  } catch (e) {
    // Conta em que a ordenação por updated_at não é aceita: amostra sem ordenação.
    if (!(e instanceof Error) || e.message !== "RD_HTTP_400") throw e;
    return arrayValue((await comRetentativa(() => rd.get(base))).data).map(objectValue);
  }
}

function idsDeContato(deal: Json): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => { const id = typeof v === "object" && v ? stringValue(objectValue(v).id) : stringValue(v); if (/^[0-9a-f]{24}$/.test(id)) ids.add(id); };
  add(deal.contact_id);
  for (const v of arrayValue(deal.contact_ids)) add(v);
  for (const v of arrayValue(deal.contacts)) add(v);
  return [...ids];
}

/** Contatos da amostra lidos um a um (o RDQL de contatos não filtra por id). 30 bastam para ver os campos. */
const CONTATOS_POR_FUNIL = 30;
async function contatosDaAmostra(rd: LeitorRd, deals: Json[]): Promise<{ contatos: Map<string, Json>; indisponivel: boolean }> {
  const ids = [...new Set(deals.flatMap((d) => idsDeContato(d).slice(0, 1)))].slice(0, CONTATOS_POR_FUNIL);
  if (!ids.length) return { contatos: new Map(), indisponivel: false };
  const { contatos, falhas } = await lerContatosPorId(ids, (id) => rd.get(`/contacts/${encodeURIComponent(id)}`), { concorrencia: 4, esperas: [800, 2000] });
  return { contatos, indisponivel: contatos.size === 0 && falhas.size > 0 };
}

type Regra = { campo: CampoCrm; nomes: string[]; nativos: string[] };
/** Mesma intenção da leitura automática antiga, mas escolhendo uma origem concreta do funil. */
const REGRAS_SUGESTAO: Regra[] = [
  { campo: "cpf", nomes: ["cpf", "cpf cliente", "documento"], nativos: [] },
  { campo: "telefone", nomes: ["telefone", "celular", "whatsapp"], nativos: ["contact_field:phones"] },
  { campo: "email", nomes: ["email", "e mail"], nativos: ["contact_field:emails"] },
  { campo: "vendedora", nomes: ["vendedora", "vendedor", "responsavel"], nativos: ["deal_field:owner_id"] },
  { campo: "origem", nomes: ["origem"], nativos: ["deal_field:source_id"] },
  { campo: "campanha", nomes: ["campanha"], nativos: ["deal_field:campaign_id"] },
  { campo: "valor_contrato", nomes: ["valor da carta", "carta de credito", "valor contrato", "valor do contrato"], nativos: ["deal_field:total_price"] },
  { campo: "quantidade_parcelas", nomes: ["quantidade de parcelas", "quantidade parcelas", "numero parcelas", "numero de parcelas", "parcelas"], nativos: [] },
  { campo: "valor_parcela", nomes: ["valor parcela", "valor da parcela", "parcela valor"], nativos: [] },
  { campo: "taxa_administrativa", nomes: ["taxa administrativa", "taxa adm"], nativos: [] },
  { campo: "tipo_venda", nomes: ["tipo venda", "tipo de venda", "modalidade", "tipo contrato"], nativos: [] },
  { campo: "procedimento", nomes: ["procedimento"], nativos: [] },
  { campo: "banco", nomes: ["banco"], nativos: [] },
];

export function sugerirOrigens(fontes: FonteCatalogo[]): Partial<Record<CampoCrm, string>> {
  const personalizadas = fontes.filter((f) => f.grupo.endsWith("personalizado") && f.mapeavel);
  const disponiveis = new Set(fontes.map((f) => f.fonte));
  const out: Partial<Record<CampoCrm, string>> = {};
  const usados = new Set<string>();
  for (const regra of REGRAS_SUGESTAO) {
    const nomes = regra.nomes.map(semAcentos);
    const nomeDe = (f: FonteCatalogo) => semAcentos(f.rotulo.replace(/^(Negociação|Contato):\s*/, ""));
    const slugDe = (f: FonteCatalogo) => semAcentos(f.fonte.split(":")[1] || "");
    // Nome exato ganha de nome parecido; negociação ganha de contato; mais preenchido ganha.
    const candidatos = personalizadas.filter((f) => !usados.has(f.fonte));
    const ordem = (a: FonteCatalogo, b: FonteCatalogo) => (a.grupo === b.grupo ? b.preenchidas - a.preenchidas : a.grupo === "deal_personalizado" ? -1 : 1);
    const exato = candidatos.filter((f) => nomes.includes(nomeDe(f)) || nomes.includes(slugDe(f))).sort(ordem)[0];
    const parecido = exato ? undefined : candidatos.filter((f) => nomes.some((n) => nomeDe(f).includes(n) || slugDe(f).includes(n))).sort(ordem)[0];
    const nativo = regra.nativos.find((n) => disponiveis.has(n));
    const escolhido = exato?.fonte ?? parecido?.fonte ?? nativo;
    if (escolhido) { out[regra.campo] = escolhido; usados.add(escolhido); }
  }
  return out;
}

function contarPor(deals: Json[], chave: (d: Json) => string[]) {
  const m = new Map<string, number>();
  for (const d of deals) for (const v of chave(d)) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

function valoresDeLista(lista: Json[], contagem: Map<string, number>): ValorFiltro[] {
  const vistos = new Set<string>();
  const out: ValorFiltro[] = [];
  for (const item of lista) {
    const id = stringValue(item.id);
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    out.push({ valor: id, rotulo: stringValue(item.name) || stringValue(item.email) || id, negociacoes: contagem.get(id) ?? 0 });
  }
  // IDs vistos nas negociações e ausentes da lista (usuário removido, por exemplo).
  for (const [id, n] of contagem) if (!vistos.has(id)) out.push({ valor: id, rotulo: `Não encontrado no RD (${id.slice(-6)})`, negociacoes: n });
  return out.sort((a, b) => b.negociacoes - a.negociacoes || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

export function montarFunil(entrada: {
  funil: Json; etapas: Json[]; deals: Json[]; contatos: Map<string, Json>; contatosIndisponiveis: boolean;
  camposRd: Json[]; usuarios: Json[]; fontesRd: Json[]; campanhas: Json[];
}): FunilCatalogo {
  const { funil, etapas, deals, contatos, camposRd, usuarios, fontesRd, campanhas } = entrada;
  const id = stringValue(funil.id);
  const catalogo = camposRd
    .map((c) => ({ slug: stringValue(c.slug), nome: stringValue(c.name) || stringValue(c.label) || stringValue(c.slug), entidade: stringValue(c.entity) as "deal" | "contact", tipo: stringValue(c.type), bruto: c }))
    .filter((c) => ["deal", "contact"].includes(c.entidade) && /^[a-z0-9_-]{1,100}$/.test(c.slug));
  const porFonte = new Map(catalogo.map((c) => [`${c.entidade}:${c.slug}`, c]));

  // 1) chaves vistas nas negociações/contatos da amostra (regra que já existia).
  const vistos = camposDisponiveisDoFunil(deals, contatos, catalogo);
  const disponiveis = new Set(vistos.campos.map((c) => `${c.entidade}:${c.slug}`));
  // 2) campos que o RD exibe especificamente neste funil, mesmo sem valor ainda.
  for (const c of catalogo) if (c.entidade === "deal" && funisDaRegra(c.bruto)?.includes(id)) disponiveis.add(`deal:${c.slug}`);
  // Um campo restrito a OUTROS funis e sem valor aqui não entra (a chave vazia vem do layout global).
  const contatosUsados = [...new Set(deals.flatMap(idsDeContato))].map((c) => contatos.get(c)).filter(Boolean) as Json[];
  const preenchidasEm = (fonte: string) => {
    const [entidade, slug] = fonte.split(":");
    const registros = entidade === "deal" ? deals : contatosUsados;
    return registros.filter((r) => preenchido(customFields(r)[slug])).length;
  };
  for (const fonte of [...disponiveis]) {
    const c = porFonte.get(fonte);
    const regra = c && c.entidade === "deal" ? funisDaRegra(c.bruto) : null;
    if (regra && !regra.includes(id) && preenchidasEm(fonte) === 0) disponiveis.delete(fonte);
  }

  const personalizadas: FonteCatalogo[] = [...disponiveis].map((fonte) => {
    const [entidade, slug] = fonte.split(":") as ["deal" | "contact", string];
    const c = porFonte.get(fonte);
    return {
      fonte, rotulo: `${entidade === "deal" ? "Negociação" : "Contato"}: ${c?.nome || slug}`,
      grupo: entidade === "deal" ? "deal_personalizado" : "contact_personalizado", tipo: c?.tipo || "desconhecido", mapeavel: true,
      preenchidas: preenchidasEm(fonte),
    } as FonteCatalogo;
  });
  const nativas: FonteCatalogo[] = vistos.camposNativos.map((n) => {
    const [ent, chave] = n.fonte.split(":");
    const contato = ent === "contact_field";
    const registros = contato ? contatosUsados : deals;
    return {
      fonte: n.fonte, rotulo: rotuloNativoCrm(n.fonte), grupo: contato ? "contact_nativo" : "deal_nativo",
      tipo: "nativo", mapeavel: !NATIVOS_NAO_MAPEAVEIS.has(n.fonte), preenchidas: registros.filter((r) => preenchido(r[chave])).length,
    } as FonteCatalogo;
  });
  const ordemGrupo = { deal_nativo: 0, deal_personalizado: 1, contact_nativo: 2, contact_personalizado: 3 } as const;
  const fontes = [...nativas, ...personalizadas].sort((a, b) => ordemGrupo[a.grupo] - ordemGrupo[b.grupo] || a.rotulo.localeCompare(b.rotulo, "pt-BR"));

  // Filtros por valores selecionáveis.
  const filtros: FiltroCatalogo[] = [];
  const idsDe = (campo: string) => (d: Json) => { const v = stringValue(d[campo]) || stringValue(objectValue(d[campo.replace(/_id$/, "")]).id); return v ? [v] : []; };
  const donos = contarPor(deals, (d) => [...idsDe("owner_id")(d), ...(stringValue(d.owner_id) ? [] : idsDe("user_id")(d))]);
  if (usuarios.length || donos.size) filtros.push({ fonte: "deal_field:owner_id", rotulo: "Responsável (vendedora)", valores: valoresDeLista(usuarios, donos) });
  const origens = contarPor(deals, idsDe("source_id"));
  if (fontesRd.length || origens.size) filtros.push({ fonte: "deal_field:source_id", rotulo: "Fonte", valores: valoresDeLista(fontesRd, origens) });
  const camps = contarPor(deals, idsDe("campaign_id"));
  if (campanhas.length || camps.size) filtros.push({ fonte: "deal_field:campaign_id", rotulo: "Campanha", valores: valoresDeLista(campanhas, camps) });
  for (const f of personalizadas) {
    if (f.grupo !== "deal_personalizado" || !TIPOS_OPCAO.has(f.tipo)) continue;
    const slug = f.fonte.slice(5);
    const opcoes = arrayValue(porFonte.get(f.fonte)?.bruto.options ?? porFonte.get(f.fonte)?.bruto.opts).map(stringValue).filter(Boolean);
    const contagem = contarPor(deals, (d) => { const v = customFields(d)[slug]; return (Array.isArray(v) ? v : [v]).map(stringValue).filter(Boolean); });
    const valores = [...new Set([...opcoes, ...contagem.keys()])].map((v) => ({ valor: v, rotulo: v, negociacoes: contagem.get(v) ?? 0 }))
      .sort((a, b) => b.negociacoes - a.negociacoes || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
    if (valores.length) filtros.push({ fonte: f.fonte, rotulo: f.rotulo.replace(/^Negociação:\s*/, ""), valores });
  }

  return {
    id,
    nome: stringValue(funil.name) || id,
    etapas: etapas.slice().sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0)).map((e) => ({ id: stringValue(e.id), nome: stringValue(e.name) || stringValue(e.id) })),
    campos: personalizadas.map((f) => { const [entidade, slug] = f.fonte.split(":") as ["deal" | "contact", string]; return { slug, nome: porFonte.get(f.fonte)?.nome || slug, entidade, tipo: f.tipo }; })
      .sort((a, b) => `${a.entidade}:${a.nome}`.localeCompare(`${b.entidade}:${b.nome}`, "pt-BR")),
    camposNativos: vistos.camposNativos.map((n) => ({ fonte: n.fonte, rotulo: rotuloNativoCrm(n.fonte) })),
    fontes,
    filtros,
    sugestoes: sugerirOrigens(fontes),
    amostra: { negociacoes: deals.length, contatos: contatosUsados.length, contatosIndisponiveis: entrada.contatosIndisponiveis },
  };
}

/** Lê o RD com poucas chamadas (≈ 5 + 3 por funil) e monta o catálogo de todos os funis. */
export async function montarCatalogoCrm(env: Env, deps: { rd?: LeitorRd } = {}): Promise<FunilCatalogo[]> {
  const rd = deps.rd ?? leitorRd(env);
  const opcional = (recurso: string) => comRetentativa(() => rd.listar(recurso)).catch(() => [] as Json[]);
  const [funis, camposRd, usuarios, fontesRd, campanhas] = await Promise.all([
    comRetentativa(() => rd.listar("pipelines")),
    comRetentativa(() => rd.listar("custom_fields")),
    opcional("users"), opcional("sources"), opcional("campaigns"),
  ]);
  return emLotes(funis, CONCORRENCIA_FUNIS, async (funil) => {
    const id = stringValue(funil.id);
    const [etapas, deals] = await Promise.all([
      comRetentativa(() => rd.get(`/pipelines/${encodeURIComponent(id)}/stages?page[number]=1&page[size]=100`)).then((r) => arrayValue(r.data).map(objectValue)),
      amostraDoFunil(rd, id),
    ]);
    const { contatos, indisponivel } = await contatosDaAmostra(rd, deals);
    return montarFunil({ funil, etapas, deals, contatos, contatosIndisponiveis: indisponivel, camposRd, usuarios, fontesRd, campanhas });
  });
}

// ------------------------------------------------------------------ armazenamento

const PROVEDOR = "rd_station";
const CHAVE = "crm_funis";
type Guardado = { funis: FunilCatalogo[]; atualizadoEm: string; duracaoMs: number; erro: string | null; persistido: boolean };
let memoria: Guardado | null = null;
let emAndamento: Promise<Guardado> | null = null;

/** Para testes. */
export function limparCatalogoEmMemoria() { memoria = null; emAndamento = null; }

async function lerGuardado(db: Db): Promise<Guardado | null> {
  const { data, error } = await db.from("integracao_catalogos").select("dados,atualizado_em,duracao_ms,erro").eq("provedor", PROVEDOR).eq("chave", CHAVE).maybeSingle();
  if (error || !data) return memoria;
  const d = data as Json;
  const funis = arrayValue(objectValue(d.dados).funis) as FunilCatalogo[];
  if (!funis.length && !memoria) return null;
  const guardado = { funis, atualizadoEm: String(d.atualizado_em), duracaoMs: Number(d.duracao_ms ?? 0), erro: d.erro ? String(d.erro) : null, persistido: true };
  return memoria && memoria.atualizadoEm > guardado.atualizadoEm ? memoria : guardado;
}

function resposta(g: Guardado, origem: CatalogoCrm["catalogo"]["origem"], agora = Date.now()): CatalogoCrm {
  return {
    funis: g.funis, campos: [], camposNativos: [], escopoCampos: "por_funil",
    catalogo: { atualizadoEm: g.atualizadoEm, duracaoMs: g.duracaoMs, origem, vencido: agora - new Date(g.atualizadoEm).getTime() > CATALOGO_VALIDADE_MS, erro: g.erro, persistido: g.persistido },
  };
}

/** Monta e guarda. Chamadas simultâneas reaproveitam a mesma leitura do RD. */
export async function atualizarCatalogoCrm(env: Env, deps: { db?: Db; rd?: LeitorRd } = {}): Promise<CatalogoCrm> {
  const db = deps.db ?? createServiceSupabaseClient(env);
  if (!emAndamento) {
    emAndamento = (async () => {
      const inicio = Date.now();
      try {
        const funis = await montarCatalogoCrm(env, { rd: deps.rd });
        const atualizadoEm = new Date().toISOString();
        const duracaoMs = Date.now() - inicio;
        const { error } = await db.from("integracao_catalogos").upsert(
          { provedor: PROVEDOR, chave: CHAVE, dados: { funis }, atualizado_em: atualizadoEm, duracao_ms: duracaoMs, erro: null, erro_em: null },
          { onConflict: "provedor,chave" },
        );
        memoria = { funis, atualizadoEm, duracaoMs, erro: null, persistido: !error };
        return memoria;
      } catch (e) {
        const codigo = e instanceof Error && /^RD_[A-Z0-9_]+$/.test(e.message) ? e.message : "RD_OPTIONS_UNAVAILABLE";
        // O catálogo anterior continua valendo; só registra a falha.
        await db.from("integracao_catalogos").update({ erro: codigo, erro_em: new Date().toISOString() }).eq("provedor", PROVEDOR).eq("chave", CHAVE);
        if (memoria) memoria = { ...memoria, erro: codigo };
        throw e;
      }
    })().finally(() => { emAndamento = null; });
  }
  return resposta(await emAndamento, "recalculado");
}

/** Leitura da tela: devolve o catálogo guardado; só lê o RD quando ainda não existe nenhum. */
export async function catalogoCrm(env: Env, deps: { db?: Db; rd?: LeitorRd; agora?: number } = {}): Promise<CatalogoCrm> {
  const db = deps.db ?? createServiceSupabaseClient(env);
  const guardado = await lerGuardado(db);
  if (guardado?.funis.length) return resposta(guardado, guardado.persistido ? "armazenado" : "memoria", deps.agora);
  return atualizarCatalogoCrm(env, { db, rd: deps.rd });
}

/** Agendador: renova quando venceu. Sem catálogo e com a importação desligada, não lê o RD. */
export async function atualizarCatalogoSeVencido(env: Env, deps: { db?: Db; rd?: LeitorRd; agora?: number; config?: ConfigCrm } = {}) {
  const db = deps.db ?? createServiceSupabaseClient(env);
  const guardado = await lerGuardado(db);
  const agora = deps.agora ?? Date.now();
  if (guardado?.funis.length && agora - new Date(guardado.atualizadoEm).getTime() <= CATALOGO_VALIDADE_MS) return { atualizado: false, motivo: "em_dia" };
  if (!guardado?.funis.length) {
    const config = deps.config ?? await configDaFuncao<ConfigCrm>(env, "rd_station", "importacao", { db });
    if (!config.ativo) return { atualizado: false, motivo: "importacao_desligada" };
  }
  const r = await atualizarCatalogoCrm(env, { db, rd: deps.rd });
  return { atualizado: true, funis: r.funis.length, duracaoMs: r.catalogo.duracaoMs };
}
