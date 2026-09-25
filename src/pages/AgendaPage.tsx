import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson } from "../lib/api";
import { primeiroNome } from "../lib/utils";
import { CelebracaoData } from "@/components/cliente/CelebracaoData";
import { MomentoEspecialCelebracao } from "@/components/cliente/MomentoEspecialCelebracao";
import { BottomNav, type ClientTab } from "@/components/cliente/nav/BottomNav";
import { resolveHomeCampaignNavigation, type HomeCampaignDestination } from "@/components/cliente/home/homeCampaigns";
import { abaDoDestino, destinoDaUrl, useNotificacoesCliente, type NotificacaoCliente } from "@/lib/clientNotifications";
import { subscribeAgendaSync } from "@/lib/agendaRealtime";
import { HomeTab } from "@/pages/client/HomeTab";
import { ParcelasTab } from "@/pages/client/ParcelasTab";
import { JornadaTab } from "@/pages/client/JornadaTab";
import { journeyInputFromProcess } from "@/lib/journeySteps";
import { NotificationBell } from "@/components/cliente/nav/NotificationBell";
import { MenuButton } from "@/components/cliente/nav/MenuButton";
import { ClubeScreen } from "@/components/cliente/clube/ClubeScreen";
import { MaisTab, type MaisSubTelaInicial } from "@/pages/client/MaisTab";
import { AgendaTab } from "@/pages/client/AgendaTab";
import { lerCacheCliente, limparCacheCliente, salvarCacheCliente, type AgendaData, type BoletosData, type StatusCusteio } from "@/lib/clienteAgenda";
import { LOGO_SRC } from "@/assets/brand";
import { registrarAcesso } from "@/lib/monitoramento";
import { WhatsAppFab } from "@/components/cliente/WhatsAppFab";
import { Folha } from "@/components/cliente/clube/ClubeUi";
import { aplicarTemaCliente, useTemaCliente } from "@/lib/temaCliente";
import { useRegrasApp } from "@/lib/regrasOperacionais";
import type { PagamentoConfig } from "@/components/cliente/parcelas/ParcelasPrototype";

