"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, KeyRound, Plus, RefreshCw, ShieldCheck, UserCog, UserRoundCheck, UserRoundX, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { PageHeader } from "@/components/admin/ExecutiveUI";
import { cn } from "@/lib/utils";

type Cargo = "vendedora" | "sdr" | "financeiro" | "administrativo";
type Colaborador = {
  id: string;
  nome: string;
  email: string;
  cargo: Cargo;
  ativo: boolean;
  permissoes: string[];
  created_at: string;
  updated_at: string;
};

const CARGOS: Array<{ value: Cargo; label: string; descricao: string }> = [
  { value: "vendedora", label: "Vendedora", descricao: "Portal comercial e comissão da primeira parcela." },
  { value: "sdr", label: "SDR", descricao: "Agenda, comparecimentos e comissão por presença." },
  { value: "financeiro", label: "Financeiro", descricao: "Operação financeira e comissão de recuperação." },
  { value: "administrativo", label: "Administrativo", descricao: "Acesso administrativo autorizado no servidor." },
];

function labelCargo(cargo: Cargo) {
  return CARGOS.find((item) => item.value === cargo)?.label ?? cargo;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({})) as T & { erro?: string };
  if (!response.ok) throw new Error(body.erro ?? "Não foi possível concluir a operação.");
  return body;
}

