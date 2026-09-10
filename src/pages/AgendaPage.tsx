import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiJson } from "../lib/api";

type AgendaData = {
  cliente: { id: string; nome: string; procedimento: string | null };
  agendamentoAtivo: { id: string; data: string; horario: string | null; previsaoLiberacaoFinanceira: string | null; status?: string } | null;
  agendamentoConcluido: { id: string; data: string; horario: string | null; previsaoLiberacaoFinanceira: string | null; status?: string } | null;
  datasDisponiveis: { id: string; data: string; vagasRestantes: number }[];
  financeiro: { statusRevisao: string | null };
};
type Boleto = { id: string; numero_parcela: number; total_parcelas: number; valor: number; data_vencimento: string; status: string; boleto_url: string | null; comprovante_url: string | null };
type BoletosData = { boletos: Boleto[]; porcentagem_pagamento: number; pode_agendar: boolean; agenda_liberada: boolean; status_revisao_financeira: string | null; quantidade_parcelas: number };
const HORARIOS = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30"];

function brDate(value: string | null | undefined) { if (!value) return "—"; const [y, m, d] = value.slice(0, 10).split("-"); return y && m && d ? `${d}/${m}/${y}` : value; }
function brMoney(value: number) { return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function firstName(value: string) { return value.trim().split(/\s+/)[0] || value; }

export function AgendaPage() {
  const [agenda, setAgenda] = useState<AgendaData | null>(null);
  const [boletos, setBoletos] = useState<BoletosData | null>(null);
  const [aba, setAba] = useState<"agenda" | "boletos">("agenda");
  const [dataSelecionada, setDataSelecionada] = useState<string | null>(null);
  const [horario, setHorario] = useState("");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setErro(null);
    try {
      const [agendaData, boletosData] = await Promise.all([apiJson<AgendaData>("/api/cliente/agenda", { cache: "no-store" }), apiJson<BoletosData>("/api/cliente/boletos", { cache: "no-store" })]);
      setAgenda(agendaData); setBoletos(boletosData);
    } catch (error) {
      if (error instanceof Error && error.message === "Sessão expirada.") { window.history.pushState({}, "", "/login"); window.dispatchEvent(new PopStateEvent("popstate")); }
      else setErro(error instanceof Error ? error.message : "Não foi possível carregar sua agenda.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void carregar(); const timer = window.setInterval(() => void carregar(true), 30000); return () => window.clearInterval(timer); }, [carregar]);

  async function sair() { await fetch("/api/cliente/logout", { method: "POST", credentials: "same-origin" }); window.history.pushState({}, "", "/login"); window.dispatchEvent(new PopStateEvent("popstate")); }

  async function agendar() {
    if (!dataSelecionada || !horario) { setErro("Escolha a data e o horário da assinatura."); return; }
    setAction(dataSelecionada); setErro(null);
    try { await apiJson("/api/cliente/agendar", { method: "POST", body: JSON.stringify({ dataId: dataSelecionada, horario }) }); setDataSelecionada(null); setHorario(""); await carregar(true); }
    catch (error) { setErro(error instanceof Error ? error.message : "Não foi possível confirmar a data."); }
    finally { setAction(null); }
  }

  async function enviarComprovante(event: FormEvent<HTMLInputElement>, boletoId: string) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setErro("O comprovante deve ter no máximo 5 MB."); return; }
    setAction(`upload:${boletoId}`); setErro(null);
    try { const form = new FormData(); form.append("arquivo", file); await apiJson(`/api/cliente/boletos/${encodeURIComponent(boletoId)}/anexar`, { method: "POST", body: form }); await carregar(true); }
    catch (error) { setErro(error instanceof Error ? error.message : "Não foi possível enviar o comprovante."); }
    finally { setAction(null); }
  }
  function abrirArquivo(boletoId: string, tipo: "arquivo" | "comprovante") { window.location.assign(`/api/cliente/boletos/${encodeURIComponent(boletoId)}/${tipo}`); }

  if (loading) return <main className="min-h-screen bg-bloom flex items-center justify-center"><img src="/brand/sra-luck-mark.png" alt="Sra. Luck" className="h-12 w-12 animate-pulse" /></main>;
  if (!agenda || !boletos) return <main className="min-h-screen bg-bloom flex items-center justify-center p-6"><section className="surface-glass rounded-3xl p-8 text-center"><p className="text-sm text-clay/70">Não foi possível carregar sua área.</p><button className="mt-4 rounded-full bg-burgundy px-5 py-2 text-xs uppercase tracking-label text-pearl" onClick={() => void carregar()}>Tentar novamente</button></section></main>;

  const agendamento = agenda.agendamentoAtivo ?? agenda.agendamentoConcluido;
  const liberada = boletos.agenda_liberada;

  return <main className="client-app min-h-screen bg-bloom px-4 pb-8 pt-4 sm:px-6 sm:pt-8"><div className="mx-auto w-full max-w-2xl">
    <header className="mb-5 flex items-center justify-between"><div className="flex items-center gap-3"><img src="/brand/sra-luck-mark.png" alt="" className="h-10 w-10" /><div><p className="text-[0.58rem] uppercase tracking-label text-rose">Bem-vinda,</p><h1 className="text-lg font-semibold text-burgundy">{firstName(agenda.cliente.nome)}</h1></div></div><button onClick={() => void sair()} className="rounded-full px-3 py-2 text-xs uppercase tracking-label text-clay/50 hover:bg-white/60">Sair</button></header>
    <section className="surface-glass mb-4 rounded-3xl p-4 sm:p-5"><div className="flex items-end justify-between"><div><p className="text-[0.62rem] uppercase tracking-label text-rose">Jornada financeira</p><p className="mt-1 text-2xl font-semibold text-burgundy">{boletos.porcentagem_pagamento.toFixed(0)}%</p></div><span className="text-xs text-clay/55">{liberada ? "Agenda liberada" : "Em acompanhamento"}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-blush"><div className="h-full rounded-full bg-burgundy transition-all" style={{ width: `${Math.min(100, Math.max(0, boletos.porcentagem_pagamento))}%` }} /></div></section>
    <nav className="mb-4 flex gap-1 rounded-full bg-blush/70 p-1"><button onClick={() => setAba("agenda")} className={`flex-1 rounded-full px-3 py-2 text-xs font-bold uppercase tracking-label ${aba === "agenda" ? "bg-burgundy text-pearl" : "text-burgundy/60"}`}>Minha Agenda</button><button onClick={() => setAba("boletos")} className={`flex-1 rounded-full px-3 py-2 text-xs font-bold uppercase tracking-label ${aba === "boletos" ? "bg-burgundy text-pearl" : "text-burgundy/60"}`}>Meus Boletos</button></nav>
    {erro && <div role="alert" className="mb-4 rounded-2xl border border-alert/20 bg-alert/5 px-4 py-3 text-sm text-alert">{erro}</div>}
    {aba === "agenda" ? <section className="flex flex-col gap-4">
      {agendamento ? <div className="surface-glass rounded-3xl p-5"><p className="text-[0.62rem] uppercase tracking-label text-rose">Data confirmada</p><h2 className="mt-2 text-xl font-semibold text-burgundy">{brDate(agendamento.data)}</h2><p className="mt-1 text-sm text-clay/60">Assinatura dos termos {agendamento.horario ? `às ${agendamento.horario}` : ""}.</p>{agendamento.previsaoLiberacaoFinanceira && <p className="mt-3 rounded-2xl bg-success/5 px-3 py-2 text-sm text-success">Previsão da cirurgia: {brDate(agendamento.previsaoLiberacaoFinanceira)}</p>}</div> : <div className="surface-glass rounded-3xl p-5"><p className="text-sm text-clay/65">Você ainda não possui uma data confirmada.</p>{!liberada && <p className="mt-2 text-xs leading-5 text-clay/45">A agenda será liberada conforme os critérios financeiros definidos pela equipe.</p>}</div>}
      {!agendamento && liberada && <div className="surface-glass rounded-3xl p-5"><h2 className="font-semibold text-burgundy">Escolha sua data e horário</h2><p className="mt-1 text-xs text-clay/55">Selecione primeiro uma data e depois o horário disponível para a assinatura dos termos.</p><div className="mt-4 grid gap-2">{agenda.datasDisponiveis.slice(0, 30).map((data) => <button key={data.id} disabled={!data.vagasRestantes || action === data.id} onClick={() => { setDataSelecionada(data.id); setHorario(""); }} className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${dataSelecionada === data.id ? "border-burgundy bg-blush/50" : "border-rose/10 bg-white/70 hover:border-burgundy/30"} disabled:opacity-50`}><span className="text-sm font-medium text-burgundy">{brDate(data.data)}</span><span className="text-xs text-clay/50">{data.vagasRestantes} vaga{data.vagasRestantes === 1 ? "" : "s"}</span></button>)}</div>{dataSelecionada && <div className="mt-4 rounded-2xl border border-rose/10 bg-white/55 p-4"><label className="block text-xs font-semibold uppercase tracking-label text-burgundy">Horário</label><select value={horario} onChange={(e) => setHorario(e.target.value)} className="mt-2 w-full rounded-2xl border border-rose/15 bg-white px-4 py-3 text-sm text-clay outline-none focus:ring-4 focus:ring-rose/10"><option value="">Selecione um horário</option>{HORARIOS.map((h) => <option key={h} value={h}>{h}</option>)}</select><button disabled={!horario || action === dataSelecionada} onClick={() => void agendar()} className="mt-3 w-full rounded-full bg-burgundy px-5 py-3 text-sm font-medium uppercase tracking-[0.15em] text-pearl disabled:opacity-50">{action === dataSelecionada ? "Confirmando…" : "Confirmar data e horário"}</button></div>}</div>}
    </section> : <section className="space-y-3">{boletos.boletos.map((boleto) => <article key={boleto.id} className="surface-glass rounded-3xl p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[0.62rem] uppercase tracking-label text-rose">Parcela {boleto.numero_parcela}/{boleto.total_parcelas}</p><p className="mt-1 text-lg font-semibold text-burgundy">{brMoney(boleto.valor)}</p><p className="text-xs text-clay/50">Vencimento: {brDate(boleto.data_vencimento)}</p></div><span className="rounded-full bg-blush px-2.5 py-1 text-[0.62rem] uppercase tracking-label text-burgundy">{boleto.status}</span></div><div className="mt-4 flex flex-wrap gap-2">{boleto.boleto_url && <button onClick={() => abrirArquivo(boleto.id, "arquivo")} className="rounded-full border border-rose/15 bg-white/70 px-3 py-2 text-xs text-burgundy">Abrir boleto</button>}<label className="cursor-pointer rounded-full bg-burgundy px-3 py-2 text-xs text-pearl">{action === `upload:${boleto.id}` ? "Enviando…" : "Enviar comprovante"}<input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => void enviarComprovante(e, boleto.id)} disabled={action === `upload:${boleto.id}`} /></label>{boleto.comprovante_url && <button onClick={() => abrirArquivo(boleto.id, "comprovante")} className="rounded-full border border-rose/15 bg-white/70 px-3 py-2 text-xs text-burgundy">Ver comprovante</button>}</div></article>)}{boletos.boletos.length === 0 && <div className="surface-glass rounded-3xl p-6 text-center text-sm text-clay/55">Nenhum boleto disponível.</div>}</section>}
  </div></main>;
}
