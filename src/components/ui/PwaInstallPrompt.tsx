"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Smartphone, X } from "lucide-react";
import { toast } from "sonner";

interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>; }
const DISMISS_KEY = "sra-luck-pwa-install-dismissed-date";
const TOUR_KEY = "sra-luck-cliente-tour-v3";
const GLOBAL_EVENT_KEY = "__sraLuckBeforeInstallPrompt";
type WindowWithInstallEvent = Window & { [GLOBAL_EVENT_KEY]?: BeforeInstallPromptEvent | null };
function hoje() { return new Date().toLocaleDateString("sv-SE"); }
function isStandalone() { return typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))); }
function isIOS() { return typeof navigator !== "undefined" && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)); }
function tourConcluido() { try { return localStorage.getItem(TOUR_KEY) === "concluido"; } catch { return false; } }
function foiDispensadoHoje() { try { return localStorage.getItem(DISMISS_KEY) === hoje(); } catch { return false; } }
function registrarInstalacao() { try { const deviceKey = localStorage.getItem("sra-luck-device-key"); if (!deviceKey) return; void fetch("/api/cliente/app-telemetry", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ deviceKey, deviceType:window.innerWidth<768?"mobile":window.innerWidth<1024?"tablet":"desktop", displayMode:"standalone", isPwaInstalled:true, notificationPermission:"Notification" in window?Notification.permission:"default", pushActive:false }), keepalive:true }); } catch {} }

export function PwaInstallPrompt() {
  const [evento,setEvento]=useState<BeforeInstallPromptEvent|null>(null);
  const [visivel,setVisivel]=useState(false);
  const [instalando,setInstalando]=useState(false);
  const [ios,setIos]=useState(false);
  const [preparando,setPreparando]=useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    setIos(isIOS());
    const mostrar=()=>{if(!isStandalone()&&tourConcluido()&&!foiDispensadoHoje())setVisivel(true);};
    const recuperar=()=>{const e=(window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY]??null;if(e){setEvento(e);setPreparando(false);mostrar();}};
    const receber=(event:Event)=>{const e=event as BeforeInstallPromptEvent;event.preventDefault();(window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY]=e;setEvento(e);setPreparando(false);mostrar();};
    const instalado=()=>{(window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY]=null;setEvento(null);setVisivel(false);setPreparando(false);registrarInstalacao();toast.success("Aplicativo instalado. Agora ele abre como um app.");};
    window.addEventListener("beforeinstallprompt",receber);window.addEventListener("sra-luck-pwa-ready",recuperar);window.addEventListener("appinstalled",instalado);window.addEventListener("pageshow",recuperar);document.addEventListener("visibilitychange",recuperar);mostrar();recuperar();
    const interval=window.setInterval(()=>{if(tourConcluido())mostrar();recuperar();},500);
    return()=>{window.clearInterval(interval);window.removeEventListener("beforeinstallprompt",receber);window.removeEventListener("sra-luck-pwa-ready",recuperar);window.removeEventListener("appinstalled",instalado);window.removeEventListener("pageshow",recuperar);document.removeEventListener("visibilitychange",recuperar);};
  },[]);

  async function instalar(){
    if(ios){toast.info("No iPhone, toque em Compartilhar e depois em 'Adicionar à Tela de Início'.");return;}
    let eventoAtual=evento??(window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY]??null;
    if(!eventoAtual){setPreparando(true);window.dispatchEvent(new Event("sra-luck-pwa-ready"));await new Promise(resolve=>setTimeout(resolve,1200));eventoAtual=(window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY]??null;}
    if(!eventoAtual){setPreparando(false);toast.info("A instalação ainda está sendo preparada pelo navegador. Aguarde alguns segundos e tente novamente.");return;}
    setInstalando(true);
    try{await eventoAtual.prompt();const escolha=await eventoAtual.userChoice;if(escolha.outcome==="accepted")setVisivel(false);(window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY]=null;setEvento(null);}catch{toast.error("O navegador não conseguiu abrir a instalação. Tente novamente pelo botão Instalar aplicativo.");}finally{setInstalando(false);setPreparando(false);}
  }
  function dispensar(){try{localStorage.setItem(DISMISS_KEY,hoje());}catch{}setVisivel(false);}
  if(!visivel||isStandalone())return null;
  return <div className="mb-4 rounded-2xl border border-burgundy/10 bg-white/95 p-4 shadow-card backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.055]"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blush text-burgundy dark:bg-white/10 dark:text-[#F4D9DC]"><Smartphone className="h-5 w-5"/></div><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-burgundy dark:text-pearl">Instale o aplicativo Sra. Luck</p><p className="mt-0.5 text-xs leading-relaxed text-clay/60 dark:text-pearl/55">{ios?"No iPhone, use Compartilhar → Adicionar à Tela de Início para abrir como aplicativo.":"Instale no celular para abrir em tela cheia, receber avisos e ter acesso mais rápido."}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={instalar} disabled={instalando||preparando} className="inline-flex items-center gap-2 rounded-xl bg-burgundy px-3.5 py-2 text-xs font-semibold text-pearl disabled:opacity-60">{instalando||preparando?<Loader2 className="h-4 w-4 animate-spin"/>:<Download className="h-4 w-4"/>}{ios?"Como instalar":instalando?"Abrindo instalação...":preparando?"Preparando...":"Instalar aplicativo"}</button><button type="button" onClick={dispensar} className="inline-flex items-center gap-2 rounded-xl border border-burgundy/10 px-3.5 py-2 text-xs font-semibold text-burgundy dark:border-white/10 dark:text-pearl">Agora não</button></div></div><button type="button" aria-label="Não instalar agora" onClick={dispensar} className="flex h-8 w-8 items-center justify-center rounded-full text-clay/40 hover:bg-blush dark:hover:bg-white/10"><X className="h-4 w-4"/></button></div></div>;
}
