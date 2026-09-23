import { useEffect, useState } from "react";
import { MarcaSraLuck } from "@/components/cliente/MarcaSraLuck";
import { fraseDoDia, trechosDaFrase, FUSO_SRA_LUCK } from "@/lib/fraseDoDia";

function dataPorExtenso(agora: Date) {
  const texto = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_SRA_LUCK, weekday: "long", day: "numeric", month: "long" }).format(agora);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Cartão "Frase do dia" da Início. A frase vem do motor em src/lib/fraseDoDia.ts
 * e troca sozinha na virada do dia (horário de Brasília), inclusive com o app aberto.
 */
export function DisciplinaCard() {
  const [agora, setAgora] = useState(() => new Date());
  const frase = fraseDoDia(agora);

  useEffect(() => {
    const atualizar = () => setAgora((antes) => {
      const novo = new Date();
      return fraseDoDia(novo).data === fraseDoDia(antes).data ? antes : novo;
    });
    const timer = window.setInterval(atualizar, 60_000);
    const aoVoltar = () => { if (document.visibilityState === "visible") atualizar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", aoVoltar); };
  }, []);

  return (
    <section className="sl-frase" aria-label="Frase do dia">
      <div className="sl-frase-topo">
        <span className="sl-frase-rotulo">Frase do dia</span>
        <time className="sl-frase-data" dateTime={frase.data}>{dataPorExtenso(agora)}</time>
      </div>
      <p className="sl-frase-texto">
        {trechosDaFrase(frase.texto).map((t, i) => (t.destaque ? <em key={i}>{t.texto}</em> : <span key={i}>{t.texto}</span>))}
      </p>
      <div className="sl-frase-rodape">
        <span className="sl-frase-tema">{frase.tema}</span>
        <MarcaSraLuck className="sl-frase-marca" />
      </div>
    </section>
  );
}
