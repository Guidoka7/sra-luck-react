import { createServiceSupabaseClient, type Env } from "./supabase";
import { adminParcelas } from "./admin-parcelas";
import { ADMIN_COOKIE_NAME, getCookie, verificarTokenAdmin, type AdminSessionPayload } from "./session";
import { buscarColaboradorAdminAtivo, temPermissaoAdmin, PERMISSOES_ADMIN } from "./admin-auth";

type Json = Record<string, any>;
type Db = ReturnType<typeof createServiceSupabaseClient>;

const BOLETO_SELECT = "id,cliente_id,numero_parcela,total_parcelas,valor,data_vencimento,status,comprovante_url,comprovante_enviado_em,data_pagamento,observacoes,created_at,updated_at,suspensa,suspensa_em,suspensa_por,carne_id,instituicao_financeira,identificador_externo,origem_boleto,clientes(id,nome_completo,cpf,valor_contrato,custo_total,taxa_administrativa_percentual,quantidade_parcelas,status_contrato)";
const RECEBIMENTO_SELECT = "id,boleto_id,cliente_id,valor_original,juros,multa,desconto,valor_recebido,data_pagamento,forma_pagamento,instituicao_conta,origem,status_validacao,comprovante_url,external_payment_id,external_reference,origem_boleto,instituicao_financeira,observacao,motivo_rejeicao,criado_por,validado_por,validado_em,created_at";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function lerBody(request: Request): Promise<Json> {
  try { return await request.json(); } catch { return {}; }
}

