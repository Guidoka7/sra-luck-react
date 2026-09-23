import { Monitor, Moon, Sun } from "lucide-react";
import { useTemaCliente, type PreferenciaTema } from "@/lib/temaCliente";

/** Linha do menu "Mais": interruptor rápido entre modo claro e modo escuro. */
export function LinhaModoEscuro() {
  const { efetivo, preferencia, alternar } = useTemaCliente();
  const escuro = efetivo === "escuro";
  return (
    <button type="button" role="switch" aria-checked={escuro} onClick={alternar} className="sl-more-item">
      <span className="flex min-w-0 items-center gap-3">
        <span className="sl-more-icon">{escuro ? <Moon className="h-[18px] w-[18px]" strokeWidth={1.45} /> : <Sun className="h-[18px] w-[18px]" strokeWidth={1.45} />}</span>
        <span className="min-w-0">
          <span className="sl-more-name block">Modo escuro</span>
          <span className="sl-more-sub block truncate">{preferencia === "sistema" ? "Seguindo o tema do celular" : escuro ? "Ativado · mais conforto à noite" : "Desativado"}</span>
        </span>
      </span>
      <span aria-hidden="true" className={`relative inline-flex h-[24px] w-[42px] flex-none items-center rounded-full transition-colors duration-200 ${escuro ? "bg-[#6B1F2E]" : "bg-[#E6DAD6]"}`}>
        <span className={`absolute h-[18px] w-[18px] tema-manter-branco rounded-full bg-white shadow-[0_2px_6px_rgba(46,36,34,.25)] transition-transform duration-200 ${escuro ? "translate-x-[21px]" : "translate-x-[3px]"}`} />
      </span>
    </button>
  );
}

const OPCOES: { valor: PreferenciaTema; rotulo: string; Icone: typeof Sun }[] = [
  { valor: "claro", rotulo: "Claro", Icone: Sun },
  { valor: "escuro", rotulo: "Escuro", Icone: Moon },
  { valor: "sistema", rotulo: "Automático", Icone: Monitor },
];

/** Seção "Aparência" das Configurações: claro, escuro ou automático (segue o celular). */
export function SecaoAparencia() {
  const { preferencia, definir } = useTemaCliente();
  return (
    <section className="rounded-[18px] border border-[#ECE2DF] bg-white p-4">
      <div className="text-[12.5px] font-medium text-[#4B3936]">Aparência</div>
      <div className="pt-[3px] text-[10.5px] font-light text-[#8D7D79]">No automático, o app acompanha o modo claro ou escuro do seu celular.</div>
      <div role="radiogroup" aria-label="Aparência do aplicativo" className="mt-4 grid grid-cols-3 gap-2 rounded-[14px] bg-[#F7EFED] p-1">
        {OPCOES.map(({ valor, rotulo, Icone }) => {
          const ativo = preferencia === valor;
          return (
            <button key={valor} type="button" role="radio" aria-checked={ativo} onClick={() => definir(valor)} className={`flex flex-col items-center gap-1 rounded-[11px] px-2 py-[9px] text-[10.5px] font-semibold transition-colors ${ativo ? "bg-white text-[#6B1F2E] shadow-[0_3px_10px_rgba(70,42,44,.10)]" : "text-[#8D7D79]"}`}>
              <Icone className="h-4 w-4" strokeWidth={1.6} />
              {rotulo}
            </button>
          );
        })}
      </div>
    </section>
  );
}
