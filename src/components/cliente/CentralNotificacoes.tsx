"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, CalendarClock, X } from "lucide-react";
import { toast } from "sonner";
import { Portal } from "@/components/ui/Portal";

interface Notificacao {
  id: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  emoji: string | null;
  destino: string | null;
  lida: boolean;
  created_at: string;
}

interface CentralNotificacoesProps {
  /** Chamado quando a cliente clica numa notificação cujo destino é a agenda. */
  onAbrirAgenda: () => void;
  /**
   * Muda de valor sempre que a página-mãe recebe um evento em tempo real
   * (Supabase Realtime) avisando de notificação nova — dispara um recarregar
   * imediato aqui, em vez de esperar o polling.
   */
  refreshSignal?: number;
}

function formatarDataHora(iso: string): { data: string; hora: string } {
  const d = new Date(iso);
  return {
    data: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }),
    hora: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
  };
}

function formatarData(data: string | null | undefined): string {
  if (!data) return "—";
  return data.split("-").reverse().join("/");
}

/** Sino de notificações do app da cliente: contador de não lidas + painel clicável. */
export function CentralNotificacoes({ onAbrirAgenda, refreshSignal }: CentralNotificacoesProps) {
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [aberto, setAberto] = useState(false);
  const carregouUmaVez = useRef(false);
  const etapaRef = useRef<string | null>(null);

  async function carregar() {
    try {
      const res = await fetch("/api/cliente/notificacoes", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setNotificacoes(data.notificacoes ?? []);
      setNaoLidas(data.naoLidas ?? 0);
    } finally {
      carregouUmaVez.current = true;
    }
  }

  async function atualizarNotificacaoDaEtapaAtual() {
    try {
      const res = await fetch("/api/cliente/agenda", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const ativo = data.agendamentoAtivo;
      const concluido = data.agendamentoConcluido;

      let etapa: string | null = null;
      let mensagem = "";

      if (concluido) {
        const previsao = formatarData(concluido.previsaoLiberacaoFinanceira);
        etapa = `concluido:${concluido.id}:${concluido.previsaoLiberacaoFinanceira ?? ""}`;
        mensagem = concluido.previsaoLiberacaoFinanceira
          ? `✅ Termos assinados. A liberação financeira está prevista para ${previsao}.`
          : "✅ Termos assinados. O próximo passo será a definição da liberação financeira.";
      } else if (ativo?.previsaoLiberacaoFinanceira) {
        const previsao = formatarData(ativo.previsaoLiberacaoFinanceira);
        etapa = `liberacao:${ativo.id}:${ativo.previsaoLiberacaoFinanceira}`;
        mensagem = `📅 Liberação financeira definida para ${previsao}.`;
      } else if (ativo) {
        const dataTermos = formatarData(ativo.data);
        const horario = ativo.horario ? ` às ${ativo.horario}` : "";
        etapa = `termos:${ativo.id}:${ativo.data}:${ativo.horario ?? ""}`;
        mensagem = `📋 Assinatura dos termos agendada para ${dataTermos}${horario}.`;
      }

      if (!etapa || !mensagem || etapa === etapaRef.current) return;
      const primeiraLeitura = etapaRef.current === null;
      etapaRef.current = etapa;

      // A mensagem antiga de “agenda liberada” é gerada pelo fluxo anterior.
      // Quando a cliente avança, ela precisa ser substituída pela etapa atual.
      // O pequeno atraso garante que o toast antigo já tenha sido registrado.
      window.setTimeout(() => {
        toast.dismiss();
        toast.success(mensagem, { duration: 5000 });
      }, primeiraLeitura ? 120 : 0);
    } catch {
      // A central de notificações não deve interromper a navegação da cliente.
    }
  }

  useEffect(() => {
    carregar();
    atualizarNotificacaoDaEtapaAtual();

    // A etapa da cliente é atualizada rapidamente para refletir imediatamente
    // agendamento dos termos e definição da liberação financeira.
    const intervalo = setInterval(() => {
      carregar();
      atualizarNotificacaoDaEtapaAtual();
    }, 5_000);

    function aoFocarAba() {
      if (document.visibilityState === "visible") {
        carregar();
        atualizarNotificacaoDaEtapaAtual();
      }
    }
    document.addEventListener("visibilitychange", aoFocarAba);
    window.addEventListener("focus", aoFocarAba);
    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoFocarAba);
      window.removeEventListener("focus", aoFocarAba);
    };
  }, []);

  useEffect(() => {
    if (!carregouUmaVez.current) return;
    carregar();
    atualizarNotificacaoDaEtapaAtual();
  }, [refreshSignal]);

  async function abrirNotificacao(n: Notificacao) {
    if (!n.lida) {
      setNotificacoes((atual) => atual.map((x) => (x.id === n.id ? { ...x, lida: true } : x)));
      setNaoLidas((atual) => Math.max(0, atual - 1));
      fetch(`/api/cliente/notificacoes/${n.id}/ler`, { method: "POST" }).catch(() => {});
    }
    setAberto(false);
    if (n.destino === "agenda") {
      onAbrirAgenda();
    }
  }

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="relative flex h-11 w-11 flex-none items-center justify-center rounded-[20px] border border-white/70 bg-white/85 shadow-card transition-colors hover:bg-white dark:border-white/10 dark:bg-white/[0.055] dark:hover:bg-white/[0.09]"
        aria-label="Notificações"
      >
        <Bell className="h-5 w-5 text-burgundy" />
        {naoLidas > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-alert px-1 text-[0.65rem] font-bold text-white shadow-card">
            {naoLidas > 9 ? "9+" : naoLidas}
          </span>
        )}
      </button>

      <AnimatePresence>
        {aberto && (
          <Portal>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-start justify-center bg-burgundy/30 px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] backdrop-blur-sm dark:bg-black/55 sm:items-center sm:pt-0"
              onClick={() => setAberto(false)}
            >
              <motion.div
                initial={{ opacity: 0, y: -12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12, scale: 0.97 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                onClick={(e) => e.stopPropagation()}
                className="surface-glass luxury-ring flex max-h-[75vh] w-full max-w-md flex-col rounded-3xl"
              >
                <div className="flex items-center justify-between border-b border-rose/10 px-5 py-4 dark:border-white/10">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-rose" />
                    <h2 className="font-heading text-base text-burgundy">Notificações</h2>
                  </div>
                  <button
                    onClick={() => setAberto(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-clay/40 transition-colors hover:bg-blush hover:text-burgundy dark:hover:bg-white/10 dark:hover:text-pearl"
                    aria-label="Fechar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-3 py-3">
                  {notificacoes.length === 0 ? (
                    <p className="px-3 py-8 text-center text-sm text-clay/50">
                      Você ainda não tem notificações.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {notificacoes.map((n) => {
                        const { data, hora } = formatarDataHora(n.created_at);
                        return (
                          <li key={n.id}>
                            <button
                              onClick={() => abrirNotificacao(n)}
                              className={`flex w-full items-start gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors ${
                                n.lida ? "bg-transparent hover:bg-blush/40 dark:hover:bg-white/[0.04]" : "bg-blush/50 hover:bg-blush/70 dark:bg-white/[0.06] dark:hover:bg-white/[0.09]"
                              }`}
                            >
                              <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-white text-sm shadow-card dark:bg-white/10">
                                {n.emoji ?? "🔔"}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  {!n.lida && <span className="h-1.5 w-1.5 flex-none rounded-full bg-alert" />}
                                  <p className="truncate text-sm font-semibold text-burgundy">{n.titulo}</p>
                                </div>
                                <p className="mt-0.5 text-xs leading-relaxed text-clay/60">{n.mensagem}</p>
                                <p className="mt-1.5 flex items-center gap-1 text-[0.65rem] uppercase tracking-label text-clay/35">
                                  <CalendarClock className="h-3 w-3" /> {data} às {hora}
                                </p>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </motion.div>
            </motion.div>
          </Portal>
        )}
      </AnimatePresence>
    </>
  );
}
