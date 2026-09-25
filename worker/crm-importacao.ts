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
  arrayValue, listarSeguro, listarTudo, mapById, normalizarDealRd, numberValue, objectValue, rdGet,
  registrarEvento, snapshotUpdatePreservandoLocal, stringValue, type RdDealSnapshot,
} from "./rd-station-readonly";
import { createServiceSupabaseClient, type Env } from "./supabase";

type Json = Record<string, any>;
type Db = ReturnType<typeof createServiceSupabaseClient>;

export type Origem = "manual" | "agendada" | "webhook";
export type Resultado = "criada" | "atualizada" | "duplicada" | "cliente_existente" | "ignorada" | "erro";
export type Correspondencia = { tipo: "cliente" | "venda"; id: string; nome: string | null; por: ("cpf" | "telefone" | "email")[] };

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

function funisConfigurados(config: ConfigCrm): ConfigCrmFunil[] {
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

/** Webhook e reprocessamentos passam pelo mesmo filtro da importação. */
export function passaNoFiltro(s: RdDealSnapshot, config: ConfigCrm): string | null {
  const funis = funisConfigurados(config);
  if (funis.length) {
    const funil = funilParaSnapshot(s, config);
    if (!funil) return "Fora dos funis configurados.";
    if (funil.etapas.length && (!s.rdStageId || !funil.etapas.includes(s.rdStageId))) return "Fora das etapas configuradas para este funil.";
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
    else if (fonte.startsWith("deal:")) bruto = valorPersonalizado(deal, fonte.slice(5));
    else if (fonte.startsWith("contact:")) bruto = valorPersonalizado(contato, fonte.slice(8));
    else bruto = auto[campo];
    (out as Record<string, unknown>)[campo] = converter(campo, bruto);
  }
  if (out.valor_contrato === null) out.valor_contrato = 0;
  return out;
}

// ------------------------------------------------------------------ deduplicação

export function chaveTelefone(bruto: unknown): string | null {
  let d = stringValue(bruto).replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return d;
  // Celular no formato antigo (8 dígitos começando com 6–9) ganha o 9; fixo (2–5) fica como está.
  if (d.length === 10) return /^[6-9]$/.test(d[2]) ? `${d.slice(0, 2)}9${d.slice(2)}` : d;
  return null;
}
export const chaveCpf = (v: unknown) => { const d = stringValue(v).replace(/\D/g, ""); return d.length === 11 ? d : null; };
export const chaveEmail = (v: unknown) => { const e = stringValue(v).trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null; };

type Registro = { tipo: "cliente" | "venda"; id: string; nome: string | null; rdId?: string | null };
export type IndiceDedupe = {
  porCpf: Map<string, Registro[]>; porTelefone: Map<string, Registro[]>; porEmail: Map<string, Registro[]>;
  vendaPorRd: Map<string, { id: string; status: string }>;
};

function adicionar(mapa: Map<string, Registro[]>, chave: string | null, r: Registro) {
  if (!chave) return;
  const lista = mapa.get(chave) ?? [];
  if (!lista.some((x) => x.tipo === r.tipo && x.id === r.id)) lista.push(r);
  mapa.set(chave, lista);
}

export function indiceVazio(): IndiceDedupe {
  return { porCpf: new Map(), porTelefone: new Map(), porEmail: new Map(), vendaPorRd: new Map() };
}

export function indexar(indice: IndiceDedupe, r: Registro, dados: { cpf?: unknown; telefone?: unknown; email?: unknown }) {
  adicionar(indice.porCpf, chaveCpf(dados.cpf), r);
  adicionar(indice.porTelefone, chaveTelefone(dados.telefone), r);
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

export async function carregarIndice(db: Db): Promise<IndiceDedupe> {
  const indice = indiceVazio();
  const [clientes, vendas] = await Promise.all([
    todasAsLinhas<Json>((de, ate) => db.from("clientes").select("id,nome_completo,cpf,telefone,email,arquivado_em").order("id").range(de, ate)),
    todasAsLinhas<Json>((de, ate) => db.from("novas_vendas").select("id,rd_station_id,cliente_id,nome_completo,cpf,telefone,email,status").order("id").range(de, ate)),
  ]);
  for (const c of clientes) {
    if (c.arquivado_em) continue; // arquivada libera o CPF (migration_077)
    indexar(indice, { tipo: "cliente", id: c.id, nome: c.nome_completo ?? null }, c);
  }
  for (const v of vendas) {
    if (v.rd_station_id) indice.vendaPorRd.set(String(v.rd_station_id), { id: v.id, status: v.status });
    if (!v.cliente_id) indexar(indice, { tipo: "venda", id: v.id, nome: v.nome_completo ?? null, rdId: v.rd_station_id ?? null }, v);
  }
  return indice;
}

export function procurarDuplicidade(indice: IndiceDedupe, valores: ValoresVenda, config: ConfigCrm, rdId: string): Correspondencia[] {
  const achados = new Map<string, Correspondencia>();
  const marcar = (lista: Registro[] | undefined, por: "cpf" | "telefone" | "email") => {
    for (const r of lista ?? []) {
      if (r.tipo === "venda" && r.rdId === rdId) continue;
      const k = `${r.tipo}:${r.id}`;
      const atual = achados.get(k) ?? { tipo: r.tipo, id: r.id, nome: r.nome, por: [] };
      if (!atual.por.includes(por)) atual.por.push(por);
      achados.set(k, atual);
    }
  };
  if (config.deduplicarPor.cpf) marcar(indice.porCpf.get(chaveCpf(valores.cpf) ?? ""), "cpf");
  if (config.deduplicarPor.telefone) marcar(indice.porTelefone.get(chaveTelefone(valores.telefone) ?? ""), "telefone");
  if (config.deduplicarPor.email) marcar(indice.porEmail.get(chaveEmail(valores.email) ?? ""), "email");
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

export async function processarNegociacao(db: Db, entrada: {
  deal: Json; snapshot: RdDealSnapshot; contato?: Json; config: ConfigCrm; indice: IndiceDedupe; importacaoId: string | null;
}): Promise<ItemImportacao> {
  const { deal, snapshot: s, contato, config, indice, importacaoId } = entrada;
  const valores = aplicarMapeamento(s, deal, contato, config);
  const dados = { ...valores, rdStatus: s.rdStatus, rdPipelineId: s.rdPipelineId, rdStageId: s.rdStageId, dataVenda: s.dataVenda };
  const base = { external_id: s.rdStationId, correspondencias: [] as Correspondencia[], nova_venda_id: null as string | null, dados };

  const existente = indice.vendaPorRd.get(s.rdStationId);
  if (existente) {
    // Mesma negociação: só o snapshot rd_* muda; a cópia local e o status ficam.
    const { error } = await db.from("novas_vendas").update(snapshotUpdatePreservandoLocal(s)).eq("id", existente.id);
    if (error) return { ...base, resultado: "erro", motivo: "Falha ao atualizar o snapshot do RD." };
    return { ...base, resultado: "atualizada", motivo: "Só o snapshot do RD foi atualizado; dados locais preservados.", nova_venda_id: existente.id };
  }

  const fora = passaNoFiltro(s, config);
  if (fora) return { ...base, resultado: "ignorada", motivo: fora };
  if (!valores.nome || valores.nome === "Cliente RD Station") return { ...base, resultado: "ignorada", motivo: "Negociação sem nome de contato." };

  const correspondencias = procurarDuplicidade(indice, valores, config, s.rdStationId);
  if (correspondencias.length) {
    const cliente = correspondencias.some((c) => c.tipo === "cliente");
    const chaves = [...new Set(correspondencias.flatMap((c) => c.por))].join(", ");
    return {
      ...base, correspondencias,
      resultado: cliente ? "cliente_existente" : "duplicada",
      motivo: cliente ? `Já existe cliente com o mesmo ${chaves}. Nada foi criado nem alterado.` : `Já existe venda aguardando cadastro com o mesmo ${chaves}. Nada foi criado nem alterado.`,
    };
  }

  const { data, error } = await db.from("novas_vendas").insert(linhaNovaVenda(s, valores, importacaoId)).select("id").single();
  if (error || !data) {
    const duplicadoNoBanco = (error as { code?: string } | null)?.code === "23505";
    return { ...base, resultado: duplicadoNoBanco ? "atualizada" : "erro", motivo: duplicadoNoBanco ? "Negociação já registrada por outra execução." : "Falha ao gravar a venda." };
  }
  const id = String((data as Json).id);
  indice.vendaPorRd.set(s.rdStationId, { id, status: "aguardando_cadastro" });
  indexar(indice, { tipo: "venda", id, nome: valores.nome, rdId: s.rdStationId }, valores);
  return { ...base, resultado: "criada", motivo: "Entrou em Aguardando cadastro.", nova_venda_id: id };
}

// ------------------------------------------------------------------ importação completa

type Fontes = {
  deals: (filtro: string) => Promise<Json[]>;
  refs: () => Promise<{ contatos: Json[]; usuarios: Json[]; campanhas: Json[]; fontes: Json[] }>;
};

function fontesRd(env: Env): Fontes {
  return {
    deals: (filtro) => listarTudo(env, "deals", filtro || undefined),
    refs: async () => {
      const [contatos, usuarios, campanhas, fontes] = await Promise.all([
        listarSeguro(env, "contacts"), listarSeguro(env, "users"), listarSeguro(env, "campaigns"), listarSeguro(env, "sources"),
      ]);
      return { contatos, usuarios, campanhas, fontes };
    },
  };
}

function totais(itens: ItemImportacao[], totalRd: number) {
  const conta = (r: Resultado) => itens.filter((i) => i.resultado === r).length;
  return { totalRd, criadas: conta("criada"), atualizadas: conta("atualizada"), duplicadas: conta("duplicada"), clienteExistente: conta("cliente_existente"), ignoradas: conta("ignorada"), erros: conta("erro") };
}

async function gravarItens(db: Db, importacaoId: string, itens: ItemImportacao[]) {
  for (let i = 0; i < itens.length; i += 200) {
    await db.from("integracao_importacao_itens").insert(itens.slice(i, i + 200).map((item) => ({ ...item, importacao_id: importacaoId })));
  }
}

export async function importarCrm(env: Env, opcoes: { origem: Exclude<Origem, "webhook">; ator: string }, deps: { db?: Db; fontes?: Fontes; config?: ConfigCrm } = {}) {
  const db = deps.db ?? createServiceSupabaseClient(env);
  const { data: trava } = await db.rpc("integracao_tentar_trava", { p_nome: "crm_importacao", p_segundos: 600 });
  if (trava === false) return { ok: false as const, ocupado: true, erro: "Já existe uma importação em andamento." };
  const config = deps.config ?? await configDaFuncao<ConfigCrm>(env, "rd_station", "importacao", { db });
  const filtros = filtrosRdql(config);
  const filtro = filtros.join(" || ");
  const { data: imp, error: erroImp } = await db.from("integracao_importacoes")
    .insert({ provedor: "rd_station", origem: opcoes.origem, filtro, iniciado_por: opcoes.ator }).select("id").single();
  if (erroImp || !imp) {
    await db.rpc("integracao_liberar_trava", { p_nome: "crm_importacao" });
    return { ok: false as const, erro: "A estrutura de importação ainda não foi aplicada (migration_091)." };
  }
  const importacaoId = String((imp as Json).id);
  const fontes = deps.fontes ?? fontesRd(env);
  try {
    // As três leituras são independentes. Fazê-las em paralelo reduz bastante o
    // tempo total de importação e evita desperdiçar a janela de execução da Edge.
    const [gruposDeals, r, indice] = await Promise.all([
      Promise.all(filtros.map((f) => fontes.deals(f))),
      fontes.refs(),
      carregarIndice(db),
    ]);
    // Um negócio pertence a um funil, mas removemos repetidos por segurança caso o provedor
    // devolva a mesma negociação em filtros sobrepostos.
    const porId = new Map<string, Json>();
    let anonimo = 0;
    for (const deal of gruposDeals.flat()) {
      const id = stringValue(deal.id) || `__sem_id_${anonimo++}`;
      if (!porId.has(id)) porId.set(id, deal);
    }
    const deals = [...porId.values()];
    const refs = { contatos: mapById(r.contatos), usuarios: mapById(r.usuarios), campanhas: mapById(r.campanhas), fontes: mapById(r.fontes) };
    const itens: ItemImportacao[] = [];
    for (const deal of deals) {
      const snapshot = normalizarDealRd(deal, refs);
      if (!snapshot) continue;
      const contato = snapshot.rdContactId ? refs.contatos.get(snapshot.rdContactId) : undefined;
      try {
        itens.push(await processarNegociacao(db, { deal, snapshot, contato, config, indice, importacaoId }));
      } catch {
        itens.push({ external_id: snapshot.rdStationId, resultado: "erro", motivo: "Falha inesperada ao processar.", correspondencias: [], nova_venda_id: null, dados: {} });
      }
    }
    // Item "atualizada" sem mudança é ruído no histórico; guarda só o que importa.
    await gravarItens(db, importacaoId, itens.filter((i) => i.resultado !== "atualizada"));
    const resumo = { ...totais(itens, deals.length), somenteLeitura: true };
    const status = resumo.erros ? "parcial" : "concluida";
    await db.from("integracao_importacoes").update({ status, totais: resumo, concluido_em: new Date().toISOString() }).eq("id", importacaoId);
    await registrarEvento(db, { eventType: `importacao_${opcoes.origem}`, referencia: importacaoId, payload: resumo, status: resumo.erros ? "parcial" : "processado" });
    await db.from("logs_alteracoes").insert({ usuario: opcoes.ator, acao: "importou_crm_rd_station", entidade: "integracoes", entidade_id: "rd_station", detalhes: { importacaoId, origem: opcoes.origem, filtro, ...resumo } });
    return { ok: true as const, importacaoId, filtro, ...resumo };
  } catch (error) {
    const mensagem = error instanceof Error && /^RD_/.test(error.message) ? error.message : "Falha ao ler o RD Station.";
    await db.from("integracao_importacoes").update({ status: "erro", erro: mensagem, concluido_em: new Date().toISOString() }).eq("id", importacaoId);
    await registrarEvento(db, { eventType: `importacao_${opcoes.origem}`, referencia: importacaoId, status: "erro", erro: mensagem, payload: {} });
    return { ok: false as const, importacaoId, erro: mensagem };
  } finally {
    await db.rpc("integracao_liberar_trava", { p_nome: "crm_importacao" });
  }
}

/** Uma negociação do webhook: mesmo filtro, mesmo mapeamento, mesma deduplicação. */
export async function importarDoWebhook(env: Env, db: Db, deal: Json, transacao: string | null) {
  const snapshot = normalizarDealRd(deal);
  if (!snapshot) return null;
  const config = await configDaFuncao<ConfigCrm>(env, "rd_station", "importacao", { db });
  const { data: imp } = await db.from("integracao_importacoes")
    .insert({ provedor: "rd_station", origem: "webhook", filtro: filtroRdql(config), iniciado_por: "sistema:rd_station_webhook" }).select("id").single();
  const importacaoId = imp ? String((imp as Json).id) : null;
  const indice = await carregarIndice(db);
  const item = await processarNegociacao(db, { deal, snapshot, config, indice, importacaoId });
  if (importacaoId) {
    if (item.resultado !== "atualizada") await gravarItens(db, importacaoId, [item]);
    await db.from("integracao_importacoes").update({ status: item.resultado === "erro" ? "parcial" : "concluida", totais: { ...totais([item], 1), transacao }, concluido_em: new Date().toISOString() }).eq("id", importacaoId);
  }
  return { snapshot, item };
}

/** Chamado pelo agendador a cada 15 min: roda só se ligado e se a frequência venceu. */
export async function importacaoAgendadaSeDevida(env: Env, deps: { db?: Db; agora?: Date; fontes?: Fontes } = {}) {
  const db = deps.db ?? createServiceSupabaseClient(env);
  const config = await configDaFuncao<ConfigCrm>(env, "rd_station", "importacao", { db });
  if (!config.ativo) return { executada: false, motivo: "desligada" };
  const { data: ultima } = await db.from("integracao_importacoes").select("iniciado_em")
    .eq("provedor", "rd_station").eq("origem", "agendada").order("iniciado_em", { ascending: false }).limit(1).maybeSingle();
  const agora = (deps.agora ?? new Date()).getTime();
  const desde = ultima ? agora - new Date(String((ultima as Json).iniciado_em)).getTime() : Infinity;
  // 1 min de folga: o agendador não bate exatamente no mesmo segundo.
  if (desde < (config.frequenciaMinutos - 1) * 60_000) return { executada: false, motivo: "ainda_nao_venceu" };
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
    },
  };
}

export async function listarImportacoes(db: Db, limite = 30) {
  const { data, error } = await db.from("integracao_importacoes")
    .select("id,origem,status,filtro,totais,erro,iniciado_por,iniciado_em,concluido_em")
    .eq("provedor", "rd_station").order("iniciado_em", { ascending: false }).limit(Math.min(100, Math.max(1, limite)));
  if (error) return { disponivel: false, importacoes: [] };
  const { count } = await db.from("integracao_importacao_itens").select("id", { count: "exact", head: true })
    .in("resultado", ["duplicada", "cliente_existente"]).is("revisado_em", null);
  return { disponivel: true, importacoes: data ?? [], aguardandoRevisao: count ?? null };
}

export async function itensDaImportacao(db: Db, importacaoId: string | null, apenasRevisao = false) {
  let q = db.from("integracao_importacao_itens").select("*").order("created_at", { ascending: false }).limit(500);
  if (importacaoId) q = q.eq("importacao_id", importacaoId);
  if (apenasRevisao) q = q.in("resultado", ["duplicada", "cliente_existente"]).is("revisado_em", null);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []).map(itemParaTela);
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
  await db.from("logs_alteracoes").insert({ usuario: ator, acao: "importou_venda_duplicada_apos_revisao", entidade: "novas_vendas", entidade_id: (venda as Json).id, detalhes: { itemId, rdStationId: it.external_id, correspondencias: it.correspondencias, escritaNoRd: false } });
  return { ok: true as const, novaVendaId: String((venda as Json).id) };
}

