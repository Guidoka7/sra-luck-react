"use client";

import { type FC, useEffect, useMemo, useRef, useState } from "react";
import { addMonths, format, getDaysInMonth, isBefore, isToday, startOfDay, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { subscribeAgendaSync } from "@/lib/agendaRealtime";
import type { AgendaData } from "@/lib/clienteAgenda";

export interface DataCirurgiaDisponivel { id: string; data: string; vagasRestantes: number; }
type FormaCusteio = "cartao" | "pix" | "cheques" | "boleto_100";
export interface CalendarioCirurgiaProps { dataAssinatura: string; dataCirurgiaAtual?: string | null; onConfirmada?: (data: string) => void; modoAlteracao?: boolean; onSolicitarAlteracao?: (data: string) => void; termosAssinados?: boolean; formaCusteio?: FormaCusteio | null; /** Dados já carregados pela página: renderiza na hora, sem consulta própria. */ snapshot?: AgendaData | null; }

function parseDataLocal(iso: string) { const [ano, mes, dia] = iso.split("-").map(Number); return new Date(ano, mes - 1, dia); }
const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];
const HORARIOS_CIRURGIA = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "14:00", "14:30", "15:00", "15:30", "16:00"];

export function deveExibirInformativoAnaliseCusteio(formaCusteio: FormaCusteio | null | undefined) {
  return formaCusteio === "boleto_100" || formaCusteio === "cheques";
}

