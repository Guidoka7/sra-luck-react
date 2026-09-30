/**
 * Conta Azul — a parcela como UM compromisso com dois IDs.
 *
 * Três níveis, sempre por IDs externos persistidos (nunca só por nome ou posição):
 *   Pessoa:     cliente ↔ pessoa da Conta Azul (cliente_vinculos_externos), a partir do CPF,
 *               com confirmação humana;
 *   Financeiro: as parcelas da cliente ↔ os lançamentos da pessoa (conciliação);
 *   Parcela:    boleto ↔ parcela da Conta Azul (conta_azul_vinculos).
 *
 * Endpoints oficiais usados (developers.contaazul.com, conferidos em 30/09/2026):
 *   GET  /v1/pessoas?documentos=CPF              busca da pessoa
 *   GET  /v1/pessoas/{id}                         confirmação do documento antes do vínculo
 *   GET  /v1/pessoas/conta-conectada              empresa conectada (id_empresa)
 *   GET  /v1/financeiro/eventos-financeiros/contas-a-receber/buscar?ids_clientes=…  lançamentos
 *   GET  /v1/financeiro/eventos-financeiros/parcelas/{id}                          parcela, baixas
 *   DELETE /oauth/connections/{id_empresa}        revogar o acesso (desconectar)
 *
 * O que a API não permite (documentado, sem contorno inventado): webhooks, anexar arquivo a um
 * lançamento (a parcela só LISTA anexos), ID externo, cancelar/excluir evento.
 *
 * Regras: nada é sobrescrito em silêncio; divergências viram escolha explícita ou conflito;
 * mutações só pela sessão humana do Admin; a Conta Azul fora do ar não afeta o Financeiro.
 */
import { PERMISSOES_ADMIN } from "./admin-auth";
import {
  abrirConflito, agoraIso, aberta, caRequest, caRequestComCabecalhos, centavos, composicaoDasBaixas, conexaoCa, credenciaisDeConfiguracao, depsPadrao, dia,
  contaAzulBloqueadaNoAmbiente, ErroContaAzul, exigir, gravarTokens, MENSAGEM_PREVIEW_BLOQUEADO, horaSaoPaulo, json, lerParcela, marcadorDe, pedirToken, quitada, registrarEvento, renovarToken, sameOrigin, sraAtual,
  type CaParcela, type Deps,
} from "./conta-azul";
import { validarState } from "./rd-station-readonly";
import { isDevConsoleSyntheticAdminId } from "./dev-console-auth";
import type { Env } from "./supabase";

type Json = Record<string, any>;
const PROVEDOR = "conta_azul";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const mascararDoc = (doc: string) => (doc.length === 11 ? `***.${doc.slice(3, 6)}.${doc.slice(6, 9)}-**` : doc.length === 14 ? `**.${doc.slice(2, 5)}.${doc.slice(5, 8)}/****-**` : doc ? "***" : "");
const itensDe = (r: unknown): Json[] => (Array.isArray(r) ? r : Array.isArray((r as Json)?.itens) ? (r as Json).itens : Array.isArray((r as Json)?.items) ? (r as Json).items : []);

// ------------------------------------------------------------------ pessoa

export type PessoaCa = { id: string; nome: string; documento: string; email: string | null; tipo: string | null; perfis: string[]; vinculadaA: { clienteId: string; nome: string | null } | null };

function pessoaDe(p: Json): Omit<PessoaCa, "vinculadaA"> {
  return {
    id: String(p.id), nome: String(p.nome || p.razao_social || "Sem nome"), documento: soDigitos(p.documento),
    email: p.email ? String(p.email) : null, tipo: p.tipo_pessoa ? String(p.tipo_pessoa) : null,
    perfis: (Array.isArray(p.perfis) ? p.perfis : []).map((x: any) => String(x?.tipo_perfil ?? x?.nome ?? x)),
  };
}

async function clienteComCpf(d: Deps, clienteId: string) {
  const { data } = await d.db.from("clientes").select("id,nome_completo,cpf").eq("id", clienteId).maybeSingle();
  if (!data) return null;
  return { id: String((data as Json).id), nome: String((data as Json).nome_completo || ""), cpf: soDigitos((data as Json).cpf) };
}

export async function vinculoPessoa(d: Deps, clienteId: string) {
  const { data } = await d.db.from("cliente_vinculos_externos").select("id,id_externo,documento,nome_externo,confirmado_por,confirmado_em,snapshot")
    .eq("provedor", PROVEDOR).eq("cliente_id", clienteId).eq("estado", "vinculado").maybeSingle();
  return (data as Json | null) ?? null;
}

/** Busca pelo CPF (documento exato). Só leitura: nada é gravado. */
export async function buscarPessoasPorCpf(d: Deps, clienteId: string) {
  const cliente = await clienteComCpf(d, clienteId);
  if (!cliente) return { ok: false as const, status: 404, erro: "Cliente não encontrada." };
  if (cliente.cpf.length !== 11) return { ok: false as const, status: 409, erro: "Informe um CPF válido na cliente antes de buscar na Conta Azul." };
  const r = await caRequest(d, "GET", `/v1/pessoas?${new URLSearchParams({ pagina: "1", tamanho_pagina: "10", documentos: cliente.cpf })}`);
  // A API pode trazer resultados aproximados: só documento idêntico é candidato.
  const candidatos = itensDe(r).map(pessoaDe).filter((p) => p.documento === cliente.cpf);
  const { data: usados } = candidatos.length
    ? await d.db.from("cliente_vinculos_externos").select("cliente_id,id_externo,clientes(nome_completo)").eq("provedor", PROVEDOR).eq("estado", "vinculado").in("id_externo", candidatos.map((c) => c.id))
    : { data: [] as Json[] };
  const porPessoa = new Map(((usados ?? []) as Json[]).map((u) => [String(u.id_externo), u]));
  const pessoas: PessoaCa[] = candidatos.map((c) => {
    const u = porPessoa.get(c.id);
    const nomeCli = u ? (Array.isArray(u.clientes) ? u.clientes[0] : u.clientes)?.nome_completo ?? null : null;
    return { ...c, vinculadaA: u ? { clienteId: String(u.cliente_id), nome: nomeCli } : null };
  });
  return {
    ok: true as const, cpf: cliente.cpf, pessoas,
    situacao: pessoas.length === 0 ? "nao_encontrada" : pessoas.length === 1 ? "encontrada" : "mais_de_uma",
  };
}

