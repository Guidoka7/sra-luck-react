"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

export type EtapaAgenda = "percentual" | "levantamento" | "pagamento" | "data";

type Props = {
  atual: EtapaAgenda;
  percentual?: number;
  parcelasNecessarias?: number | null;
  onPagamentoClick?: () => void;
};

type EtapaInfo = {
  id: EtapaAgenda;
  numero: string;
  titulo: string;
};

const ETAPAS: EtapaInfo[] = [
  { id: "percentual", numero: "01", titulo: "Percentual" },
  { id: "levantamento", numero: "02", titulo: "Levantamento" },
  { id: "pagamento", numero: "03", titulo: "Pagamento" },
  { id: "data", numero: "04", titulo: "Escolha da data" },
];

function CheckIcon() {
  return <svg width="13" height="13" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.45"><path d="m4.3 9.2 3 3.1 6.4-6.6"/></svg>;
}

function ClockIcon() {
  return <svg width="13" height="13" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><circle cx="9" cy="9" r="6.2"/><path d="M9 5.6V9l2.3 1.5"/></svg>;
}

function WalletIcon() {
  return <svg width="13" height="13" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><rect x="2.8" y="4.5" width="12.4" height="9.5" rx="2"/><path d="M12 7.2h3.2v4H12a2 2 0 1 1 0-4Z"/><path d="M5.2 4.5V3.2h7.2"/></svg>;
}

function CalendarIcon() {
  return <svg width="13" height="13" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><rect x="3" y="4.5" width="12" height="10.5" rx="2"/><path d="M6 2.8v3M12 2.8v3M3 7.5h12"/></svg>;
}

function icon(id: EtapaAgenda) {
  if (id === "percentual") return <CheckIcon />;
  if (id === "levantamento") return <ClockIcon />;
  if (id === "pagamento") return <WalletIcon />;
  return <CalendarIcon />;
}

function tituloCompleto(id: EtapaAgenda) {
  if (id === "percentual") return "Percentual de pagamento";
  if (id === "levantamento") return "Levantamento financeiro";
  if (id === "pagamento") return "Pagamento do saldo restante";
  return "Escolha da data";
}

