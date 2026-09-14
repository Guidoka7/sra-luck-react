import { useCallback, useEffect, useState } from "react";
import { apiJson } from "../lib/api";
import { primeiroNome } from "../lib/utils";
import { CelebracaoData } from "@/components/cliente/CelebracaoData";
import { BottomNav, type ClientTab } from "@/components/cliente/nav/BottomNav";
import { useNotificacoesCliente, type NotificacaoCliente } from "@/lib/clientNotifications";
import type { CardPaymentConfig } from "@/lib/cardPayment";
import { HomeTab } from "@/pages/client/HomeTab";
import { ParcelasTab } from "@/pages/client/ParcelasTab";
import { JornadaTab } from "@/pages/client/JornadaTab";
import { NotificacoesTab } from "@/pages/client/NotificacoesTab";
import { MaisTab } from "@/pages/client/MaisTab";

type StatusRevisaoFinanceira = "pendente" | "aprovada" | "recusada" | null;

type AgendaData = {
  cliente: { id: string; nome: string; procedimento: string | null };
  agendamentoAtivo: { id: string; data: string; horario: string | null; previsaoLiberacaoFinanceira: string | null; status?: string } | null;
  agendamentoConcluido: { id: string; data: string; horario: string | null; previsaoLiberacaoFinanceira: string | null; status?: string } | null;
  datasDisponiveis: { id: string; data: string; vagasRestantes: number }[];
};

type BoletosData = {
  boletos: unknown[];
  porcentagem_pagamento: number;
  pode_agendar: boolean;
  agenda_liberada: boolean;
  status_revisao_financeira: StatusRevisaoFinanceira;
  observacao_revisao_financeira?: string | null;
  quantidade_parcelas: number | null;
};

type ClienteConfig = {
  pixChave: string | null;
  pixQrCodeUrl: string | null;
  pixDescontoPercentual: number;
  cartao: CardPaymentConfig;
};

