/**
 * Importação configurável do CRM (RD Station → novas_vendas).
 *
 * - Funil, etapas e status viram filtro RDQL (pipeline_id, stage_id:(…), status).
 * - Cada campo do Sra Luck tem uma fonte: leitura automática (normalizarDealRd),
 *   campo personalizado da negociação ou do contato (slug), ou ignorar.
 * - Deduplicação por CPF, telefone e e-mail contra clientes e vendas pendentes:
 *   duplicidade NÃO vira venda nova e nada é sobrescrito; fica no histórico para
 *   revisão ("importar mesmo assim").
 * - Toda venda nova entra em "aguardando_cadastro". A importação nunca cria cliente
 *   nem encaminha ao Financeiro; o avanço para financeiro_concluido é feito pelo
 *   banco (migration_091) quando a cliente tem parcelas E acesso ao app liberado.
 * - RD continua somente leitura (só GET em /crm/v2).
 */
import { configDaFuncao, CAMPOS_CRM, type CampoCrm, type ConfigCrm, type ConfigCrmFunil } from "./integracoes-registro";
import {
  arrayValue, contatoParaCache, dataRdql, idsContatoDaNegociacao, lerContatosRd, lerDealsDosContatos, listarDealsTodosFunis, listarSeguro, listarTudo, mapById, normalizarDealRd, numberValue, objectValue, paginaDeals, rdGet,
  registrarEvento, snapshotUpdatePreservandoLocal, stringValue, TAMANHO_PAGINA_RD, type RdDealSnapshot,
} from "./rd-station-readonly";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { chaveCpf, chaveEmail, chaveTelefone } from "./crm-chaves";
import { gravarContatos, gravarNegociacoes } from "./crm-espelho";
import { codigoErroExecucao, registrarPendencia, registrarPendenciasDoItem } from "./integracao-pendencias";
import { catalogoCrm } from "./crm-catalogo";
import { contagensParaTela, lerContagens } from "./crm-contagens";
import { agruparPorContato, manterAmpliada, montarOrigem, origemParaColunas, valorDescritivoDeOrigem, valorNaoInformativo, type OrigemCliente } from "./crm-origem";

/**
 * Contato guardado vale 24 h. TODOS os contatos dos funis configurados são lidos, sem cota; como o RD
 * aceita 120 consultas/min, a importação é feita em etapas (ver importarCrm) e cada execução
 * continua de onde a anterior parou. Nada é descartado: o que não foi lido é relido depois.
 */
const CONTATO_VALIDADE_MS = 24 * 60 * 60_000;

type Json = Record<string, any>;
type Db = ReturnType<typeof createServiceSupabaseClient>;

export type Origem = "manual" | "agendada" | "webhook";
export type Resultado = "criada" | "atualizada" | "duplicada" | "cliente_existente" | "ignorada" | "erro";
export type Correspondencia = {
  tipo: "cliente" | "venda"; id: string; nome: string | null; por: ("cpf" | "telefone" | "email")[];
  /** Quantos dados a venda pendente tem preenchidos (para indicar o perfil mais completo na revisão). */
  completude?: number;
};

export type ValoresVenda = {
  nome: string;
  cpf: string | null;
  telefone: string | null;
  email: string | null;
  vendedora: string | null;
  origem: string | null;
  campanha: string | null;
  valor_contrato: number;
  quantidade_parcelas: number | null;
  valor_parcela: number | null;
  taxa_administrativa: number | null;
  tipo_venda: string | null;
  procedimento: string | null;
  banco: string | null;
};

// ------------------------------------------------------------------ filtro RDQL

export function funisConfigurados(config: ConfigCrm): ConfigCrmFunil[] {
  if (Array.isArray(config.funis) && config.funis.length) return config.funis;
  if (config.pipelineId) {
    return [{
      pipelineId: config.pipelineId,
      etapas: Array.isArray(config.etapas) ? config.etapas : [],
      mapeamento: { ...config.mapeamento },
    }];
  }
  return [];
}

function partesFiltro(config: ConfigCrm, funil?: ConfigCrmFunil) {
  const partes: string[] = [];
  if (funil?.pipelineId) partes.push(`pipeline_id:${funil.pipelineId}`);
  if (funil?.etapas?.length) partes.push(`stage_id:(${funil.etapas.join(",")})`);
  if (config.status !== "qualquer") partes.push(`status:${config.status}`);
  return partes.join(" ");
}

/** Um filtro por funil; sem seleção explícita, lê todos os funis com o status configurado. */
export function filtrosRdql(config: ConfigCrm): string[] {
  if (config.todosFunis) return [""];
  const funis = funisConfigurados(config);
  return funis.length ? funis.map((f) => partesFiltro(config, f)) : [partesFiltro(config)];
}

/** Texto usado no histórico/logs. */
export function filtroRdql(config: ConfigCrm) {
  return filtrosRdql(config).join(" || ");
}

function funilParaSnapshot(s: RdDealSnapshot, config: ConfigCrm) {
  const funis = funisConfigurados(config);
  return funis.find((f) => f.pipelineId === s.rdPipelineId) ?? null;
}

/** Valores da negociação para um filtro do funil (IDs do RD ou opções do campo). */
function valoresParaFiltro(s: RdDealSnapshot, fonte: string): string[] {
  if (fonte === "deal_field:owner_id") return s.rdOwnerId ? [s.rdOwnerId] : [];
  if (fonte === "deal_field:source_id") return s.rdSourceId ? [s.rdSourceId] : [];
  if (fonte === "deal_field:campaign_id") return s.rdCampaignId ? [s.rdCampaignId] : [];
  if (fonte.startsWith("deal:")) {
    const v = valorPersonalizado(s.raw, fonte.slice(5));
    return (Array.isArray(v) ? v : [v]).map(stringValue).filter(Boolean);
  }
  return [];
}

const ROTULO_FILTRO: Record<string, string> = { "deal_field:owner_id": "responsável", "deal_field:source_id": "fonte", "deal_field:campaign_id": "campanha" };

/** Webhook e reprocessamentos passam pelo mesmo filtro da importação. */
export function passaNoFiltro(s: RdDealSnapshot, config: ConfigCrm): string | null {
  if (config.todosFunis) return null;
  const funis = funisConfigurados(config);
  if (funis.length) {
    const funil = funilParaSnapshot(s, config);
    if (!funil) return "Fora dos funis configurados.";
    if (funil.etapas.length && (!s.rdStageId || !funil.etapas.includes(s.rdStageId))) return "Fora das etapas configuradas para este funil.";
    for (const filtro of funil.filtros ?? []) {
      if (!filtro.valores.length) continue;
      const valores = valoresParaFiltro(s, filtro.fonte);
      if (!valores.some((v) => filtro.valores.includes(v))) {
        return `Fora do filtro de ${ROTULO_FILTRO[filtro.fonte] ?? `campo ${filtro.fonte.slice(5)}`} deste funil.`;
      }
    }
  }
  if (config.status !== "qualquer" && s.rdStatus && s.rdStatus !== config.status) return `Status ${s.rdStatus} diferente do configurado (${config.status}).`;
  return null;
}

// ------------------------------------------------------------------ mapeamento de campos

/** v2: custom_fields é objeto { slug: valor }; formatos antigos: lista com slug. */
export function valorPersonalizado(obj: unknown, slug: string): unknown {
  const cf = objectValue(obj).custom_fields;
  if (cf && typeof cf === "object" && !Array.isArray(cf)) return (cf as Json)[slug];
  for (const item of arrayValue(cf)) {
    const i = objectValue(item);
    const s = stringValue(i.slug) || stringValue(objectValue(i.custom_field).slug);
    if (s === slug) return i.value;
  }
  return undefined;
}

/** Leitura exata da origem escolhida: ausência não equivale a zero, falso ou inferência. */
export function extrairCamposSelecionados(s: RdDealSnapshot, deal: Json, contato: Json | undefined, config: ConfigCrm) {
  return (funilParaSnapshot(s, config)?.camposSelecionados ?? []).map(({ fonte, rotulo }) => {
    const [entidade, chave] = fonte.split(":");
    const registro = entidade.startsWith("contact") ? contato : deal;
    const valor = entidade.endsWith("_field") ? registro?.[chave] : valorPersonalizado(registro, chave);
    const ausente = valor === undefined || valor === null || valor === "" || (Array.isArray(valor) && valor.length === 0);
    return { fonte, rotulo, valor: ausente ? null : valor, situacao: !registro ? "origem_nao_carregada" : ausente ? "ausente" : "presente" };
  });
}

/** Primeiro item de listas do RD (phones: [{ phone }], emails: [{ email }]); celular tem preferência. */
function primeiroValor(v: unknown): unknown {
  const lista = Array.isArray(v) ? v : null;
  const item = lista ? (lista.find((x) => x && typeof x === "object" && (x as Json).type === "mobile" && (x as Json).phone) ?? lista.find((x) => x && (typeof x !== "object" || (x as Json).phone || (x as Json).email || (x as Json).value)) ?? lista[0]) : v;
  if (item && typeof item === "object") {
    const o = item as Json;
    return o.phone ?? o.email ?? o.value ?? o.number ?? o.name ?? null;
  }
  return item;
}

/** Origem nativa escolhida explicitamente no funil. Nomes (responsável, fonte, campanha) já vêm resolvidos no snapshot. */
export function valorNativo(fonte: string, s: RdDealSnapshot, deal: Json, contato: Json | undefined): unknown {
  if (fonte === "deal_field:owner_id" || fonte === "deal_field:user_id") return s.vendedoraOriginal;
  if (fonte === "deal_field:source_id") return s.origemOriginal;
  if (fonte === "deal_field:campaign_id") return s.campanhaOriginal;
  const [entidade, chave] = fonte.split(":");
  const registro = entidade === "contact_field" ? contato : deal;
  return primeiroValor(registro?.[chave]);
}

function autoPorNome(obj: unknown, dica: string): string | null {
  const cf = objectValue(obj).custom_fields;
  if (cf && typeof cf === "object" && !Array.isArray(cf)) {
    const chave = Object.keys(cf).find((k) => k.toLowerCase().includes(dica));
    return chave ? stringValue((cf as Json)[chave]) || null : null;
  }
  return null;
}

const NUMERICOS = new Set<CampoCrm>(["valor_contrato", "quantidade_parcelas", "valor_parcela", "taxa_administrativa"]);

function converter(campo: CampoCrm, bruto: unknown): string | number | null {
  if (bruto === undefined || bruto === null || bruto === "") return null;
  const valor = Array.isArray(bruto) ? bruto[0] : bruto;
  if (campo === "cpf") return stringValue(valor).replace(/\D/g, "") || null;
  if (campo === "email") return stringValue(valor).toLowerCase() || null;
  if (NUMERICOS.has(campo)) {
    const n = numberValue(valor);
    if (n === null) return null;
    return campo === "quantidade_parcelas" ? Math.max(1, Math.round(n)) : n;
  }
  return stringValue(valor).slice(0, 240) || null;
}

