import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, CalendarDays, CheckCircle2, Gift, WalletCards, X } from "lucide-react";
import type { NotificacaoCliente } from "@/lib/clientNotifications";

type Categoria = "pagamentos" | "agenda" | "jornada" | "clube";
type Filtro = "todas" | "nao-lidas";

interface NotificationBellProps {
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
  notificacoes: NotificacaoCliente[];
  naoLidas: number;
  carregando: boolean;
  onMarcarLida: (id: string) => void;
  onMarcarTodasLidas: () => void;
  onAcao: (notificacao: NotificacaoCliente) => void;
}

function classificar(item: NotificacaoCliente): Categoria {
  const base = `${item.tipo} ${item.destino ?? ""}`.toLowerCase();
  if (base.includes("clube")) return "clube";
  if (base.includes("agenda") || base.includes("cirurgia") || base.includes("termo")) return "agenda";
  if (base.includes("jornada") || base.includes("etapa")) return "jornada";
  return "pagamentos";
}

function meta(item: NotificacaoCliente) {
  const cat = classificar(item);
  if (cat === "agenda") return { label: "Agenda", bg: "#EEF3F8", color: "#52708D", Icon: CalendarDays };
  if (cat === "jornada") return { label: "Jornada", bg: "#F4EEF7", color: "#795B86", Icon: CheckCircle2 };
  if (cat === "clube") return { label: "Clube", bg: "#FBF4E7", color: "#9B741E", Icon: Gift };
  return { label: "Pagamentos", bg: "#F7EFED", color: "#9B4C5A", Icon: WalletCards };
}