export default function EquipeAdminPage() {
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [cargo, setCargo] = useState<Cargo>("vendedora");
  const [senha, setSenha] = useState("");

  async function carregar() {
    setLoading(true);
    try {
      const body = await requestJson<{ colaboradores: Colaborador[] }>("/api/admin/staff");
      setColaboradores(body.colaboradores ?? []);
      setErro(null);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível carregar a equipe.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void carregar(); }, []);

  const resumo = useMemo(() => ({
    ativos: colaboradores.filter((item) => item.ativo).length,
    administrativos: colaboradores.filter((item) => item.ativo && item.cargo === "administrativo").length,
    operacao: colaboradores.filter((item) => item.ativo && item.cargo !== "administrativo").length,
  }), [colaboradores]);

  async function criar(event: FormEvent) {
    event.preventDefault();
    setCriando(true);
    setErro(null);
    try {
      await requestJson("/api/admin/staff", {
        method: "POST",
        body: JSON.stringify({ nome, email, cargo, senhaTemporaria: senha }),
      });
      setModal(false);
      setNome(""); setEmail(""); setCargo("vendedora"); setSenha("");
      await carregar();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível criar o acesso.");
    } finally {
      setCriando(false);
    }
  }

  async function atualizar(id: string, patch: Partial<Pick<Colaborador, "cargo" | "ativo">>) {
    setSalvando(id);
    setErro(null);
    try {
      const body = await requestJson<{ colaborador: Colaborador }>(`/api/admin/staff/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setColaboradores((atual) => atual.map((item) => item.id === id ? body.colaborador : item));
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível atualizar o acesso.");
      await carregar();
    } finally {
      setSalvando(null);
    }
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader eyebrow="Administração" title="Equipe" description="Acessos e cargos validados no servidor. Nenhum perfil é definido pelo aparelho do colaborador." />

      {erro && <div className="rounded-xl border border-alert/20 bg-alert/5 px-4 py-3 text-sm text-alert">{erro}</div>}

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-4"><p className="text-[10px] font-bold uppercase tracking-label text-clay/45">Ativos</p><p className="mt-1 font-heading text-2xl text-burgundy">{resumo.ativos}</p><p className="mt-1 text-xs text-clay/50">Acessos atualmente habilitados.</p></Card>
        <Card className="p-4"><p className="text-[10px] font-bold uppercase tracking-label text-clay/45">Operação</p><p className="mt-1 font-heading text-2xl text-burgundy">{resumo.operacao}</p><p className="mt-1 text-xs text-clay/50">Vendedora, SDR e Financeiro.</p></Card>
        <Card className="p-4"><p className="text-[10px] font-bold uppercase tracking-label text-clay/45">Administrativos</p><p className="mt-1 font-heading text-2xl text-burgundy">{resumo.administrativos}</p><p className="mt-1 text-xs text-clay/50">Autorizados a acessar o backoffice.</p></Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose/10 px-4 py-3">
          <div><h2 className="font-heading text-lg text-burgundy dark:text-pearl">Acessos da equipe</h2><p className="text-xs text-clay/50 dark:text-pearl/45">Alterações de cargo ou desativação invalidam a sessão antiga no próximo acesso à API.</p></div>
          <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => void carregar()} loading={loading}><RefreshCw className="h-3.5 w-3.5"/> Atualizar</Button><Button size="sm" onClick={() => setModal(true)}><Plus className="h-3.5 w-3.5"/> Novo acesso</Button></div>
        </div>

        <div className="divide-y divide-rose/8">
          {loading && colaboradores.length === 0 ? <div className="px-4 py-10 text-center text-sm text-clay/45">Carregando equipe...</div> : colaboradores.length === 0 ? <div className="px-4 py-10 text-center text-sm text-clay/45">Nenhum colaborador cadastrado.</div> : colaboradores.map((item) => (
            <div key={item.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[1.3fr_.8fr_.55fr] lg:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", item.ativo ? "bg-success/10 text-success" : "bg-clay/8 text-clay/35")}>
                  {item.ativo ? <UserRoundCheck className="h-4.5 w-4.5"/> : <UserRoundX className="h-4.5 w-4.5"/>}
                </span>
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-burgundy dark:text-pearl">{item.nome}</p><p className="truncate text-xs text-clay/50 dark:text-pearl/45">{item.email}</p><div className="mt-1 flex items-center gap-1.5"><span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-label", item.ativo ? "bg-success/8 text-success" : "bg-clay/8 text-clay/40")}>{item.ativo ? "Ativo" : "Desativado"}</span>{item.cargo === "administrativo" && <span className="inline-flex items-center gap-1 rounded-full bg-burgundy/8 px-2 py-0.5 text-[9px] font-bold uppercase tracking-label text-burgundy"><ShieldCheck className="h-3 w-3"/> Admin</span>}</div></div>
              </div>

              <div><Label htmlFor={`cargo-${item.id}`}>Cargo</Label><select id={`cargo-${item.id}`} value={item.cargo} disabled={salvando === item.id} onChange={(event) => void atualizar(item.id, { cargo: event.target.value as Cargo })} className="mt-1 h-10 w-full rounded-xl border border-rose/12 bg-white px-3 text-sm text-burgundy outline-none focus:border-burgundy/30 dark:border-white/10 dark:bg-white/[0.04] dark:text-pearl">{CARGOS.map((opcao) => <option key={opcao.value} value={opcao.value}>{opcao.label}</option>)}</select></div>

              <div className="flex lg:justify-end"><Button size="sm" variant={item.ativo ? "secondary" : "default"} loading={salvando === item.id} onClick={() => { const acao = item.ativo ? "desativar" : "ativar"; if (window.confirm(`Deseja ${acao} o acesso de ${item.nome}?`)) void atualizar(item.id, { ativo: !item.ativo }); }}>{item.ativo ? "Desativar" : "Ativar"}</Button></div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="border-gold/15 bg-gold/[0.035] p-4"><div className="flex gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold"><UserCog className="h-4 w-4"/></span><div><h3 className="text-sm font-semibold text-burgundy dark:text-pearl">Fonte de verdade: banco + sessão assinada</h3><p className="mt-1 text-xs leading-5 text-clay/55 dark:text-pearl/45">O portal da equipe lê nome, cargo, permissões, comissões e treinamentos do backend. Trocar valores no navegador não concede acesso nem muda o cargo real.</p></div></div></Card>

      {modal && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-burgundy-dark/50 p-4 backdrop-blur-sm"><Card className="w-full max-w-lg p-0 shadow-2xl"><div className="flex items-start justify-between border-b border-rose/10 px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-label text-rose">Novo colaborador</p><h2 className="font-heading text-xl text-burgundy dark:text-pearl">Criar acesso da equipe</h2></div><button type="button" onClick={() => !criando && setModal(false)} className="rounded-full p-2 text-clay/45 hover:bg-blush"><X className="h-4 w-4"/></button></div><form onSubmit={criar} className="space-y-4 p-5"><div><Label htmlFor="novo-nome">Nome</Label><Input id="novo-nome" value={nome} onChange={(event) => setNome(event.target.value)} required /></div><div><Label htmlFor="novo-email">E-mail corporativo</Label><Input id="novo-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div><div><Label htmlFor="novo-cargo">Cargo</Label><select id="novo-cargo" value={cargo} onChange={(event) => setCargo(event.target.value as Cargo)} className="mt-1 h-11 w-full rounded-xl border border-rose/12 bg-white px-3 text-sm text-burgundy outline-none focus:border-burgundy/30 dark:border-white/10 dark:bg-white/[0.04] dark:text-pearl">{CARGOS.map((opcao) => <option key={opcao.value} value={opcao.value}>{opcao.label} — {opcao.descricao}</option>)}</select></div><div><Label htmlFor="nova-senha">Senha temporária</Label><div className="relative"><KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-clay/35"/><Input id="nova-senha" type="password" value={senha} onChange={(event) => setSenha(event.target.value)} minLength={8} className="pl-10" required /></div><p className="mt-1 text-[11px] text-clay/45">Mínimo de 8 caracteres. O acesso é criado no Supabase Auth e vinculado ao cadastro interno.</p></div><div className="flex justify-end gap-2 border-t border-rose/8 pt-4"><Button type="button" variant="secondary" onClick={() => setModal(false)} disabled={criando}>Cancelar</Button><Button type="submit" loading={criando}><CheckCircle2 className="h-4 w-4"/> Criar acesso</Button></div></form></Card></div>}
    </div>
  );
}