/** Vínculo confirmado pela equipe. Relê a pessoa pelo id e exige o MESMO CPF da cliente. */
export async function vincularPessoa(env: Env, clienteId: string, caPessoaId: string, ator: string, parcial: Partial<Deps> = {}) {
  const d = depsPadrao(env, parcial);
  if (!caPessoaId || caPessoaId.length > 64 || !/^[\w-]+$/.test(caPessoaId)) return { ok: false as const, status: 400, erro: "Pessoa da Conta Azul inválida." };
  const cliente = await clienteComCpf(d, clienteId);
  if (!cliente) return { ok: false as const, status: 404, erro: "Cliente não encontrada." };
  if (cliente.cpf.length !== 11) return { ok: false as const, status: 409, erro: "Cliente sem CPF válido." };
  const atual = await vinculoPessoa(d, clienteId);
  if (atual?.id_externo === caPessoaId) return { ok: true as const, jaVinculada: true, pessoa: atual };
  if (atual) return { ok: false as const, status: 409, erro: "A cliente já está vinculada a outra pessoa da Conta Azul. Desvincule antes." };
  let bruto: Json;
  try { bruto = await caRequest(d, "GET", `/v1/pessoas/${encodeURIComponent(caPessoaId)}`) as Json; }
  catch (e) { return { ok: false as const, status: (e as ErroContaAzul).status === 404 ? 404 : 502, erro: (e as Error).message }; }
  const pessoa = pessoaDe(bruto);
  if (pessoa.documento !== cliente.cpf) return { ok: false as const, status: 409, erro: "O CPF da pessoa na Conta Azul não é o CPF da cliente. Nada foi vinculado." };
  const { error } = await d.db.from("cliente_vinculos_externos").insert({
    provedor: PROVEDOR, cliente_id: clienteId, id_externo: pessoa.id, documento: cliente.cpf, nome_externo: pessoa.nome,
    snapshot: { nome: pessoa.nome, email: pessoa.email, tipo: pessoa.tipo, perfis: pessoa.perfis }, confirmado_por: ator, confirmado_em: agoraIso(d),
  });
  if (error) {
    const dup = (error as { code?: string }).code === "23505";
    return { ok: false as const, status: 409, erro: dup ? "Essa pessoa da Conta Azul já está vinculada a outra cliente." : "Não foi possível gravar o vínculo (confira a migration_124)." };
  }
  await d.db.from("logs_alteracoes").insert({ usuario: ator, acao: "vinculou_pessoa_conta_azul", entidade: "clientes", entidade_id: clienteId, detalhes: { caPessoaId: pessoa.id, nome: pessoa.nome } });
  return { ok: true as const, jaVinculada: false, pessoa: { id_externo: pessoa.id, nome_externo: pessoa.nome, documento: cliente.cpf } };
}

export async function desvincularPessoa(env: Env, clienteId: string, motivo: string | null, ator: string, parcial: Partial<Deps> = {}) {
  const d = depsPadrao(env, parcial);
  const atual = await vinculoPessoa(d, clienteId);
  if (!atual) return { ok: false as const, status: 404, erro: "A cliente não tem vínculo com a Conta Azul." };
  const { count } = await d.db.from("conta_azul_vinculos").select("id", { count: "exact", head: true }).eq("cliente_id", clienteId).neq("estado", "desvinculado");
  if (count) return { ok: false as const, status: 409, erro: `Há ${count} parcela(s) vinculada(s). Desvincule as parcelas antes da pessoa.` };
  await d.db.from("cliente_vinculos_externos").update({ estado: "desvinculado", desvinculado_por: ator, desvinculado_em: agoraIso(d), motivo_desvinculo: motivo, updated_at: agoraIso(d) }).eq("id", atual.id);
  await d.db.from("logs_alteracoes").insert({ usuario: ator, acao: "desvinculou_pessoa_conta_azul", entidade: "clientes", entidade_id: clienteId, detalhes: { caPessoaId: atual.id_externo, motivo } });
  return { ok: true as const };
}

// ------------------------------------------------------------------ lançamentos da pessoa

export type Lancamento = { id: string; eventoId: string | null; descricao: string; vencimento: string | null; valor: number; pago: number; naoPago: number; status: string; quitado: boolean };

/** Status da busca de receitas (EM_ABERTO, RECEBIDO, ATRASADO…) e da parcela (PENDENTE, QUITADO…). */
const QUITADOS = new Set(["RECEBIDO", "QUITADO"]);
export function lancamentoDe(i: Json): Lancamento {
  const status = String(i.status || "").toUpperCase();
  const valor = Number(i.total ?? i.valor ?? i.valor_composicao?.valor_bruto ?? 0);
  return {
    id: String(i.id), eventoId: i.evento?.id ? String(i.evento.id) : i.id_evento ? String(i.id_evento) : null,
    descricao: String(i.descricao || ""), vencimento: dia(i.data_vencimento), valor,
    pago: Number(i.pago ?? i.valor_pago ?? 0), naoPago: Number(i.nao_pago ?? 0), status, quitado: QUITADOS.has(status),
  };
}

/**
 * Receitas da pessoa (ids_clientes). A API exige o intervalo de vencimento; tenta um intervalo
 * amplo e, se recusado, lê ano a ano. Paginação de 100.
 */
export async function lancamentosDaPessoa(d: Deps, pessoaId: string, agora = d.agora()): Promise<Lancamento[]> {
  const ler = async (de: string, ate: string) => {
    const out: Json[] = [];
    for (let pagina = 1; pagina <= 20; pagina++) {
      const q = new URLSearchParams({ pagina: String(pagina), tamanho_pagina: "100", data_vencimento_de: de, data_vencimento_ate: ate, ids_clientes: pessoaId });
      const itens = itensDe(await caRequest(d, "GET", `/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?${q}`));
      out.push(...itens);
      if (itens.length < 100) break;
    }
    return out;
  };
  let brutos: Json[];
  try {
    brutos = await ler("2015-01-01", `${agora.getUTCFullYear() + 10}-12-31`);
  } catch (e) {
    if ((e as ErroContaAzul).status !== 400) throw e;
    brutos = [];
    for (let ano = agora.getUTCFullYear() - 8; ano <= agora.getUTCFullYear() + 8; ano++) brutos.push(...await ler(`${ano}-01-01`, `${ano}-12-31`));
  }
  const vistos = new Map<string, Lancamento>();
  for (const b of brutos) if (b?.id) vistos.set(String(b.id), lancamentoDe(b));
  return [...vistos.values()].sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
}

// ------------------------------------------------------------------ conciliação (sem gravar nada)

export type BoletoConc = { id: string; numero: number; total: number; valor: number; vencimento: string | null; status: string; dataPagamento: string | null };
type VinculoConc = { boleto_id: string; ca_parcela_id: string | null; estado: string; divergencias_aceitas?: unknown; origem_vinculo?: string | null };

const dias = (a: string | null, b: string | null) => (a && b ? Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000) : null);

export function diferencas(b: BoletoConc, l: Pick<Lancamento, "valor" | "vencimento" | "quitado">) {
  return {
    valor: centavos(b.valor) !== centavos(l.valor),
    vencimento: b.vencimento !== l.vencimento,
    diasVencimento: dias(l.vencimento, b.vencimento),
    status: (b.status === "pago") !== l.quitado,
  };
}

/** Ordem das sugestões: valor diferente pesa meio mês; cada 30 dias de distância pesa um. */
const proximidade = (d: ReturnType<typeof diferencas>) => (d.valor ? 0.5 : 0) + Math.abs(d.diasVencimento ?? 3650) / 30;

/**
 * Separa em: já vinculadas, correspondências (valor e vencimento idênticos, par único),
 * divergências (candidatas com mesmo valor e vencimento diferente, ou mesmo vencimento e valor
 * diferente), somente no Sra Luck e somente na Conta Azul. Nunca decide sozinho.
 */
