"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, CheckCircle2, CreditCard, LockKeyhole, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CalendarioAgendamento, DataDisponivel } from "@/components/cliente/CalendarioAgendamento";
import { CalendarioCirurgia } from "@/components/cliente/CalendarioCirurgia";
import { toast } from "sonner";

interface Props { ativo?: boolean; }
type FormaCusteio = "cartao" | "pix" | "cheques" | "boleto_100";
type TipoAlteracao = "termos" | "cirurgia" | null;
interface Financeiro { saldoRestante: number | null; taxaCartao: number; totalComTaxa: number | null; formasCusteio: string[]; }
interface Solicitacao { id: string; forma_custeio: FormaCusteio; saldo_restante: number; taxa_cartao: number; total_com_taxa: number; status: string; observacao: string | null; }
interface ConfirmacaoAlteracao { tipo: "termos" | "cirurgia"; dataId?: string; data: string; horario?: string; }

function formatarMoeda(valor: number) { return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function partesData(iso: string) { const [ano, mes, dia] = iso.split("-"); const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]; return { dia, mes: meses[Math.max(0, Number(mes) - 1)] ?? mes, ano }; }

export function SolicitarLiberacaoFinanceira({ ativo = true }: Props) {
  const [financeiro, setFinanceiro] = useState<Financeiro>({ saldoRestante: null, taxaCartao: 5.4, totalComTaxa: null, formasCusteio: [] });
  const [solicitacao, setSolicitacao] = useState<Solicitacao | null>(null);
  const [dataAssinaturaTermos, setDataAssinaturaTermos] = useState<string | null>(null);
  const [dataCirurgia, setDataCirurgia] = useState<string | null>(null);
  const [datasTermos, setDatasTermos] = useState<DataDisponivel[]>([]);
  const [parcelasPagas, setParcelasPagas] = useState(0);
  const [quantidadeParcelas, setQuantidadeParcelas] = useState(0);
  const [valorPago, setValorPago] = useState(0);
  const [alteracao, setAlteracao] = useState<TipoAlteracao>(null);
  const [confirmacaoAlteracao, setConfirmacaoAlteracao] = useState<ConfirmacaoAlteracao | null>(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [formaCusteio, setFormaCusteio] = useState<FormaCusteio | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    try {
      const [resAgenda, resBoletos] = await Promise.all([fetch("/api/cliente/agenda", { cache: "no-store" }), fetch("/api/cliente/boletos", { cache: "no-store" })]);
      if (!resAgenda.ok) return;
      const data = await resAgenda.json();
      setFinanceiro(data.financeiro ?? { saldoRestante: null, taxaCartao: 5.4, totalComTaxa: null, formasCusteio: [] });
      setSolicitacao(data.solicitacaoLiberacaoFinanceira ?? null);
      const agenda = data.agendamentoAtivo ?? data.agendamentoConcluido ?? null;
      setDataAssinaturaTermos(agenda?.data ?? null);
      setDataCirurgia(agenda?.previsaoLiberacaoFinanceira ?? null);
      setDatasTermos(data.datasDisponiveis ?? []);
      if (resBoletos.ok) {
        const boletosData = await resBoletos.json();
        const boletos = Array.isArray(boletosData.boletos) ? boletosData.boletos : [];
        setQuantidadeParcelas(Number(boletosData.quantidade_parcelas ?? boletos.length ?? 0));
        setParcelasPagas(Number(boletosData.parcelas_pagas ?? boletos.filter((b: { status: string }) => b.status === "pago").length ?? 0));
        setValorPago(boletos.filter((b: { status: string; valor: number }) => b.status === "pago").reduce((total: number, b: { status: string; valor: number }) => total + Number(b.valor ?? 0), 0));
      }
    } catch {}
  }

  useEffect(() => { if (!ativo) return; void carregar(); const intervalo = setInterval(() => void carregar(), 5000); return () => clearInterval(intervalo); }, [ativo]);

  const saldoRestante = Number(financeiro.saldoRestante ?? 0);
  const taxaCartao = saldoRestante * (Number(financeiro.taxaCartao ?? 5.4) / 100);
  const totalCartao = financeiro.totalComTaxa ?? saldoRestante + taxaCartao;
  const parcelasRestantes = Math.max(0, quantidadeParcelas - parcelasPagas);
  const formasDisponiveis = useMemo(() => ["cartao", "pix", "cheques", "boleto_100"].filter(f => financeiro.formasCusteio.includes(f)) as FormaCusteio[], [financeiro.formasCusteio]);
  const status = String(solicitacao?.status ?? "").toLowerCase();
  const recusada = status.includes("recus");
  const aprovada = status.includes("aprov");

  function abrirModal() { setErro(null); setFormaCusteio(solicitacao?.forma_custeio ?? null); setModalAberto(true); }

  async function enviarCusteio() {
    if (!formaCusteio) return;
    setEnviando(true); setErro(null);
    try {
      const res = await fetch("/api/cliente/solicitacao-liberacao-financeira", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ formaCusteio }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? "Não foi possível enviar sua solicitação.");
      setSolicitacao(data.solicitacao ?? null); setModalAberto(false);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível enviar sua solicitação."); }
    finally { setEnviando(false); }
  }

  function prepararAlteracaoTermos(dataId: string, horario: string) { const data = datasTermos.find(d => d.id === dataId)?.data; if (!data) { setErro("Não foi possível identificar a data escolhida."); return; } setErro(null); setConfirmacaoAlteracao({ tipo: "termos", dataId, data, horario }); }
  function prepararAlteracaoCirurgia(data: string) { setErro(null); setConfirmacaoAlteracao({ tipo: "cirurgia", data }); }

  async function enviarAlteracao() {
    if (!confirmacaoAlteracao) return;
    setEnviando(true); setErro(null);
    try {
      const body = confirmacaoAlteracao.tipo === "termos" ? { tipo: "termos", dataId: confirmacaoAlteracao.dataId, horario: confirmacaoAlteracao.horario } : { tipo: "cirurgia", data: confirmacaoAlteracao.data };
      const res = await fetch("/api/cliente/remarcar-agendamento", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.erro ?? "Não foi possível enviar a alteração para análise.");
      setConfirmacaoAlteracao(null); setAlteracao(null);
      toast.success("Solicitação enviada para análise. Prazo de até 5 dias úteis. Sua agenda atual permanece inalterada até a autorização.");
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível enviar a solicitação."); }
    finally { setEnviando(false); }
  }

  function abrirAlteracao(tipo: Exclude<TipoAlteracao, null>) { setErro(null); setConfirmacaoAlteracao(null); setAlteracao(tipo); }

  const renderDataCard = (titulo: string, iso: string, tipo: Exclude<TipoAlteracao, null>) => { const data = partesData(iso); return <div className="group relative flex min-h-[150px] flex-col justify-between rounded-2xl border border-rose/12 bg-white px-5 py-5 shadow-[0_12px_35px_-28px_rgba(82,28,42,.38)] dark:border-white/8 dark:bg-white/[0.025]"><div className="flex items-start justify-between gap-3"><div><p className="text-[0.54rem] font-semibold uppercase tracking-[0.2em] text-clay/65 dark:text-pearl/75">{titulo}</p><div className="mt-2 flex items-end gap-2"><span className="font-heading text-[2.55rem] font-semibold leading-none text-burgundy dark:text-cream">{data.dia}</span><span className="pb-0.5 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-rose">{data.mes}</span></div><p className="mt-1 text-[0.62rem] font-medium tracking-[0.12em] text-clay/65 dark:text-pearl/75">{data.ano}</p></div><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose/[0.06] text-rose"><CalendarDays className="h-[17px] w-[17px]" /></span></div><button type="button" onClick={() => abrirAlteracao(tipo)} className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-lg border border-rose/15 bg-rose/[0.035] px-2.5 py-1.5 text-[0.54rem] font-bold uppercase tracking-[0.12em] text-burgundy dark:text-cream"><Pencil className="h-3 w-3" /> Alterar data</button></div>; };

  if (!ativo) return null;

  return <div className="flex flex-col gap-4">
    {dataAssinaturaTermos && dataCirurgia && <section className="overflow-hidden rounded-2xl border border-rose/15 bg-white/75 shadow-[0_14px_40px_-28px_rgba(0,0,0,.3)] dark:border-white/10 dark:bg-white/[0.035]"><div className="flex items-center justify-between gap-3 border-b border-rose/10 px-4 py-3.5"><div><p className="text-[0.55rem] font-semibold uppercase tracking-[0.18em] text-rose">Minha agenda</p><p className="mt-0.5 text-xs text-clay/70 dark:text-pearl/75">Datas registradas para o seu atendimento.</p></div><span className="rounded-full border border-success/15 bg-success/[0.06] px-2.5 py-1 text-[0.5rem] font-bold uppercase tracking-[0.12em] text-success">Confirmada</span></div><div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4">{renderDataCard("Assinatura dos termos", dataAssinaturaTermos, "termos")}{renderDataCard("Data da sua cirurgia", dataCirurgia, "cirurgia")}</div></section>}
    {alteracao === "termos" && <section className="overflow-hidden rounded-2xl border border-rose/15 bg-white/75 p-3 shadow-card dark:border-white/10 dark:bg-white/[0.035]"><div className="mb-3 flex items-center justify-between"><div><p className="text-[0.58rem] font-bold uppercase tracking-label text-rose">Alterar assinatura dos termos</p><h3 className="text-sm font-semibold text-burgundy dark:text-cream">Escolha uma nova data para a assinatura dos termos</h3><p className="mt-1 text-[0.62rem] text-clay/70 dark:text-pearl/75">A nova data será enviada para análise administrativa. Prazo de até 5 dias úteis.</p></div><button type="button" onClick={() => !enviando && setAlteracao(null)} className="rounded-full p-1 text-clay/70 dark:text-pearl/75"><X className="h-4 w-4" /></button></div><CalendarioAgendamento datas={datasTermos} onConfirmar={prepararAlteracaoTermos} confirmando={enviando} /></section>}
    {alteracao === "cirurgia" && dataAssinaturaTermos && <section className="overflow-hidden rounded-2xl border border-rose/15 bg-white/75 p-3 shadow-card dark:border-white/10 dark:bg-white/[0.035]"><div className="mb-3 flex items-center justify-between"><div><p className="text-[0.58rem] font-bold uppercase tracking-label text-rose">Alterar data da cirurgia</p><h3 className="text-sm font-semibold text-burgundy dark:text-cream">Escolha uma nova data para sua cirurgia</h3><p className="mt-1 text-[0.62rem] text-clay/70 dark:text-pearl/75">A nova data será enviada para análise administrativa. Prazo de até 5 dias úteis.</p></div><button type="button" onClick={() => !enviando && setAlteracao(null)} className="rounded-full p-1 text-clay/70 dark:text-pearl/75"><X className="h-4 w-4" /></button></div><CalendarioCirurgia dataAssinatura={dataAssinaturaTermos} dataCirurgiaAtual={dataCirurgia} modoAlteracao onSolicitarAlteracao={prepararAlteracaoCirurgia} /></section>}
    {dataAssinaturaTermos && !dataCirurgia && !alteracao && <section className={cn("rounded-2xl border px-4 py-3", recusada ? "border-alert/20 bg-alert/[0.05]" : "border-success/20 bg-success/[0.05]")}><div className="flex items-center gap-3"><CheckCircle2 className={cn("h-5 w-5", recusada ? "text-alert" : "text-success")} /><div className="flex-1"><p className={cn("text-[0.58rem] font-semibold uppercase tracking-label", recusada ? "text-alert" : "text-success")}>{recusada ? "Custeio precisa de revisão" : aprovada ? "Custeio confirmado" : "Próxima etapa"}</p><p className="text-sm text-burgundy dark:text-cream">Informe como será realizado o pagamento do saldo restante.</p></div>{(!solicitacao || recusada) && <button onClick={abrirModal} className="rounded-lg bg-rose px-3 py-2 text-[0.58rem] font-bold uppercase text-white"><CreditCard className="mr-1 inline h-3 w-3" /> Informar</button>}</div></section>}
    {dataAssinaturaTermos && !dataCirurgia && solicitacao && !alteracao && <CalendarioCirurgia dataAssinatura={dataAssinaturaTermos} onConfirmada={setDataCirurgia} />}
    {dataAssinaturaTermos && !dataCirurgia && !solicitacao && !alteracao && <section className="relative overflow-hidden rounded-2xl border border-rose/15 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.035]"><div className="pointer-events-none select-none blur-[4px] opacity-45"><CalendarioCirurgia dataAssinatura={dataAssinaturaTermos} onConfirmada={() => {}} /></div><div className="absolute inset-0 flex items-center justify-center p-4"><div className="max-w-md rounded-2xl border border-gold/30 bg-white/95 p-5 text-center dark:border-white/10 dark:bg-[#25161b]/95"><LockKeyhole className="mx-auto h-5 w-5 text-gold" /><h3 className="mt-3 font-heading text-lg font-semibold text-burgundy dark:text-cream">Agenda da cirurgia indisponível no momento</h3><p className="mt-2 text-sm text-clay/70 dark:text-pearl/70">Escolha primeiro a forma de custeio do valor restante.</p></div></div></section>}
    <AnimatePresence>{confirmacaoAlteracao && <motion.div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div className="w-full max-w-sm rounded-2xl border border-rose/15 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-[#171618]" initial={{ scale: .98, y: 6 }} animate={{ scale: 1, y: 0 }} exit={{ scale: .98, y: 6 }}><div className="flex items-start justify-between gap-3"><div><p className="text-[0.6rem] font-semibold uppercase tracking-label text-rose">Confirmação da solicitação</p><h2 className="mt-1 text-base font-semibold text-burgundy dark:text-cream">Enviar alteração para análise?</h2></div><button type="button" onClick={() => !enviando && setConfirmacaoAlteracao(null)} className="text-clay/70 dark:text-pearl/75"><X /></button></div><div className="mt-4 rounded-xl border border-rose/10 bg-blush/35 p-3 dark:border-white/10 dark:bg-white/[0.045]"><p className="text-[0.62rem] font-semibold uppercase tracking-label text-rose">{confirmacaoAlteracao.tipo === "termos" ? "Assinatura dos termos" : "Data da cirurgia"}</p><p className="mt-1 text-sm font-semibold text-burgundy dark:text-cream">{confirmacaoAlteracao.data.split("-").reverse().join("/")}{confirmacaoAlteracao.horario ? ` às ${confirmacaoAlteracao.horario}` : ""}</p></div><p className="mt-3 text-[0.68rem] leading-relaxed text-clay/75 dark:text-pearl/80">A solicitação será enviada para análise administrativa. O prazo é de até <strong className="text-burgundy dark:text-cream">5 dias úteis</strong>. Sua data atual continuará válida até a autorização.</p>{erro && <p className="mt-3 rounded-lg bg-alert/10 p-2 text-[0.62rem] text-alert">{erro}</p>}<div className="mt-4 flex gap-2"><button type="button" disabled={enviando} onClick={() => setConfirmacaoAlteracao(null)} className="flex-1 rounded-xl border border-rose/15 px-3 py-2.5 text-[0.62rem] font-bold uppercase tracking-label text-clay/75 dark:border-white/10 dark:text-pearl/80">Cancelar</button><button type="button" disabled={enviando} onClick={() => void enviarAlteracao()} className="flex-1 rounded-xl bg-burgundy px-3 py-2.5 text-[0.62rem] font-bold uppercase tracking-label text-cream disabled:opacity-50">{enviando ? "Enviando..." : "Confirmar solicitação"}</button></div></motion.div></motion.div>}</AnimatePresence>
    <AnimatePresence>{modalAberto && <motion.div className="fixed inset-0 z-[80] grid h-[100dvh] w-full grid-rows-[minmax(0,1fr)] overflow-hidden bg-black/55 p-3 backdrop-blur-sm sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => { if (e.target === e.currentTarget && !enviando) setModalAberto(false); }}><motion.div role="dialog" aria-modal="true" initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .98 }} className="mx-auto my-auto w-full max-w-md max-h-full overflow-y-auto overscroll-contain rounded-2xl border border-rose/15 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-clay shadow-2xl [-webkit-overflow-scrolling:touch] dark:border-white/10 dark:bg-[#171618] dark:text-white sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[0.6rem] font-semibold uppercase tracking-label text-rose">Custeio do valor restante</p><h2 className="mt-1 font-heading text-base font-semibold text-burgundy dark:text-cream">Informe como será realizado o pagamento</h2></div><button type="button" onClick={() => !enviando && setModalAberto(false)} className="rounded-full p-1.5 text-clay/50 hover:bg-blush dark:text-white/50 dark:hover:bg-white/10"><X className="h-4 w-4" /></button></div><div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-blush/45 p-3 dark:bg-white/[0.045]"><div><p className="text-[0.55rem] font-semibold uppercase tracking-label text-clay/60 dark:text-white/60">Parcelas pagas</p><p className="mt-0.5 text-sm font-bold text-burgundy dark:text-rose">{parcelasPagas} de {quantidadeParcelas || "—"}</p></div><div><p className="text-[0.55rem] font-semibold uppercase tracking-label text-clay/60 dark:text-white/60">Valor pago</p><p className="mt-0.5 text-sm font-bold text-burgundy dark:text-rose">{formatarMoeda(valorPago)}</p></div><div><p className="text-[0.55rem] font-semibold uppercase tracking-label text-clay/60 dark:text-white/60">Parcelas restantes</p><p className="mt-0.5 text-sm font-bold text-burgundy dark:text-rose">{parcelasRestantes}</p></div><div><p className="text-[0.55rem] font-semibold uppercase tracking-label text-clay/60 dark:text-white/60">Valor restante</p><p className="mt-0.5 text-sm font-bold text-burgundy dark:text-rose">{formatarMoeda(saldoRestante)}</p></div></div><div className="mt-3 rounded-xl border border-gold/20 bg-gold/[0.06] p-3 dark:border-gold/25 dark:bg-gold/[0.05]"><p className="text-[0.55rem] font-semibold uppercase tracking-label text-gold">Valor a pagar no dia da assinatura dos termos</p><p className="mt-1 text-lg font-bold text-burgundy dark:text-cream">{formatarMoeda(saldoRestante)}</p><p className="mt-1 text-[0.6rem] leading-relaxed text-clay/70 dark:text-white/70">Este é o saldo restante previsto para quitação na assinatura dos termos, conforme o contrato.</p></div><div className="mt-3 grid gap-2">{formasDisponiveis.map(forma => { const titulo = forma === "cartao" ? "Cartão de crédito" : forma === "pix" ? "PIX" : forma === "cheques" ? "Cheques" : "100% boleto"; const descricao = forma === "cartao" ? "taxa configurada no contrato" : forma === "pix" ? "sem taxa adicional" : "análise de até 5 dias úteis"; return <button key={forma} type="button" onClick={() => setFormaCusteio(forma)} className={cn("flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition", formaCusteio === forma ? "border-burgundy bg-burgundy text-cream" : "border-rose/15 bg-white text-clay/70 hover:border-rose dark:border-white/10 dark:bg-white/[0.035] dark:text-white/75")}><span><span className="block text-[0.72rem] font-semibold">{titulo}</span><span className="block text-[0.6rem] opacity-60">{descricao}</span></span><span className={cn("h-3.5 w-3.5 rounded-full border", formaCusteio === forma ? "border-cream bg-cream" : "border-clay/25 dark:border-white/30")} /></button>; })}</div>{formasDisponiveis.length === 0 && <p className="mt-3 rounded-xl bg-alert/10 p-3 text-xs text-alert">Nenhuma forma de custeio está disponível para este contrato no momento.</p>}{erro && <p className="mt-3 rounded-xl bg-alert/10 p-3 text-xs text-alert">{erro}</p>}<button type="button" onClick={enviarCusteio} disabled={!formaCusteio || enviando || formasDisponiveis.length === 0} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-burgundy px-4 py-3 text-[0.66rem] font-bold uppercase tracking-[0.12em] text-cream transition hover:bg-burgundy-dark disabled:cursor-not-allowed disabled:opacity-45">{enviando ? "Enviando..." : "Confirmar custeio e liberar agenda"}</button></motion.div></motion.div>}</AnimatePresence>
  </div>;
}
