"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "@/components/ui/ThemeProvider";
import "@/styles/admin-zip.css";
import "@/styles/admin-reference-shell.css";

const CARGO_LABEL: Record<string, string> = {
  administrativo: "Administradora",
  gestao: "Gestão",
  financeiro: "Financeiro",
  vendedora: "Vendedora",
  sdr: "SDR",
};

const NAV_OPERACAO = [
  { href: "/admin/visao-geral", label: "Visão geral", icon: "overview" },
  { href: "/admin/agenda", label: "Agenda", icon: "agenda" },
  { href: "/admin/clientes", label: "Clientes", icon: "clients" },
  { href: "/admin/financeiro", label: "Financeiro", icon: "finance" },
] as const;

const NAV_GESTAO = [
  { href: "/admin/previsoes", label: "Previsões", icon: "forecast" },
  { href: "/admin/relatorios", label: "Relatórios", icon: "reports" },
  { href: "/admin/configuracoes", label: "Configurações", icon: "settings" },
] as const;

type NavIconName = (typeof NAV_OPERACAO)[number]["icon"] | (typeof NAV_GESTAO)[number]["icon"];

function NavIcon({ name }: { name: NavIconName }) {
  if (name === "overview") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3.5 10.3 12 3.5l8.5 6.8v9.2a1 1 0 0 1-1 1h-5.3v-6h-4.4v6H4.5a1 1 0 0 1-1-1z"/></svg>;
  if (name === "agenda") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 10h16M8 13.5h3M13 13.5h3M8 17h3"/></svg>;
  if (name === "clients") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM15.8 10a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z"/><path d="M3.8 18.5v-1.7c0-2.7 2.1-4.8 4.7-4.8s4.7 2.1 4.7 4.8v1.7M13 13.2c.7-.5 1.6-.8 2.6-.8 2.5 0 4.5 1.9 4.5 4.4v1.7"/></svg>;
  if (name === "finance") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="8.5"/><path d="M14.7 8.7c-.6-.8-1.5-1.2-2.6-1.2-1.5 0-2.7.8-2.7 2s1 1.7 2.7 2.1c1.8.4 2.9 1 2.9 2.4 0 1.5-1.2 2.5-3 2.5-1.3 0-2.4-.5-3.1-1.4M12 5.7v12.5"/></svg>;
  if (name === "forecast") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 19.5V14M8 19.5v-8M12 19.5V9M16 19.5V6M20 19.5V3.5"/><path d="m4 10 4-3 4 1 6-5"/></svg>;
  if (name === "reports") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M6 3.5h9l3 3v14H6z"/><path d="M15 3.5V7h3M9 11h6M9 14.5h6M9 18h4"/></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="3"/><path d="M19 13.4v-2.8l-2-.7a7.4 7.4 0 0 0-.7-1.6l.9-1.9-2-2-1.9.9a7.4 7.4 0 0 0-1.6-.7L11 2.5H8.2l-.7 2a7.4 7.4 0 0 0-1.6.7L4 4.3l-2 2 .9 1.9a7.4 7.4 0 0 0-.7 1.6l-2 .7v2.8l2 .7c.2.6.4 1.1.7 1.6L2 17.5l2 2 1.9-.9c.5.3 1 .5 1.6.7l.7 2h2.8l.7-2c.6-.2 1.1-.4 1.6-.7l1.9.9 2-2-.9-1.9c.3-.5.5-1 .7-1.6z" transform="translate(1) scale(.92)"/></svg>;
}

function iniciaisDe(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? partes[0]?.[1] ?? "")).toUpperCase() || "SL";
}