export function aplicarMapeamento(s: RdDealSnapshot, deal: Json, contato: Json | undefined, config: ConfigCrm): ValoresVenda {
  const auto: Record<CampoCrm, unknown> = {
    cpf: s.cpfOriginal, telefone: s.telefoneOriginal, email: s.emailOriginal,
    vendedora: s.vendedoraOriginal, origem: s.origemOriginal, campanha: s.campanhaOriginal,
    valor_contrato: s.valorOriginal, quantidade_parcelas: s.quantidadeParcelasOriginal, valor_parcela: s.valorParcelaOriginal,
    taxa_administrativa: s.taxaAdministrativaOriginal, tipo_venda: s.tipoVendaOriginal,
    procedimento: autoPorNome(deal, "procedimento"), banco: autoPorNome(deal, "banco"),
  };
  const funil = funilParaSnapshot(s, config);
  const mapa = funil?.mapeamento ?? config.mapeamento;
  const out = { nome: s.nomeOriginal } as ValoresVenda;
  for (const campo of CAMPOS_CRM) {
    const fonte = mapa[campo] ?? config.mapeamento[campo] ?? "auto";
    let bruto: unknown;
    if (fonte === "ignorar") bruto = null;
    else if (campo === "vendedora" && fonte === "deal:nome-da-vendedora") {
      // O segundo campo comercial complementa o primeiro; o proprietário da negociação
      // é um responsável operacional e não identifica necessariamente quem vendeu.
      bruto = converter("vendedora", valorPersonalizado(deal, "nome-da-vendedora"))
        || valorPersonalizado(deal, "vendedora-que-realizou-a-reuniao");
    }
    else if (fonte.startsWith("deal:")) bruto = valorPersonalizado(deal, fonte.slice(5));
    else if (fonte.startsWith("contact:")) bruto = valorPersonalizado(contato, fonte.slice(8));
    else if (fonte.startsWith("deal_field:") || fonte.startsWith("contact_field:")) bruto = valorNativo(fonte, s, deal, contato);
    else bruto = auto[campo];
    (out as Record<string, unknown>)[campo] = converter(campo, bruto);
  }
  if (out.valor_contrato === null) out.valor_contrato = 0;
  return out;
}

// ------------------------------------------------------------------ deduplicação (somente telefone)

export { chaveCpf, chaveEmail, chaveTelefone } from "./crm-chaves";

/** Todas as chaves de telefone da negociação: o telefone preenchido e todos os telefones do contato. */
export function chavesTelefone(valores: { telefone?: unknown }, contato?: Json): string[] {
  const chaves = new Set<string>();
  const add = (v: unknown) => { const k = chaveTelefone(v); if (k) chaves.add(k); };
  add(valores.telefone);
  for (const p of arrayValue(contato?.phones)) add(typeof p === "object" && p ? (p as Json).phone : p);
  add(contato?.phone);
  add(contato?.mobile_phone);
  return [...chaves];
}

/** Colunas locais que vêm do preenchimento configurado no Console. */
const COLUNAS_PREENCHIDAS: [keyof ValoresVenda, string][] = [
  ["nome", "nome_completo"], ["cpf", "cpf"], ["telefone", "telefone"], ["email", "email"], ["vendedora", "vendedora_responsavel"],
  ["valor_contrato", "valor_contrato"], ["quantidade_parcelas", "quantidade_parcelas"], ["valor_parcela", "valor_parcela"],
  ["taxa_administrativa", "taxa_administrativa"], ["tipo_venda", "tipo_venda"], ["procedimento", "procedimento_local"],
  ["banco", "banco_local"], ["origem", "origem_venda"], ["campanha", "campanha_local"],
];
const vazio = (v: unknown) => v === undefined || v === null || v === "" || (typeof v === "number" && v === 0);

/** Quantos dados a negociação traz preenchidos (mais completa ganha entre duplicatas do mesmo telefone). */
export function completude(valores: ValoresVenda, camposSelecionados: { situacao: string }[] = []) {
  return COLUNAS_PREENCHIDAS.filter(([campo]) => !vazio(valores[campo])).length + camposSelecionados.filter((c) => c.situacao === "presente").length;
}
function completudeDaLinha(linha: Json) {
  return COLUNAS_PREENCHIDAS.filter(([, coluna]) => !vazio(linha[coluna])).length;
}

type Registro = { tipo: "cliente" | "venda"; id: string; nome: string | null; rdId?: string | null };
/** Contato lido do RD guardado junto da venda (rd_snapshot._sra_contato): evita reler a cada sincronização. */
export type ContatoEmCache = { dados: Json; lidoEm: string };
/** contato/origem `undefined` = ainda não lidos do banco (índice leve; ver completarCaches). */
type VendaIndexada = { id: string; status: string; clienteId: string | null; linha: Json; contato?: ContatoEmCache | null; origem?: OrigemCliente | null };
export type IndiceDedupe = {
  porCpf: Map<string, Registro[]>; porTelefone: Map<string, Registro[]>; porEmail: Map<string, Registro[]>;
  vendaPorRd: Map<string, { id: string; status: string }>;
  /** Vendas conhecidas pelo id, com as colunas locais (para completar/atualizar sem tocar no que foi editado). */
  vendaPorId?: Map<string, VendaIndexada>;
  /** Colunas editadas à mão no Admin por venda: nunca são sobrescritas pela importação. */
  editadasNoAdmin?: Map<string, Set<string>>;
};

function adicionar(mapa: Map<string, Registro[]>, chave: string | null, r: Registro) {
  if (!chave) return;
  const lista = mapa.get(chave) ?? [];
  if (!lista.some((x) => x.tipo === r.tipo && x.id === r.id)) lista.push(r);
  mapa.set(chave, lista);
}

export function indiceVazio(): IndiceDedupe {
  return { porCpf: new Map(), porTelefone: new Map(), porEmail: new Map(), vendaPorRd: new Map(), vendaPorId: new Map(), editadasNoAdmin: new Map() };
}

export function indexar(indice: IndiceDedupe, r: Registro, dados: { cpf?: unknown; telefone?: unknown; email?: unknown }, outrasChaves: string[] = []) {
  adicionar(indice.porCpf, chaveCpf(dados.cpf), r);
  adicionar(indice.porTelefone, chaveTelefone(dados.telefone), r);
  for (const k of outrasChaves) adicionar(indice.porTelefone, k, r);
  adicionar(indice.porEmail, chaveEmail(dados.email), r);
}

async function todasAsLinhas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const linhas: T[] = [];
  for (let de = 0; de < 50_000; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw error;
    linhas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return linhas;
}

const COLUNAS_VENDA = `id,rd_station_id,cliente_id,status,contato_cache:rd_snapshot->_sra_contato,origem_cache:rd_snapshot->_sra_origem,${COLUNAS_PREENCHIDAS.map(([, c]) => c).join(",")}`;
/**
 * Índice leve: só colunas simples. Ler rd_snapshot (contato e origem guardados) de TODAS as vendas
 * a cada etapa e a cada evento do webhook travou o banco com 10 mil+ vendas (30/09/2026): os dados
 * guardados são lidos só das vendas que a etapa/evento vai processar (completarCaches).
 */
const COLUNAS_INDICE = `id,rd_station_id,cliente_id,status,${COLUNAS_PREENCHIDAS.map(([, c]) => c).join(",")}`;

/** Contato e origem guardados (rd_snapshot) só das vendas informadas, em lotes. */
export async function completarCaches(db: Db, indice: IndiceDedupe, idsVenda: string[]) {
  const faltam = [...new Set(idsVenda)].filter((id) => { const v = indice.vendaPorId?.get(id); return v && v.contato === undefined; });
  for (let i = 0; i < faltam.length; i += 200) {
    const { data } = await db.from("novas_vendas").select("id,contato_cache:rd_snapshot->_sra_contato,origem_cache:rd_snapshot->_sra_origem").in("id", faltam.slice(i, i + 200));
    const lidos = new Map(((data ?? []) as Json[]).map((l) => [String(l.id), l]));
    for (const id of faltam.slice(i, i + 200)) {
      const v = indice.vendaPorId?.get(id);
      if (!v) continue;
      const l = lidos.get(id);
      const cache = objectValue(l?.contato_cache);
      v.contato = cache.dados && cache.lidoEm ? { dados: objectValue(cache.dados), lidoEm: String(cache.lidoEm) } : null;
      const origemCache = objectValue(l?.origem_cache);
      v.origem = origemCache.checadoEm ? origemCache as OrigemCliente : null;
    }
  }
}

export async function carregarIndice(db: Db): Promise<IndiceDedupe> {
  const indice = indiceVazio();
  const [clientes, vendas, edicoes] = await Promise.all([
    todasAsLinhas<Json>((de, ate) => db.from("clientes").select("id,nome_completo,cpf,telefone,email,arquivado_em").order("id").range(de, ate)),
    todasAsLinhas<Json>((de, ate) => db.from("novas_vendas").select(COLUNAS_INDICE).order("id").range(de, ate)),
    todasAsLinhas<Json>((de, ate) => db.from("logs_alteracoes").select("entidade_id,detalhes").eq("acao", "editou_venda_local_sem_sync_rd").order("entidade_id").range(de, ate)).catch(() => [] as Json[]),
  ]);
  for (const c of clientes) {
    if (c.arquivado_em) continue; // arquivada libera o CPF (migration_077)
    indexar(indice, { tipo: "cliente", id: c.id, nome: c.nome_completo ?? null }, c);
  }
  for (const v of vendas) {
    if (v.rd_station_id) indice.vendaPorRd.set(String(v.rd_station_id), { id: v.id, status: v.status });
    // Contato/origem guardados: `undefined` = ainda não lidos (completarCaches lê sob demanda).
    const temCache = v.contato_cache !== undefined || v.origem_cache !== undefined || v.rd_snapshot !== undefined;
    const cache = objectValue(v.contato_cache ?? objectValue(v.rd_snapshot)._sra_contato);
    const contato = temCache ? (cache.dados && cache.lidoEm ? { dados: objectValue(cache.dados), lidoEm: String(cache.lidoEm) } : null) : undefined;
    const origemCache = objectValue(v.origem_cache ?? objectValue(v.rd_snapshot)._sra_origem);
    const origem = temCache ? (origemCache.checadoEm ? origemCache as OrigemCliente : null) : undefined;
    indice.vendaPorId!.set(String(v.id), { id: String(v.id), status: String(v.status), clienteId: v.cliente_id ?? null, linha: v, contato, origem });
    if (!v.cliente_id) indexar(indice, { tipo: "venda", id: v.id, nome: v.nome_completo ?? null, rdId: v.rd_station_id ?? null }, v);
  }
  for (const e of edicoes) {
    const id = String(e.entidade_id);
    const set = indice.editadasNoAdmin!.get(id) ?? new Set<string>();
    for (const c of arrayValue(objectValue(e.detalhes).campos)) set.add(String(c));
    indice.editadasNoAdmin!.set(id, set);
  }
  return indice;
}

/** Duplicata é SOMENTE mesmo telefone (DDD + número). CPF, e-mail e nome não bastam. */
export function procurarDuplicidade(indice: IndiceDedupe, valores: ValoresVenda, config: ConfigCrm, rdId: string, outrasChaves: string[] = []): Correspondencia[] {
  if (config.deduplicarPor.telefone === false) return [];
  const achados = new Map<string, Correspondencia>();
  for (const chave of new Set([chaveTelefone(valores.telefone), ...outrasChaves].filter(Boolean) as string[])) {
    for (const r of indice.porTelefone.get(chave) ?? []) {
      if (r.tipo === "venda" && r.rdId === rdId) continue;
      achados.set(`${r.tipo}:${r.id}`, { tipo: r.tipo, id: r.id, nome: r.nome, por: ["telefone"] });
    }
  }
  return [...achados.values()];
}

// ------------------------------------------------------------------ processamento de uma negociação

