import { useMemo, useState } from "react";
import { Bell, CalendarDays, CheckCircle2, Gift, WalletCards } from "lucide-react";
import type { NotificacaoCliente } from "@/lib/clientNotifications";

type Filtro = "todos" | "pagamentos" | "agenda" | "jornada" | "clube";

interface NotificacoesTabProps {
  notificacoes: NotificacaoCliente[];
  naoLidas: number;
  carregando: boolean;
  onMarcarLida: (id: string) => void;
  onMarcarTodasLidas: () => void;
  onAcao: (notificacao: NotificacaoCliente) => void;
}

function classificar(item: NotificacaoCliente): Exclude<Filtro, "todos"> {
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

function dataLabel(iso: string) {
  const data = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
  const chave = data.toDateString();
  if (chave === hoje.toDateString()) return "Hoje";
  if (chave === ontem.toDateString()) return "Ontem";
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

function dataHora(iso: string) {
  const data = new Date(iso);
  return `${data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · ${data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

export function NotificacoesTab({ notificacoes, naoLidas, carregando, onMarcarLida, onMarcarTodasLidas, onAcao }: NotificacoesTabProps) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const filtradas = useMemo(() => filtro === "todos" ? notificacoes : notificacoes.filter((n) => classificar(n) === filtro), [filtro, notificacoes]);
  const grupos = useMemo(() => {
    const map = new Map<string, NotificacaoCliente[]>();
    filtradas.forEach((n) => {
      const label = dataLabel(n.created_at);
      map.set(label, [...(map.get(label) ?? []), n]);
    });
    return Array.from(map.entries());
  }, [filtradas]);

  const filtros: { id: Filtro; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "pagamentos", label: "Pagamentos" },
    { id: "agenda", label: "Agenda" },
    { id: "jornada", label: "Jornada" },
    { id: "clube", label: "Clube" },
  ];

  return (
    <div className="sl-tab pb-[14px]">
      <div className="flex items-center justify-between gap-[10px] px-5 pt-[calc(max(env(safe-area-inset-top),0px)+18px)]">
        <div className="flex min-h-[31px] items-center"><img src="/brand/sra-luck-logo.png" alt="Sra. Luck" className="w-[91px] object-contain" /></div>
        {naoLidas > 0 && <span className="rounded-full border border-[#E7D4D0] bg-[#F7EFED] px-[9px] py-[5px] text-[8.5px] font-semibold uppercase tracking-[.08em] text-[#7D2434]">{naoLidas} novas</span>}
      </div>

      <div className="flex items-end justify-between gap-[14px] px-5 pt-[14px]">
        <div>
          <h1 className="m-0 font-heading text-[30px] font-semibold leading-[1.05] text-[#2E2422]">Notificações</h1>
          <p className="m-0 max-w-[300px] pt-[5px] text-[12.5px] font-light leading-[1.45] text-[#8A7B77]">Pagamentos, agenda e cada avanço importante da sua jornada.</p>
        </div>
        {naoLidas > 0 && <button type="button" onClick={onMarcarTodasLidas} className="whitespace-nowrap pb-[2px] text-[9.5px] font-semibold text-[#7D2434]">Marcar lidas</button>}
      </div>

      <div className="flex gap-[7px] overflow-x-auto px-5 pb-[5px] pt-4 [scrollbar-width:none]">
        {filtros.map((f) => <button key={f.id} type="button" onClick={() => setFiltro(f.id)} className="whitespace-nowrap rounded-full px-[11px] py-[6px] text-[9.5px] font-medium" style={filtro === f.id ? { background: "#6B1F2E", color: "#FFF", border: "1px solid #6B1F2E" } : { background: "#FFF", color: "#7A6A66", border: "1px solid #E7DAD6" }}>{f.label}</button>)}
      </div>

      {carregando ? (
        <div className="px-5 py-10 text-center text-[11px] font-light text-[#9A8C88]">Carregando notificações...</div>
      ) : grupos.length === 0 ? (
        <div className="mx-5 mt-3 rounded-[17px] border border-[#ECE2DF] bg-white px-5 py-10 text-center"><Bell className="mx-auto h-5 w-5 text-[#C1B4B0]"/><div className="pt-2 text-[11px] font-light text-[#8D7D79]">Nenhuma notificação nesta categoria.</div></div>
      ) : (
        <div className="flex flex-col gap-[18px] px-5 pt-3">
          {grupos.map(([label, itens]) => <section key={label}>
            <div className="flex items-center justify-between px-[2px] pb-2"><div className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#A99894]">{label}</div><div className="text-[9px] font-normal text-[#B6AAA6]">{itens.length} {itens.length === 1 ? "atualização" : "atualizações"}</div></div>
            <div className="flex flex-col gap-2">
              {itens.map((item) => { const m = meta(item); const Icon = m.Icon; return <button type="button" key={item.id} onClick={() => { if (!item.lida) onMarcarLida(item.id); if (item.destino) onAcao(item); }} className="flex w-full items-start gap-[11px] rounded-[17px] border p-[13px] text-left transition" style={{ background: item.lida ? "#FFF" : "#FFFCFB", borderColor: item.lida ? "#EFE7E4" : "#E5D5D1", boxShadow: item.lida ? "0 2px 7px rgba(46,36,34,.025)" : "0 5px 14px rgba(81,45,49,.05)" }}>
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[12px]" style={{ background: m.bg, color: m.color }}><Icon className="h-4 w-4" strokeWidth={1.5}/></span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-[6px]"><span className="rounded-full bg-[#F7F3F1] px-[6px] py-[2px] text-[7.8px] font-semibold uppercase tracking-[.05em] text-[#887873]">{m.label}</span><span className="text-[9px] font-light text-[#B0A39F]">{dataHora(item.created_at)}</span></span>
                  <span className="block pt-[5px] font-heading text-[17px] leading-[1.16] text-[#352826]" style={{ fontWeight: item.lida ? 550 : 650 }}>{item.titulo}</span>
                  <span className="block pt-[3px] text-[10.7px] font-light leading-[1.48] text-[#83736F]">{item.mensagem}</span>
                  <span className="flex items-center justify-between gap-2 pt-2"><span className="rounded-full px-[7px] py-[3px] text-[8.5px] font-semibold" style={{ background: m.bg, color: m.color }}>{item.lida ? "Lida" : "Nova"}</span>{item.destino && <span className="whitespace-nowrap text-[9.5px] font-semibold text-[#7D2434]">Ver ›</span>}</span>
                </span>
                {!item.lida && <span className="mt-[5px] h-[7px] w-[7px] flex-none rounded-full bg-[#B3342E] shadow-[0_0_0_3px_#FBEFEE]" />}
              </button>; })}
            </div>
          </section>)}
        </div>
      )}

      <div className="mx-5 mt-[18px] flex items-start gap-[10px] rounded-[16px] border border-[#EEE2DF] bg-[#FAF6F4] px-[14px] py-[13px]">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-[10px] bg-[#F3E5E2] text-[#9F5360]"><Bell className="h-[14px] w-[14px]" strokeWidth={1.4}/></span>
        <div className="text-[10px] font-light leading-[1.5] text-[#877773]">Informações importantes ficam sempre registradas aqui. Você pode voltar quando quiser para acompanhar sua jornada.</div>
      </div>
    </div>
  );
}
