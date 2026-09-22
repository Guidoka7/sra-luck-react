import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { CirurgiaConfirmada } from "@/components/cliente/CirurgiaConfirmada";
import { Card } from "@/components/ui/Card";
import { CalendarioAgendamento, type DataDisponivel } from "@/components/cliente/CalendarioAgendamento";
import { AgendaBloqueadaPercentual } from "@/components/cliente/AgendaBloqueadaPercentual";
import { SolicitarLiberacaoFinanceira } from "@/components/cliente/SolicitarLiberacaoFinanceira";
import { EscolherFormaPagamento } from "@/components/cliente/EscolherFormaPagamento";
import { AvisoRevisaoFinanceira } from "@/components/cliente/AvisoRevisaoFinanceira";
import { etapaAgenda, passoDaTrilha, PRAZO_MAXIMO_LIBERACAO_CIRURGICA_DIAS, statusAgenda, termosJaAssinados, TRILHA_AGENDA, type EtapaAgenda } from "@/components/cliente/agenda/agendaEtapa";
import type { AgendaData, FormaCusteio, StatusRevisaoFinanceira } from "@/lib/clienteAgenda";
import { percentualNecessario } from "@/lib/utils";

type Agendamento = { id: string; data: string; horario: string | null; dataCirurgia: string | null; termosAssinadosEm?: string | null } | null;

interface AgendaTabProps {
  agendamentoAtivo: Agendamento;
  agendamentoConcluido: Agendamento;
  datasDisponiveis: DataDisponivel[];
  quantidadeParcelas: number | null;
  parcelasPagas: number;
  podeAgendar: boolean;
  agendaLiberada: boolean;
  statusRevisaoFinanceira: StatusRevisaoFinanceira;
  observacaoRevisaoFinanceira?: string | null;
  /** Fonte de verdade real da solicitação (clientes.liberacao_financeira_
   * solicitada_em) — NUNCA derivado de statusRevisaoFinanceira ou
   * financeiro_confirmado_em, que são conceitos diferentes (julgamento do
   * admin sobre o levantamento, não o clique da cliente). */
  liberacaoFinanceiraSolicitada: boolean;
  custeioAprovado: boolean;
  confirmando: boolean;
  onEscolherData: (dataId: string, horario: string) => void;
  onCusteioSelecionado?: () => void | Promise<void>;
  onAgendaAtualizada?: () => void | Promise<void>;
  /** Chamado depois que a cliente solicita a liberação financeira, para
   * recarregar os dados reais (liberacaoFinanceiraSolicitada vem do backend
   * no próximo GET, nunca é setado localmente). */
  onLiberacaoSolicitada?: () => void | Promise<void>;
  /** Resposta completa de /api/cliente/agenda já em memória: os blocos do
   * fluxo renderizam na hora, sem consultas próprias. */
  snapshot?: AgendaData | null;
  parcelasNaoPagas?: number | null;
  onIrFinanceiro?: () => void;
  onFalarEquipe?: () => void;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

function brDate(value: string | null | undefined) {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
}

function moeda(valor: number) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function rotuloForma(forma: FormaCusteio) {
  if (forma === "cartao") return "Cartão de crédito";
  if (forma === "pix") return "PIX";
  if (forma === "cheques") return "Cheques";
  return "100% boleto";
}

function dataLocal(iso: string) {
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  return new Date(ano, mes - 1, dia);
}

function diasAte(iso: string) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((dataLocal(iso).getTime() - hoje.getTime()) / 86_400_000);
}

type Tom = "rosa" | "ambar" | "verde" | "alerta";

const TONS: Record<Tom, { fundo: string; borda: string; destaque: string; icone: string; iconeFundo: string }> = {
  rosa: { fundo: "linear-gradient(135deg,#FFFFFF 0%,#FFF7F6 60%,#F9ECEA 100%)", borda: "#E9D3CF", destaque: "#7D2434", icone: "#A84759", iconeFundo: "#F9ECEF" },
  ambar: { fundo: "linear-gradient(135deg,#FFFFFF 0%,#FFFBF3 60%,#FBF1DD 100%)", borda: "#EBDAB2", destaque: "#7A5A1C", icone: "#A77A24", iconeFundo: "#FBF1DD" },
  verde: { fundo: "linear-gradient(135deg,#FFFFFF 0%,#F6FBF7 60%,#E8F3EB 100%)", borda: "#D3E6D8", destaque: "#315F47", icone: "#3F7D5B", iconeFundo: "#E3F1E6" },
  alerta: { fundo: "linear-gradient(135deg,#FFFFFF 0%,#FFF8F7 60%,#FBEBEA 100%)", borda: "#F0D3D1", destaque: "#8F2A25", icone: "#B3342E", iconeFundo: "#FBEBEA" },
};

