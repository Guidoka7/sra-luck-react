import { LOGO_SRC } from "@/assets/brand";
export function DisciplinaCard() {
  return (
    <div className="sl-discipline">
      <img src={LOGO_SRC} alt="" aria-hidden="true" className="sl-discipline-watermark" />
      <div className="sl-discipline-copy">Disciplina hoje, resultados sempre.</div>
      <img src={LOGO_SRC} alt="Sra. Luck" className="sl-discipline-logo" />
    </div>
  );
}
