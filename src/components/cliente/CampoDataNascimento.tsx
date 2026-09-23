import { useEffect, useRef } from "react";

/** Máscara DD/MM/AAAA enquanto a cliente digita. */
export function formatarDataDigitada(valor: string) {
  const d = valor.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** "DD/MM/AAAA" → "AAAA-MM-DD" (para o calendário), ou "" se incompleta. */
export function paraValorCalendario(texto: string) {
  const m = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/** "AAAA-MM-DD" (do calendário) → "DD/MM/AAAA". */
export function doValorCalendario(iso: string) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function hojeIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Data de nascimento: a cliente digita (DD/MM/AAAA) ou toca no calendário do
 * canto, que abre o seletor de data nativo do aparelho e preenche o campo.
 */
export function CampoDataNascimento({ value, onChange }: { value: string; onChange: (valor: string) => void }) {
  const calendarioRef = useRef<HTMLInputElement>(null);

  /** Posiciona o seletor na data digitada ou, sem data, em 1990 (menos rolagem que "hoje"). */
  function prepararCalendario() {
    const el = calendarioRef.current;
    if (el) el.value = paraValorCalendario(value) || el.value || "1990-01-01";
  }

  function abrirCalendario() {
    const el = calendarioRef.current;
    if (!el) return;
    prepararCalendario();
    try { el.showPicker(); } catch { el.focus(); }
  }

  // Evento nativo do seletor: dispara só quando a cliente escolhe uma data
  // (cancelar não preenche nada). Nativo porque o React pode ignorar
  // alterações feitas no valor do campo de data fora da digitação.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const el = calendarioRef.current;
    if (!el) return;
    const aplicar = () => { const texto = doValorCalendario(el.value); if (texto) onChangeRef.current(texto); };
    el.addEventListener("change", aplicar);
    return () => el.removeEventListener("change", aplicar);
  }, []);

  return (
    <label className="flex flex-col gap-[7px]">
      <span className="text-[11px] uppercase tracking-[.1em] text-[#9A8C88]">Data de nascimento</span>
      <span className="relative block">
        <input
          value={value}
          onChange={(e) => onChange(formatarDataDigitada(e.target.value))}
          placeholder="DD/MM/AAAA"
          inputMode="numeric"
          autoComplete="bday"
          className="w-full rounded-[14px] border border-[#E6DAD6] bg-white py-[15px] pl-4 pr-[58px] text-[16px] text-[#2E2422] outline-none focus:border-[#6B1F2E]"
          required
        />
        <span className="absolute right-[6px] top-1/2 h-[42px] w-[42px] -translate-y-1/2">
          <button
            type="button"
            onClick={abrirCalendario}
            aria-label="Escolher a data no calendário"
            className="flex h-full w-full items-center justify-center rounded-[11px] bg-[#F7EFED] text-[#7D2434] transition active:scale-95"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 11h16" /><path d="M8.5 15h.01M12 15h.01M15.5 15h.01" /></svg>
          </button>
          {/* Seletor nativo, invisível sobre o botão: no celular abre com o toque. */}
          <input
            ref={calendarioRef}
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            min="1900-01-01"
            max={hojeIso()}
            onPointerDown={prepararCalendario}
            onFocus={prepararCalendario}
            onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* já aberto ou não suportado: o toque nativo abre */ } }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </span>
      </span>
    </label>
  );
}
