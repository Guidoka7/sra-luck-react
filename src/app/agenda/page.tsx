"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { CheckCircle2, LogOut } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { LogoMark } from "@/components/ui/Logo";
import { CelebracaoData } from "@/components/cliente/CelebracaoData";
import { CentralNotificacoes } from "@/components/cliente/CentralNotificacoes";
import { AtivarNotificacoesPush } from "@/components/cliente/AtivarNotificacoesPush";
import { createClientSupabaseClient } from "@/lib/supabase/client";
import { CalendarioAgendamento, DataDisponivel } from "@/components/cliente/CalendarioAgendamento";
import { AgendaBloqueadaPercentual } from "@/components/cliente/AgendaBloqueadaPercentual";
import { SolicitarLiberacaoFinanceira } from "@/components/cliente/SolicitarLiberacaoFinanceira";
import { TabBoletos } from "@/components/cliente/TabBoletos";
import { ComprovantesClienteActions } from "@/components/cliente/ComprovantesClienteActions";
import { RegrasLiberacao } from "@/components/cliente/RegrasLiberacao";
import { AvisoRevisaoFinanceira } from "@/components/cliente/AvisoRevisaoFinanceira";
import { JourneyTracker } from "@/components/cliente/JourneyTracker";
import { WhatsAppFab } from "@/components/cliente/WhatsAppFab";
import { primeiroNome, percentualNecessario } from "@/lib/utils";
import type { StatusRevisaoFinanceira } from "@/types/database";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { PwaInstallPrompt } from "@/components/ui/PwaInstallPrompt";

type Aba = "cirurgia" | "boletos";
interface ConfigPublica { pagamento: { pixChave: string | null; pixQrCodeUrl: string | null; pixDescontoPercentual?: number }; contato: { whatsapp: string | null; telefone: string | null }; }
type AgendamentoCliente = { id: string; data: string; horario: string | null; termosAssinadosEm?: string | null; previsaoLiberacaoFinanceira: string | null; status?: string };

export default function AgendaClientePage() { return <Suspense fallback={null}><AgendaClienteConteudo /></Suspense>; }

