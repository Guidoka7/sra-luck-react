"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "@/components/ui/ThemeProvider";
import "@/styles/admin-zip.css";

/**
 * Sidebar + topbar fiéis ao ZIP aprovado (mesma estrutura em todos os
 * .dc.html): bloco de marca, grupos "Operação"/"Gestão" com os 7 módulos
 * finais do Admin, e rodapé com avatar do colaborador logado.
 * Substitui o antigo AdminLayout — nenhuma tela renderiza o shell anterior.
 */

const NAV_OPERACAO = [
  { href: "/admin/visao-geral", label: "Visão geral", icon: "◫" },
  { href: "/admin/agenda", label: "Agenda", icon: "◷" },
  { href: "/admin/clientes", label: "Clientes", icon: "☻" },
  { href: "/admin/financeiro", label: "Financeiro", icon: "$" },
  { href: "/admin/clube", label: "Clube", icon: "♡" },
];

const NAV_GESTAO = [
  { href: "/admin/previsoes", label: "Previsões", icon: "↗" },
  { href: "/admin/relatorios", label: "Relatórios", icon: "▥" },
  { href: "/admin/configuracoes", label: "Configurações", icon: "⚙" },
];

const CARGO_LABEL: Record<string, string> = {
  administrativo: "Administradora",
  gestao: "Gestão",
  financeiro: "Financeiro",
  vendedora: "Vendedora",
  sdr: "SDR",
};

function iniciaisDe(nome: string) {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || "AD";
}

const navItemStyle = (ativo: boolean): CSSProperties => ativo
  ? { display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 10, background: "var(--bg)", color: "var(--on-accent)", fontSize: 12.5, fontWeight: 650, boxShadow: "var(--active-shadow)", textDecoration: "none" }
  : { display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 10, color: "var(--soft)", fontSize: 12.5, fontWeight: 600, textDecoration: "none" };

const iconBadgeStyle = (ativo: boolean): CSSProperties => ({
  width: 26, height: 26, borderRadius: 8,
  background: ativo ? "rgba(255,255,255,.18)" : "var(--s2)",
  color: ativo ? "var(--on-accent)" : "var(--bg)",
  display: "grid", placeItems: "center", fontSize: 12, flex: "none",
});

export function AdminZipShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  const [perfil, setPerfil] = useState<{ nome: string; cargo: string } | null>(null);
  // Em telas estreitas (≤760px) a sidebar vira um painel sobreposto.
  const [menuAberto, setMenuAberto] = useState(false);
  useEffect(() => { setMenuAberto(false); }, [pathname]);

  useEffect(() => {
    let ativo = true;
    fetch("/api/admin/session", { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (ativo && d?.nome) setPerfil({ nome: d.nome, cargo: d.cargo ?? "administrativo" });
    }).catch(() => {});
    return () => { ativo = false; };
  }, []);

  async function sair() {
    try { await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" }); }
    finally { router.replace("/admin/login"); }
  }

  const ativo = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className={`zip-admin zip-shell${dark ? " dark" : ""}${menuAberto ? " zip-shell-menu-open" : ""}`} style={{ minHeight: "100vh", background: "var(--shell)", color: "var(--ink)", padding: 16, display: "flex", gap: 16, alignItems: "flex-start" }}>
      <button type="button" className="zip-shell-menu-btn" aria-expanded={menuAberto} aria-controls="zip-shell-aside" onClick={() => setMenuAberto((v) => !v)}>
        <span aria-hidden="true">☰</span> Menu
      </button>
      {menuAberto && <div className="zip-shell-scrim" onClick={() => setMenuAberto(false)} />}
      <aside id="zip-shell-aside" className="zip-shell-aside" style={{ width: 212, flex: "none", position: "sticky", top: 16, border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 16, padding: "14px 11px", boxShadow: "var(--sh)", backdropFilter: "blur(18px)", display: "flex", flexDirection: "column", minHeight: "calc(100vh - 32px)" }}>
        <div>
          <div style={{ padding: "2px 6px 16px" }}>
            <div style={{ fontFamily: "Fraunces,Georgia,serif", fontSize: 19, color: "var(--bg)" }}>Sra. Luck</div>
            <div style={{ marginTop: 3, fontSize: 8, fontWeight: 600, letterSpacing: ".24em", textTransform: "uppercase", color: "var(--rose)" }}>Painel administrativo</div>
          </div>

          <div style={{ padding: "0 8px 7px", fontSize: 8, fontWeight: 600, letterSpacing: ".22em", textTransform: "uppercase", color: "var(--rose)", opacity: .7 }}>Operação</div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {NAV_OPERACAO.map((item) => {
              const on = ativo(item.href);
              return <Link key={item.href} href={item.href} className={`zip-nav-item${on ? " active" : ""}`} style={navItemStyle(on)}>
                <span style={iconBadgeStyle(on)}>{item.icon}</span>{item.label}
              </Link>;
            })}
          </nav>

          <div style={{ padding: "16px 8px 7px", fontSize: 8, fontWeight: 600, letterSpacing: ".22em", textTransform: "uppercase", color: "var(--rose)", opacity: .7 }}>Gestão</div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {NAV_GESTAO.map((item) => {
              const on = ativo(item.href);
              return <Link key={item.href} href={item.href} className={`zip-nav-item${on ? " active" : ""}`} style={navItemStyle(on)}>
                <span style={iconBadgeStyle(on)}>{item.icon}</span>{item.label}
              </Link>;
            })}
          </nav>
        </div>

        <div style={{ marginTop: "auto", paddingTop: 16 }}>
          <button className="zip-theme-toggle" onClick={toggleTheme} style={{ width: "100%", height: 36, border: "1px solid var(--line)", borderRadius: 10, background: "var(--s0)", color: "var(--soft)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 11, fontWeight: 700 }}>
            <span>{dark ? "☀" : "☾"}</span>{dark ? "Modo claro" : "Modo escuro"}
          </button>
          <button className="zip-logout-btn" onClick={sair} style={{ width: "100%", marginTop: 8, height: 32, border: "1px solid var(--line)", borderRadius: 10, background: "transparent", color: "var(--soft)", fontSize: 10.5, fontWeight: 600 }}>Sair</button>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line2)", display: "flex", alignItems: "center", gap: 9 }}>
            <div className="zip-admin-avatar" style={{ width: 28, height: 28, borderRadius: 999, background: "var(--s2)", color: "var(--bg)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, flex: "none" }}>{iniciaisDe(perfil?.nome ?? "Admin")}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{perfil?.nome ?? "—"}</div>
              <div style={{ fontSize: 9.5, color: "var(--soft)" }}>{CARGO_LABEL[perfil?.cargo ?? ""] ?? "Administrativo"}</div>
            </div>
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
    </div>
  );
}
