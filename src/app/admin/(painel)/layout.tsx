"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, Bell, CalendarRange, CircleDollarSign, Cog, LayoutDashboard, LineChart, LogOut, Plug, UserCog, Users } from "lucide-react";
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
  { href: "/admin/previsoes", label: "Previsões", icon: Activity, group: "Operação" },
  { href: "/admin/financeiro", label: "Financeiro", icon: CircleDollarSign, group: "Gestão" },
  { href: "/admin/relatorios", label: "Relatórios", icon: LineChart, group: "Gestão" },
  { href: "/admin/equipe", label: "Equipe", icon: UserCog, group: "Gestão" },
  { href: "/admin/integracoes", label: "Integrações", icon: Plug, group: "Gestão" },
  { href: "/admin/notificacoes", label: "Notificações", icon: Bell, group: "Gestão" },
  { href: "/admin/configuracoes", label: "Configurações", icon: Cog, group: "Gestão" },
];

const API_PREFETCH: Record<string, string> = {
  "/admin/visao-geral": "/api/admin/visao-geral",
  "/admin/previsoes": "/api/admin/previsao-liberacoes",
  "/admin/clientes": "/api/admin/clientes",
  "/admin/financeiro": "/api/admin/financeiro/resumo",
  "/admin/equipe": "/api/admin/staff",
  "/admin/integracoes": "/api/admin/integrations/status",
  "/admin/configuracoes": "/api/admin/configuracoes",
  "/admin/notificacoes": "/api/admin/notificacoes/automacao",
};

function prefetchAdminTab(router: ReturnType<typeof useRouter>, href: string) {
  router.prefetch(href);
  const api = API_PREFETCH[href];
  if (api) void fetchInstant(api, undefined, 120_000).catch(() => undefined);
  if (href === "/admin/relatorios") {
    void fetchInstant(`/api/admin/agenda-mensal?ano=${new Date().getFullYear()}`, undefined, 120_000).catch(() => undefined);
  }
  if (href === "/admin/agenda") {
    const now = new Date();
    void fetchInstant(`/api/admin/datas?ano=${now.getFullYear()}&mes=${now.getMonth() + 1}`, undefined, 120_000).catch(() => undefined);
  }
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const currentNav = NAV.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  useEffect(() => {
    let cancelado = false;
    const iniciar = () => {
      if (cancelado) return;
      NAV.forEach((item, index) => {
        window.setTimeout(() => {
          if (!cancelado) prefetchAdminTab(router, item.href);
        }, index * 180);
      });
    };
    const usaIdleCallback = typeof window.requestIdleCallback === "function";
    const idle = usaIdleCallback
      ? window.requestIdleCallback(iniciar, { timeout: 1800 })
      : window.setTimeout(iniciar, 900);
    return () => {
      cancelado = true;
      if (usaIdleCallback) window.cancelIdleCallback?.(idle as number);
      else window.clearTimeout(idle as number);
    };
  }, [router]);

  async function sair() {
    try {
      await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      router.replace("/admin/login");
    }
  }

  return (
    <div className="admin-web-shell admin-shell admin-compact min-h-screen bg-bloom dark:bg-[#0b0a0c]">
      <AdminCompactStyles />
      <AdminCompactLists />
      <CalendarioTesteTempo />

      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(173,104,107,0.12),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(122,38,50,0.08),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.55),rgba(255,255,255,0.92))] dark:bg-[radial-gradient(circle_at_top_left,rgba(157,67,84,0.10),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(117,72,45,0.06),transparent_24%)] dark:opacity-100" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1920px] gap-5 px-5 py-5 2xl:px-7">
        <aside className="admin-sidebar flex w-[248px] shrink-0 flex-col rounded-2xl border border-white/60 bg-white/88 px-4 py-4 text-clay shadow-[0_30px_100px_-40px_rgba(122,38,50,0.28)] backdrop-blur-2xl dark:border-white/8 dark:bg-[#151317]/96 dark:text-[#e8dcda] dark:shadow-[0_30px_90px_-28px_rgba(0,0,0,0.72)]">
          <div>
            <div className="mb-6 min-w-0 px-1">
              <Wordmark maxWidth={180} />
              <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.26em] text-burgundy/45 dark:text-[#cda5a2]/58">
                Painel administrativo
              </p>
            </div>

            <nav className="space-y-6" aria-label="Navegação administrativa">
              {Array.from(new Set(NAV.map((item) => item.group))).map((group) => (
                <div key={group}>
                  <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-burgundy/38 dark:text-white/35">
                    {group}
                  </p>
                  <div className="space-y-1">
                    {NAV.filter((item) => item.group === group).map((item) => {
                      const ativo = pathname === item.href || pathname.startsWith(`${item.href}/`);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onMouseEnter={() => prefetchAdminTab(router, item.href)}
                          onFocus={() => prefetchAdminTab(router, item.href)}
                          className={cn(
                            "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200",
                            ativo
                              ? "bg-burgundy font-semibold text-pearl shadow-[0_10px_24px_-12px_rgba(122,38,50,0.72)] dark:bg-[#7f3546] dark:text-[#fff7f4]"
                              : "text-clay/78 hover:bg-white/70 hover:text-burgundy dark:text-[#d5c8c6]/72 dark:hover:bg-white/7 dark:hover:text-[#f3e3df]",
                          )}
                        >
                          <span className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
                            ativo ? "bg-white/16 text-pearl ring-1 ring-white/10 dark:bg-white/10 dark:text-[#fff8f5]" : "bg-blush/60 text-burgundy group-hover:bg-blush dark:bg-white/6 dark:text-[#d9a5a3]",
                          )}>
                            <item.icon className="h-[17px] w-[17px]" strokeWidth={1.8} />
                          </span>
                          <span className="min-w-0 flex-1 truncate tracking-[-0.01em]">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </div>

          <div className="mt-auto space-y-2 pt-6">
            <ThemeToggle />
            <button onClick={sair} className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose/12 bg-white/72 px-3 py-2.5 text-sm font-medium text-burgundy/78 transition-colors duration-200 hover:bg-blush/70 hover:text-burgundy dark:border-white/8 dark:bg-white/5 dark:text-[#ddcfcc]/76">
              <LogOut className="h-[16px] w-[16px]" strokeWidth={1.8} />
              Sair
            </button>
          </div>
        </aside>

        <section className="admin-desktop-content flex min-w-0 flex-1 flex-col">
          <header className="admin-topbar mb-4 flex min-h-[64px] items-center justify-between rounded-2xl border border-white/65 bg-white/72 px-5 shadow-sm backdrop-blur-xl dark:border-white/8 dark:bg-[#151317]/88">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-burgundy/40 dark:text-white/35">Sra. Luck · Backoffice</p>
              <p className="mt-0.5 truncate text-sm font-medium text-clay dark:text-[#e8dcda]">{currentNav?.label ?? "Gestão administrativa"}</p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-clay/55 dark:text-white/45">
              <span className="hidden xl:inline">Ambiente administrativo</span>
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-label="Sistema online" />
            </div>
          </header>
          <main className="admin-main min-w-0 flex-1">{children}</main>
        </section>
      </div>
    </div>
  );
}
