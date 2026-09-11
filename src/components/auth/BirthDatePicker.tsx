import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useMemo, useState } from "react";

interface BirthDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  required?: boolean;
}

const meses = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const diasSemana = ["D", "S", "T", "Q", "Q", "S", "S"];
const ANO_MINIMO = 1900;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parseIso(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function formatPtBr(value: string) {
  const parsed = parseIso(value);
  if (!parsed) return "";
  return `${pad(parsed.day)}/${pad(parsed.month)}/${parsed.year}`;
}

function diasNoMes(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function BirthDatePicker({ value, onChange, id = "data-nascimento", required = false }: BirthDatePickerProps) {
  const hoje = useMemo(() => new Date(), []);
  const anoMaximo = hoje.getFullYear();
  const parsed = parseIso(value);
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(parsed?.year ?? anoMaximo - 30);
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? hoje.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(parsed?.day ?? null);
  const [yearInput, setYearInput] = useState(String(parsed?.year ?? anoMaximo - 30));

  const totalDays = diasNoMes(viewYear, viewMonth);
  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const cells = Array.from({ length: firstWeekday + totalDays }, (_, index) =>
    index < firstWeekday ? null : index - firstWeekday + 1,
  );

  function abrir() {
    const current = parseIso(value);
    const year = current?.year ?? anoMaximo - 30;
    const month = current?.month ?? hoje.getMonth() + 1;
    setViewYear(year);
    setViewMonth(month);
    setYearInput(String(year));
    setSelectedDay(current?.day ?? null);
    setOpen(true);
  }

  function ajustarDia(year = viewYear, month = viewMonth, day = selectedDay) {
    if (day == null) return;
    const max = diasNoMes(year, month);
    setSelectedDay(Math.min(day, max));
  }

  function trocarMes(nextMonth: number) {
    setViewMonth(nextMonth);
    ajustarDia(viewYear, nextMonth);
  }

  function trocarAno(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    setYearInput(digits);
    if (digits.length !== 4) return;
    const year = Number(digits);
    if (year < ANO_MINIMO || year > anoMaximo) return;
    setViewYear(year);
    ajustarDia(year, viewMonth);
  }

  function normalizarAno() {
    const year = Number(yearInput);
    const normalized = Number.isFinite(year) ? Math.min(anoMaximo, Math.max(ANO_MINIMO, year)) : anoMaximo - 30;
    setYearInput(String(normalized));
    setViewYear(normalized);
    ajustarDia(normalized, viewMonth);
  }

  function navegarMes(offset: number) {
    const next = new Date(viewYear, viewMonth - 1 + offset, 1);
    const nextYear = next.getFullYear();
    const nextMonth = next.getMonth() + 1;
    if (nextYear < ANO_MINIMO || nextYear > anoMaximo) return;
    if (nextYear === anoMaximo && nextMonth > hoje.getMonth() + 1) return;
    setViewYear(nextYear);
    setViewMonth(nextMonth);
    setYearInput(String(nextYear));
    setSelectedDay(null);
  }

  function dataFutura(day: number) {
    const candidate = new Date(viewYear, viewMonth - 1, day, 12, 0, 0);
    const today = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 12, 0, 0);
    return candidate > today;
  }

  function confirmar() {
    if (!selectedDay) return;
    if (viewYear < ANO_MINIMO || viewYear > anoMaximo) return;
    if (dataFutura(selectedDay)) return;
    onChange(isoDate(viewYear, viewMonth, selectedDay));
    setOpen(false);
  }

  return (
    <>
      <button
        id={id}
        type="button"
        onClick={abrir}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-2xl border border-rose/20 bg-white/90 px-4 py-3 text-left text-clay outline-none transition focus:ring-4 focus:ring-rose/12"
      >
        <span className={value ? "text-sm" : "text-sm text-clay/40"}>{value ? formatPtBr(value) : "Selecione dia, mês e ano"}</span>
        <CalendarDays size={18} className="text-burgundy/55" aria-hidden="true" />
      </button>
      {required && <input tabIndex={-1} aria-hidden="true" className="pointer-events-none absolute h-px w-px opacity-0" value={value} onChange={() => undefined} required />}

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-burgundy/24 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="birth-date-title"
            className="w-full max-w-md rounded-t-[2rem] bg-[#fffdf9] p-5 shadow-[0_-20px_70px_rgba(85,34,44,0.18)] sm:rounded-[2rem] sm:p-6"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-burgundy/45">Data de nascimento</p>
                <h2 id="birth-date-title" className="mt-1 font-serif text-2xl text-burgundy">Escolha sua data</h2>
                <p className="mt-1 text-xs leading-5 text-clay/55">Você pode digitar o ano diretamente — sem voltar mês por mês.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-rose/15 bg-white text-burgundy/65" aria-label="Fechar calendário">
                <X size={17} />
              </button>
            </div>

            <div className="grid grid-cols-[0.72fr_1.35fr_0.93fr] gap-2.5">
              <label className="block">
                <span className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.16em] text-burgundy/45">Dia</span>
                <select
                  value={selectedDay ?? ""}
                  onChange={(event) => setSelectedDay(event.target.value ? Number(event.target.value) : null)}
                  className="h-11 w-full rounded-xl border border-rose/15 bg-white px-3 text-sm text-clay outline-none focus:ring-4 focus:ring-rose/10"
                >
                  <option value="">Dia</option>
                  {Array.from({ length: totalDays }, (_, index) => index + 1).map((day) => (
                    <option key={day} value={day} disabled={dataFutura(day)}>{pad(day)}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.16em] text-burgundy/45">Mês</span>
                <select
                  value={viewMonth}
                  onChange={(event) => trocarMes(Number(event.target.value))}
                  className="h-11 w-full rounded-xl border border-rose/15 bg-white px-3 text-sm text-clay outline-none focus:ring-4 focus:ring-rose/10"
                >
                  {meses.map((mes, index) => (
                    <option key={mes} value={index + 1} disabled={viewYear === anoMaximo && index > hoje.getMonth()}>{mes}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.16em] text-burgundy/45">Ano</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={yearInput}
                  onChange={(event) => trocarAno(event.target.value)}
                  onBlur={normalizarAno}
                  className="h-11 w-full rounded-xl border border-rose/15 bg-white px-3 text-sm text-clay outline-none focus:ring-4 focus:ring-rose/10"
                  aria-label={`Ano entre ${ANO_MINIMO} e ${anoMaximo}`}
                />
              </label>
            </div>

            <div className="mt-5 rounded-2xl border border-rose/12 bg-white p-3.5 shadow-[0_10px_35px_rgba(103,54,59,0.06)]">
              <div className="mb-3 flex items-center justify-between">
                <button type="button" onClick={() => navegarMes(-1)} className="grid h-9 w-9 place-items-center rounded-full text-burgundy/65 hover:bg-rose/8" aria-label="Mês anterior">
                  <ChevronLeft size={18} />
                </button>
                <strong className="font-serif text-base font-medium text-burgundy">{meses[viewMonth - 1]} de {viewYear}</strong>
                <button type="button" onClick={() => navegarMes(1)} className="grid h-9 w-9 place-items-center rounded-full text-burgundy/65 hover:bg-rose/8" aria-label="Próximo mês">
                  <ChevronRight size={18} />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center">
                {diasSemana.map((dia, index) => <span key={`${dia}-${index}`} className="py-1 text-[9px] font-semibold uppercase text-clay/35">{dia}</span>)}
                {cells.map((day, index) =>
                  day == null ? <span key={`empty-${index}`} /> : (
                    <button
                      type="button"
                      key={day}
                      disabled={dataFutura(day)}
                      onClick={() => setSelectedDay(day)}
                      className={`aspect-square rounded-full text-xs font-medium transition ${selectedDay === day ? "bg-burgundy text-pearl shadow-[0_5px_14px_rgba(122,38,50,0.22)]" : "text-clay hover:bg-rose/10"} disabled:cursor-not-allowed disabled:text-clay/20`}
                      aria-label={`${day} de ${meses[viewMonth - 1]} de ${viewYear}`}
                    >
                      {day}
                    </button>
                  ),
                )}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button type="button" onClick={() => { onChange(""); setSelectedDay(null); setOpen(false); }} className="px-3 py-2 text-xs font-medium text-burgundy/55">Limpar</button>
              <button
                type="button"
                onClick={confirmar}
                disabled={!selectedDay || dataFutura(selectedDay)}
                className="min-w-40 rounded-full bg-burgundy px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-pearl disabled:cursor-not-allowed disabled:opacity-35"
              >
                Confirmar data
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
