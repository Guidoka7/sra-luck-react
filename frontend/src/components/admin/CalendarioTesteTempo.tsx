"use client";

import { useEffect, useState } from "react";
import { CalendarClock, RotateCcw, X } from "lucide-react";

const KEY = "sra-luck-test-date";

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CalendarioTesteTempo() {
  const [aberto, setAberto] = useState(false);
  const [data, setData] = useState(hojeISO());
  const [ativo, setAtivo] = useState(false);

  useEffect(() => {
    const atual = localStorage.getItem(KEY);
    if (atual) { setData(atual); setAtivo(true); }
  }, []);

  function aplicar(valor: string) {
    if (!valor) return;
    localStorage.setItem(KEY, valor);
    document.cookie = `sra_luck_test_date=${valor}; path=/; max-age=604800; SameSite=Lax`;
    setData(valor); setAtivo(true); setAberto(false);
    window.location.reload();
  }

  function desativar() {
    localStorage.removeItem(KEY);
    document.cookie = "sra_luck_test_date=; path=/; max-age=0; SameSite=Lax";
    setAtivo(false); setAberto(false);
    window.location.reload();
  }

  return <>
    <button type="button" onClick={() => setAberto(true)} className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-full border border-gold/35 bg-burgundy px-4 py-2.5 text-[11px] font-bold uppercase tracking-label text-cream shadow-2xl hover:bg-burgundy-light">
      <CalendarClock className="h-4 w-4 text-gold" /> {ativo ? `Teste: ${data.split("-").reverse().join("/")}` : "Calendário de teste"}
    </button>

    {aberto && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-gold/20 bg-white p-5 shadow-2xl dark:bg-[#1b1d20]">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-rose">Ambiente de teste</p><h2 className="mt-1 font-heading text-lg text-burgundy dark:text-cream">Simular passagem do tempo</h2></div>
          <button type="button" onClick={() => setAberto(false)} className="rounded-lg p-1.5 text-clay/45 hover:bg-blush"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-3 text-xs leading-5 text-clay/60 dark:text-cream/55">Escolha a data que o sistema deve considerar como “hoje” durante os testes. Isso permite validar os avisos e animações de assinatura e cirurgia sem esperar as datas reais.</p>
        <label className="mt-4 block text-[11px] font-semibold uppercase tracking-label text-burgundy/60 dark:text-cream/60">Data simulada</label>
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} className="mt-1.5 w-full rounded-xl border border-rose/15 bg-white px-3 py-3 text-sm text-burgundy outline-none focus:border-gold dark:border-white/10 dark:bg-white/5 dark:text-cream" />
        <button type="button" onClick={() => aplicar(data)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-burgundy px-4 py-3 text-xs font-bold uppercase tracking-label text-cream"><CalendarClock className="h-4 w-4" /> Aplicar data de teste</button>
        {ativo && <button type="button" onClick={desativar} className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-rose/15 px-4 py-2.5 text-xs font-semibold text-burgundy dark:text-cream"><RotateCcw className="h-3.5 w-3.5" /> Voltar para a data real</button>}
      </div>
    </div>}
  </>;
}