export async function descartarRevisao(db: Db, itemId: string, ator: string) {
  const { data, error } = await db.from("integracao_importacao_itens").update({ revisado_por: ator, revisado_em: new Date().toISOString() })
    .eq("id", itemId).in("resultado", ["duplicada", "cliente_existente"]).is("revisado_em", null).select("id").maybeSingle();
  if (error || !data) return { ok: false as const, status: 409, erro: "Este item não está aguardando revisão." };
  await db.from("logs_alteracoes").insert({ usuario: ator, acao: "confirmou_duplicidade_crm", entidade: "integracoes", entidade_id: itemId, detalhes: { escritaNoRd: false } });
  return { ok: true as const };
}

/** Funis, etapas e campos personalizados lidos do RD (GET) para montar a configuração. */
export async function opcoesCrm(env: Env) {
  const funis = await listarTudo(env, "pipelines");
  const comEtapas = await Promise.all(funis.map(async (f) => {
    const id = stringValue(f.id);
    let etapas: Json[] = [];
    try { etapas = arrayValue((await rdGet(env, `/pipelines/${encodeURIComponent(id)}/stages?page[number]=1&page[size]=100`)).data).map(objectValue); } catch { etapas = []; }
    return { id, nome: stringValue(f.name) || id, etapas: etapas.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0)).map((e) => ({ id: stringValue(e.id), nome: stringValue(e.name) || stringValue(e.id) })) };
  }));
  const campos = (await listarSeguro(env, "custom_fields"))
    .filter((c) => ["deal", "contact"].includes(stringValue(c.entity)))
    .map((c) => ({ slug: stringValue(c.slug), nome: stringValue(c.name) || stringValue(c.slug), entidade: stringValue(c.entity) as "deal" | "contact", tipo: stringValue(c.type) }))
    .filter((c) => /^[a-z0-9_]{1,60}$/.test(c.slug));
  return { funis: comEtapas, campos };
}
