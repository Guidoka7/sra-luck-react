/** A data confirmada é somente leitura no app da cliente. */
export function CirurgiaConfirmada({ data }: { data: string }) {
  const [ano, mes, dia] = data.slice(0, 10).split("-").map(Number);
  const dataLocal = new Date(ano, mes - 1, dia);
  const dataFormatada = dataLocal.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });

  return (
    <section aria-label="Data da cirurgia confirmada" className="animate-fadeUp overflow-hidden rounded-[18px] border border-[#D5E8D9] bg-white p-[18px] shadow-[0_7px_20px_rgba(73,42,45,.05)]">
      <div className="flex items-center gap-2 text-[#3F7D5B]">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><circle cx="9" cy="9" r="6.2" /><path d="m6 9 2 2 4-4" /></svg>
        <h2 className="text-[8.5px] font-semibold uppercase tracking-[.13em]">Data da sua cirurgia</h2>
      </div>
      <time dateTime={data.slice(0, 10)} className="mt-3 block font-heading text-[24px] font-semibold leading-snug text-[#7D2434]">{dataFormatada}</time>
    </section>
  );
}