export function conciliar(boletos: BoletoConc[], vinculos: VinculoConc[], lancamentos: Lancamento[]) {
  const ativos = vinculos.filter((v) => v.estado !== "desvinculado");
  const porBoleto = new Map(ativos.map((v) => [v.boleto_id, v]));
  const caUsados = new Set(ativos.map((v) => v.ca_parcela_id).filter(Boolean) as string[]);
  const porId = new Map(lancamentos.map((l) => [l.id, l]));

  const vinculadas = boletos.filter((b) => porBoleto.has(b.id)).map((b) => {
    const v = porBoleto.get(b.id)!;
    const l = v.ca_parcela_id ? porId.get(v.ca_parcela_id) ?? null : null;
    return { boleto: b, caParcelaId: v.ca_parcela_id, estado: v.estado, origem: v.origem_vinculo ?? null, lancamento: l, diferencas: l ? diferencas(b, l) : null, divergenciasAceitas: v.divergencias_aceitas ?? [] };
  });
  const livresSra = boletos.filter((b) => !porBoleto.has(b.id));
  const livresCa = lancamentos.filter((l) => !caUsados.has(l.id));

  const exatos = (b: BoletoConc) => livresCa.filter((l) => centavos(l.valor) === centavos(b.valor) && l.vencimento === b.vencimento);
  const correspondencias: { boleto: BoletoConc; lancamento: Lancamento; diferencas: ReturnType<typeof diferencas> }[] = [];
  const usados = new Set<string>();
  for (const b of livresSra) {
    const c = exatos(b);
    if (c.length !== 1) continue;
    const l = c[0];
    const disputa = livresSra.filter((x) => centavos(x.valor) === centavos(l.valor) && x.vencimento === l.vencimento);
    if (disputa.length !== 1 || usados.has(l.id)) continue;
    usados.add(l.id);
    correspondencias.push({ boleto: b, lancamento: l, diferencas: diferencas(b, l) });
  }
  const casados = new Set(correspondencias.map((c) => c.boleto.id));
  const divergencias: { boleto: BoletoConc; candidatos: { lancamento: Lancamento; diferencas: ReturnType<typeof diferencas> }[] }[] = [];
  const somenteSra: BoletoConc[] = [];
  for (const b of livresSra.filter((x) => !casados.has(x.id))) {
    const candidatos = livresCa.filter((l) => !usados.has(l.id) && (centavos(l.valor) === centavos(b.valor) || l.vencimento === b.vencimento))
      .map((l) => ({ lancamento: l, diferencas: diferencas(b, l) }))
      .sort((x, y) => proximidade(x.diferencas) - proximidade(y.diferencas))
      .slice(0, 5);
    if (candidatos.length) divergencias.push({ boleto: b, candidatos }); else somenteSra.push(b);
  }
  // Candidato de alguma divergência não é "só na Conta Azul": aparece lá, para escolha.
  const candidatos = new Set(divergencias.flatMap((d) => d.candidatos.map((c) => c.lancamento.id)));
  const somenteContaAzul = livresCa.filter((l) => !usados.has(l.id) && !candidatos.has(l.id));
  return {
    vinculadas, correspondencias, divergencias, somenteSra, somenteContaAzul,
    totais: { parcelasSra: boletos.length, lancamentosConta: lancamentos.length, vinculadas: vinculadas.length, correspondencias: correspondencias.length, divergencias: divergencias.length, somenteSra: somenteSra.length, somenteContaAzul: somenteContaAzul.length },
  };
}

async function boletosDaCliente(d: Deps, clienteId: string): Promise<BoletoConc[]> {
  const { data } = await d.db.from("boletos").select("id,numero_parcela,total_parcelas,valor,data_vencimento,status,data_pagamento").eq("cliente_id", clienteId).order("numero_parcela", { ascending: true });
  return ((data ?? []) as Json[]).map((b) => ({ id: String(b.id), numero: Number(b.numero_parcela), total: Number(b.total_parcelas), valor: Number(b.valor), vencimento: dia(b.data_vencimento), status: String(b.status), dataPagamento: dia(b.data_pagamento) }));
}

export async function conciliacaoDaCliente(d: Deps, clienteId: string) {
  const pessoa = await vinculoPessoa(d, clienteId);
  if (!pessoa) return { ok: false as const, status: 409, erro: "Vincule a cliente à pessoa da Conta Azul primeiro (pelo CPF)." };
  const [boletos, lancamentos, { data: vinculos }] = await Promise.all([
    boletosDaCliente(d, clienteId),
    lancamentosDaPessoa(d, String(pessoa.id_externo)),
    d.db.from("conta_azul_vinculos").select("boleto_id,ca_parcela_id,estado,divergencias_aceitas,origem_vinculo").eq("cliente_id", clienteId),
  ]);
  return { ok: true as const, pessoa, lancamentos, ...conciliar(boletos, (vinculos ?? []) as VinculoConc[], lancamentos) };
}

// ------------------------------------------------------------------ confirmar vínculos de parcelas

export type ParConfirmado = { boletoId: string; caParcelaId: string; aceitarDivergencias?: boolean };

/**
 * Grava os pares escolhidos pela equipe. A Conta Azul é relida parcela a parcela (o que vale é o
 * que está lá agora). Divergência de valor/vencimento só com aceite explícito, e fica registrada;
 * nenhum vencimento é alterado. Pago só de um lado vira conflito para revisão (nada é baixado ou
 * estornado automaticamente no vínculo).
 */
