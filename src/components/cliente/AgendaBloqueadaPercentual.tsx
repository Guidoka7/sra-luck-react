"use client";

import { Clock3, LockKeyhole, ShieldCheck } from "lucide-react";
import { CalendarioAgendamento, DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

type Etapa = "percentual" | "levantamento";

export function AgendaBloqueadaPercentual({ percentual, parcelasNecessarias, datas, etapa = "percentual" }: { percentual: number; parcelasNecessarias: number | null; datas: DataDisponivel[]; etapa?: Etapa }) {
  const levantamento = etapa === "levantamento";

  return <section className="overflow-hidden rounded-2xl border border-rose/15 bg-white/80 text-clay shadow-[0_14px_40px_-28px_rgba(0,0,0,.35)] dark:border-white/10 dark:bg-[#151719] dark:text-[#EBE8E9]">
    <div className="border-b border-rose/10 bg-blush/25 px-3 py-3 sm:px-4 dark:border-white/8 dark:bg-white/[0.025]">
      <div className="flex items-start gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${levantamento ? "bg-gold/10 text-gold" : "bg-rose/10 text-rose"}`}>
          {levantamento ? <Clock3 className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-[0.55rem] font-bold uppercase tracking-[0.14em] ${levantamento ? "text-gold" : "text-rose"}`}>Minha agenda</p>
          <h3 className="mt-0.5 font-heading text-sm font-semibold leading-tight text-burgundy dark:!text-[#F7F3F4]">
            {levantamento ? "Estamos realizando seu levantamento financeiro" : "Atinja o percentual mínimo para liberar sua agenda"}
          </h3>
          <p className="mt-0.5 text-[0.62rem] leading-[1.4] text-clay/75 dark:!text-[#D9D5D6]">
            {levantamento
              ? "Você já atingiu o percentual necessário. Estamos conferindo seu levantamento financeiro para liberar a escolha da data."
              : <>Para liberar a escolha da data, você precisa atingir <strong className="font-semibold text-burgundy dark:!text-[#F7F3F4]">{percentual}% das parcelas mínimas pagas</strong>{parcelasNecessarias ? ` (${parcelasNecessarias} parcelas)` : ""}.</>}
          </p>
        </div>
      </div>
    </div>

    <div className="relative p-3 sm:p-4">
      <div className="pointer-events-none select-none blur-[3px] opacity-50 dark:opacity-40">
        <CalendarioAgendamento datas={datas} onConfirmar={() => {}} confirmando={false} bloqueado />
      </div>
      <div className="absolute inset-3 z-10 flex items-center justify-center sm:inset-4">
        <div className={`w-full max-w-[31rem] rounded-2xl border p-5 text-center shadow-[0_20px_60px_-28px_rgba(82,28,42,.32)] backdrop-blur-md sm:p-7 ${levantamento ? "border-gold/35 bg-white/[0.97] dark:border-gold/35 dark:bg-[#25161b]" : "border-gold/30 bg-white/[0.97] dark:border-gold/30 dark:bg-[#21171b]"}`}>
          <div className={`mx-auto flex h-11 w-11 items-center justify-center rounded-full ${levantamento ? "bg-gold/10 text-gold" : "bg-burgundy/8 text-burgundy dark:bg-rose/10 dark:text-rose"}`}>
            {levantamento ? <ShieldCheck className="h-5 w-5" /> : <LockKeyhole className="h-5 w-5" />}
          </div>
          <p className={`mt-4 text-[0.55rem] font-bold uppercase tracking-[0.16em] ${levantamento ? "text-gold" : "text-rose"}`}>
            {levantamento ? "Levantamento financeiro" : "Agenda bloqueada"}
          </p>
          <h4 className={`mt-1.5 font-heading text-lg font-semibold leading-tight sm:text-xl ${levantamento ? "text-rose dark:!text-rose" : "text-burgundy dark:!text-[#F7F3F4]"}`}>
            {levantamento ? "Levantamento financeiro em andamento" : "Agenda da assinatura dos termos"}
          </h4>
          <p className="mx-auto mt-2.5 max-w-[30rem] text-[0.72rem] leading-relaxed text-clay/75 dark:!text-[#D9D5D6] sm:text-sm">
            {levantamento
              ? "Estamos realizando seu levantamento financeiro no prazo de até 5 dias úteis. Assim que a análise for concluída, sua agenda será liberada para você escolher a data."
              : "Sua agenda permanece visível, porém bloqueada. Assim que você atingir o percentual necessário de pagamentos, iniciaremos seu levantamento financeiro."}
          </p>
          <div className={`mx-auto mt-4 flex max-w-[30rem] items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-left ${levantamento ? "border-gold/20 bg-gold/[0.06] dark:border-gold/25 dark:bg-gold/[0.08]" : "border-rose/10 bg-blush/35 dark:border-rose/15 dark:bg-white/[0.035]"}`}>
            {levantamento ? <Clock3 className="h-3.5 w-3.5 shrink-0 text-gold" /> : <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-rose" />}
            <p className="text-[0.62rem] font-semibold leading-relaxed text-burgundy dark:!text-[#F7F3F4]">
              {levantamento ? <>Prazo estimado: <strong>até 5 dias úteis</strong>.</> : <>Necessário atingir <strong>{percentual}%</strong> das parcelas mínimas.</>}
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>;
}
