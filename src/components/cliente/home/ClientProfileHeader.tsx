import { Bell } from "lucide-react";
import { primeiroNome } from "@/lib/utils";

interface ClientProfileHeaderProps {
  nomeCliente: string;
  procedimento: string | null;
  quantidadeParcelas: number | null;
  naoLidas: number;
  onAbrirNotificacoes: () => void;
}

function iniciais(nomeCompleto: string) {
  const partes = nomeCompleto.trim().split(/\s+/).filter(Boolean);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return `${primeira}${ultima}`.toUpperCase();
}

export function ClientProfileHeader({ nomeCliente, procedimento, quantidadeParcelas, naoLidas, onAbrirNotificacoes }: ClientProfileHeaderProps) {
  const planoLabel = quantidadeParcelas ? `Plano ${quantidadeParcelas}x` : null;

  return (
    <header
      className="sticky top-0 z-30 -mx-4 border-b border-rose/12 bg-cream/97 px-4 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)] backdrop-blur-xl sm:-mx-6 sm:px-6"
      style={{ boxShadow: "0 10px 28px -22px rgba(46,36,34,.22)" }}
    >
      <div className="flex items-center justify-between pb-2.5">
        <img src="/brand/sra-luck-logo.png" alt="Sra. Luck" className="h-6 w-auto object-contain sm:h-7" />
        <button
          type="button"
          onClick={onAbrirNotificacoes}
          aria-label="Notificações"
          className="relative flex h-9 w-9 items-center justify-center rounded-full border border-rose/20 bg-white/80 shadow-card transition-colors hover:bg-white"
        >
          <Bell className="h-4 w-4 text-burgundy" strokeWidth={1.6} />
          {naoLidas > 0 && (
            <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-cream bg-alert" />
          )}
        </button>
      </div>

      <div className="flex items-center gap-3 rounded-[20px] border border-rose/15 bg-white/90 px-3.5 py-3 shadow-card">
        <div className="relative flex-none">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-blush to-rose/30 font-heading text-base font-bold text-burgundy shadow-card">
            {iniciais(nomeCliente)}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-success" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate font-heading text-sm font-semibold leading-tight text-clay">{primeiroNome(nomeCliente)}</p>
            <span className="rounded-full bg-blush px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-label text-burgundy">
              Minha área
            </span>
          </div>
          <p className="mt-0.5 truncate text-[0.7rem] text-clay/55">
            {procedimento ?? "Procedimento a definir"}
            {planoLabel ? ` · ${planoLabel}` : ""}
          </p>
        </div>
      </div>
    </header>
  );
}
