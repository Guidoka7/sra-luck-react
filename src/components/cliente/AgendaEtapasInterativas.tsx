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
  return <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.45"><path d="m4.3 9.2 3 3.1 6.4-6.6"/></svg>;
}

function ClockIcon() {
  return <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><circle cx="9" cy="9" r="6.2"/><path d="M9 5.6V9l2.3 1.5"/></svg>;
}

function WalletIcon() {
  return <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><rect x="2.8" y="4.5" width="12.4" height="9.5" rx="2"/><path d="M12 7.2h3.2v4H12a2 2 0 1 1 0-4Z"/><path d="M5.2 4.5V3.2h7.2"/></svg>;
}

function CalendarIcon() {
  return <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><rect x="3" y="4.5" width="12" height="10.5" rx="2"/><path d="M6 2.8v3M12 2.8v3M3 7.5h12"/></svg>;
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
    <div>
      <div className="px-[2px] pb-[13px]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-[10px]">
            <span className={`flex h-[36px] w-[36px] flex-none items-center justify-center rounded-[11px] ${selecionada === "levantamento" || selecionada === "pagamento" ? "bg-[#F8EEDB] text-[#A77A24]" : selecionada === "data" ? "bg-[#EAF4EC] text-[#3F7D5B]" : "bg-[#F7E9EA] text-[#B65B67]"}`}>
              {icon(selecionada)}
            </span>
            <div className="min-w-0">
              <div className="text-[8px] font-bold uppercase tracking-[.13em] text-[#A99894]">Etapa {indiceSelecionado + 1} de 4</div>
              <div className="pt-[2px] font-heading text-[18px] font-semibold leading-[1.12] text-[#7D2434]">{tituloCompleto(selecionada)}</div>
            </div>
          </div>
          <span className={`mt-[2px] flex-none rounded-full border px-[8px] py-[5px] text-[7.6px] font-semibold uppercase tracking-[.045em] ${concluida ? "border-[#D5E8D9] bg-[#F0F7F1] text-[#3F7D5B]" : atualSelecionada ? "border-[#E8D2A9] bg-[#FFF9EF] text-[#8E6420]" : "border-[#E7DEDB] bg-[#F8F4F3] text-[#8A7B77]"}`}>{status}</span>
        </div>
        <p className="pt-[9px] text-[10.8px] font-light leading-[1.5] text-[#786A66]">{texto}</p>

        {selecionada === "pagamento" && atual === "pagamento" && onPagamentoClick && (
          <motion.button
            type="button"
            onClick={onPagamentoClick}
            animate={{ opacity: [0.84, 1, 0.84], scale: [1, 1.008, 1] }}
            transition={{ duration: 1.55, repeat: Infinity, ease: "easeInOut" }}
            whileTap={{ scale: 0.985 }}
            className="mt-[10px] flex w-full items-center justify-center gap-[7px] rounded-[11px] border border-[#E1C48C] bg-[#FFF7E8] px-3 py-[10px] text-[10.2px] font-semibold text-[#7D5B1E]"
          >
            <span className="relative flex h-[7px] w-[7px] items-center justify-center">
              <span className="absolute h-[7px] w-[7px] animate-ping rounded-full bg-[#B7862A]/30" />
              <span className="relative h-[5px] w-[5px] rounded-full bg-[#B7862A]" />
            </span>
            Toque para escolher a forma de pagamento
          </motion.button>
        )}
      </div>

      <div className="relative border-t border-[#F1E8E5] pt-[13px]">
        <div className="pointer-events-none absolute left-[12.5%] right-[12.5%] top-[30px] h-[2px] rounded-full bg-[#E8DEDB]" />
        <motion.div
          className="pointer-events-none absolute left-[12.5%] top-[30px] h-[2px] rounded-full bg-[#B65B67]"
          initial={false}
          animate={{ width: `${Math.max(0, indiceAtual) * 25}%` }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        />
        {indiceAtual < ETAPAS.length - 1 && (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute top-[30px] h-[2px] rounded-full bg-gradient-to-r from-[#B65B67]/45 via-[#B65B67]/20 to-transparent"
            style={{ left: `${12.5 + indiceAtual * 25}%`, width: "25%" }}
            animate={{ opacity: [0.35, 0.8, 0.35] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        )}

        <div className="grid grid-cols-4 gap-0">
          {ETAPAS.map((item, index) => {
            const feita = index < indiceAtual;
            const corrente = index === indiceAtual;
            const ativa = item.id === selecionada;
            const pagamentoChamando = corrente && item.id === "pagamento" && Boolean(onPagamentoClick);
            const liberada = corrente && item.id === "data";

            const corBolinha = ativa
              ? feita || liberada
                ? "bg-[#3F7D5B] text-white"
                : "bg-[#7D2434] text-white"
              : feita
                ? "bg-[#E5F2E8] text-[#3F7D5B]"
                : corrente
                  ? liberada
                    ? "bg-[#DDEEE2] text-[#3F7D5B]"
                    : "bg-[#F7E9EA] text-[#8E3243]"
                  : "bg-[#F2ECEA] text-[#9B8B87]";

            return (
              <div key={item.id} className="flex min-w-0 justify-center">
                <motion.button
                  type="button"
                  onClick={() => selecionar(item.id)}
                  aria-pressed={ativa}
                  whileTap={{ scale: 0.93 }}
                  whileHover={{ y: -1 }}
                  className="relative z-[1] flex min-h-[84px] w-full min-w-0 flex-col items-center justify-start px-[2px] pt-[1px] text-center focus-visible:outline-none"
                >
                  <span className="relative flex h-[34px] w-[34px] items-center justify-center">
                    {pagamentoChamando && (
                      <motion.span
                        aria-hidden="true"
                        className="absolute inset-[-5px] rounded-full bg-[#D8B86C]/18"
                        animate={{ scale: [0.85, 1.35, 0.85], opacity: [0.15, 0.5, 0.15] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                      />
                    )}
                    {corrente && !ativa && (
                      <motion.span
                        aria-hidden="true"
                        className={`absolute inset-[-3px] rounded-full ${liberada ? "bg-[#3F7D5B]/10" : "bg-[#B65B67]/10"}`}
                        animate={{ scale: [0.96, 1.1, 0.96], opacity: [0.25, 0.55, 0.25] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      />
                    )}
                    <motion.span
                      layout
                      animate={{
                        scale: ativa ? 1.16 : 1,
                        y: ativa ? -2 : 0,
                        boxShadow: ativa
                          ? feita || liberada
                            ? "0 7px 18px rgba(63,125,91,.24)"
                            : "0 7px 18px rgba(125,36,52,.22)"
                          : "0 2px 7px rgba(74,48,45,.07)",
                      }}
                      transition={{ type: "spring", stiffness: 420, damping: 27 }}
                      className={`relative flex h-[32px] w-[32px] items-center justify-center rounded-full ${corBolinha}`}
                    >
                      {feita ? <CheckIcon /> : icon(item.id)}
                    </motion.span>
                  </span>

                  <motion.span
                    animate={{ opacity: ativa ? 1 : 0.72, y: ativa ? 0 : 1 }}
                    className="block pt-[6px] text-[7px] font-bold uppercase tracking-[.09em] text-[#A99894]"
                  >
                    {item.numero}
                  </motion.span>
                  <span className={`block max-w-[76px] pt-[2px] text-[9px] font-semibold leading-[1.18] transition-colors ${ativa ? "text-[#7D2434]" : corrente ? "text-[#8E3243]" : "text-[#71615E]"}`}>
                    {item.titulo}
                  </span>
                  {pagamentoChamando && (
                    <motion.span
                      className="pt-[3px] text-[6.5px] font-bold uppercase tracking-[.07em] text-[#A77A24]"
                      animate={{ opacity: [0.55, 1, 0.55] }}
                      transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
                    >
                      toque
                    </motion.span>
                  )}
                </motion.button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
