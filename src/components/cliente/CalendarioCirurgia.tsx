"use client";

import { type FC, useEffect, useMemo, useState } from "react";
import { addMonths, format, getDaysInMonth, isBefore, isToday, startOfDay, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";

export interface DataCirurgiaDisponivel {
  id: string;
  data: string;
  vagasRestantes: number;
  status: "disponivel" | "lotada" | "fechada";
  horarios: Array<{ horario: string; disponivel: boolean }>;
}
export interface CalendarioCirurgiaProps {
  dataAssinatura: string;
  dataCirurgiaAtual?: string | null;
  onConfirmada?: (data: string) => void;
  modoAlteracao?: boolean;
  onSolicitarAlteracao?: (data: string) => void;
}

function parseDataLocal(iso: string) {
  const parts=iso.split("-").map(Number);
  return new Date(parts[0],parts[1]-1,parts[2]);
}
function formatarData(iso: string | null) { return iso ? format(parseDataLocal(iso),"dd/MM/yyyy") : "—"; }
const DIAS=["D","S","T","Q","Q","S","S"];

export const CalendarioCirurgia: FC<CalendarioCirurgiaProps> = ({ dataAssinatura, dataCirurgiaAtual=null, onConfirmada, modoAlteracao=false, onSolicitarAlteracao }) => {
  const hoje=startOfDay(new Date());
  const [datas,setDatas]=useState<DataCirurgiaDisponivel[]>([]);
  const [mesAtual,setMesAtual]=useState(()=>startOfMonth(dataCirurgiaAtual?parseDataLocal(dataCirurgiaAtual):hoje));
  const [diaSelecionado,setDiaSelecionado]=useState<string|null>(dataCirurgiaAtual);
  const [horario,setHorario]=useState<string|null>(null);
  const [confirmando,setConfirmando]=useState(false);
  const [erro,setErro]=useState<string|null>(null);
  const [agendaLiberada,setAgendaLiberada]=useState(false);
  const [previsao,setPrevisao]=useState<string|null>(null);

  async function carregar() {
    try {
      const res=await fetch("/api/cliente/agenda/cirurgias",{cache:"no-store"});
      if(!res.ok)return;
      const data=await res.json();
      setDatas(data.datas ?? []);
      setAgendaLiberada(Boolean(data.liberada));
      setPrevisao(data.previsao ?? null);
      const agendamento=data.agendamento ?? null;
      if(agendamento?.dataCirurgia) {
        setDiaSelecionado(agendamento.dataCirurgia);
        setHorario(agendamento.horarioCirurgia ?? null);
      }
    } catch {}
  }

  useEffect(()=>{void carregar();const timer=window.setInterval(()=>void carregar(),15000);return()=>window.clearInterval(timer);},[]);

  const porData=useMemo(()=>new Map(datas.map((item)=>[item.data,item])),[datas]);
  const celulas=Array.from({length:mesAtual.getDay()+getDaysInMonth(mesAtual)},(_,index)=>index<mesAtual.getDay()?null:index-mesAtual.getDay()+1);
  const selecionada=diaSelecionado?porData.get(diaSelecionado)??null:null;
  const horarios=selecionada?.horarios?.filter((item)=>item.disponivel)??[];

  function mudarMes(delta:1|-1) {
    setMesAtual((atual)=>delta===1?addMonths(atual,1):subMonths(atual,1));
    setDiaSelecionado(null);
    setHorario(null);
    setErro(null);
  }
  function selecionarDia(dia:Date) {
    if(isBefore(dia,hoje))return;
    const chave=format(dia,"yyyy-MM-dd");
    const entrada=porData.get(chave);
    if(!entrada||entrada.status!=="disponivel"||entrada.vagasRestantes<=0)return;
    setDiaSelecionado(chave===diaSelecionado?null:chave);
    setHorario(null);
    setErro(null);
  }
  async function confirmar() {
    if(!diaSelecionado||!horario) {
      setErro("Escolha a data e o horário da cirurgia.");
      return;
    }
    if(modoAlteracao) {
      onSolicitarAlteracao?.(diaSelecionado);
      return;
    }
    setConfirmando(true);
    setErro(null);
    try {
      const res=await fetch("/api/cliente/agenda/cirurgias/selecionar",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({data:diaSelecionado,horario}),
      });
      const resultado=await res.json();
      if(!res.ok){setErro(resultado.erro??"Não foi possível confirmar a cirurgia.");return;}
      onConfirmada?.(resultado.data);
      await carregar();
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setConfirmando(false);
    }
  }

  if(!modoAlteracao&&!agendaLiberada) {
    return <section className="rounded-[18px] border border-[#EFD9AA] bg-[#FFF9EF] p-[14px]">
      <div className="flex items-start gap-[10px]">
        <span className="flex h-[31px] w-[31px] flex-none items-center justify-center rounded-full bg-[#FBF1DD] text-[#A77A24]">◷</span>
        <div><div className="text-[8.5px] font-bold uppercase tracking-[.13em] text-[#A77A24]">Agenda cirúrgica bloqueada</div><div className="pt-[3px] font-heading text-[17px] font-semibold text-[#7D2434]">Aguardando liberação da equipe</div><div className="pt-[4px] text-[10px] font-light leading-[1.5] text-[#7A6B67]">A agenda será liberada quando a previsão estiver confirmada, sua presença nos termos estiver registrada e a quitação integral tiver sido confirmada.</div></div>
      </div>
    </section>;
  }

  return <section className="overflow-hidden rounded-[18px] border border-[#EFE4E1] bg-white shadow-[0_10px_26px_rgba(70,42,44,.07)]">
    {!modoAlteracao&&<div className="border-b border-[#F0DDDD] bg-[#FFF7F7] px-[13px] py-3">
      <div className="text-[8.5px] font-bold uppercase tracking-[.13em] text-[#B65B67]">Segunda agenda liberada</div>
      <div className="pt-[2px] font-heading text-[15px] font-semibold text-[#7D2434]">Escolha a data e o horário da sua cirurgia</div>
      <div className="pt-[2px] text-[9.5px] font-light text-[#7A6B67]">Sua previsão confirmada é <b className="font-semibold text-[#7D2434]">{formatarData(previsao)}</b>. Datas anteriores aparecem como lotadas apenas para você.</div>
    </div>}
    <div className="p-[13px]">
      <CalendarGrid mesAtual={mesAtual} celulas={celulas} porData={porData} hoje={hoje} selecionado={diaSelecionado} onSelecionar={selecionarDia} mudarMes={mudarMes}/>
      {diaSelecionado&&<div className="mt-[11px] rounded-[12px] bg-[#F9F0EE] p-[11px]">
        <div className="text-center text-[10.2px] font-light text-[#7A6B67]">Você selecionou <b className="font-semibold text-[#7D2434]">{format(parseDataLocal(diaSelecionado),"d 'de' MMMM",{locale:ptBR})}</b></div>
        <div className="mt-[9px] grid grid-cols-3 gap-[6px]">
          {horarios.map((item)=><button type="button" key={item.horario} onClick={()=>setHorario(item.horario)} className={"rounded-[9px] border px-2 py-[8px] text-[9.5px] font-semibold "+(horario===item.horario?"border-[#6B1F2E] bg-[#6B1F2E] text-white":"border-[#E8D9D5] bg-white text-[#6B1F2E]")}>{item.horario}</button>)}
        </div>
        {horarios.length===0?<div className="mt-2 text-center text-[9px] text-[#9B6B70]">Nenhum horário disponível nesta data.</div>:null}
        <button type="button" onClick={()=>void confirmar()} disabled={confirmando||!horario} className="mt-[9px] w-full rounded-[11px] bg-[#6B1F2E] px-[13px] py-[11px] text-[11px] font-medium text-white disabled:opacity-40">{confirmando?"Confirmando...":modoAlteracao?"Solicitar alteração":"Confirmar cirurgia"}</button>
      </div>}
      {erro&&<div className="mt-2 rounded-[10px] border border-[#F0D3D1] bg-[#FBEBEA] p-[9px] text-center text-[9.5px] text-[#8F2A25]">{erro}</div>}
    </div>
  </section>;
};

