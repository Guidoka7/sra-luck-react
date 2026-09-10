"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarRange, Cog, LayoutDashboard, LineChart, LogOut, Menu, Receipt, Users, X, WalletCards } from "lucide-react";
import { createClientSupabaseClient } from "@/lib/supabase/client";
import { Wordmark } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { fetchInstant } from "@/lib/instantCache";
import { AdminCompactStyles } from "@/components/ui/Card";
import { AdminCompactLists } from "@/components/admin/AdminCompactLists";
import { CalendarioTesteTempo } from "@/components/admin/CalendarioTesteTempo";

const NAV = [
  { href: "/admin/visao-geral", label: "Visão Geral", icon: LayoutDashboard, group: "Operação" },
  { href: "/admin/agenda", label: "Agenda", icon: CalendarRange, group: "Operação" },
  { href: "/admin/clientes", label: "Clientes", icon: Users, group: "Operação" },
  { href: "/admin/pagamentos", label: "Pagamentos", icon: Receipt, group: "Gestão" },
  { href: "/admin/parcelas", label: "Parcelas", icon: WalletCards, group: "Gestão" },
  { href: "/admin/relatorios", label: "Relatórios", icon: LineChart, group: "Gestão" },
  { href: "/admin/configuracoes", label: "Configurações", icon: Cog, group: "Gestão" },
];

const API_PREFETCH: Record<string, string> = {
  "/admin/visao-geral": "/api/admin/visao-geral",
  "/admin/clientes": "/api/admin/clientes",
  "/admin/pagamentos": "/api/admin/boletos?",
  "/admin/configuracoes": "/api/admin/configuracoes",
};

