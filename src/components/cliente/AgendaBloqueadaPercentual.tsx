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

  const destaque = etapa === "elegivel" ? (
    <>
      <span className="mx-auto flex h-[45px] w-[45px] items-center justify-center rounded-full bg-[#F0F7F1] text-[#3F7D5B] shadow-[0_4px_12px_rgba(63,125,91,.1)]" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 10.4 3.2 3.1L15 6.6" /></svg>
      </span>
      <span className="block pt-[10px] text-[8.5px] font-bold uppercase tracking-[.13em] text-[#3F7D5B]">Meta atingida</span>
      <span className="block pt-[3px] font-heading text-[20px] font-semibold leading-[1.15] text-[#7D2434]">Solicite a liberação</span>
      <span className="block px-1 pt-[6px] text-[10.5px] font-light leading-[1.45] text-[#5E6B62]">
        Você já confirmou as parcelas necessárias. Solicite a liberação financeira para que nossa equipe inicie o levantamento.
      </span>
      {erro && <span role="alert" className="block pt-[6px] text-[9.7px] text-[#8F2A25]">{erro}</span>}
      <button
        type="button"
        onClick={() => void solicitar()}
        disabled={enviando}
        aria-busy={enviando}
        className="mt-[12px] w-full rounded-[11px] bg-[#3F7D5B] px-[13px] py-[11px] text-[11px] font-medium text-white shadow-[0_8px_18px_rgba(63,125,91,.22)] disabled:opacity-50"
      >
        {enviando ? "Enviando..." : "Solicitar liberação financeira"}
      </button>
    </>
  ) : undefined;

  return (
    <AgendaBloqueadaShell datas={datas} etapa={etapa === "levantamento" ? 2 : 1} resumo={resumo} destaque={destaque}>
      <AgendaEtapasInterativas
        atual={atual}
        percentual={percentual}
        parcelasPagas={pagas}
        parcelasNecessarias={parcelasNecessarias}
      />
    </AgendaBloqueadaShell>
  );
}
