import { ClientProfileHeader } from "@/components/cliente/home/ClientProfileHeader";
import { HomeCampaignCarousel } from "@/components/cliente/home/HomeCampaignCarousel";
import { useState } from "react";
import { DisciplinaCard } from "@/components/cliente/home/DisciplinaCard";
import { AcessoRapido } from "@/components/cliente/home/AcessoRapido";
import { PorQueSraLuck } from "@/components/cliente/home/PorQueSraLuck";
import { NossaHistoriaFolha } from "@/components/cliente/home/NossaHistoriaFolha";
import { primeiroNome, type HomeCampaignDestination } from "@/components/cliente/home/homeCampaigns";

interface HomeTabProps {
  nomeCliente: string;
  procedimento: string | null;
  quantidadeParcelas: number | null;
  porcentagemPagamento: number;
  /** Destino do CTA do carrossel; a navegação fica no shell do app (AgendaPage). */
  onCampaignAction: (destination: HomeCampaignDestination) => void;
}

export function HomeTab({ nomeCliente, procedimento, quantidadeParcelas, porcentagemPagamento, onCampaignAction }: HomeTabProps) {
  const [historiaAberta, setHistoriaAberta] = useState(false);
  // "historia" abre a folha aqui mesmo; os demais destinos navegam pelo shell do app.
  const abrir = (destino: HomeCampaignDestination) => {
    if (destino === "historia") setHistoriaAberta(true);
    else onCampaignAction(destino);
  };

  return (
    <div>
      <ClientProfileHeader
        nomeCliente={nomeCliente}
        procedimento={procedimento}
        quantidadeParcelas={quantidadeParcelas}
        percentualPago={porcentagemPagamento}
      />

      <HomeCampaignCarousel
        onAction={(slide) => abrir(slide.action)}
        contexto={{ nome: primeiroNome(nomeCliente), percentualPago: porcentagemPagamento }}
      />

      <AcessoRapido onAbrir={abrir} />


      <PorQueSraLuck onConhecer={() => setHistoriaAberta(true)} />

      <DisciplinaCard />

      <NossaHistoriaFolha aberta={historiaAberta} onFechar={() => setHistoriaAberta(false)} onFalarComEquipe={() => onCampaignAction("atendimento")} />
    </div>
  );
}
