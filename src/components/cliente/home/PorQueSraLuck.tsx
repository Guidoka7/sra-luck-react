import { MarcaSraLuck } from "@/components/cliente/MarcaSraLuck";
import { FRASE_SRA_LUCK, NUMEROS_SRA_LUCK } from "./homeInstitucional";

/** Faixa institucional: números da Sra. Luck e a frase da marca, com acesso à história. */
export function PorQueSraLuck({ onConhecer }: { onConhecer: () => void }) {
  return (
    <section className="sl-porque" aria-label="Por que a Sra. Luck">
      <div className="sl-porque-topo">
        <span className="sl-secao-rotulo">Por que a Sra. Luck</span>
        <MarcaSraLuck className="sl-porque-marca" />
      </div>
      <p className="sl-porque-frase">
        Não vendemos promessas. <em>Nós construímos caminhos.</em>
      </p>
      <div className="sl-porque-numeros">
        {NUMEROS_SRA_LUCK.map((n) => <div key={n.rotulo}><b>{n.valor}</b><span>{n.rotulo}</span></div>)}
      </div>
      <button type="button" className="sl-porque-link" onClick={onConhecer} aria-label={`Conhecer a história da Sra. Luck. ${FRASE_SRA_LUCK}`}>
        Conhecer nossa história
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M9 4.5 12.5 8 9 11.5" /></svg>
      </button>
    </section>
  );
}