export function AgendaPage() {
  // Percentuais e prazo configurados (Dev): re-renderiza quando chegam do servidor.
  useRegrasApp();
  // Último estado conhecido (cache local): a área abre na hora ao recarregar
  // e é revalidada em silêncio logo em seguida.
  const [cacheInicial] = useState(lerCacheCliente);
  const [agenda, setAgenda] = useState<AgendaData | null>(cacheInicial?.agenda ?? null);
  const [boletos, setBoletos] = useState<BoletosData | null>(cacheInicial?.boletos ?? null);
  // O app sempre abre na Início (inclusive ao atualizar a página).
  const [aba, setAba] = useState<ClientTab>("inicio");
  // Histórico de acesso da cliente: cada aba aberta vira uma linha no monitoramento.
  useEffect(() => { registrarAcesso(`app:${aba}`); }, [aba]);
  const [notificacoesAbertas, setNotificacoesAbertas] = useState(false);
  const abaAntesDoMais = useRef<ClientTab>("inicio");
  const [maisSubTelaInicial, setMaisSubTelaInicial] = useState<MaisSubTelaInicial | null>(null);
  const [loading, setLoading] = useState(!cacheInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [celebrando, setCelebrando] = useState<string | null>(null);
  const [whatsappContato, setWhatsappContato] = useState<string | null>(null);
  const [pagamento, setPagamento] = useState<PagamentoConfig | undefined>(undefined);

  const notificacoesState = useNotificacoesCliente();
  const { efetivo: tema } = useTemaCliente();

  // Tema do app da cliente (claro/escuro/automático): vale só enquanto a área
  // da cliente está aberta; ao sair, o documento volta ao padrão.
  useEffect(() => { aplicarTemaCliente(tema); }, [tema]);
  useEffect(() => () => aplicarTemaCliente(null), []);

  useEffect(() => {
    let ativo = true;
    void apiJson<PagamentoConfig & { whatsappContato?: string | null }>("/api/cliente/config", { cache: "no-store" })
      .then((dados) => { if (ativo) { setWhatsappContato(dados.whatsappContato ?? null); setPagamento(dados); } })
      .catch(() => { if (ativo) setWhatsappContato(null); });
    return () => { ativo = false; };
  }, []);

  const cargaEmCurso = useRef<Promise<void> | null>(null);
  const carregar = useCallback(async (silencioso = false) => {
    if (cargaEmCurso.current) return cargaEmCurso.current;
    const tarefa = (async () => {
    if (!silencioso) setLoading(true);
    try {
      const [agendaData, boletosData] = await Promise.all([
        apiJson<AgendaData>("/api/cliente/agenda", { cache: "no-store" }),
        apiJson<BoletosData>("/api/cliente/boletos", { cache: "no-store" }),
      ]);
      setAgenda(agendaData);
      setBoletos(boletosData);
      salvarCacheCliente(agendaData, boletosData);
      setErro(null);
    } catch (error) {
      if (error instanceof Error && error.message === "Sessão expirada.") {
        limparCacheCliente();
        window.history.pushState({}, "", "/login");
        window.dispatchEvent(new PopStateEvent("popstate"));
        return;
      }
      setErro(error instanceof Error ? error.message : "Não foi possível carregar sua área.");
    } finally {
      setLoading(false);
    }
    })();
    cargaEmCurso.current = tarefa;
    try { await tarefa; } finally { if (cargaEmCurso.current === tarefa) cargaEmCurso.current = null; }
  }, []);


  useEffect(() => {
    void carregar(Boolean(cacheInicial));

    let realtimeDebounce: number | undefined;
    const atualizarAgora = () => {
      window.clearTimeout(realtimeDebounce);
      realtimeDebounce = window.setTimeout(() => void carregar(true), 300 + Math.random() * 4700);
    };

    // Realtime é o caminho principal: qualquer abertura/fechamento de data,
    // alteração de capacidade ou novo agendamento dispara um novo GET
    // autenticado. O sinal público não contém dados da cliente.
    const unsubscribeRealtime = subscribeAgendaSync(() => atualizarAgora());

    // Fallback de segurança caso WebSocket/realtime seja interrompido.
    // Só consulta enquanto o app está visível para evitar tráfego inútil.
    let fallbackTimer: number | undefined;
    const agendarFallback = () => {
      fallbackTimer = window.setTimeout(() => {
        if (document.visibilityState === "visible") void carregar(true);
        agendarFallback();
      }, 60_000 + Math.random() * 30_000);
    };
    agendarFallback();

    const aoVoltar = () => {
      if (document.visibilityState === "visible") atualizarAgora();
    };
    const aoFoco = aoVoltar;
    const aoOnline = aoVoltar;

    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoFoco);
    window.addEventListener("online", aoOnline);

    return () => {
      window.clearTimeout(realtimeDebounce);
      window.clearTimeout(fallbackTimer);
      unsubscribeRealtime();
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoFoco);
      window.removeEventListener("online", aoOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregar]);

  // Botão "voltar" do celular: nunca leva ao login nem desloga sozinho.
  // Uma entrada-guarda no histórico segura o voltar: em outra aba volta para a
  // Início; na Início pergunta se a cliente quer sair da conta.
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  const saindoRef = useRef(false);
  const estadoVoltarRef = useRef({ aba, notificacoesAbertas, confirmarSaida });
  estadoVoltarRef.current = { aba, notificacoesAbertas, confirmarSaida };
  useEffect(() => {
    const armar = () => window.history.pushState({ slGuardaVoltar: true }, "", window.location.href);
    if (!(window.history.state as { slGuardaVoltar?: boolean } | null)?.slGuardaVoltar) armar();
    const aoVoltar = () => {
      if (saindoRef.current) return;
      armar();
      const atual = estadoVoltarRef.current;
      if (atual.confirmarSaida) setConfirmarSaida(false);
      else if (atual.notificacoesAbertas) setNotificacoesAbertas(false);
      else if (atual.aba !== "inicio") setAba("inicio");
      else setConfirmarSaida(true);
    };
    window.addEventListener("popstate", aoVoltar);
    return () => window.removeEventListener("popstate", aoVoltar);
  }, []);

  async function sair() {
    saindoRef.current = true;
    setConfirmarSaida(false);
    limparCacheCliente();
    await fetch("/api/cliente/logout", { method: "POST", credentials: "same-origin" });
    window.history.replaceState({}, "", "/login");
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
      // Se a data acabou de ser fechada/ocupada, remove imediatamente o
      // estado visual obsoleto antes de a cliente tentar novamente.
      await carregar(true);
    } finally {
      setConfirmando(false);
    }
  }

  const abrirDestino = useCallback((destino: string | null | undefined) => {
    const alvo = abaDoDestino(destino);
    if (!alvo) return;
    setNotificacoesAbertas(false);
    setMaisSubTelaInicial(alvo.maisSubTela ?? null);
    setAba(alvo.aba);
  }, []);

  function abrirNotificacao(notificacao: NotificacaoCliente) {
    abrirDestino(notificacao.destino);
  }

  // Notificação push com o app aberto: o service worker não recarrega mais a
  // página; ele avisa o app, que busca os dados novos em silêncio e, no toque,
  // abre a aba da notificação. Aberto a partir de um push (app fechado), o
  // destino chega na URL e é aplicado uma vez.
  const recarregarNotificacoes = notificacoesState.carregar;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const destinoInicial = destinoDaUrl(window.location.href);
    if (destinoInicial) {
      abrirDestino(destinoInicial);
      ["abrirComprovante", "destino", "aba"].forEach((chave) => params.delete(chave));
      const busca = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${busca ? `?${busca}` : ""}`);
    }
    if (!("serviceWorker" in navigator)) return;
    const aoReceber = (evento: MessageEvent) => {
      const dados = evento.data as { type?: string; url?: string; destino?: string | null } | null;
      if (!dados?.type?.startsWith("sra-luck:")) return;
      void carregar(true);
      void recarregarNotificacoes();
      if (dados.type === "sra-luck:abrir") abrirDestino(dados.destino ?? destinoDaUrl(dados.url));
    };
    navigator.serviceWorker.addEventListener("message", aoReceber);
    return () => navigator.serviceWorker.removeEventListener("message", aoReceber);
  }, [abrirDestino, carregar, recarregarNotificacoes]);

  /** CTAs do carrossel da Home → abas/subtelas já existentes do app. */
  function abrirDestinoCampanha(destino: HomeCampaignDestination) {
    const nav = resolveHomeCampaignNavigation(destino);
    if (!nav) return;
    setMaisSubTelaInicial(nav.maisSubTela ?? null);
    setAba(nav.tab);
    if (nav.openNotifications) setNotificacoesAbertas(true);
  }

  const consumirMaisSubTela = useCallback(() => setMaisSubTelaInicial(null), []);
  // Estável: EscolherFormaPagamento o usa como dependência de efeito.
  const recarregarSilencioso = useCallback(() => carregar(true), [carregar]);

  /** O botão de menu abre o Mais e, se ele já estiver aberto, volta à aba anterior. */
  function alternarMais() {
    if (aba === "mais") { selecionarAba(abaAntesDoMais.current); return; }
    abaAntesDoMais.current = aba;
    selecionarAba("mais");
  }

  function selecionarAba(abaSelecionada: ClientTab) {
    setMaisSubTelaInicial(null);
    setNotificacoesAbertas(false);
    setAba(abaSelecionada);
  }

  if (loading) {
    return (
      <main className="client-app flex min-h-[100dvh] items-center justify-center">
        <div className="mobile-app-frame flex items-center justify-center">
          <img src={LOGO_SRC} alt="Sra. Luck" className="w-[104px] animate-pulse object-contain" />
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
  const custeioStatus = (agenda.solicitacaoLiberacaoFinanceira?.status ?? null) as StatusCusteio;
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
            void carregar(true);
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
            onCampaignAction={abrirDestinoCampanha}
          />
        )}

        {aba === "agenda" && (
          <AgendaTab
            agendamentoAtivo={agenda.agendamentoAtivo}
            agendamentoConcluido={agenda.agendamentoConcluido}
            datasDisponiveis={agenda.datasDisponiveis}
            quantidadeParcelas={boletos.quantidade_parcelas}
            parcelasPagas={boletos.parcelas_pagas ?? 0}
            podeAgendar={boletos.pode_agendar}
            agendaLiberada={boletos.agenda_liberada}
            statusRevisaoFinanceira={boletos.status_revisao_financeira}
            observacaoRevisaoFinanceira={boletos.observacao_revisao_financeira}
            liberacaoFinanceiraSolicitada={agenda.elegibilidade.liberacaoFinanceiraSolicitada}
            custeioAprovado={custeioAprovado}
            confirmando={confirmando}
            onEscolherData={escolherData}
            onCusteioSelecionado={recarregarSilencioso}
            onAgendaAtualizada={recarregarSilencioso}
            onLiberacaoSolicitada={recarregarSilencioso}
            snapshot={agenda}
            parcelasNaoPagas={boletos.parcelas_nao_pagas ?? null}
            onIrFinanceiro={() => setAba("parcelas")}
            onFalarEquipe={() => { setMaisSubTelaInicial("atendimento"); setAba("mais"); }}
          />
        )}

        {aba === "premios" && <ClubeScreen onIrParcelas={() => setAba("parcelas")} nomeCliente={agenda.cliente.nome} />}

        {aba === "parcelas" && <ParcelasTab procedimento={agenda.cliente.procedimento} boletos={boletos} pagamento={pagamento} onAtualizar={recarregarSilencioso} />}

        {aba === "mais" && (
          <MaisTab
            nomeCliente={agenda.cliente.nome}
            onSair={() => void sair()}
            renderJornada={(onVoltar) => (
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
                onVerNotificacoes={() => setNotificacoesAbertas(true)}
                onVoltar={onVoltar}
              />
            )}
            initialSubTela={maisSubTelaInicial}
            onInitialSubTelaConsumed={consumirMaisSubTela}
          />
        )}
      </div>

      <MenuButton ativo={aba === "mais"} onClick={alternarMais} />

      <NotificationBell
        aberto={notificacoesAbertas}
        onAbertoChange={setNotificacoesAbertas}
        notificacoes={notificacoesState.notificacoes}
        naoLidas={notificacoesState.naoLidas}
        carregando={notificacoesState.carregando}
        onMarcarLida={(id) => void notificacoesState.marcarLida(id)}
        onMarcarTodasLidas={() => void notificacoesState.marcarTodasLidas()}
        onAcao={abrirNotificacao}
      />

      <Folha aberta={confirmarSaida} onFechar={() => setConfirmarSaida(false)} titulo="Sair da sua conta?">
        <p className="m-0 text-[13.5px] leading-[1.5] text-[#7F6F6B]">Você vai precisar entrar de novo com CPF e data de nascimento. Para só fechar o app, use o botão de início do celular.</p>
        <div className="mt-4 flex flex-col gap-2">
          <button type="button" onClick={() => setConfirmarSaida(false)} className="w-full rounded-[14px] bg-[#6B1F2E] px-4 py-[14px] text-[14.5px] font-semibold text-white">Continuar no app</button>
          <button type="button" onClick={() => void sair()} className="w-full rounded-[14px] border border-[#E7D4D0] bg-transparent px-4 py-[13px] text-[14px] font-semibold text-[#8F2A25]">Sair da conta</button>
        </div>
      </Folha>

      <WhatsAppFab numero={whatsappContato} />
      <BottomNav aba={aba} onSelecionar={selecionarAba} />
    </main>
  );
}
