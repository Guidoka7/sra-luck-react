"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

export type EtapaAgenda = "percentual" | "levantamento" | "pagamento" | "data";

type Props = {
  atual: EtapaAgenda;
  percentual?: number;
  percentualPago?: number;
  parcelasNecessarias?: number | null;
  onPagamentoClick?: () => void;
};

type EtapaInfo = {
  id: EtapaAgenda;
  numero: string;
  titulo: string;
  subtitulo: string;
};

const ETAPAS: EtapaInfo[] = [
  { id: "percentual", numero: "01", titulo: "Percentual mínimo", subtitulo: "Atingir a meta" },
  { id: "levantamento", numero: "02", titulo: "Análise financeira", subtitulo: "Conferir contrato" },
  { id: "pagamento", numero: "03", titulo: "Saldo restante", subtitulo: "Definir pagamento" },
  { id: "data", numero: "04", titulo: "Data dos termos", subtitulo: "Agendar assinatura" },
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
  if (id === "percentual") return "Percentual mínimo de pagamento";
  if (id === "levantamento") return "Análise e levantamento financeiro";
  if (id === "pagamento") return "Definição da forma de pagamento do saldo";
  return "Agendamento da assinatura dos termos";
}

export function AgendaEtapasInterativas({ atual, percentual, percentualPago, parcelasNecessarias, onPagamentoClick }: Props) {
  const [selecionada, setSelecionada] = useState<EtapaAgenda>(atual);

  useEffect(() => {
    setSelecionada(atual);
  }, [atual]);

  const percentualPagoNormalizado = percentualPago == null ? null : Math.min(100, Math.max(0, percentualPago));
  const progressoMeta = percentual != null && percentual > 0 && percentualPagoNormalizado != null
    ? Math.min(100, Math.max(0, (percentualPagoNormalizado / percentual) * 100))
    : null;

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
          ? "Sua ação"
          : selecionada === "data"
            ? "Agenda liberada"
            : "Etapa atual"
      : "Ainda bloqueada";

  let resumo = "";

  if (selecionada === "percentual") {
    resumo = percentual != null
      ? percentualPagoNormalizado != null
        ? `Você já atingiu ${Math.round(percentualPagoNormalizado)}% do contrato. Para avançar, precisa chegar ao percentual mínimo de ${percentual}%${parcelasNecessarias ? `, equivalente a ${parcelasNecessarias} parcelas` : ""}. Cada pagamento confirmado aproxima esta etapa da conclusão.`
        : `Para avançar, é necessário atingir o percentual mínimo de ${percentual}% do contrato${parcelasNecessarias ? `, equivalente a ${parcelasNecessarias} parcelas` : ""}. Ao atingir essa meta, o contrato segue para a análise financeira.`
      : "Nesta etapa, é necessário atingir o percentual mínimo de pagamento previsto no contrato para que o financeiro possa iniciar a análise.";
  }

  if (selecionada === "levantamento") {
    resumo = "O financeiro confere os pagamentos realizados, calcula o saldo restante do contrato e define as formas de pagamento disponíveis. Essa análise pode levar até 5 dias úteis.";
  }

  if (selecionada === "pagamento") {
    resumo = "Aqui você confere o saldo restante necessário para a quitação do contrato e define qual das formas de pagamento liberadas pelo financeiro será utilizada. Esse valor deverá ser pago no ato da assinatura dos termos, e a confirmação da forma definida libera a agenda.";
  }

  if (selecionada === "data") {
    resumo = "Com a agenda liberada, você escolhe o dia e o horário para a assinatura dos termos. Depois da assinatura, será possível avançar para a escolha da data da cirurgia.";
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

        <p className="pt-[10px] text-[10.8px] font-light leading-[1.52] text-[#786A66]">{resumo}</p>

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
            Toque para ver saldo e definir a forma de pagamento
          </motion.button>
        )}
      </div>

      <div className="relative border-t border-[#F1E8E5] pt-[13px]">
        {ETAPAS.slice(0, -1).map((item, index) => {
          const destino = ETAPAS[index + 1];
          const concluidaLinha = index < indiceAtual;
          const linhaAtual = index === indiceAtual && indiceAtual < ETAPAS.length - 1;
          const relacionadaSelecionada = indiceSelecionado === index || indiceSelecionado === index + 1;

          return (
            <motion.button
              key={`${item.id}-${destino.id}`}
              type="button"
              onClick={() => selecionar(destino.id)}
              aria-label={`Ver etapa ${destino.numero}: ${destino.titulo}`}
              animate={{ opacity: relacionadaSelecionada ? 1 : 0.72 }}
              whileHover={{ opacity: 1 }}
              whileTap={{ opacity: 0.58 }}
              transition={{ duration: 0.24, ease: "easeOut" }}
              className="absolute top-[21px] z-[1] h-[18px] cursor-pointer focus-visible:outline-none"
              style={{ left: `${12.5 + index * 25}%`, width: "25%" }}
            >
              <span
                className={`absolute left-[16px] right-[16px] top-1/2 h-[2px] -translate-y-1/2 overflow-hidden rounded-full transition-colors duration-300 ${
                  concluidaLinha
                    ? "bg-[#6F9F7E]"
                    : linhaAtual
                      ? "bg-[#EBCFD5]"
                      : relacionadaSelecionada
                        ? "bg-[#DED1D3]"
                        : "bg-[#E9E2E0]"
                }`}
              >
                {linhaAtual && (
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 w-[34%] rounded-full bg-gradient-to-r from-transparent via-[#B65B67]/70 to-transparent"
                    animate={{ x: ["-120%", "395%"] }}
                    transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
                  />
                )}
              </span>
            </motion.button>
          );
        })}

        <div className="grid grid-cols-4 gap-0">
          {ETAPAS.map((item, index) => {
            const feita = index < indiceAtual;
            const corrente = index === indiceAtual;
            const ativa = item.id === selecionada;
            const pagamentoChamando = corrente && item.id === "pagamento" && Boolean(onPagamentoClick);
            const liberada = corrente && item.id === "data";
            const progressoPercentual = item.id === "percentual" && !feita && progressoMeta != null;
            const subtitulo = item.id === "percentual" && corrente && percentualPagoNormalizado != null && percentual != null
              ? `${Math.round(percentualPagoNormalizado)}% de ${percentual}%`
              : item.subtitulo;

            const corBolinha = progressoPercentual
              ? "bg-[#F7E9EA] text-[#7D2434] overflow-hidden"
              : ativa
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
                  aria-label={item.id === "percentual" && percentualPagoNormalizado != null && percentual != null
                    ? `Etapa ${item.numero}: ${item.titulo}. ${Math.round(percentualPagoNormalizado)}% de ${percentual}% atingidos.`
                    : `Etapa ${item.numero}: ${item.titulo}`}
                  whileTap={{ scale: 0.93 }}
                  whileHover={{ y: -1 }}
                  className="relative z-[2] flex min-h-[100px] w-full min-w-0 flex-col items-center justify-start px-[2px] pt-[1px] text-center focus-visible:outline-none"
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
                      {progressoPercentual && (
                        <>
                          <motion.span
                            aria-hidden="true"
                            className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#B65B67] to-[#D58F9B]"
                            initial={{ height: 0 }}
                            animate={{ height: `${progressoMeta}%` }}
                            transition={{ duration: 0.7, ease: "easeOut" }}
                          />
                          {progressoMeta > 0 && progressoMeta < 100 && (
                            <motion.span
                              aria-hidden="true"
                              className="absolute inset-x-0 h-px bg-white/65"
                              initial={{ bottom: 0 }}
                              animate={{ bottom: `calc(${progressoMeta}% - 1px)` }}
                              transition={{ duration: 0.7, ease: "easeOut" }}
                            />
                          )}
                        </>
                      )}

                      <motion.span
                        className="relative z-[1] flex items-center justify-center"
                        animate={{ color: progressoPercentual && progressoMeta >= 48 ? "#FFFFFF" : undefined }}
                        transition={{ duration: 0.22 }}
                      >
                        {feita ? <CheckIcon /> : icon(item.id)}
                      </motion.span>
                    </motion.span>
                  </span>

                  <motion.span
                    animate={{ opacity: ativa ? 1 : 0.72, y: ativa ? 0 : 1 }}
                    className="block pt-[6px] text-[7px] font-bold uppercase tracking-[.09em] text-[#A99894]"
                  >
                    {item.numero}
                  </motion.span>
                  <span className={`block max-w-[82px] pt-[2px] text-[9px] font-semibold leading-[1.16] transition-colors ${ativa ? "text-[#7D2434]" : corrente ? "text-[#8E3243]" : "text-[#71615E]"}`}>
                    {item.titulo}
                  </span>
                  <span className={`block max-w-[82px] pt-[3px] text-[7.2px] font-medium leading-[1.2] ${ativa ? "text-[#9A686F]" : "text-[#A99894]"}`}>
                    {subtitulo}
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