export type ItemImportacao = {
  external_id: string; resultado: Resultado; motivo: string | null; correspondencias: Correspondencia[];
  nova_venda_id: string | null; dados: Json;
};

function linhaNovaVenda(s: RdDealSnapshot, v: ValoresVenda, importacaoId: string | null) {
  return {
    rd_station_id: s.rdStationId,
    nome_completo: v.nome,
    cpf: v.cpf,
    telefone: v.telefone,
    email: v.email,
    data_venda: s.dataVenda,
    vendedora_responsavel: v.vendedora,
    valor_contrato: v.valor_contrato,
    quantidade_parcelas: v.quantidade_parcelas,
    valor_parcela: v.valor_parcela,
    taxa_administrativa: v.taxa_administrativa,
    tipo_venda: v.tipo_venda,
    procedimento_local: v.procedimento,
    banco_local: v.banco,
    rd_procedimento_original: v.procedimento,
    rd_banco_original: v.banco,
    origem_venda: v.origem,
    campanha_local: v.campanha,
    // Regra: toda cliente nova entra em "Aguardando cadastro". Nunca outro status aqui.
    status: "aguardando_cadastro",
    importacao_id: importacaoId,
    ...snapshotUpdatePreservandoLocal(s),
  };
}

/** Venda ainda em "Aguardando cadastro" e sem cliente: a cópia local segue o preenchimento do Console. */
const pendenteDeCadastro = (v: VendaIndexada | undefined) => Boolean(v && !v.clienteId && v.status === "aguardando_cadastro");

/**
 * Colunas locais que mudam para refletir o preenchimento atual. Nunca mexe no que a equipe
 * editou no Admin; `soVazias` = só completa o que está vazio (duplicata mais completa).
 */
function patchLocal(v: VendaIndexada, valores: ValoresVenda, editadas: Set<string> | undefined, soVazias: boolean, limparVendedoraVazia = false) {
  const patch: Json = {};
  for (const [campo, coluna] of COLUNAS_PREENCHIDAS) {
    if (editadas?.has(coluna)) continue;
    const novo = valores[campo];
    const atual = v.linha[coluna];
    // Nunca troca um dado preenchido por vazio: a sincronização não apaga nada.
    if (vazio(novo) && !(limparVendedoraVazia && coluna === "vendedora_responsavel" && !soVazias)) continue;
    // Nem troca um dado real por "não registrada no RD" (origem/campanha); o contrário, sim.
    if (valorDescritivoDeOrigem(novo) && !vazio(atual) && !valorDescritivoDeOrigem(atual)) continue;
    if (soVazias && ((!vazio(atual) && !valorDescritivoDeOrigem(atual)) || vazio(novo))) continue;
    if ((v.linha[coluna] ?? null) === (novo ?? null)) continue;
    patch[coluna] = novo ?? null;
  }
  return patch;
}

/**
 * Origem e campanha vazias (ou só "Desconhecido") na própria negociação: completa com o registro
 * real encontrado nas outras negociações da mesma cliente (crm-origem); sem registro, grava o que o
 * RD mostra ("Orgânico — sem campanha paga", "Não registrada no RD"), nunca em branco.
 * Campo marcado "ignorar" no Console fica vazio.
 */
export function completarOrigem(valores: ValoresVenda, origem: OrigemCliente, mapa: Partial<Record<CampoCrm, string>>) {
  const doRd = origemParaColunas(origem);
  const semDado = (v: unknown) => vazio(v) || valorNaoInformativo(String(v)) || valorDescritivoDeOrigem(v);
  if (semDado(valores.origem) && mapa.origem !== "ignorar" && !(valorNaoInformativo(doRd.origem) && !vazio(valores.origem))) valores.origem = doRd.origem.slice(0, 240);
  if (semDado(valores.campanha) && mapa.campanha !== "ignorar" && !(valorNaoInformativo(doRd.campanha) && !vazio(valores.campanha))) valores.campanha = doRd.campanha.slice(0, 240);
}

export async function processarNegociacao(db: Db, entrada: {
  deal: Json; snapshot: RdDealSnapshot; contato?: Json; config: ConfigCrm; indice: IndiceDedupe; importacaoId: string | null;
  /** A negociação tem contato no RD, mas ele não existe mais ou deu erro ao ler. */
  contatoIndisponivel?: boolean;
  /** Contato ainda não lido por limite do RD: a venda existente só tem o snapshot atualizado. */
  contatoAdiado?: boolean;
  /** Quando o contato foi lido do RD (para o cache); ausente = veio do cache e ele é mantido. */
  contatoLidoEm?: string | null;
  /** De onde a cliente veio (crm-origem). Ausente = a busca não rodou agora; mantém a guardada. */
  origem?: OrigemCliente | null;
}): Promise<ItemImportacao> {
  const { deal, snapshot: s, contato, config, indice, importacaoId, contatoIndisponivel, contatoAdiado } = entrada;
  const valores = aplicarMapeamento(s, deal, contato, config);
  const camposSelecionados = extrairCamposSelecionados(s, deal, contato, config);
  const existenteIdx = indice.vendaPorRd.get(s.rdStationId);
  const cacheAnterior = existenteIdx ? indice.vendaPorId?.get(existenteIdx.id)?.contato ?? null : null;
  const cacheContato: ContatoEmCache | null = contato && entrada.contatoLidoEm
    ? { dados: contatoParaCache(contato), lidoEm: entrada.contatoLidoEm }
    : cacheAnterior;
  const origemGuardada = existenteIdx ? indice.vendaPorId?.get(existenteIdx.id)?.origem ?? null : null;
  // Recalculada agora só com o próprio contato: mantém o que veio de outros cadastros da mesma pessoa (crm-origem-geral).
  const origem = entrada.origem ? manterAmpliada(entrada.origem, origemGuardada) : origemGuardada;
  if (origem) completarOrigem(valores, origem, funilParaSnapshot(s, config)?.mapeamento ?? config.mapeamento);
  const snapshotSelecionado = { ...s, raw: { ...s.raw, _sra_mapeamento: { pipelineId: s.rdPipelineId, campos: camposSelecionados, valores }, ...(cacheContato ? { _sra_contato: cacheContato } : {}), ...(origem ? { _sra_origem: origem } : {}) } };
  const dados = { ...valores, camposSelecionados, rdStatus: s.rdStatus, rdPipelineId: s.rdPipelineId, rdStageId: s.rdStageId, dataVenda: s.dataVenda, origemSituacao: origem?.situacao ?? null };
  const base = { external_id: s.rdStationId, correspondencias: [] as Correspondencia[], nova_venda_id: null as string | null, dados };

  // O filtro configurado vale também para vendas já importadas. Caso contrário,
  // elas eram contadas como atualizadas mesmo fora do escopo e escondiam a exclusão de vendas novas.
  const fora = passaNoFiltro(s, config);
  if (fora) return { ...base, resultado: "ignorada", motivo: fora };

  const existente = existenteIdx;
  if (existente && contatoAdiado && !contato) {
    // Sem contato (limite do RD): não remapeia para não apagar telefone/CPF; só o snapshot.
    const { error } = await db.from("novas_vendas").update(snapshotUpdatePreservandoLocal(snapshotSelecionado)).eq("id", existente.id);
    if (error) return { ...base, resultado: "erro", motivo: "Falha ao atualizar o snapshot do RD." };
    return { ...base, resultado: "atualizada", nova_venda_id: existente.id, motivo: "Contato ainda não lido (limite de consultas do RD); os dados serão atualizados na próxima sincronização." };
  }
  if (existente) {
    if (contatoIndisponivel) {
      // Contato removido no RD e sem cópia guardada: mantém a venda como está (nada é apagado).
      const { error } = await db.from("novas_vendas").update(snapshotUpdatePreservandoLocal(snapshotSelecionado)).eq("id", existente.id);
      if (error) return { ...base, resultado: "erro", motivo: "Falha ao atualizar o snapshot do RD." };
      return { ...base, resultado: "atualizada", nova_venda_id: existente.id, motivo: "O contato desta negociação não existe mais no RD; os dados da venda foram mantidos." };
    }
    const venda = indice.vendaPorId?.get(existente.id);
    const fonteVendedora = funilParaSnapshot(s, config)?.mapeamento.vendedora ?? config.mapeamento.vendedora;
    const patch = venda && pendenteDeCadastro(venda)
      ? patchLocal(venda, valores, indice.editadasNoAdmin?.get(existente.id), false, fonteVendedora === "deal:nome-da-vendedora") : {};
    const { error } = await db.from("novas_vendas").update({ ...snapshotUpdatePreservandoLocal(snapshotSelecionado), ...patch }).eq("id", existente.id);
    if (error) return { ...base, resultado: "erro", motivo: "Falha ao atualizar a venda com os dados do RD." };
    if (venda) { Object.assign(venda.linha, patch); if (cacheContato) venda.contato = cacheContato; if (origem) venda.origem = origem; }
    const colunas = Object.keys(patch);
    return {
      ...base, resultado: "atualizada", nova_venda_id: existente.id,
      motivo: colunas.length ? `Dados atualizados conforme o Console: ${colunas.join(", ")}.` : pendenteDeCadastro(venda) ? "Sem mudança nos dados." : "Venda já cadastrada: só o snapshot do RD foi atualizado; dados locais preservados.",
    };
  }

  if (!valores.nome || valores.nome === "Cliente RD Station") return { ...base, resultado: "ignorada", motivo: "Negociação sem nome de contato." };

  const telefones = chavesTelefone(valores, contato);
  const correspondencias = procurarDuplicidade(indice, valores, config, s.rdStationId, telefones);
  if (correspondencias.length && await duplicidadeJaDecidida(db, s.rdStationId)) {
    // "É a mesma pessoa" já foi decidido: não volta para a revisão a cada execução.
    return { ...base, correspondencias, resultado: "ignorada", motivo: "Duplicidade já decidida na revisão: mesma pessoa. Nada foi criado." };
  }
  if (correspondencias.length) {
    if (correspondencias.some((c) => c.tipo === "cliente")) {
      return { ...base, correspondencias, resultado: "cliente_existente", motivo: "Já existe cliente com o mesmo telefone. Nada foi criado nem alterado." };
    }
    // Mesmo telefone de venda ainda pendente: nada é alterado nem perdido. A duplicata vai para a
    // revisão do Admin com a indicação do perfil mais completo; a equipe escolhe qual perfil usar.
    const minha = completude(valores, camposSelecionados);
    const comPontos = correspondencias.map((c) => {
      const venda = indice.vendaPorId?.get(c.id);
      return venda ? { ...c, completude: completudeDaLinha(venda.linha) } : c;
    });
    const melhorExistente = Math.max(0, ...comPontos.map((c) => c.completude ?? 0));
    return {
      ...base, dados: { ...base.dados, completude: minha }, correspondencias: comPontos, resultado: "duplicada",
      motivo: minha > melhorExistente
        ? `Mesmo telefone de venda já pendente. Esta negociação é a mais completa (${minha} dados contra ${melhorExistente}): escolha o perfil na revisão.`
        : `Mesmo telefone de venda já pendente (a existente é a mais completa: ${melhorExistente} dados contra ${minha}). Escolha o perfil na revisão.`,
    };
  }

  const { data, error } = await db.from("novas_vendas").insert(linhaNovaVenda(snapshotSelecionado, valores, importacaoId)).select("id").single();
  if (error || !data) {
    const duplicadoNoBanco = (error as { code?: string } | null)?.code === "23505";
    return { ...base, resultado: duplicadoNoBanco ? "atualizada" : "erro", motivo: duplicadoNoBanco ? "Negociação já registrada por outra execução." : "Falha ao gravar a venda." };
  }
  const id = String((data as Json).id);
  indice.vendaPorRd.set(s.rdStationId, { id, status: "aguardando_cadastro" });
  const linha = linhaNovaVenda(snapshotSelecionado, valores, importacaoId) as Json;
  indice.vendaPorId?.set(id, { id, status: "aguardando_cadastro", clienteId: null, linha: { ...linha, id }, contato: cacheContato, origem });
  indexar(indice, { tipo: "venda", id, nome: valores.nome, rdId: s.rdStationId }, valores, telefones);
  return { ...base, resultado: "criada", motivo: "Entrou em Aguardando cadastro.", nova_venda_id: id };
}