export function AdminZipShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  const [perfil, setPerfil] = useState<{ nome: string; cargo: string } | null>(null);
  const [notificacoesAbertas, setNotificacoesAbertas] = useState(false);
  const [perfilAberto, setPerfilAberto] = useState(false);

  useEffect(() => {
    let ativo = true;
    fetch("/api/admin/session", { cache: "no-store" })
      .then((resposta) => resposta.json())
      .then((dados) => {
        if (ativo && dados?.nome) setPerfil({ nome: dados.nome, cargo: dados.cargo ?? "administrativo" });
      })
      .catch(() => {});
    return () => { ativo = false; };
  }, []);

  useEffect(() => {
    if (!notificacoesAbertas && !perfilAberto) return;
    const fechar = (event: PointerEvent) => {
      const alvo = event.target as HTMLElement;
      if (alvo.closest("[data-admin-ref-popover]")) return;
      setNotificacoesAbertas(false);
      setPerfilAberto(false);
    };
    document.addEventListener("pointerdown", fechar);
    return () => document.removeEventListener("pointerdown", fechar);
  }, [notificacoesAbertas, perfilAberto]);

  async function sair() {
    try {
      await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      router.replace("/admin/login");
    }
  }

  const ativo = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const nome = perfil?.nome ?? "Sra. Luck";
  const cargo = CARGO_LABEL[perfil?.cargo ?? ""] ?? "Administradora";
  const clientesExact = pathname === "/admin/clientes" || pathname.startsWith("/admin/clientes/");

  return (
    <div className={`admin-reference-shell zip-admin${dark ? " is-dark dark" : ""}`}>
      <aside className="ref-sidebar">
        <div className="ref-brand">
          <div className="ref-brand-name">Sra. Luck</div>
          <div className="ref-brand-sub">Painel Administrativo</div>
        </div>

        <nav aria-label="Navegação administrativa">
          <section className="ref-nav-section">
            <div className="ref-nav-title">Operação</div>
            <div className="ref-nav-list">
              {NAV_OPERACAO.map((item) => <Link key={item.href} href={item.href} className={`ref-nav-item${ativo(item.href) ? " active" : ""}`} aria-current={ativo(item.href) ? "page" : undefined}>
                <span className="ref-nav-ico"><NavIcon name={item.icon}/></span>
                <span className="ref-nav-label">{item.label}</span>
              </Link>)}
            </div>
          </section>

          <section className="ref-nav-section management">
            <div className="ref-nav-title">Gestão</div>
            <div className="ref-nav-list">
              {NAV_GESTAO.map((item) => <Link key={item.href} href={item.href} className={`ref-nav-item${ativo(item.href) ? " active" : ""}`} aria-current={ativo(item.href) ? "page" : undefined}>
                <span className="ref-nav-ico"><NavIcon name={item.icon}/></span>
                <span className="ref-nav-label">{item.label}</span>
              </Link>)}
            </div>
          </section>
        </nav>

        <div className="ref-sidebar-bottom">
          <div className="ref-motivation">
            <div className="ref-diamond"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 8 4-4h8l4 4-8 12z"/><path d="M4 8h16M8 4l4 16 4-16"/></svg></div>
            <p>Disciplina hoje,<br/>liberdade sempre.</p>
          </div>

          <button className="ref-side-card" type="button" onClick={toggleTheme}>
            <span className="ref-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v3M12 18.5v3M4.8 4.8l2.1 2.1M17.1 17.1l2.1 2.1M2.5 12h3M18.5 12h3M4.8 19.2l2.1-2.1M17.1 6.9l2.1-2.1"/></svg></span>
            <span className="ref-label">{dark ? "Modo escuro" : "Modo claro"}</span>
            <span className="ref-arrow"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m9 5 7 7-7 7"/></svg></span>
          </button>

          <button className="ref-side-card ref-user-side" type="button" onClick={() => setPerfilAberto(true)}>
            <span className="ref-avatar">{iniciaisDe(nome)}</span>
            <span className="ref-user-meta"><span className="ref-user-name">{nome}</span><span className="ref-user-role">{cargo}</span></span>
            <span className="ref-arrow"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m9 5 7 7-7 7"/></svg></span>
          </button>

          <button className="ref-logout" type="button" onClick={() => void sair()}>
            <span className="ref-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10M13 8l4 4-4 4M17 12H8"/></svg></span>
            <span>Sair</span>
          </button>
        </div>
      </aside>

      <div className="ref-main-shell">
        <header className="ref-topbar">
          <div className="ref-hello">
            <div className="ref-hello-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4.5" y="4.5" width="15" height="15" rx="2"/><path d="M9 9h6v6H9z"/></svg></div>
            <div><div className="ref-hello-title">Olá, Sra. Luck 👋</div><div className="ref-hello-sub">Que bom te ver por aqui!</div></div>
          </div>
          <div className="ref-top-actions" data-admin-ref-popover>
            <button className="ref-icon-btn" type="button" aria-label="Notificações" onClick={(event) => { event.stopPropagation(); setPerfilAberto(false); setNotificacoesAbertas((valor) => !valor); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 6 2.3 6 2.3 7.5H4.2c0-1.5 2.3-1.5 2.3-7.5Z"/><path d="M10 20h4"/></svg>
              <span className="ref-notif-dot"/>
            </button>
            <div className="ref-v-sep"/>
            <button className="ref-profile-top" type="button" onClick={(event) => { event.stopPropagation(); setNotificacoesAbertas(false); setPerfilAberto((valor) => !valor); }}>
              <span className="ref-avatar">{iniciaisDe(nome)}</span>
              <span className="ref-user-meta"><span className="ref-user-name">{nome}</span><span className="ref-user-role">{cargo}</span></span>
              <span className="ref-profile-chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m7 9 5 5 5-5"/></svg></span>
            </button>
          </div>
        </header>

        <main className={`ref-page-slot${clientesExact ? "" : " legacy"}`}>{children}</main>
      </div>

      {notificacoesAbertas ? <div className="ref-popover" data-admin-ref-popover><h4>Notificações</h4><div className="ref-pop-row">Nenhuma notificação nova no momento.</div></div> : null}
      {perfilAberto ? <div className="ref-popover ref-profile-pop" data-admin-ref-popover>
        <button type="button" onClick={() => setPerfilAberto(false)}>Meu perfil</button>
        <button type="button" onClick={() => router.push("/admin/configuracoes")}>Configurações</button>
        <button type="button" onClick={() => void sair()}>Sair</button>
      </div> : null}
    </div>
  );
}