export function AgendaEtapasInterativas({ atual, percentual, parcelasNecessarias, onPagamentoClick }: Props) {
  const [selecionada, setSelecionada] = useState<EtapaAgenda>(atual);

  useEffect(() => {
    setSelecionada(atual);
  }, [atual]);

  const indiceAtual = ETAPAS.findIndex((item) => item.id === atual);
  const indiceSelecionado = ETAPAS.findIndex((item) => item.id === selecionada);
  const concluida = indiceSelecionado < indiceAtual;
  const atualSelecionada = indiceSelecionado === indiceAtual;

  const status = concluida
    ? "Concluída"
    : atualSelecionada
      ? selecionada === "levantamento"
        ? "Em análise"
        : selecionada === "pagamento"
          ? "Aguardando escolha"
          : selecionada === "data"
            ? "Liberada"
            : "Etapa atual"
      : "Próxima etapa";

  let texto = "";
  if (selecionada === "percentual") {
    if (concluida) texto = "Você já atingiu o percentual necessário. Esta etapa foi concluída.";
    else if (atualSelecionada) {
      texto = percentual != null
        ? `Atingindo ${percentual}% das parcelas mínimas${parcelasNecessarias ? ` (${parcelasNecessarias} parcelas)` : ""}, seu contrato avança para o levantamento financeiro.`
        : "Ao atingir o percentual mínimo do contrato, seu fluxo avança para o levantamento financeiro.";
    } else texto = "O fluxo começa quando você atinge o percentual mínimo de pagamentos previsto no contrato.";
  }

  if (selecionada === "levantamento") {
    if (concluida) texto = "Levantamento concluído. O saldo restante e as formas disponíveis já foram definidos pelo financeiro.";
    else if (atualSelecionada) texto = "Estamos conferindo seus pagamentos. O prazo desta etapa é de até 5 dias úteis.";
    else texto = "Depois do percentual, o financeiro confere os pagamentos e calcula o saldo restante do contrato.";
  }

  if (selecionada === "pagamento") {
    if (concluida) texto = "Sua forma de pagamento do saldo restante já foi escolhida. O pagamento será realizado no ato da assinatura dos termos.";
    else if (atualSelecionada) texto = "Escolha como o saldo restante será pago no ato da assinatura dos termos. Toque nesta etapa para abrir as opções liberadas.";
    else texto = "Após o levantamento, você escolherá uma das formas de pagamento liberadas pelo financeiro.";
  }

  if (selecionada === "data") {
    if (concluida) texto = "A data da assinatura dos termos já foi escolhida.";
    else if (atualSelecionada) texto = "Sua forma de pagamento já foi registrada. Agora escolha no calendário a data da assinatura dos termos.";
    else texto = "A escolha da data é liberada depois que você definir a forma de pagamento do saldo restante.";
  }

  function selecionar(id: EtapaAgenda) {
    setSelecionada(id);
    if (id === "pagamento" && atual === "pagamento" && onPagamentoClick) onPagamentoClick();
  }

  return (
    <div className="space-y-[7px]">
      <div className="rounded-[12px] border border-[#E9DEDA] bg-white/95 px-[10px] py-[9px] shadow-[0_4px_13px_rgba(73,42,45,.04)]">
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-[8px]">
            <span className={`flex h-[27px] w-[27px] flex-none items-center justify-center rounded-[9px] ${selecionada === "levantamento" || selecionada === "pagamento" ? "bg-[#F8EEDB] text-[#A77A24]" : selecionada === "data" ? "bg-[#EAF4EC] text-[#3F7D5B]" : "bg-[#F7E9EA] text-[#B65B67]"}`}>
              {icon(selecionada)}
            </span>
            <div className="min-w-0">
              <div className="text-[6.8px] font-bold uppercase tracking-[.13em] text-[#A99894]">Etapa {indiceSelecionado + 1} de 4</div>
              <div className="pt-[1px] font-heading text-[14px] font-semibold leading-[1.15] text-[#7D2434]">{tituloCompleto(selecionada)}</div>
            </div>
          </div>
          <span className={`flex-none rounded-full border px-[6px] py-[3px] text-[6.8px] font-semibold uppercase tracking-[.045em] ${concluida ? "border-[#D5E8D9] bg-[#F0F7F1] text-[#3F7D5B]" : atualSelecionada ? "border-[#E8D2A9] bg-[#FFF9EF] text-[#8E6420]" : "border-[#E7DEDB] bg-[#F8F4F3] text-[#8A7B77]"}`}>{status}</span>
        </div>
        <p className="pt-[6px] text-[9.1px] font-light leading-[1.43] text-[#786A66]">{texto}</p>

        {selecionada === "pagamento" && atual === "pagamento" && onPagamentoClick && (
          <motion.button
            type="button"
            onClick={onPagamentoClick}
            animate={{ opacity: [0.82, 1, 0.82] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            className="mt-[7px] flex w-full items-center justify-center gap-[6px] rounded-[9px] border border-[#E1C48C] bg-[#FFF7E8] px-3 py-[7px] text-[8.8px] font-semibold text-[#7D5B1E]"
          >
            <span className="relative flex h-[6px] w-[6px] items-center justify-center">
              <span className="absolute h-[6px] w-[6px] animate-ping rounded-full bg-[#B7862A]/30" />
              <span className="relative h-[4px] w-[4px] rounded-full bg-[#B7862A]" />
            </span>
            Toque para escolher a forma de pagamento
          </motion.button>
        )}
      </div>

      <div className="relative px-[2px] py-[1px]">
        <div className="pointer-events-none absolute left-[12.5%] right-[12.5%] top-[13px] h-px bg-[#E6D9D5]" />
        <div className="pointer-events-none absolute left-[12.5%] top-[13px] h-px bg-[#C89D45]" style={{ width: `${Math.max(0, indiceAtual) * 25}%` }} />

        <div className="grid grid-cols-4 gap-0">
          {ETAPAS.map((item, index) => {
            const feita = index < indiceAtual;
            const corrente = index === indiceAtual;
            const ativa = item.id === selecionada;
            const pagamentoChamando = corrente && item.id === "pagamento" && Boolean(onPagamentoClick);

            const botao = (
              <button
                type="button"
                onClick={() => selecionar(item.id)}
                aria-pressed={ativa}
                className={`relative z-[1] flex min-h-[52px] min-w-0 flex-col items-center justify-start rounded-[9px] px-[1px] pb-[3px] pt-0.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#C89D45] ${ativa ? "bg-[#FFF9EF]/75" : "bg-transparent"}`}
              >
                <span className="relative flex h-[23px] w-[23px] items-center justify-center">
                  {pagamentoChamando && (
                    <motion.span
                      aria-hidden="true"
                      className="absolute inset-[-3px] rounded-full border border-[#C89D45]/55"
                      animate={{ scale: [0.92, 1.16, 0.92], opacity: [0.28, 0.65, 0.28] }}
                      transition={{ duration: 1.45, repeat: Infinity, ease: "easeInOut" }}
                    />
                  )}
                  <span className={`relative flex h-[23px] w-[23px] items-center justify-center rounded-full border ${feita ? "border-[#CFE2D3] bg-[#EAF4EC] text-[#3F7D5B]" : corrente ? "border-[#E4C98E] bg-[#FBF1DD] text-[#A77A24]" : "border-[#E5DBD8] bg-[#F5F1EF] text-[#9A8A86]"}`}>
                    {feita ? <CheckIcon /> : icon(item.id)}
                  </span>
                </span>
                <span className="block pt-[2px] text-[5.7px] font-bold uppercase tracking-[.08em] text-[#A99894]">{item.numero}</span>
                <span className={`block max-w-[70px] pt-[1px] text-[6.7px] font-semibold leading-[1.08] ${ativa ? "text-[#7D2434]" : "text-[#71615E]"}`}>{item.titulo}</span>
                {pagamentoChamando && <span className="pt-[1px] text-[5.5px] font-semibold uppercase tracking-[.05em] text-[#A77A24]">toque</span>}
              </button>
            );

            if (!pagamentoChamando) return <div key={item.id}>{botao}</div>;
            return (
              <motion.div key={item.id} animate={{ scale: [1, 1.018, 1] }} transition={{ duration: 1.45, repeat: Infinity, ease: "easeInOut" }}>
                {botao}
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
