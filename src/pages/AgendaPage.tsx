import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, LogOut } from "lucide-react";
import { apiJson } from "../lib/api";
import { percentualNecessario, primeiroNome } from "../lib/utils";
import { Card } from "@/components/ui/Card";
import { CelebracaoData } from "@/components/cliente/CelebracaoData";
import { CalendarioAgendamento } from "@/components/cliente/CalendarioAgendamento";
import { AgendaBloqueadaPercentual } from "@/components/cliente/AgendaBloqueadaPercentual";
import { SolicitarLiberacaoFinanceira } from "@/components/cliente/SolicitarLiberacaoFinanceira";
import { TabBoletos } from "@/components/cliente/TabBoletos";
import { ComprovantesClienteActions } from "@/components/cliente/ComprovantesClienteActions";
import { RegrasLiberacao } from "@/components/cliente/RegrasLiberacao";
import { AvisoRevisaoFinanceira } from "@/components/cliente/AvisoRevisaoFinanceira";
import { JourneyTracker } from "@/components/cliente/JourneyTracker";
import { FluxoCirurgicoCliente } from "@/components/cliente/FluxoCirurgicoCliente";

type Aba = "cirurgia" | "boletos";
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

function brDate(value: string | null | undefined) {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
}

export function AgendaPage() {
  const [agenda, setAgenda] = useState<AgendaData | null>(null);
  const [boletos, setBoletos] = useState<BoletosData | null>(null);
  const [aba, setAba] = useState<Aba>("cirurgia");
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [celebrando, setCelebrando] = useState<string | null>(null);

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

  const agendaAtual = agenda.agendamentoAtivo ?? agenda.agendamentoConcluido;
  const percentualContrato = percentualNecessario(boletos.quantidade_parcelas);
  const parcelasNecessarias = boletos.quantidade_parcelas
    ? Math.ceil((boletos.quantidade_parcelas * percentualContrato) / 100)
    : null;

  const conteudoAgendaLegado = agenda.agendamentoAtivo ? (
    <div className="flex flex-col gap-4 animate-fadeUp">
      <SolicitarLiberacaoFinanceira ativo={boletos.agenda_liberada || boletos.status_revisao_financeira === "aprovada"} />
    </div>
  ) : agenda.agendamentoConcluido ? (
    <div className="flex flex-col gap-4 animate-fadeUp">
      <Card className="border border-success/15 bg-success/[0.04] p-4">
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-label">Termos assinados</span>
        </div>
        <h2 className="mt-2 font-heading text-lg font-semibold text-burgundy">Assinatura confirmada</h2>
        <p className="mt-1 text-sm leading-relaxed text-clay/60">
          Sua assinatura foi confirmada em {brDate(agenda.agendamentoConcluido.data)}{agenda.agendamentoConcluido.horario ? ` às ${agenda.agendamentoConcluido.horario}` : ""}.
          {agenda.agendamentoConcluido.previsaoLiberacaoFinanceira
            ? ` Sua cirurgia está programada para ${brDate(agenda.agendamentoConcluido.previsaoLiberacaoFinanceira)}.`
            : " Escolha a data da sua cirurgia na agenda quando o custeio estiver definido."}
        </p>
      </Card>
      <SolicitarLiberacaoFinanceira ativo={boletos.agenda_liberada || boletos.status_revisao_financeira === "aprovada"} />
    </div>
  ) : (
    <div className="flex flex-col gap-4">
      <RegrasLiberacao quantidadeParcelas={boletos.quantidade_parcelas} />
      {boletos.agenda_liberada ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <Card className="p-3.5 sm:p-4">
            {agenda.datasDisponiveis.length === 0 ? (
              <p className="p-6 text-center text-sm text-clay/50">Ainda não há datas disponíveis no momento. Fale com a nossa equipe para saber mais.</p>
            ) : (
              <>
                <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-gold/20 bg-gold/[0.06] px-3 py-2.5">
                  <div>
                    <p className="text-[0.72rem] font-semibold text-burgundy">Escolha a data da assinatura dos termos cirúrgicos</p>
                    <p className="mt-0.5 text-[0.6rem] leading-relaxed text-clay/55">Selecione no calendário abaixo uma das datas disponíveis para realizar a assinatura.</p>
                  </div>
                </div>
                <CalendarioAgendamento datas={agenda.datasDisponiveis} onConfirmar={escolherData} confirmando={confirmando} />
              </>
            )}
          </Card>
        </motion.div>
      ) : boletos.status_revisao_financeira === "recusada" ? (
        <AvisoRevisaoFinanceira status="recusada" observacao={boletos.observacao_revisao_financeira ?? null} />
      ) : (
        <AgendaBloqueadaPercentual
          percentual={percentualContrato}
          parcelasNecessarias={parcelasNecessarias}
          datas={agenda.datasDisponiveis}
          etapa={boletos.pode_agendar ? "levantamento" : "percentual"}
        />
      )}
    </div>
  );

  return (
    <main className="client-app min-h-[100dvh] bg-bloom px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-[max(env(safe-area-inset-top),0.75rem)] sm:px-6 sm:pt-6 sm:pb-8">
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
        <header className="mb-4 flex items-center justify-between sm:mb-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-2xl border border-white/70 bg-white/85 shadow-card">
              <img src="/brand/sra-luck-mark.png" alt="Sra. Luck" className="h-5.5 w-5.5 object-contain" />
            </div>
            <div>
              <p className="text-[0.58rem] uppercase tracking-label text-rose">Bem-vinda,</p>
              <h1 className="font-heading text-base font-semibold leading-tight text-burgundy sm:text-lg">{primeiroNome(agenda.cliente.nome)}</h1>
            </div>
          </div>
          <button onClick={() => void sair()} className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[0.68rem] uppercase tracking-label text-clay/40 transition-all duration-200 hover:bg-white/60 hover:text-burgundy">
            <LogOut className="h-3 w-3" /> Sair
          </button>
        </header>

        <div className="mb-4">
          <JourneyTracker
            percentualPagamento={boletos.porcentagem_pagamento ?? 0}
            percentualAtingido={boletos.pode_agendar}
            statusRevisao={boletos.status_revisao_financeira}
            agendada={Boolean(agendaAtual)}
            previsaoLiberacaoFinanceira={agendaAtual?.previsaoLiberacaoFinanceira ?? null}
          />
        </div>

        <div className="mx-auto mb-4 flex w-full max-w-md gap-1 rounded-full bg-blush/70 p-1">
          <button
            onClick={() => setAba("cirurgia")}
            className={`flex-1 rounded-full px-3 py-2 text-[0.68rem] font-bold uppercase tracking-label transition-all duration-200 ${aba === "cirurgia" ? "bg-burgundy text-cream shadow-card" : "text-burgundy/60 hover:text-burgundy"}`}
          >
            Minha Agenda
          </button>
          <button
            onClick={() => setAba("boletos")}
            className={`flex-1 rounded-full px-3 py-2 text-[0.68rem] font-bold uppercase tracking-label transition-all duration-200 ${aba === "boletos" ? "bg-burgundy text-cream shadow-card" : "text-burgundy/60 hover:text-burgundy"}`}
          >
            Meus Boletos
          </button>
        </div>

        {erro && <div role="alert" className="mb-4 rounded-2xl border border-alert/20 bg-alert/5 px-4 py-3 text-sm text-alert">{erro}</div>}

        {aba === "boletos" ? (
          <>
            <TabBoletos procedimento={agenda.cliente.procedimento} />
            <ComprovantesClienteActions />
          </>
        ) : (
          <FluxoCirurgicoCliente fallback={conteudoAgendaLegado} datasLegadas={agenda.datasDisponiveis} />
        )}
      </div>
    </main>
  );
}