function prefetchAdminTab(router: ReturnType<typeof useRouter>, href: string) {
  router.prefetch(href);
  const api = API_PREFETCH[href];
  if (api) void fetchInstant(api, undefined, 120_000).catch(() => undefined);
  if (href === "/admin/relatorios") void fetchInstant(`/api/admin/agenda-mensal?ano=${new Date().getFullYear()}`, undefined, 120_000).catch(() => undefined);
  if (href === "/admin/agenda") {
    const now = new Date();
    void fetchInstant(`/api/admin/datas?ano=${now.getFullYear()}&mes=${now.getMonth() + 1}`, undefined, 120_000).catch(() => undefined);
  }
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuAberto, setMenuAberto] = useState(false);

  useEffect(() => setMenuAberto(false), [pathname]);
  useEffect(() => {
    let cancelado = false;
    const iniciar = () => { if (cancelado) return; NAV.forEach((item, index) => window.setTimeout(() => { if (!cancelado) prefetchAdminTab(router, item.href); }, index * 180)); };
    const usaIdleCallback = typeof window.requestIdleCallback === "function";
    const idle = usaIdleCallback ? window.requestIdleCallback(iniciar, { timeout: 1800 }) : window.setTimeout(iniciar, 900);
    return () => { cancelado = true; if (usaIdleCallback) window.cancelIdleCallback?.(idle as number); else window.clearTimeout(idle as number); };
  }, [router]);

  async function sair() { const supabase = createClientSupabaseClient(); await supabase.auth.signOut(); router.push("/admin/login"); router.refresh(); }

  return (
    <div className="admin-shell admin-compact min-h-screen bg-bloom dark:bg-[#0b0a0c]">
      <AdminCompactStyles />
      <AdminCompactLists />
      <CalendarioTesteTempo />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(173,104,107,0.12),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(122,38,50,0.08),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.55),rgba(255,255,255,0.92))] dark:bg-[radial-gradient(circle_at_top_left,rgba(157,67,84,0.10),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(117,72,45,0.06),transparent_24%)] dark:opacity-100" />
      <div className="relative flex items-center justify-between border-b border-white/60 bg-white/80 px-3 py-2 shadow-sm backdrop-blur-xl dark:border-white/8 dark:bg-[#111013]/92 dark:shadow-[0_12px_40px_rgba(0,0,0,0.24)] lg:hidden">
        <div className="min-w-0"><Wordmark maxWidth={125} /></div>
        <div className="flex items-center gap-1"><ThemeToggle compact /><button onClick={() => setMenuAberto(true)} aria-label="Abrir menu" className="rounded-lg border border-rose/15 bg-white/70 p-1.5 text-burgundy transition-colors hover:bg-blush dark:border-white/10 dark:bg-white/5 dark:text-[#f0d9d4] dark:hover:bg-white/10"><Menu className="h-4 w-4" /></button></div>
      </div>
      {menuAberto && <div onClick={() => setMenuAberto(false)} className="fixed inset-0 z-40 bg-burgundy-dark/24 backdrop-blur-sm animate-fadeIn lg:hidden dark:bg-black/55" />}
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1720px] gap-3 px-2 pb-2 lg:px-3 lg:pt-3">
        <aside className={cn("fixed inset-y-0 left-0 z-50 flex w-[268px] max-w-[88vw] flex-col rounded-r-2xl border-r border-white/60 bg-white/88 px-3.5 py-3.5 text-clay shadow-[0_30px_100px_-40px_rgba(122,38,50,0.28)] backdrop-blur-2xl transition-transform duration-300 ease-out dark:border-white/8 dark:bg-[#151317]/96 dark:text-[#e8dcda] dark:shadow-[0_30px_90px_-28px_rgba(0,0,0,0.72)]", "lg:sticky lg:top-3 lg:h-[calc(100vh-1.5rem)] lg:translate-x-0 lg:rounded-2xl lg:border", menuAberto ? "translate-x-0" : "-translate-x-full lg:translate-x-0")}>
          <div>
            <div className="mb-4 flex items-center justify-between"><div className="min-w-0 flex-1"><Wordmark maxWidth={158} /><p className="mt-1 text-[9px] font-medium uppercase tracking-[0.26em] text-burgundy/45 dark:text-[#cda5a2]/58">Painel premium</p></div><button onClick={() => setMenuAberto(false)} aria-label="Fechar menu" className="rounded-lg p-1.5 text-clay/45 hover:bg-blush/70 hover:text-burgundy dark:text-white/35 dark:hover:bg-white/8 dark:hover:text-white lg:hidden"><X className="h-4 w-4" /></button></div>
            <nav className="mt-4 space-y-4">{Array.from(new Set(NAV.map((item) => item.group))).map((group) => <div key={group}><p className="mb-1.5 px-2 text-[9px] font-semibold uppercase tracking-[0.24em] text-burgundy/38 dark:text-white/35">{group}</p><div className="space-y-1">{NAV.filter((item) => item.group === group).map((item) => { const ativo = pathname.startsWith(item.href); return <Link key={item.href} href={item.href} prefetch onMouseEnter={() => prefetchAdminTab(router, item.href)} onFocus={() => prefetchAdminTab(router, item.href)} className={cn("group flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-[13px] transition-all duration-200", ativo ? "bg-burgundy text-pearl shadow-[0_10px_24px_-12px_rgba(122,38,50,0.72)] dark:bg-[#7f3546] dark:text-[#fff7f4] dark:shadow-[0_10px_26px_-12px_rgba(0,0,0,0.8)]" : "text-clay/78 hover:bg-white/70 hover:text-burgundy dark:text-[#d5c8c6]/72 dark:hover:bg-white/7 dark:hover:text-[#f3e3df]")}><span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all duration-200", ativo ? "bg-white/16 text-pearl ring-1 ring-white/10 dark:bg-white/10 dark:text-[#fff8f5]" : "bg-blush/60 text-burgundy group-hover:bg-blush dark:bg-white/6 dark:text-[#d9a5a3] dark:group-hover:bg-white/10")}><item.icon className="h-[17px] w-[17px]" strokeWidth={1.8} /></span><div className="min-w-0 flex-1"><p className="truncate font-semibold tracking-[-0.01em]">{item.label}</p><p className={cn("truncate text-[9px]", ativo ? "text-pearl/72 dark:text-white/62" : "text-burgundy/40 dark:text-white/32")}>{item.group}</p></div></Link>; })}</div></div>)}</nav>
          </div>
          <div className="mt-auto space-y-2"><ThemeToggle /><button onClick={sair} className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose/12 bg-white/72 px-2.5 py-2.5 text-[13px] font-medium text-burgundy/78 transition-colors duration-200 hover:bg-blush/70 hover:text-burgundy dark:border-white/8 dark:bg-white/5 dark:text-[#ddcfcc]/76 dark:hover:bg-white/9 dark:hover:text-[#fff5f1]"><LogOut className="h-[16px] w-[16px]" strokeWidth={1.8} /> Sair</button></div>
        </aside>
        <main className="min-w-0 flex-1 px-0 py-2 lg:py-0.5">{children}</main>
      </div>
    </div>
  );
}