function CalendarGrid({mesAtual,celulas,porData,hoje,selecionado,onSelecionar,mudarMes}:{
  mesAtual:Date;
  celulas:(number|null)[];
  porData:Map<string,DataCirurgiaDisponivel>;
  hoje:Date;
  selecionado:string|null;
  onSelecionar:(dia:Date)=>void;
  mudarMes:(delta:1|-1)=>void;
}) {
  return <>
    <div className="mb-[11px] flex items-center justify-between"><button type="button" onClick={()=>mudarMes(-1)} className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#FDF8F7] text-[19px] font-light leading-none text-[#7D2434]">‹</button><div className="font-heading text-[15px] font-semibold capitalize text-[#7D2434]">{format(mesAtual,"MMMM yyyy",{locale:ptBR})}</div><button type="button" onClick={()=>mudarMes(1)} className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#FDF8F7] text-[19px] font-light leading-none text-[#7D2434]">›</button></div>
    <div className="grid grid-cols-7 gap-[5px] pb-[7px] text-center">{DIAS.map((dia,index)=><div key={dia+index} className="text-[8px] font-semibold uppercase text-[#B65B67]">{dia}</div>)}</div>
    <div className="grid grid-cols-7 gap-[5px]">{celulas.map((numero,index)=>{
      if(numero===null)return <div key={"vazio-"+index} className="aspect-square"/>;
      const dia=new Date(mesAtual.getFullYear(),mesAtual.getMonth(),numero);
      const chave=format(dia,"yyyy-MM-dd");
      const entrada=porData.get(chave);
      const passado=isBefore(dia,hoje);
      const status=entrada?.status??"fechada";
      const disponivel=Boolean(entrada&&status==="disponivel"&&entrada.vagasRestantes>0&&!passado);
      const ativo=chave===selecionado;
      const label=status==="lotada"?"Lotada":status==="fechada"?"Fechada":"Disponível";
      const estilo=ativo
        ? {background:"#6B1F2E",borderColor:"#6B1F2E",color:"#FFF",fontWeight:600}
        : disponivel
          ? {background:"#F3F8F4",borderColor:"#D5E8D9",color:"#3F7D5B",fontWeight:500}
          : status==="lotada"
            ? {background:"#FBEBEA",borderColor:"#F0D3D1",color:"#A43A36",fontWeight:500}
            : {background:passado?"transparent":"#FAF5F4",borderColor:"transparent",color:passado?"#D0C5C2":"#B8AAA6",fontWeight:400};
      return <button type="button" key={chave} disabled={!disponivel} onClick={()=>onSelecionar(dia)} className="relative aspect-square rounded-[9px] border text-[10.5px]" style={estilo} aria-label={chave+" · "+label}>
        <span className="flex h-full w-full items-center justify-center">{numero}</span>
        {!disponivel&&!passado?<span className="absolute bottom-[2px] left-1/2 -translate-x-1/2 text-[5px] font-bold uppercase">{status==="lotada"?"LOTADA":"FECHADA"}</span>:null}
        {isToday(dia)&&!ativo?<span className="absolute bottom-[3px] left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-[#B65B67]"/>:null}
      </button>;
    })}</div>
  </>;
}
