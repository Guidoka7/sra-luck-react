import { useCallback, useEffect, useState } from "react";
import { apiJson } from "../lib/api";
import { primeiroNome } from "../lib/utils";
import { CelebracaoData } from "@/components/cliente/CelebracaoData";
import { MomentoEspecialCelebracao } from "@/components/cliente/MomentoEspecialCelebracao";
import { BottomNav, type ClientTab } from "@/components/cliente/nav/BottomNav";
import { useNotificacoesCliente, type NotificacaoCliente } from "@/lib/clientNotifications";
import { HomeTab } from "@/pages/client/HomeTab";
import { ParcelasTab } from "@/pages/client/ParcelasTab";
import { JornadaTab } from "@/pages/client/JornadaTab";
import { journeyInputFromProcess } from "@/lib/journeySteps";
import { NotificacoesTab } from "@/pages/client/NotificacoesTab";
import { MaisTab } from "@/pages/client/MaisTab";

type StatusRevisaoFinanceira = "pendente" | "aprovada" | "recusada" | null;
type StatusCusteio = "pendente" | "em_analise" | "aprovada" | "recusada" | null;

type StatusComparecimento = "pendente" | "compareceu" | "nao_compareceu";
type StatusQuitacao = "pendente" | "paga" | "nao_realizada";

type AgendamentoAgenda = {
  id: string;
  data: string;
  horario: string | null;
  termosAssinadosEm: string | null;
  comparecimentoStatus: StatusComparecimento;
  quitacaoStatus: StatusQuitacao;
  previsaoCirurgia: string | null;
  dataCirurgia: string | null;
  horarioCirurgia: string | null;
  status?: string;
};

type AgendaData = {
  cliente: { id: string; nome: string; procedimento: string | null };
  elegibilidade: { elegivel: boolean; liberacaoFinanceiraSolicitada: boolean; liberacaoFinanceiraSolicitadaEm: string | null };
  financeiro: { statusCirurgia: string | null };
  solicitacaoLiberacaoFinanceira: { id: string; status: StatusCusteio } | null;
  agendamentoAtivo: AgendamentoAgenda | null;
  agendamentoConcluido: AgendamentoAgenda | null;
  datasDisponiveis: { id: string; data: string; vagasRestantes: number }[];
  agendaCirurgicaLiberada: boolean;
  agendaCirurgicaLiberarEm: string | null;
};

type BoletosData = {
  boletos: unknown[];
  porcentagem_pagamento: number;
  parcelas_pagas: number;
  pode_agendar: boolean;
  agenda_liberada: boolean;
  status_revisao_financeira: StatusRevisaoFinanceira;
  observacao_revisao_financeira?: string | null;
  quantidade_parcelas: number | null;
};

export function AgendaPage() {
  const [agenda, setAgenda] = useState<AgendaData | null>(null);
  const [boletos, setBoletos] = useState<BoletosData | null>(null);
  const [aba, setAba] = useState<ClientTab>("inicio");
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [celebrando, setCelebrando] = useState<string | null>(null);

  const notificacoesState = useNotificacoesCliente();

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      const [agendaData, boletosData] = await Promise.all([
        apiJson<AgendaData>("/api/cliente/agenda", { cache: "no-store" }),
        apiJson<BoletosData>("/api/cliente/boletos", { cache: "no-store" }),
      ]);
      setAgenda(agendaData);
      setBoletos(boletosData);
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
      <main className="client-app flex min-h-[100dvh] items-center justify-center">
        <div className="mobile-app-frame flex items-center justify-center">
          <img src="/brand/sra-luck-logo.png" alt="Sra. Luck" className="w-[104px] animate-pulse object-contain" />
        </div>
      </main>
    );
  }

  if (!agenda || !boletos) {
    return (
      <main className="client-app min-h-[100dvh]">
        <div className="mobile-app-frame flex items-center justify-center px-5">
          <section className="w-full rounded-[20px] border border-[#EFE2DE] bg-white p-6 text-center shadow-[0_5px_18px_rgba(46,36,34,.055)]">
            <p className="text-[13px] font-normal text-[#7F6E6A]">Não foi possível carregar sua área.</p>
            {erro && <p className="mt-2 text-[11px] text-[#B3342E]">{erro}</p>}
            <button className="mt-5 rounded-[14px] bg-[#6B1F2E] px-5 py-3 text-[12px] font-medium text-[#FBF7F5]" onClick={() => void carregar()}>
              Tentar novamente
            </button>
          </section>
        </div>
      </main>
    );
  }

  const agendaAtual = agenda.agendamentoAtivo ?? agenda.agendamentoConcluido;
  const custeioStatus: StatusCusteio = agenda.solicitacaoLiberacaoFinanceira?.status ?? null;
  const custeioAprovado = Boolean(custeioStatus && custeioStatus !== "recusada");
  const cirurgiaRealizada = agenda.financeiro.statusCirurgia === "realizada";

  return (
    <main className="client-app min-h-[100dvh]">
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

      <MomentoEspecialCelebracao />

      <div className="mobile-app-frame">
        {erro && <div role="alert" className="mx-5 mt-3 rounded-[14px] border border-[#F0D3D1] bg-[#FBEBEA] px-4 py-3 text-[11px] text-[#8F2A25]">{erro}</div>}

        {aba === "inicio" && (
          <HomeTab
            nomeCliente={agenda.cliente.nome}
            procedimento={agenda.cliente.procedimento}
            quantidadeParcelas={boletos.quantidade_parcelas}
            porcentagemPagamento={boletos.porcentagem_pagamento ?? 0}
            parcelasPagas={boletos.parcelas_pagas ?? 0}
            naoLidas={notificacoesState.naoLidas}
            onAbrirNotificacoes={() => setAba("notificacoes")}
            agendamentoAtivo={agenda.agendamentoAtivo}
            agendamentoConcluido={agenda.agendamentoConcluido}
            datasDisponiveis={agenda.datasDisponiveis}
            podeAgendar={boletos.pode_agendar}
            agendaLiberada={boletos.agenda_liberada}
            statusRevisaoFinanceira={boletos.status_revisao_financeira}
            observacaoRevisaoFinanceira={boletos.observacao_revisao_financeira}
            liberacaoFinanceiraSolicitada={agenda.elegibilidade.liberacaoFinanceiraSolicitada}
            custeioAprovado={custeioAprovado}
            confirmando={confirmando}
            onEscolherData={escolherData}
            onCusteioSelecionado={() => carregar(true)}
            onLiberacaoSolicitada={() => carregar(true)}
          />
        )}

        {aba === "parcelas" && <ParcelasTab procedimento={agenda.cliente.procedimento} />}

        {aba === "jornada" && (
          <JornadaTab
            {...journeyInputFromProcess({
              percentualPagamento: boletos.porcentagem_pagamento ?? 0,
              percentualAtingido: boletos.pode_agendar,
              statusRevisao: boletos.status_revisao_financeira,
              custeioStatus,
              temAgendamentoTermos: Boolean(agendaAtual),
              comparecimentoConfirmado: agendaAtual?.comparecimentoStatus === "compareceu",
              processoConcluido: Boolean(agenda.agendamentoConcluido),
              agendaCirurgicaLiberadaEm: agenda.agendaCirurgicaLiberarEm,
              dataCirurgia: agendaAtual?.dataCirurgia ?? null,
              cirurgiaRealizada,
            })}
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
