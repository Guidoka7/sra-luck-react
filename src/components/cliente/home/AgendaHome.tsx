import { CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { AgendaEtapasInterativas } from "@/components/cliente/AgendaEtapasInterativas";
import { CalendarioAgendamento } from "@/components/cliente/CalendarioAgendamento";
import { AgendaBloqueadaPercentual } from "@/components/cliente/AgendaBloqueadaPercentual";
import { SolicitarLiberacaoFinanceira } from "@/components/cliente/SolicitarLiberacaoFinanceira";
import { EscolherFormaPagamento } from "@/components/cliente/EscolherFormaPagamento";
import { RegrasLiberacao } from "@/components/cliente/RegrasLiberacao";
import { AvisoRevisaoFinanceira } from "@/components/cliente/AvisoRevisaoFinanceira";
import { percentualNecessario } from "@/lib/utils";
import type { DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

type StatusRevisaoFinanceira = "pendente" | "aprovada" | "recusada" | null;

interface AgendaHomeProps {
  agendamentoAtivo: { id: string; data: string; horario: string | null; previsaoLiberacaoFinanceira: string | null } | null;
  agendamentoConcluido: { id: string; data: string; horario: string | null; previsaoLiberacaoFinanceira: string | null } | null;
  datasDisponiveis: DataDisponivel[];
  quantidadeParcelas: number | null;
  parcelasPagas: number;
  podeAgendar: boolean;
  agendaLiberada: boolean;
  statusRevisaoFinanceira: StatusRevisaoFinanceira;
  observacaoRevisaoFinanceira?: string | null;
  custeioAprovado: boolean;
  confirmando: boolean;
  onEscolherData: (dataId: string, horario: string) => void;
  onCusteioSelecionado?: () => void | Promise<void>;
}

function brDate(value: string | null | undefined) {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
}

function statusAgenda({ agendamentoAtivo, agendamentoConcluido, podeAgendar, agendaLiberada, statusRevisaoFinanceira, custeioAprovado }: Pick<AgendaHomeProps, "agendamentoAtivo" | "agendamentoConcluido" | "podeAgendar" | "agendaLiberada" | "statusRevisaoFinanceira" | "custeioAprovado">) {
  if (agendamentoConcluido) return { label: "Termos assinados", bg: "#EEF6F0", color: "#3F7D5B", border: "#D3E6D8" };
  if (agendamentoAtivo) return { label: "Assinatura agendada", bg: "#EEF6F0", color: "#3F7D5B", border: "#D3E6D8" };
  if (statusRevisaoFinanceira === "recusada") return { label: "Ajuste necessário", bg: "#FBEBEA", color: "#8F2A25", border: "#F0D3D1" };
  if (!podeAgendar) return { label: "Etapa 1 de 4", bg: "#F7EFED", color: "#7D2434", border: "#EBD9D5" };
  if (!agendaLiberada || statusRevisaoFinanceira === "pendente") return { label: "Etapa 2 de 4", bg: "#FFF7E8", color: "#8A6720", border: "#E9D7AD" };
  if (!custeioAprovado) return { label: "Etapa 3 de 4", bg: "#FFF7E8", color: "#8A6720", border: "#E9D7AD" };
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
  custeioAprovado,
  confirmando,
  onEscolherData,
  onCusteioSelecionado,
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
          {agendamentoConcluido.previsaoLiberacaoFinanceira ? ` Sua cirurgia está programada para ${brDate(agendamentoConcluido.previsaoLiberacaoFinanceira)}.` : " A próxima etapa será a escolha da data da sua cirurgia assim que a liberação aplicável estiver disponível."}
        </p>
      </Card>
      <SolicitarLiberacaoFinanceira ativo={agendaLiberada || statusRevisaoFinanceira === "aprovada"} />
    </div>
  ) : (
    <div>
      {statusRevisaoFinanceira === "recusada" ? (
        <AvisoRevisaoFinanceira status="recusada" observacao={observacaoRevisaoFinanceira ?? null} />
      ) : !agendaLiberada ? (
        <AgendaBloqueadaPercentual
          percentual={percentualContrato}
          parcelasPagas={parcelasPagas}
          parcelasNecessarias={parcelasNecessarias}
          datas={datasDisponiveis}
          etapa={podeAgendar ? "levantamento" : "percentual"}
        />
      ) : !custeioAprovado ? (
        <EscolherFormaPagamento datas={datasDisponiveis} onSelecionada={onCusteioSelecionado} />
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

      <div className="sl-agenda-body">
        <RegrasLiberacao quantidadeParcelas={quantidadeParcelas} />
      </div>

      <div className="px-5 pt-[15px]">
        {conteudoLegado}
      </div>
    </section>
  );
}