export function AgendaPage() {
  const [agenda, setAgenda] = useState<AgendaData | null>(null);
  const [boletos, setBoletos] = useState<BoletosData | null>(null);
  const [config, setConfig] = useState<ClienteConfig | null>(null);
  const [aba, setAba] = useState<ClientTab>("inicio");
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [celebrando, setCelebrando] = useState<string | null>(null);

  const notificacoesState = useNotificacoesCliente();

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      const [agendaData, boletosData, configData] = await Promise.all([
        apiJson<AgendaData>("/api/cliente/agenda", { cache: "no-store" }),
        apiJson<BoletosData>("/api/cliente/boletos", { cache: "no-store" }),
        apiJson<ClienteConfig>("/api/cliente/config", { cache: "no-store" }).catch(() => null),
      ]);
      setAgenda(agendaData);
      setBoletos(boletosData);
      if (configData) setConfig(configData);
      setErro(null);
    } catch (error) {
      if (error instanceof Error && error.message === "Sessão expirada.") {
        window.history.pushState({}, "", "/login");
        window.dispatchEvent(new PopStateEvent("popstate"));
        return;
      }
      setErro(error instanceof Error ? error.message : "Não foi possível carregar sua área.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
    const timer = window.setInterval(() => void carregar(true), 30000);
    return () => window.clearInterval(timer);
  }, [carregar]);

  async function sair() {
    await fetch("/api/cliente/logout", { method: "POST", credentials: "same-origin" });
    window.history.pushState({}, "", "/login");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  async function escolherData(dataId: string, horario: string) {
    setConfirmando(true);
    setErro(null);
    try {
      const resultado = await apiJson<{ data: string }>("/api/cliente/agendar", {
        method: "POST",
        body: JSON.stringify({ dataId, horario }),
      });
      setCelebrando(resultado.data);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível confirmar essa data.");
    } finally {
      setConfirmando(false);
    }
  }

  function abrirNotificacao(notificacao: NotificacaoCliente) {
    if (notificacao.destino === "agenda") setAba("inicio");
    else if (notificacao.destino === "parcelas") setAba("parcelas");
    else if (notificacao.destino === "clube") setAba("mais");
    else if (notificacao.destino === "jornada") setAba("jornada");
  }

  if (loading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-bloom">
        <img src="/brand/sra-luck-mark.png" alt="Sra. Luck" className="h-10 w-10 animate-pulse object-contain" />
      </main>
    );
  }

  if (!agenda || !boletos) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-bloom p-6">
        <section className="surface-glass w-full max-w-md rounded-[28px] p-8 text-center">
          <p className="text-sm text-clay/70">Não foi possível carregar sua área.</p>
          {erro && <p className="mt-2 text-xs text-alert">{erro}</p>}
          <button className="mt-5 rounded-full bg-burgundy px-5 py-2.5 text-xs font-semibold uppercase tracking-label text-pearl" onClick={() => void carregar()}>
            Tentar novamente
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="client-app min-h-[100dvh] bg-bloom px-4 pb-24 sm:px-6">
      {celebrando && (
        <CelebracaoData
          data={celebrando}
          nome={primeiroNome(agenda.cliente.nome)}
          onFechar={() => {
            setCelebrando(null);
            void carregar();
          }}
        />
      )}

      <div className="mobile-app-frame mx-auto w-full max-w-2xl sm:max-w-[30rem]">
        {erro && <div role="alert" className="mb-4 rounded-2xl border border-alert/20 bg-alert/5 px-4 py-3 text-sm text-alert">{erro}</div>}

        {aba === "inicio" && (
          <HomeTab
            nomeCliente={agenda.cliente.nome}
            procedimento={agenda.cliente.procedimento}
            quantidadeParcelas={boletos.quantidade_parcelas}
            porcentagemPagamento={boletos.porcentagem_pagamento ?? 0}
            naoLidas={notificacoesState.naoLidas}
            onAbrirNotificacoes={() => setAba("notificacoes")}
            agendamentoAtivo={agenda.agendamentoAtivo}
            agendamentoConcluido={agenda.agendamentoConcluido}
            datasDisponiveis={agenda.datasDisponiveis}
            podeAgendar={boletos.pode_agendar}
            agendaLiberada={boletos.agenda_liberada}
            statusRevisaoFinanceira={boletos.status_revisao_financeira}
            observacaoRevisaoFinanceira={boletos.observacao_revisao_financeira}
            confirmando={confirmando}
            onEscolherData={escolherData}
          />
        )}

        {aba === "parcelas" && (
          <ParcelasTab
            procedimento={agenda.cliente.procedimento}
            pagamento={config ? { pixChave: config.pixChave, pixQrCodeUrl: config.pixQrCodeUrl, pixDescontoPercentual: config.pixDescontoPercentual } : undefined}
            cartao={config?.cartao}
          />
        )}

        {aba === "jornada" && (
          <JornadaTab
            porcentagemPagamento={boletos.porcentagem_pagamento ?? 0}
            percentualAtingido={boletos.pode_agendar}
            statusRevisaoFinanceira={boletos.status_revisao_financeira}
            agendaLiberada={boletos.agenda_liberada}
            agendamentoAtivo={agenda.agendamentoAtivo}
            agendamentoConcluido={agenda.agendamentoConcluido}
            notificacoesCompactas={notificacoesState.notificacoes}
            onVerNotificacoes={() => setAba("notificacoes")}
          />
        )}

        {aba === "notificacoes" && (
          <NotificacoesTab
            notificacoes={notificacoesState.notificacoes}
            naoLidas={notificacoesState.naoLidas}
            carregando={notificacoesState.carregando}
            onMarcarLida={(id) => void notificacoesState.marcarLida(id)}
            onMarcarTodasLidas={() => void notificacoesState.marcarTodasLidas()}
            onAcao={abrirNotificacao}
          />
        )}

        {aba === "mais" && (
          <MaisTab nomeCliente={agenda.cliente.nome} onSair={() => void sair()} onIrParcelas={() => setAba("parcelas")} />
        )}
      </div>

      <BottomNav aba={aba} onSelecionar={setAba} naoLidas={notificacoesState.naoLidas} />
    </main>
  );
}
