import { CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { AgendaEtapasInterativas } from "@/components/cliente/AgendaEtapasInterativas";
import { CalendarioAgendamento } from "@/components/cliente/CalendarioAgendamento";
import { AgendaBloqueadaPercentual } from "@/components/cliente/AgendaBloqueadaPercentual";
import { SolicitarLiberacaoFinanceira } from "@/components/cliente/SolicitarLiberacaoFinanceira";
import { EscolherFormaPagamento } from "@/components/cliente/EscolherFormaPagamento";
import { AvisoRevisaoFinanceira } from "@/components/cliente/AvisoRevisaoFinanceira";
import { percentualNecessario } from "@/lib/utils";
import type { DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

type StatusRevisaoFinanceira = "pendente" | "aprovada" | "recusada" | null;

interface AgendaHomeProps {
  agendamentoAtivo: { id: string; data: string; horario: string | null; dataCirurgia: string | null } | null;
  agendamentoConcluido: { id: string; data: string; horario: string | null; dataCirurgia: string | null } | null;
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
  /** Chamado depois que a cliente solicita a liberação financeira, para
   * recarregar os dados reais (liberacaoFinanceiraSolicitada vem do backend
   * no próximo GET, nunca é setado localmente). */
  onLiberacaoSolicitada?: () => void | Promise<void>;
}

function brDate(value: string | null | undefined) {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
}

/** Etapa 3: levantamento aprovado, mas a cliente ainda não escolheu o custeio. */
export function deveMostrarEscolhaCusteio(statusRevisaoFinanceira: StatusRevisaoFinanceira, custeioAprovado: boolean) {
  return statusRevisaoFinanceira === "aprovada" && !custeioAprovado;
}

export function statusAgenda({ agendamentoAtivo, agendamentoConcluido, podeAgendar, agendaLiberada, statusRevisaoFinanceira, custeioAprovado }: Pick<AgendaHomeProps, "agendamentoAtivo" | "agendamentoConcluido" | "podeAgendar" | "agendaLiberada" | "statusRevisaoFinanceira" | "custeioAprovado">) {
  if (agendamentoConcluido) return { label: "Termos assinados", bg: "#EEF6F0", color: "#3F7D5B", border: "#D3E6D8" };
  if (agendamentoAtivo) return { label: "Assinatura agendada", bg: "#EEF6F0", color: "#3F7D5B", border: "#D3E6D8" };
  if (statusRevisaoFinanceira === "recusada") return { label: "Ajuste necessário", bg: "#FBEBEA", color: "#8F2A25", border: "#F0D3D1" };
  if (!podeAgendar) return { label: "Etapa 1 de 4", bg: "#F7EFED", color: "#7D2434", border: "#EBD9D5" };
  if (statusRevisaoFinanceira !== "aprovada") return { label: "Etapa 2 de 4", bg: "#FFF7E8", color: "#8A6720", border: "#E9D7AD" };
  // A aprovação do levantamento libera a Etapa 3 (escolha da forma de
  // pagamento). A RPC agenda_liberada só fica true DEPOIS dessa escolha,
  // então ela não pode ser usada como gate para entrar na própria Etapa 3.
  if (!custeioAprovado || !agendaLiberada) return { label: "Etapa 3 de 4", bg: "#FFF7E8", color: "#8A6720", border: "#E9D7AD" };
  return { label: "Etapa 4 de 4", bg: "#EEF6F0", color: "#3F7D5B", border: "#D3E6D8" };
}

export function AgendaHome({
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
  onLiberacaoSolicitada,
}: AgendaHomeProps) {
  const percentualContrato = percentualNecessario(quantidadeParcelas);
  const parcelasNecessarias = quantidadeParcelas ? Math.ceil((quantidadeParcelas * percentualContrato) / 100) : null;
  const status = statusAgenda({ agendamentoAtivo, agendamentoConcluido, podeAgendar, agendaLiberada, statusRevisaoFinanceira, custeioAprovado });

  const tituloAgenda = agendamentoConcluido
    ? "Assinatura dos termos concluída"
    : agendamentoAtivo
      ? "Assinatura dos termos agendada"
      : "Seu próximo grande passo";

  const copyAgenda = agendamentoConcluido
    ? "A assinatura foi concluída. Acompanhe agora a liberação da próxima etapa da sua cirurgia."
    : agendamentoAtivo
      ? "Você poderá escolher a data da sua cirurgia após a assinatura dos termos."
      : "Acompanhe as quatro etapas até a escolha da data.";

  const conteudoLegado = agendamentoAtivo ? (
    <div className="animate-fadeUp">
      <SolicitarLiberacaoFinanceira ativo={agendaLiberada || statusRevisaoFinanceira === "aprovada"} />
    </div>
  ) : agendamentoConcluido ? (
    <div className="animate-fadeUp space-y-3">
      <Card className="rounded-[18px] border border-[#D5E8D9] bg-[#F3F9F4] p-[14px] shadow-[0_5px_18px_rgba(63,125,91,.055)]">
        <div className="flex items-center gap-2 text-[#3F7D5B]">
          <CheckCircle2 className="h-4 w-4" />
          <span className="text-[9px] font-semibold uppercase tracking-[.13em]">Termos assinados</span>
        </div>
        <h2 className="mt-2 font-heading text-[19px] font-semibold text-[#315F47]">Assinatura confirmada</h2>
        <p className="mt-1 text-[10.5px] font-light leading-[1.5] text-[#698273]">
          Sua assinatura foi confirmada em {brDate(agendamentoConcluido.data)}{agendamentoConcluido.horario ? ` às ${agendamentoConcluido.horario}` : ""}.
          {agendamentoConcluido.dataCirurgia ? ` Sua cirurgia está programada para ${brDate(agendamentoConcluido.dataCirurgia)}.` : " A próxima etapa será a escolha da data da sua cirurgia assim que a liberação aplicável estiver disponível."}
        </p>
      </Card>
      <SolicitarLiberacaoFinanceira ativo={agendaLiberada || statusRevisaoFinanceira === "aprovada"} />
    </div>
  ) : (
    <div>
      {statusRevisaoFinanceira === "recusada" ? (
        <AvisoRevisaoFinanceira status="recusada" observacao={observacaoRevisaoFinanceira ?? null} />
      ) : deveMostrarEscolhaCusteio(statusRevisaoFinanceira, custeioAprovado) ? (
        // Etapa 3 começa imediatamente após o levantamento ser confirmado.
        // agendaLiberada ainda é false neste momento por desenho do backend:
        // ela exige a forma de pagamento já escolhida. Por isso a seleção
        // precisa vir ANTES do gate do calendário para não criar um ciclo.
        <EscolherFormaPagamento datas={datasDisponiveis} onSelecionada={onCusteioSelecionado} />
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
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <Card className="rounded-[18px] border border-[#CFE2D3] border-t-[3px] border-t-[#4F8A65] bg-[#FBFFFC] p-[14px] shadow-[0_10px_26px_rgba(63,125,91,.09)]">
            <AgendaEtapasInterativas atual="data" percentual={percentualContrato} parcelasPagas={parcelasPagas} parcelasNecessarias={parcelasNecessarias} />

            <div className="mt-[12px] border-t border-[#DDEADF] pt-[12px]">
              {datasDisponiveis.length === 0 ? (
                <p className="p-5 text-center text-[11px] font-light leading-[1.5] text-[#698273]">Ainda não há datas disponíveis no momento. Fale com a nossa equipe para saber mais.</p>
              ) : (
                <CalendarioAgendamento datas={datasDisponiveis} onConfirmar={onEscolherData} confirmando={confirmando} />
              )}
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );

  return (
    <section>
      <div className="sl-agenda-section-title">
        <div>
          <div className="sl-agenda-kicker">Minha agenda</div>
          <div className="sl-agenda-title">{tituloAgenda}</div>
          <div className="sl-agenda-copy">{copyAgenda}</div>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, background: status.bg, color: status.color, border: `1px solid ${status.border}`, fontSize: 8, fontWeight: 650, letterSpacing: ".06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{status.label}</span>
      </div>

      <div className="px-5 pt-[15px]">
        {conteudoLegado}
      </div>
    </section>
  );
}
