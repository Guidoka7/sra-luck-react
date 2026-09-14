import { CheckCircle2, Compass } from "lucide-react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { CalendarioAgendamento } from "@/components/cliente/CalendarioAgendamento";
import { AgendaBloqueadaPercentual } from "@/components/cliente/AgendaBloqueadaPercentual";
import { SolicitarLiberacaoFinanceira } from "@/components/cliente/SolicitarLiberacaoFinanceira";
import { RegrasLiberacao } from "@/components/cliente/RegrasLiberacao";
import { AvisoRevisaoFinanceira } from "@/components/cliente/AvisoRevisaoFinanceira";
import { FluxoCirurgicoCliente } from "@/components/cliente/FluxoCirurgicoCliente";
import { percentualNecessario } from "@/lib/utils";
import type { DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

type StatusRevisaoFinanceira = "pendente" | "aprovada" | "recusada" | null;

interface AgendaHomeProps {
  agendamentoAtivo: { id: string; data: string; horario: string | null; previsaoLiberacaoFinanceira: string | null } | null;
  agendamentoConcluido: { id: string; data: string; horario: string | null; previsaoLiberacaoFinanceira: string | null } | null;
  datasDisponiveis: DataDisponivel[];
  quantidadeParcelas: number | null;
  podeAgendar: boolean;
  agendaLiberada: boolean;
  statusRevisaoFinanceira: StatusRevisaoFinanceira;
  observacaoRevisaoFinanceira?: string | null;
  confirmando: boolean;
  onEscolherData: (dataId: string, horario: string) => void;
}

function brDate(value: string | null | undefined) {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
}

/**
 * Componente dirigido pelo fluxo real da jornada (estados A–H do redesign).
 * Não hardcoda percentuais/datas: tudo vem de `FluxoCirurgicoCliente` (que
 * resolve `/api/cliente/journey` com fallback automático para o fluxo legado
 * de `/api/cliente/agenda` + `/api/cliente/boletos`) ou dos props recebidos
 * daqui, que já refletem o estado real vindo do backend.
 */
export function AgendaHome({
  agendamentoAtivo,
  agendamentoConcluido,
  datasDisponiveis,
  quantidadeParcelas,
  podeAgendar,
  agendaLiberada,
  statusRevisaoFinanceira,
  observacaoRevisaoFinanceira,
  confirmando,
  onEscolherData,
}: AgendaHomeProps) {
  const percentualContrato = percentualNecessario(quantidadeParcelas);
  const parcelasNecessarias = quantidadeParcelas ? Math.ceil((quantidadeParcelas * percentualContrato) / 100) : null;

  const conteudoLegado = agendamentoAtivo ? (
    <div className="flex flex-col gap-3 animate-fadeUp">
      <SolicitarLiberacaoFinanceira ativo={agendaLiberada || statusRevisaoFinanceira === "aprovada"} />
    </div>
  ) : agendamentoConcluido ? (
    <div className="flex flex-col gap-3 animate-fadeUp">
      <Card className="border border-success/15 bg-success/[0.04] p-4">
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-label">Termos assinados</span>
        </div>
        <h2 className="mt-2 font-heading text-lg font-semibold text-burgundy">Assinatura confirmada</h2>
        <p className="mt-1 text-sm leading-relaxed text-clay/60">
          Sua assinatura foi confirmada em {brDate(agendamentoConcluido.data)}
          {agendamentoConcluido.horario ? ` às ${agendamentoConcluido.horario}` : ""}.
          {agendamentoConcluido.previsaoLiberacaoFinanceira
            ? ` Sua cirurgia está programada para ${brDate(agendamentoConcluido.previsaoLiberacaoFinanceira)}.`
            : " Escolha a data da sua cirurgia na agenda quando o custeio estiver definido."}
        </p>
      </Card>
      <SolicitarLiberacaoFinanceira ativo={agendaLiberada || statusRevisaoFinanceira === "aprovada"} />
    </div>
  ) : (
    <div className="flex flex-col gap-3">
      {agendaLiberada ? (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
          <Card className="p-3.5 sm:p-4">
            {datasDisponiveis.length === 0 ? (
              <p className="p-6 text-center text-sm text-clay/50">Ainda não há datas disponíveis no momento. Fale com a nossa equipe para saber mais.</p>
            ) : (
              <>
                <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-gold/20 bg-gold/[0.06] px-3 py-2.5">
                  <div>
                    <p className="text-[0.72rem] font-semibold text-burgundy">Escolha a data da assinatura dos termos cirúrgicos</p>
                    <p className="mt-0.5 text-[0.6rem] leading-relaxed text-clay/55">Selecione no calendário abaixo uma das datas disponíveis para realizar a assinatura.</p>
                  </div>
                </div>
                <CalendarioAgendamento datas={datasDisponiveis} onConfirmar={onEscolherData} confirmando={confirmando} />
              </>
            )}
          </Card>
        </motion.div>
      ) : statusRevisaoFinanceira === "recusada" ? (
        <AvisoRevisaoFinanceira status="recusada" observacao={observacaoRevisaoFinanceira ?? null} />
      ) : (
        <AgendaBloqueadaPercentual
          percentual={percentualContrato}
          parcelasNecessarias={parcelasNecessarias}
          datas={datasDisponiveis}
          etapa={podeAgendar ? "levantamento" : "percentual"}
        />
      )}
    </div>
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-0.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-burgundy/8">
          <Compass className="h-3.5 w-3.5 text-burgundy" />
        </span>
        <div>
          <p className="text-[0.58rem] font-bold uppercase tracking-label text-rose">Minha agenda</p>
          <h2 className="font-heading text-sm font-semibold leading-tight text-burgundy">Seu próximo grande passo</h2>
        </div>
      </div>

      <RegrasLiberacao quantidadeParcelas={quantidadeParcelas} />

      <FluxoCirurgicoCliente fallback={conteudoLegado} datasLegadas={datasDisponiveis} />
    </section>
  );
}