function quando(iso: string) {
  const data = new Date(iso);
  const minutos = Math.floor((Date.now() - data.getTime()) / 60000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24 && data.toDateString() === new Date().toDateString()) return `há ${horas} h`;
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
  if (data.toDateString() === ontem.toDateString()) return "ontem";
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

/**
 * Sininho fixo no topo de todas as telas da cliente. Ao tocar, abre um balão
 * compacto logo abaixo dele com as notificações — não há mais aba própria.
 */
export function NotificationBell({ aberto, onAbertoChange, notificacoes, naoLidas, carregando, onMarcarLida, onMarcarTodasLidas, onAcao }: NotificationBellProps) {
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const painelRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const lista = useMemo(() => filtro === "todas" ? notificacoes : notificacoes.filter((n) => !n.lida), [filtro, notificacoes]);

  useEffect(() => {
    if (!aberto) return;
    painelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { onAbertoChange(false); botaoRef.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aberto, onAbertoChange]);

  function tocarItem(item: NotificacaoCliente) {
    if (!item.lida) onMarcarLida(item.id);
    if (item.destino) { onAcao(item); onAbertoChange(false); }
  }

  return (
    <>
      <button
        ref={botaoRef}
        type="button"
        data-tour="notificacoes"
        onClick={() => onAbertoChange(!aberto)}
        aria-label={naoLidas > 0 ? `Notificações, ${naoLidas} não lidas` : "Notificações"}
        aria-expanded={aberto}
        aria-haspopup="dialog"
        className={`sl-bell-fixed ${aberto ? "open" : ""}`}
      >
        <Bell className="h-[17px] w-[17px]" strokeWidth={1.35} />
        {naoLidas > 0 && <span className="sl-bell-count">{naoLidas > 9 ? "9+" : naoLidas}</span>}
      </button>

      <AnimatePresence>
        {aberto && (
          <>
            <motion.div key="bd" className="sl-bell-backdrop" onClick={() => onAbertoChange(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} />
            <motion.div
              key="panel"
              ref={painelRef}
              role="dialog"
              aria-label="Notificações"
              tabIndex={-1}
              className="sl-bell-panel"
              initial={{ opacity: 0, scale: 0.94, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -4 }}
              transition={{ type: "spring", stiffness: 460, damping: 34, mass: 0.6 }}
            >
              <span className="sl-bell-caret" aria-hidden="true" />

              <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-[14px]">
                <div>
                  <div className="font-heading text-[21px] font-semibold leading-none text-[#2E2422]">Notificações</div>
                  <div className="pt-[5px] text-[11px] font-light text-[#8A7B77]">{naoLidas > 0 ? `${naoLidas} ${naoLidas === 1 ? "nova mensagem" : "novas mensagens"}` : "Você está em dia"}</div>
                </div>
                <button type="button" onClick={() => onAbertoChange(false)} aria-label="Fechar notificações" className="-mr-1 -mt-1 flex h-8 w-8 items-center justify-center rounded-full text-[#9A8A86] active:bg-[#F4ECEA]"><X className="h-4 w-4" strokeWidth={1.5} /></button>
              </div>

              <div className="flex items-center justify-between gap-2 border-b border-[#F1E8E5] px-4 pb-[10px]">
                <div className="flex rounded-full bg-[#F5EEEC] p-[3px]" role="tablist">
                  {([["todas", "Todas"], ["nao-lidas", naoLidas > 0 ? `Não lidas (${naoLidas})` : "Não lidas"]] as const).map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={filtro === id} onClick={() => setFiltro(id)} className={`whitespace-nowrap rounded-full px-3 py-[5px] text-[11px] font-medium transition ${filtro === id ? "bg-white text-[#6B1F2E] shadow-[0_1px_4px_rgba(46,36,34,.1)]" : "text-[#8A7B77]"}`}>{label}</button>
                  ))}
                </div>
                {naoLidas > 0 && <button type="button" onClick={onMarcarTodasLidas} className="whitespace-nowrap text-[11px] font-semibold text-[#7D2434]">Marcar como lidas</button>}
              </div>

              <div className="sl-bell-list">
                {carregando ? (
                  <div className="px-4 py-8 text-center text-[12px] font-light text-[#9A8C88]">Carregando notificações...</div>
                ) : lista.length === 0 ? (
                  <div className="px-4 py-9 text-center">
                    <Bell className="mx-auto h-5 w-5 text-[#C9BCB8]" strokeWidth={1.4} />
                    <div className="pt-2 text-[12px] font-light text-[#8D7D79]">{filtro === "nao-lidas" ? "Nenhuma notificação nova. Tudo em dia ✨" : "Você ainda não tem notificações."}</div>
                  </div>
                ) : (
                  <ul className="m-0 list-none p-0">
                    {lista.map((item) => {
                      const m = meta(item);
                      const Icon = m.Icon;
                      return (
                        <li key={item.id} className="border-b border-[#F4ECEA] last:border-b-0">
                          <button type="button" onClick={() => tocarItem(item)} className={`flex w-full items-start gap-3 px-4 py-3 text-left transition active:bg-[#FAF3F1] ${item.lida ? "" : "bg-[#FFF8F6]"}`}>
                            <span className="mt-[1px] flex h-9 w-9 flex-none items-center justify-center rounded-full" style={{ background: m.bg, color: m.color }}><Icon className="h-[16px] w-[16px]" strokeWidth={1.6} /></span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-[6px] text-[10px]">
                                <span className="font-semibold uppercase tracking-[.05em]" style={{ color: m.color }}>{m.label}</span>
                                <span className="text-[#B6AAA6]">·</span>
                                <span className="font-light text-[#A0928E]">{quando(item.created_at)}</span>
                              </span>
                              <span className={`block pt-[3px] text-[13px] leading-[1.3] text-[#2E2422] ${item.lida ? "font-medium" : "font-semibold"}`}>{item.titulo}</span>
                              <span className="line-clamp-2 block pt-[2px] text-[11.5px] font-light leading-[1.45] text-[#7C6C68]">{item.mensagem}</span>
                              {item.destino && <span className="block pt-[5px] text-[11px] font-semibold text-[#7D2434]">Ver detalhes ›</span>}
                            </span>
                            {!item.lida && <span className="mt-[6px] h-2 w-2 flex-none rounded-full bg-[#B3342E]" aria-label="Não lida" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
