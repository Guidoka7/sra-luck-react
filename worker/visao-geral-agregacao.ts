import type {
  EtapaJornada,
  EventoAgendaVisaoGeral,
  ItemPendencia,
  MesFinanceiro,
  Pendencia,
  SeveridadePendencia,
  VisaoGeralAdmin,
} from "../src/lib/visaoGeralContrato";
import { etapaCentral, prazoCirurgico } from "./admin-agenda-central";
import { requiredPaid } from "./agenda-elegibilidade";
import { getAppAccessRequirements, type AppAccessOptions } from "./app-access";
import { dinheiro, indiceRecebimentos, realizacaoDaParcela, receitaAdministrativaDoValor, relacao } from "./financeiro-calculos";
import { adicionarDiasUteis } from "./surgery-release";

/**
 * Visão geral do Admin — agregação pura (sem banco, sem relógio).
 * Recebe as linhas já carregadas por `admin-visao-geral.ts` e devolve o
 * contrato `VisaoGeralAdmin`. Regras reaproveitadas, nunca reimplementadas:
 * etapa V46 e prazo cirúrgico (admin-agenda-central), mínimo de parcelas
 * (agenda-elegibilidade), requisitos do app (app-access) e receita
 * administrativa (financeiro-calculos).
 */

/** BUSINESS-RULES §11 Etapa C: levantamento financeiro em até 5 dias úteis. */
export const PRAZO_LEVANTAMENTO_DIAS_UTEIS = 5;
const LIMITE_ITENS = 6;
const LIMITE_AGENDA = 40;
const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export interface ClienteLinha {
  id: string;
  nome_completo: string | null;
  cpf: string | null;
  data_nascimento: string | null;
  procedimento: string | null;
  acesso_app_liberado: boolean | null;
  status_contrato: string | null;
  valor_contrato: number | string | null;
  custo_total: number | string | null;
  taxa_administrativa_percentual: number | string | null;
  quantidade_parcelas: number | null;
  liberacao_financeira_solicitada_em: string | null;
  ativo: boolean | null;
  created_at: string | null;
}

export interface BoletoLinha {
  id: string;
  cliente_id: string;
  numero_parcela: number | null;
  total_parcelas: number | null;
  valor: number | string | null;
  status: string;
  data_vencimento: string | null;
  data_pagamento: string | null;
  suspensa: boolean | null;
  updated_at: string | null;
}

export interface RecebimentoLinha {
  boleto_id: string;
  status_validacao: string | null;
  data_pagamento: string | null;
  valor_recebido: number | string | null;
  created_at: string | null;
}

export interface AgendamentoLinha {
  id: string;
  cliente_id: string;
  status: string;
  horario_termos: string | null;
  termos_assinados_em: string | null;
  comparecimento_status: string | null;
  comparecimento_em: string | null;
  quitacao_status: string | null;
  quitacao_em: string | null;
  agenda_cirurgica_liberada_em: string | null;
  agenda_cirurgica_prazo_ajuste_dias: number | null;
  data_cirurgia: string | null;
  horario_cirurgia: string | null;
  processo_concluido_em: string | null;
  created_at: string | null;
  datas: { data: string | null } | { data: string | null }[] | null;
}

export interface VendaAguardandoLinha {
  id: string;
  nome_completo: string | null;
  data_venda: string | null;
  created_at: string | null;
}

export interface DadosVisaoGeral {
  agora: Date;
  hoje: string;
  ano: number;
  mes: number;
  clientes: ClienteLinha[];
  boletos: BoletoLinha[];
  recebimentos: RecebimentoLinha[];
  agendamentos: AgendamentoLinha[];
  vendasAguardando: { itens: VendaAguardandoLinha[]; total: number };
  app: VisaoGeralAdmin["app"];
  avisos: string[];
  opcoesAcessoApp?: AppAccessOptions;
}