export async function confirmarVinculos(env: Env, clienteId: string, pares: ParConfirmado[], ator: string, parcial: Partial<Deps> = {}) {
  const d = depsPadrao(env, parcial);
  if (!Array.isArray(pares) || !pares.length || pares.length > 120) return { ok: false as const, status: 400, erro: "Informe de 1 a 120 vínculos." };
  const pessoa = await vinculoPessoa(d, clienteId);
  if (!pessoa) return { ok: false as const, status: 409, erro: "Vincule a cliente à pessoa da Conta Azul primeiro (pelo CPF)." };
  const lancamentos = await lancamentosDaPessoa(d, String(pessoa.id_externo));
  const daPessoa = new Set(lancamentos.map((l) => l.id));
  const vistos = { boleto: new Set<string>(), ca: new Set<string>() };
  const resultados: { boletoId: string; caParcelaId: string; ok: boolean; erro?: string; conflito?: string; divergencias?: string[] }[] = [];

  for (const par of pares) {
    const boletoId = String(par?.boletoId || ""), caParcelaId = String(par?.caParcelaId || "");
    const falha = (erro: string) => resultados.push({ boletoId, caParcelaId, ok: false, erro });
    if (!UUID.test(boletoId) || !caParcelaId || caParcelaId.length > 64) { falha("Par inválido."); continue; }
    if (vistos.boleto.has(boletoId) || vistos.ca.has(caParcelaId)) { falha("Parcela repetida na mesma confirmação."); continue; }
    vistos.boleto.add(boletoId); vistos.ca.add(caParcelaId);
    if (!daPessoa.has(caParcelaId)) { falha("Esse lançamento não pertence à pessoa vinculada na Conta Azul."); continue; }
    const { data: boleto } = await d.db.from("boletos").select("id,cliente_id,numero_parcela,valor,data_vencimento,status,data_pagamento").eq("id", boletoId).maybeSingle();
    if (!boleto || (boleto as Json).cliente_id !== clienteId) { falha("Parcela não é desta cliente."); continue; }
    const { data: existentes } = await d.db.from("conta_azul_vinculos").select("id,boleto_id,ca_parcela_id,estado").or(`boleto_id.eq.${boletoId},ca_parcela_id.eq.${caParcelaId}`);
    const lista = (existentes ?? []) as Json[];
    if (lista.some((v) => v.estado !== "desvinculado")) { falha("A parcela ou o lançamento já tem vínculo ativo."); continue; }
    let ca: CaParcela;
    try { ca = await lerParcela(d, caParcelaId); } catch (e) { falha((e as Error).message); continue; }
    const s = sraAtual(boleto as Json);
    const div: string[] = [];
    if (centavos(ca.valorBruto) !== centavos(s.valor)) div.push("valor");
    if (ca.vencimento !== s.vencimento) div.push("vencimento");
    if (div.length && !par.aceitarDivergencias) { resultados.push({ boletoId, caParcelaId, ok: false, erro: `Divergência de ${div.join(" e ")}: confirme para vincular mesmo assim.`, divergencias: div }); continue; }
    if (["CANCELADO", "PERDIDO", "RENEGOCIADO"].includes(ca.status)) { falha(`O lançamento está ${ca.status} na Conta Azul.`); continue; }

    const sraPago = s.status === "pago", caPago = quitada(ca);
    const comp = caPago ? composicaoDasBaixas(ca) : null;
    const linha = {
      boleto_id: boletoId, cliente_id: clienteId, marcador: marcadorDe(boletoId), estado: "vinculado",
      ca_contato_id: String(pessoa.id_externo), ca_evento_id: ca.eventoId, ca_parcela_id: caParcelaId, ca_versao: ca.versao,
      ca_snapshot: ca, sra_snapshot: s, ca_baixa_id: comp?.baixaId ?? null, baixa_origem: null, ultima_sincronizacao_em: agoraIso(d),
      origem_vinculo: "confirmado_manual", confirmado_por: ator, confirmado_em: agoraIso(d), ultimo_erro: null,
      divergencias_aceitas: div.map((campo) => ({ campo, sraLuck: campo === "valor" ? s.valor : s.vencimento, contaAzul: campo === "valor" ? ca.valorBruto : ca.vencimento, aceitoPor: ator, em: agoraIso(d) })),
      updated_at: agoraIso(d),
    };
    // Vínculo antigo desfeito: reaproveita a linha (boleto_id/ca_parcela_id são únicos).
    const antigoBoleto = lista.find((v) => v.boleto_id === boletoId);
    const antigoCa = lista.find((v) => v.ca_parcela_id === caParcelaId && v.boleto_id !== boletoId);
    if (antigoCa) await d.db.from("conta_azul_vinculos").update({ ca_parcela_id: null, updated_at: agoraIso(d) }).eq("id", antigoCa.id);
    const gravado = antigoBoleto
      ? await d.db.from("conta_azul_vinculos").update(linha).eq("id", antigoBoleto.id).select("id").single()
      : await d.db.from("conta_azul_vinculos").insert({ ...linha, criado_por: ator }).select("id").single();
    if (gravado.error || !gravado.data) { falha("Não foi possível gravar o vínculo."); continue; }
    const vinculoId = String((gravado.data as Json).id);
    let conflito: string | undefined;
    if (caPago && !sraPago) {
      conflito = "baixa_na_conta_azul";
      await abrirConflito(d.db, { referencia: boletoId, vinculoId, tipo: conflito, descricao: "Vínculo confirmado: a parcela está quitada na Conta Azul e em aberto no Sra Luck. Nada foi baixado sozinho; confira e aplique a baixa se estiver correta.", dadosSra: s, dadosExternos: ca });
    } else if (sraPago && !caPago) {
      conflito = "paga_so_no_sra";
      await abrirConflito(d.db, { referencia: boletoId, vinculoId, tipo: conflito, descricao: "Vínculo confirmado: a parcela está paga no Sra Luck e em aberto na Conta Azul. Nada foi enviado sozinho; use 'aplicar Sra Luck' para registrar a baixa lá.", dadosSra: s, dadosExternos: ca });
    }
    await d.db.from("logs_alteracoes").insert({ usuario: ator, acao: "vinculou_parcela_conta_azul_manual", entidade: "boletos", entidade_id: boletoId, detalhes: { caParcelaId, caEventoId: ca.eventoId, divergencias: div, conflito: conflito ?? null } });
    resultados.push({ boletoId, caParcelaId, ok: true, conflito, divergencias: div });
  }
  return { ok: true as const, resultados, vinculadas: resultados.filter((r) => r.ok).length, falhas: resultados.filter((r) => !r.ok).length };
}

// ------------------------------------------------------------------ financeiro que nasce da Conta Azul

async function emLotes<T, R>(itens: T[], n: number, f: (x: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < itens.length; i += n) out.push(...await Promise.all(itens.slice(i, i + n).map(f)));
  return out;
}

export type ParcelaImportada = {
  caParcelaId: string; caEventoId: string | null; caVersao: number | null; valor: number; vencimento: string; descricao: string; status: string;
  pago: boolean; dataPagamento: string | null; juros: number; multa: number; desconto: number; forma: string | null; caBaixaId: string | null;
  parcial: boolean; ca: CaParcela;
};

/** Prévia (só leitura). Cada parcela é relida na Conta Azul; só entra o que é seguro de importar. */
export async function previaImportacao(d: Deps, clienteId: string) {
  const pessoa = await vinculoPessoa(d, clienteId);
  if (!pessoa) return { ok: false as const, status: 409, erro: "Vincule a cliente à pessoa da Conta Azul primeiro (pelo CPF)." };
  const { count } = await d.db.from("boletos").select("id", { count: "exact", head: true }).eq("cliente_id", clienteId);
  if (count) return { ok: false as const, status: 409, erro: "A cliente já tem financeiro no Sra Luck. Use a conferência de vínculos." };
  const lancamentos = await lancamentosDaPessoa(d, String(pessoa.id_externo));
  const lidas = await emLotes(lancamentos, 4, async (l) => {
    try { return { l, ca: await lerParcela(d, l.id) as CaParcela, erro: null as string | null }; }
    catch (e) { return { l, ca: null, erro: (e as Error).message }; }
  });
  const parcelas: ParcelaImportada[] = [], naoImportadas: { caParcelaId: string; descricao: string; vencimento: string | null; valor: number; motivo: string }[] = [];
  for (const { l, ca, erro } of lidas) {
    const fora = (motivo: string) => naoImportadas.push({ caParcelaId: l.id, descricao: l.descricao, vencimento: l.vencimento, valor: l.valor, motivo });
    if (!ca) { fora(erro || "Não foi possível ler a parcela."); continue; }
    if (["CANCELADO", "PERDIDO", "RENEGOCIADO"].includes(ca.status)) { fora(`Parcela ${ca.status} na Conta Azul.`); continue; }
    if (!ca.vencimento || ca.valorBruto <= 0) { fora("Parcela sem vencimento ou valor."); continue; }
    const base = { caParcelaId: l.id, caEventoId: ca.eventoId, caVersao: ca.versao, valor: ca.valorBruto, vencimento: ca.vencimento, descricao: ca.descricao || l.descricao, status: ca.status, ca };
    if (quitada(ca)) {
      const comp = composicaoDasBaixas(ca);
      if (!comp.baixaId || !comp.dataPagamento) { fora("Quitada sem baixa identificada: confira na Conta Azul."); continue; }
      if (centavos(comp.principal) !== centavos(ca.valorBruto)) { fora("A soma das baixas não fecha o valor da parcela."); continue; }
      parcelas.push({ ...base, pago: true, dataPagamento: comp.dataPagamento, juros: comp.juros, multa: comp.multa, desconto: comp.desconto, forma: comp.forma, caBaixaId: comp.baixaId, parcial: false });
    } else if (aberta(ca) || ca.status === "RECEBIDO_PARCIAL") {
      parcelas.push({ ...base, pago: false, dataPagamento: null, juros: 0, multa: 0, desconto: 0, forma: null, caBaixaId: null, parcial: ca.status === "RECEBIDO_PARCIAL" });
    } else fora(`Status ${ca.status || "desconhecido"} não importável.`);
  }
  parcelas.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.caParcelaId.localeCompare(b.caParcelaId));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    ok: true as const, pessoa, parcelas, naoImportadas,
    totais: {
      parcelas: parcelas.length, pagas: parcelas.filter((p) => p.pago).length, abertas: parcelas.filter((p) => !p.pago).length,
      vencidas: parcelas.filter((p) => !p.pago && p.vencimento < agoraIso(d).slice(0, 10)).length,
      valorTotal: r2(parcelas.reduce((t, p) => t + p.valor, 0)), recebido: r2(parcelas.filter((p) => p.pago).reduce((t, p) => t + p.valor + p.juros + p.multa - p.desconto, 0)),
      parciais: parcelas.filter((p) => p.parcial).length,
    },
  };
}

