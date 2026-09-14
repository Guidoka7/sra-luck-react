import { useEffect, useState } from "react";
import { Gift, Plus, RefreshCw, Save, Search, Settings2, Users2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel, SectionHeading, EmptyPanel, StatusPill } from "@/components/admin/ExecutiveUI";
import { Button } from "@/components/ui/Button";

type Aba = "catalogo" | "indicacoes" | "resgates" | "cliente" | "config";

interface Recompensa {
  id: string; titulo: string; descricao: string | null; categoria: string | null;
  pontos: number; estoque: number | null; ativo: boolean; ordem: number;
  icone_key: string | null; instrucoes_pos_resgate: string | null;
}
interface Indicacao {
  id: string; nome_indicado: string; telefone_indicado: string | null; status: string;
  pontos_creditados: number; created_at: string; clientes: { id: string; nome_completo: string } | null;
}
interface Resgate {
  id: string; pontos: number; status: string; observacao_admin: string | null; created_at: string;
  clientes: { id: string; nome_completo: string; cpf: string } | null; clube_recompensas: { id: string; titulo: string } | null;
}
interface ClubeConfig {
  pontos_por_indicacao: number; pontos_primeira_parcela: number;
  voucher_primeira_parcela_ativo: boolean; voucher_primeira_parcela_titulo: string;
}

const ABAS: { id: Aba; label: string; icon: typeof Gift }[] = [
  { id: "catalogo", label: "Catálogo de prêmios", icon: Gift },
  { id: "indicacoes", label: "Indicações", icon: Users2 },
  { id: "resgates", label: "Resgates", icon: RefreshCw },
  { id: "cliente", label: "Buscar cliente", icon: Search },
  { id: "config", label: "Configurações", icon: Settings2 },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(path, { ...init, credentials: "include", headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) } });
  const dados = await resposta.json().catch(() => ({})) as T & { erro?: string };
  if (!resposta.ok) throw new Error(dados.erro ?? "Não foi possível concluir a operação.");
  return dados;
}

const STATUS_INDICACAO: Record<string, { label: string; tone: "neutral" | "success" | "gold" | "alert" }> = {
  enviada: { label: "Em análise", tone: "gold" }, qualificada: { label: "Qualificada", tone: "gold" },
  venda: { label: "Confirmada", tone: "success" }, invalidada: { label: "Rejeitada", tone: "alert" },
};
const STATUS_RESGATE: Record<string, { label: string; tone: "neutral" | "success" | "gold" | "alert" }> = {
  solicitado: { label: "Solicitado", tone: "gold" }, aprovado: { label: "Aprovado", tone: "gold" },
  separacao: { label: "Em separação", tone: "gold" }, entregue: { label: "Entregue", tone: "success" }, cancelado: { label: "Cancelado", tone: "alert" },
};

