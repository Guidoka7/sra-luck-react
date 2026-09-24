import { useEffect, useMemo, useRef, useState } from "react";
import "@/styles/notificacoes-ios.css";
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
  // Ícone no estilo de app do iPhone: quadrado com cor sólida e símbolo branco.
  if (cat === "agenda") return { label: "Agenda", bg: "linear-gradient(160deg, #6B8BA8, #4E6C88)", cor: "#6B8BA8", Icon: CalendarDays };
  if (cat === "jornada") return { label: "Jornada", bg: "linear-gradient(160deg, #957AA3, #735A82)", cor: "#957AA3", Icon: CheckCircle2 };
  if (cat === "clube") return { label: "Clube", bg: "linear-gradient(160deg, #D2A55A, #A8773F)", cor: "#B8893A", Icon: Gift };
  return { label: "Pagamentos", bg: "linear-gradient(160deg, #B0526A, #7A2632)", cor: "#B0526A", Icon: WalletCards };
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

type Grupo = { chave: string; itens: NotificacaoCliente[] };

/** Agrupa notificações seguidas iguais (mesmo título e categoria), como as pilhas do iPhone. */
function agrupar(lista: NotificacaoCliente[]): Grupo[] {
  const grupos: Grupo[] = [];
  for (const item of lista) {
    const ultimo = grupos[grupos.length - 1];
    const chave = `${classificar(item)}|${item.titulo}`;
    if (ultimo && ultimo.chave === chave) ultimo.itens.push(item);
    else grupos.push({ chave, itens: [item] });
  }
  return grupos;
}

/**
 * Sininho fixo no topo de todas as telas da cliente. Ao tocar, abre a mini
 * central logo abaixo dele, com visual de iPhone: painel de vidro, cartões
 * arredondados, notificações repetidas empilhadas e toque para expandir.
 */