function hojeIso() { return new Date().toISOString().slice(0, 10); }
function dataValida(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value); }
function dinheiro(value: unknown) { const number = Number(value ?? 0); return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0; }
function relacao<T>(value: T | T[] | null | undefined): T | null { return Array.isArray(value) ? value[0] ?? null : value ?? null; }
function texto(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

function detectarTipoComprovante(bytes: Uint8Array) {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return { mime: "application/pdf", extensao: "pdf" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", extensao: "jpg" };
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { mime: "image/png", extensao: "png" };
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { mime: "image/webp", extensao: "webp" };
  return null;
}

function periodo(url: URL) {
  const now = new Date();
  const defaultEnd = hojeIso();
  const defaultStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const inicio = dataValida(url.searchParams.get("inicio")) ? url.searchParams.get("inicio")! : defaultStart;
  const fim = dataValida(url.searchParams.get("fim")) ? url.searchParams.get("fim")! : defaultEnd;
  return inicio <= fim ? { inicio, fim } : { inicio: fim, fim: inicio };
}

function statusCalculado(boleto: any) {
  if (boleto.suspensa) return "suspensa";
  if (boleto.status === "nao_pago" && boleto.data_vencimento && boleto.data_vencimento < hojeIso()) return "vencido";
  return boleto.status;
}

function clienteDo(boleto: any) {
  return relacao<any>(boleto.clientes) ?? {};
}

function indiceRecebimentos(recebimentos: any[]) {
  const result = new Map<string, any>();
  for (const recebimento of recebimentos) {
    const atual = result.get(recebimento.boleto_id);
    if (!atual || recebimento.status_validacao === "validado" || new Date(recebimento.created_at) > new Date(atual.created_at)) {
      result.set(recebimento.boleto_id, recebimento);
    }
  }
  return result;
}

function apresentarRecebivel(boleto: any, recebimento?: any) {
  const cliente = clienteDo(boleto);
  return {
    id: boleto.id,
    clienteId: boleto.cliente_id,
    cliente: cliente.nome_completo ?? "Cliente",
    vendedora: null,
    cpf: cliente.cpf ?? null,
    numeroParcela: Number(boleto.numero_parcela),
    totalParcelas: Number(boleto.total_parcelas),
    vencimento: boleto.data_vencimento,
    valorOriginal: dinheiro(boleto.valor),
    juros: dinheiro(recebimento?.juros),
    multa: dinheiro(recebimento?.multa),
    desconto: dinheiro(recebimento?.desconto),
    valorEsperado: dinheiro(boleto.valor) + dinheiro(recebimento?.juros) + dinheiro(recebimento?.multa) - dinheiro(recebimento?.desconto),
    valorRecebido: recebimento?.status_validacao === "validado" ? dinheiro(recebimento.valor_recebido) : null,
    status: statusCalculado(boleto),
    formaPagamento: recebimento?.forma_pagamento ?? null,
    origem: recebimento?.origem_boleto ?? recebimento?.origem ?? "interno",
    instituicaoConta: recebimento?.instituicao_financeira ?? recebimento?.instituicao_conta ?? null,
    dataPagamento: recebimento?.data_pagamento ?? boleto.data_pagamento ?? null,
    comprovante: boleto.comprovante_url ?? recebimento?.comprovante_url ?? null,
    comprovanteEnviadoEm: boleto.comprovante_enviado_em ?? (boleto.comprovante_url ? boleto.updated_at : null),
    banco: boleto.instituicao_financeira ?? recebimento?.instituicao_financeira ?? recebimento?.instituicao_conta ?? null,
    contratoCodigo: boleto.identificador_externo ?? boleto.carne_id ?? null,
    externalId: recebimento?.external_payment_id ?? null,
    externalReference: recebimento?.external_reference ?? null,
    observacoes: boleto.observacoes ?? recebimento?.observacao ?? null,
    suspensa: Boolean(boleto.suspensa),
    createdAt: boleto.created_at,
    updatedAt: boleto.updated_at,
  };
}

async function exigirAdmin(request: Request, env: Env): Promise<AdminSessionPayload | Response> {
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);
  const sessao = await verificarTokenAdmin(getCookie(request, ADMIN_COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
  return sessao ?? json({ erro: "Sessão administrativa expirada." }, 401);
}

function origemSegura(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

async function carregarBase(db: Db) {
  const [boletosResult, recebimentosResult] = await Promise.all([
    db.from("boletos").select(BOLETO_SELECT, { count: "exact" }).order("data_vencimento", { ascending: true }).limit(5000),
    db.from("financeiro_recebimentos").select(RECEBIMENTO_SELECT).order("created_at", { ascending: false }).limit(5000),
  ]);
  if (boletosResult.error) throw new Error(boletosResult.error.message);
  if (recebimentosResult.error) throw new Error(recebimentosResult.error.message);
  return {
    boletos: boletosResult.data ?? [],
    recebimentos: recebimentosResult.data ?? [],
    truncado: Number(boletosResult.count ?? 0) > 5000,
  };
}

function receitaAdministrativa(boleto: any, valor: number) {
  const cliente = clienteDo(boleto);
  const base = dinheiro(cliente.valor_contrato);
  const custo = dinheiro(cliente.custo_total);
  const taxaTotal = Math.max(0, custo - base) || dinheiro(base * dinheiro(cliente.taxa_administrativa_percentual) / 100);
  return custo > 0 ? dinheiro(valor * taxaTotal / custo) : 0;
}

async function resumo(db: Db, url: URL) {
  const { inicio, fim } = periodo(url);
  const { boletos, recebimentos, truncado } = await carregarBase(db);
  const porBoleto = indiceRecebimentos(recebimentos);
  let aReceber = 0; let recebido = 0; let vencido = 0; let aguardando = 0; let receitaRealizada = 0; let receitaFutura = 0;
  const evolucao = new Map<string, { previsto: number; realizado: number; vencido: number; receitaRealizada: number; receitaFutura: number }>();
  const futuros = { 30: 0, 60: 0, 90: 0 };
  const hoje = hojeIso();
  const horizonte = (dias: number) => { const d = new Date(`${hoje}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };

  for (const boleto of boletos as any[]) {
    const rec = porBoleto.get(boleto.id);
    const vencimento = boleto.data_vencimento as string | null;
    const dataRecebida = rec?.status_validacao === "validado" ? rec.data_pagamento : boleto.data_pagamento;
    const valorPrevisto = dinheiro(boleto.valor);
    const valorRealizado = rec?.status_validacao === "validado" ? dinheiro(rec.valor_recebido) : boleto.status === "pago" ? valorPrevisto : 0;
    const emPeriodo = Boolean(vencimento && vencimento >= inicio && vencimento <= fim);
    const recebidoNoPeriodo = Boolean(dataRecebida && dataRecebida >= inicio && dataRecebida <= fim);

    if (emPeriodo) {
      aReceber += valorPrevisto;
      if (boleto.status === "pendente_confirmacao") aguardando += 1;
      if (statusCalculado(boleto) === "vencido") vencido += valorPrevisto;
      if (boleto.status !== "pago") receitaFutura += receitaAdministrativa(boleto, valorPrevisto);
    }
    if (recebidoNoPeriodo) {
      recebido += valorRealizado;
      receitaRealizada += receitaAdministrativa(boleto, valorRealizado);
    }

    const chave = (dataRecebida || vencimento || "").slice(0, 7);
    if (chave && ((vencimento && vencimento >= inicio && vencimento <= fim) || recebidoNoPeriodo)) {
      const atual = evolucao.get(chave) ?? { previsto: 0, realizado: 0, vencido: 0, receitaRealizada: 0, receitaFutura: 0 };
      if (emPeriodo) {
        atual.previsto += valorPrevisto;
        if (statusCalculado(boleto) === "vencido") atual.vencido += valorPrevisto;
        if (boleto.status !== "pago") atual.receitaFutura += receitaAdministrativa(boleto, valorPrevisto);
      }
      if (recebidoNoPeriodo) {
        atual.realizado += valorRealizado;
        atual.receitaRealizada += receitaAdministrativa(boleto, valorRealizado);
      }
      evolucao.set(chave, atual);
    }

    if (boleto.status !== "pago" && !boleto.suspensa && vencimento && vencimento >= hoje) {
      if (vencimento <= horizonte(30)) futuros[30] += valorPrevisto;
      if (vencimento <= horizonte(60)) futuros[60] += valorPrevisto;
      if (vencimento <= horizonte(90)) futuros[90] += valorPrevisto;
    }
  }

  const grafico = [...evolucao.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, item]) => ({
    label: label.split("-").reverse().join("/"),
    previsto: dinheiro(item.previsto), realizado: dinheiro(item.realizado), vencido: dinheiro(item.vencido),
    receitaRealizada: dinheiro(item.receitaRealizada), receitaFutura: dinheiro(item.receitaFutura),
  }));
  return {
    periodo: { inicio, fim },
    kpis: {
      aReceber: dinheiro(aReceber), recebido: dinheiro(recebido), vencido: dinheiro(vencido), aguardandoValidacao: aguardando,
      divergencias: null, divergenciasDisponiveis: false,
      receitaAdministrativaRealizada: dinheiro(receitaRealizada), receitaAdministrativaFutura: dinheiro(receitaFutura),
    },
    previsao: { dias30: dinheiro(futuros[30]), dias60: dinheiro(futuros[60]), dias90: dinheiro(futuros[90]) },
    evolucao: grafico,
    ultimaAtualizacao: new Date().toISOString(), truncado,
  };
}

function filtrarRecebiveis(rows: any[], url: URL) {
  const { inicio, fim } = periodo(url);
  const busca = texto(url.searchParams.get("busca")).toLocaleLowerCase("pt-BR");
  const filtro = texto(url.searchParams.get("status")) || "todos";
  return rows.filter((item) => {
    if (item.vencimento && (item.vencimento < inicio || item.vencimento > fim)) return false;
    if (filtro !== "todos" && item.status !== filtro) return false;
    if (busca && !`${item.cliente} ${item.cpf ?? ""} ${item.numeroParcela}/${item.totalParcelas} ${item.externalId ?? ""}`.toLocaleLowerCase("pt-BR").includes(busca)) return false;
    return true;
  });
}

async function listarRecebiveis(db: Db, url: URL) {
  const { boletos, recebimentos, truncado } = await carregarBase(db);
  const porBoleto = indiceRecebimentos(recebimentos);
  const todos = (boletos as any[]).map((boleto) => apresentarRecebivel(boleto, porBoleto.get(boleto.id)));
  const filtrados = filtrarRecebiveis(todos, url);
  const pagina = Math.max(1, Number(url.searchParams.get("pagina") ?? 1));
  const limite = Math.min(100, Math.max(10, Number(url.searchParams.get("limite") ?? 40)));
  const inicio = (pagina - 1) * limite;
  return { itens: filtrados.slice(inicio, inicio + limite), total: filtrados.length, pagina, limite, truncado };
}

async function detalheRecebivel(db: Db, id: string) {
  const { data: boleto, error } = await db.from("boletos").select(BOLETO_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!boleto) return null;
  const [recebimentos, historico] = await Promise.all([
    db.from("financeiro_recebimentos").select(RECEBIMENTO_SELECT).eq("boleto_id", id).order("created_at", { ascending: false }),
    db.from("logs_alteracoes").select("id,usuario,acao,entidade,entidade_id,detalhes,created_at").or(`entidade_id.eq.${id},entidade_id.eq.${(boleto as any).cliente_id}`).order("created_at", { ascending: false }).limit(100),
  ]);
  if (recebimentos.error) throw new Error(recebimentos.error.message);
  if (historico.error) throw new Error(historico.error.message);
  const indice = indiceRecebimentos(recebimentos.data ?? []);
  return { recebivel: apresentarRecebivel(boleto, indice.get(id)), recebimentos: recebimentos.data ?? [], historico: historico.data ?? [] };
}

function erroRpc(message: string) {
  if (/nao encontrada|não encontrada/i.test(message)) return 404;
  if (/ja liquidada|não esta pendente|nao esta pendente|duplicate key/i.test(message)) return 409;
  if (/obrigatori|invalida|invalido|superior/i.test(message)) return 400;
  return 500;
}

type FunilCliente = "aguardando_conferencia" | "ativos" | "todos" | "suspensos" | "negativados" | "cancelados";

/**
 * Funil por cliente (Fase 4): visão que o ZIP pede como navegação principal
 * do Financeiro, calculada por AGREGAÇÃO sobre os mesmos boletos/recebimentos
 * já usados por resumo()/listarRecebiveis() — nenhuma tabela nova, nenhum
 * dado recalculado por uma segunda regra.
 *
 * Correção (2026-09-14): o funil aprovado é Aguardando conferência / Ativos /
 * Todos / Suspensos / Negativados / Cancelados. "Aguardando conferência" NÃO
 * significa cliente sem parcelas — significa comprovante/pagamento aguardando
 * análise do Financeiro (parcela com status pendente_confirmacao). Cliente
 * sem financeiro nenhum simplesmente não entra neste funil (isso é assunto da
 * tela Clientes, aba "Aguardando cadastro"). "Todos" não é um bucket
 * excludente — é a lista completa de quem tem financeiro, sem filtro de
 * bucket. "Ativo" exige financeiro real E nenhum estado administrativo
 * anormal (suspenso/negativado/cancelado) — nunca é inferido do carnê.
 */
async function clientesFunil(db: Db) {
  const [{ data: todosClientes, error: erroClientes }, { boletos, recebimentos }, { data: vendasRows }] = await Promise.all([
    db.from("clientes").select("id,nome_completo,cpf,status_contrato,valor_contrato,custo_total,consultora").order("nome_completo", { ascending: true }),
    carregarBase(db),
    db.from("novas_vendas").select("cliente_id,origem_venda").not("cliente_id", "is", null),
  ]);
  if (erroClientes) throw new Error(erroClientes.message);

  const origemPorCliente = new Map<string, string>();
  for (const v of (vendasRows ?? []) as any[]) if (v.cliente_id && !origemPorCliente.has(v.cliente_id) && v.origem_venda) origemPorCliente.set(v.cliente_id, v.origem_venda);

  const porBoleto = indiceRecebimentos(recebimentos);
  const porCliente = new Map<string, { pagas: number; total: number; saldoAReceber: number; vencidas: number; aguardandoValidacao: number; proximoVencimento: string | null }>();
  for (const boleto of boletos) {
    const agregado = porCliente.get(boleto.cliente_id) ?? { pagas: 0, total: 0, saldoAReceber: 0, vencidas: 0, aguardandoValidacao: 0, proximoVencimento: null };
    const apresentado = apresentarRecebivel(boleto, porBoleto.get(boleto.id));
    agregado.total += 1;
    if (apresentado.status === "pago") agregado.pagas += 1;
    else { agregado.saldoAReceber += apresentado.valorEsperado; if (!agregado.proximoVencimento && boleto.data_vencimento) agregado.proximoVencimento = boleto.data_vencimento; }
    if (apresentado.status === "vencido") agregado.vencidas += 1;
    if (apresentado.status === "pendente_confirmacao") agregado.aguardandoValidacao += 1;
    porCliente.set(boleto.cliente_id, agregado);
  }

  const itens = (todosClientes ?? [])
    .filter((cliente: any) => (porCliente.get(cliente.id)?.total ?? 0) > 0)
    .map((cliente: any) => {
      const agregado = porCliente.get(cliente.id)!;
      const statusContrato = cliente.status_contrato ?? "ativo";
      let bucket: FunilCliente;
      if (statusContrato === "cancelado") bucket = "cancelados";
      else if (statusContrato === "negativado") bucket = "negativados";
      else if (statusContrato === "suspenso") bucket = "suspensos";
      else if (agregado.aguardandoValidacao > 0) bucket = "aguardando_conferencia";
      else bucket = "ativos";

      const quitado = agregado.pagas === agregado.total;
      const proximaAcao = agregado.aguardandoValidacao > 0 ? "Validar comprovante" : agregado.vencidas > 0 ? "Cobrar parcela vencida" : quitado ? "Sem pendência" : "Acompanhar";

      return {
        clienteId: cliente.id,
        nome: cliente.nome_completo,
        cpf: cliente.cpf,
        statusContrato,
        bucket,
        quitado,
        parcelasPagas: agregado.pagas,
        parcelasTotal: agregado.total,
        saldoAReceber: dinheiro(agregado.saldoAReceber),
        vencidas: agregado.vencidas,
        aguardandoValidacao: agregado.aguardandoValidacao,
        proximaAcao,
        vendedora: cliente.consultora ?? null,
        campanha: origemPorCliente.get(cliente.id) ?? null,
        proximoVencimento: agregado.proximoVencimento,
      };
    });

  const funis = [
    { bucket: "aguardando_conferencia" as const, total: itens.filter((i) => i.bucket === "aguardando_conferencia").length },
    { bucket: "ativos" as const, total: itens.filter((i) => i.bucket === "ativos").length },
    { bucket: "todos" as const, total: itens.length },
    { bucket: "suspensos" as const, total: itens.filter((i) => i.bucket === "suspensos").length },
    { bucket: "negativados" as const, total: itens.filter((i) => i.bucket === "negativados").length },
    { bucket: "cancelados" as const, total: itens.filter((i) => i.bucket === "cancelados").length },
  ];

  return { itens, funis };
}

async function painelFinanceiro(db: Db) {
  const [{ boletos, recebimentos, truncado }, { data: clientes, error: clientesError }, { data: carnes, error: carnesError }] = await Promise.all([
    carregarBase(db),
    db.from("clientes").select("id,nome_completo,cpf,consultora,origem_venda,banco,status_contrato,procedimento"),
    db.from("carnes").select("id,cliente_id,instituicao_financeira,identificador_externo,data_geracao,created_at").order("created_at", { ascending: false }),
  ]);
  if (clientesError) throw new Error(clientesError.message);
  if (carnesError) throw new Error(carnesError.message);

  const clientePorId = new Map<string, any>();
  for (const cliente of clientes ?? []) clientePorId.set(String((cliente as any).id), cliente);

  const carnePorId = new Map<string, any>();
  const carnePorCliente = new Map<string, any>();
  for (const carne of carnes ?? []) {
    const item = carne as any;
    carnePorId.set(String(item.id), item);
    if (!carnePorCliente.has(String(item.cliente_id))) carnePorCliente.set(String(item.cliente_id), item);
  }

  const porBoleto = indiceRecebimentos(recebimentos);
  const rows = (boletos as any[]).map((boleto) => {
    const cliente = clientePorId.get(String(boleto.cliente_id)) ?? clienteDo(boleto);
    const recebimento = porBoleto.get(boleto.id);
    const carne = (boleto.carne_id ? carnePorId.get(String(boleto.carne_id)) : null) ?? carnePorCliente.get(String(boleto.cliente_id));
    const status = statusCalculado(boleto);
    const comprovante = boleto.comprovante_url ?? recebimento?.comprovante_url ?? null;
    const comprovanteEnviadoEm = boleto.comprovante_enviado_em ?? (comprovante ? boleto.updated_at : null);
    const confirmadoPorComprovante = boleto.status === "pago"
      && recebimento?.status_validacao === "validado"
      && (recebimento?.origem === "comprovante" || recebimento?.origem_boleto === "comprovante");
    const banco = boleto.instituicao_financeira
      ?? recebimento?.instituicao_financeira
      ?? recebimento?.instituicao_conta
      ?? carne?.instituicao_financeira
      ?? cliente?.banco
      ?? null;
    const contratoCodigo = carne?.identificador_externo
      ?? boleto.identificador_externo
      ?? (boleto.carne_id ? String(boleto.carne_id) : null)
      ?? `SL-${String(boleto.cliente_id).slice(0, 8).toUpperCase()}`;
    const arquivo = comprovante ? String(comprovante).split("/").pop() ?? "comprovante" : null;
    return {
      clientId: String(boleto.cliente_id),
      contractId: boleto.carne_id ? String(boleto.carne_id) : contratoCodigo,
      installmentId: String(boleto.id),
      proofId: comprovante ? String(boleto.id) : null,
      name: cliente?.nome_completo ?? "Cliente",
      cpf: cliente?.cpf ?? null,
      seller: cliente?.consultora ?? null,
      campaign: cliente?.origem_venda ?? null,
      procedure: cliente?.procedimento ?? null,
      bank: banco,
      statusContrato: cliente?.status_contrato ?? "ativo",
      installmentNumber: Number(boleto.numero_parcela ?? 0),
      installmentTotal: Number(boleto.total_parcelas ?? 0),
      dueDate: boleto.data_vencimento ?? null,
      amount: dinheiro(boleto.valor),
      status: boleto.status === "pendente_confirmacao" ? "Aguardando análise"
        : confirmadoPorComprovante ? "Comprovante confirmado"
        : boleto.status === "pago" ? "Recebido"
        : status === "vencido" ? "Atrasado"
        : boleto.status === "rejeitado" ? "Recusado"
        : boleto.suspensa ? "Suspensa"
        : "Pendente",
      contractCode: contratoCodigo,
      uploadedAt: comprovanteEnviadoEm,
      paymentDate: recebimento?.data_pagamento ?? boleto.data_pagamento ?? null,
      proof: comprovante ? {
        id: String(boleto.id),
        fileName: arquivo,
        path: String(comprovante),
        uploadedAt: comprovanteEnviadoEm,
        reviewedAt: recebimento?.validado_em ?? null,
        reviewedBy: recebimento?.validado_por ?? null,
      } : null,
      createdAt: boleto.created_at,
      updatedAt: boleto.updated_at,
      isOverdue: status === "vencido",
      isPendingProof: boleto.status === "pendente_confirmacao" && Boolean(comprovante),
      isReceived: boleto.status === "pago",
    };
  });

  const proofs = rows
    .filter((row) => row.isPendingProof)
    .sort((a, b) => String(b.uploadedAt ?? "").localeCompare(String(a.uploadedAt ?? "")));
  const received = rows
    .filter((row) => row.isReceived)
    .sort((a, b) => String(b.paymentDate ?? b.updatedAt ?? "").localeCompare(String(a.paymentDate ?? a.updatedAt ?? "")));
  const late = rows
    .filter((row) => row.isOverdue)
    .sort((a, b) => String(a.dueDate ?? "").localeCompare(String(b.dueDate ?? "")));

  const priority = (row: any) => row.isPendingProof ? 0 : row.isOverdue ? 1 : row.isReceived ? 3 : 2;
  const allByClient = new Map<string, any>();
  for (const row of rows) {
    const previous = allByClient.get(row.clientId);
    if (!previous || priority(row) < priority(previous)) allByClient.set(row.clientId, row);
  }
  const all = [...allByClient.values()].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "pt-BR"));

  const proofDatesMap = new Map<string, number>();
  for (const row of proofs) {
    const date = String(row.uploadedAt ?? "").slice(0, 10);
    if (date) proofDatesMap.set(date, (proofDatesMap.get(date) ?? 0) + 1);
  }
  const proofDates = [...proofDatesMap.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const banks = [...new Set(rows.map((row) => row.bank).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return {
    proofs,
    received,
    late,
    all,
    proofDates,
    counts: { proofs: proofs.length, received: received.length, late: late.length, all: all.length },
    banks,
    truncado,
    generatedAt: new Date().toISOString(),
  };
}

async function encaminharParcelas(request: Request, env: Env, clienteId: string, payload: Json) {
  const url = new URL(request.url);
  url.pathname = `/api/admin/clientes/${encodeURIComponent(clienteId)}/parcelas`;
  const facade = new Request(url.toString(), { method: "POST", headers: request.headers, body: JSON.stringify(payload) });
  return adminParcelas(facade, env);
}

export async function adminFinanceiro(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/admin/financeiro")) return null;

  const auth = await exigirAdmin(request, env);
  if (auth instanceof Response) return auth;
  if (request.method !== "GET" && !origemSegura(request)) return json({ erro: "Origem da requisição não autorizada." }, 403);
  const db = createServiceSupabaseClient(env);
  const usuario = `admin:${auth.adminId}`;

  try {
    if (path === "/api/admin/financeiro/painel" && request.method === "GET") return json(await painelFinanceiro(db));
    if (path === "/api/admin/financeiro/resumo" && request.method === "GET") return json(await resumo(db, url));
    if (path === "/api/admin/financeiro/clientes" && request.method === "GET") return json(await clientesFunil(db));
    if (path === "/api/admin/financeiro/recebiveis" && request.method === "GET") return json(await listarRecebiveis(db, url));

    if (path === "/api/admin/financeiro/validacoes" && request.method === "GET") {
      const base = await listarRecebiveis(db, new URL(`${url.origin}/api/admin/financeiro/recebiveis?status=pendente_confirmacao&inicio=2000-01-01&fim=2999-12-31&limite=100`));
      return json({ ...base, itens: base.itens.sort((a: any, b: any) => String(a.vencimento ?? a.createdAt).localeCompare(String(b.vencimento ?? b.createdAt))) });
    }

    if (path === "/api/admin/financeiro/contratos-entrada" && request.method === "GET") {
      return json({ disponivel: false, itens: [], motivo: "A estrutura de staging de contratos ainda não está conectada. Nenhum dado externo foi consultado." });
    }
    if (path === "/api/admin/financeiro/conciliacao" && request.method === "GET") {
      return json({ disponivel: false, itens: [], motivo: "A conciliação depende de provedores homologados. Nenhuma integração bancária foi acionada." });
    }

    const baixaMatch = path.match(/^\/api\/admin\/financeiro\/recebiveis\/([^/]+)\/baixa$/);
    if (baixaMatch && request.method === "POST") {
      const colaboradorBaixa = await buscarColaboradorAdminAtivo(auth.adminId, env);
      if (!colaboradorBaixa || !temPermissaoAdmin(colaboradorBaixa, PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL)) {
        return json({ erro: "Seu papel não tem permissão para registrar baixa manual." }, 403);
      }
      const b = await lerBody(request);
      const dataPagamento = b.dataPagamento;
      const forma = texto(b.formaPagamento);
      const idempotencyKey = texto(b.idempotencyKey);
      if (!dataValida(dataPagamento)) return json({ erro: "Informe uma data de pagamento válida." }, 400);
      if (!idempotencyKey || idempotencyKey.length > 120) return json({ erro: "Chave de idempotência inválida." }, 400);
      if (!['pix', 'dinheiro', 'transferencia', 'boleto', 'cartao', 'cheque', 'outro'].includes(forma)) return json({ erro: "Forma de pagamento inválida." }, 400);
      const juros = dinheiro(b.juros); const multa = dinheiro(b.multa); const desconto = dinheiro(b.desconto);
      if ([juros, multa, desconto].some((value) => value < 0)) return json({ erro: "Juros, multa e desconto não podem ser negativos." }, 400);
      const { data, error } = await db.rpc("financeiro_baixar_boleto", {
        p_boleto_id: decodeURIComponent(baixaMatch[1]), p_data_pagamento: dataPagamento,
        p_juros: juros, p_multa: multa, p_desconto: desconto, p_forma_pagamento: forma,
        p_instituicao_conta: texto(b.instituicaoConta), p_observacao: texto(b.observacao),
        p_usuario: usuario, p_idempotency_key: idempotencyKey,
      });
      if (error) return json({ erro: error.message }, erroRpc(error.message));
      return json({ recebimento: data }, 201);
    }

    const comprovanteMatch = path.match(/^\/api\/admin\/financeiro\/recebiveis\/([^/]+)\/comprovante$/);
    if (comprovanteMatch && request.method === "GET") {
      const id = decodeURIComponent(comprovanteMatch[1]);
      const { data: boleto, error: boletoError } = await db.from("boletos").select("comprovante_url").eq("id", id).maybeSingle();
      if (boletoError) return json({ erro: boletoError.message }, 500);
      if (!boleto?.comprovante_url) return json({ erro: "Comprovante não encontrado." }, 404);
      const { data, error } = await db.storage.from("boletos-clientes").createSignedUrl(boleto.comprovante_url, 300);
      if (error || !data?.signedUrl) return json({ erro: "Não foi possível gerar o link do comprovante." }, 500);
      return json({ url: data.signedUrl });
    }
    if (comprovanteMatch && request.method === "POST") {
      const id = decodeURIComponent(comprovanteMatch[1]);
      const form = await request.formData();
      const arquivo = form.get("arquivo");
      if (!(arquivo instanceof File)) return json({ erro: "Selecione um comprovante." }, 400);
      if (arquivo.size > 8 * 1024 * 1024) return json({ erro: "O comprovante deve ter no máximo 8 MB." }, 400);
      const bytes = new Uint8Array(await arquivo.arrayBuffer());
      const tipo = detectarTipoComprovante(bytes);
      if (!tipo) return json({ erro: "Envie um PDF, JPG, PNG ou WebP válido." }, 400);
      const { data: boleto } = await db.from("boletos").select("id,cliente_id,status,comprovante_url").eq("id", id).maybeSingle();
      if (!boleto) return json({ erro: "Parcela não encontrada." }, 404);
      if (boleto.status === "pago") return json({ erro: "A parcela já está liquidada." }, 409);
      const caminho = `admin/${boleto.cliente_id}/${id}/${crypto.randomUUID()}.${tipo.extensao}`;
      const { error: uploadError } = await db.storage.from("boletos-clientes").upload(caminho, bytes, { contentType: tipo.mime, upsert: false });
      if (uploadError) return json({ erro: uploadError.message }, 500);
      const { data: atualizado, error: updateError } = await db.from("boletos").update({ comprovante_url: caminho, comprovante_enviado_em: new Date().toISOString() }).eq("id", id).neq("status", "pago").select("id").maybeSingle();
      if (updateError || !atualizado) {
        await db.storage.from("boletos-clientes").remove([caminho]);
        return json({ erro: updateError?.message ?? "A parcela foi liquidada durante o envio." }, updateError ? 500 : 409);
      }
      if (boleto.comprovante_url && boleto.comprovante_url !== caminho) await db.storage.from("boletos-clientes").remove([boleto.comprovante_url]);
      await db.from("logs_alteracoes").insert({ usuario, acao: "anexou_comprovante_baixa_manual", entidade: "boletos", entidade_id: id, detalhes: { cliente_id: boleto.cliente_id, tipo: tipo.mime, tamanho: arquivo.size } });
      return json({ sucesso: true });
    }

    const validacaoMatch = path.match(/^\/api\/admin\/financeiro\/validacoes\/([^/]+)\/(confirmar|rejeitar)$/);
    if (validacaoMatch && request.method === "POST") {
      const colaboradorValidacao = await buscarColaboradorAdminAtivo(auth.adminId, env);
      if (!colaboradorValidacao || !temPermissaoAdmin(colaboradorValidacao, PERMISSOES_ADMIN.FINANCEIRO_VALIDAR_COMPROVANTE)) {
        return json({ erro: "Seu papel não tem permissão para validar comprovantes." }, 403);
      }
      const b = await lerBody(request);
      const acao = validacaoMatch[2]; const observacao = texto(b.observacao); const idempotencyKey = texto(b.idempotencyKey);
      if (!idempotencyKey || idempotencyKey.length > 120) return json({ erro: "Chave de idempotência inválida." }, 400);
      if (acao === "rejeitar" && !observacao) return json({ erro: "Informe o motivo da rejeição ou divergência." }, 400);
      const { data, error } = await db.rpc("financeiro_validar_comprovante", {
        p_boleto_id: decodeURIComponent(validacaoMatch[1]), p_acao: acao, p_observacao: observacao,
        p_usuario: usuario, p_idempotency_key: idempotencyKey,
      });
      if (error) return json({ erro: error.message }, erroRpc(error.message));
      return json({ recebimento: data });
    }

    const gerarMatch = path.match(/^\/api\/admin\/financeiro\/clientes\/([^/]+)\/parcelas$/);
    if (gerarMatch && request.method === "POST") {
      const b = await lerBody(request);
      return await encaminharParcelas(request, env, decodeURIComponent(gerarMatch[1]), {
        acao: "gerar", quantidade: b.quantidade, valorParcela: b.valorParcela, primeiroVencimento: b.primeiroVencimento,
      });
    }

    const recebivelMatch = path.match(/^\/api\/admin\/financeiro\/recebiveis\/([^/]+)$/);
    if (recebivelMatch && request.method === "GET") {
      const detalhe = await detalheRecebivel(db, decodeURIComponent(recebivelMatch[1]));
      return detalhe ? json(detalhe) : json({ erro: "Parcela não encontrada." }, 404);
    }
    if (recebivelMatch && request.method === "PATCH") {
      const id = decodeURIComponent(recebivelMatch[1]);
      const b = await lerBody(request);
      const { data: boleto } = await db.from("boletos").select("id,cliente_id,status,observacoes").eq("id", id).maybeSingle();
      if (!boleto) return json({ erro: "Parcela não encontrada." }, 404);
      const acao = texto(b.acao);
      if (acao === "observar") {
        const observacao = texto(b.observacao);
        if (!observacao) return json({ erro: "Informe uma observação." }, 400);
        const { error } = await db.from("boletos").update({ observacoes: observacao }).eq("id", id);
        if (error) return json({ erro: error.message }, 500);
        await db.from("logs_alteracoes").insert({ usuario, acao: "adicionou_observacao_financeira", entidade: "boletos", entidade_id: id, detalhes: { cliente_id: boleto.cliente_id, observacao } });
        return json({ sucesso: true });
      }
      const payload: Json = { acao, boletoId: id };
      if (acao === "editar") { payload.valor = b.valor; payload.dataVencimento = b.dataVencimento; }
      else if (acao === "suspender") payload.ids = [id];
      else if (acao === "reabrir" || acao === "excluir") payload.observacoes = b.observacoes;
      else return json({ erro: "Ação inválida." }, 400);
      return await encaminharParcelas(request, env, boleto.cliente_id, payload);
    }

    return json({ erro: "Rota financeira não encontrada." }, 404);
  } catch (error) {
    console.error("Falha no Financeiro Unificado:", error);
    return json({ erro: error instanceof Error ? error.message : "Falha inesperada no módulo financeiro." }, 500);
  }
}