// ---------------------------------------------------------------------------
// Datas civis (AAAA-MM-DD) e formatação pt-BR.
// ---------------------------------------------------------------------------
function ordinal(iso: string) {
  const [a, m, d] = iso.split("-").map(Number);
  return Date.UTC(a, m - 1, d) / 86_400_000;
}
export function diasEntre(de: string, ate: string) {
  return Math.round(ordinal(ate) - ordinal(de));
}
function somarDias(iso: string, dias: number) {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}
function chaveMes(ano: number, mes: number, deslocamento: number) {
  const base = new Date(Date.UTC(ano, mes - 1 + deslocamento, 1));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}`;
}
/** Data civil em São Paulo de um timestamp; datas puras passam direto. */
function dataCivil(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const texto = String(valor);
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const data = new Date(texto);
  if (Number.isNaN(data.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(data);
}
function ddmm(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}
function moeda(valor: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}
function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}
function haDias(dias: number) {
  if (dias <= 0) return "hoje";
  if (dias === 1) return "há 1 dia";
  return `há ${dias} dias`;
}
function atraso(dias: number) {
  return dias === 1 ? "1 dia em atraso" : `${dias} dias em atraso`;
}

function statusContrato(value: unknown) {
  const status = String(value ?? "ativo");
  return ["ativo", "suspenso", "negativado", "cancelado"].includes(status) ? status : "ativo";
}
/** Carteira operacional: cadastro ativo e contrato não cancelado (arquivadas ficam fora). */
function naCarteira(c: ClienteLinha) {
  return c.ativo !== false && statusContrato(c.status_contrato) !== "cancelado";
}
/** Parcela em aberto que pode vencer: não paga, sem comprovante em conferência e não suspensa. */
function cobravel(b: BoletoLinha) {
  return (b.status === "nao_pago" || b.status === "rejeitado") && !b.suspensa;
}

const ORDEM_SEVERIDADE: Record<SeveridadePendencia, number> = { critica: 0, atencao: 1, info: 2, ok: 3 };

function pendencia(p: Omit<Pendencia, "severidade" | "itens"> & { itens: ItemPendencia[]; severidade?: SeveridadePendencia; seHouver?: SeveridadePendencia }): Pendencia {
  const severidade = p.total === 0 ? "ok" : p.severidade ?? p.seHouver ?? "atencao";
  const { seHouver: _ignorar, ...resto } = p;
  return { ...resto, severidade, itens: p.itens.slice(0, LIMITE_ITENS) };
}

export function montarVisaoGeral(d: DadosVisaoGeral): VisaoGeralAdmin {
  const { hoje, ano, mes } = d;
  const inicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const fimExclusivo = `${chaveMes(ano, mes, 1)}-01`;
  const noMes = (iso: string | null | undefined) => Boolean(iso && iso >= inicio && iso < fimExclusivo);
  const diaSemana = new Date(`${hoje}T12:00:00.000Z`).getUTCDay();
  const inicioSemana = somarDias(hoje, -((diaSemana + 6) % 7));
  const fim7 = somarDias(hoje, 7);
  const fim30 = somarDias(hoje, 30);

  const clientePorId = new Map(d.clientes.map((c) => [c.id, c]));
  const nomeDe = (id: string | null | undefined) => clientePorId.get(String(id ?? ""))?.nome_completo?.trim() || "Cliente";
  const recebimentoPorBoleto = indiceRecebimentos(d.recebimentos);

  // -------------------------------------------------------------------------
  // Parcelas por cliente (total/pagas) — base da etapa V46 e do acesso ao app.
  // -------------------------------------------------------------------------
  const parcelasPorCliente = new Map<string, { total: number; pagas: number }>();
  for (const b of d.boletos) {
    const atual = parcelasPorCliente.get(b.cliente_id) ?? { total: 0, pagas: 0 };
    atual.total += 1;
    if (b.status === "pago") atual.pagas += 1;
    parcelasPorCliente.set(b.cliente_id, atual);
  }

  // -------------------------------------------------------------------------
  // Financeiro
  // -------------------------------------------------------------------------
  const serieChaves = Array.from({ length: 6 }, (_, i) => chaveMes(ano, mes, i - 4));
  const serie = new Map<string, MesFinanceiro>(serieChaves.map((chave) => {
    const [a, m] = chave.split("-").map(Number);
    return [chave, { mes: chave, rotulo: `${MESES_CURTOS[m - 1]}/${String(a).slice(-2)}`, previsto: 0, recebido: 0, vencido: 0, futuro: chave > hoje.slice(0, 7) }];
  }));

  let recebidoMes = 0; let parcelasRecebidasMes = 0; let receitaRealizada = 0; let receitaPrevista = 0;
  const vencimentosMes = { parcelas: 0, quitadas: 0, valor: 0, valorQuitado: 0 };
  let recebidoSemana = 0; let parcelasSemana = 0;
  const atrasoTotais = { valor: 0, parcelas: 0 };
  let parcelasJaVencidas = 0; // denominador: parcelas da carteira com vencimento anterior a hoje
  const aVencer7 = { valor: 0, parcelas: 0 };
  const aVencer30 = { valor: 0, parcelas: 0 };
  const conferencia = { valor: 0, parcelas: 0 };
  const conferenciaItens: { boleto: BoletoLinha; desde: string | null }[] = [];
  const atrasoPorCliente = new Map<string, { parcelas: number; valor: number; maisAntiga: string }>();

  for (const b of d.boletos) {
    const cliente = clientePorId.get(b.cliente_id);
    const valor = dinheiro(b.valor);
    const vencimento = b.data_vencimento ? String(b.data_vencimento).slice(0, 10) : null;
    const realizado = realizacaoDaParcela(b, recebimentoPorBoleto.get(b.id));

    if (realizado.data && realizado.valor > 0) {
      const chave = realizado.data.slice(0, 7);
      const ponto = serie.get(chave);
      if (ponto) ponto.recebido += realizado.valor;
      if (noMes(realizado.data)) {
        recebidoMes += realizado.valor;
        parcelasRecebidasMes += 1;
        receitaRealizada += receitaAdministrativaDoValor(cliente, realizado.valor);
      }
      if (realizado.data >= inicioSemana && realizado.data <= hoje) {
        recebidoSemana += realizado.valor;
        parcelasSemana += 1;
      }
    }

    if (vencimento) {
      const ponto = serie.get(vencimento.slice(0, 7));
      if (ponto) {
        ponto.previsto += valor;
        if (cobravel(b) && vencimento < hoje) ponto.vencido += valor;
      }
      if (noMes(vencimento)) {
        vencimentosMes.parcelas += 1;
        vencimentosMes.valor += valor;
        if (b.status === "pago") { vencimentosMes.quitadas += 1; vencimentosMes.valorQuitado += valor; }
        else receitaPrevista += receitaAdministrativaDoValor(cliente, valor);
      }
    }

    if (b.status === "pendente_confirmacao") {
      conferencia.valor += valor;
      conferencia.parcelas += 1;
      conferenciaItens.push({ boleto: b, desde: dataCivil(b.updated_at) });
    }

    if (!cliente || !naCarteira(cliente) || b.suspensa || !vencimento) continue;
    if (vencimento < hoje && b.status !== "pendente_confirmacao") parcelasJaVencidas += 1;
    if (cobravel(b) && vencimento < hoje) {
      atrasoTotais.valor += valor;
      atrasoTotais.parcelas += 1;
      const atual = atrasoPorCliente.get(b.cliente_id) ?? { parcelas: 0, valor: 0, maisAntiga: vencimento };
      atual.parcelas += 1;
      atual.valor += valor;
      if (vencimento < atual.maisAntiga) atual.maisAntiga = vencimento;
      atrasoPorCliente.set(b.cliente_id, atual);
    }
    if (cobravel(b) && vencimento >= hoje && vencimento < fim30) {
      aVencer30.valor += valor; aVencer30.parcelas += 1;
      if (vencimento < fim7) { aVencer7.valor += valor; aVencer7.parcelas += 1; }
    }
  }

  // -------------------------------------------------------------------------
  // Carteira
  // -------------------------------------------------------------------------
  const carteira = { ativas: 0, suspensas: 0, negativadas: 0, canceladas: 0, creditoContratadoAtivo: 0, ticketMedio: 0, novasNoMes: 0 };
  for (const c of d.clientes) {
    const status = statusContrato(c.status_contrato);
    if (c.ativo === false || status === "cancelado") { carteira.canceladas += 1; continue; }
    if (status === "ativo") { carteira.ativas += 1; carteira.creditoContratadoAtivo += dinheiro(c.valor_contrato); }
    else if (status === "suspenso") carteira.suspensas += 1;
    else carteira.negativadas += 1;
    if (noMes(dataCivil(c.created_at))) carteira.novasNoMes += 1;
  }
  carteira.creditoContratadoAtivo = dinheiro(carteira.creditoContratadoAtivo);
  carteira.ticketMedio = carteira.ativas > 0 ? dinheiro(carteira.creditoContratadoAtivo / carteira.ativas) : 0;

  // -------------------------------------------------------------------------
  // Jornada V46 (mesma etapa da Central) + agenda.
  // -------------------------------------------------------------------------
  const agendamentoAtual = new Map<string, AgendamentoLinha>();
  for (const a of [...d.agendamentos].sort((x, y) => String(y.created_at ?? "").localeCompare(String(x.created_at ?? "")))) {
    if (!agendamentoAtual.has(a.cliente_id)) agendamentoAtual.set(a.cliente_id, a);
  }
  const dataTermosDe = (a: AgendamentoLinha | undefined) => (a ? relacao(a.datas)?.data?.slice(0, 10) ?? null : null);

  const contagemEtapas: Record<EtapaJornada, number> = { preEligibility: 0, financialReview: 0, termsConfirmed: 0, financialRelease: 0, surgeryConfirmed: 0 };
  let elegiveisSemSolicitacao = 0;
  const elegiveisItens: ItemPendencia[] = [];
  const levantamentos: (ItemPendencia & { ordem: string })[] = [];
  let levantamentosVencidos = 0;
  const registroTermos: (ItemPendencia & { ordem: string })[] = [];
  const liberacoes: (ItemPendencia & { ordem: string })[] = [];
  let liberacoesVencidas = 0;
  const acessoApp: ItemPendencia[] = [];
  const opcoesApp = d.opcoesAcessoApp ?? {};

  for (const c of d.clientes) {
    if (c.ativo !== true) continue; // a Central considera apenas cadastros ativos
    const nome = c.nome_completo?.trim() || "Cliente";
    const agendamento = agendamentoAtual.get(c.id);
    const dataTermos = dataTermosDe(agendamento);
    const parcelas = parcelasPorCliente.get(c.id) ?? { total: 0, pagas: 0 };
    const totalParcelas = parcelas.total || c.quantidade_parcelas || 0;

    if (naCarteira(c) && !c.acesso_app_liberado) {
      const requisitos = getAppAccessRequirements({ name: c.nome_completo, cpf: c.cpf, birthDate: c.data_nascimento, installmentCount: totalParcelas, procedure: c.procedimento }, hoje, opcoesApp);
      if (requisitos.canRelease) acessoApp.push({ id: `app:${c.id}`, clienteId: c.id, nome, detalhe: "Cadastro completo, acesso ainda não liberado", meta: totalParcelas ? plural(totalParcelas, "parcela", "parcelas") : null, atrasado: false });
    }

    const etapa = etapaCentral({
      processoConcluidoEm: agendamento?.processo_concluido_em,
      dataCirurgia: agendamento?.data_cirurgia,
      dataTermos,
      liberacaoFinanceiraSolicitadaEm: c.liberacao_financeira_solicitada_em,
    }, hoje);
    if (etapa === "concluido") continue;
    contagemEtapas[etapa] += 1;

    if (etapa === "preEligibility") {
      const minimo = requiredPaid(totalParcelas || 12);
      if (parcelas.total > 0 && parcelas.pagas >= minimo) {
        elegiveisSemSolicitacao += 1;
        elegiveisItens.push({ id: `eleg:${c.id}`, clienteId: c.id, nome, detalhe: `${parcelas.pagas}/${parcelas.total} parcelas pagas · mínimo ${minimo}`, meta: "Pode solicitar os termos", atrasado: false });
      }
    } else if (etapa === "financialReview") {
      const solicitada = dataCivil(c.liberacao_financeira_solicitada_em) ?? hoje;
      const prazo = adicionarDiasUteis(solicitada, PRAZO_LEVANTAMENTO_DIAS_UTEIS);
      const vencido = prazo < hoje;
      if (vencido) levantamentosVencidos += 1;
      levantamentos.push({
        id: `lev:${c.id}`, clienteId: c.id, nome,
        detalhe: `Solicitado em ${ddmm(solicitada)} · ${parcelas.pagas}/${totalParcelas || "?"} parcelas pagas`,
        meta: vencido ? `prazo ${ddmm(prazo)} · ${atraso(diasEntre(prazo, hoje))}` : `prazo ${ddmm(prazo)}`,
        atrasado: vencido, ordem: prazo,
      });
    } else if (etapa === "financialRelease" && agendamento && dataTermos) {
      const faltaComparecimento = (agendamento.comparecimento_status ?? "pendente") === "pendente";
      const faltaQuitacao = (agendamento.quitacao_status ?? "pendente") === "pendente";
      if (dataTermos < hoje && (faltaComparecimento || faltaQuitacao)) {
        const faltas = [faltaComparecimento ? "comparecimento" : null, faltaQuitacao ? "quitação" : null].filter(Boolean).join(" e ");
        registroTermos.push({ id: `reg:${c.id}`, clienteId: c.id, nome, detalhe: `Termos em ${ddmm(dataTermos)} · falta registrar ${faltas}`, meta: haDias(diasEntre(dataTermos, hoje)), atrasado: false, ordem: dataTermos });
      }
      const prazo = prazoCirurgico(agendamento.comparecimento_em, agendamento.quitacao_em, agendamento.agenda_cirurgica_prazo_ajuste_dias ?? 0);
      if (prazo && !agendamento.agenda_cirurgica_liberada_em && prazo < fim7) {
        const vencido = prazo < hoje;
        if (vencido) liberacoesVencidas += 1;
        liberacoes.push({
          id: `lib:${c.id}`, clienteId: c.id, nome,
          detalhe: `Termos em ${ddmm(dataTermos)} · comparecimento e quitação registrados`,
          meta: vencido ? `prazo ${ddmm(prazo)} · ${atraso(diasEntre(prazo, hoje))}` : prazo === hoje ? "libera hoje" : `libera em ${ddmm(prazo)}`,
          atrasado: vencido, ordem: prazo,
        });
      }
    }
  }

  const eventos: EventoAgendaVisaoGeral[] = [];
  const agendaMes = { termos: 0, cirurgias: 0 };
  let concluidasNoMes = 0;
  for (const a of d.agendamentos) {
    if (noMes(dataCivil(a.processo_concluido_em))) concluidasNoMes += 1;
    const dataTermos = dataTermosDe(a);
    if (dataTermos) {
      if (noMes(dataTermos)) agendaMes.termos += 1;
      if (dataTermos >= hoje && dataTermos < fim7) eventos.push({ id: `termos:${a.id}`, agendamentoId: a.id, clienteId: a.cliente_id, nome: nomeDe(a.cliente_id), data: dataTermos, horario: a.horario_termos ? String(a.horario_termos).slice(0, 5) : null, tipo: "termos", status: a.termos_assinados_em ? "assinado" : "a_assinar" });
    }
    const dataCirurgia = a.data_cirurgia ? String(a.data_cirurgia).slice(0, 10) : null;
    if (dataCirurgia) {
      if (noMes(dataCirurgia)) agendaMes.cirurgias += 1;
      if (dataCirurgia >= hoje && dataCirurgia < fim7) eventos.push({ id: `cirurgia:${a.id}`, agendamentoId: a.id, clienteId: a.cliente_id, nome: nomeDe(a.cliente_id), data: dataCirurgia, horario: a.horario_cirurgia ? String(a.horario_cirurgia).slice(0, 5) : null, tipo: "cirurgia", status: a.status === "realizado" || a.processo_concluido_em ? "realizada" : "confirmada" });
    }
  }
  eventos.sort((x, y) => `${x.data} ${x.horario ?? "99:99"} ${x.nome}`.localeCompare(`${y.data} ${y.horario ?? "99:99"} ${y.nome}`));

  // -------------------------------------------------------------------------
  // Fila de trabalho
  // -------------------------------------------------------------------------
  const porOrdem = <T extends { ordem: string }>(lista: T[]) => lista.sort((x, y) => x.ordem.localeCompare(y.ordem)).map(({ ordem: _o, ...item }) => item);

  conferenciaItens.sort((x, y) => String(x.desde ?? "9999").localeCompare(String(y.desde ?? "9999")));
  const maisAntigaConferencia = conferenciaItens[0]?.desde ?? null;

  const inadimplentes = [...atrasoPorCliente.entries()].sort(([, x], [, y]) => x.maisAntiga.localeCompare(y.maisAntiga));

  const clientesComParcela = new Set(d.boletos.map((b) => b.cliente_id));
  const semParcelas = d.clientes.filter((c) => naCarteira(c) && !clientesComParcela.has(c.id));
  const cadastrosItens: ItemPendencia[] = [
    ...d.vendasAguardando.itens.map((v) => {
      const data = dataCivil(v.data_venda) ?? dataCivil(v.created_at);
      return { id: `venda:${v.id}`, clienteId: null, nome: v.nome_completo?.trim() || "Venda sem nome", detalhe: "Venda recebida do CRM, cadastro não criado", meta: data ? `venda em ${ddmm(data)}` : null, atrasado: false };
    }),
    ...semParcelas.map((c) => ({ id: `semparc:${c.id}`, clienteId: c.id, nome: c.nome_completo?.trim() || "Cliente", detalhe: "Cadastro sem parcelas geradas", meta: null, atrasado: false })),
  ];

  const pendencias: Pendencia[] = [
    pendencia({
      id: "liberacoes_cirurgicas", area: "agenda",
      titulo: liberacoesVencidas > 0 ? "Liberações cirúrgicas com prazo vencido" : "Liberações cirúrgicas da semana",
      descricao: liberacoesVencidas > 0
        ? `${plural(liberacoesVencidas, "agenda deveria", "agendas deveriam")} ter sido liberada${liberacoesVencidas === 1 ? "" : "s"} automaticamente. Confira na Central.`
        : "Agendas cirúrgicas que atingem o prazo de liberação nos próximos 7 dias.",
      total: liberacoes.length, valor: null,
      severidade: liberacoesVencidas > 0 ? "critica" : "info",
      itens: porOrdem(liberacoes),
    }),
    pendencia({
      id: "levantamentos", area: "agenda",
      titulo: "Levantamentos financeiros solicitados",
      descricao: levantamentosVencidos > 0
        ? `${plural(levantamentosVencidos, "levantamento passou", "levantamentos passaram")} do prazo de ${PRAZO_LEVANTAMENTO_DIAS_UTEIS} dias úteis.`
        : `Clientes que solicitaram os termos. Prazo de resposta: ${PRAZO_LEVANTAMENTO_DIAS_UTEIS} dias úteis.`,
      total: levantamentos.length, valor: null,
      severidade: levantamentosVencidos > 0 ? "critica" : "atencao",
      itens: porOrdem(levantamentos),
    }),
    pendencia({
      id: "registro_termos", area: "agenda",
      titulo: "Termos sem registro de comparecimento ou quitação",
      descricao: "A data dos termos já passou; o prazo da agenda cirúrgica só começa após os dois registros.",
      total: registroTermos.length, valor: null,
      itens: porOrdem(registroTermos),
    }),
    pendencia({
      id: "comprovantes", area: "financeiro_validacao",
      titulo: "Comprovantes para conferir",
      descricao: maisAntigaConferencia ? `Mais antigo na fila ${haDias(diasEntre(maisAntigaConferencia, hoje))}.` : "Pagamentos enviados pelas clientes aguardando validação.",
      total: conferencia.parcelas, valor: dinheiro(conferencia.valor),
      itens: conferenciaItens.map(({ boleto: b, desde }) => ({
        id: `comp:${b.id}`, clienteId: b.cliente_id, nome: nomeDe(b.cliente_id),
        detalhe: `Parcela ${b.numero_parcela ?? "?"}/${b.total_parcelas ?? "?"} · ${moeda(dinheiro(b.valor))}`,
        meta: desde ? `na fila ${haDias(diasEntre(desde, hoje))}` : null, atrasado: false,
      })),
    }),
    pendencia({
      id: "inadimplencia", area: "financeiro",
      titulo: "Clientes com parcelas vencidas",
      descricao: `${plural(atrasoTotais.parcelas, "parcela vencida", "parcelas vencidas")} na carteira ativa, sem comprovante em conferência.`,
      total: inadimplentes.length, valor: dinheiro(atrasoTotais.valor),
      itens: inadimplentes.map(([clienteId, info]) => ({
        id: `inad:${clienteId}`, clienteId, nome: nomeDe(clienteId),
        detalhe: `${plural(info.parcelas, "parcela", "parcelas")} · ${moeda(dinheiro(info.valor))}`,
        meta: `vencida desde ${ddmm(info.maisAntiga)} · ${atraso(diasEntre(info.maisAntiga, hoje))}`, atrasado: true,
      })),
    }),
    pendencia({
      id: "cadastros", area: "clientes",
      titulo: "Cadastros para concluir",
      descricao: `${plural(d.vendasAguardando.total, "venda aguardando", "vendas aguardando")} cadastro · ${plural(semParcelas.length, "cliente", "clientes")} sem parcelas geradas.`,
      total: d.vendasAguardando.total + semParcelas.length, valor: null,
      itens: cadastrosItens,
    }),
    pendencia({
      id: "acesso_app", area: "clientes",
      titulo: "Acessos ao app prontos para liberar",
      descricao: "Cadastro atende aos requisitos de acesso, mas o app ainda não foi liberado.",
      total: acessoApp.length, valor: null,
      itens: acessoApp,
    }),
    pendencia({
      id: "elegiveis", area: "agenda",
      titulo: "Elegíveis sem solicitação dos termos",
      descricao: "Atingiram o mínimo de parcelas pagas e ainda não solicitaram os termos no app.",
      total: elegiveisSemSolicitacao, valor: null, seHouver: "info",
      itens: elegiveisItens,
    }),
  ];
  pendencias.sort((x, y) => ORDEM_SEVERIDADE[x.severidade] - ORDEM_SEVERIDADE[y.severidade]);

  const ROTULOS: Record<EtapaJornada, string> = {
    preEligibility: "Pagando parcelas",
    financialReview: "Levantamento financeiro",
    termsConfirmed: "Termos agendados",
    financialRelease: "Liberação cirúrgica",
    surgeryConfirmed: "Cirurgia agendada",
  };

  return {
    versao: 2,
    geradoEm: d.agora.toISOString(),
    hoje,
    periodo: { ano, mes, inicio, fimExclusivo, rotulo: `${MESES_LONGOS[mes - 1]} de ${ano}` },
    pendencias,
    financeiro: {
      mes: {
        recebido: dinheiro(recebidoMes),
        parcelasRecebidas: parcelasRecebidasMes,
        receitaAdministrativaRealizada: dinheiro(receitaRealizada),
        receitaAdministrativaPrevista: dinheiro(receitaPrevista),
        vencimentos: { ...vencimentosMes, valor: dinheiro(vencimentosMes.valor), valorQuitado: dinheiro(vencimentosMes.valorQuitado) },
      },
      semana: { inicio: inicioSemana, recebido: dinheiro(recebidoSemana), parcelas: parcelasSemana },
      atraso: {
        valor: dinheiro(atrasoTotais.valor),
        parcelas: atrasoTotais.parcelas,
        clientes: atrasoPorCliente.size,
        percentualParcelas: parcelasJaVencidas > 0 ? Math.round((atrasoTotais.parcelas / parcelasJaVencidas) * 1000) / 10 : 0,
      },
      aVencer7: { valor: dinheiro(aVencer7.valor), parcelas: aVencer7.parcelas },
      aVencer30: { valor: dinheiro(aVencer30.valor), parcelas: aVencer30.parcelas },
      conferencia: { valor: dinheiro(conferencia.valor), parcelas: conferencia.parcelas },
      serie: [...serie.values()].map((p) => ({ ...p, previsto: dinheiro(p.previsto), recebido: dinheiro(p.recebido), vencido: dinheiro(p.vencido) })),
    },
    carteira,
    jornada: {
      etapas: (Object.keys(ROTULOS) as EtapaJornada[]).map((id) => ({ id, rotulo: ROTULOS[id], total: contagemEtapas[id] })),
      elegiveisSemSolicitacao,
      concluidasNoMes,
    },
    agenda: {
      hoje: eventos.filter((e) => e.data === hoje),
      proximos: eventos.slice(0, LIMITE_AGENDA),
      mes: agendaMes,
    },
    app: d.app,
    avisos: d.avisos,
  };
}