export function NotificationBell({ aberto, onAbertoChange, notificacoes, naoLidas, carregando, onMarcarLida, onMarcarTodasLidas, onAcao }: NotificationBellProps) {
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [expandida, setExpandida] = useState<string | null>(null);
  const [pilhasAbertas, setPilhasAbertas] = useState<Set<string>>(new Set());
  const painelRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const lista = useMemo(() => filtro === "todas" ? notificacoes : notificacoes.filter((n) => !n.lida), [filtro, notificacoes]);
  const grupos = useMemo(() => agrupar(lista), [lista]);

  useEffect(() => {
    if (!aberto) { setExpandida(null); setPilhasAbertas(new Set()); return; }
    painelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { onAbertoChange(false); botaoRef.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aberto, onAbertoChange]);

  function tocarItem(item: NotificacaoCliente) {
    if (!item.lida) onMarcarLida(item.id);
    setExpandida((atual) => (atual === item.id ? null : item.id));
  }

  function abrirDestino(item: NotificacaoCliente) {
    if (!item.lida) onMarcarLida(item.id);
    onAcao(item);
    onAbertoChange(false);
  }

  function alternarPilha(chave: string, itens: NotificacaoCliente[]) {
    itens.forEach((i) => { if (!i.lida) onMarcarLida(i.id); });
    setPilhasAbertas((atual) => { const nova = new Set(atual); if (nova.has(chave)) nova.delete(chave); else nova.add(chave); return nova; });
  }

  function cartao(item: NotificacaoCliente, empilhado = 0) {
    const m = meta(item);
    const Icon = m.Icon;
    const aberta = expandida === item.id && !empilhado;
    return (
      <motion.div key={item.id} layout className={`sl-nc-cartao ${item.lida ? "" : "sl-nc-cartao--nova"}`}>
        <button type="button" onClick={() => tocarItem(item)} className="sl-nc-cartao-toque" aria-expanded={aberta}>
          <span className="sl-nc-icone" style={{ background: m.bg }}><Icon className="h-[17px] w-[17px]" strokeWidth={1.7} /></span>
          <span className="sl-nc-corpo">
            <span className="sl-nc-topo">
              <span className="sl-nc-titulo">{item.titulo}</span>
              <span className="sl-nc-hora">{quando(item.created_at)}</span>
            </span>
            <span className={`sl-nc-texto ${aberta ? "" : "sl-nc-texto--curto"}`}>{item.mensagem}</span>
            {empilhado > 0 && <span className="sl-nc-mais">Mais {empilhado} {empilhado === 1 ? "notificação" : "notificações"}</span>}
          </span>
        </button>
        <AnimatePresence initial={false}>
          {aberta && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
              <div className="sl-nc-acoes">
                <span className="sl-nc-categoria" style={{ color: m.cor }}>{m.label}</span>
                {item.destino && <button type="button" onClick={() => abrirDestino(item)} className="sl-nc-acao">Ver detalhes</button>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
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
          <motion.div
            key="central"
            ref={painelRef}
            role="dialog"
            aria-label="Notificações"
            tabIndex={-1}
            className="sl-nc"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => { if (e.target === e.currentTarget) onAbertoChange(false); }}
          >
            <motion.div className="sl-nc-conteudo" initial={{ opacity: 0, scale: 0.92, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: -6 }} transition={{ type: "spring", stiffness: 460, damping: 34, mass: 0.6 }}>
              <div className="sl-nc-cabecalho">
                <div>
                  <h2 className="sl-nc-h1">Notificações</h2>
                  <p className="sl-nc-sub">{naoLidas > 0 ? `${naoLidas} ${naoLidas === 1 ? "nova" : "novas"}` : "Você está em dia"}</p>
                </div>
                <button type="button" onClick={() => onAbertoChange(false)} aria-label="Fechar notificações" className="sl-nc-fechar"><X className="h-[17px] w-[17px]" strokeWidth={1.8} /></button>
              </div>

              <div className="sl-nc-barra">
                <div className="sl-nc-segmento" role="tablist">
                  {([["todas", "Todas"], ["nao-lidas", naoLidas > 0 ? `Não lidas (${naoLidas})` : "Não lidas"]] as const).map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={filtro === id} onClick={() => setFiltro(id)} className={filtro === id ? "ativo" : ""}>{label}</button>
                  ))}
                </div>
                {naoLidas > 0 && <button type="button" onClick={onMarcarTodasLidas} className="sl-nc-link">Marcar como lidas</button>}
              </div>

              <div className="sl-nc-lista">
                {carregando ? (
                  <div className="sl-nc-vazio">Carregando notificações...</div>
                ) : grupos.length === 0 ? (
                  <div className="sl-nc-vazio"><Bell className="mx-auto h-6 w-6 opacity-60" strokeWidth={1.4} /><span>{filtro === "nao-lidas" ? "Nenhuma notificação nova." : "Você ainda não tem notificações."}</span></div>
                ) : grupos.map((grupo) => {
                  const empilhada = grupo.itens.length > 1 && !pilhasAbertas.has(grupo.chave);
                  if (empilhada) {
                    return (
                      <div key={grupo.chave + grupo.itens[0].id} className="sl-nc-pilha" onClickCapture={(e) => { e.stopPropagation(); e.preventDefault(); alternarPilha(grupo.chave, grupo.itens); }}>
                        {cartao(grupo.itens[0], grupo.itens.length - 1)}
                        <span className="sl-nc-camada sl-nc-camada--1" aria-hidden="true" />
                        {grupo.itens.length > 2 && <span className="sl-nc-camada sl-nc-camada--2" aria-hidden="true" />}
                      </div>
                    );
                  }
                  return (
                    <div key={grupo.chave + grupo.itens[0].id} className="sl-nc-grupo">
                      {grupo.itens.length > 1 && (
                        <div className="sl-nc-grupo-topo"><span>{meta(grupo.itens[0]).label}</span><button type="button" onClick={() => alternarPilha(grupo.chave, grupo.itens)}>Mostrar menos</button></div>
                      )}
                      {grupo.itens.map((item) => cartao(item))}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