/**
 * Importa o que a equipe marcou na prévia: recalcula no servidor e exige que cada lançamento
 * escolhido continue importável (se a Conta Azul mudou no meio, pede nova conferência). A
 * numeração segue o vencimento das escolhidas. Uma transação no banco.
 */
export async function importarFinanceiro(env: Env, clienteId: string, idsConfirmados: string[], ator: string, parcial: Partial<Deps> = {}) {
  const d = depsPadrao(env, parcial);
  const previa = await previaImportacao(d, clienteId);
  if (!previa.ok) return previa;
  // A equipe pode desmarcar lançamentos que não são parcelas do plano (ex.: uma taxa avulsa).
  // Cada ID escolhido precisa continuar importável na leitura feita agora no servidor.
  const escolhidos = new Set((idsConfirmados ?? []).map(String));
  const selecionadas = previa.parcelas.filter((p) => escolhidos.has(p.caParcelaId));
  if (!escolhidos.size) return { ok: false as const, status: 400, erro: "Escolha ao menos uma parcela para importar." };
  if (selecionadas.length !== escolhidos.size) return { ok: false as const, status: 409, erro: "Os lançamentos mudaram na Conta Azul desde a prévia. Revise de novo antes de importar." };
  const { data, error } = await d.db.rpc("conta_azul_importar_financeiro", {
    p_cliente_id: clienteId, p_ca_pessoa_id: String(previa.pessoa.id_externo), p_usuario: ator,
    p_parcelas: selecionadas.map((p) => ({ caParcelaId: p.caParcelaId, caEventoId: p.caEventoId, caVersao: p.caVersao, valor: p.valor, vencimento: p.vencimento, ca: p.ca, pago: p.pago, dataPagamento: p.dataPagamento, juros: p.juros, multa: p.multa, desconto: p.desconto, forma: p.forma, caBaixaId: p.caBaixaId })),
  });
  if (error) {
    const msg = String(error.message || "");
    return { ok: false as const, status: 409, erro: /ja possui financeiro/i.test(msg) ? "A cliente já tem financeiro no Sra Luck." : /vinculo confirmado/i.test(msg) ? "Vínculo com a pessoa da Conta Azul não confirmado." : "Não foi possível importar (nada foi gravado)." };
  }
  // Recebimento parcial na Conta Azul: o Sra Luck não tem baixa parcial → conferência humana.
  for (const p of selecionadas.filter((x) => x.parcial)) {
    const { data: v } = await d.db.from("conta_azul_vinculos").select("id,boleto_id").eq("ca_parcela_id", p.caParcelaId).maybeSingle();
    if (v) await abrirConflito(d.db, { referencia: String((v as Json).boleto_id), vinculoId: String((v as Json).id), tipo: "recebido_parcial", descricao: `Importada em aberto: recebimento parcial na Conta Azul (${p.ca.valorPago.toFixed(2)} de ${p.valor.toFixed(2)}).`, dadosExternos: p.ca });
  }
  return { ok: true as const, resultado: data, naoImportadas: previa.naoImportadas.length, deixadasDeFora: previa.parcelas.length - selecionadas.length };
}

// ------------------------------------------------------------------ central técnica (Dev Console)

export async function contaConectada(d: Deps) {
  const r = await caRequest(d, "GET", "/v1/pessoas/conta-conectada") as Json;
  const documento = soDigitos(r?.documento ?? r?.cnpj ?? r?.cpf);
  return {
    idEmpresa: r?.id_empresa ? String(r.id_empresa) : r?.id ? String(r.id) : null,
    nome: String(r?.razao_social || r?.nome || r?.nome_fantasia || "Empresa conectada"),
    documento: mascararDoc(documento),
  };
}

export async function testarConexaoCa(d: Deps, ator: string) {
  const inicio = Date.now();
  try {
    const empresa = await contaConectada(d);
    const { ambiente } = await conexaoCa(d);
    await registrarEvento(d, "conexao_testada", "processado", { empresa: empresa.nome, idEmpresa: empresa.idEmpresa, documento: empresa.documento, ambiente, latenciaMs: Date.now() - inicio, ator });
    return { ok: true as const, empresa, ambiente, latenciaMs: Date.now() - inicio };
  } catch (e) {
    const erro = e instanceof ErroContaAzul ? e : new ErroContaAzul("inesperado", "Falha inesperada.");
    await registrarEvento(d, "conexao_testada", "erro", { codigo: erro.codigo, status: erro.status, ator }, erro.message);
    return { ok: false as const, status: 502, erro: erro.message, codigo: erro.codigo };
  }
}

export async function renovarAgora(d: Deps, ator: string) {
  try {
    await renovarToken(d, ator);
    return { ok: true as const, expiraEm: await d.credenciais.obter("token_expires_at") };
  } catch (e) {
    return { ok: false as const, status: 502, erro: (e as Error).message, codigo: (e as ErroContaAzul).codigo ?? "renovacao" };
  }
}

/** Revoga na Conta Azul (DELETE /oauth/connections/{id_empresa}) e apaga os tokens do cofre. */
export async function desconectar(d: Deps, ator: string) {
  let revogada = false, motivo: string | null = null, empresa: Json | null = null;
  try {
    empresa = await contaConectada(d);
    if (!empresa.idEmpresa) throw new ErroContaAzul("sem_empresa", "A Conta Azul não informou o id da empresa conectada.");
    await caRequest(d, "DELETE", `/oauth/connections/${encodeURIComponent(empresa.idEmpresa)}`);
    revogada = true;
  } catch (e) {
    // 404 = não há conexão ativa (já revogada). Qualquer outro caso: os tokens locais saem mesmo assim.
    if ((e as ErroContaAzul).codigo === "nao_encontrado") revogada = true;
    else motivo = (e as Error).message;
  }
  await d.credenciais.remover?.(["access_token", "refresh_token", "token_expires_at"], ator);
  await registrarEvento(d, "desconectado", revogada ? "processado" : "erro", { revogadaNaContaAzul: revogada, empresa: empresa?.nome ?? null, ator }, motivo);
  await d.db.from("logs_alteracoes").insert({ usuario: ator, acao: "desconectou_conta_azul", entidade: "integracoes", entidade_id: PROVEDOR, detalhes: { revogadaNaContaAzul: revogada, motivo } });
  return { ok: true as const, revogadaNaContaAzul: revogada, motivo };
}