function AgendaClienteConteudo() {
  const router = useRouter();
  const [carregando, setCarregando] = useState(true); const [aba, setAba] = useState<Aba>("cirurgia"); const [nome, setNome] = useState(""); const [clienteId, setClienteId] = useState<string | null>(null); const [notificacaoTick, setNotificacaoTick] = useState(0); const [procedimento, setProcedimento] = useState<string | null>(null);
  const [agendamentoAtivo, setAgendamentoAtivo] = useState<AgendamentoCliente | null>(null); const [agendamentoConcluido, setAgendamentoConcluido] = useState<AgendamentoCliente | null>(null); const [datas, setDatas] = useState<DataDisponivel[]>([]); const [confirmando, setConfirmando] = useState(false); const [celebrando, setCelebrando] = useState<string | null>(null);
  const [agendaLiberada, setAgendaLiberada] = useState(false); const [podeAgendar, setPodeAgendar] = useState(false); const [statusRevisao, setStatusRevisao] = useState<StatusRevisaoFinanceira | null>(null); const [observacaoRevisao, setObservacaoRevisao] = useState<string | null>(null); const [porcentagemPagamento, setPorcentagemPagamento] = useState<number | null>(null); const [quantidadeParcelas, setQuantidadeParcelas] = useState<number | null>(null); const [config, setConfig] = useState<ConfigPublica | null>(null);
  const [previsaoAnterior, setPrevisaoAnterior] = useState<string | null | undefined>(undefined);

  async function carregar(silencioso = false) {
    if (!silencioso) setCarregando(true);
    const [resAgenda, resBoletos] = await Promise.all([fetch("/api/cliente/agenda", { cache: "no-store" }), fetch("/api/cliente/boletos", { cache: "no-store" })]);
    if (!resAgenda.ok) { router.push("/login"); return; }
    const data = await resAgenda.json();
    setNome(data.cliente.nome); setClienteId(data.cliente.id ?? null); setProcedimento(data.cliente.procedimento ?? null); setAgendamentoAtivo(data.agendamentoAtivo); setAgendamentoConcluido(data.agendamentoConcluido); setDatas(data.datasDisponiveis ?? []);
    const novaPrevisao: string | null = data.agendamentoAtivo?.previsaoLiberacaoFinanceira ?? data.agendamentoConcluido?.previsaoLiberacaoFinanceira ?? null;
    if (previsaoAnterior !== undefined && novaPrevisao !== previsaoAnterior && novaPrevisao) { toast.success(previsaoAnterior ? "📅 Sua data da cirurgia foi atualizada. Confira em \"Minha Agenda\"." : "📅 Sua data da cirurgia já está disponível em \"Minha Agenda\"."); }
    setPrevisaoAnterior(novaPrevisao);
    if (resBoletos.ok) { const boletosData = await resBoletos.json(); const temBoletos = (boletosData.boletos ?? []).length > 0; setAgendaLiberada(temBoletos && Boolean(boletosData.agenda_liberada)); setPodeAgendar(temBoletos && Boolean(boletosData.pode_agendar)); setStatusRevisao(temBoletos ? boletosData.status_revisao_financeira ?? null : null); setObservacaoRevisao(temBoletos ? boletosData.observacao_revisao_financeira ?? null : null); setPorcentagemPagamento(temBoletos ? boletosData.porcentagem_pagamento : null); setQuantidadeParcelas(boletosData.quantidade_parcelas ?? null); } else { setAgendaLiberada(false); setPodeAgendar(false); setStatusRevisao(null); setObservacaoRevisao(null); setPorcentagemPagamento(null); setQuantidadeParcelas(null); }
    setCarregando(false);
  }

  useEffect(() => { carregar(); fetch("/api/cliente/config").then(res => res.ok ? res.json() : Promise.reject(res.status)).then(data => setConfig(data)).catch(erro => { console.error("Não foi possível carregar chave PIX / contato:", erro); }); const intervalo = setInterval(() => carregar(true), 30_000); function aoFocarAba() { if (document.visibilityState === "visible") carregar(true); } document.addEventListener("visibilitychange", aoFocarAba); window.addEventListener("focus", aoFocarAba); return () => { clearInterval(intervalo); document.removeEventListener("visibilitychange", aoFocarAba); window.removeEventListener("focus", aoFocarAba); }; }, []);
  useEffect(() => { const supabase = createClientSupabaseClient(); const canalAgenda = supabase.channel("agenda-clientes").on("broadcast", { event: "datas_atualizadas" }, () => carregar(true)).subscribe(); return () => { supabase.removeChannel(canalAgenda); }; }, []);
  useEffect(() => { if (!clienteId) return; const supabase = createClientSupabaseClient(); const canal = supabase.channel(`notificacoes-cliente:${clienteId}`).on("broadcast", { event: "nova_notificacao" }, () => { carregar(true); setNotificacaoTick(t => t + 1); }).subscribe(); return () => { supabase.removeChannel(canal); }; }, [clienteId]);

  async function escolherData(dataId: string, horario: string) { setConfirmando(true); try { const res = await fetch("/api/cliente/agendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataId, horario }) }); const resultado = await res.json(); if (!res.ok) { toast.error(resultado.erro ?? "Não foi possível confirmar essa data."); return; } setCelebrando(resultado.data); } catch { toast.error("Erro de conexão. Tente novamente."); } finally { setConfirmando(false); } }
  async function sair() { await fetch("/api/cliente/logout", { method: "POST" }); router.push("/login"); }
  if (carregando) return <main className="flex min-h-[100dvh] items-center justify-center bg-bloom"><LogoMark className="h-10 w-10 animate-pulse" /></main>;
  const agendaAtual = agendamentoAtivo ?? agendamentoConcluido; const tourStage = agendaAtual ? "cirurgia" : "agenda"; const percentualContrato = percentualNecessario(quantidadeParcelas); const parcelasNecessarias = quantidadeParcelas ? Math.ceil((quantidadeParcelas * percentualContrato) / 100) : null;

  return <main data-tour-root data-tour-stage={tourStage} data-tour-required-percentage={percentualContrato} data-tour-required-installments={parcelasNecessarias ?? ""} className="client-app min-h-[100dvh] bg-bloom px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-[max(env(safe-area-inset-top),0.75rem)] sm:px-6 sm:pt-6 sm:pb-8">
    {celebrando && <CelebracaoData data={celebrando} nome={primeiroNome(nome)} onFechar={() => { setCelebrando(null); carregar(); }} />}
    <div className="mobile-app-frame mx-auto w-full max-w-2xl sm:max-w-[30rem]">
      <header className="mb-4 flex items-center justify-between sm:mb-5"><div className="flex items-center gap-2.5"><div className="flex h-9 w-9 flex-none items-center justify-center rounded-2xl border border-white/70 bg-white/85 shadow-card dark:border-white/10 dark:bg-white/[0.055]"><LogoMark className="h-5.5 w-5.5" /></div><div><p className="text-[0.58rem] uppercase tracking-label text-rose">Bem-vinda,</p><h1 className="font-heading text-base font-semibold leading-tight text-burgundy sm:text-lg">{primeiroNome(nome)}</h1></div></div><div className="flex items-center gap-1.5"><ThemeToggle compact /><div data-tour="notificacoes" className="flex items-center"><CentralNotificacoes onAbrirAgenda={() => setAba("cirurgia")} refreshSignal={notificacaoTick} /></div><button onClick={sair} className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[0.68rem] uppercase tracking-label text-clay/40 transition-all duration-200 hover:bg-white/60 hover:text-burgundy dark:hover:bg-white/10"><LogOut className="h-3 w-3" /> Sair</button></div></header>
      <PwaInstallPrompt /><AtivarNotificacoesPush />
      <div data-tour="jornada" className="mb-4"><JourneyTracker percentualPagamento={porcentagemPagamento ?? 0} percentualAtingido={agendaLiberada} statusRevisao={statusRevisao} agendada={Boolean(agendaAtual)} previsaoLiberacaoFinanceira={agendaAtual?.previsaoLiberacaoFinanceira ?? null} /></div>
      <div className="mx-auto mb-4 flex w-full max-w-md gap-1 rounded-full bg-blush/70 p-1 dark:bg-white/[0.06]"><button data-tour="minha-agenda" onClick={() => setAba("cirurgia")} className={`flex-1 rounded-full px-3 py-2 text-[0.68rem] font-bold uppercase tracking-label transition-all duration-200 ${aba === "cirurgia" ? "bg-burgundy text-cream shadow-card" : "text-burgundy/60 hover:text-burgundy dark:text-pearl/55 dark:hover:text-pearl"}`}>Minha Agenda</button><button data-tour="boletos" onClick={() => setAba("boletos")} className={`flex-1 rounded-full px-3 py-2 text-[0.68rem] font-bold uppercase tracking-label transition-all duration-200 ${aba === "boletos" ? "bg-burgundy text-cream shadow-card" : "text-burgundy/60 hover:text-burgundy dark:text-pearl/55 dark:hover:text-pearl"}`}>Meus Boletos</button></div>
      {aba === "boletos" && <><TabBoletos pagamento={config?.pagamento} procedimento={procedimento} /><ComprovantesClienteActions /></>}
      {aba === "cirurgia" && (agendamentoAtivo ? <div data-tour="previsao" className="flex flex-col gap-4 animate-fadeUp"><SolicitarLiberacaoFinanceira ativo={agendaLiberada || statusRevisao === "aprovada"} /></div> : agendamentoConcluido ? <div data-tour="previsao" className="flex flex-col gap-4 animate-fadeUp"><Card className="border border-success/15 bg-success/[0.04] p-4"><div className="flex items-center gap-2 text-success"><CheckCircle2 className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-label">Termos assinados</span></div><h2 className="mt-2 font-heading text-lg font-semibold text-burgundy">Assinatura confirmada</h2><p className="mt-1 text-sm leading-relaxed text-clay/60">Sua assinatura foi confirmada em {agendamentoConcluido.data.split("-").reverse().join("/")}{agendamentoConcluido.horario ? ` às ${agendamentoConcluido.horario}` : ""}. {agendamentoConcluido.previsaoLiberacaoFinanceira ? `Sua cirurgia está programada para ${agendamentoConcluido.previsaoLiberacaoFinanceira.split("-").reverse().join("/")}.` : "Escolha a data da sua cirurgia na agenda abaixo quando o custeio estiver definido."}</p></Card><SolicitarLiberacaoFinanceira ativo={agendaLiberada || statusRevisao === "aprovada"} /></div> : <div className="flex flex-col gap-4"><RegrasLiberacao quantidadeParcelas={quantidadeParcelas} />{agendaLiberada ? <motion.div data-tour="agenda" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}><Card className="p-3.5 sm:p-4">{datas.length === 0 ? <p className="p-6 text-center text-sm text-clay/50">Ainda não há datas disponíveis no momento. Fale com a nossa equipe para saber mais.</p> : <><div className="mb-3 flex items-start gap-2.5 rounded-xl border border-gold/20 bg-gold/[0.06] px-3 py-2.5"><div><p className="text-[0.72rem] font-semibold text-burgundy">Escolha a data da assinatura dos termos cirúrgicos</p><p className="mt-0.5 text-[0.6rem] leading-relaxed text-clay/55">Selecione no calendário abaixo uma das datas disponíveis para realizar a assinatura.</p></div></div><CalendarioAgendamento datas={datas} onConfirmar={escolherData} confirmando={confirmando} /></>}</Card></motion.div> : statusRevisao === "recusada" ? <AvisoRevisaoFinanceira status="recusada" observacao={observacaoRevisao} /> : <AgendaBloqueadaPercentual percentual={percentualContrato} parcelasNecessarias={parcelasNecessarias} datas={datas} etapa={podeAgendar ? "levantamento" : "percentual"} />}</div>)}
    </div>
    <WhatsAppFab numero={config?.contato.whatsapp ?? null} mensagem={`Olá! Sou ${primeiroNome(nome)} e preciso de ajuda com minha agenda.`} />
  </main>;
}