// ------------------------------------------------------------------ importação completa

type LeituraContatos = { contatos: Map<string, Json>; falhas: Set<string>; limitadas?: Set<string> };
type Fontes = {
  deals: (filtro: string) => Promise<Json[]>;
  refs: () => Promise<{ contatos: Json[]; usuarios: Json[]; campanhas: Json[]; fontes: Json[]; funis?: Json[] }>;
  /** Contatos das negociações lidas, por id (até `prazoMs`). Sem esta fonte, usa `refs().contatos`. */
  contatos?: (ids: string[], prazoMs?: number) => Promise<LeituraContatos>;
  /** Uma página (100) em ordem de criação a partir de `desde`. Sem esta fonte, pagina `deals(filtro)` em memória. */
  pagina?: (filtro: string, desde: string | null, pagina: number) => Promise<Json[]>;
  /** Todas as negociações (qualquer funil) destes contatos: origem da cliente. Sem esta fonte, só a própria negociação. */
  dealsDosContatos?: (idsContato: string[]) => Promise<Json[]>;
  /** Espelho do RD (crm-espelho): contatos já lidos pela varredura e origem resolvida com os outros cadastros da pessoa. */
  espelho?: EspelhoImportacao | null;
};

export type EspelhoImportacao = {
  contatos: (ids: string[]) => Promise<Map<string, Json>>;
  origens: (idsNegociacao: string[]) => Promise<Map<string, OrigemCliente>>;
  /** Grava no espelho os contatos lidos agora do RD (a próxima passada não precisa ler de novo). */
  guardarContatos: (contatos: Json[]) => Promise<void>;
};

/** Espelho no banco. Falha de leitura nunca trava a importação: volta vazio e o RD é consultado. */
export function espelhoDoBanco(db: Db): EspelhoImportacao {
  return {
    contatos: async (ids) => {
      const out = new Map<string, Json>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await db.from("crm_rd_contatos").select("id,dados").in("id", ids.slice(i, i + 200)).not("dados", "is", null);
        for (const c of (data ?? []) as Json[]) if (c.dados) out.set(String(c.id), { ...objectValue(c.dados), id: String(c.id) });
      }
      return out;
    },
    origens: async (ids) => {
      const out = new Map<string, OrigemCliente>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await db.from("crm_rd_negociacoes").select("id,origem").in("id", ids.slice(i, i + 200)).not("origem", "is", null);
        for (const n of (data ?? []) as Json[]) {
          const { assinatura: _a, ...origem } = objectValue(n.origem);
          if (origem.situacao) out.set(String(n.id), origem as OrigemCliente);
        }
      }
      return out;
    },
    guardarContatos: async (contatos) => { await gravarContatos(db, contatos, new Date().toISOString()).catch(() => undefined); },
  };
}


function fontesRd(env: Env): Fontes {
  return {
    deals: (filtro) => filtro ? listarTudo(env, "deals", filtro) : listarDealsTodosFunis(env),
    refs: async () => {
      const [usuarios, campanhas, fontes, funis] = await Promise.all([listarSeguro(env, "users"), listarSeguro(env, "campaigns"), listarSeguro(env, "sources"), listarSeguro(env, "pipelines")]);
      return { contatos: [], usuarios, campanhas, fontes, funis };
    },
    contatos: (ids, prazoMs) => lerContatosRd(env, ids, prazoMs),
    pagina: (filtro, desde, pagina) => paginaDeals(env, filtro, desde, pagina),
    dealsDosContatos: (ids) => lerDealsDosContatos(env, ids),
  };
}

function totais(itens: ItemImportacao[], totalRd: number) {
  const conta = (r: Resultado) => itens.filter((i) => i.resultado === r).length;
  return { totalRd, criadas: conta("criada"), atualizadas: conta("atualizada"), duplicadas: conta("duplicada"), clienteExistente: conta("cliente_existente"), ignoradas: conta("ignorada"), erros: conta("erro") };
}

const LOTE_ITENS = 50;