/**
 * OAuth do App de Desenvolvimento: a Conta Azul redireciona para o endereço cadastrado no app
 * (no App de Desenvolvimento, a Redirect URI do portal, ex.: https://contaazul.com), fora do Sra Luck. O Dev cola o
 * endereço de retorno; o state é validado contra quem gerou o link e o code (válido por 3 min)
 * é trocado aqui, no backend. O code nunca é gravado nem registrado em log.
 */
export async function concluirOAuthColado(env: Env, d: Deps, urlColada: string, adminId: string) {
  if (!env.CLIENTE_SESSION_SECRET) return { ok: false as const, status: 503, erro: "Segredo de sessão não configurado." };
  let u: URL;
  try { u = new URL(String(urlColada || "").trim()); } catch { return { ok: false as const, status: 400, erro: "Cole o endereço completo para onde a Conta Azul te levou." }; }
  const params = new URLSearchParams(u.search);
  // Algumas telas devolvem os parâmetros depois do # (SPA).
  if (!params.get("code") && u.hash.includes("?")) new URLSearchParams(u.hash.slice(u.hash.indexOf("?") + 1)).forEach((v, k) => params.set(k, v));
  const code = params.get("code") || "", state = params.get("state") || "";
  if (!code || !state) return { ok: false as const, status: 400, erro: "O endereço não tem code e state. Autorize de novo e cole o endereço logo em seguida." };
  const dono = await validarState(state, env.CLIENTE_SESSION_SECRET);
  if (!dono || dono !== adminId) return { ok: false as const, status: 400, erro: "Autorização expirada ou gerada por outra sessão. Clique em Conectar de novo." };
  const redirect = await d.credenciais.obter("redirect_uri");
  if (!redirect) return { ok: false as const, status: 409, erro: "Cadastre a Redirect URI do app (a mesma do Portal do Desenvolvedor)." };
  let esperado: URL;
  try { esperado = new URL(redirect); } catch { return { ok: false as const, status: 409, erro: "Redirect URI cadastrada é inválida." }; }
  // O site da Conta Azul pode levar https://contaazul.com para https://www.contaazul.com (mantendo
  // ?code&state): aceita o retorno com ou sem "www.", mas a troca usa a Redirect URI cadastrada, exata.
  const semWww = (h: string) => h.replace(/^www\./, "");
  const mesmoDestino = u.protocol === esperado.protocol && semWww(u.hostname) === semWww(esperado.hostname) && u.port === esperado.port
    && u.pathname.replace(/\/$/, "") === esperado.pathname.replace(/\/$/, "");
  if (!mesmoDestino) return { ok: false as const, status: 400, erro: "O endereço colado não é a Redirect URI cadastrada." };
  try {
    const t = await pedirToken(d, { grant_type: "authorization_code", code, redirect_uri: redirect });
    await gravarTokens(d, t, adminId);
    await registrarEvento(d, "oauth_conectado", "processado", { origem: "endereco_colado", ator: adminId, expiraEmSegundos: t.expiresIn });
    await d.db.from("logs_alteracoes").insert({ usuario: adminId, acao: "autorizou_oauth_conta_azul", entidade: "integracoes", entidade_id: PROVEDOR, detalhes: { origem: "dev_console_endereco_colado" } });
    return { ok: true as const, expiraEm: await d.credenciais.obter("token_expires_at") };
  } catch (e) {
    const erro = e instanceof ErroContaAzul ? e : new ErroContaAzul("oauth", "Falha ao trocar o código.");
    await registrarEvento(d, "oauth_falhou", "erro", { codigo: erro.codigo, status: erro.status, ator: adminId }, erro.message);
    return { ok: false as const, status: 502, erro: erro.message };
  }
}

// ------------------------------------------------------------------ diagnóstico real (Fase 1)

/** Campos cujo valor pode aparecer no diagnóstico (conta de teste; nada pessoal). */
const VALOR_VISIVEL = /^(status|versao|indice|data_[a-z_]+|valor[a-z_]*|total|pago|nao_pago|juros|multa|desconto|taxa|metodo_pagamento|tipo_pessoa|itens_totais|conciliado|baixa_agendada|tipo)$/;

/** Estrutura (chaves e tipos) de uma resposta real, com valores só de campos não pessoais. */
export function descreverFormato(v: unknown, chave = "", nivel = 0): unknown {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.length ? { lista: v.length, item: descreverFormato(v[0], chave, nivel + 1) } : { lista: 0 };
  if (typeof v === "object") {
    if (nivel > 3) return "objeto";
    return Object.fromEntries(Object.entries(v as Json).map(([k, x]) => [k, descreverFormato(x, k, nivel + 1)]));
  }
  if (VALOR_VISIVEL.test(chave) && (typeof v === "number" || typeof v === "boolean" || typeof v === "string")) return v;
  return typeof v;
}

export type EtapaDiagnostico = { etapa: string; ok: boolean; ms: number; status?: number; formato?: unknown; observacao?: string; erro?: string; cabecalhos?: Record<string, string> };

/**
 * Chamadas reais, só leitura, contra a conta conectada: registra a estrutura de cada resposta
 * para ajustar o adapter ao formato real (evidência da Fase 1). Não grava nada no financeiro.
 */
