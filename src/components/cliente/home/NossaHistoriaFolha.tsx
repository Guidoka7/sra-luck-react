import camilaLuck from "@/assets/brand/camila-luck.webp";
import { Folha } from "@/components/cliente/clube/ClubeUi";
import { FRASE_SRA_LUCK, HISTORIA_CAMILA, NUMEROS_SRA_LUCK, UNIDADES_SRA_LUCK } from "./homeInstitucional";

/** Folha "Nossa história": quem é a Camila Luck e o que é a Sra. Luck (conteúdo do site oficial). */
export function NossaHistoriaFolha({ aberta, onFechar, onFalarComEquipe }: { aberta: boolean; onFechar: () => void; onFalarComEquipe: () => void }) {
  return (
    <Folha aberta={aberta} onFechar={onFechar} titulo="Nossa história">
      <div className="sl-historia">
        <div className="sl-historia-capa">
          <img src={camilaLuck} alt="Camila Luck, fundadora da Sra. Luck" loading="lazy" decoding="async" />
          <div className="sl-historia-capa-texto">
            <span>Fundadora</span>
            <strong>Camila<br /><em>Luck</em></strong>
          </div>
        </div>

        {HISTORIA_CAMILA.map((paragrafo) => <p key={paragrafo.slice(0, 24)}>{paragrafo}</p>)}

        <blockquote className="sl-historia-frase">“{FRASE_SRA_LUCK}”</blockquote>

        <div className="sl-historia-numeros">
          {NUMEROS_SRA_LUCK.map((n) => <div key={n.rotulo}><b>{n.valor}</b><span>{n.rotulo}</span></div>)}
        </div>

        <div className="sl-historia-unidades">
          <span className="sl-historia-rotulo">Nossas unidades</span>
          {UNIDADES_SRA_LUCK.map((u) => (
            <div key={u.nome}><strong>{u.nome}</strong><span>{u.endereco}</span></div>
          ))}
        </div>

        <button type="button" className="sl-historia-cta" onClick={() => { onFechar(); onFalarComEquipe(); }}>Falar com a equipe</button>
      </div>
    </Folha>
  );
}
