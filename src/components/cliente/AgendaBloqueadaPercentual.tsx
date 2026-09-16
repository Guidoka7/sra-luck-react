"use client";

import { CalendarioAgendamento, DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

type Etapa = "percentual" | "levantamento";

function LockIcon({ clock = false }: { clock?: boolean }) {
  if (clock) return <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><circle cx="9" cy="9" r="6.2"/><path d="M9 5.6V9l2.3 1.5"/></svg>;
  return <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><rect x="3.8" y="8" width="10.4" height="7" rx="1.8"/><path d="M6.2 8V5.9a2.8 2.8 0 0 1 5.6 0V8"/></svg>;
}

function CheckIcon() {
  return <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.45"><path d="m4.3 9.2 3 3.1 6.4-6.6"/></svg>;
}

function CalendarIcon() {
  return <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><rect x="3" y="4.5" width="12" height="10.5" rx="2"/><path d="M6 2.8v3M12 2.8v3M3 7.5h12"/></svg>;
}

function LevantamentoFinanceiro({ datas }: { datas: DataDisponivel[] }) {
  const etapas = [
    { numero: "01", titulo: "Percentual atingido", icon: <CheckIcon />, classe: "border-[#CFE2D3] bg-[#EAF4EC] text-[#3F7D5B]" },
    { numero: "02", titulo: "Levantamento", icon: <LockIcon clock />, classe: "border-[#E4C98E] bg-[#FBF1DD] text-[#A77A24]" },
    { numero: "03", titulo: "Escolha da data", icon: <CalendarIcon />, classe: "border-[#E5DBD8] bg-[#F5F1EF] text-[#9A8A86]" },
  ];

  return (
    <div className="relative min-h-[395px] p-[14px]">
      <div className="pointer-events-none select-none opacity-[.55] blur-[1.6px]">
        <CalendarioAgendamento datas={datas} onConfirmar={() => {}} confirmando={false} bloqueado />
      </div>

      <div className="absolute inset-[14px] flex items-center justify-center">
        <div className="w-full max-w-[355px] rounded-[18px] border border-[#E7D4AE] bg-white/90 px-[15px] pb-[15px] pt-[14px] shadow-[0_18px_42px_rgba(95,54,58,.13)] backdrop-blur-[2px]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-[9px]">
              <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[11px] bg-[#F8EEDB] text-[#A77A24]"><LockIcon clock /></span>
              <div className="min-w-0">
                <div className="text-[8px] font-bold uppercase tracking-[.15em] text-[#A77A24]">Etapa 2 de 3</div>
                <div className="pt-[2px] font-heading text-[17px] font-semibold leading-tight text-[#7D2434]">Levantamento financeiro</div>
              </div>
            </div>
            <span className="flex flex-none items-center gap-[5px] rounded-full border border-[#E8D2A9] bg-[#FFF9EF] px-[8px] py-[5px] text-[8px] font-semibold uppercase tracking-[.06em] text-[#8E6420]">
              <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-[#B7862A]" />
              Em análise
            </span>
          </div>

          <p className="pt-[10px] text-[10.5px] font-light leading-[1.5] text-[#786A66]">
            Estamos conferindo seus pagamentos. O prazo desta etapa é de até <strong className="font-semibold text-[#6D5530]">5 dias úteis</strong>.
          </p>

          <div className="relative mt-[13px] grid grid-cols-3 gap-[7px]">
            <div className="pointer-events-none absolute left-[16.5%] right-[16.5%] top-[18px] h-px bg-[#E6D9D5]" />
            <div className="pointer-events-none absolute left-[16.5%] top-[18px] h-px w-[33.5%] bg-[#C89D45]" />
            {etapas.map((item, index) => (
              <div key={item.numero} className={`relative z-[1] min-w-0 rounded-[12px] border px-[5px] pb-[8px] pt-[6px] text-center ${index === 1 ? "border-[#D8BD86] bg-[#FFF9EF]" : "border-[#EDE4E1] bg-white/90"}`}>
                <span className={`mx-auto flex h-[25px] w-[25px] items-center justify-center rounded-full border ${item.classe}`}>{item.icon}</span>
                <span className="block pt-[4px] text-[6.8px] font-bold uppercase tracking-[.12em] text-[#A99894]">{item.numero}</span>
                <span className={`block pt-[2px] text-[8.5px] font-semibold leading-[1.2] ${index === 1 ? "text-[#7D2434]" : "text-[#71615E]"}`}>{item.titulo}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgendaBloqueadaPercentual({ percentual, parcelasNecessarias, datas, etapa = "percentual" }: { percentual: number; parcelasNecessarias: number | null; datas: DataDisponivel[]; etapa?: Etapa }) {
  const levantamento = etapa === "levantamento";

  return (
    <section className="overflow-hidden rounded-[18px] border border-[#EFE4E1] bg-white shadow-[0_10px_26px_rgba(70,42,44,.07)]">
      {!levantamento && (
        <div className="border-b border-[#F0DDDD] bg-[#FFF7F7] px-[13px] py-3">
          <div className="flex items-start gap-[10px]">
            <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-[#F7E9EA] text-[#B65B67]"><LockIcon /></span>
            <div className="min-w-0">
              <div className="text-[8.5px] font-bold uppercase tracking-[.13em] text-[#B65B67]">Minha agenda</div>
              <div className="pt-[2px] font-heading text-[15px] font-semibold leading-[1.25] text-[#7D2434]">Atinja o percentual mínimo para liberar sua agenda</div>
              <div className="pt-[2px] text-[9.6px] font-light leading-[1.45] text-[#7E6867]">Para liberar a escolha da data, você precisa atingir <b className="font-semibold text-[#7D2434]">{percentual}% das parcelas mínimas pagas</b>{parcelasNecessarias ? ` (${parcelasNecessarias} parcelas).` : "."}</div>
            </div>
          </div>
        </div>
      )}

      {levantamento ? (
        <LevantamentoFinanceiro datas={datas} />
      ) : (
        <div className="relative min-h-[395px] p-[14px]">
          <div className="pointer-events-none select-none opacity-[.38] blur-[3.2px]"><CalendarioAgendamento datas={datas} onConfirmar={() => {}} confirmando={false} bloqueado /></div>
          <div className="absolute inset-[14px] flex items-center justify-center">
            <div className="w-full max-w-[345px] rounded-[16px] border border-[#E9D4B2] bg-white/95 px-[18px] pb-[18px] pt-[25px] text-center shadow-[0_20px_48px_rgba(95,54,58,.14)]">
              <div className="mx-auto flex h-[42px] w-[42px] items-center justify-center rounded-full bg-[#F7EFED] text-[#8E3243]"><LockIcon /></div>
              <div className="pt-[13px] text-[8.5px] font-bold uppercase tracking-[.15em] text-[#B65B67]">Agenda bloqueada</div>
              <div className="pt-[6px] font-heading text-[21px] font-semibold leading-[1.15] text-[#7D2434]">Agenda da assinatura dos termos</div>
              <div className="px-[3px] pt-[9px] text-[11px] font-light leading-[1.55] text-[#7C6B68]">Sua agenda permanece visível, porém bloqueada. Assim que você atingir o percentual necessário de pagamentos, iniciaremos seu levantamento financeiro.</div>
              <div className="mt-[13px] flex items-center justify-center gap-[7px] rounded-[10px] border border-[#F0DDDD] bg-[#FFF6F6] px-[10px] py-[9px] text-[8.5px] font-semibold text-[#8E3243]"><LockIcon />Necessário atingir {percentual}% das parcelas mínimas.</div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
