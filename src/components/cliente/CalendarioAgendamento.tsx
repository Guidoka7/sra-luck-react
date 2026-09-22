"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addMonths, format, getDaysInMonth, isBefore, isToday, startOfDay, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";

export interface HorarioDisponivel {
  id: string;
  horario: string;
  vagasRestantes?: number;
}

export interface DataDisponivel {
  id: string;
  data: string;
  vagasRestantes: number;
  horarios?: HorarioDisponivel[];
}

interface CalendarioAgendamentoProps {
  datas: DataDisponivel[];
  onConfirmar: (dataOuJanelaId: string, horario: string) => void;
  confirmando: boolean;
  bloqueado?: boolean;
  contexto?: "termos" | "cirurgia";
}

const HORARIOS_PADRAO = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30"];
const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];

function parseDataLocal(iso: string): Date {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, dia);
}

export function CalendarioAgendamento({ datas, onConfirmar, confirmando, bloqueado = false, contexto = "termos" }: CalendarioAgendamentoProps) {
  const hoje = startOfDay(new Date());
  const inicializado = useRef(false);
  const [mesAtual, setMesAtual] = useState(() => {
    const hojeStr = format(hoje, "yyyy-MM-dd");
    const futuras = datas.map((item) => item.data).filter((data) => data >= hojeStr).sort();
    return futuras[0] ? startOfMonth(parseDataLocal(futuras[0])) : startOfMonth(hoje);
  });
  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(null);
  const [horarioSelecionado, setHorarioSelecionado] = useState<string | null>(null);

  useEffect(() => {
    if (inicializado.current) return;
    const primeira = datas.map((item) => item.data).filter((data) => data >= format(hoje, "yyyy-MM-dd")).sort()[0];
    if (primeira) setMesAtual(startOfMonth(parseDataLocal(primeira)));
    inicializado.current = true;
  }, [datas, hoje]);

  const porData = useMemo(() => new Map(datas.map((item) => [item.data, item])), [datas]);

  useEffect(() => {
    if (!diaSelecionado) return;
    const atual = porData.get(diaSelecionado);
    if (!atual || atual.vagasRestantes <= 0) {
      setDiaSelecionado(null);
      setHorarioSelecionado(null);
    }
  }, [porData, diaSelecionado]);

  const celulas = Array.from({ length: mesAtual.getDay() + getDaysInMonth(mesAtual) }, (_, index) => index < mesAtual.getDay() ? null : index - mesAtual.getDay() + 1);
  const entradaSelecionada = diaSelecionado ? porData.get(diaSelecionado) : null;
  const horarios = entradaSelecionada?.horarios?.length
    ? entradaSelecionada.horarios.filter((item) => (item.vagasRestantes ?? 1) > 0)
    : HORARIOS_PADRAO.map((horario) => ({ id: entradaSelecionada?.id ?? horario, horario }));
  const slotSelecionado = horarios.find((item) => item.horario === horarioSelecionado) ?? null;

  function mudarMes(delta: 1 | -1) {
    setMesAtual((atual) => delta === 1 ? addMonths(atual, 1) : subMonths(atual, 1));
    setDiaSelecionado(null);
    setHorarioSelecionado(null);
  }

  function selecionarDia(dia: Date) {
    if (bloqueado || isBefore(dia, hoje)) return;
    const chave = format(dia, "yyyy-MM-dd");
    const entrada = porData.get(chave);
    if (!entrada || entrada.vagasRestantes <= 0) return;
    setDiaSelecionado(chave === diaSelecionado ? null : chave);
    setHorarioSelecionado(null);
  }

  return (
    <div className="min-w-0">
      <div className="mb-[11px] flex items-center justify-between">
        <button type="button" onClick={() => mudarMes(-1)} aria-label="Mês anterior" className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#FDF8F7] text-[19px] font-light leading-none text-[#7D2434]">‹</button>
        <div className="font-heading text-[15px] font-semibold capitalize text-[#7D2434]">{format(mesAtual, "MMMM yyyy", { locale: ptBR })}</div>
        <button type="button" onClick={() => mudarMes(1)} aria-label="Próximo mês" className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#FDF8F7] text-[19px] font-light leading-none text-[#7D2434]">›</button>
      </div>

      <div className="grid grid-cols-7 gap-[5px] pb-[7px] text-center">
        {DIAS.map((dia, index) => <div key={`${dia}-${index}`} className="text-[8px] font-semibold uppercase text-[#B65B67]">{dia}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-[5px]">
        {celulas.map((numero, index) => {
          if (numero === null) return <div key={`vazio-${index}`} className="aspect-square" />;
          const dia = new Date(mesAtual.getFullYear(), mesAtual.getMonth(), numero);
          const chave = format(dia, "yyyy-MM-dd");
          const entrada = porData.get(chave);
          const passado = isBefore(dia, hoje);
          const disponivel = Boolean(entrada && entrada.vagasRestantes > 0 && !passado);
          const selecionado = chave === diaSelecionado;
          const ehHoje = isToday(dia);
          const estilo = selecionado
            ? { background: "#6B1F2E", borderColor: "#6B1F2E", color: "#FFF", fontWeight: 600 }
            : disponivel
              ? { background: "#F3F8F4", borderColor: "#D5E8D9", color: "#3F7D5B", fontWeight: 500 }
              : { background: passado ? "transparent" : "#FAF5F4", borderColor: "transparent", color: passado ? "#D0C5C2" : "#B8AAA6", fontWeight: 400, textDecoration: passado ? "none" : "line-through" };
          return <button type="button" key={chave} onClick={() => selecionarDia(dia)} disabled={!disponivel || bloqueado} className="relative aspect-square rounded-[9px] border text-[10.5px] transition" style={estilo}><span className="flex h-full w-full items-center justify-center">{numero}</span>{ehHoje && !selecionado && <span className="absolute bottom-[3px] left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-[#B65B67]" />}</button>;
        })}
      </div>

      {diaSelecionado && entradaSelecionada && (
        <div className="mt-3 border-t border-[#F0E6E3] pt-3">
          <div className="text-center text-[10px] font-light text-[#7A6B67]">{contexto === "cirurgia" ? "Escolha o horário da cirurgia" : "Escolha o horário da assinatura"}</div>
          <div className="mt-[9px] grid grid-cols-3 gap-[6px]">
            {horarios.map((item) => <button type="button" key={item.id} onClick={() => setHorarioSelecionado(item.horario)} className="rounded-[9px] border px-2 py-[8px] text-[9.5px] font-medium" style={item.horario === horarioSelecionado ? { background: "#6B1F2E", borderColor: "#6B1F2E", color: "#FFF" } : { background: "#FFF", borderColor: "#E9DAD6", color: "#6F5E5A" }}>{item.horario}</button>)}
          </div>
          {horarioSelecionado && slotSelecionado && (
            <div className="mt-[11px] rounded-[12px] bg-[#F9F0EE] p-[11px] text-center">
              <div className="text-[10.2px] font-light text-[#7A6B67]">Você selecionou <b className="font-semibold text-[#7D2434]">{format(parseDataLocal(diaSelecionado), "d 'de' MMMM", { locale: ptBR })}</b> às <b className="font-semibold text-[#7D2434]">{horarioSelecionado}</b></div>
              <button type="button" disabled={confirmando} onClick={() => onConfirmar(slotSelecionado.id, horarioSelecionado)} className="mt-[9px] w-full rounded-[11px] bg-[#6B1F2E] px-[13px] py-[11px] text-[11px] font-medium text-white disabled:opacity-50">{confirmando ? "Confirmando..." : "Confirmar data"}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