export async function diagnosticoApi(d: Deps, entrada: { cpf?: string | null; ator: string }) {
  const etapas: EtapaDiagnostico[] = [];
  const rodar = async (etapa: string, f: () => Promise<{ dados: any; status: number; cabecalhos: Record<string, string> }>, obs?: (dados: any) => string) => {
    const t0 = Date.now();
    try {
      const r = await f();
      etapas.push({ etapa, ok: true, ms: Date.now() - t0, status: r.status, formato: descreverFormato(r.dados), observacao: obs?.(r.dados), cabecalhos: r.cabecalhos });
      return r.dados;
    } catch (e) {
      const erro = e as ErroContaAzul;
      etapas.push({ etapa, ok: false, ms: Date.now() - t0, status: erro.status, erro: erro.message });
      return null;
    }
  };
  const get = (caminho: string) => () => caRequestComCabecalhos(d, "GET", caminho);
  await rodar("conta_conectada", get("/v1/pessoas/conta-conectada"), (x) => `id_empresa ${x?.id_empresa ? "presente" : "ausente"}`);
  const cpf = soDigitos(entrada.cpf);
  let pessoaId: string | null = null;
  if (cpf.length === 11) {
    const lista = await rodar("pessoas_por_cpf", get(`/v1/pessoas?${new URLSearchParams({ pagina: "1", tamanho_pagina: "10", documentos: cpf })}`), (x) => {
      const itens = itensDe(x);
      return `${itens.length} item(ns); ${itens.filter((p) => soDigitos(p.documento) === cpf).length} com documento idêntico; envelope: ${Array.isArray(x) ? "lista" : Object.keys(x ?? {}).join(",")}`;
    });
    pessoaId = itensDe(lista).find((p) => soDigitos(p.documento) === cpf)?.id ?? null;
    if (pessoaId) await rodar("pessoa_por_id", get(`/v1/pessoas/${encodeURIComponent(pessoaId)}`), (x) => `documento ${soDigitos(x?.documento) === cpf ? "confere" : "NÃO confere"}`);
  }
  const hoje = d.agora();
  let primeira: string | null = null;
  if (pessoaId) {
    const amplo = await rodar("receitas_da_pessoa_intervalo_amplo", get(`/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?${new URLSearchParams({ pagina: "1", tamanho_pagina: "100", data_vencimento_de: "2015-01-01", data_vencimento_ate: `${hoje.getUTCFullYear() + 10}-12-31`, ids_clientes: pessoaId })}`),
      (x) => { const it = itensDe(x); return `${it.length} item(ns) na página; itens_totais=${x?.itens_totais ?? "—"}; status vistos: ${[...new Set(it.map((i) => i.status))].join(",") || "—"}`; });
    const itens = itensDe(amplo);
    if (!amplo) await rodar("receitas_da_pessoa_um_ano", get(`/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?${new URLSearchParams({ pagina: "1", tamanho_pagina: "100", data_vencimento_de: `${hoje.getUTCFullYear()}-01-01`, data_vencimento_ate: `${hoje.getUTCFullYear()}-12-31`, ids_clientes: pessoaId })}`));
    primeira = itens.find((i) => String(i.status).toUpperCase() === "RECEBIDO")?.id ?? itens[0]?.id ?? null;
  }
  if (primeira) {
    await rodar("parcela_por_id", get(`/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(primeira)}`),
      (x) => `versao=${x?.versao ?? "ausente"}; baixas=${Array.isArray(x?.baixas) ? x.baixas.length : "—"}; anexos=${Array.isArray(x?.anexos) ? x.anexos.length : "—"}; evento.id ${x?.evento?.id ? "presente" : "ausente"}`);
  }
  const fim = hoje, ini = new Date(hoje.getTime() - 24 * 3600_000);
  await rodar("alteracoes_24h", get(`/v1/financeiro/eventos-financeiros/alteracoes?${new URLSearchParams({ pagina: "1", tamanho_pagina: "100", data_inicio: horaSaoPaulo(ini), data_fim: horaSaoPaulo(fim) })}`),
    (x) => `${itensDe(x).length} evento(s) alterado(s) em 24 h; itens_totais=${x?.itens_totais ?? "—"}`);
  const resumo = { ok: etapas.every((e) => e.ok), etapas, em: agoraIso(d) };
  await registrarEvento(d, "diagnostico_api", resumo.ok ? "processado" : "erro", { etapas: etapas.map((e) => ({ etapa: e.etapa, ok: e.ok, status: e.status ?? null, ms: e.ms, observacao: e.observacao ?? null, formato: e.formato ?? null, cabecalhos: e.cabecalhos ?? null })), ator: entrada.ator }, resumo.ok ? null : etapas.filter((e) => !e.ok).map((e) => `${e.etapa}: ${e.erro}`).join(" | "));
  return resumo;
}

const WEBHOOKS = {
  disponivel: false,
  motivo: "A API oficial da Conta Azul não oferece webhooks (developers.contaazul.com: “a API não suporta webhooks… será preciso implementar polling”).",
  contingencia: "Leitura incremental de /v1/financeiro/eventos-financeiros/alteracoes a cada 15 min, com cursor, idempotência por ID da baixa e conferência dos vínculos mais antigos (reconciliação).",
};

/** Saúde da integração para o Dev Console. Sem segredo: só presença, datas e estados. */
export async function statusCentral(env: Env, d: Deps) {
  const conexao = await conexaoCa(d);
  const [clientId, clientSecret, redirect, access, refresh, expira] = await Promise.all(
    ["client_id", "client_secret", "redirect_uri", "access_token", "refresh_token", "token_expires_at"].map((k) => d.credenciais.obter(k)),
  );
  const [{ data: cred }, { data: eventos }] = await Promise.all([
    d.db.from("integracoes_credenciais").select("chave,atualizado_em").eq("provedor", PROVEDOR).in("chave", ["access_token", "refresh_token"]),
    d.db.from("integracao_eventos").select("event_type,status,erro,payload,created_at").eq("provedor", PROVEDOR).order("created_at", { ascending: false }).limit(40),
  ]);
  const lista = (eventos ?? []) as Json[];
  const ultimo = (f: (e: Json) => boolean) => lista.find(f) ?? null;
  const renovado = ultimo((e) => e.event_type === "token_renovado");
  const falhaToken = ultimo((e) => e.event_type === "token_falhou");
  const teste = ultimo((e) => e.event_type === "conexao_testada" && e.status === "processado");
  const agora = d.agora().getTime();
  const expiraMs = expira ? Date.parse(expira) : NaN;
  const redirectPadrao = `${(env.PUBLIC_APP_URL || "").replace(/\/$/, "")}/api/integrations/conta-azul/oauth/callback`;
  return {
    ambiente: conexao.ambiente,
    urls: { authorizeUrl: conexao.authorizeUrl, tokenUrl: conexao.tokenUrl, apiBaseUrl: conexao.apiBaseUrl, callback: redirect || redirectPadrao },
    configurado: Boolean(clientId && clientSecret),
    credenciais: { clientId: Boolean(clientId), clientSecret: Boolean(clientSecret), redirectUri: Boolean(redirect) },
    conectado: Boolean(refresh),
    token: {
      presente: Boolean(access), expiraEm: expira ?? null,
      estado: !access ? "ausente" : Number.isFinite(expiraMs) ? (expiraMs > agora ? "valido" : "expirado") : "sem_validade",
      renovacaoAutomatica: Boolean(refresh),
      ultimaRenovacao: renovado?.created_at ?? ((cred ?? []) as Json[]).find((c) => c.chave === "access_token")?.atualizado_em ?? null,
      ultimaFalha: falhaToken && (!renovado || falhaToken.created_at > renovado.created_at) ? { em: falhaToken.created_at, erro: falhaToken.erro, codigo: falhaToken.payload?.codigo ?? null } : null,
    },
    empresa: teste ? { nome: teste.payload?.empresa ?? null, documento: teste.payload?.documento ?? null, verificadaEm: teste.created_at, ambiente: teste.payload?.ambiente ?? null } : null,
    ultimaSincronizacao: ultimo((e) => String(e.event_type).startsWith("sync_")),
    ultimoErro: ultimo((e) => e.status === "erro"),
    webhooks: WEBHOOKS,
    anexos: { disponivel: false, motivo: "A API lista os anexos da parcela (campo anexos), mas não tem endpoint para enviar arquivo a um lançamento. O comprovante continua no Sra Luck." },
    eventos: lista.slice(0, 30).map((e) => ({ tipo: e.event_type, status: e.status, erro: e.erro, em: e.created_at, resumo: e.payload?.empresa ?? e.payload?.codigo ?? e.payload?.origem ?? null })),
  };
}

// ------------------------------------------------------------------ rotas

/**
 * Vínculo avulso de UMA parcela (painel de operação): mesmas regras da conferência da cliente —
 * a pessoa precisa estar confirmada e o lançamento precisa ser dela. Nunca só por ID digitado.
 */
