/** A data confirmada é somente leitura no app da cliente. */
export function CirurgiaConfirmada({ data }: { data: string }) {
  const [ano, mes, dia] = data.slice(0, 10).split("-").map(Number);
  const dataLocal = new Date(ano, mes - 1, dia);
  const dataFormatada = dataLocal.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });

  return (
    <section aria-label="Data da cirurgia confirmada" className="animate-fadeUp flex items-center gap-3 rounded-[16px] border border-[#EADFDB] bg-white p-4 shadow-[0_3px_12px_rgba(73,42,45,.035)]">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-[#F8F0EE] text-[#9B6670]">
        <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 11h16" /></svg>
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[10px] font-medium text-[#8A7772]">Data da sua cirurgia</h2>
        <time dateTime={data.slice(0, 10)} className="mt-1 block font-heading text-[22px] font-semibold leading-[1.3] text-[#7D2434]">{dataFormatada}</time>
      </div>
    </section>
  );
}
