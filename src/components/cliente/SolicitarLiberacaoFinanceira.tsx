"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarioAgendamento, type DataDisponivel } from "@/components/cliente/CalendarioAgendamento";
import { CalendarioCirurgia } from "@/components/cliente/CalendarioCirurgia";
import { toast } from "sonner";

interface Props { ativo?: boolean; }
type FormaCusteio = "cartao" | "pix" | "cheques" | "boleto_100";
type TipoAlteracao = "termos" | "cirurgia" | null;
interface Financeiro { saldoRestante: number | null; taxaCartao: number; totalComTaxa: number | null; formasCusteio: string[]; }
interface Solicitacao { id: string; forma_custeio: FormaCusteio; saldo_restante: number; taxa_cartao: number; total_com_taxa: number; status: string; observacao: string | null; }
interface ConfirmacaoAlteracao { tipo: "termos" | "cirurgia"; dataId?: string; data: string; horario?: string; }

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

export function SolicitarLiberacaoFinanceira({ ativo = true }: Props) {
  const [financeiro, setFinanceiro] = useState<Financeiro>({ saldoRestante: null, taxaCartao: 5.4, totalComTaxa: null, formasCusteio: [] });
  const [solicitacao, setSolicitacao] = useState<Solicitacao | null>(null);
  const [dataAssinaturaTermos, setDataAssinaturaTermos] = useState<string | null>(null);
  const [horarioTermos, setHorarioTermos] = useState<string | null>(null);
  const [dataCirurgia, setDataCirurgia] = useState<string | null>(null);\n  const [horarioCirurgia, setHorarioCirurgia] = useState<string | null>(null);
  const [datasTermos, setDatasTermos] = useState<DataDisponivel[]>([]);
  const [alteracao, setAlteracao] = useState<TipoAlteracao>(null);
  const [confirmacaoAlteracao, setConfirmacaoAlteracao] = useState<ConfirmacaoAlteracao | null>(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [formaCusteio, setFormaCusteio] = useState<FormaCusteio | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [remarcacaoPendente, setRemarcacaoPendente] = useState(false);

  async function carregar() {
    try {
      const resAgenda = await fetch("/api/cliente/agenda", { cache: "no-store" });
      if (!resAgenda.ok) return;
      const data = await resAgenda.json();
      setFinanceiro(data.financeiro ?? { saldoRestante: null, taxaCartao: 5.4, totalComTaxa: null, formasCusteio: [] });
      setSolicitacao(data.solicitacaoLiberacaoFinanceira ?? null);
      const agenda = data.agendamentoAtivo ?? data.agendamentoConcluido ?? null;
      setDataAssinaturaTermos(agenda?.data ?? null);
      setHorarioTermos(agenda?.horario ?? null);
      setDataCirurgia(agenda?.dataCirurgia ?? agenda?.previsaoLiberacaoFinanceira ?? null);\n      setHorarioCirurgia(agenda?.horarioCirurgia ?? null);
      setDatasTermos(data.datasDisponiveis ?? []);
    } catch {}
  }

  useEffect(() => {
    if (!ativo) return;
    void carregar();
    const intervalo = setInterval(() => void carregar(), 5000);
    return () => clearInterval(intervalo);
  }, [ativo]);

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
      const res = await fetch("/api/cliente/forma-quitacao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ formaCusteio }) });
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

  function prepararAlteracaoTermos(dataId: string, horario: string) {
    const data = datasTermos.find((item) => item.id === dataId)?.data;
    if (!data) { setErro("Não foi possível identificar a data escolhida."); return; }
    setErro(null);
    setConfirmacaoAlteracao({ tipo: "termos", dataId, data, horario });
  }

  function prepararAlteracaoCirurgia(data: string) {
    setErro(null);
    setConfirmacaoAlteracao({ tipo: "cirurgia", data });
  }

  async function enviarAlteracao() {
    if (!confirmacaoAlteracao) return;
    setEnviando(true);
    setErro(null);
    try {
      const body = confirmacaoAlteracao.tipo === "termos"
        ? { tipo: "termos", dataId: confirmacaoAlteracao.dataId, horario: confirmacaoAlteracao.horario }
        : { tipo: "cirurgia", data: confirmacaoAlteracao.data };
      const res = await fetch("/api/cliente/remarcar-agendamento", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.erro ?? "Não foi possível enviar a alteração para análise.");
      setConfirmacaoAlteracao(null);
      setAlteracao(null);
      setRemarcacaoPendente(true);
      toast.success("Solicitação enviada para análise. Sua agenda atual permanece inalterada até a autorização.");
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível enviar a solicitação.");
    } finally {
      setEnviando(false);
    }
  }

  if (!ativo || !dataAssinaturaTermos) return null;

  const termos = partesData(dataAssinaturaTermos);

  if (alteracao === "termos") {
    return <section className="overflow-hidden rounded-[18px] border border-[#EFE4E1] bg-white shadow-[0_10px_26px_rgba(70,42,44,.07)]">
      <div className="border-b border-[#F0DDDD] bg-[#FFF7F7] px-[13px] py-3"><div className="text-[8.5px] font-bold uppercase tracking-[.13em] text-[#B65B67]">Alterar assinatura dos termos</div><div className="pt-[2px] font-heading text-[15px] font-semibold text-[#7D2434]">Escolha uma nova data para a assinatura dos termos</div><div className="pt-[2px] text-[9.5px] font-light text-[#7A6B67]">A nova data será enviada para análise administrativa. Prazo de até 5 dias úteis.</div></div>
      <div className="p-[13px]"><CalendarioAgendamento datas={datasTermos} onConfirmar={prepararAlteracaoTermos} confirmando={enviando} /><button type="button" onClick={() => { setAlteracao(null); setConfirmacaoAlteracao(null); }} className="mt-[10px] w-full text-center text-[9px] font-medium text-[#8A7B77] underline">Cancelar alteração</button></div>
      {confirmacaoAlteracao?.tipo === "termos" && <ConfirmarAlteracao confirmacao={confirmacaoAlteracao} enviando={enviando} onCancelar={() => setConfirmacaoAlteracao(null)} onConfirmar={() => void enviarAlteracao()} />}
    </section>;
  }

  if (alteracao === "cirurgia" && dataAssinaturaTermos) {
    return <section className="overflow-hidden rounded-[18px] border border-[#EFE4E1] bg-white shadow-[0_10px_26px_rgba(70,42,44,.07)]">
      <div className="border-b border-[#F0DDDD] bg-[#FFF7F7] px-[13px] py-3"><div className="text-[8.5px] font-bold uppercase tracking-[.13em] text-[#B65B67]">Alterar data da cirurgia</div><div className="pt-[2px] font-heading text-[15px] font-semibold text-[#7D2434]">Escolha uma nova data para sua cirurgia</div><div className="pt-[2px] text-[9.5px] font-light text-[#7A6B67]">A nova data será enviada para análise administrativa. Prazo de até 5 dias úteis.</div></div>
      <div className="p-[13px]"><CalendarioCirurgia dataAssinatura={dataAssinaturaTermos} dataCirurgiaAtual={dataCirurgia} modoAlteracao onSolicitarAlteracao={prepararAlteracaoCirurgia} /><button type="button" onClick={() => { setAlteracao(null); setConfirmacaoAlteracao(null); }} className="mt-[10px] w-full text-center text-[9px] font-medium text-[#8A7B77] underline">Cancelar alteração</button></div>
      {confirmacaoAlteracao?.tipo === "cirurgia" && <ConfirmarAlteracao confirmacao={confirmacaoAlteracao} enviando={enviando} onCancelar={() => setConfirmacaoAlteracao(null)} onConfirmar={() => void enviarAlteracao()} />}
    </section>;
  }

  if (dataCirurgia) {
    const cirurgia = partesData(dataCirurgia);
    return <>
      <section className="overflow-hidden rounded-[18px] border border-[#EFE4E1] bg-white shadow-[0_10px_26px_rgba(70,42,44,.07)]">
        <div className="flex items-center justify-between gap-[10px] border-b border-[#F0E6E3] px-[14px] py-[13px]"><div><div className="text-[8.5px] font-bold uppercase tracking-[.14em] text-[#B65B67]">Minha agenda</div><div className="pt-[2px] text-[10px] font-light text-[#7A6B67]">Datas registradas para o seu atendimento.</div></div><span className="rounded-full border border-[#DCEADF] bg-[#F0F7F1] px-2 py-1 text-[8px] font-bold uppercase tracking-[.06em] text-[#3F7D5B]">Confirmada</span></div>
        <div className="grid grid-cols-2 gap-[9px] p-[11px]">
          <DataCard titulo="Assinatura dos termos" data={termos} horario={horarioTermos} onAlterar={() => setAlteracao("termos")} />
          <DataCard titulo="Data da sua cirurgia" data={cirurgia} horario={horarioCirurgia} onAlterar={() => setAlteracao("cirurgia")} />
        </div>
      </section>
      {remarcacaoPendente && <div className="mt-[10px] rounded-[14px] border border-[#EFD9AA] bg-[#FFF9EF] px-[14px] py-3 text-[10px] font-light leading-[1.5] text-[#7A6B67]"><b className="font-semibold text-[#8E6420]">Solicitação de alteração enviada.</b> Prazo de até 5 dias úteis. Sua agenda atual permanece inalterada até a autorização administrativa.</div>}
    </>;
  }

  return <>
    <div className="flex flex-col gap-[11px]">
      <div className="rounded-[18px] border border-[#DCEADF] bg-white p-[15px] shadow-[0_7px_20px_rgba(73,42,45,.05)]"><div className="flex items-start justify-between gap-3"><div><div className="text-[8.5px] font-bold uppercase tracking-[.13em] text-[#3F7D5B]">Assinatura dos termos</div><div className="pt-[3px] font-heading text-[21px] font-semibold text-[#7D2434]">{`${termos.dia} de ${termos.mes.toLowerCase()} de ${termos.ano}`}</div><div className="pt-[2px] text-[10.5px] font-light text-[#7A6B67]">Horário confirmado: {horarioTermos ?? "—"}</div></div><span className="rounded-full bg-[#F0F7F1] px-2 py-1 text-[8.5px] font-semibold text-[#3F7D5B]">Confirmada</span></div></div>

      {!solicitacao || recusada ? <div className="rounded-[18px] border border-[#DCEADF] bg-[#F0F7F1] p-[15px]"><div className="flex items-center gap-[10px]"><svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke="#3F7D5B" strokeWidth="1.25"><circle cx="9" cy="9" r="6.2"/><path d="m6 9 2 2 4-4"/></svg><div className="min-w-0 flex-1"><div className="text-[8.5px] font-bold uppercase tracking-[.13em] text-[#3F7D5B]">Próxima etapa</div><div className="pt-[2px] text-[11.5px] font-medium text-[#7D2434]">{recusada ? "Sua forma de custeio precisa ser ajustada." : "Informe como será realizado o pagamento do saldo restante."}</div></div><button type="button" onClick={abrirModal} className="rounded-[10px] bg-[#B65B67] px-[11px] py-[9px] text-[9.5px] font-semibold text-white">Informar</button></div></div> : <div className="rounded-[18px] border p-[15px]" style={aprovada ? { background: "#F0F7F1", borderColor: "#DCEADF" } : { background: "#FFF9EF", borderColor: "#EFD9AA" }}><div className="flex items-start gap-[10px]"><span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-full" style={aprovada ? { background: "#E3F1E6", color: "#3F7D5B" } : { background: "#FBF1DD", color: "#A77A24" }}><svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><circle cx="9" cy="9" r="6.2"/>{aprovada ? <path d="m6 9 2 2 4-4"/> : <path d="M9 5.6V9l2.3 1.5"/>}</svg></span><div><div className="text-[8.5px] font-bold uppercase tracking-[.13em]" style={{ color: aprovada ? "#3F7D5B" : "#A77A24" }}>{aprovada ? "Custeio confirmado" : "Custeio em análise"}</div><div className="pt-[2px] text-[11.5px] font-medium text-[#7D2434]">{aprovada ? `${labelForma(solicitacao.forma_custeio)} confirmado pelo financeiro.` : "Recebemos sua escolha e estamos confirmando com a equipe financeira."}</div>{solicitacao.observacao && <div className="pt-[3px] text-[9.7px] font-light leading-[1.45] text-[#7A6B67]">{solicitacao.observacao}</div>}</div></div></div>}

      <CalendarioCirurgia dataAssinatura={dataAssinaturaTermos} onConfirmada={setDataCirurgia} />
    </div>

    <AnimatePresence>{modalAberto && <><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !enviando && setModalAberto(false)} className="fixed inset-0 z-[80] bg-[rgba(38,23,25,.30)] backdrop-blur-[2px]"/><motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ duration: .2 }} className="fixed bottom-0 left-1/2 z-[81] w-full max-w-[430px] -translate-x-1/2 px-[10px] pb-[max(12px,env(safe-area-inset-bottom))]"><div className="rounded-[24px_24px_18px_18px] border border-[#EADFDB] bg-white px-[14px] pb-[15px] pt-[9px] shadow-[0_-16px_45px_rgba(48,26,30,.18)]"><div className="mx-auto mb-3 h-1 w-[38px] rounded-full bg-[#E7DCD8]"/><div className="flex items-start justify-between gap-3"><div><div className="text-[8.5px] font-bold uppercase tracking-[.14em] text-[#B65B67]">Custeio do saldo restante</div><div className="pt-[3px] font-heading text-[21px] font-semibold text-[#7D2434]">Como será realizado o pagamento?</div><div className="pt-1 text-[10px] font-light leading-[1.5] text-[#7A6B67]">Saldo apurado: <b className="font-semibold text-[#7D2434]">{formatarMoeda(saldoRestante)}</b>. Escolha uma opção autorizada pelo financeiro.</div></div><button type="button" onClick={() => !enviando && setModalAberto(false)} className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#F7EFED] text-[#7D2434]">×</button></div><div className="mt-3 flex flex-col gap-[7px]">{formasDisponiveis.map((forma) => <button key={forma} type="button" onClick={() => setFormaCusteio(forma)} className="flex items-center justify-between rounded-[12px] border px-3 py-[11px] text-left" style={formaCusteio === forma ? { borderColor: "#7D2434", background: "#F7EFED", color: "#6B1F2E" } : { borderColor: "#EADFDB", background: "#FFF", color: "#5E4A46" }}><span className="text-[11px] font-medium">{labelForma(forma)}</span><span className="text-[9px] text-[#9A8A86]">{forma === "cartao" ? formatarMoeda(totalCartao) : forma === "pix" ? "sem taxa adicional" : "conferência financeira"}</span></button>)}</div>{erro && <div className="mt-2 rounded-[11px] border border-[#F0D3D1] bg-[#FBEBEA] p-[9px] text-[9.8px] text-[#8F2A25]">{erro}</div>}<button type="button" disabled={!formaCusteio || enviando || formasDisponiveis.length === 0} onClick={() => void enviarCusteio()} className="mt-[11px] w-full rounded-[12px] bg-[#6B1F2E] p-3 text-[11.5px] font-medium text-white disabled:opacity-40">{enviando ? "Confirmando..." : "Confirmar forma de custeio"}</button></div></motion.div></>}</AnimatePresence>
  </>;
}

function DataCard({ titulo, data, horario, onAlterar }: { titulo: string; data: { dia: string; mes: string; ano: string }; horario?: string | null; onAlterar: () => void }) {
  return <div className="flex min-h-[142px] flex-col justify-between rounded-[15px] border border-[#F0E6E3] bg-white p-[14px]"><div><div className="text-[8px] font-semibold uppercase tracking-[.15em] text-[#8A7B77]">{titulo}</div><div className="pt-2 font-heading text-[31px] font-semibold leading-none text-[#7D2434]">{data.dia}</div><div className="pt-[2px] text-[9px] font-semibold uppercase tracking-[.09em] text-[#B65B67]">{data.mes}</div><div className="pt-[3px] text-[8.5px] text-[#8A7B77]">{data.ano}{horario ? ` · ${horario}` : ""}</div></div><button type="button" onClick={onAlterar} className="inline-flex items-center justify-center rounded-[9px] border border-[#F0DDDD] bg-[#FFF7F7] px-2 py-[7px] text-[8.5px] font-semibold text-[#7D2434]">Alterar data</button></div>;
}

function ConfirmarAlteracao({ confirmacao, enviando, onCancelar, onConfirmar }: { confirmacao: ConfirmacaoAlteracao; enviando: boolean; onCancelar: () => void; onConfirmar: () => void }) {
  const data = partesData(confirmacao.data);
  return <div className="border-t border-[#F0E6E3] bg-[#FFF9EF] px-[13px] py-3"><div className="text-[10px] font-light leading-[1.5] text-[#7A6B67]">Nova data: <b className="font-semibold text-[#7D2434]">{data.dia} de {data.mes.toLowerCase()} de {data.ano}</b>{confirmacao.horario ? <> às <b className="font-semibold text-[#7D2434]">{confirmacao.horario}</b></> : null}. A alteração será enviada para análise administrativa.</div><div className="mt-[9px] grid grid-cols-2 gap-2"><button type="button" onClick={onCancelar} disabled={enviando} className="rounded-[10px] border border-[#E7DAD6] bg-white px-3 py-[9px] text-[9.5px] font-semibold text-[#6B1F2E]">Voltar</button><button type="button" onClick={onConfirmar} disabled={enviando} className="rounded-[10px] bg-[#6B1F2E] px-3 py-[9px] text-[9.5px] font-semibold text-white disabled:opacity-50">{enviando ? "Enviando..." : "Solicitar alteração"}</button></div></div>;
}
