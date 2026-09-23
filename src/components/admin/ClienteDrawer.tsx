"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Check, Clock, FileText, FileUp, History, IdCard, Landmark, Paperclip, Receipt, ShieldAlert, Trash2, UserRound, WalletCards, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Textarea } from "@/components/ui/Input";
import { formatarCpf } from "@/lib/cpf";
import { desmascararMoeda, mascararMoedaInput } from "@/lib/utils";
import type { Boleto, Carne, Cliente, ImportacaoBoleto, LogAlteracao, QuantidadeParcelas, StatusContratoCliente } from "@/types/database";
import { QUANTIDADE_PARCELAS_OPCOES, STATUS_BOLETO_LABEL, STATUS_CONTRATO_LABEL, TAXA_ADMINISTRATIVA_PADRAO } from "@/types/database";

const STATUS_CONTRATO_OPCOES: StatusContratoCliente[] = ["ativo", "suspenso", "negativado", "cancelado"];
const moeda = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ValueBadge({ label, value, prefix = "R$", suffix, tone = "neutral", onChange }: { label: string; value: string; prefix?: string; suffix?: string; tone?: "neutral" | "green" | "gold" | "rose"; onChange?: (v: string) => void }) {
  const tones = {
    neutral: "border-slate-200 bg-slate-50 text-slate-900 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-100",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-400/[0.08] dark:text-emerald-300",
    gold: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-300/20 dark:bg-amber-300/[0.08] dark:text-amber-200",
    rose: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose/20 dark:bg-rose/[0.08] dark:text-rose-200",
  };
  const mostrarPrefixo = Boolean(prefix) && !suffix;
  return <div className="min-w-0"><Label>{label}</Label><div className={`mt-1 flex h-10 items-center rounded-xl border px-2.5 shadow-sm transition focus-within:ring-1 focus-within:ring-rose/20 ${tones[tone]}`}>
    {mostrarPrefixo && <span className="shrink-0 text-[0.62rem] font-bold opacity-75">{prefix}</span>}
    <input inputMode="decimal" value={value} onChange={(e) => onChange?.(e.target.value)} className="min-w-0 w-full bg-transparent px-1.5 text-xs font-bold outline-none" />
    {suffix && <span className="shrink-0 pl-1 text-[0.62rem] font-bold opacity-75">{suffix}</span>}
  </div></div>;
}

/**
 * Drawer lateral único (Correção 3): compartilhado entre Clientes e
 * Financeiro. Duas abas — PERFIL (dados pessoais, venda, contrato/status,
 * histórico) e FINANCEIRO (plano financeiro, parcelas, comprovantes,
 * carnês). Clientes abre em PERFIL; Financeiro abre em FINANCEIRO.
 */
