import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { completarComZero, distribuirData, juntarData, normalizarParte, type ParteData, type PartesData } from "@/lib/dataNascimento";

const CAMPOS: { parte: ParteData; rotulo: string; placeholder: string; autoComplete: string }[] = [
  { parte: "dia", rotulo: "Dia", placeholder: "DD", autoComplete: "bday-day" },
  { parte: "mes", rotulo: "Mês", placeholder: "MM", autoComplete: "bday-month" },
  { parte: "ano", rotulo: "Ano", placeholder: "AAAA", autoComplete: "bday-year" },
];

/**
 * Data de nascimento em três caixas (dia · mês · ano) com avanço automático,
 * volta ao apagar e suporte a colar a data inteira. Entrega "DD/MM/AAAA".
 */
export function CampoDataNascimento({ onChange, invalido = false }: { onChange: (valor: string) => void; invalido?: boolean }) {
  const [partes, setPartes] = useState<PartesData>({ dia: "", mes: "", ano: "" });
  // Valor mais recente: o foco muda no meio do evento (antes do novo render),
  // então os handlers (inclusive o blur) sempre leem daqui, nunca do render antigo.
  const atualRef = useRef(partes);
  const refs = { dia: useRef<HTMLInputElement>(null), mes: useRef<HTMLInputElement>(null), ano: useRef<HTMLInputElement>(null) };
  const ordem: ParteData[] = ["dia", "mes", "ano"];

  function atualizar(novas: PartesData) {
    atualRef.current = novas;
    setPartes(novas);
    onChange(juntarData(novas));
  }

  function focar(parte: ParteData | undefined) {
    if (!parte) return;
    const el = refs[parte].current;
    el?.focus();
    el?.select();
  }

  function aoDigitar(parte: ParteData, bruto: string) {
    // Preenchimento automático ou teclado que entregam a data inteira de uma vez.
    if (bruto.replace(/\D/g, "").length > (parte === "ano" ? 4 : 2)) {
      const inteira = distribuirData(bruto);
      if (inteira) { atualizar(inteira); refs.ano.current?.focus(); return; }
    }
    const proxima = ordem[ordem.indexOf(parte) + 1];
    const digitos = bruto.replace(/\D/g, "");
    const limite = parte === "ano" ? 4 : 2;
    // Continuou digitando numa caixa cheia: o excedente segue para a próxima.
    if (digitos.length > limite && proxima) {
      const atual = normalizarParte(parte, digitos.slice(0, limite)).valor;
      const seguinte = normalizarParte(proxima, digitos.slice(limite));
      atualizar({ ...atualRef.current, [parte]: atual, [proxima]: seguinte.valor });
      focar(seguinte.completo ? ordem[ordem.indexOf(proxima) + 1] ?? proxima : proxima);
      return;
    }
    const { valor, completo } = normalizarParte(parte, bruto);
    atualizar({ ...atualRef.current, [parte]: valor });
    if (completo) focar(proxima);
  }

  function aoTeclar(parte: ParteData, evento: KeyboardEvent<HTMLInputElement>) {
    const anterior = ordem[ordem.indexOf(parte) - 1];
    const partesAtuais = atualRef.current;
    if (evento.key === "Backspace" && partesAtuais[parte] === "" && anterior) {
      evento.preventDefault();
      atualizar({ ...partesAtuais, [anterior]: partesAtuais[anterior].slice(0, -1) });
      refs[anterior].current?.focus();
    }
    if ((evento.key === "/" || evento.key === "-" || evento.key === ".") && parte !== "ano") {
      evento.preventDefault();
      atualizar({ ...partesAtuais, [parte]: completarComZero(parte, partesAtuais[parte]) });
      focar(ordem[ordem.indexOf(parte) + 1]);
    }
  }

  function aoColar(evento: ClipboardEvent<HTMLInputElement>) {
    const inteira = distribuirData(evento.clipboardData.getData("text"));
    if (!inteira) return;
    evento.preventDefault();
    atualizar(inteira);
    refs.ano.current?.focus();
  }

  return (
    <fieldset className="m-0 flex flex-col gap-[7px] border-0 p-0">
      <legend className="p-0 pb-[7px] text-[11px] uppercase tracking-[.1em] text-[#9A8C88]">Data de nascimento</legend>
      <div className="grid grid-cols-[1fr_1fr_1.45fr] gap-[9px]">
        {CAMPOS.map(({ parte, rotulo, placeholder, autoComplete }) => (
          <label key={parte} className="flex min-w-0 flex-col items-center gap-[5px]">
            <input
              ref={refs[parte]}
              value={partes[parte]}
              onChange={(e) => aoDigitar(parte, e.target.value)}
              onKeyDown={(e) => aoTeclar(parte, e)}
              onPaste={aoColar}
              onBlur={() => { const atuais = atualRef.current; const completo = completarComZero(parte, atuais[parte]); if (completo !== atuais[parte]) atualizar({ ...atuais, [parte]: completo }); }}
              onFocus={(e) => e.target.select()}
              placeholder={placeholder}
              aria-label={`${rotulo} de nascimento`}
              aria-invalid={invalido || undefined}
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint={parte === "ano" ? "done" : "next"}
              autoComplete={autoComplete}
              required
              className={`w-full rounded-[14px] border bg-white px-2 py-[15px] text-center text-[18px] font-medium tracking-[.08em] text-[#2E2422] outline-none placeholder:font-normal placeholder:text-[#C4B7B3] focus:border-[#6B1F2E] focus:shadow-[0_0_0_3px_rgba(107,31,46,.08)] ${invalido ? "border-[#E3B3B0]" : "border-[#E6DAD6]"}`}
            />
            <span className="text-[10px] font-normal uppercase tracking-[.12em] text-[#B3A6A2]">{rotulo}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