function CatalogoTab() {
  const [itens, setItens] = useState<Recompensa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState({ titulo: "", descricao: "", pontos: 100, ordem: 0 });

  async function carregar() {
    setCarregando(true);
    try { setItens((await api<{ recompensas: Recompensa[] }>("/api/admin/credit-ops/rewards")).recompensas); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao carregar catálogo."); }
    finally { setCarregando(false); }
  }
  useEffect(() => { void carregar(); }, []);

  async function criar() {
    if (!novo.titulo.trim() || novo.pontos <= 0) { toast.error("Informe título e custo em pontos."); return; }
    try {
      await api("/api/admin/credit-ops/rewards", { method: "POST", body: JSON.stringify(novo) });
      toast.success("Prêmio criado.");
      setNovo({ titulo: "", descricao: "", pontos: 100, ordem: 0 });
      await carregar();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao criar prêmio."); }
  }

  async function atualizar(id: string, patch: Record<string, unknown>) {
    try { await api(`/api/admin/credit-ops/rewards/${id}`, { method: "PATCH", body: JSON.stringify(patch) }); await carregar(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao atualizar prêmio."); }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel className="p-4">
        <SectionHeading title="Novo prêmio" description="Cadastre um benefício resgatável por pontos." />
        <div className="mt-3 grid gap-2.5 sm:grid-cols-4">
          <input value={novo.titulo} onChange={(e) => setNovo({ ...novo, titulo: e.target.value })} placeholder="Título" className="rounded-lg border border-rose/15 px-3 py-2 text-sm sm:col-span-2" />
          <input type="number" min={1} value={novo.pontos} onChange={(e) => setNovo({ ...novo, pontos: Number(e.target.value) })} placeholder="Pontos" className="rounded-lg border border-rose/15 px-3 py-2 text-sm" />
          <input type="number" value={novo.ordem} onChange={(e) => setNovo({ ...novo, ordem: Number(e.target.value) })} placeholder="Ordem" className="rounded-lg border border-rose/15 px-3 py-2 text-sm" />
          <input value={novo.descricao} onChange={(e) => setNovo({ ...novo, descricao: e.target.value })} placeholder="Descrição" className="rounded-lg border border-rose/15 px-3 py-2 text-sm sm:col-span-4" />
        </div>
        <Button size="sm" className="mt-3" onClick={() => void criar()}><Plus className="h-3.5 w-3.5" /> Adicionar prêmio</Button>
      </Panel>

      <Panel className="p-4">
        {carregando ? <p className="text-sm text-clay/50">Carregando...</p> : itens.length === 0 ? <EmptyPanel title="Nenhum prêmio cadastrado" description="Adicione o primeiro benefício do Clube de Vantagens." /> : (
          <div className="flex flex-col gap-2">
            {itens.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-rose/10 bg-white/70 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-burgundy">{item.titulo}</p>
                  <p className="truncate text-xs text-clay/50">{item.descricao ?? "Sem descrição"} · {item.pontos} pontos{item.estoque !== null ? ` · estoque ${item.estoque}` : ""}</p>
                </div>
                <StatusPill tone={item.ativo ? "success" : "neutral"}>{item.ativo ? "Ativo" : "Inativo"}</StatusPill>
                <button type="button" onClick={() => void atualizar(item.id, { ativo: !item.ativo })} className="rounded-lg border border-rose/15 px-2.5 py-1.5 text-[11px] font-semibold text-burgundy hover:bg-blush">
                  {item.ativo ? "Desativar" : "Ativar"}
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function IndicacoesTab() {
  const [itens, setItens] = useState<Indicacao[]>([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    setCarregando(true);
    try { setItens((await api<{ indicacoes: Indicacao[] }>("/api/admin/credit-ops/referrals")).indicacoes); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao carregar indicações."); }
    finally { setCarregando(false); }
  }
  useEffect(() => { void carregar(); }, []);

  async function revisar(id: string, acao: "confirmar" | "rejeitar") {
    try { await api(`/api/admin/credit-ops/referrals/${id}/${acao}`, { method: "POST" }); toast.success(acao === "confirmar" ? "Indicação confirmada." : "Indicação rejeitada."); await carregar(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao revisar indicação."); }
  }

  if (carregando) return <p className="text-sm text-clay/50">Carregando...</p>;
  if (itens.length === 0) return <EmptyPanel title="Nenhuma indicação registrada" description="As indicações feitas pelas clientes aparecem aqui para confirmação." />;

  return (
    <Panel className="p-4">
      <div className="flex flex-col gap-2">
        {itens.map((item) => {
          const status = STATUS_INDICACAO[item.status] ?? { label: item.status, tone: "neutral" as const };
          const pendente = item.status === "enviada" || item.status === "qualificada";
          return (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-rose/10 bg-white/70 px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-burgundy">{item.nome_indicado}</p>
                <p className="truncate text-xs text-clay/50">Indicada por {item.clientes?.nome_completo ?? "—"} · {item.telefone_indicado ?? "sem telefone"}</p>
              </div>
              <StatusPill tone={status.tone}>{status.label}</StatusPill>
              {pendente && (
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => void revisar(item.id, "confirmar")} className="rounded-lg border border-success/25 bg-success/8 px-2.5 py-1.5 text-[11px] font-semibold text-success">Confirmar</button>
                  <button type="button" onClick={() => void revisar(item.id, "rejeitar")} className="rounded-lg border border-alert/20 bg-alert/8 px-2.5 py-1.5 text-[11px] font-semibold text-alert">Rejeitar</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function ResgatesTab() {
  const [itens, setItens] = useState<Resgate[]>([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    setCarregando(true);
    try { setItens((await api<{ resgates: Resgate[] }>("/api/admin/credit-ops/redemptions")).resgates); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao carregar resgates."); }
    finally { setCarregando(false); }
  }
  useEffect(() => { void carregar(); }, []);

  async function atualizar(id: string, status: string) {
    try { await api(`/api/admin/credit-ops/redemptions/${id}`, { method: "POST", body: JSON.stringify({ status }) }); toast.success("Resgate atualizado."); await carregar(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao atualizar resgate."); }
  }

  if (carregando) return <p className="text-sm text-clay/50">Carregando...</p>;
  if (itens.length === 0) return <EmptyPanel title="Nenhum resgate solicitado" description="Os resgates de prêmios pelas clientes aparecem aqui." />;

  const proximaAcao: Record<string, { status: string; label: string } | undefined> = {
    solicitado: { status: "aprovado", label: "Aprovar" },
    aprovado: { status: "separacao", label: "Em separação" },
    separacao: { status: "entregue", label: "Marcar entregue" },
  };

  return (
    <Panel className="p-4">
      <div className="flex flex-col gap-2">
        {itens.map((item) => {
          const status = STATUS_RESGATE[item.status] ?? { label: item.status, tone: "neutral" as const };
          const acao = proximaAcao[item.status];
          return (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-rose/10 bg-white/70 px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-burgundy">{item.clube_recompensas?.titulo ?? "Prêmio removido"}</p>
                <p className="truncate text-xs text-clay/50">{item.clientes?.nome_completo ?? "—"} · {item.pontos} pontos</p>
              </div>
              <StatusPill tone={status.tone}>{status.label}</StatusPill>
              <div className="flex gap-1.5">
                {acao && <button type="button" onClick={() => void atualizar(item.id, acao.status)} className="rounded-lg border border-success/25 bg-success/8 px-2.5 py-1.5 text-[11px] font-semibold text-success">{acao.label}</button>}
                {item.status !== "entregue" && item.status !== "cancelado" && (
                  <button type="button" onClick={() => void atualizar(item.id, "cancelado")} className="rounded-lg border border-alert/20 bg-alert/8 px-2.5 py-1.5 text-[11px] font-semibold text-alert">Cancelar</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function ClienteTab() {
  const [clienteId, setClienteId] = useState("");
  const [dados, setDados] = useState<{ saldo: number; eventos: { id: string; tipo: string; pontos: number; created_at: string }[]; beneficios: { id: string; beneficio_key: string; status: string }[] } | null>(null);
  const [ajuste, setAjuste] = useState({ pontos: 0, motivo: "" });
  const [carregando, setCarregando] = useState(false);

  async function buscar() {
    if (!clienteId.trim()) return;
    setCarregando(true);
    try { setDados(await api(`/api/admin/credit-ops/clients/${clienteId.trim()}/ledger`)); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Cliente não encontrado."); setDados(null); }
    finally { setCarregando(false); }
  }

  async function ajustar() {
    if (ajuste.pontos === 0 || !ajuste.motivo.trim()) { toast.error("Informe pontos e motivo do ajuste."); return; }
    try {
      await api(`/api/admin/credit-ops/clients/${clienteId.trim()}/adjust`, { method: "POST", body: JSON.stringify(ajuste) });
      toast.success("Saldo ajustado.");
      setAjuste({ pontos: 0, motivo: "" });
      await buscar();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao ajustar saldo."); }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel className="p-4">
        <SectionHeading title="Buscar cliente" description="Informe o ID do cliente para ver o extrato de pontos e ajustar manualmente." />
        <div className="mt-3 flex gap-2">
          <input value={clienteId} onChange={(e) => setClienteId(e.target.value)} placeholder="ID do cliente" className="flex-1 rounded-lg border border-rose/15 px-3 py-2 text-sm" />
          <Button size="sm" onClick={() => void buscar()}><Search className="h-3.5 w-3.5" /> Buscar</Button>
        </div>
      </Panel>

      {carregando && <p className="text-sm text-clay/50">Carregando...</p>}

      {dados && (
        <>
          <Panel className="p-4">
            <p className="text-xs uppercase tracking-label text-clay/45">Saldo atual</p>
            <p className="font-heading text-3xl font-bold text-gold">{dados.saldo}</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <input type="number" value={ajuste.pontos || ""} onChange={(e) => setAjuste({ ...ajuste, pontos: Number(e.target.value) })} placeholder="+/- pontos" className="rounded-lg border border-rose/15 px-3 py-2 text-sm" />
              <input value={ajuste.motivo} onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })} placeholder="Motivo do ajuste" className="rounded-lg border border-rose/15 px-3 py-2 text-sm sm:col-span-2" />
            </div>
            <Button size="sm" className="mt-2.5" onClick={() => void ajustar()}><Save className="h-3.5 w-3.5" /> Aplicar ajuste auditado</Button>
          </Panel>
          <Panel className="p-4">
            <SectionHeading title="Extrato" />
            <div className="mt-2 flex flex-col gap-1.5">
              {dados.eventos.map((evento) => (
                <div key={evento.id} className="flex items-center justify-between text-sm">
                  <span className="text-clay/65">{evento.tipo} · {new Date(evento.created_at).toLocaleDateString("pt-BR")}</span>
                  <span className={evento.pontos >= 0 ? "text-success" : "text-rose"}>{evento.pontos >= 0 ? "+" : ""}{evento.pontos}</span>
                </div>
              ))}
              {dados.eventos.length === 0 && <p className="text-sm text-clay/45">Sem movimentações.</p>}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function ConfigTab() {
  const [config, setConfig] = useState<ClubeConfig | null>(null);

  async function carregar() {
    try { setConfig((await api<{ config: ClubeConfig }>("/api/admin/credit-ops/config")).config); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao carregar configuração."); }
  }
  useEffect(() => { void carregar(); }, []);

  async function salvar() {
    if (!config) return;
    try {
      await api("/api/admin/credit-ops/config", {
        method: "PATCH",
        body: JSON.stringify({
          pontosPorIndicacao: config.pontos_por_indicacao,
          pontosPrimeiraParcela: config.pontos_primeira_parcela,
          voucherPrimeiraParcelaAtivo: config.voucher_primeira_parcela_ativo,
          voucherPrimeiraParcelaTitulo: config.voucher_primeira_parcela_titulo,
        }),
      });
      toast.success("Configuração salva.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao salvar configuração."); }
  }

  if (!config) return <p className="text-sm text-clay/50">Carregando...</p>;

  return (
    <Panel className="p-4">
      <SectionHeading title="Regras do Clube" description="Pontos por indicação confirmada e bônus da primeira parcela." />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold uppercase tracking-label text-clay/50">Pontos por indicação confirmada
          <input type="number" min={0} value={config.pontos_por_indicacao} onChange={(e) => setConfig({ ...config, pontos_por_indicacao: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-rose/15 px-3 py-2 text-sm normal-case" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-label text-clay/50">Pontos do bônus da 1ª parcela
          <input type="number" min={0} value={config.pontos_primeira_parcela} onChange={(e) => setConfig({ ...config, pontos_primeira_parcela: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-rose/15 px-3 py-2 text-sm normal-case" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-label text-clay/50 sm:col-span-2">Título do voucher da 1ª parcela
          <input value={config.voucher_primeira_parcela_titulo} onChange={(e) => setConfig({ ...config, voucher_primeira_parcela_titulo: e.target.value })} className="mt-1 w-full rounded-lg border border-rose/15 px-3 py-2 text-sm normal-case" />
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-label text-clay/50">
          <input type="checkbox" checked={config.voucher_primeira_parcela_ativo} onChange={(e) => setConfig({ ...config, voucher_primeira_parcela_ativo: e.target.checked })} />
          Voucher da 1ª parcela ativo
        </label>
      </div>
      <Button size="sm" className="mt-3" onClick={() => void salvar()}><Save className="h-3.5 w-3.5" /> Salvar regras</Button>
    </Panel>
  );
}

export default function AdminClube() {
  const [aba, setAba] = useState<Aba>("catalogo");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Gestão" title="Clube de Vantagens" description="Catálogo de prêmios, indicações, resgates e regras de pontuação da cliente." />

      <div className="flex flex-wrap gap-1.5 rounded-full bg-blush/60 p-1.5">
        {ABAS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setAba(id)}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors ${aba === id ? "bg-burgundy text-pearl" : "text-burgundy/60 hover:text-burgundy"}`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {aba === "catalogo" && <CatalogoTab />}
      {aba === "indicacoes" && <IndicacoesTab />}
      {aba === "resgates" && <ResgatesTab />}
      {aba === "cliente" && <ClienteTab />}
      {aba === "config" && <ConfigTab />}
    </div>
  );
}