export function ClienteDrawer({ cliente, onClose, onSalvo, abaInicial = "perfil" }: { cliente: Cliente | null; onClose: () => void; onSalvo: () => void; abaInicial?: "perfil" | "financeiro" }) {
  const editando = Boolean(cliente);
  const [aba, setAba] = useState<"perfil" | "financeiro">(editando ? abaInicial : "perfil");

  const [nome, setNome] = useState(cliente?.nome_completo ?? "");
  const [cpf, setCpf] = useState(cliente ? formatarCpf(cliente.cpf) : "");
  const [nascimento, setNascimento] = useState(cliente?.data_nascimento ?? "");
  const [telefone, setTelefone] = useState(cliente?.telefone ?? "");
  const [email, setEmail] = useState(cliente?.email ?? "");
  const [procedimento, setProcedimento] = useState(cliente?.procedimento ?? "");
  const [observacoes, setObservacoes] = useState(cliente?.observacoes_internas ?? "");
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);

  const [statusContrato, setStatusContrato] = useState<StatusContratoCliente>(cliente?.status_contrato ?? "ativo");
  const [suspensoDesde, setSuspensoDesde] = useState(cliente?.suspenso_desde ?? "");
  const [suspensoAte, setSuspensoAte] = useState(cliente?.suspenso_ate ?? "");
  const [suspensaoMotivo, setSuspensaoMotivo] = useState(cliente?.suspensao_motivo ?? "");
  const [salvandoStatus, setSalvandoStatus] = useState(false);
  const [historico, setHistorico] = useState<LogAlteracao[]>([]);

  const [carta, setCarta] = useState(cliente ? moeda(cliente.valor_contrato) : "");
  const [quantidade, setQuantidade] = useState<QuantidadeParcelas>((cliente?.quantidade_parcelas ?? 12) as QuantidadeParcelas);
  const [taxa, setTaxa] = useState(cliente?.taxa_administrativa_percentual != null ? String(cliente.taxa_administrativa_percentual).replace(".", ",") : String(TAXA_ADMINISTRATIVA_PADRAO[(cliente?.quantidade_parcelas ?? 12) as QuantidadeParcelas]).replace(".", ","));
  const [total, setTotal] = useState(() => (cliente ? moeda(cliente.valor_contrato * (1 + Number(cliente.taxa_administrativa_percentual ?? 0) / 100)) : ""));
  const [parcela, setParcela] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [carregandoFin, setCarregandoFin] = useState(Boolean(cliente));
  const [salvandoFin, setSalvandoFin] = useState(false);
  const [ajustando, setAjustando] = useState(false);
  const [rejeitando, setRejeitando] = useState<string | null>(null);
  const [mostrarTodas, setMostrarTodas] = useState(false);
  const [carnes, setCarnes] = useState<Carne[]>([]);
  const [importacoes, setImportacoes] = useState<ImportacaoBoleto[]>([]);
  const [novoCarneBanco, setNovoCarneBanco] = useState("");
  const [novoCarneIdentificador, setNovoCarneIdentificador] = useState("");
  const [novoCarneData, setNovoCarneData] = useState("");
  const [criandoCarne, setCriandoCarne] = useState(false);
  const [importando, setImportando] = useState(false);

  const cartaNumero = Number(desmascararMoeda(carta)) || 0;
  const taxaNumero = Number(taxa.replace(",", ".")) || 0;
  const totalNumero = Number(desmascararMoeda(total)) || 0;
  const parcelaNumero = Number(desmascararMoeda(parcela)) || 0;
  const totalAutomatico = cartaNumero * (1 + taxaNumero / 100);
  const parcelaAutomatica = quantidade ? totalAutomatico / quantidade : 0;

  useEffect(() => { if (!parcela && parcelaAutomatica > 0) setParcela(moeda(parcelaAutomatica)); }, [parcela, parcelaAutomatica]);
  function atualizarCarta(valor: string) { const novo = mascararMoedaInput(valor); setCarta(novo); const n = Number(desmascararMoeda(novo)) || 0; const t = n * (1 + taxaNumero / 100); setTotal(moeda(t)); setParcela(moeda(quantidade ? t / quantidade : 0)); }
  function atualizarTaxa(valor: string) { setTaxa(valor); const n = Number(valor.replace(",", ".")) || 0; const t = cartaNumero * (1 + n / 100); setTotal(moeda(t)); setParcela(moeda(quantidade ? t / quantidade : 0)); }
  function atualizarQuantidade(valor: string) { const q = Number(valor) as QuantidadeParcelas; setQuantidade(q); setParcela(moeda(q ? totalNumero / q : 0)); }
  function atualizarTotal(valor: string) { const novo = mascararMoedaInput(valor); setTotal(novo); const n = Number(desmascararMoeda(novo)) || 0; setCarta(mascararMoedaInput(String((n / (1 + taxaNumero / 100)).toFixed(2)))); setParcela(moeda(quantidade ? n / quantidade : 0)); }
  function atualizarParcela(valor: string) { const novo = mascararMoedaInput(valor); setParcela(novo); const n = Number(desmascararMoeda(novo)) || 0; const t = n * quantidade; setTotal(moeda(t)); setCarta(mascararMoedaInput(String((t / (1 + taxaNumero / 100)).toFixed(2)))); }

  async function carregarBoletos() { if (!cliente?.id) { setBoletos([]); setCarregandoFin(false); return; } setCarregandoFin(true); try { const r = await fetch(`/api/admin/clientes/${cliente.id}/boletos`, { cache: "no-store" }); const d = await r.json(); if (!r.ok) throw new Error(d.erro ?? "Não foi possível carregar os boletos."); const lista = d.boletos ?? []; setBoletos(lista); if (lista[0]?.total_parcelas) setQuantidade(Number(lista[0].total_parcelas) as QuantidadeParcelas); if (lista[0]?.valor) setParcela(moeda(Number(lista[0].valor))); } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao carregar parcelas."); } finally { setCarregandoFin(false); } }
  useEffect(() => { void carregarBoletos(); }, [cliente?.id]);

  async function carregarPerfilExtra() {
    if (!cliente?.id) return;
    try {
      const [rCarnes, rImportacoes, rHistorico] = await Promise.all([
        fetch(`/api/admin/clientes/${cliente.id}/carnes`, { cache: "no-store" }),
        fetch(`/api/admin/clientes/${cliente.id}/importacoes-boletos`, { cache: "no-store" }),
        fetch(`/api/admin/clientes/${cliente.id}/historico`, { cache: "no-store" }),
      ]);
      const [dCarnes, dImportacoes, dHistorico] = await Promise.all([rCarnes.json(), rImportacoes.json(), rHistorico.json()]);
      setCarnes(dCarnes.carnes ?? []);
      setImportacoes(dImportacoes.importacoes ?? []);
      setHistorico(dHistorico.historico ?? []);
    } catch { /* seções auxiliares — não bloqueiam o restante do drawer */ }
  }
  useEffect(() => { void carregarPerfilExtra(); }, [cliente?.id]);

  async function salvarPerfil(e: React.FormEvent) {
    e.preventDefault();
    if (!nome || !nascimento) return toast.error("Preencha nome e data de nascimento.");
    setSalvandoPerfil(true);
    try {
      const r = await fetch(editando ? `/api/admin/clientes/${cliente!.id}` : "/api/admin/clientes", {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomeCompleto: nome, cpf, dataNascimento: nascimento, telefone, email, procedimento, observacoes, valorContrato: cartaNumero || undefined, taxaAdministrativaPercentual: taxaNumero || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro ?? "Não foi possível salvar.");
      toast.success(editando ? "Perfil atualizado." : "Cliente cadastrada. Configure o financeiro na aba Financeiro.");
      onSalvo();
      if (!editando) onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSalvandoPerfil(false);
    }
  }

  async function salvarStatusContrato() {
    if (!cliente?.id || statusContrato === cliente.status_contrato) return;
    setSalvandoStatus(true);
    try {
      const r = await fetch(`/api/admin/clientes/${cliente.id}/status-contrato`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: statusContrato, suspensoDesde: suspensoDesde || undefined, suspensoAte: suspensoAte || undefined, motivo: suspensaoMotivo || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro ?? "Não foi possível alterar o status do contrato.");
      toast.success(`Status do contrato alterado para ${STATUS_CONTRATO_LABEL[statusContrato]}.`);
      void carregarPerfilExtra();
      onSalvo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao alterar status.");
    } finally {
      setSalvandoStatus(false);
    }
  }

  async function gerarOuAjustarParcelas() {
    if (!cliente?.id) return;
    setSalvandoFin(true);
    try {
      const jaTemFinanceiro = boletos.length > 0;
      const url = `/api/admin/clientes/${cliente.id}/boletos`;
      const body = jaTemFinanceiro
        ? { quantidadeParcelas: quantidade, taxaPercentual: taxaNumero, recalcularAbertas: true, primeiroVencimento: vencimento || undefined, valorParcela: parcelaNumero > 0 ? parcelaNumero : undefined }
        : { quantidadeParcelas: quantidade, taxaPercentual: taxaNumero, primeiroVencimento: vencimento, valorParcela: parcelaNumero > 0 ? parcelaNumero : undefined };
      if (!jaTemFinanceiro && !vencimento) return toast.error("Informe o 1º vencimento para gerar as parcelas.");
      const r = await fetch(url, { method: jaTemFinanceiro ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro ?? "Não foi possível salvar o plano financeiro.");
      setBoletos(d.boletos ?? []);
      toast.success(jaTemFinanceiro ? "Parcelamento atualizado." : "Financeiro criado.");
      onSalvo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar plano financeiro.");
    } finally {
      setSalvandoFin(false);
      setAjustando(false);
    }
  }

  async function rejeitar(b: Boleto) { if (!b.comprovante_url) return; if (!window.confirm(`Rejeitar o comprovante da parcela ${b.numero_parcela}/${b.total_parcelas}? A parcela voltará para Em aberto.`)) return; setRejeitando(b.id); try { const r = await fetch(`/api/admin/boletos/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "rejeitar", observacoes: "Comprovante rejeitado pelo administrador." }) }); const d = await r.json(); if (!r.ok) throw new Error(d.erro ?? "Não foi possível rejeitar."); setBoletos((v) => v.map((x) => (x.id === b.id ? { ...x, status: "nao_pago", data_pagamento: null } : x))); toast.success("Comprovante rejeitado. Parcela em aberto."); } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao rejeitar."); } finally { setRejeitando(null); } }
  async function excluirCliente() { if (!cliente?.id) return; setExcluindo(true); try { const r = await fetch(`/api/admin/clientes/${cliente.id}`, { method: "DELETE" }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.erro ?? "Não foi possível excluir o perfil da cliente."); toast.success("Perfil da cliente excluído com sucesso."); setConfirmarExclusao(false); onSalvo(); onClose(); } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao excluir o perfil."); } finally { setExcluindo(false); } }

  async function criarCarne(e: React.FormEvent) {
    e.preventDefault();
    if (!cliente?.id) return;
    if (!novoCarneBanco || !novoCarneIdentificador || !novoCarneData) return toast.error("Preencha instituição, identificador e data do carnê.");
    setCriandoCarne(true);
    try {
      const r = await fetch(`/api/admin/clientes/${cliente.id}/carnes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instituicaoFinanceira: novoCarneBanco, identificadorExterno: novoCarneIdentificador, dataGeracao: novoCarneData, quantidadeParcelas: quantidade, valorParcela: parcelaNumero, valorTotal: totalNumero }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro ?? "Não foi possível registrar o carnê.");
      toast.success("Carnê registrado.");
      setNovoCarneBanco(""); setNovoCarneIdentificador(""); setNovoCarneData("");
      void carregarPerfilExtra();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao registrar carnê.");
    } finally {
      setCriandoCarne(false);
    }
  }

  async function importarCarne(arquivo: File, instituicaoFinanceira: string, carneId?: string) {
    if (!cliente?.id) return;
    setImportando(true);
    try {
      const form = new FormData();
      form.set("arquivo", arquivo);
      form.set("instituicaoFinanceira", instituicaoFinanceira);
      if (carneId) form.set("carneId", carneId);
      const r = await fetch(`/api/admin/clientes/${cliente.id}/importacoes-boletos`, { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro ?? "Não foi possível importar o carnê.");
      const revisar = (d.importacoes ?? []).filter((i: ImportacaoBoleto) => i.status_vinculacao === "revisar").length;
      toast.success(`${(d.importacoes ?? []).length} página(s) importada(s)${revisar ? ` · ${revisar} precisam de revisão manual` : " para confirmação"}.`);
      void carregarPerfilExtra();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao importar carnê.");
    } finally {
      setImportando(false);
    }
  }

  async function vincularImportacao(importacao: ImportacaoBoleto) {
    if (!importacao.boleto_sugerido_id) return toast.error("Sem sugestão automática — selecione a parcela manualmente no carnê.");
    try {
      const r = await fetch(`/api/admin/importacoes-boletos/${importacao.id}/vincular`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boletoId: importacao.boleto_sugerido_id }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro ?? "Não foi possível vincular.");
      toast.success("Página vinculada.");
      void carregarPerfilExtra();
      void carregarBoletos();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao vincular.");
    }
  }
  async function ignorarImportacao(importacaoId: string) {
    try {
      const r = await fetch(`/api/admin/importacoes-boletos/${importacaoId}/ignorar`, { method: "POST" });
      if (!r.ok) throw new Error("Não foi possível ignorar esta página.");
      void carregarPerfilExtra();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao ignorar.");
    }
  }

  const visiveis = mostrarTodas ? boletos : boletos.slice(0, 8);
  const pagas = boletos.filter((b) => b.status === "pago").length;
  const pendentesRevisao = importacoes.filter((i) => i.status_vinculacao !== "vinculado" && i.status_vinculacao !== "ignorado");

  return <>
    <div className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[1px] animate-fadeIn" onClick={onClose} />
    <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-slate-200/80 bg-white text-slate-900 shadow-[-24px_0_60px_-30px_rgba(0,0,0,.35)] animate-slideInRight dark:border-white/10 dark:bg-[#17181D] dark:text-slate-100">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-3.5 dark:border-white/10">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose/15 text-rose"><UserRound className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="truncate font-heading text-base font-semibold text-rose">{nome || "Nova cliente"}</p>
            {editando && <span className="mt-0.5 inline-flex items-center gap-1 text-[0.6rem] font-semibold uppercase tracking-label text-slate-500 dark:text-slate-400"><span className={`h-1.5 w-1.5 rounded-full ${statusContrato === "ativo" ? "bg-success" : statusContrato === "suspenso" ? "bg-amber-500" : "bg-alert dark:bg-[#C7869B]"}`} />{STATUS_CONTRATO_LABEL[cliente?.status_contrato ?? "ativo"]}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {editando && <button type="button" onClick={() => setConfirmarExclusao(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-alert/30 bg-alert dark:bg-[#C7869B]/10 dark:bg-[#C7869B]/10 dark:border-[#C7869B]/30 dark:bg-[#C7869B]/10 px-2.5 py-2 text-[0.58rem] font-bold text-alert dark:text-[#DCA0B2] hover:bg-alert dark:bg-[#C7869B]/20 dark:hover:bg-[#C7869B]/16"><Trash2 className="h-3.5 w-3.5" /></button>}
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"><X className="h-4 w-4" /></button>
        </div>
      </header>

      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/8 dark:bg-[#15161B]">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/[0.045]">
          <button type="button" onClick={() => setAba("perfil")} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[0.68rem] font-semibold ${aba === "perfil" ? "bg-rose text-white" : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-white/5"}`}><IdCard className="h-3.5 w-3.5" /> Perfil</button>
          <button type="button" disabled={!editando} onClick={() => setAba("financeiro")} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[0.68rem] font-semibold disabled:opacity-30 ${aba === "financeiro" ? "bg-rose text-white" : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-white/5"}`}><WalletCards className="h-3.5 w-3.5" /> Financeiro {boletos.length > 0 && <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[0.5rem] dark:bg-white/15">{boletos.length}</span>}</button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {aba === "perfil" ? <form id="drawer-perfil-form" onSubmit={salvarPerfil} className="space-y-2.5">
          <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.025]">
            <div className="mb-2.5 flex items-center gap-2"><IdCard className="h-3.5 w-3.5 text-rose" /><h3 className="text-[0.62rem] font-semibold uppercase tracking-[0.15em] text-rose">Dados pessoais</h3></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2"><Label htmlFor="dw-nome">Nome completo</Label><Input id="dw-nome" value={nome} onChange={(e) => setNome(e.target.value)} required /></div>
              <div><Label htmlFor="dw-cpf">CPF</Label><Input id="dw-cpf" value={cpf} maxLength={14} disabled={editando} onChange={(e) => setCpf(formatarCpf(e.target.value))} /></div>
              <div><Label htmlFor="dw-nascimento">Nascimento</Label><Input id="dw-nascimento" type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} required /></div>
              <div><Label htmlFor="dw-telefone">Telefone</Label><Input id="dw-telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} /></div>
              <div><Label htmlFor="dw-email">E-mail</Label><Input id="dw-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div className="col-span-2"><Label htmlFor="dw-procedimento">Procedimento</Label><Input id="dw-procedimento" value={procedimento} onChange={(e) => setProcedimento(e.target.value)} /></div>
            </div>
          </section>

          {editando && <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.025]">
            <div className="mb-2.5 flex items-center gap-2"><ShieldAlert className="h-3.5 w-3.5 text-rose" /><h3 className="text-[0.62rem] font-semibold uppercase tracking-[0.15em] text-rose">Status do contrato</h3></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{STATUS_CONTRATO_OPCOES.map((opcao) => <button key={opcao} type="button" onClick={() => setStatusContrato(opcao)} className={`rounded-lg border px-2 py-2 text-[0.62rem] font-semibold transition ${statusContrato === opcao ? "border-rose bg-rose text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"}`}>{STATUS_CONTRATO_LABEL[opcao]}</button>)}</div>
            {statusContrato === "suspenso" && <div className="mt-2.5 grid grid-cols-2 gap-2 rounded-lg border border-amber-300/20 bg-amber-50 p-2.5 dark:bg-amber-300/[0.06]"><div><Label htmlFor="dw-susp-desde">Suspenso desde</Label><Input id="dw-susp-desde" type="date" value={suspensoDesde} onChange={(e) => setSuspensoDesde(e.target.value)} /></div><div><Label htmlFor="dw-susp-ate">Até (opcional)</Label><Input id="dw-susp-ate" type="date" value={suspensoAte} onChange={(e) => setSuspensoAte(e.target.value)} placeholder="Indeterminada" /></div><div className="col-span-2"><Label htmlFor="dw-susp-motivo">Motivo</Label><Input id="dw-susp-motivo" value={suspensaoMotivo} onChange={(e) => setSuspensaoMotivo(e.target.value)} placeholder="Ex.: inadimplência, revisão de contrato…" /></div></div>}
            {(statusContrato === "negativado" || statusContrato === "cancelado") && <div className="mt-2.5"><Label htmlFor="dw-status-motivo">Motivo (opcional)</Label><Input id="dw-status-motivo" value={suspensaoMotivo} onChange={(e) => setSuspensaoMotivo(e.target.value)} /></div>}
            <div className="mt-2.5 flex items-center justify-between gap-2"><p className="text-[0.56rem] text-slate-500 dark:text-slate-400">Suspender bloqueia o app da cliente; o Financeiro continua podendo administrar o contrato.</p><Button type="button" size="sm" loading={salvandoStatus} disabled={statusContrato === cliente?.status_contrato} onClick={salvarStatusContrato}>Aplicar</Button></div>
          </section>}

          <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.025]"><div className="mb-2 flex items-center gap-2"><FileText className="h-3.5 w-3.5 text-rose" /><h3 className="text-[0.62rem] font-semibold uppercase tracking-[0.15em] text-rose">Observações internas</h3></div><Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Observações internas..." rows={3} /></section>

          {editando && <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.025]">
            <div className="mb-2.5 flex items-center gap-2"><History className="h-3.5 w-3.5 text-rose" /><h3 className="text-[0.62rem] font-semibold uppercase tracking-[0.15em] text-rose">Histórico operacional</h3></div>
            {historico.length === 0 ? <p className="text-[0.62rem] text-slate-500 dark:text-slate-400">Nenhum evento registrado ainda.</p> : <div className="max-h-52 space-y-1.5 overflow-y-auto">{historico.slice(0, 30).map((h) => <div key={h.id} className="flex items-start gap-2 text-[0.6rem] text-slate-600 dark:text-slate-400"><Clock className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" /><span><span className="font-semibold text-slate-800 dark:text-slate-200">{h.acao.replace(/_/g, " ")}</span> · {new Date(h.created_at).toLocaleString("pt-BR")}</span></div>)}</div>}
          </section>}
        </form> : <div className="space-y-2.5">
          {carregandoFin ? <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">Carregando financeiro...</div> : <>
            <section className="rounded-xl border border-rose/20 bg-gradient-to-b from-rose/[0.07] to-white/[0.02] p-3 dark:border-rose/20 dark:from-rose/[0.08] dark:to-white/[0.015]">
              <div className="mb-2.5 flex items-center justify-between gap-2"><div className="flex items-center gap-2"><WalletCards className="h-3.5 w-3.5 text-rose" /><h3 className="text-[0.62rem] font-semibold uppercase tracking-[0.15em] text-rose">Plano financeiro</h3></div>{boletos.length > 0 && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[0.52rem] font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">{pagas}/{boletos.length} pagas</span>}</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5"><div><Label htmlFor="dw-quantidade">Plano</Label><Select id="dw-quantidade" value={String(quantidade)} onChange={(e) => atualizarQuantidade(e.target.value)}><option value="">Selecione</option>{QUANTIDADE_PARCELAS_OPCOES.map((q) => <option key={q} value={q}>{q}x</option>)}</Select></div><ValueBadge label="Taxa adm." value={taxa} suffix="%" onChange={atualizarTaxa} /><ValueBadge label="Carta de crédito" value={carta} onChange={atualizarCarta} tone="green" /><ValueBadge label="Valor da parcela" value={parcela} onChange={atualizarParcela} tone="gold" /><ValueBadge label="Valor total" value={total} onChange={atualizarTotal} tone="rose" /></div>
              {boletos.length === 0 && <div className="mt-2.5 rounded-xl border border-amber-300/20 bg-amber-50 px-3 py-2 dark:bg-amber-300/[0.07]"><div className="flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-200" /><span className="text-[0.55rem] font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-100/80">1º vencimento</span></div><Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className="mt-1.5 !h-8 !px-2.5" /></div>}
              <Button type="button" size="sm" className="mt-2.5 w-full" loading={salvandoFin} onClick={gerarOuAjustarParcelas}>{boletos.length === 0 ? "Criar financeiro" : ajustando ? "Salvar ajuste de parcelas" : "Ajustar parcelamento"}</Button>
            </section>

            {boletos.length > 0 && <section className="space-y-1.5">
              <p className="text-[0.58rem] font-semibold uppercase tracking-label text-rose">Parcelas e comprovantes</p>
              {visiveis.map((b) => <div key={b.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-white/8 dark:bg-white/[0.02]"><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Parcela {b.numero_parcela}/{b.total_parcelas}</p><p className="text-[0.58rem] text-slate-600 dark:text-slate-400">{b.data_vencimento ? new Date(`${b.data_vencimento}T12:00:00`).toLocaleDateString("pt-BR") : "—"} · R$ {moeda(Number(b.valor || 0))}</p><p className="text-[0.55rem] text-slate-500 dark:text-slate-400">{STATUS_BOLETO_LABEL[b.status] ?? b.status}{b.comprovante_url ? " · comprovante anexado" : ""}</p></div>{b.comprovante_url && <a href={b.comprovante_url} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:text-slate-900 dark:border-white/10 dark:text-slate-400" aria-label="Abrir comprovante"><Paperclip className="h-3.5 w-3.5" /></a>}{b.comprovante_url && <button type="button" onClick={() => rejeitar(b)} disabled={rejeitando === b.id} className="rounded-lg border border-alert/20 bg-alert dark:bg-[#C7869B]/5 p-2 text-alert dark:text-[#DCA0B2] disabled:opacity-50" aria-label="Rejeitar comprovante"><X className="h-3.5 w-3.5" /></button>}</div>)}
              {boletos.length > 8 && <button type="button" onClick={() => setMostrarTodas((v) => !v)} className="w-full rounded-lg border border-slate-200 py-2 text-[0.6rem] font-semibold text-slate-600 hover:bg-slate-50 dark:border-white/8 dark:text-slate-400">{mostrarTodas ? "Mostrar menos" : `Mostrar todas as ${boletos.length} parcelas`}</button>}
            </section>}

            <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.025]">
              <div className="mb-2.5 flex items-center gap-2"><Landmark className="h-3.5 w-3.5 text-rose" /><h3 className="text-[0.62rem] font-semibold uppercase tracking-[0.15em] text-rose">Carnês</h3></div>
              {carnes.length === 0 ? <p className="text-[0.62rem] text-slate-500 dark:text-slate-400">Nenhum carnê registrado ainda.</p> : <div className="space-y-1.5">{carnes.map((c) => <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[0.62rem] dark:border-white/8 dark:bg-white/[0.02]"><span className="font-semibold text-slate-800 dark:text-slate-200">{c.instituicao_financeira} · {c.identificador_externo}</span><span className="text-slate-500 dark:text-slate-400">{c.quantidade_parcelas}x · {moeda(c.valor_total)}</span></div>)}</div>}
              <form onSubmit={criarCarne} className="mt-2.5 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-white/8 dark:bg-white/[0.02] sm:grid-cols-4">
                <Input placeholder="Instituição (ex.: BRB)" value={novoCarneBanco} onChange={(e) => setNovoCarneBanco(e.target.value)} />
                <Input placeholder="Identificador do carnê" value={novoCarneIdentificador} onChange={(e) => setNovoCarneIdentificador(e.target.value)} />
                <Input type="date" value={novoCarneData} onChange={(e) => setNovoCarneData(e.target.value)} />
                <Button type="submit" size="sm" variant="secondary" loading={criandoCarne}>Registrar carnê</Button>
              </form>
              <label className="mt-2.5 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-rose/30 bg-rose/5 px-3 py-2.5 text-[0.62rem] font-semibold text-rose hover:bg-rose/10">
                <FileUp className="h-3.5 w-3.5" /> {importando ? "Importando…" : "Importar carnê em PDF"}
                <input type="file" accept="application/pdf" className="hidden" disabled={importando || !novoCarneBanco} onChange={(e) => { const arquivo = e.target.files?.[0]; if (arquivo) void importarCarne(arquivo, novoCarneBanco || carnes[0]?.instituicao_financeira || "Não informado"); e.target.value = ""; }} />
              </label>
              {pendentesRevisao.length > 0 && <div className="mt-2.5 space-y-1.5">
                <p className="text-[0.58rem] font-semibold uppercase tracking-label text-amber-700 dark:text-amber-200">Páginas para confirmar/revisar</p>
                {pendentesRevisao.map((i) => <div key={i.id} className="flex items-center justify-between gap-2 rounded-lg border border-amber-300/25 bg-amber-50 px-2.5 py-2 text-[0.62rem] dark:bg-amber-300/[0.06]">
                  <span>{i.numero_parcela ? `Parcela ${i.numero_parcela}` : "Parcela não identificada"} · {i.status_vinculacao === "revisar" ? "revisar manualmente" : `confiança ${i.nivel_confianca ?? "—"}`}</span>
                  <span className="flex gap-1.5">
                    {i.boleto_sugerido_id && <button type="button" onClick={() => vincularImportacao(i)} className="rounded-md bg-success/15 px-2 py-1 font-semibold text-success">Vincular</button>}
                    <button type="button" onClick={() => ignorarImportacao(i.id)} className="rounded-md bg-slate-200 px-2 py-1 font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">Ignorar</button>
                  </span>
                </div>)}
              </div>}
            </section>
          </>}
        </div>}
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-1.5 border-t border-slate-200 px-3.5 py-3 dark:border-white/10">
        <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>
        {aba === "perfil" && <Button type="submit" form="drawer-perfil-form" loading={salvandoPerfil}><Check className="h-3.5 w-3.5" /> Salvar</Button>}
      </footer>

      {confirmarExclusao && <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-[0_24px_70px_-24px_rgba(0,0,0,.35)] dark:border-white/10 dark:bg-[#1C1D23] dark:text-slate-100"><div className="flex items-center gap-2 text-alert dark:text-[#DCA0B2]"><Trash2 className="h-4 w-4" /><p className="text-sm font-semibold">Excluir cliente?</p></div><p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">Esta ação remove o perfil da cliente e os dados associados. Não remove o cadastro no CRM. Deseja continuar?</p><div className="mt-4 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setConfirmarExclusao(false)}>Cancelar</Button><Button type="button" loading={excluindo} onClick={excluirCliente} className="!bg-alert dark:bg-[#C7869B]">Excluir</Button></div></div></div>}
    </aside>
  </>;
}
