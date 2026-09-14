import { Bell, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NotificacaoCliente } from "@/lib/clientNotifications";

interface NotificacoesTabProps {
  notificacoes: NotificacaoCliente[];
  naoLidas: number;
  carregando: boolean;
  onMarcarLida: (id: string) => void;
  onMarcarTodasLidas: () => void;
  onAcao: (notificacao: NotificacaoCliente) => void;
}

function formatarDataHora(iso: string) {
  const data = new Date(iso);
  return {
    data: data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    hora: data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
  };
}

export function NotificacoesTab({ notificacoes, naoLidas, carregando, onMarcarLida, onMarcarTodasLidas, onAcao }: NotificacoesTabProps) {
  return (
    <div className="pt-[max(env(safe-area-inset-top),0.75rem)]">
      <div className="mb-4 flex items-center justify-between px-0.5">
        <div>
          <h1 className="font-heading text-xl font-semibold text-burgundy">Notificações</h1>
          <p className="mt-0.5 text-[0.75rem] text-clay/55">
            {naoLidas > 0 ? `${naoLidas} nova${naoLidas === 1 ? "" : "s"}` : "Tudo em dia por aqui"}
          </p>
        </div>
        {naoLidas > 0 && (
          <button type="button" onClick={onMarcarTodasLidas} className="text-[0.68rem] font-semibold uppercase tracking-label text-burgundy hover:underline">
            Marcar lidas
          </button>
        )}
      </div>

      {carregando ? (
        <p className="py-10 text-center text-sm text-clay/45">Carregando notificações...</p>
      ) : notificacoes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[20px] border border-rose/12 bg-white/70 px-6 py-12 text-center">
          <Bell className="h-6 w-6 text-clay/25" />
          <p className="text-sm text-clay/50">Você ainda não tem notificações.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notificacoes.map((item) => {
            const { data, hora } = formatarDataHora(item.created_at);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (!item.lida) onMarcarLida(item.id);
                    onAcao(item);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors",
                    item.lida ? "border-rose/10 bg-white/70 hover:bg-blush/30" : "border-rose/20 bg-blush/50 hover:bg-blush/70",
                  )}
                >
                  <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-white text-sm shadow-card">
                    {item.emoji ?? "🔔"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {!item.lida && <span className="h-1.5 w-1.5 flex-none rounded-full bg-alert" />}
                      <p className="truncate text-sm font-semibold text-burgundy">{item.titulo}</p>
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-clay/60">{item.mensagem}</p>
                    <p className="mt-1.5 flex items-center gap-1 text-[0.62rem] uppercase tracking-label text-clay/35">
                      <CalendarClock className="h-3 w-3" /> {data} às {hora}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 text-center text-[0.65rem] leading-relaxed text-clay/35">
        Informações importantes ficam sempre registradas aqui.
      </p>
    </div>
  );
}