/** Hash curto e estável (FNV-1a) de uma negociação sem ID, para deduplicar a pendência. */
export function chaveEstavel(deal: Json): string {
  const base = JSON.stringify([stringValue(deal.name), stringValue(deal.created_at), stringValue(deal.pipeline_id ?? objectValue(deal.pipeline).id), stringValue(deal.owner_id ?? objectValue(deal.owner).id)]);
  let h = 0x811c9dc5;
  for (let i = 0; i < base.length; i++) { h ^= base.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
/** Maior que a trava da importação (600 s): execução "em andamento" além disso morreu no meio. */
export const PRAZO_EXECUCAO_MS = 15 * 60_000;

/** Marca como interrompidas as execuções que ficaram "em andamento" além do prazo e abre pendência. */
export async function marcarExecucoesInterrompidas(db: Db, atualId: string, agora = new Date()) {
  const limite = new Date(agora.getTime() - PRAZO_EXECUCAO_MS).toISOString();
  const { data } = await db.from("integracao_importacoes").update({ status: "erro", erro: "EXECUCAO_INTERROMPIDA", concluido_em: agora.toISOString() })
    .eq("provedor", "rd_station").eq("status", "em_andamento").lt("iniciado_em", limite).neq("id", atualId).select("id,origem");
  for (const e of (data ?? []) as Json[]) {
    const { count } = await db.from("novas_vendas").select("id", { count: "exact", head: true }).eq("importacao_id", e.id);
    await registrarPendencia(db, {
      tipo: "execucao_interrompida", externalId: String(e.id), importacaoId: String(e.id), origem: String(e.origem),
      motivo: `A execução parou no meio e não registrou o resultado${count ? `; ${count} venda(s) foram criadas nela` : ""}.`,
      acao: "Reprocessar (não duplica vendas) e conferir as vendas criadas nessa execução.", dados: { vendas_criadas: count ?? 0 },
    }).catch(() => undefined);
  }
  return (data ?? []).length;
}

async function gravarItens(db: Db, importacaoId: string, itens: ItemImportacao[]) {
  for (let i = 0; i < itens.length; i += 200) {
    await db.from("integracao_importacao_itens").insert(itens.slice(i, i + 200).map((item) => ({ ...item, importacao_id: importacaoId })));
  }
}

// ------------------------------------------------------------------ importação em etapas

/**
 * Com milhares de negociações (todos os funis), ler tudo e depois processar não cabe numa execução
 * da hospedagem: a função era encerrada no meio e nada era registrado (EXECUCAO_INTERROMPIDA).
 * Agora cada execução lê página por página (100 negociações, em ordem de criação), grava o que
 * processou e guarda a posição em integracao_catalogos (crm_importacao_progresso). A execução
 * seguinte continua dali; ao terminar a última página, a passada fecha e a próxima recomeça do
 * início, atualizando tudo de novo. Cada consulta filtra `created_at >= posição`, então nenhuma
 * passa do limite de 10 mil registros por filtro do RD.
 */
export const ORCAMENTO_EXECUCAO_MS = 200_000;
/** Trava maior que o orçamento; se a função morrer, libera antes da próxima rodada de 5 min. */
const TRAVA_SEGUNDOS = 290;
/**
 * Contato de negociação nova que não pôde ser lido (limite de consultas do RD) nesta quantidade de
 * tentativas da mesma página: a negociação entra com os dados dela mesma e o contato é completado
 * na leitura seguinte. Nada fica de fora da sincronização.
 */
const TENTATIVAS_POR_PAGINA = 3;
const CHAVE_PROGRESSO = "crm_importacao_progresso";

export type ProgressoImportacao = {
  passada: string;
  iniciadaEm: string;
  concluidaEm: string | null;
  /** Filtros da passada; se a configuração mudar, a passada recomeça. */
  assinatura: string;
  segmentos: string[];
  indice: number;
  /** Data de criação (RDQL, UTC) a partir da qual a próxima página é lida. */
  desde: string | null;
  pagina: number;
  /** O RD recusou o filtro por data: segue só pelo número da página. */
  semFiltroData?: boolean;
  /** Já processadas no segundo de `desde` (a consulta seguinte as devolve de novo). */
  noLimite?: string[];
  tentativas: number;
  lidas: number;
  execucoes: number;
};

/** Um filtro por funil configurado; "todos os funis" é um só filtro (só o status), lido por data. */
export function segmentosDaImportacao(config: ConfigCrm): string[] {
  if (config.todosFunis) return [config.status !== "qualquer" ? `status:${config.status}` : ""];
  return filtrosRdql(config);
}

export async function lerProgresso(db: Db): Promise<ProgressoImportacao | null> {
  const { data } = await db.from("integracao_catalogos").select("dados").eq("provedor", "rd_station").eq("chave", CHAVE_PROGRESSO).maybeSingle();
  const p = objectValue((data as Json | null)?.dados);
  return typeof p.passada === "string" && Array.isArray(p.segmentos) ? p as ProgressoImportacao : null;
}

async function salvarProgresso(db: Db, p: ProgressoImportacao) {
  await db.from("integracao_catalogos").upsert({ provedor: "rd_station", chave: CHAVE_PROGRESSO, dados: p, atualizado_em: new Date().toISOString() }, { onConflict: "provedor,chave" });
}

/**
 * Total de negociações que a passada lê (soma dos funis no catálogo, contagem exata). Só quando o
 * filtro é o funil inteiro (sem etapa nem status): com filtro, o total real é menor e não é mostrado.
 */
export async function totalDaPassada(db: Db, config: ConfigCrm): Promise<number | null> {
  if (config.status && config.status !== "qualquer") return null;
  const { data } = await db.from("integracao_catalogos").select("dados").eq("provedor", "rd_station").eq("chave", "crm_funis").maybeSingle();
  const funis = arrayValue(objectValue((data as Json | null)?.dados).funis).map(objectValue);
  if (!funis.length) return null;
  const configurados = config.todosFunis ? null : funisConfigurados(config);
  if (configurados?.some((f) => f.etapas?.length)) return null;
  const alvo = configurados ? funis.filter((f) => configurados.some((c) => c.pipelineId === stringValue(f.id))) : funis;
  if (!alvo.length || alvo.some((f) => typeof objectValue(f.total).negociacoes !== "number")) return null;
  return alvo.reduce((soma, f) => soma + Number(objectValue(f.total).negociacoes), 0);
}

/** Passada começada e não terminada: o agendador continua sem esperar a frequência. */
export async function passadaEmAndamento(db: Db) {
  const p = await lerProgresso(db);
  return Boolean(p && !p.concluidaEm);
}

/** Sem fonte paginada (testes), pagina em memória o resultado de `deals(filtro)` do mesmo jeito que o RD. */
function paginadorEmMemoria(listar: (filtro: string) => Promise<Json[]>) {
  const cache = new Map<string, Promise<Json[]>>();
  return async (filtro: string, desde: string | null, pagina: number) => {
    if (!cache.has(filtro)) {
      cache.set(filtro, listar(filtro).then((ds) => ds.map((d, i) => ({ d, i }))
        .sort((a, b) => stringValue(a.d.created_at).localeCompare(stringValue(b.d.created_at)) || a.i - b.i).map((x) => x.d)));
    }
    const todos = await cache.get(filtro)!;
    const aPartir = desde ? todos.filter((d) => (dataRdql(d.created_at) ?? "") >= desde) : todos;
    return aPartir.slice((pagina - 1) * TAMANHO_PAGINA_RD, pagina * TAMANHO_PAGINA_RD);
  };
}

export async function importarCrm(env: Env, opcoes: { origem: Exclude<Origem, "webhook">; ator: string },
  deps: { db?: Db; fontes?: Fontes; config?: ConfigCrm; orcamentoMs?: number; relogio?: () => number } = {}) {
  const db = deps.db ?? createServiceSupabaseClient(env);
  const relogio = deps.relogio ?? Date.now;
  const prazo = relogio() + (deps.orcamentoMs ?? ORCAMENTO_EXECUCAO_MS);
  const { data: trava } = await db.rpc("integracao_tentar_trava", { p_nome: "crm_importacao", p_segundos: TRAVA_SEGUNDOS });
  if (trava === false) return { ok: false as const, ocupado: true, erro: "Já existe uma importação em andamento." };
  const config = deps.config ?? await configDaFuncao<ConfigCrm>(env, "rd_station", "importacao", { db });
  const segmentos = segmentosDaImportacao(config);
  const filtro = segmentos.join(" || ");
  const { data: imp, error: erroImp } = await db.from("integracao_importacoes")
    .insert({ provedor: "rd_station", origem: opcoes.origem, filtro, iniciado_por: opcoes.ator }).select("id").single();
  if (erroImp || !imp) {
    await db.rpc("integracao_liberar_trava", { p_nome: "crm_importacao" });
    return { ok: false as const, erro: "A estrutura de importação ainda não foi aplicada (migration_091)." };
  }
  const importacaoId = String((imp as Json).id);
  await marcarExecucoesInterrompidas(db, importacaoId);
  const fontes = deps.fontes ?? fontesRd(env);
  const espelho = fontes.espelho !== undefined ? fontes.espelho : deps.fontes ? null : espelhoDoBanco(db);
  const lerPagina = fontes.pagina ?? paginadorEmMemoria(fontes.deals);
  try {
    const [r, indice, anterior] = await Promise.all([fontes.refs(), carregarIndice(db), lerProgresso(db)]);
    const agoraIso = new Date().toISOString();
    const progresso: ProgressoImportacao = anterior && !anterior.concluidaEm && anterior.assinatura === filtro
      ? anterior
      : { passada: importacaoId, iniciadaEm: agoraIso, concluidaEm: null, assinatura: filtro, segmentos, indice: 0, desde: null, pagina: 1, tentativas: 0, lidas: 0, execucoes: 0 };
    progresso.execucoes++;
    const usuarios = mapById(r.usuarios), campanhas = mapById(r.campanhas), fontesRef = mapById(r.fontes);
    const nomesFunis = new Map((r.funis ?? []).map((f) => [stringValue(f.id), stringValue(f.name)] as [string, string]).filter(([id, nome]) => id && nome));
    const origens = { encontrada: 0, parcial: 0, sem_registro_no_rd: 0, sem_contato: 0, nao_verificada: 0 };
    const itens: ItemImportacao[] = [];
    const vistas = new Set<string>(progresso.noLimite ?? []);
    const jaVistas = vistas.size;
    let adiadas = 0;
    // Itens gravados DURANTE a execução: se a função for interrompida no meio, o que já foi
    // feito continua visível (antes, 914 vendas ficaram sem nenhum item — docs/DIAGNOSTICO-RD).
    let gravados = 0;
    const descarregar = async (fim = false) => {
      const pendentes = itens.slice(gravados);
      if (!fim && pendentes.length < LOTE_ITENS) return;
      // Item "atualizada" sem mudança é ruído no histórico; guarda só o que importa.
      await gravarItens(db, importacaoId, pendentes.filter((i) => i.resultado !== "atualizada" || Boolean(i.motivo?.startsWith("Dados atualizados"))));
      gravados = itens.length;
    };

    /** Processa uma página. Devolve falso se contatos de negociações NOVAS ficaram sem leitura (a página é relida). */
    const processarPagina = async (pagina: Json[], semEsperarContato = false) => {
      let anonimo = 0;
      const lidas = pagina.filter((d) => {
        const id = stringValue(d.id) || `__sem_id_${vistas.size}_${anonimo++}`;
        if (vistas.has(id)) return false;
        vistas.add(id);
        return true;
      });
      // Contato/origem guardados só das vendas desta página (o índice é leve).
      await completarCaches(db, indice, lidas.map((d) => indice.vendaPorRd.get(stringValue(d.id))?.id).filter(Boolean) as string[]);
      // O RD aceita 120 consultas/min: o contato é lido para toda negociação nova e venda sem
      // contato guardado; os guardados vencidos são relidos aos poucos. O resto usa o cache.
      const cachePorContato = new Map<string, ContatoEmCache>();
      const novos: string[] = [];
      const semCache: string[] = [];
      const vencidos: { id: string; lidoEm: string }[] = [];
      for (const d of lidas) {
        const idContato = idsContatoDaNegociacao(d)[0];
        if (!idContato) continue;
        const venda = indice.vendaPorRd.get(stringValue(d.id));
        const cache = venda ? indice.vendaPorId?.get(venda.id)?.contato : null;
        if (cache && stringValue(cache.dados.id) === idContato) cachePorContato.set(idContato, cache);
        if (!venda) novos.push(idContato);
        else if (!cache || stringValue(cache.dados.id) !== idContato) semCache.push(idContato);
        else if (Date.parse(cache.lidoEm) < Date.now() - CONTATO_VALIDADE_MS) vencidos.push({ id: idContato, lidoEm: cache.lidoEm });
      }
      // Sem cota: todos os guardados vencidos são relidos (os mais antigos primeiro). O que não couber
      // no tempo desta execução é relido na próxima; a venda mantém os dados enquanto isso.
      const renovar = vencidos.sort((a, b) => a.lidoEm.localeCompare(b.lidoEm)).map((x) => x.id);
      const pedirTodos = [...new Set([...novos, ...semCache, ...renovar])];
      // Contatos que a varredura do espelho já leu (até 6 h) não gastam consulta ao RD:
      // antes, cada cliente nova custava uma consulta e uma passada com todos os funis levava horas.
      const doEspelho = espelho && pedirTodos.length ? await espelho.contatos(pedirTodos).catch(() => new Map<string, Json>()) : new Map<string, Json>();
      const pedir = pedirTodos.filter((id) => !doEspelho.has(id));
      const leitura: LeituraContatos = fontes.contatos
        ? (pedir.length ? await fontes.contatos(pedir, Math.max(5_000, prazo - relogio())) : { contatos: new Map(), falhas: new Set() })
        : { contatos: mapById(r.contatos), falhas: new Set() };
      if (espelho && leitura.contatos.size) await espelho.guardarContatos([...leitura.contatos.values()]);
      for (const [id, c] of doEspelho) leitura.contatos.set(id, c);
      const contatosLidos = leitura.contatos;
      const contatosTodos = new Map<string, Json>([...[...cachePorContato].map(([id, c]) => [id, c.dados] as [string, Json]), ...contatosLidos]);
      const refs = { contatos: contatosTodos, usuarios, campanhas, fontes: fontesRef };
      // De onde a cliente veio: todas as negociações do mesmo contato (qualquer funil), em lote.
      // Falha na consulta não trava a importação: a origem guardada antes é mantida.
      const idsContatos = [...new Set(lidas.map((d) => idsContatoDaNegociacao(d)[0]).filter(Boolean))] as string[];
      let porContato: Map<string, Json[]> | null = new Map();
      if (fontes.dealsDosContatos && idsContatos.length) {
        try { porContato = agruparPorContato(await fontes.dealsDosContatos(idsContatos)); } catch { porContato = null; }
      }
      // Origem já resolvida no espelho (com os outros cadastros da mesma pessoa, crm-origem-geral).
      const origensEspelho = espelho && lidas.length
        ? await espelho.origens(lidas.map((d) => stringValue(d.id)).filter(Boolean)).catch(() => new Map<string, OrigemCliente>())
        : new Map<string, OrigemCliente>();
      const origemDe = (d: Json): OrigemCliente | undefined => {
        const doEspelho = origensEspelho.get(stringValue(d.id));
        if (!porContato) return doEspelho;
        const ct = idsContatoDaNegociacao(d)[0];
        const fresca = montarOrigem(d, ct ? porContato.get(ct) ?? [] : [], { fontes: fontesRef, campanhas, funis: nomesFunis }, { semContato: !ct, agora: agoraIso });
        // O que está no RD agora (própria negociação e mesmo contato) + o que veio de outros cadastros.
        return doEspelho ? manterAmpliada(fresca, doEspelho) : fresca;
      };
      // Entre negociações novas com o mesmo telefone, a mais completa é gravada primeiro; as demais
      // viram duplicatas dela. Negociações já importadas mantêm a ordem.
      const pontos = new Map<Json, number>();
      for (const d of lidas) {
        const sn = normalizarDealRd(d, refs);
        if (!sn || indice.vendaPorRd.has(sn.rdStationId)) { pontos.set(d, Infinity); continue; }
        const contato = sn.rdContactId ? refs.contatos.get(sn.rdContactId) : undefined;
        pontos.set(d, completude(aplicarMapeamento(sn, d, contato, config), extrairCamposSelecionados(sn, d, contato, config)));
      }
      const deals = lidas.slice().sort((a, b) => (pontos.get(b) ?? 0) - (pontos.get(a) ?? 0));
      let completa = true;
      for (const deal of deals) {
        const snapshot = normalizarDealRd(deal, refs);
        let item: ItemImportacao;
        if (!snapshot) {
          // Nunca descartar em silêncio: vira item e pendência.
          // Chave estável pelo conteúdo: a mesma negociação sem ID não abre uma pendência nova a cada execução.
          item = { external_id: `sem-id-${chaveEstavel(deal)}`, resultado: "erro", motivo: "Negociação sem identificador no RD.", correspondencias: [], nova_venda_id: null, dados: { rdStatus: stringValue(deal.status) || null } };
        } else {
          const contato = snapshot.rdContactId ? refs.contatos.get(snapshot.rdContactId) : undefined;
          const idC = snapshot.rdContactId;
          const contatoIndisponivel = Boolean(idC && !contato && leitura.falhas.has(idC));
          const contatoAdiado = Boolean(idC && !contato && !contatoIndisponivel);
          if (contatoAdiado && !indice.vendaPorRd.has(snapshot.rdStationId) && !semEsperarContato) {
            // Não lida agora (limite do RD): sai de `vistas` para entrar quando a página for relida.
            vistas.delete(snapshot.rdStationId);
            adiadas++;
            completa = false;
            continue;
          }
          try {
            const origem = origemDe(deal);
            origens[origem?.situacao ?? "nao_verificada"]++;
            item = await processarNegociacao(db, { deal, snapshot, contato, config, indice, importacaoId, contatoIndisponivel, contatoAdiado,
              contatoLidoEm: idC && contatosLidos.has(idC) ? agoraIso : null, origem });
          } catch {
            item = { external_id: snapshot.rdStationId, resultado: "erro", motivo: "Falha inesperada ao processar.", correspondencias: [], nova_venda_id: null, dados: { rdStatus: snapshot.rdStatus } };
          }
        }
        itens.push(item);
        await registrarPendenciasDoItem(db, item, opcoes.origem, importacaoId);
        await descarregar();
      }
      return completa;
    };

    const proximoSegmento = () => { progresso.indice++; progresso.desde = null; progresso.pagina = 1; progresso.tentativas = 0; progresso.noLimite = []; };
    while (progresso.indice < progresso.segmentos.length && relogio() < prazo) {
      const segmento = progresso.segmentos[progresso.indice];
      let pagina: Json[];
      try {
        pagina = await lerPagina(segmento, progresso.semFiltroData ? null : progresso.desde, progresso.pagina);
      } catch (e) {
        // Filtro por data recusado pelo RD: segue pelo número da página (até o limite de 10 mil).
        if (progresso.desde && !progresso.semFiltroData && e instanceof Error && /^RD_HTTP_(400|422)$/.test(e.message)) {
          progresso.semFiltroData = true;
          progresso.desde = null;
          progresso.pagina = 1;
          continue;
        }
        throw e;
      }
      if (!pagina.length) { proximoSegmento(); await salvarProgresso(db, progresso); continue; }
      const antes = vistas.size;
      const completa = await processarPagina(pagina, progresso.tentativas >= TENTATIVAS_POR_PAGINA - 1);
      progresso.lidas += vistas.size - antes;
      if (!completa) {
        progresso.tentativas++;
        // A mesma página é relida na próxima execução; as já processadas dela não contam de novo.
        if (!progresso.semFiltroData) progresso.noLimite = pagina.map((d) => stringValue(d.id)).filter((id) => id && vistas.has(id));
        await salvarProgresso(db, progresso);
        break;
      }
      progresso.tentativas = 0;
      if (pagina.length < TAMANHO_PAGINA_RD) {
        proximoSegmento();
      } else if (progresso.semFiltroData) {
        if (progresso.pagina >= 100) throw new Error("RD_RESULT_LIMIT_10000");
        progresso.pagina++;
      } else {
        const ultima = dataRdql(pagina[pagina.length - 1].created_at);
        // Próxima consulta a partir da data da última lida (as do mesmo segundo são puladas por `vistas`).
        if (ultima && ultima !== progresso.desde) { progresso.desde = ultima; progresso.pagina = 1; } else progresso.pagina++;
        progresso.noLimite = pagina.filter((d) => dataRdql(d.created_at) === progresso.desde).map((d) => stringValue(d.id)).filter((id) => id && vistas.has(id));
      }
      await salvarProgresso(db, progresso);
    }
    await descarregar(true);
    const concluida = progresso.indice >= progresso.segmentos.length;
    if (concluida) progresso.concluidaEm = new Date().toISOString();
    await salvarProgresso(db, progresso);
    // Execução completa: falhas de execução anteriores deixaram de valer.
    await db.from("integracao_pendencias").update({ estado: "resolvida", resolucao: "resolvida_pela_origem", resolvido_por: opcoes.ator, resolvido_em: new Date().toISOString() })
      .eq("provedor", "rd_station").in("tipo", ["execucao_falhou", "execucao_interrompida"]).eq("estado", "aberta");
    const passada = {
      concluida, iniciadaEm: progresso.iniciadaEm, lidas: progresso.lidas, execucoes: progresso.execucoes,
      lidoAte: progresso.desde, funil: Math.min(progresso.indice + 1, progresso.segmentos.length), funis: progresso.segmentos.length,
      // Quantas negociações a passada tem no total (catálogo exato), para a tela mostrar "X de Y".
      total: await totalDaPassada(db, config).catch(() => null),
    };
    const resumo = { ...totais(itens, vistas.size - jaVistas), adiadas, somenteLeitura: true, passada, origens };
    const status = resumo.erros ? "parcial" : "concluida";
    await db.from("integracao_importacoes").update({ status, totais: resumo, concluido_em: new Date().toISOString() }).eq("id", importacaoId);
    await registrarEvento(db, { eventType: `importacao_${opcoes.origem}`, referencia: importacaoId, payload: resumo, status: resumo.erros ? "parcial" : "processado" });
    await db.from("logs_alteracoes").insert({ usuario: opcoes.ator, acao: "importou_crm_rd_station", entidade: "integracoes", entidade_id: "rd_station", detalhes: { importacaoId, origem: opcoes.origem, filtro, ...resumo } });
    return { ok: true as const, importacaoId, filtro, ...resumo };
  } catch (error) {
    // Código explícito também quando a falha é ao registrar pendência (antes virava "Falha ao ler o RD").
    const mensagem = error instanceof Error && /^(RD_|PENDENCIA_)/.test(error.message) ? error.message : "Falha ao ler o RD Station.";
    await db.from("integracao_importacoes").update({ status: "erro", erro: mensagem, concluido_em: new Date().toISOString() }).eq("id", importacaoId);
    await registrarEvento(db, { eventType: `importacao_${opcoes.origem}`, referencia: importacaoId, status: "erro", erro: mensagem, payload: {} });
    // Falha da EXECUÇÃO inteira (não de uma negociação): uma pendência por código de erro,
    // somando ocorrências (as 75 falhas de token de 24–25/09 seriam UMA pendência com 75).
    await registrarPendencia(db, {
      tipo: "execucao_falhou", externalId: codigoErroExecucao(mensagem), motivo: mensagem, origem: opcoes.origem, importacaoId,
      acao: mensagem === "RD_ACCESS_TOKEN_MISSING" ? "Reconectar o RD Station no Dev Console e reprocessar." : "Verificar a conexão com o RD no Dev Console e reprocessar.",
    }).catch(() => undefined);
    return { ok: false as const, importacaoId, erro: mensagem };
  } finally {
    await db.rpc("integracao_liberar_trava", { p_nome: "crm_importacao" });
  }
}

/** Uma negociação do webhook: mesmo filtro, mesmo mapeamento, mesma deduplicação. */
/**
 * O webhook do RD envia a negociação no formato antigo (v1): deal_pipeline/deal_stage/user como
 * objetos e campos personalizados por rótulo, sem pipeline_id nem slugs. Sem conversão, o funil
 * chegava vazio e o filtro de funis não valia para o webhook (em 29/09 entraram vendas de Vendas,
 * Inadimplentes e Remarketing). Converte os ids para os nomes da v2.
 */
export function dealDoWebhookV1(deal: Json): Json {
  const id = (v: unknown) => stringValue(objectValue(v).id) || null;
  const out: Json = { ...deal };
  if (!out.pipeline_id && id(deal.deal_pipeline)) out.pipeline_id = id(deal.deal_pipeline);
  if (!out.stage_id && id(deal.deal_stage)) out.stage_id = id(deal.deal_stage);
  if (!out.owner_id && id(deal.user)) out.owner_id = id(deal.user);
  if (!out.source_id && id(deal.deal_source)) out.source_id = id(deal.deal_source);
  if (!out.campaign_id && id(deal.campaign)) out.campaign_id = id(deal.campaign);
  if (!out.contact_ids && Array.isArray(deal.contacts)) out.contact_ids = deal.contacts.map((c: unknown) => id(c)).filter(Boolean);
  return out;
}

/** A negociação completa na v2 (funil, etapa, contatos e campos por slug), igual à importação. */
async function lerDealRd(env: Env, id: string): Promise<Json | null> {
  try {
    const r = await rdGet(env, `/deals/${encodeURIComponent(id)}`);
    const d = objectValue(r.data);
    return stringValue(d.id) ? d : null;
  } catch {
    return null;
  }
}

export async function importarDoWebhook(env: Env, db: Db, dealEvento: Json, transacao: string | null,
  deps: { contatos?: (ids: string[]) => Promise<LeituraContatos>; lerDeal?: (id: string) => Promise<Json | null>; espelho?: EspelhoImportacao | null } = {}) {
  // Mesmo formato da importação: relê a negociação na v2; sem ela, converte o evento (v1).
  const idDeal = stringValue(dealEvento.id);
  const v2 = idDeal ? await (deps.lerDeal ?? ((i: string) => lerDealRd(env, i)))(idDeal) : null;
  const deal = v2 ?? dealDoWebhookV1(dealEvento);
  // O evento traz só a negociação: o contato é lido pelo id, como na importação.
  const idContato = idsContatoDaNegociacao(deal)[0];
  const leitura: LeituraContatos = idContato ? await (deps.contatos ?? ((ids: string[]) => lerContatosRd(env, ids)))([idContato]) : { contatos: new Map<string, Json>(), falhas: new Set<string>() };
  const indice = await carregarIndice(db);
  // Limite do RD: usa o contato guardado da venda, se houver.
  const vendaIdx = indice.vendaPorRd.get(stringValue(deal.id));
  if (vendaIdx) await completarCaches(db, indice, [vendaIdx.id]);
  const cache = vendaIdx ? indice.vendaPorId?.get(vendaIdx.id)?.contato : null;
  const contatos = new Map(leitura.contatos);
  if (idContato && !contatos.has(idContato) && cache && stringValue(cache.dados.id) === idContato) contatos.set(idContato, cache.dados);
  // Espelho do RD (todos os funis): a negociação nova/alterada entra já, sem esperar a varredura de 6 h.
  if (v2) {
    const agora = new Date().toISOString();
    await gravarNegociacoes(db, [v2], agora).catch(() => undefined);
    await gravarContatos(db, [...leitura.contatos.values()], agora).catch(() => undefined);
  }
  const snapshot = normalizarDealRd(deal, { contatos });
  if (!snapshot) return null;
  const contato = snapshot.rdContactId ? contatos.get(snapshot.rdContactId) : undefined;
  const contatoIndisponivel = Boolean(snapshot.rdContactId && !contato && leitura.falhas.has(snapshot.rdContactId));
  const contatoAdiado = Boolean(snapshot.rdContactId && !contato && !contatoIndisponivel);
  const contatoLidoEm = snapshot.rdContactId && leitura.contatos.has(snapshot.rdContactId) ? new Date().toISOString() : null;
  const config = await configDaFuncao<ConfigCrm>(env, "rd_station", "importacao", { db });
  const { data: imp } = await db.from("integracao_importacoes")
    .insert({ provedor: "rd_station", origem: "webhook", filtro: filtroRdql(config), iniciado_por: "sistema:rd_station_webhook" }).select("id").single();
  const importacaoId = imp ? String((imp as Json).id) : null;
  const item: ItemImportacao = contatoAdiado && !vendaIdx
    ? { external_id: snapshot.rdStationId, resultado: "ignorada", motivo: "Contato ainda não lido (limite de consultas do RD); a negociação entra na próxima sincronização.", correspondencias: [], nova_venda_id: null, dados: { rdStatus: snapshot.rdStatus, rdPipelineId: snapshot.rdPipelineId, rdStageId: snapshot.rdStageId } }
    : await processarNegociacao(db, { deal, snapshot, contato, config, indice, importacaoId, contatoIndisponivel, contatoAdiado, contatoLidoEm,
      // Origem já resolvida no espelho (todos os cadastros da pessoa): a venda nova não nasce sem fonte/campanha.
      origem: (await (deps.espelho === undefined ? espelhoDoBanco(db) : deps.espelho)?.origens([snapshot.rdStationId]).catch(() => null))?.get(snapshot.rdStationId) ?? undefined });
  await registrarPendenciasDoItem(db, item, "webhook", importacaoId);
  if (importacaoId) {
    if (item.resultado !== "atualizada") await gravarItens(db, importacaoId, [item]);
    await db.from("integracao_importacoes").update({ status: item.resultado === "erro" ? "parcial" : "concluida", totais: { ...totais([item], 1), transacao }, concluido_em: new Date().toISOString() }).eq("id", importacaoId);
  }
  return { snapshot, item };
}

/**
 * Chamado pelo agendador: roda só se ligado e se a frequência venceu. Uma passada em andamento
 * (importação em etapas) continua a cada chamada, sem esperar a frequência. `somenteContinuacao`
 * (rodada de 5 min) só continua uma passada; nunca começa outra.
 */
export async function importacaoAgendadaSeDevida(env: Env, deps: { db?: Db; agora?: Date; fontes?: Fontes; somenteContinuacao?: boolean } = {}) {
  const db = deps.db ?? createServiceSupabaseClient(env);
  const config = await configDaFuncao<ConfigCrm>(env, "rd_station", "importacao", { db });
  if (!config.ativo) return { executada: false, motivo: "desligada" };
  const emAndamento = await passadaEmAndamento(db);
  if (deps.somenteContinuacao && !emAndamento) return { executada: false, motivo: "sem_passada_em_andamento" };
  const { data: ultima } = await db.from("integracao_importacoes").select("iniciado_em")
    .eq("provedor", "rd_station").eq("origem", "agendada").order("iniciado_em", { ascending: false }).limit(1).maybeSingle();
  const agora = (deps.agora ?? new Date()).getTime();
  const desde = ultima ? agora - new Date(String((ultima as Json).iniciado_em)).getTime() : Infinity;
  // 1 min de folga: o agendador não bate exatamente no mesmo segundo.
  if (!emAndamento && desde < (config.frequenciaMinutos - 1) * 60_000) return { executada: false, motivo: "ainda_nao_venceu" };
  const r = await importarCrm(env, { origem: "agendada", ator: "sistema:agendador" }, { db, fontes: deps.fontes, config });
  return { executada: true, resultado: r };
}

// ------------------------------------------------------------------ leituras para as telas

const mascararCpf = (v: unknown) => { const d = stringValue(v).replace(/\D/g, ""); return d.length === 11 ? `***.***.***-${d.slice(9)}` : null; };
const mascararTelefone = (v: unknown) => { const d = stringValue(v).replace(/\D/g, ""); return d.length >= 8 ? `(**) *****-${d.slice(-4)}` : null; };
const mascararEmail = (v: unknown) => { const e = stringValue(v); const [u, dom] = e.split("@"); return u && dom ? `${u[0]}***@${dom}` : null; };

/** Itens do histórico com dados pessoais mascarados (o Admin abre a cliente/venda pelo id). */
export function itemParaTela(item: Json) {
  const d = objectValue(item.dados);
  return {
    id: item.id, externalId: item.external_id, resultado: item.resultado, motivo: item.motivo,
    correspondencias: arrayValue(item.correspondencias), novaVendaId: item.nova_venda_id ?? null,
    revisadoPor: item.revisado_por ?? null, revisadoEm: item.revisado_em ?? null, criadoEm: item.created_at,
    dados: {
      nome: d.nome ?? null, cpf: mascararCpf(d.cpf), telefone: mascararTelefone(d.telefone), email: mascararEmail(d.email),
      valorContrato: d.valor_contrato ?? null, etapa: d.rdStageId ?? null, status: d.rdStatus ?? null,
      completude: typeof d.completude === "number" ? d.completude : null,
    },
  };
}

export async function listarImportacoes(db: Db, limite = 30, incluirWebhook = false) {
  // Cada evento de webhook vira uma execução: sem este filtro, as 30 mais recentes eram todas
  // webhook e o último erro de execução ficava na posição 3.038 (docs/DIAGNOSTICO-RD).
  let q = db.from("integracao_importacoes")
    .select("id,origem,status,filtro,totais,erro,iniciado_por,iniciado_em,concluido_em")
    .eq("provedor", "rd_station").order("iniciado_em", { ascending: false }).limit(Math.min(100, Math.max(1, limite)));
  if (!incluirWebhook) q = q.neq("origem", "webhook");
  const { data, error } = await q;
  if (error) return { disponivel: false, importacoes: [] };
  const aguardando = await itensDaImportacao(db, null, true);
  return { disponivel: true, importacoes: data ?? [], aguardandoRevisao: aguardando.length, origens: await coberturaOrigens(db).catch(() => null) };
}

/**
 * Quantas vendas do RD têm fonte e campanha registradas, e o andamento da busca em outros
 * cadastros (mesmo e-mail/telefone). Para o Admin acompanhar sem abrir cliente por cliente.
 */
let coberturaCache: { expiraEm: number; valor: Awaited<ReturnType<typeof calcularCoberturaOrigens>> } | null = null;
/** Lê todas as vendas: guardada 10 min (a tela de importações abre muitas vezes). */
export async function coberturaOrigens(db: Db) {
  if (coberturaCache && coberturaCache.expiraEm > Date.now()) return coberturaCache.valor;
  const valor = await calcularCoberturaOrigens(db);
  coberturaCache = { expiraEm: Date.now() + 10 * 60_000, valor };
  return valor;
}

async function calcularCoberturaOrigens(db: Db) {
  const linhas = await todasAsLinhas<Json>((de, ate) => db.from("novas_vendas")
    .select("id,situacao:rd_snapshot->_sra_origem->>situacao,ampliada:rd_snapshot->_sra_origem->ampliada->>em,origem_venda,campanha_local")
    .not("rd_station_id", "is", null).order("id").range(de, ate));
  const porSituacao: Record<string, number> = { encontrada: 0, parcial: 0, sem_registro_no_rd: 0, sem_contato: 0, nao_verificada: 0 };
  let buscaAmpliadaFeita = 0, buscaAmpliadaPendente = 0, colunasEmBranco = 0;
  for (const l of linhas) {
    const situacao = stringValue(l.situacao) || "nao_verificada";
    porSituacao[situacao in porSituacao ? situacao : "nao_verificada"]++;
    if (situacao !== "encontrada" && situacao !== "nao_verificada") {
      if (l.ampliada) buscaAmpliadaFeita++; else buscaAmpliadaPendente++;
    }
    if (vazio(l.origem_venda) || vazio(l.campanha_local)) colunasEmBranco++;
  }
  const { data } = await db.from("integracao_catalogos").select("dados").eq("provedor", "rd_station").eq("chave", "crm_origem_resolucao").maybeSingle();
  const r = objectValue((data as Json | null)?.dados);
  const espelho = (await lerContagens(db))?.espelho ?? null;
  return {
    total: linhas.length, porSituacao, colunasEmBranco, buscaAmpliadaFeita, buscaAmpliadaPendente,
    resolucao: { em: r.em ?? null, negociacoes: Number(r.negociacoes ?? 0), vendasPendentes: Array.isArray(r.vendasPendentes) ? r.vendasPendentes.length : 0, erro: r.erro ?? null },
    espelho,
  };
}

const RESULTADOS_REVISAO = ["duplicada", "cliente_existente"];

/** Já houve decisão "mesma pessoa" para esta negociação (item revisado sem venda criada). */
async function duplicidadeJaDecidida(db: Db, rdStationId: string) {
  const { data } = await db.from("integracao_importacao_itens").select("id").eq("external_id", rdStationId)
    .in("resultado", RESULTADOS_REVISAO).not("revisado_em", "is", null).limit(1);
  return (data ?? []).length > 0;
}

export async function itensDaImportacao(db: Db, importacaoId: string | null, apenasRevisao = false) {
  let q = db.from("integracao_importacao_itens").select("*").order("created_at", { ascending: false }).limit(apenasRevisao ? 2000 : 500);
  if (importacaoId) q = q.eq("importacao_id", importacaoId);
  if (apenasRevisao) q = q.in("resultado", RESULTADOS_REVISAO).is("revisado_em", null);
  const { data, error } = await q;
  if (error) return [];
  if (!apenasRevisao) return (data ?? []).map(itemParaTela);
  // Revisão: UMA linha por negociação (a mais recente). Cada execução grava um item novo para a
  // mesma duplicidade; sem agrupar, a fila repetia a negociação uma vez por execução.
  const porNegociacao = new Map<string, Json & { repeticoes: number }>();
  for (const it of (data ?? []) as Json[]) {
    const chave = String(it.external_id);
    const atual = porNegociacao.get(chave);
    if (atual) atual.repeticoes += 1; else porNegociacao.set(chave, { ...it, repeticoes: 1 });
  }
  const ids = [...porNegociacao.keys()];
  if (ids.length) {
    const [{ data: decididas }, { data: vendas }] = await Promise.all([
      db.from("integracao_importacao_itens").select("external_id").in("external_id", ids).in("resultado", [...RESULTADOS_REVISAO, "importada_apos_revisao"]).not("revisado_em", "is", null),
      db.from("novas_vendas").select("rd_station_id").in("rd_station_id", ids),
    ]);
    for (const x of [...(decididas ?? []).map((d) => (d as Json).external_id), ...(vendas ?? []).map((v) => (v as Json).rd_station_id)]) porNegociacao.delete(String(x));
  }
  return [...porNegociacao.values()].map((it) => ({ ...itemParaTela(it), repeticoes: it.repeticoes }));
}

/** Decisão humana vale para a negociação inteira: fecha as repetições e a pendência de duplicidade. */
async function encerrarRevisaoDaNegociacao(db: Db, externalId: string, ator: string, agora: string, mesmaPessoa: boolean) {
  await db.from("integracao_importacao_itens").update({ revisado_por: ator, revisado_em: agora })
    .eq("external_id", externalId).in("resultado", RESULTADOS_REVISAO).is("revisado_em", null);
  await db.from("integracao_pendencias").update(mesmaPessoa
    ? { estado: "descartada", resolucao: "decidida_na_revisao", nota: "Confirmada como a mesma pessoa na revisão.", resolvido_por: ator, resolvido_em: agora }
    : { estado: "resolvida", resolucao: "decidida_na_revisao", nota: "Importada mesmo assim na revisão.", resolvido_por: ator, resolvido_em: agora })
    .eq("provedor", "rd_station").eq("tipo", "duplicidade_possivel").eq("external_id", externalId).eq("estado", "aberta");
}

/** Revisão humana de uma duplicidade: grava a venda mesmo assim, em Aguardando cadastro. */
export async function importarMesmoAssim(db: Db, itemId: string, ator: string) {
  const { data: item } = await db.from("integracao_importacao_itens").select("*").eq("id", itemId).maybeSingle();
  if (!item) return { ok: false as const, status: 404, erro: "Item não encontrado." };
  const it = item as Json;
  if (!["duplicada", "cliente_existente"].includes(it.resultado) || it.revisado_em) return { ok: false as const, status: 409, erro: "Este item não está aguardando revisão." };
  const { data: existente } = await db.from("novas_vendas").select("id").eq("rd_station_id", it.external_id).maybeSingle();
  if (existente) return { ok: false as const, status: 409, erro: "Esta negociação já está nas novas vendas." };
  const d = objectValue(it.dados);
  const { data: venda, error } = await db.from("novas_vendas").insert({
    rd_station_id: it.external_id, nome_completo: d.nome, cpf: d.cpf ?? null, telefone: d.telefone ?? null, email: d.email ?? null,
    data_venda: d.dataVenda ?? new Date().toISOString(), vendedora_responsavel: d.vendedora ?? null, valor_contrato: Number(d.valor_contrato ?? 0),
    quantidade_parcelas: d.quantidade_parcelas ?? null, valor_parcela: d.valor_parcela ?? null, taxa_administrativa: d.taxa_administrativa ?? null,
    tipo_venda: d.tipo_venda ?? null, procedimento_local: d.procedimento ?? null, banco_local: d.banco ?? null,
    origem_venda: d.origem ?? null, campanha_local: d.campanha ?? null, rd_status: d.rdStatus ?? null, rd_pipeline_id: d.rdPipelineId ?? null, rd_stage_id: d.rdStageId ?? null,
    status: "aguardando_cadastro", importacao_id: it.importacao_id, sincronizado_rd_em: new Date().toISOString(),
  }).select("id").single();
  if (error || !venda) return { ok: false as const, status: 500, erro: "Não foi possível gravar a venda." };
  const agora = new Date().toISOString();
  await db.from("integracao_importacao_itens").update({ resultado: "importada_apos_revisao", nova_venda_id: (venda as Json).id, revisado_por: ator, revisado_em: agora }).eq("id", itemId);
  await encerrarRevisaoDaNegociacao(db, String(it.external_id), ator, agora, false);
  // A venda importada passa pelas mesmas regras (CPF, valor, vendedora): incompleta não conta no BI.
  await db.rpc("rd_recalcular_pendencias_venda", { p_venda_id: (venda as Json).id, p_origem: "revisao", p_importacao_id: it.importacao_id ?? null, p_ator: ator });
  await db.from("logs_alteracoes").insert({ usuario: ator, acao: "importou_venda_duplicada_apos_revisao", entidade: "novas_vendas", entidade_id: (venda as Json).id, detalhes: { itemId, rdStationId: it.external_id, correspondencias: it.correspondencias, escritaNoRd: false } });
  return { ok: true as const, novaVendaId: String((venda as Json).id) };
}

/**
 * Revisão humana: usa ESTE perfil (a duplicata) na venda pendente com o mesmo telefone. Os dados
 * preenchidos da duplicata substituem os da venda; os valores anteriores ficam no log (nada se perde).
 */
export async function usarPerfilDaDuplicata(db: Db, itemId: string, ator: string) {
  const { data: item } = await db.from("integracao_importacao_itens").select("*").eq("id", itemId).maybeSingle();
  if (!item) return { ok: false as const, status: 404, erro: "Item não encontrado." };
  const it = item as Json;
  if (it.resultado !== "duplicada" || it.revisado_em) return { ok: false as const, status: 409, erro: "Este item não está aguardando revisão." };
  const alvo = arrayValue(it.correspondencias).map(objectValue).find((c) => c.tipo === "venda");
  if (!alvo) return { ok: false as const, status: 409, erro: "Não há venda pendente para receber este perfil." };
  const { data: venda } = await db.from("novas_vendas").select(COLUNAS_VENDA).eq("id", alvo.id).maybeSingle();
  const v = venda as Json | null;
  if (!v || v.cliente_id || v.status !== "aguardando_cadastro") return { ok: false as const, status: 409, erro: "A venda já foi cadastrada ou não existe mais; use \"Importar mesmo assim\"." };
  const d = objectValue(it.dados);
  const patch: Json = {}, antes: Json = {};
  for (const [campo, coluna] of COLUNAS_PREENCHIDAS) {
    const novo = d[campo];
    if (vazio(novo) || (v[coluna] ?? null) === novo) continue;
    patch[coluna] = novo;
    antes[coluna] = v[coluna] ?? null;
  }
  const agora = new Date().toISOString();
  if (Object.keys(patch).length) {
    const { error } = await db.from("novas_vendas").update({ ...patch, updated_at: agora }).eq("id", alvo.id);
    if (error) return { ok: false as const, status: 500, erro: "Não foi possível atualizar a venda." };
  }
  await db.from("integracao_importacao_itens").update({ nova_venda_id: alvo.id, revisado_por: ator, revisado_em: agora }).eq("id", itemId);
  await encerrarRevisaoDaNegociacao(db, String(it.external_id), ator, agora, true);
  await db.rpc("rd_recalcular_pendencias_venda", { p_venda_id: alvo.id, p_origem: "revisao", p_importacao_id: it.importacao_id ?? null, p_ator: ator });
  await db.from("logs_alteracoes").insert({ usuario: ator, acao: "usou_perfil_duplicata_crm", entidade: "novas_vendas", entidade_id: alvo.id, detalhes: { itemId, rdStationId: it.external_id, campos: Object.keys(patch), antes, escritaNoRd: false } });
  return { ok: true as const, vendaId: String(alvo.id), campos: Object.keys(patch) };
}

export async function descartarRevisao(db: Db, itemId: string, ator: string) {
  const agora = new Date().toISOString();
  const { data, error } = await db.from("integracao_importacao_itens").update({ revisado_por: ator, revisado_em: agora })
    .eq("id", itemId).in("resultado", RESULTADOS_REVISAO).is("revisado_em", null).select("id,external_id").maybeSingle();
  if (error || !data) return { ok: false as const, status: 409, erro: "Este item não está aguardando revisão." };
  await encerrarRevisaoDaNegociacao(db, String((data as Json).external_id), ator, agora, true);
  await db.from("logs_alteracoes").insert({ usuario: ator, acao: "confirmou_duplicidade_crm", entidade: "integracoes", entidade_id: itemId, detalhes: { escritaNoRd: false } });
  return { ok: true as const };
}

/**
 * Funis, etapas, campos e valores do RD para montar a configuração.
 * Vem do catálogo pré-calculado (crm-catalogo.ts): a tela não espera o RD.
 */
export async function opcoesCrm(env: Env) {
  const catalogo = await catalogoCrm(env);
  // Contagem exata por status, etapa, responsável e mês (crm-contagens). Sem ela, o catálogo segue igual.
  const db = createServiceSupabaseClient(env);
  const contagens = await lerContagens(db).catch(() => null);
  // Fonte e campanha por funil, de todas as clientes de todos os funis (crm-origem-geral).
  const origens = await db.from("integracao_catalogos").select("dados").eq("provedor", "rd_station").eq("chave", "crm_origem_funis").maybeSingle()
    .then(({ data }) => objectValue((data as Json | null)?.dados), () => ({} as Json));
  return {
    ...catalogo,
    contagens: contagensParaTela(contagens, catalogo.funis),
    origens: { atualizadoEm: origens.atualizadoEm ?? null, porFunil: objectValue(origens.porFunil) },
    espelho: contagens?.espelho ?? null,
  };
}

/**
 * Relê UMA negociação e processa com a mesma chave rd_station_id (única em novas_vendas):
 * se a venda existe, só o snapshot muda; se não existe e agora passa nos filtros, é criada uma vez.
 */
export async function reprocessarNegociacao(env: Env, db: Db, externalId: string, ator: string,
  fonte?: (id: string) => Promise<{ deal: Json; contato?: Json }>) {
  try {
    const lido = fonte ? await fonte(externalId) : await lerNegociacaoRd(env, externalId);
    const snapshot = normalizarDealRd(lido.deal, { contatos: lido.contato ? mapById([lido.contato]) : undefined });
    if (!snapshot) return { ok: false, erro: "O RD não devolveu a negociação." };
    const config = await configDaFuncao<ConfigCrm>(env, "rd_station", "importacao", { db });
    const indice = await carregarIndice(db);
    const existente = indice.vendaPorRd.get(snapshot.rdStationId);
    if (existente) await completarCaches(db, indice, [existente.id]);
    const item = await processarNegociacao(db, { deal: lido.deal, snapshot, contato: lido.contato, config, indice, importacaoId: null });
    if (item.resultado === "criada" || item.resultado === "atualizada") {
      // Primeiro registra que foi a pessoa que reprocessou; depois o recálculo avalia a venda.
      await db.from("integracao_pendencias").update({ estado: "resolvida", resolucao: "reprocessada", resolvido_por: ator, resolvido_em: new Date().toISOString() })
        .eq("provedor", "rd_station").eq("external_id", externalId).in("tipo", ["negociacao_com_erro", "ganha_fora_do_funil"]).eq("estado", "aberta");
    }
    await registrarPendenciasDoItem(db, item, "reprocessamento", null);
    return { ok: true, resultado: item.resultado };
  } catch (e) {
    const msg = e instanceof Error && /^RD_/.test(e.message) ? e.message : "Falha ao reler a negociação no RD.";
    return { ok: false, erro: msg };
  }
}

async function lerNegociacaoRd(env: Env, id: string) {
  const r = await rdGet(env, `/deals/${encodeURIComponent(id)}`);
  const deal = objectValue(r.data ?? r);
  const contatoId = stringValue(arrayValue(deal.contact_ids)[0]) || stringValue(objectValue(deal.contact).id);
  let contato: Json | undefined;
  if (contatoId) {
    const { contatos } = await lerContatosRd(env, [contatoId]);
    contato = contatos.get(contatoId);
    // Sem o contato, telefone/CPF sairiam vazios: não reprocessa com dados incompletos.
    if (!contato) throw new Error("RD_CONTATO_INDISPONIVEL");
  }
  return { deal, contato };
}

// ------------------------------------------------------------------ revisão em lote

export type AcaoRevisaoLote = "importar" | "descartar" | "usar-perfil" | "mais-completo";

/**
 * A mesma revisão para vários itens de uma vez (a lista chegava a centenas). "mais-completo" aplica a
 * regra da importação item a item: se esta negociação tem mais dados que a venda pendente, o perfil
 * dela vai para a venda; senão, mantém a venda pendente (mesma pessoa). Nada é apagado e cada item
 * fica no histórico como se tivesse sido revisado um por um.
 */
export async function revisarEmLote(db: Db, acao: AcaoRevisaoLote, ids: string[], ator: string) {
  const unicos = [...new Set(ids)].slice(0, 1000);
  const resultado = { total: unicos.length, feitos: 0, usarPerfil: 0, mesmaPessoa: 0, importadas: 0, falhas: [] as { id: string; erro: string }[] };
  for (const id of unicos) {
    let efetiva: Exclude<AcaoRevisaoLote, "mais-completo"> = acao === "mais-completo" ? "descartar" : acao;
    if (acao === "mais-completo") {
      const { data: item } = await db.from("integracao_importacao_itens").select("resultado,dados,correspondencias").eq("id", id).maybeSingle();
      const it = objectValue(item);
      const minha = Number(objectValue(it.dados).completude);
      const venda = arrayValue(it.correspondencias).map(objectValue).find((c) => c.tipo === "venda");
      if (it.resultado === "duplicada" && venda && Number.isFinite(minha) && minha > Number(venda.completude ?? Infinity)) efetiva = "usar-perfil";
    }
    const r = efetiva === "importar" ? await importarMesmoAssim(db, id, ator)
      : efetiva === "usar-perfil" ? await usarPerfilDaDuplicata(db, id, ator)
      : await descartarRevisao(db, id, ator);
    if (r.ok) {
      resultado.feitos++;
      if (efetiva === "usar-perfil") resultado.usarPerfil++; else if (efetiva === "importar") resultado.importadas++; else resultado.mesmaPessoa++;
    } else resultado.falhas.push({ id, erro: r.erro });
  }
  return resultado;
}