export const CalendarioCirurgia: FC<CalendarioCirurgiaProps> = ({ dataAssinatura, dataCirurgiaAtual = null, onConfirmada, modoAlteracao = false, onSolicitarAlteracao, termosAssinados = false, formaCusteio = null, snapshot = null }) => {
  const hoje = startOfDay(new Date());
  const [datas, setDatas] = useState<DataCirurgiaDisponivel[]>(snapshot?.datasCirurgiaDisponiveis ?? []);
  const [mesAtual, setMesAtual] = useState(() => startOfMonth(dataCirurgiaAtual ? parseDataLocal(dataCirurgiaAtual) : hoje));
  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(dataCirurgiaAtual);
  const [horarioSelecionado, setHorarioSelecionado] = useState<string>(HORARIOS_CIRURGIA[0]);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [avisoAtualizacao, setAvisoAtualizacao] = useState<string | null>(null);
  const consultaEmAndamento = useRef<Promise<void> | null>(null);
  const [agendaLiberada, setAgendaLiberada] = useState(Boolean(snapshot?.agendaCirurgicaLiberada));
  const [custeioConfirmado, setCusteioConfirmado] = useState(Boolean(snapshot?.financeiro?.custeioConfirmadoEm));

  useEffect(() => {
    if (!snapshot) return;
    setDatas(snapshot.datasCirurgiaDisponiveis ?? []);
    setAgendaLiberada(Boolean(snapshot.agendaCirurgicaLiberada));
    setCusteioConfirmado(Boolean(snapshot.financeiro?.custeioConfirmadoEm));
  }, [snapshot]);

  async function carregar(manual = false) {
    if (manual) { setAtualizando(true); setAvisoAtualizacao(null); }
    try {
      if (!consultaEmAndamento.current) {
        consultaEmAndamento.current = (async () => {
          try {
            const res = await fetch("/api/cliente/agenda", { cache: "no-store" });
            if (!res.ok) throw new Error("Falha ao consultar a agenda.");
            const data = await res.json();
            setDatas(data.datasCirurgiaDisponiveis ?? []);
            setAgendaLiberada(Boolean(data.agendaCirurgicaLiberada));
            setCusteioConfirmado(Boolean(data.financeiro?.custeioConfirmadoEm));
          } finally {
            consultaEmAndamento.current = null;
          }
        })();
      }
      await consultaEmAndamento.current;
      if (manual) setAvisoAtualizacao("Status atualizado.");
    } catch {
      if (manual) setAvisoAtualizacao("Não foi possível atualizar o status. Tente novamente.");
    } finally {
      if (manual) setAtualizando(false);
    }
  }

  useEffect(() => {
    // Com snapshot, a página já mantém a agenda atualizada (realtime + polling).
    if (snapshot) return;
    void carregar();

    const unsubscribeRealtime = subscribeAgendaSync((tipo) => {
      if (tipo === "cirurgia") void carregar();
    });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void carregar();
    }, 5000);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void carregar();
    };
    const aoFoco = () => void carregar();
    const aoOnline = () => void carregar();

    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoFoco);
    window.addEventListener("online", aoOnline);

    return () => {
      unsubscribeRealtime();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoFoco);
      window.removeEventListener("online", aoOnline);
    };
  }, [Boolean(snapshot)]);

  const porData = useMemo(() => new Map(datas.map((item) => [item.data, item])), [datas]);

  useEffect(() => {
    if (!diaSelecionado) return;
    if (modoAlteracao && diaSelecionado === dataCirurgiaAtual) return;
    const atual = porData.get(diaSelecionado);
    if (!atual || atual.vagasRestantes <= 0) {
      setDiaSelecionado(null);
      setErro("A data selecionada não está mais disponível. A agenda foi atualizada.");
    }
  }, [porData, diaSelecionado, modoAlteracao, dataCirurgiaAtual]);

  const celulas = Array.from({ length: mesAtual.getDay() + getDaysInMonth(mesAtual) }, (_, index) => index < mesAtual.getDay() ? null : index - mesAtual.getDay() + 1);

  function mudarMes(delta: 1 | -1) {
    setMesAtual((atual) => delta === 1 ? addMonths(atual, 1) : subMonths(atual, 1));
    setDiaSelecionado(null);
    setErro(null);
  }

  function selecionarDia(dia: Date) {
    if ((!modoAlteracao && !agendaLiberada) || isBefore(dia, hoje)) return;
    const chave = format(dia, "yyyy-MM-dd");
    const entrada = porData.get(chave);
    if (!entrada || entrada.vagasRestantes <= 0) return;
    setDiaSelecionado(chave === diaSelecionado ? null : chave);
    setErro(null);
  }

  async function confirmar() {
    if (!diaSelecionado || confirmando || (!modoAlteracao && !agendaLiberada)) return;
    if (modoAlteracao) { onSolicitarAlteracao?.(diaSelecionado); return; }
    setConfirmando(true); setErro(null);
    try {
      const res = await fetch("/api/cliente/agendar-cirurgia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: diaSelecionado, horario: horarioSelecionado }) });
      const resultado = await res.json();
      if (!res.ok) {
        setErro(resultado.erro ?? "Não foi possível confirmar a data da cirurgia.");
        await carregar();
        return;
      }
      onConfirmada?.(resultado.data);
      await carregar();
    } catch { setErro("Erro de conexão. Tente novamente."); }
    finally { setConfirmando(false); }
  }

  if (!modoAlteracao && !termosAssinados && !custeioConfirmado) {
    return <section className="relative min-h-[305px] overflow-hidden rounded-[18px] border border-[#EFE4E1] bg-white p-[13px]">
      <div className="pointer-events-none select-none opacity-[.36] blur-[4px]"><div className="pb-2 text-center font-heading text-[16px] font-semibold text-[#7D2434]">Escolha a data da sua cirurgia</div><CalendarGrid mesAtual={mesAtual} celulas={celulas} porData={porData} hoje={hoje} selecionado={null} onSelecionar={() => {}} mudarMes={mudarMes} bloqueado /></div>
      <div className="absolute inset-0 flex items-center justify-center p-5"><div className="rounded-[15px] border border-[#E9D4B2] bg-white/[.97] p-[17px] text-center shadow-[0_14px_35px_rgba(95,54,58,.12)]"><svg width="20" height="20" viewBox="0 0 18 18" fill="none" stroke="#8E3243" strokeWidth="1.25" className="mx-auto"><rect x="3.8" y="8" width="10.4" height="7" rx="1.8"/><path d="M6.2 8V5.9a2.8 2.8 0 0 1 5.6 0V8"/></svg><div className="pt-[7px] font-heading text-[18px] font-semibold text-[#7D2434]">Agenda cirúrgica bloqueada</div><div className="pt-[5px] text-[10px] font-light leading-[1.5] text-[#7A6B67]">A quitação do saldo precisa ser confirmada antes da escolha da data da cirurgia.</div></div></div>
    </section>;
  }

  if (!modoAlteracao && !agendaLiberada) {
    return <section aria-label="Agenda cirúrgica aguardando liberação" className="relative isolate grid min-h-[340px] overflow-hidden rounded-[18px] border border-[#EFE4E1] bg-white shadow-[0_10px_26px_rgba(70,42,44,.07)]">
      <div aria-hidden="true" className="pointer-events-none col-start-1 row-start-1 select-none p-[13px] opacity-[.36] blur-[4px]">
        <div className="pb-2 text-center font-heading text-[16px] font-semibold text-[#7D2434]">Escolha a data da sua cirurgia</div>
        <CalendarGrid mesAtual={mesAtual} celulas={celulas} porData={porData} hoje={hoje} selecionado={null} onSelecionar={() => {}} mudarMes={mudarMes} bloqueado />
      </div>
      <div className="z-10 col-start-1 row-start-1 flex items-center justify-center p-5">
        <div className="w-full rounded-[15px] border border-[#E9D4B2] bg-white/[.97] p-[17px] text-center shadow-[0_14px_35px_rgba(95,54,58,.12)]">
          <span className="mx-auto flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#FBF1DD] text-[#A77A24]">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><circle cx="9" cy="9" r="6.2"/><path d="M9 5.6V9l2.3 1.5"/></svg>
          </span>
          <div className="pt-[9px] text-[8.5px] font-bold uppercase tracking-[.13em] text-[#A77A24]">Agenda cirúrgica</div>
          <h3 className="pt-[3px] font-heading text-[18px] font-semibold text-[#7D2434]">Aguardando liberação</h3>
          <p className="pt-[5px] text-[10.5px] font-light leading-[1.5] text-[#7A6B67]">Assim que a agenda for liberada, você poderá consultar as datas disponíveis e escolher quando realizar sua cirurgia.</p>
          {deveExibirInformativoAnaliseCusteio(formaCusteio) && (
            <details className="mt-3 text-[10px] leading-[1.5] text-[#7A6B67]">
              <summary className="cursor-pointer rounded py-1 font-medium text-[#7D2434] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Como funciona a liberação?</summary>
              <p className="pt-2">A liberação depende da confirmação da assinatura dos termos, da quitação e do prazo aplicável ao seu processo. Quando essas etapas forem concluídas e a agenda estiver liberada, o calendário ficará disponível aqui para você escolher a data.</p>
            </details>
          )}
          <button type="button" onClick={() => void carregar(true)} disabled={atualizando} className="mt-3 min-h-[40px] w-full rounded-[10px] border border-[#E9D4B2] bg-[#FFF9EF] px-3 py-2 text-[10px] font-medium text-[#7D2434] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
            {atualizando ? "Atualizando..." : "Atualizar status"}
          </button>
          <p role="status" aria-live="polite" className="pt-2 text-[9.5px] leading-[1.5] text-[#7A6B67]">{avisoAtualizacao}</p>
        </div>
      </div>
    </section>;
  }

  if (!modoAlteracao && agendaLiberada && datas.length === 0) {
    return <section className="rounded-[18px] border border-[#DCEADF] bg-[#F0F7F1] p-[14px]"><div className="flex items-start gap-[10px]"><span className="flex h-[31px] w-[31px] flex-none items-center justify-center rounded-full bg-[#E3F1E6] text-[#3F7D5B]"><svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><circle cx="9" cy="9" r="6.2"/><path d="m6 9 2 2 4-4"/></svg></span><div><div className="text-[8.5px] font-bold uppercase tracking-[.13em] text-[#3F7D5B]">Agenda cirúrgica liberada</div><div className="pt-[3px] font-heading text-[17px] font-semibold text-[#7D2434]">Aguardando novas datas da equipe</div><div className="pt-[4px] text-[10px] font-light leading-[1.5] text-[#698273]">Assim que novas datas forem publicadas, elas aparecerão aqui para escolha.</div></div></div></section>;
  }

  return <section className="overflow-hidden rounded-[18px] border border-[#EFE4E1] bg-white shadow-[0_10px_26px_rgba(70,42,44,.07)]">
    {!modoAlteracao && <div className="border-b border-[#F0DDDD] bg-[#FFF7F7] px-[13px] py-3"><div className="text-[8.5px] font-bold uppercase tracking-[.13em] text-[#B65B67]">Escolha a data da sua cirurgia</div><div className="pt-[2px] font-heading text-[15px] font-semibold text-[#7D2434]">Sua agenda cirúrgica está liberada</div><div className="pt-[2px] text-[9.5px] font-light text-[#7A6B67]">Os termos foram assinados em <b className="font-medium text-[#7D2434]">{format(parseDataLocal(dataAssinatura), "dd/MM/yyyy")}</b>. Escolha uma data liberada pela equipe.</div></div>}
    <div className="p-[13px]">
      <CalendarGrid mesAtual={mesAtual} celulas={celulas} porData={porData} hoje={hoje} selecionado={diaSelecionado} onSelecionar={selecionarDia} mudarMes={mudarMes} />
      {diaSelecionado && <div className="mt-[11px] rounded-[12px] bg-[#F9F0EE] p-[11px] text-center">
        <div className="text-[10.2px] font-light text-[#7A6B67]">Você selecionou <b className="font-semibold text-[#7D2434]">{format(parseDataLocal(diaSelecionado), "d 'de' MMMM", { locale: ptBR })}</b></div>
        {!modoAlteracao && <label className="mt-[9px] flex items-center justify-center gap-[7px] text-[10px] text-[#7A6B67]">
          Horário:
          <select value={horarioSelecionado} onChange={(e) => setHorarioSelecionado(e.target.value)} className="rounded-[8px] border border-[#EADFDB] bg-white px-2 py-1 text-[10.5px] text-[#7D2434]">
            {HORARIOS_CIRURGIA.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>}
        <button type="button" onClick={() => void confirmar()} disabled={confirmando} className="mt-[9px] w-full rounded-[11px] bg-[#6B1F2E] px-[13px] py-[11px] text-[11px] font-medium text-white disabled:opacity-50">{confirmando ? "Confirmando..." : modoAlteracao ? "Solicitar alteração" : "Confirmar data"}</button>{modoAlteracao && <button type="button" onClick={() => window.location.reload()} className="mt-[8px] text-[9px] font-medium text-[#8A7B77] underline">Cancelar alteração</button>}</div>}
      {erro && <div className="mt-2 rounded-[10px] border border-[#F0D3D1] bg-[#FBEBEA] p-[9px] text-center text-[9.5px] text-[#8F2A25]">{erro}</div>}
    </div>
  </section>;
};

function CalendarGrid({ mesAtual, celulas, porData, hoje, selecionado, onSelecionar, mudarMes, bloqueado = false }: { mesAtual: Date; celulas: (number | null)[]; porData: Map<string, DataCirurgiaDisponivel>; hoje: Date; selecionado: string | null; onSelecionar: (dia: Date) => void; mudarMes: (delta: 1 | -1) => void; bloqueado?: boolean }) {
  return <>
    <div className="mb-[11px] flex items-center justify-between"><button type="button" onClick={() => mudarMes(-1)} disabled={bloqueado} aria-label="Mês anterior" className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#FDF8F7] text-[19px] font-light leading-none text-[#7D2434]">‹</button><div className="font-heading text-[15px] font-semibold capitalize text-[#7D2434]">{format(mesAtual, "MMMM yyyy", { locale: ptBR })}</div><button type="button" onClick={() => mudarMes(1)} disabled={bloqueado} aria-label="Próximo mês" className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#FDF8F7] text-[19px] font-light leading-none text-[#7D2434]">›</button></div>
    <div className="grid grid-cols-7 gap-[5px] pb-[7px] text-center">{DIAS.map((dia, index) => <div key={`${dia}-${index}`} className="text-[8px] font-semibold uppercase text-[#B65B67]">{dia}</div>)}</div>
    <div className="grid grid-cols-7 gap-[5px]">{celulas.map((numero, index) => {
      if (numero === null) return <div key={`vazio-${index}`} className="aspect-square" />;
      const dia = new Date(mesAtual.getFullYear(), mesAtual.getMonth(), numero);
      const chave = format(dia, "yyyy-MM-dd");
      const entrada = porData.get(chave);
      const passado = isBefore(dia, hoje);
      const disponivel = Boolean(entrada && entrada.vagasRestantes > 0 && !passado);
      const ativo = chave === selecionado;
      const ehHoje = isToday(dia);
      const estilo = ativo ? { background: "#6B1F2E", borderColor: "#6B1F2E", color: "#FFF", fontWeight: 600 } : disponivel ? { background: "#F3F8F4", borderColor: "#D5E8D9", color: "#3F7D5B", fontWeight: 500 } : { background: passado ? "transparent" : "#FAF5F4", borderColor: "transparent", color: passado ? "#D0C5C2" : "#B8AAA6", fontWeight: 400, textDecoration: passado ? "none" : "line-through" };
      return <button type="button" key={chave} aria-label={format(dia, "d 'de' MMMM 'de' yyyy", { locale: ptBR })} aria-pressed={ativo} disabled={!disponivel || bloqueado} onClick={() => onSelecionar(dia)} className="relative aspect-square rounded-[9px] border text-[10.5px]" style={estilo}><span className="flex h-full w-full items-center justify-center">{numero}</span>{ehHoje && !ativo && <span className="absolute bottom-[3px] left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-[#B65B67]" />}</button>;
    })}</div>
  </>;
}
