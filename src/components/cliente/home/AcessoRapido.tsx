import type { ReactNode } from "react";
import type { HomeCampaignDestination } from "./homeCampaigns";

const ATALHOS: { destino: HomeCampaignDestination; rotulo: string; icone: ReactNode }[] = [
  {
    destino: "parcelas",
    rotulo: "Pagar parcela",
    icone: <svg viewBox="0 0 24 24"><rect x="3.5" y="6" width="17" height="12.5" rx="2.6" /><path d="M3.5 10h17M7.5 14.5h3.5" /></svg>,
  },
  {
    destino: "clube",
    rotulo: "Meus prêmios",
    icone: <svg viewBox="0 0 24 24"><path d="M19.5 12v8h-15v-8M3 8h18v4H3zM12 20V8" /><path d="M12 8H8.6a2.2 2.2 0 1 1 1.8-3.4L12 8Zm0 0h3.4a2.2 2.2 0 1 0-1.8-3.4L12 8Z" /></svg>,
  },
  {
    destino: "jornada",
    rotulo: "Minha jornada",
    icone: <svg viewBox="0 0 24 24"><circle cx="6" cy="18" r="2.3" /><circle cx="18" cy="6" r="2.3" /><path d="M8.2 17.2c4.5-1.4 1.3-6.7 5.3-8.4 1.2-.5 2-.7 2.3-.9" /></svg>,
  },
  {
    destino: "atendimento",
    rotulo: "Atendimento",
    icone: <svg viewBox="0 0 24 24"><path d="M4 11.5a7.5 7.5 0 0 1 15 0v3.2" /><rect x="3" y="12" width="4" height="6" rx="1.6" /><rect x="17" y="12" width="4" height="6" rx="1.6" /><path d="M19 18c0 1.7-1.6 2.8-4 2.8h-2" /></svg>,
  },
];

/** Atalhos da Início para os destinos mais usados (mesma navegação dos cartões). */
export function AcessoRapido({ onAbrir }: { onAbrir: (destino: HomeCampaignDestination) => void }) {
  return (
    <section className="sl-atalhos" aria-label="Acesso rápido">
      <span className="sl-secao-rotulo">Acesso rápido</span>
      <div className="sl-atalhos-grade">
        {ATALHOS.map((a) => (
          <button key={a.destino} type="button" className="sl-atalho" onClick={() => onAbrir(a.destino)}>
            <span className="sl-atalho-icone" aria-hidden="true">{a.icone}</span>
            <span className="sl-atalho-rotulo">{a.rotulo}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