async function vincularAvulso(request: Request, env: Env) {
  if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  const auth = await exigir(request, env, [PERMISSOES_ADMIN.INTEGRACOES_OPERAR_FINANCEIRO, PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL]);
  if (auth instanceof Response) return auth;
  if (isDevConsoleSyntheticAdminId(auth.adminId)) return json({ erro: "Operações da Conta Azul são feitas no Admin do Sra Luck." }, 403);
  const body = await request.json().catch(() => ({})) as Json;
  const boletoId = String(body.boletoId || ""), caParcelaId = String(body.contaAzulParcelaId || "");
  if (!UUID.test(boletoId) || !caParcelaId) return json({ erro: "Informe a parcela e o lançamento da Conta Azul." }, 400);
  const d = depsPadrao(env);
  const { data: boleto } = await d.db.from("boletos").select("cliente_id").eq("id", boletoId).maybeSingle();
  if (!boleto) return json({ erro: "Parcela não encontrada." }, 404);
  try {
    const r = await confirmarVinculos(env, String((boleto as Json).cliente_id), [{ boletoId, caParcelaId, aceitarDivergencias: body.aceitarDivergencias === true }], auth.colaboradorId);
    if (!r.ok) return json({ erro: r.erro }, r.status);
    const x = r.resultados[0];
    return x.ok ? json({ ok: true, vinculado: !x.conflito, conflito: Boolean(x.conflito), divergencias: x.divergencias ?? [] }) : json({ erro: x.erro, divergencias: x.divergencias ?? [] }, 409);
  } catch (e) {
    return json({ erro: e instanceof ErroContaAzul ? e.message : "Falha ao falar com a Conta Azul." }, 502);
  }
}

/**
 * /api/admin/integrations/conta-azul/clientes/{id}/…  (equipe no Admin, sessão humana)
 * /api/admin/integrations/conta-azul/central/…        (Dev Console: saúde, teste, renovar, desconectar)
 */
export async function contaAzulVinculosApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const base = "/api/admin/integrations/conta-azul/";
  if (!url.pathname.startsWith(base)) return null;
  if (contaAzulBloqueadaNoAmbiente(env)) return json({ erro: MENSAGEM_PREVIEW_BLOQUEADO, codigo: "CONTA_AZUL_PREVIEW_BLOQUEADO" }, 503);
  const rota = url.pathname.slice(base.length);
  const central = rota.match(/^central\/(status|testar-conexao|renovar-token|desconectar|concluir-oauth|diagnostico)$/);
  const cliente = rota.match(/^clientes\/([0-9a-f-]{36})\/(conta-azul|pessoas|pessoa|pessoa\/desvincular|conciliacao|vinculos|importacao|importar)$/);
  if (rota === "vincular" && request.method === "POST") return vincularAvulso(request, env);
  if (!central && !cliente) return null;

  if (central) {
    const acao = central[1];
    if ((acao === "status") !== (request.method === "GET")) return json({ erro: "Método não permitido." }, 405);
    if (request.method !== "GET" && !sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
    const auth = await exigir(request, env, [PERMISSOES_ADMIN.INTEGRACOES_GERENCIAR_CREDENCIAIS]);
    if (auth instanceof Response) return auth;
    // Ações técnicas (não financeiras): valem com a integração desligada, para conectar e validar.
    const d = depsPadrao(env, { credenciais: credenciaisDeConfiguracao(env) });
    try {
      if (acao === "status") return json(await statusCentral(env, d));
      if (acao === "testar-conexao") { const r = await testarConexaoCa(d, auth.adminId); return r.ok ? json(r) : json(r, r.status); }
      if (acao === "renovar-token") { const r = await renovarAgora(d, auth.adminId); return r.ok ? json(r) : json(r, r.status); }
      const body = await request.json().catch(() => ({})) as Json;
      if (acao === "concluir-oauth") { const r = await concluirOAuthColado(env, d, String(body.url || ""), auth.adminId); return r.ok ? json(r) : json({ erro: r.erro }, r.status); }
      if (acao === "diagnostico") return json(await diagnosticoApi(d, { cpf: typeof body.cpf === "string" ? body.cpf : null, ator: auth.adminId }));
      return json(await desconectar(d, auth.adminId));
    } catch (e) {
      return json({ erro: e instanceof ErroContaAzul ? e.message : "Falha na central da Conta Azul." }, 502);
    }
  }

  const clienteId = cliente![1], acao = cliente![2];
  const leitura = request.method === "GET";
  if (leitura !== ["conta-azul", "pessoas", "conciliacao", "importacao"].includes(acao)) return json({ erro: "Método não permitido." }, 405);
  if (!leitura && !sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  const auth = await exigir(request, env, [PERMISSOES_ADMIN.INTEGRACOES_OPERAR_FINANCEIRO]);
  if (auth instanceof Response) return auth;
  const d = depsPadrao(env);
  try {
    if (acao === "conta-azul") {
      const pessoa = await vinculoPessoa(d, clienteId);
      const [{ count: parcelas }, { data: vinculos }] = await Promise.all([
        d.db.from("boletos").select("id", { count: "exact", head: true }).eq("cliente_id", clienteId),
        d.db.from("conta_azul_vinculos").select("estado").eq("cliente_id", clienteId),
      ]);
      const porEstado: Record<string, number> = {};
      for (const v of (vinculos ?? []) as Json[]) porEstado[v.estado] = (porEstado[v.estado] ?? 0) + 1;
      return json({ pessoa, parcelasSra: parcelas ?? 0, vinculos: porEstado });
    }
    if (acao === "pessoas") { const r = await buscarPessoasPorCpf(d, clienteId); return r.ok ? json(r) : json({ erro: r.erro }, r.status); }
    if (acao === "conciliacao") { const r = await conciliacaoDaCliente(d, clienteId); return r.ok ? json(r) : json({ erro: r.erro }, r.status); }
    if (acao === "importacao") { const r = await previaImportacao(d, clienteId); return r.ok ? json(r) : json({ erro: r.erro }, r.status); }

    // Mutações: só a equipe no Admin (nunca a identidade técnica do Dev Console).
    if (isDevConsoleSyntheticAdminId(auth.adminId)) return json({ erro: "Vínculos da Conta Azul são feitos pela equipe no Admin do Sra Luck." }, 403);
    const body = await request.json().catch(() => ({})) as Json;
    const ator = auth.colaboradorId;
    if (acao === "vinculos" || acao === "importar") {
      const baixa = await exigir(request, env, [PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL]);
      if (baixa instanceof Response) return baixa;
    }
    const r = acao === "pessoa" ? await vincularPessoa(env, clienteId, String(body.caPessoaId || ""), ator)
      : acao === "pessoa/desvincular" ? await desvincularPessoa(env, clienteId, typeof body.motivo === "string" ? body.motivo.slice(0, 300) : null, ator)
      : acao === "vinculos" ? await confirmarVinculos(env, clienteId, Array.isArray(body.pares) ? body.pares : [], ator)
      : await importarFinanceiro(env, clienteId, Array.isArray(body.caParcelaIds) ? body.caParcelaIds : [], ator);
    return r.ok ? json(r) : json({ erro: (r as Json).erro }, (r as Json).status);
  } catch (e) {
    // Conta Azul fora do ar / sem conexão: explica, não derruba nada do Financeiro.
    return json({ erro: e instanceof ErroContaAzul ? e.message : "Falha ao falar com a Conta Azul." }, 502);
  }
}
