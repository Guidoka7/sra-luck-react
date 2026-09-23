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
  /** Frase da etapa atual da agenda (a agenda completa vive na aba Agenda). */
  resumoAgenda: string;
  onAbrirAgenda: () => void;
}

export function HomeTab({ nomeCliente, procedimento, quantidadeParcelas, porcentagemPagamento, onCampaignAction, resumoAgenda, onAbrirAgenda }: HomeTabProps) {
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

      <div className="px-5 pt-5">
        <button type="button" onClick={onAbrirAgenda} className="flex w-full items-center gap-3 rounded-[18px] border border-[#E9D6D2] bg-white p-[14px] text-left shadow-[0_8px_22px_rgba(70,42,44,.06)] transition active:scale-[.99]">
          <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[14px] bg-[#F9ECEF] text-[#A84759]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 11h16" /></svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[9.5px] font-bold uppercase tracking-[.14em] text-[#B65B67]">Minha agenda</span>
            <span className="block truncate pt-[2px] font-heading text-[18px] font-semibold leading-[1.15] text-[#6B1F2E]">{resumoAgenda}</span>
          </span>
          <span className="flex-none text-[11px] font-semibold text-[#7D2434]">Abrir ›</span>
        </button>
      </div>

      <PorQueSraLuck onConhecer={() => setHistoriaAberta(true)} />

      <DisciplinaCard />

      <NossaHistoriaFolha aberta={historiaAberta} onFechar={() => setHistoriaAberta(false)} onFalarComEquipe={() => onCampaignAction("atendimento")} />
    </div>
  );
}
