/** A data confirmada é somente leitura no app da cliente. */
export function CirurgiaConfirmada({ data }: { data: string }) {
  const [ano, mes, dia] = data.slice(0, 10).split("-").map(Number);
  const dataLocal = new Date(ano, mes - 1, dia);
  const dataFormatada = dataLocal.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });

  return (
    <section aria-label="Data da cirurgia confirmada" className="animate-fadeUp flex min-h-[190px] flex-col items-center justify-center overflow-hidden rounded-[22px] border border-[#C7A476] border-t-[4px] bg-[#6B1F2E] px-6 py-7 text-center shadow-[0_14px_32px_rgba(107,31,46,.20)]">
      <div className="flex items-center justify-center gap-2 text-[#E8CBA6]">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><circle cx="9" cy="9" r="6.2" /><path d="m6 9 2 2 4-4" /></svg>
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[.15em]">Data da sua cirurgia</h2>
      </div>
      <time dateTime={data.slice(0, 10)} className="mt-5 block max-w-[310px] text-balance font-heading text-[34px] font-semibold leading-[1.2] text-[#FFF9F3]">{dataFormatada}</time>
    </section>
  );
}
