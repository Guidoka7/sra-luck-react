"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Bell, CalendarDays, Check, CreditCard, Heart, Sparkles, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "sra-luck-cliente-tour-v3";
type Etapa = "inicio" | "financeiro" | "agenda" | "cirurgia";
type Step = { id: string; title: string; text: string; icon: React.ElementType; target?: () => HTMLElement | null };
function porDataTour(valor: string) { return document.querySelector<HTMLElement>(`[data-tour="${valor}"]`); }

function AgendaSimulada({ rect, dark }: { rect: DOMRect; dark: boolean }) {
  const dias = Array.from({ length: 35 }, (_, i) => i - 2);
  const disponiveis = new Set([5, 8, 12, 15, 19, 22, 26, 29]);
  const largura = Math.max(260, rect.width - 24);
  const altura = Math.min(360, Math.max(260, rect.height - 24));
  return <motion.div className="pointer-events-none absolute z-[102] overflow-hidden rounded-[22px] border border-gold/30 shadow-[0_20px_60px_-24px_rgba(55,20,28,.5)]" initial={{ opacity: 0, y: 8, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .2, ease: [0.22, 1, 0.36, 1] }} style={{ left: rect.left + 12, top: rect.top + 12, width: largura, height: altura }}>
    <div className={dark ? "h-full bg-[#24272A] p-3.5 text-[#F4D9DC]" : "h-full bg-white p-3.5 text-burgundy"}>
      <div className="mb-2 flex items-center justify-between gap-2"><div><p className="text-[0.56rem] font-bold uppercase tracking-[0.16em] text-gold">Simulação</p><p className="font-heading text-sm font-semibold">Agenda liberada</p></div><span className="rounded-full bg-gold/10 px-2 py-1 text-[0.56rem] font-bold text-gold">DESBLOQUEADA</span></div>
      <div className={dark ? "rounded-2xl border border-white/10 bg-white/[0.035] p-3" : "rounded-2xl border border-rose/10 bg-[#FFFBFA] p-3"}>
        <div className="mb-3 flex items-center justify-between"><button className="h-7 w-7 rounded-full border border-gold/20 text-gold" aria-hidden="true">‹</button><div className="text-center"><p className="font-heading text-sm font-semibold">Agosto 2026</p><p className="text-[0.58rem] text-clay/45">Escolha a data da assinatura dos termos</p></div><button className="h-7 w-7 rounded-full border border-gold/20 text-gold" aria-hidden="true">›</button></div>
        <div className="grid grid-cols-7 gap-1 text-center text-[0.52rem] font-bold uppercase text-clay/35">{['D','S','T','Q','Q','S','S'].map((dia, i) => <span key={`${dia}-${i}`}>{dia}</span>)}</div>
        <div className="mt-1 grid grid-cols-7 gap-1.5">{dias.map((dia, i) => { const valido = dia > 0 && dia <= 31; const livre = valido && disponiveis.has(dia); return <div key={`${dia}-${i}`} className="flex h-7 items-center justify-center"><span className={!valido ? "text-transparent" : livre ? "flex h-7 w-7 items-center justify-center rounded-full border border-gold bg-gold/10 text-[0.62rem] font-bold text-burgundy shadow-[0_0_0_2px_rgba(201,161,90,.08)] dark:text-[#F4D9DC]" : dark ? "text-[0.62rem] text-white/35" : "text-[0.62rem] text-clay/35"}>{valido ? dia : '·'}</span></div>; })}</div>
        <div className="mt-3 flex items-center justify-between rounded-xl bg-gold/10 px-3 py-2"><span className="text-[0.58rem] font-semibold text-clay/60">Datas disponíveis</span><span className="text-[0.58rem] font-bold text-gold">Toque para escolher</span></div>
      </div>
    </div>
  </motion.div>;
}

