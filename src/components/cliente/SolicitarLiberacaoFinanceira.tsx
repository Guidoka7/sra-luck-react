"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CirurgiaConfirmada } from "@/components/cliente/CirurgiaConfirmada";
import { CalendarioCirurgia } from "@/components/cliente/CalendarioCirurgia";
import type { AgendaData } from "@/lib/clienteAgenda";

interface Props {
  ativo?: boolean;
  termosAssinados?: boolean;
  onCirurgiaConfirmada?: () => void | Promise<void>;
  /** Dados já carregados pela página: renderiza na hora, sem nova consulta. */
  snapshot?: AgendaData | null;
  /** A aba Agenda já mostra a data/horário da assinatura no cartão do topo. */
  ocultarResumoAssinatura?: boolean;
}
type FormaCusteio = "cartao" | "pix" | "cheques" | "boleto_100";
interface Financeiro { saldoRestante: number | null; taxaCartao: number; totalComTaxa: number | null; formasCusteio: string[]; }
interface Solicitacao { id: string; forma_custeio: FormaCusteio; saldo_restante: number; taxa_cartao: number; total_com_taxa: number; status: string; observacao: string | null; }

function formatarMoeda(valor: number) { return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function partesData(iso: string) {
  const [ano, mes, dia] = iso.split("-");
  const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  return { dia, mes: meses[Math.max(0, Number(mes) - 1)] ?? mes, ano };
}
function labelForma(forma: FormaCusteio) {
  if (forma === "cartao") return "Cartão de crédito";
  if (forma === "pix") return "PIX";
  if (forma === "cheques") return "Cheques";
  return "100% boleto";
}

function financeiroDe(data: { financeiro?: { saldoRestante?: number | null; taxaCartao?: number | null; totalComTaxa?: number | null; formasCusteio?: string[] } | null } | null | undefined): Financeiro {
  const f = data?.financeiro;
  return { saldoRestante: f?.saldoRestante ?? null, taxaCartao: f?.taxaCartao ?? 5.4, totalComTaxa: f?.totalComTaxa ?? null, formasCusteio: f?.formasCusteio ?? [] };
}

export function SolicitarLiberacaoFinanceira({ ativo = true, termosAssinados = false, onCirurgiaConfirmada, snapshot = null, ocultarResumoAssinatura = false }: Props) {
  const agendaInicial = snapshot ? snapshot.agendamentoAtivo ?? snapshot.agendamentoConcluido ?? null : null;
  const [financeiro, setFinanceiro] = useState<Financeiro>(() => financeiroDe(snapshot));
  const [solicitacao, setSolicitacao] = useState<Solicitacao | null>(() => (snapshot?.solicitacaoLiberacaoFinanceira as Solicitacao | null) ?? null);
  const [dataAssinaturaTermos, setDataAssinaturaTermos] = useState<string | null>(agendaInicial?.data ?? null);
  const [horarioTermos, setHorarioTermos] = useState<string | null>(agendaInicial?.horario ?? null);
  const [dataCirurgia, setDataCirurgia] = useState<string | null>(agendaInicial?.dataCirurgia ?? null);
  const [modalAberto, setModalAberto] = useState(false);
  const [formaCusteio, setFormaCusteio] = useState<FormaCusteio | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function aplicar(data: Partial<AgendaData>) {
    setFinanceiro(financeiroDe(data));
    setSolicitacao((data.solicitacaoLiberacaoFinanceira as Solicitacao | null | undefined) ?? null);
    const agenda = data.agendamentoAtivo ?? data.agendamentoConcluido ?? null;
    setDataAssinaturaTermos(agenda?.data ?? null);
    setHorarioTermos(agenda?.horario ?? null);
    setDataCirurgia(agenda?.dataCirurgia ?? null);
  }

  async function carregar() {
    try {
      const resAgenda = await fetch("/api/cliente/agenda", { cache: "no-store" });
      if (!resAgenda.ok) return;
      aplicar(await resAgenda.json());
    } catch {}
  }

  // Com snapshot, a página já mantém os dados atualizados (realtime + polling).
  useEffect(() => {
    if (snapshot) aplicar(snapshot);
  }, [snapshot]);

  useEffect(() => {
    if (!ativo || snapshot) return;
    void carregar();
    const intervalo = setInterval(() => void carregar(), 5000);
    return () => clearInterval(intervalo);
  }, [ativo, Boolean(snapshot)]);

  const saldoRestante = Number(financeiro.saldoRestante ?? 0);
  const taxaCartao = saldoRestante * (Number(financeiro.taxaCartao ?? 5.4) / 100);
  const totalCartao = financeiro.totalComTaxa ?? saldoRestante + taxaCartao;
  const formasDisponiveis = useMemo(() => (["cartao", "pix", "cheques", "boleto_100"] as FormaCusteio[]).filter((forma) => financeiro.formasCusteio.includes(forma)), [financeiro.formasCusteio]);
  const status = String(solicitacao?.status ?? "").toLowerCase();
  const recusada = status.includes("recus");
  const aprovada = status.includes("aprov");

  function abrirModal() {
    setErro(null);
    setFormaCusteio(solicitacao?.forma_custeio ?? null);
    setModalAberto(true);
  }

  async function enviarCusteio() {
    if (!formaCusteio) return;
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cliente/solicitacao-liberacao-financeira", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ formaCusteio }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? "Não foi possível enviar sua solicitação.");
      setSolicitacao(data.solicitacao ?? null);
      setModalAberto(false);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível enviar sua solicitação.");
    } finally {
      setEnviando(false);
    }
  }

  function confirmarCirurgia(data: string) {
    setDataCirurgia(data);
    void onCirurgiaConfirmada?.();
  }

  if (!ativo) return null;
  if (dataCirurgia) return <CirurgiaConfirmada data={dataCirurgia} />;
  if (!dataAssinaturaTermos) return null;

  const termos = partesData(dataAssinaturaTermos);

  // Após a assinatura, a confirmação única fica na aba Agenda (AgendaTab).
  // O resumo do agendamento e da forma de custeio pertence à etapa anterior.
  if (termosAssinados) {
    return <CalendarioCirurgia dataAssinatura={dataAssinaturaTermos} onConfirmada={confirmarCirurgia} termosAssinados formaCusteio={solicitacao?.forma_custeio ?? null} snapshot={snapshot} />;
  }

  return <>
    <div className="flex flex-col gap-[11px]">
      {!ocultarResumoAssinatura && <div className="rounded-[18px] border border-[#DCEADF] bg-white p-[15px] shadow-[0_7px_20px_rgba(73,42,45,.05)]"><div className="flex items-start justify-between gap-3"><div><div className="text-[8.5px] font-bold uppercase tracking-[.13em] text-[#3F7D5B]">Assinatura dos termos</div><div className="pt-[3px] font-heading text-[21px] font-semibold text-[#7D2434]">{`${termos.dia} de ${termos.mes.toLowerCase()} de ${termos.ano}`}</div><div className="pt-[2px] text-[10.5px] font-light text-[#7A6B67]">Horário confirmado: {horarioTermos ?? "—"}</div></div><span className="rounded-full bg-[#F0F7F1] px-2 py-1 text-[8.5px] font-semibold text-[#3F7D5B]">Confirmada</span></div></div>}

      {!solicitacao || recusada ? <div className="rounded-[18px] border border-[#DCEADF] bg-[#F0F7F1] p-[15px]"><div className="flex items-center gap-[10px]"><svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke="#3F7D5B" strokeWidth="1.25"><circle cx="9" cy="9" r="6.2"/><path d="m6 9 2 2 4-4"/></svg><div className="min-w-0 flex-1"><div className="text-[8.5px] font-bold uppercase tracking-[.13em] text-[#3F7D5B]">Próxima etapa</div><div className="pt-[2px] text-[11.5px] font-medium text-[#7D2434]">{recusada ? "Sua forma de custeio precisa ser ajustada." : "Informe como será realizado o pagamento do saldo restante."}</div></div><button type="button" onClick={abrirModal} className="rounded-[10px] bg-[#B65B67] px-[11px] py-[9px] text-[9.5px] font-semibold text-white">Informar</button></div></div> : <div className="rounded-[18px] border p-[15px]" style={aprovada ? { background: "#F0F7F1", borderColor: "#DCEADF" } : { background: "#FFF9EF", borderColor: "#EFD9AA" }}><div className="flex items-start gap-[10px]"><span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-full" style={aprovada ? { background: "#E3F1E6", color: "#3F7D5B" } : { background: "#FBF1DD", color: "#A77A24" }}><svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><circle cx="9" cy="9" r="6.2"/>{aprovada ? <path d="m6 9 2 2 4-4"/> : <path d="M9 5.6V9l2.3 1.5"/>}</svg></span><div><div className="text-[8.5px] font-bold uppercase tracking-[.13em]" style={{ color: aprovada ? "#3F7D5B" : "#A77A24" }}>{aprovada ? "Custeio confirmado" : "Custeio em análise"}</div><div className="pt-[2px] text-[11.5px] font-medium text-[#7D2434]">{aprovada ? `${labelForma(solicitacao.forma_custeio)} confirmado pelo financeiro.` : "Recebemos sua escolha e estamos confirmando com a equipe financeira."}</div>{solicitacao.observacao && <div className="pt-[3px] text-[9.7px] font-light leading-[1.45] text-[#7A6B67]">{solicitacao.observacao}</div>}</div></div></div>}

      <CalendarioCirurgia dataAssinatura={dataAssinaturaTermos} onConfirmada={confirmarCirurgia} formaCusteio={solicitacao?.forma_custeio ?? null} snapshot={snapshot} />
    </div>

    <AnimatePresence>{modalAberto && <><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !enviando && setModalAberto(false)} className="fixed inset-0 z-[80] bg-[rgba(38,23,25,.30)] backdrop-blur-[2px]"/><motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ duration: .2 }} className="fixed bottom-0 left-1/2 z-[81] w-full max-w-[430px] -translate-x-1/2 px-[10px] pb-[max(12px,env(safe-area-inset-bottom))]"><div className="rounded-[24px_24px_18px_18px] border border-[#EADFDB] bg-white px-[14px] pb-[15px] pt-[9px] shadow-[0_-16px_45px_rgba(48,26,30,.18)]"><div className="mx-auto mb-3 h-1 w-[38px] rounded-full bg-[#E7DCD8]"/><div className="flex items-start justify-between gap-3"><div><div className="text-[8.5px] font-bold uppercase tracking-[.14em] text-[#B65B67]">Custeio do saldo restante</div><div className="pt-[3px] font-heading text-[21px] font-semibold text-[#7D2434]">Como será realizado o pagamento?</div><div className="pt-1 text-[10px] font-light leading-[1.5] text-[#7A6B67]">Saldo apurado: <b className="font-semibold text-[#7D2434]">{formatarMoeda(saldoRestante)}</b>. Escolha uma opção autorizada pelo financeiro.</div></div><button type="button" onClick={() => !enviando && setModalAberto(false)} className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#F7EFED] text-[#7D2434]">×</button></div><div className="mt-3 flex flex-col gap-[7px]">{formasDisponiveis.map((forma) => <button key={forma} type="button" onClick={() => setFormaCusteio(forma)} className="flex items-center justify-between rounded-[12px] border px-3 py-[11px] text-left" style={formaCusteio === forma ? { borderColor: "#7D2434", background: "#F7EFED", color: "#6B1F2E" } : { borderColor: "#EADFDB", background: "#FFF", color: "#5E4A46" }}><span className="text-[11px] font-medium">{labelForma(forma)}</span><span className="text-[9px] text-[#9A8A86]">{forma === "cartao" ? formatarMoeda(totalCartao) : forma === "pix" ? "sem taxa adicional" : "conferência financeira"}</span></button>)}</div>{erro && <div className="mt-2 rounded-[11px] border border-[#F0D3D1] bg-[#FBEBEA] p-[9px] text-[9.8px] text-[#8F2A25]">{erro}</div>}<button type="button" disabled={!formaCusteio || enviando || formasDisponiveis.length === 0} onClick={() => void enviarCusteio()} className="mt-[11px] w-full rounded-[12px] bg-[#6B1F2E] p-3 text-[11.5px] font-medium text-white disabled:opacity-40">{enviando ? "Confirmando..." : "Confirmar forma de custeio"}</button></div></motion.div></>}</AnimatePresence>
  </>;
}

