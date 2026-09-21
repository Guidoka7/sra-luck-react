"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AgendaBloqueadaShell } from "@/components/cliente/AgendaBloqueadaShell";
import { AgendaEtapasInterativas } from "@/components/cliente/AgendaEtapasInterativas";
import { type DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

type Etapa = "percentual" | "elegivel" | "levantamento";

type Props = {
  percentual: number;
  parcelasPagas?: number;
  parcelasNecessarias: number | null;
  datas: DataDisponivel[];
  etapa?: Etapa;
  onLiberacaoSolicitada?: () => void | Promise<void>;
};

/**
 * V46 — regra crítica: atingir o percentual mínimo NÃO move a cliente para
 * Levantamentos sozinho. A etapa "elegivel" (nova) é o estado intermediário
 * onde ela já bateu a meta mas ainda não tocou no botão — só esse clique
 * (POST /api/cliente/agenda/solicitar-liberacao) muda seu status_revisao_
 * financeira e a move de fato para Levantamentos no admin.
 */
export function AgendaBloqueadaPercentual({ percentual, parcelasPagas = 0, parcelasNecessarias, datas, etapa = "percentual", onLiberacaoSolicitada }: Props) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const atual = etapa === "percentual" ? "percentual" : etapa === "elegivel" ? "percentual" : "levantamento";
  const pagas = Math.max(0, Math.floor(parcelasPagas));
  const meta = parcelasNecessarias ?? 0;
  const resumo = etapa === "levantamento"
    ? "Levantamento financeiro em andamento. Toque para acompanhar."
    : etapa === "elegivel"
      ? "Você atingiu o percentual mínimo. Toque no botão abaixo para solicitar a liberação financeira e iniciar o levantamento."
      : meta > 0
        ? pagas > 0
          ? `Você já confirmou ${Math.min(pagas, meta)} de ${meta} parcelas necessárias para avançar.`
          : `A etapa começa a preencher assim que a primeira das ${meta} parcelas necessárias for confirmada.`
        : `Atinga o percentual mínimo de ${percentual}% do contrato para avançar.`;

  async function solicitar() {
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cliente/agenda/solicitar-liberacao", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.erro ?? "Não foi possível enviar sua solicitação.");
      toast.success("Solicitação enviada. Nossa equipe vai iniciar o levantamento financeiro.");
      await onLiberacaoSolicitada?.();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível enviar sua solicitação.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <AgendaBloqueadaShell datas={datas} etapa={etapa === "levantamento" ? 2 : 1} resumo={resumo}>
      {etapa === "elegivel" && (
        <div className="mb-[11px] rounded-[16px] border border-[#DCEADF] bg-[#F0F7F1] p-[14px]">
          <div className="text-[8.5px] font-bold uppercase tracking-[.13em] text-[#3F7D5B]">Meta atingida</div>
          <p className="mt-[4px] text-[10.5px] font-light leading-[1.5] text-[#3B5C48]">
            Você já confirmou as parcelas necessárias. Solicite a liberação financeira para que nossa equipe inicie o levantamento.
          </p>
          {erro && <p className="mt-[6px] text-[9.7px] text-[#8F2A25]">{erro}</p>}
          <button
            type="button"
            onClick={() => void solicitar()}
            disabled={enviando}
            className="mt-[10px] w-full rounded-[11px] bg-[#3F7D5B] px-[13px] py-[11px] text-[11px] font-medium text-white disabled:opacity-50"
          >
            {enviando ? "Enviando..." : "Solicitar liberação financeira"}
          </button>
        </div>
      )}
      <AgendaEtapasInterativas
        atual={atual}
        percentual={percentual}
        parcelasPagas={pagas}
        parcelasNecessarias={parcelasNecessarias}
      />
    </AgendaBloqueadaShell>
  );
}