export function ClienteTour() {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  const [indice, setIndice] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [pronto, setPronto] = useState(false);
  const [etapa, setEtapa] = useState<Etapa>("inicio");
  const [percentualContrato, setPercentualContrato] = useState(60);
  const [parcelasNecessarias, setParcelasNecessarias] = useState<number | null>(null);

  const steps = useMemo<Step[]>(() => [
    { id: "boas-vindas", title: "Bem-vinda à sua jornada 💕", text: "Vamos te mostrar, de forma rápida e delicada, onde acompanhar cada etapa. Você continuará vendo seu sistema normalmente durante o tour.", icon: Sparkles },
    { id: "jornada", title: "Sua jornada até a cirurgia", text: etapa === "financeiro" ? "Aqui você acompanha o percentual das parcelas pagas e entende quando sua agenda poderá ser liberada." : etapa === "agenda" ? "Aqui você acompanha a evolução do seu contrato e o momento em que a agenda fica disponível para escolha." : etapa === "cirurgia" ? "Aqui você acompanha as etapas já concluídas e as informações relacionadas à sua assinatura e cirurgia." : "Aqui você acompanha o andamento do seu contrato e sabe exatamente em qual etapa está.", icon: Heart, target: () => porDataTour("jornada") },
    { id: "boletos", title: "Meus Boletos", text: "Nesta aba você acompanha suas parcelas, pagamentos e comprovantes. É por aqui que você envia os comprovantes quando necessário.", icon: CreditCard, target: () => porDataTour("boletos") },
    { id: "agenda", title: etapa === "cirurgia" ? "Sua próxima etapa" : etapa === "agenda" ? "Sua agenda" : "Sua agenda (simulação liberada)", text: etapa === "cirurgia" ? "Sua assinatura já foi agendada. Aqui você acompanha as informações da próxima etapa da sua jornada." : etapa === "agenda" ? `Sua agenda está liberada. Aqui você poderá escolher a data da assinatura dos termos. A liberação segue ${percentualContrato}% das parcelas pagas${parcelasNecessarias ? `, equivalente a ${parcelasNecessarias} parcelas` : ""}.` : `Esta é uma simulação de como sua agenda ficará quando for liberada. Ao atingir ${percentualContrato}% das parcelas pagas${parcelasNecessarias ? `, equivalente a ${parcelasNecessarias} parcelas do seu contrato` : ""}, você poderá escolher a data da assinatura dos termos.`, icon: CalendarDays, target: () => porDataTour(etapa === "cirurgia" ? "previsao" : "agenda") },
    { id: "notificacoes", title: "Fique por dentro", text: "Ative as notificações para receber avisos importantes sobre pagamentos, agenda e novas etapas da sua jornada.", icon: Bell, target: () => porDataTour("notificacoes") },
    { id: "pronto", title: "Tudo pronto ✨", text: etapa === "financeiro" ? `Agora você já sabe onde acompanhar seus pagamentos. Quando atingir ${percentualContrato}% das parcelas pagas${parcelasNecessarias ? ` (${parcelasNecessarias} parcelas)` : ""}, sua agenda poderá ser liberada.` : "Agora é só acompanhar sua jornada. Quando surgir uma nova etapa, você encontrará tudo por aqui.", icon: Check },
  ], [etapa, percentualContrato, parcelasNecessarias]);

  function encerrar() { try { localStorage.setItem(STORAGE_KEY, "concluido"); } catch (_) {} setAberto(false); }
  function pular() { try { localStorage.setItem(STORAGE_KEY, "pulado"); } catch (_) {} setAberto(false); }
  function anterior() { setIndice((v) => Math.max(0, v - 1)); }
  function proximo() { if (indice >= steps.length - 1) encerrar(); else setIndice((v) => v + 1); }

  useEffect(() => {
    if (pathname !== "/agenda") return;
    let timer: number | undefined;
    const iniciar = () => { try { if (localStorage.getItem(STORAGE_KEY)) return; } catch (_) {} const root = document.querySelector<HTMLElement>("[data-tour-root]"); setEtapa((root?.dataset.tourStage as Etapa | undefined) ?? "inicio"); const percentual = Number(root?.dataset.tourRequiredPercentage ?? 60); const parcelas = Number(root?.dataset.tourRequiredInstallments ?? ""); setPercentualContrato(Number.isFinite(percentual) && percentual > 0 ? percentual : 60); setParcelasNecessarias(Number.isFinite(parcelas) && parcelas > 0 ? parcelas : null); setIndice(0); setPronto(true); timer = window.setTimeout(() => setAberto(true), 700); };
    timer = window.setTimeout(iniciar, 250);
    return () => { if (timer) window.clearTimeout(timer); };
  }, [pathname]);

  useEffect(() => {
    if (!aberto || !pronto) return;
    const id = steps[indice]?.id;
    if (id === "boletos") porDataTour("boletos")?.click();
    if (id === "agenda" && etapa !== "cirurgia") porDataTour("minha-agenda")?.click();
    const timer = window.setTimeout(() => { const target = steps[indice]?.target?.(); if (target) target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" }); window.setTimeout(() => setRect(target?.getBoundingClientRect() ?? null), 120); }, 60);
    const atualizar = () => { const target = steps[indice]?.target?.(); setRect(target?.getBoundingClientRect() ?? null); };
    window.addEventListener("resize", atualizar); window.addEventListener("scroll", atualizar, true);
    return () => { clearTimeout(timer); window.removeEventListener("resize", atualizar); window.removeEventListener("scroll", atualizar, true); };
  }, [aberto, indice, pronto, steps, etapa]);

  if (pathname !== "/agenda" || !aberto) return null;
  const step = steps[indice]; const Icon = step.icon; const ultimo = indice === steps.length - 1;
  const isAgenda = step.id === "agenda" && rect && etapa !== "cirurgia";
  const tooltipStyle = rect ? isAgenda ? { left: Math.max(16, Math.min(window.innerWidth - 336, rect.left + rect.width / 2 - 160)), bottom: Math.max(16, window.innerHeight - rect.top + 14) } : { left: Math.max(16, Math.min(window.innerWidth - 336, rect.left + rect.width / 2 - 160)), top: Math.min(window.innerHeight - 250, Math.max(16, rect.bottom + 14)) } : { left: 16, right: 16, top: "50%", transform: "translateY(-50%)" };
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  return <AnimatePresence><motion.div className="fixed inset-0 z-[100]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    {!rect && <div className="absolute inset-0 bg-[#241317]/28" />}
    {rect && <motion.div className="pointer-events-none absolute rounded-2xl border-2 border-gold" initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .2, ease: [0.22,1,0.36,1] }} style={{ left: rect.left - 7, top: rect.top - 7, width: rect.width + 14, height: rect.height + 14, boxShadow: "0 0 0 9999px rgba(36,19,23,.38), 0 0 0 4px rgba(201,161,90,.10), 0 0 30px rgba(201,161,90,.42)" }} />}
    {isAgenda && rect && <AgendaSimulada rect={rect} dark={dark} />}
    <motion.section className="absolute z-[103] w-[min(320px,calc(100vw-32px))] rounded-3xl border border-gold/20 bg-white p-5 shadow-[0_30px_90px_-30px_rgba(42,15,22,.55)] dark:bg-[#202225]" style={tooltipStyle} initial={{ opacity: 0, y: isAgenda ? -8 : 8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .2, ease: [0.22,1,0.36,1] }}>
      {isAgenda && <span className="absolute bottom-[-9px] left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-b border-r border-gold/20 bg-white dark:bg-[#202225]" />}
      <button type="button" onClick={pular} aria-label="Fechar tour" className="absolute right-3 top-3 rounded-full p-2 text-clay/35 transition-all duration-150 hover:bg-blush hover:text-burgundy active:scale-95"><X className="h-4 w-4" /></button>
      <div className="mb-3 flex items-center justify-between pr-8"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blush text-burgundy"><Icon className="h-5 w-5" /></div><span className="rounded-full bg-blush/70 px-2.5 py-1 text-[0.62rem] font-bold text-clay/60">{indice + 1} de {steps.length}</span></div>
      <h2 className="pr-5 font-heading text-lg font-semibold text-burgundy dark:text-[#F4D9DC]">{step.title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-clay/65 dark:text-[#D8D0D2]/70">{step.text}</p>
      {isAgenda && <div className="mt-3 rounded-2xl border border-gold/20 bg-cream/70 px-3 py-2.5 text-[0.72rem] leading-relaxed text-clay/70"><strong className="text-burgundy">Simulação:</strong> a agenda abaixo está ilustrada em modo desbloqueado apenas para você visualizar como ficará. A liberação real acontece quando o percentual necessário de parcelas pagas do seu contrato for atingido.</div>}
      <div className="mt-5 flex items-center justify-between gap-2 border-t border-rose/10 pt-4"><button type="button" onClick={pular} className="rounded-full px-2 py-2 text-xs font-semibold text-clay/45 transition-all duration-150 hover:bg-blush hover:text-burgundy active:scale-95">Pular</button><div className="flex items-center gap-2"><button type="button" onClick={anterior} disabled={indice === 0} className="inline-flex items-center gap-1.5 rounded-full border border-rose/15 px-3 py-2.5 text-xs font-semibold text-burgundy transition-all duration-150 hover:bg-blush active:scale-95 disabled:pointer-events-none disabled:opacity-25"><ArrowLeft className="h-3.5 w-3.5" /> Voltar</button><button type="button" onClick={proximo} className="inline-flex items-center gap-1.5 rounded-full bg-burgundy px-4 py-2.5 text-xs font-bold text-cream shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg active:scale-[.98]">{ultimo ? <><Check className="h-3.5 w-3.5" /> Concluir</> : <>Próximo <ArrowRight className="h-3.5 w-3.5" /></>}</button></div></div>
    </motion.section>
  </motion.div></AnimatePresence>;
}