function Icone({ etapa }: { etapa: EtapaAgenda }) {
  const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (etapa === "percentual") return <svg {...base}><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18M7 15h4" /></svg>;
  if (etapa === "elegivel") return <svg {...base}><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" /></svg>;
  if (etapa === "levantamento" || etapa === "custeio_analise") return <svg {...base}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
  if (etapa === "ajuste") return <svg {...base}><path d="M12 3.5 21 19H3z" /><path d="M12 10v4M12 16.8h.01" /></svg>;
  if (etapa === "pagamento") return <svg {...base}><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18" /><path d="M15.5 15h2" /></svg>;
  if (etapa === "cirurgia") return <svg {...base}><path d="M12 20.5s-7.5-4.4-7.5-10.1A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.8c0 5.7-7.5 10.1-7.5 10.1Z" /></svg>;
  return <svg {...base}><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 11h16" /></svg>;
}

/** Trilha horizontal com os cinco grandes passos até a cirurgia. */
function TrilhaAgenda({ passo }: { passo: number }) {
  const total = TRILHA_AGENDA.length;
  const progresso = Math.min(100, (passo / (total - 1)) * 100);
  return (
    <div className="mx-5 mt-4 rounded-[18px] border border-[#EFE2DE] bg-white px-3 pb-3 pt-[14px] shadow-[0_5px_16px_rgba(46,36,34,.04)]" aria-label={passo >= total ? "Todas as etapas concluídas" : `Passo ${passo + 1} de ${total}: ${TRILHA_AGENDA[passo]}`}>
      <div className="relative">
        <div className="absolute left-[10%] right-[10%] top-[13px] h-[2px] rounded-full bg-[#F0E4E1]" aria-hidden="true">
          <motion.div className="h-full rounded-full bg-[#4F8A65]" initial={false} animate={{ width: `${progresso}%` }} transition={{ duration: 0.5, ease: "easeOut" }} />
        </div>
        <ol className="relative m-0 grid list-none grid-cols-5 p-0">
          {TRILHA_AGENDA.map((nome, i) => {
            const feito = i < passo;
            const atual = i === passo;
            return (
              <li key={nome} className="flex flex-col items-center gap-[6px]">
                <span
                  className={`relative flex h-[28px] w-[28px] items-center justify-center rounded-full text-[11px] font-semibold ${feito ? "bg-[#3F7D5B] text-white shadow-[0_3px_8px_rgba(63,125,91,.22)]" : atual ? "border-[1.5px] border-[#6B1F2E] bg-white text-[#6B1F2E] shadow-[0_0_0_4px_rgba(182,91,103,.14)]" : "border border-[#E6D8D4] bg-[#FBF7F5] text-[#B6A6A2]"}`}
                >
                  {feito ? <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.5 7.2 2.3 2.2 4.7-4.8" /></svg> : i + 1}
                </span>
                <span className={`text-center text-[9.5px] leading-tight ${atual ? "font-semibold text-[#6B1F2E]" : feito ? "font-medium text-[#3F7D5B]" : "font-light text-[#A99894]"}`}>{nome}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function CartaoEtapa({ tom, etapa, rotulo, titulo, texto, children }: { tom: Tom; etapa: EtapaAgenda; rotulo: string; titulo: string; texto: string; children?: ReactNode }) {
  const t = TONS[tom];
  return (
    <motion.section
      key={etapa}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      aria-label={`Agora: ${titulo}`}
      className="mx-5 mt-3 rounded-[20px] border p-4 shadow-[0_10px_26px_rgba(70,42,44,.07)]"
      style={{ background: t.fundo, borderColor: t.borda }}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[14px]" style={{ background: t.iconeFundo, color: t.icone }}><Icone etapa={etapa} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[9.5px] font-bold uppercase tracking-[.14em]" style={{ color: t.icone }}>{rotulo}</div>
          <div className="pt-[3px] font-heading text-[22px] font-semibold leading-[1.1]" style={{ color: t.destaque }}>{titulo}</div>
          <p className="m-0 pt-[5px] text-[12px] font-light leading-[1.5] text-[#6F605C]">{texto}</p>
        </div>
      </div>
      {children}
    </motion.section>
  );
}

function BotaoEtapa({ onClick, children, variante = "cheio" }: { onClick: () => void; children: ReactNode; variante?: "cheio" | "leve" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mt-[14px] w-full rounded-[13px] px-4 py-[12px] text-[12px] font-semibold transition active:scale-[.99] ${variante === "cheio" ? "bg-[#6B1F2E] text-white shadow-[0_8px_18px_rgba(107,31,46,.2)]" : "border border-[#E6D3CF] bg-white text-[#7D2434]"}`}
    >
      {children}
    </button>
  );
}

function DataDestaque({ iso, horario, rotulo }: { iso: string; horario?: string | null; rotulo: string }) {
  const d = dataLocal(iso);
  return (
    <div className="mt-[14px] flex items-center gap-3 rounded-[15px] border border-[#E7DCD8] bg-white/85 px-[14px] py-3">
      <div className="flex h-[52px] w-[48px] flex-none flex-col items-center justify-center rounded-[12px] bg-[#6B1F2E] text-white">
        <span className="text-[9px] font-semibold uppercase tracking-[.08em] opacity-80">{MESES[d.getMonth()].slice(0, 3)}</span>
        <span className="font-heading text-[22px] font-semibold leading-none">{d.getDate()}</span>
      </div>
      <div className="min-w-0">
        <div className="text-[9.5px] font-semibold uppercase tracking-[.1em] text-[#A9837C]">{rotulo}</div>
        <div className="pt-[2px] text-[13px] font-semibold text-[#43322F]">{DIAS_SEMANA[d.getDay()].replace(/^./, (c) => c.toUpperCase())}{horario ? ` · ${horario}` : ""}</div>
      </div>
    </div>
  );
}

export function AgendaTab({
  agendamentoAtivo,
  agendamentoConcluido,
  datasDisponiveis,
  quantidadeParcelas,
  parcelasPagas,
  podeAgendar,
  agendaLiberada,
  statusRevisaoFinanceira,
  observacaoRevisaoFinanceira,
  liberacaoFinanceiraSolicitada,
  custeioAprovado,
  confirmando,
  onEscolherData,
  onCusteioSelecionado,
  onAgendaAtualizada,
  onLiberacaoSolicitada,
  snapshot = null,
  parcelasNaoPagas = null,
  onIrFinanceiro,
  onFalarEquipe,
}: AgendaTabProps) {
  const [abrirPagamento, setAbrirPagamento] = useState(0);
  const percentualContrato = percentualNecessario(quantidadeParcelas);
  const parcelasNecessarias = quantidadeParcelas ? Math.ceil((quantidadeParcelas * percentualContrato) / 100) : null;
  const estado = { agendamentoAtivo, agendamentoConcluido, podeAgendar, agendaLiberada, statusRevisaoFinanceira, custeioAprovado };
  const status = statusAgenda(estado);
  const etapa = etapaAgenda({ ...estado, liberacaoFinanceiraSolicitada });

  const agendamentoAtual = agendamentoAtivo ?? agendamentoConcluido;
  const termosAssinados = termosJaAssinados(agendamentoAtivo, agendamentoConcluido);
  const assinaturaEm = agendamentoAtual?.termosAssinadosEm ? new Date(agendamentoAtual.termosAssinadosEm) : null;
  const assinaturaValida = assinaturaEm && !Number.isNaN(assinaturaEm.getTime());
  const dataAssinatura = assinaturaValida
    ? assinaturaEm.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : brDate(agendamentoAtual?.data);
  const horaAssinatura = assinaturaValida
    ? assinaturaEm.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })
    : agendamentoAtual?.horario;

  const cirurgiaConfirmada = Boolean(agendamentoAtual?.dataCirurgia);
  const tituloAgenda = cirurgiaConfirmada
    ? "Seu grande dia já tem data!"
    : termosAssinados
      ? "Agenda cirúrgica"
      : agendamentoAtivo
        ? "Assinatura dos termos agendada"
        : "Seu próximo grande passo";

  const copyAgenda = cirurgiaConfirmada
    ? "Sua cirurgia está confirmada. Mais uma conquista no caminho para realizar o seu sonho."
    : termosAssinados
      ? "Acompanhe a liberação da agenda para escolher a data da sua cirurgia."
      : agendamentoAtivo
        ? "Você poderá escolher a data da sua cirurgia após a assinatura dos termos e a quitação do saldo restante do contrato."
        : "Acompanhe as quatro etapas até a escolha da data.";

  // ── Cartão "Agora": o que a cliente precisa saber/fazer nesta etapa ──
  const pagas = Math.max(0, Math.floor(parcelasPagas));
  const faltam = parcelasNecessarias != null ? Math.max(0, parcelasNecessarias - pagas) : null;
  const cirurgiaLiberada = Boolean(snapshot?.agendaCirurgicaLiberada);
  const saldoRestante = snapshot?.financeiro?.saldoRestante ?? null;
  const formaCusteio = snapshot?.solicitacaoLiberacaoFinanceira?.forma_custeio ?? null;
  const liberarEm = snapshot?.agendaCirurgicaLiberarEm ?? null;
  const ajuda = onFalarEquipe ? <BotaoEtapa variante="leve" onClick={onFalarEquipe}>Falar com a equipe</BotaoEtapa> : null;

  let cartao: ReactNode;
  switch (etapa) {
    case "percentual":
      cartao = (
        <CartaoEtapa tom="rosa" etapa={etapa} rotulo="Agora · Parcelas" titulo={faltam === 1 ? "Falta só 1 parcela" : faltam ? `Faltam ${faltam} parcelas` : "Continue com suas parcelas"} texto={`Sua agenda é liberada ao confirmar ${percentualContrato}% do contrato${parcelasNecessarias ? ` (${parcelasNecessarias} parcelas)` : ""}. Cada pagamento confirmado aproxima você da data.`}>
          {parcelasNecessarias != null && parcelasNecessarias > 0 && (
            <div className="mt-[14px]">
              <div className="flex items-center justify-between pb-[6px] text-[10.5px]"><span className="font-medium text-[#7A6A66]">{Math.min(pagas, parcelasNecessarias)} de {parcelasNecessarias} confirmadas</span><span className="font-semibold tabular-nums text-[#7D2434]">{Math.round((Math.min(pagas, parcelasNecessarias) / parcelasNecessarias) * 100)}%</span></div>
              <div className="h-[6px] overflow-hidden rounded-full bg-[#F0E4E1]"><motion.div className="h-full rounded-full bg-gradient-to-r from-[#6B1F2E] to-[#B65B67]" initial={false} animate={{ width: `${(Math.min(pagas, parcelasNecessarias) / parcelasNecessarias) * 100}%` }} transition={{ duration: 0.5 }} /></div>
            </div>
          )}
          {onIrFinanceiro && <BotaoEtapa onClick={onIrFinanceiro}>Ver minhas parcelas</BotaoEtapa>}
        </CartaoEtapa>
      );
      break;
    case "elegivel":
      cartao = <CartaoEtapa tom="verde" etapa={etapa} rotulo="Agora · Meta atingida" titulo="Você chegou lá! ✨" texto="Você já confirmou as parcelas necessárias. Solicite a liberação financeira na agenda abaixo para nossa equipe iniciar o levantamento." />;
      break;
    case "levantamento":
      cartao = <CartaoEtapa tom="ambar" etapa={etapa} rotulo="Agora · Em análise" titulo="Levantamento em andamento" texto="Nossa equipe financeira está conferindo o seu contrato. Assim que terminar, você recebe um aviso e a próxima etapa aparece aqui.">{ajuda}</CartaoEtapa>;
      break;
    case "ajuste":
      cartao = <CartaoEtapa tom="alerta" etapa={etapa} rotulo="Agora · Ajuste necessário" titulo="Precisamos de um ajuste" texto="O levantamento financeiro encontrou um ponto a corrigir. Veja a orientação abaixo e, se tiver dúvidas, fale com a equipe.">{ajuda}</CartaoEtapa>;
      break;
    case "pagamento":
      cartao = (
        <CartaoEtapa tom="rosa" etapa={etapa} rotulo="Agora · Forma de pagamento" titulo="Como vai quitar o saldo?" texto="Seu levantamento foi aprovado! Escolha a forma de pagamento do saldo restante para liberar a escolha da data da assinatura.">
          <BotaoEtapa onClick={() => setAbrirPagamento((n) => n + 1)}>Escolher forma de pagamento</BotaoEtapa>
        </CartaoEtapa>
      );
      break;
    case "custeio_analise":
      cartao = <CartaoEtapa tom="ambar" etapa={etapa} rotulo="Agora · Em análise" titulo="Confirmando seu pagamento" texto="Recebemos a forma de pagamento escolhida. Assim que o financeiro confirmar, as datas para a assinatura dos termos serão liberadas aqui.">{ajuda}</CartaoEtapa>;
      break;
    case "data":
      cartao = <CartaoEtapa tom="verde" etapa={etapa} rotulo="Agora · Agenda liberada" titulo="Escolha sua data" texto={datasDisponiveis.length ? "Toque em um dia disponível no calendário abaixo e escolha o horário da assinatura dos termos." : "Sua agenda está liberada. Novas datas aparecem aqui assim que a equipe abrir o calendário."} />;
      break;
    case "termos_agendados":
      cartao = (
        <CartaoEtapa tom="verde" etapa={etapa} rotulo="Agora · Assinatura marcada" titulo="Seu horário está reservado" texto="Na data agendada para a assinatura dos termos será realizada a quitação do saldo restante do seu contrato. A escolha da data da sua cirurgia é liberada somente após a confirmação dessa quitação.">
          {agendamentoAtivo && <DataDestaque iso={agendamentoAtivo.data} horario={agendamentoAtivo.horario} rotulo="Assinatura dos termos e quitação" />}
          {saldoRestante != null && saldoRestante > 0 && (
            <div className="mt-[10px] flex items-center justify-between gap-3 rounded-[13px] border border-[#EAD7AE] bg-[#FFF9EF] px-[14px] py-[10px]">
              <span className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#A77A24]">Saldo a quitar</span>
              <span className="text-right text-[13px] font-semibold text-[#7D2434]">{moeda(saldoRestante)}{formaCusteio ? <span className="block text-[10.5px] font-normal text-[#806F6A]">{rotuloForma(formaCusteio)}</span> : null}</span>
            </div>
          )}
        </CartaoEtapa>
      );
      break;
    case "termos_assinados":
      cartao = cirurgiaLiberada
        ? <CartaoEtapa tom="verde" etapa={etapa} rotulo="Agora · Última etapa" titulo="Escolha a data da cirurgia" texto="Sua agenda cirúrgica está liberada. Escolha um dia disponível no calendário abaixo." />
        : <CartaoEtapa tom="ambar" etapa={etapa} rotulo="Agora · Última etapa" titulo="Agenda cirúrgica em liberação" texto={liberarEm ? `A escolha da data da cirurgia será liberada a partir de ${brDate(liberarEm)}, podendo ser antecipada pela equipe.` : `Com os termos assinados e a quitação confirmada, a liberação da sua agenda cirúrgica ocorre em até ${PRAZO_MAXIMO_LIBERACAO_CIRURGICA_DIAS} dias corridos, podendo ser antecipada pela equipe.`} />;
      break;
    case "cirurgia": {
      const dias = agendamentoAtual?.dataCirurgia ? diasAte(agendamentoAtual.dataCirurgia) : null;
      const contagem = dias == null ? "Tudo pronto para o seu grande dia." : dias > 1 ? `Faltam ${dias} dias para o seu grande dia.` : dias === 1 ? "É amanhã! Descanse e siga as orientações da equipe." : dias === 0 ? "É hoje! Estamos com você." : "Esperamos que sua recuperação seja tranquila.";
      cartao = <CartaoEtapa tom="verde" etapa={etapa} rotulo="Jornada concluída" titulo="Tudo confirmado 💕" texto={contagem} />;
      break;
    }
  }

  // ── Agenda fixa da aba: o mesmo fluxo real, conforme a etapa ──
  const agenda = agendamentoAtual?.dataCirurgia ? (
    <CirurgiaConfirmada data={agendamentoAtual.dataCirurgia} />
  ) : termosAssinados && agendamentoAtual ? (
    <div className="animate-fadeUp space-y-3">
      <Card className="rounded-[18px] border border-[#D5E8D9] bg-[#F3F9F4] p-[14px] shadow-[0_5px_18px_rgba(63,125,91,.055)]">
        <div className="flex items-center gap-2 text-[#3F7D5B]">
          <CheckCircle2 className="h-4 w-4" />
          <span className="text-[9px] font-semibold uppercase tracking-[.13em]">Termos assinados</span>
        </div>
        <h2 className="mt-2 font-heading text-[19px] font-semibold text-[#315F47]">Assinatura confirmada</h2>
        <p className="mt-1 text-[10.5px] font-light leading-[1.5] text-[#698273]">
          Sua assinatura foi confirmada em {dataAssinatura}{horaAssinatura ? ` às ${horaAssinatura}` : ""}.
          {" A próxima etapa será a escolha da data da sua cirurgia assim que a liberação aplicável estiver disponível."}
        </p>
      </Card>
      <SolicitarLiberacaoFinanceira termosAssinados onCirurgiaConfirmada={onAgendaAtualizada} snapshot={snapshot} />
    </div>
  ) : agendamentoAtivo ? (
    <div className="animate-fadeUp">
      <SolicitarLiberacaoFinanceira ativo={agendaLiberada || statusRevisaoFinanceira === "aprovada"} onCirurgiaConfirmada={onAgendaAtualizada} snapshot={snapshot} ocultarResumoAssinatura />
    </div>
  ) : statusRevisaoFinanceira === "recusada" ? (
    <AvisoRevisaoFinanceira status="recusada" observacao={observacaoRevisaoFinanceira ?? null} />
  ) : etapa === "pagamento" ? (
    // Etapa 3 começa imediatamente após o levantamento ser confirmado.
    // agendaLiberada ainda é false neste momento por desenho do backend:
    // ela exige a forma de pagamento já escolhida. Por isso a seleção
    // precisa vir ANTES do gate do calendário para não criar um ciclo.
    <EscolherFormaPagamento datas={datasDisponiveis} onSelecionada={onCusteioSelecionado} snapshot={snapshot} parcelasNaoPagas={parcelasNaoPagas} abrirSinal={abrirPagamento} />
  ) : !agendaLiberada ? (
    <AgendaBloqueadaPercentual
      percentual={percentualContrato}
      parcelasPagas={parcelasPagas}
      parcelasNecessarias={parcelasNecessarias}
      datas={datasDisponiveis}
      etapa={!podeAgendar ? "percentual" : liberacaoFinanceiraSolicitada ? "levantamento" : "elegivel"}
      onLiberacaoSolicitada={onLiberacaoSolicitada}
    />
  ) : (
    <Card className="rounded-[18px] border border-[#CFE2D3] border-t-[3px] border-t-[#4F8A65] bg-[#FBFFFC] p-[14px] shadow-[0_10px_26px_rgba(63,125,91,.09)]">
      {/* As etapas já aparecem na trilha do topo; aqui fica só o calendário. */}
      {datasDisponiveis.length === 0 ? (
        <p className="p-5 text-center text-[11px] font-light leading-[1.5] text-[#698273]">Ainda não há datas disponíveis no momento. Fale com a nossa equipe para saber mais.</p>
      ) : (
        <CalendarioAgendamento datas={datasDisponiveis} onConfirmar={onEscolherData} confirmando={confirmando} />
      )}
    </Card>
  );

  return (
    <div className="sl-tab pb-6">
      <div className="sl-tab-logo"><img src="/brand/sra-luck-logo.png" alt="Sra. Luck" /></div>
      <div className="sl-tab-heading">
        <div className="flex flex-wrap items-center gap-2">
          <span className="sl-agenda-kicker">Minha agenda</span>
          {(!termosAssinados || cirurgiaConfirmada) && <span className="rounded-full border px-2 py-[3px] text-[8.5px] font-semibold uppercase tracking-[.06em]" style={{ background: status.bg, color: status.color, borderColor: status.border }}>{status.label}</span>}
        </div>
        <h1 className="pt-[3px]">{tituloAgenda}</h1>
        <p>{copyAgenda}</p>
      </div>

      <TrilhaAgenda passo={passoDaTrilha(etapa)} />
      {cartao}

      <div className="px-5 pt-5">
        <div className="pb-[9px] text-[9.5px] font-bold uppercase tracking-[.14em] text-[#A9837C]">Sua agenda</div>
        {agenda}
      </div>
    </div>
  );
}
