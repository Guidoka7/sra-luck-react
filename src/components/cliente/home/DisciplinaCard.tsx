export function DisciplinaCard() {
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-rose/12 bg-blush/45 px-5 py-6 text-center">
      <img
        src="/brand/sra-luck-mark.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 object-contain opacity-[0.07]"
      />
      <p className="relative font-heading text-base font-semibold italic leading-snug text-burgundy sm:text-lg">
        “Disciplina hoje, resultados sempre.”
      </p>
      <p className="relative mt-1.5 text-[0.65rem] font-semibold uppercase tracking-label text-clay/45">— Sra. Luck</p>
    </div>
  );
}
