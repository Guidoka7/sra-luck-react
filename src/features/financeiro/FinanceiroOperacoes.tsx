import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, BriefcaseBusiness, CalendarDays, CheckCircle2, ExternalLink, FileUp, History, Loader2, Pencil, ReceiptText, RotateCcw, ShieldCheck, Trash2, UserRound, WalletCards, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Textarea } from "@/components/ui/Input";
import { Portal } from "@/components/ui/Portal";
import { formatarCpf } from "@/lib/cpf";
import { formatarMoeda } from "@/lib/utils";
import { financeiroApi } from "./financeiroApi";
import type { ClienteFinanceiro, DetalheRecebivel, Recebivel } from "./types";

function Dialog({ title, eyebrow, children, onClose, wide = false }: { title: string; eyebrow: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label={title} className={`max-h-[94vh] w-full overflow-y-auto rounded-2xl border border-rose/15 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-[#171519] ${wide ? "max-w-3xl" : "max-w-lg"}`}>
      <header className="flex items-start justify-between gap-4"><div><p className="text-[9px] font-bold uppercase tracking-[.2em] text-rose">{eyebrow}</p><h2 className="mt-1 text-lg font-semibold text-burgundy dark:text-cream">{title}</h2></div><button type="button" onClick={onClose} aria-label="Fechar" className="rounded-full p-2 text-clay/50 hover:bg-blush dark:text-white/50 dark:hover:bg-white/8"><X className="h-4 w-4" /></button></header>
      {children}
    </section>
  </div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <div><Label>{label}</Label>{children}</div>; }

export function BaixaManualModal({ recebivel, onClose, onSuccess }: { recebivel: Recebivel; onClose: () => void; onSuccess: () => void }) {
  const [dataPagamento, setDataPagamento] = useState(() => new Date().toISOString().slice(0, 10));
  const [juros, setJuros] = useState("0"); const [multa, setMulta] = useState("0"); const [desconto, setDesconto] = useState("0");
  const [formaPagamento, setFormaPagamento] = useState("pix"); const [instituicaoConta, setInstituicaoConta] = useState(""); const [observacao, setObservacao] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null); const [enviando, setEnviando] = useState(false); const [erro, setErro] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const total = useMemo(() => Math.max(0, recebivel.valorOriginal + Number(juros || 0) + Number(multa || 0) - Number(desconto || 0)), [recebivel.valorOriginal, juros, multa, desconto]);

  async function salvar(event: FormEvent) {
    event.preventDefault(); setEnviando(true); setErro("");
    try {
      if (arquivo) await financeiroApi.anexarComprovante(recebivel.id, arquivo);
      await financeiroApi.baixa(recebivel.id, { dataPagamento, juros: Number(juros), multa: Number(multa), desconto: Number(desconto), formaPagamento, instituicaoConta, observacao, idempotencyKey });
      onSuccess();
    } catch (error) { setErro(error instanceof Error ? error.message : "Falha ao registrar a baixa."); } finally { setEnviando(false); }
  }

  return <Dialog eyebrow="Liquidação auditável" title={`Baixa manual · parcela ${recebivel.numeroParcela}/${recebivel.totalParcelas}`} onClose={onClose} wide>
    <form onSubmit={salvar} className="mt-5 space-y-4">
      <div className="rounded-xl border border-gold/20 bg-gold/[0.06] p-3 text-xs text-clay/65 dark:text-white/60"><strong className="text-burgundy dark:text-cream">{recebivel.cliente}</strong> · valor original {formatarMoeda(recebivel.valorOriginal)}. O total é validado e calculado novamente no servidor.</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="Data do pagamento"><Input required type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} /></Field><Field label="Valor original"><Input disabled value={recebivel.valorOriginal.toFixed(2)} /></Field><Field label="Juros"><Input min="0" step="0.01" type="number" value={juros} onChange={(e) => setJuros(e.target.value)} /></Field><Field label="Multa"><Input min="0" step="0.01" type="number" value={multa} onChange={(e) => setMulta(e.target.value)} /></Field><Field label="Desconto"><Input min="0" step="0.01" type="number" value={desconto} onChange={(e) => setDesconto(e.target.value)} /></Field><Field label="Recebido final"><Input disabled value={total.toFixed(2)} /></Field><Field label="Forma de pagamento"><Select value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)}><option value="pix">PIX</option><option value="dinheiro">Dinheiro</option><option value="transferencia">Transferência</option><option value="boleto">Boleto</option><option value="cartao">Cartão via terminal/provedor</option><option value="cheque">Cheque</option><option value="outro">Outro</option></Select></Field><Field label="Instituição / conta"><Input value={instituicaoConta} onChange={(e) => setInstituicaoConta(e.target.value)} placeholder="Opcional" /></Field></div>
      <Field label="Observações"><Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Contexto da baixa, divergências ou referência interna" /></Field>
      <Field label="Comprovante opcional"><label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-rose/25 bg-blush/25 p-3 text-xs text-clay/60 hover:bg-blush/45 dark:border-white/12 dark:bg-white/[0.025] dark:text-white/55"><FileUp className="h-4 w-4 text-rose" /><span>{arquivo ? arquivo.name : "Selecionar PDF, JPG, PNG ou WebP (até 8 MB)"}</span><input className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} /></label></Field>
      {erro ? <p role="alert" className="rounded-xl bg-alert/10 p-3 text-xs text-alert">{erro}</p> : null}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={enviando}><ShieldCheck className="h-4 w-4" />Confirmar baixa</Button></div>
    </form>
  </Dialog>;
}

export function ValidacaoModal({ recebivel, onClose, onSuccess }: { recebivel: Recebivel; onClose: () => void; onSuccess: () => void }) {
  const [observacao, setObservacao] = useState(""); const [acao, setAcao] = useState<"confirmar" | "rejeitar" | null>(null); const [erro, setErro] = useState(""); const [enviando, setEnviando] = useState(false); const [idempotencyKey] = useState(() => crypto.randomUUID());
  async function confirmar() {
    if (!acao) return; if (acao === "rejeitar" && !observacao.trim()) { setErro("O motivo da rejeição ou divergência é obrigatório."); return; }
    setErro(""); setEnviando(true);
    try { await financeiroApi.validar(recebivel.id, acao, observacao, idempotencyKey); onSuccess(); } catch (error) { setErro(error instanceof Error ? error.message : "Falha na validação."); } finally { setEnviando(false); setAcao(null); }
  }
  return <Dialog eyebrow="Fila de validação" title={`${recebivel.cliente} · ${recebivel.numeroParcela}/${recebivel.totalParcelas}`} onClose={onClose}>
    <div className="mt-5 space-y-4"><div className="grid grid-cols-2 gap-2 rounded-xl bg-blush/35 p-3 dark:bg-white/[0.035]"><div><p className="text-[9px] uppercase tracking-[.14em] text-clay/45 dark:text-white/38">Valor</p><p className="mt-1 font-semibold text-burgundy dark:text-cream">{formatarMoeda(recebivel.valorOriginal)}</p></div><div><p className="text-[9px] uppercase tracking-[.14em] text-clay/45 dark:text-white/38">Vencimento</p><p className="mt-1 font-semibold text-burgundy dark:text-cream">{recebivel.vencimento?.split("-").reverse().join("/") ?? "—"}</p></div></div>
      {recebivel.comprovante ? <a href={`/api/admin/boletos/${encodeURIComponent(recebivel.id)}/comprovante`} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border border-rose/15 p-3 text-xs font-semibold text-burgundy hover:bg-blush dark:border-white/10 dark:text-cream dark:hover:bg-white/6"><span className="inline-flex items-center gap-2"><ReceiptText className="h-4 w-4" />Abrir comprovante em nova aba</span><ExternalLink className="h-3.5 w-3.5" /></a> : <p className="rounded-xl bg-alert/8 p-3 text-xs text-alert">O registro está pendente, mas não possui caminho de comprovante.</p>}
      <Field label="Observação da validação"><Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Obrigatória em caso de rejeição ou divergência" /></Field>
      {erro ? <p role="alert" className="rounded-xl bg-alert/10 p-3 text-xs text-alert">{erro}</p> : null}
      <div className="grid gap-2 sm:grid-cols-2"><Button type="button" variant="danger" disabled={acao !== null} onClick={() => setAcao("rejeitar")}><AlertTriangle className="h-4 w-4" />Rejeitar</Button><Button type="button" disabled={acao !== null} onClick={() => setAcao("confirmar")}><CheckCircle2 className="h-4 w-4" />Confirmar recebimento</Button></div>
      {acao ? <div className="rounded-xl border border-gold/25 bg-gold/[0.06] p-3"><p className="text-xs text-clay/65 dark:text-white/60">Confirma a ação <strong>{acao}</strong>? Ela será registrada no ledger e na auditoria.</p><div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={enviando} onClick={() => setAcao(null)}>Voltar</Button><Button size="sm" loading={enviando} variant={acao === "rejeitar" ? "danger" : "primary"} onClick={() => void confirmar()}>Confirmar ação</Button></div></div> : null}
    </div>
  </Dialog>;
}

export function EditarRecebivelModal({ recebivel, onClose, onSuccess }: { recebivel: Recebivel; onClose: () => void; onSuccess: () => void }) {
  const [valor, setValor] = useState(String(recebivel.valorOriginal)); const [vencimento, setVencimento] = useState(recebivel.vencimento ?? ""); const [salvando, setSalvando] = useState(false); const [erro, setErro] = useState("");
  async function salvar(event: FormEvent) { event.preventDefault(); setSalvando(true); setErro(""); try { await financeiroApi.alterar(recebivel.id, { acao: "editar", valor: Number(valor), dataVencimento: vencimento || null }); onSuccess(); } catch (error) { setErro(error instanceof Error ? error.message : "Falha ao editar."); } finally { setSalvando(false); } }
  return <Dialog eyebrow="Recebível em aberto" title="Editar valor e vencimento" onClose={onClose}><form onSubmit={salvar} className="mt-5 space-y-4"><Field label="Valor"><Input required min="0.01" step="0.01" type="number" value={valor} onChange={(e) => setValor(e.target.value)} /></Field><Field label="Vencimento"><Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></Field>{erro ? <p role="alert" className="text-xs text-alert">{erro}</p> : null}<div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={salvando}><Pencil className="h-4 w-4" />Salvar</Button></div></form></Dialog>;
}

export function GerarParcelasModal({ clientes, onClose, onSuccess }: { clientes: ClienteFinanceiro[]; onClose: () => void; onSuccess: () => void }) {
  const [clienteId, setClienteId] = useState(""); const [busca, setBusca] = useState(""); const [quantidade, setQuantidade] = useState("1"); const [valor, setValor] = useState(""); const [vencimento, setVencimento] = useState(""); const [salvando, setSalvando] = useState(false); const [erro, setErro] = useState("");
  const filtrados = clientes.filter((cliente) => `${cliente.nome_completo} ${cliente.cpf ?? ""}`.toLocaleLowerCase("pt-BR").includes(busca.toLocaleLowerCase("pt-BR"))).slice(0, 30);
  async function salvar(event: FormEvent) { event.preventDefault(); if (!clienteId) { setErro("Selecione uma cliente."); return; } setSalvando(true); setErro(""); try { await financeiroApi.gerarParcelas(clienteId, { quantidade: Number(quantidade), valorParcela: valor ? Number(valor) : undefined, primeiroVencimento: vencimento || undefined }); onSuccess(); } catch (error) { setErro(error instanceof Error ? error.message : "Falha ao gerar parcelas."); } finally { setSalvando(false); } }
  return <Dialog eyebrow="Função migrada de Parcelas" title="Adicionar parcelas ao contrato" onClose={onClose} wide><form onSubmit={salvar} className="mt-5 space-y-4"><Field label="Buscar cliente"><Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou CPF" /></Field><Field label="Cliente"><Select required value={clienteId} onChange={(e) => setClienteId(e.target.value)}><option value="">Selecione</option>{filtrados.map((cliente) => <option key={cliente.id} value={cliente.id}>{cliente.nome_completo}{cliente.cpf ? ` · ${cliente.cpf}` : ""}</option>)}</Select></Field><div className="grid gap-3 sm:grid-cols-3"><Field label="Quantidade"><Input required min="1" max="240" type="number" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} /></Field><Field label="Valor por parcela"><Input min="0.01" step="0.01" type="number" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Cálculo automático" /></Field><Field label="Primeiro vencimento"><Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></Field></div><p className="text-[10px] leading-4 text-clay/50 dark:text-white/42">As parcelas são acrescentadas pelo fluxo existente; nenhum provedor externo será acionado.</p>{erro ? <p role="alert" className="rounded-xl bg-alert/10 p-3 text-xs text-alert">{erro}</p> : null}<div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={salvando}>Gerar parcelas</Button></div></form></Dialog>;
}

const STATUS_RECEBIVEL: Record<string, { label: string; classe: string }> = {
  nao_pago: { label: "Em aberto", classe: "bg-slate-100 text-slate-600 dark:bg-white/8 dark:text-white/65" },
  pago: { label: "Pago", classe: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300" },
  pendente_confirmacao: { label: "Em validação", classe: "bg-amber-100 text-amber-700 dark:bg-amber-500/12 dark:text-amber-300" },
  rejeitado: { label: "Rejeitado", classe: "bg-rose-100 text-rose-700 dark:bg-rose-500/12 dark:text-rose-300" },
  suspensa: { label: "Suspensa", classe: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/12 dark:text-indigo-300" },
  vencido: { label: "Vencido", classe: "bg-red-100 text-red-700 dark:bg-red-500/12 dark:text-red-300" },
};

function dataBr(value: string | null) {
  return value ? value.split("-").reverse().join("/") : "Não informado";
}

function textoLegivel(value: string | null) {
  return value ? value.replaceAll("_", " ") : "Não informado";
}

function Dado({ label, value, destaque = false }: { label: string; value: ReactNode; destaque?: boolean }) {
  return <div className="min-w-0">
    <dt className="text-[9px] font-bold uppercase tracking-[.13em] text-clay/42 dark:text-white/36">{label}</dt>
    <dd className={`mt-1 truncate text-xs ${destaque ? "font-semibold text-burgundy dark:text-cream" : "text-clay/72 dark:text-white/65"}`}>{value}</dd>
  </div>;
}

export function RecebivelDrawer({ id, onClose, onAction, onUpdated }: { id: string; onClose: () => void; onAction: (action: "baixa" | "editar" | "validar", item: Recebivel) => void; onUpdated: () => void }) {
  const [detalhe, setDetalhe] = useState<DetalheRecebivel | null>(null); const [erro, setErro] = useState(""); const [ocupado, setOcupado] = useState(false); const [observacao, setObservacao] = useState("");
  useEffect(() => {
    let ativo = true; setDetalhe(null); setErro("");
    financeiroApi.detalhe(id).then((data) => { if (ativo) setDetalhe(data); }).catch((error) => { if (ativo) setErro(error instanceof Error ? error.message : "Falha ao carregar detalhes."); });
    return () => { ativo = false; };
  }, [id]);
  useEffect(() => {
    const overflowAnterior = document.body.style.overflow;
    const fecharComEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", fecharComEscape);
    return () => { document.body.style.overflow = overflowAnterior; window.removeEventListener("keydown", fecharComEscape); };
  }, [onClose]);
  async function alterar(acao: "suspender" | "reabrir" | "excluir" | "observar") {
    if (acao === "excluir" && !window.confirm("Excluir esta parcela em aberto? Esta ação não pode ser desfeita.")) return;
    setOcupado(true); setErro(""); try { await financeiroApi.alterar(id, { acao, observacao }); onUpdated(); if (acao === "excluir") onClose(); else setDetalhe(await financeiroApi.detalhe(id)); } catch (error) { setErro(error instanceof Error ? error.message : "Falha na operação."); } finally { setOcupado(false); }
  }
  const recebivel = detalhe?.recebivel;
  const status = recebivel ? STATUS_RECEBIVEL[recebivel.status] ?? { label: textoLegivel(recebivel.status), classe: "bg-slate-100 text-slate-600 dark:bg-white/8 dark:text-white/65" } : null;

  return <Portal><div className="fixed inset-0 z-[110] bg-[#241015]/55 backdrop-blur-[3px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside role="dialog" aria-modal="true" aria-labelledby="recebivel-drawer-title" className="fixed inset-y-0 right-0 flex w-full max-w-[460px] flex-col overflow-hidden border-l border-[#ead9da] bg-[#fffaf8] text-clay shadow-[-24px_0_70px_-30px_rgba(31,12,17,.55)] dark:border-white/10 dark:bg-[#171316] dark:text-[#e7dedd]">
      <header className="shrink-0 border-b border-rose/10 bg-white px-4 py-4 dark:border-white/8 dark:bg-[#1d181c]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[.2em] text-rose">Conta a receber</p><h2 id="recebivel-drawer-title" className="mt-1 truncate text-lg font-semibold text-burgundy dark:text-cream">{recebivel?.cliente ?? "Carregando detalhes…"}</h2>{recebivel ? <p className="mt-1 text-[10px] text-clay/48 dark:text-white/42">{recebivel.cpf ? formatarCpf(recebivel.cpf) : "CPF não informado"} · parcela {recebivel.numeroParcela}/{recebivel.totalParcelas}</p> : null}</div>
          <div className="flex shrink-0 items-center gap-2">{status ? <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.1em] ${status.classe}`}>{status.label}</span> : null}<button type="button" onClick={onClose} aria-label="Fechar detalhes" className="grid h-8 w-8 place-items-center rounded-full border border-rose/10 text-clay/55 transition hover:bg-blush hover:text-burgundy dark:border-white/10 dark:text-white/55 dark:hover:bg-white/8 dark:hover:text-cream"><X className="h-4 w-4" /></button></div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain bg-[#f8f3f1] px-4 py-4 dark:bg-[#121012]">
        {!detalhe && !erro ? <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-xs text-clay/45 dark:text-white/40"><Loader2 className="h-5 w-5 animate-spin text-rose" />Carregando dados financeiros</div> : null}
        {erro ? <p role="alert" className="rounded-xl border border-alert/15 bg-alert/[0.07] p-3 text-xs text-alert">{erro}</p> : null}
        {recebivel ? <div className="space-y-3">
          <section className="overflow-hidden rounded-2xl border border-rose/10 bg-white shadow-[0_12px_35px_-30px_rgba(72,24,35,.45)] dark:border-white/8 dark:bg-[#1d191d]">
            <div className="border-b border-rose/8 px-4 py-3 dark:border-white/7"><p className="text-[9px] font-bold uppercase tracking-[.14em] text-clay/42 dark:text-white/36">Valor esperado</p><div className="mt-1 flex items-end justify-between gap-3"><strong className="text-2xl font-semibold tracking-tight text-burgundy dark:text-cream">{formatarMoeda(recebivel.valorEsperado)}</strong>{recebivel.valorRecebido !== null ? <span className="pb-0.5 text-[10px] font-semibold text-success">Recebido {formatarMoeda(recebivel.valorRecebido)}</span> : null}</div></div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3"><Dado label="Valor original" value={formatarMoeda(recebivel.valorOriginal)} destaque /><Dado label="Vencimento" value={dataBr(recebivel.vencimento)} destaque /><Dado label="Juros + multa" value={formatarMoeda(recebivel.juros + recebivel.multa)} /><Dado label="Desconto" value={formatarMoeda(recebivel.desconto)} /></dl>
          </section>

          <section className="rounded-2xl border border-rose/10 bg-white p-4 dark:border-white/8 dark:bg-[#1d191d]">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-burgundy dark:text-cream"><BriefcaseBusiness className="h-4 w-4 text-rose" />Contrato e responsável</h3>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3"><Dado label="Vendedora do contrato" value={recebivel.vendedora ?? "Não informada no cadastro"} destaque /><Dado label="Parcela" value={`${recebivel.numeroParcela} de ${recebivel.totalParcelas}`} /><Dado label="Cliente" value={recebivel.cliente} /><Dado label="CPF" value={recebivel.cpf ? formatarCpf(recebivel.cpf) : "Não informado"} /></dl>
          </section>

          <section className="rounded-2xl border border-rose/10 bg-white p-4 dark:border-white/8 dark:bg-[#1d191d]">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-burgundy dark:text-cream"><WalletCards className="h-4 w-4 text-rose" />Pagamento</h3>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3"><Dado label="Data do pagamento" value={dataBr(recebivel.dataPagamento)} /><Dado label="Forma" value={<span className="capitalize">{textoLegivel(recebivel.formaPagamento)}</span>} /><Dado label="Origem" value={<span className="capitalize">{textoLegivel(recebivel.origem)}</span>} /><Dado label="Instituição" value={recebivel.instituicaoConta ?? "Não informada"} /></dl>
            {recebivel.comprovante ? <a href={`/api/admin/boletos/${encodeURIComponent(recebivel.id)}/comprovante`} target="_blank" rel="noreferrer" className="mt-3 flex items-center justify-between rounded-xl border border-rose/12 bg-blush/35 px-3 py-2.5 text-[10px] font-bold uppercase tracking-[.08em] text-burgundy transition hover:bg-blush dark:border-white/8 dark:bg-white/[0.035] dark:text-cream dark:hover:bg-white/[0.065]"><span className="inline-flex items-center gap-2"><ReceiptText className="h-4 w-4 text-rose" />Abrir comprovante</span><ExternalLink className="h-3.5 w-3.5" /></a> : null}
          </section>

          <section className="rounded-2xl border border-rose/10 bg-white p-4 dark:border-white/8 dark:bg-[#1d191d]">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-burgundy dark:text-cream"><UserRound className="h-4 w-4 text-rose" />Observações</h3>
            {recebivel.observacoes ? <p className="mt-3 rounded-xl bg-blush/35 px-3 py-2.5 text-xs leading-5 text-clay/70 dark:bg-white/[0.035] dark:text-white/62">{recebivel.observacoes}</p> : <p className="mt-2 text-[10px] text-clay/42 dark:text-white/36">Nenhuma observação registrada.</p>}
            <Textarea className="mt-3 min-h-[74px] bg-[#fffdfc] text-xs dark:bg-[#171417]" value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Adicionar contexto financeiro" />
            <Button className="mt-2 h-8 px-3 text-[9px]" size="sm" variant="secondary" disabled={!observacao.trim() || ocupado} onClick={() => void alterar("observar")}>Registrar observação</Button>
          </section>

          <section className="rounded-2xl border border-rose/10 bg-white p-4 dark:border-white/8 dark:bg-[#1d191d]">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-burgundy dark:text-cream"><ReceiptText className="h-4 w-4 text-rose" />Recebimentos <span className="ml-auto rounded-full bg-blush px-2 py-0.5 text-[9px] text-clay/55 dark:bg-white/7 dark:text-white/45">{detalhe.recebimentos.length}</span></h3>
            <div className="mt-3 space-y-2">{detalhe.recebimentos.length ? detalhe.recebimentos.map((rec) => <div key={rec.id} className="rounded-xl border border-rose/8 bg-[#fffaf8] p-3 text-xs dark:border-white/7 dark:bg-[#171417]"><div className="flex items-center justify-between gap-3"><strong className="capitalize text-burgundy dark:text-cream">{textoLegivel(rec.status_validacao)}</strong><span className="font-semibold text-burgundy dark:text-cream">{formatarMoeda(Number(rec.valor_recebido))}</span></div><p className="mt-1.5 text-[10px] leading-4 text-clay/48 dark:text-white/40">{textoLegivel(rec.origem)} · {dataBr(rec.data_pagamento)}<br />Registrado por {rec.validado_por ?? rec.criado_por}</p></div>) : <p className="text-xs text-clay/45 dark:text-white/38">Nenhum lançamento no ledger.</p>}</div>
          </section>

          <section className="rounded-2xl border border-rose/10 bg-white p-4 dark:border-white/8 dark:bg-[#1d191d]">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-burgundy dark:text-cream"><History className="h-4 w-4 text-rose" />Histórico e auditoria <span className="ml-auto rounded-full bg-blush px-2 py-0.5 text-[9px] text-clay/55 dark:bg-white/7 dark:text-white/45">{detalhe.historico.length}</span></h3>
            <div className="mt-3 space-y-3">{detalhe.historico.length ? detalhe.historico.map((log) => <div key={log.id} className="relative border-l border-rose/25 pl-3 before:absolute before:-left-[3px] before:top-1 before:h-[5px] before:w-[5px] before:rounded-full before:bg-rose"><p className="text-xs font-medium capitalize text-burgundy dark:text-cream">{textoLegivel(log.acao)}</p><p className="mt-0.5 text-[10px] text-clay/45 dark:text-white/38">{new Date(log.created_at).toLocaleString("pt-BR")} · {log.usuario}</p></div>) : <p className="text-xs text-clay/45 dark:text-white/38">Sem eventos de auditoria.</p>}</div>
          </section>

          <section className="rounded-xl border border-dashed border-gold/30 bg-gold/[0.05] px-3 py-2.5 text-[10px] leading-4 text-clay/55 dark:text-white/45"><p className="flex items-center gap-2 font-semibold text-burgundy dark:text-cream"><CalendarDays className="h-3.5 w-3.5 text-gold" />Referência técnica</p><p className="mt-1">ID externo: {recebivel.externalId ?? "não disponível"}. Referência: {recebivel.externalReference ?? "não disponível"}.</p></section>
        </div> : null}
      </div>

      {recebivel ? <footer className="shrink-0 border-t border-rose/10 bg-white px-4 py-3 dark:border-white/8 dark:bg-[#1d181c]">
        <p className="mb-2 text-[9px] font-bold uppercase tracking-[.14em] text-clay/40 dark:text-white/34">Ações da parcela</p>
        <div className="flex flex-wrap gap-2">{recebivel.status === "pendente_confirmacao" ? <Button className="h-8 px-3 text-[9px]" size="sm" onClick={() => onAction("validar", recebivel)}>Validar comprovante</Button> : null}{!["pago", "pendente_confirmacao", "suspensa"].includes(recebivel.status) ? <Button className="h-8 px-3 text-[9px]" size="sm" onClick={() => onAction("baixa", recebivel)}>Baixa manual</Button> : null}{!["pago", "pendente_confirmacao"].includes(recebivel.status) ? <Button className="h-8 px-3 text-[9px] dark:border-white/10 dark:bg-white/[0.04] dark:text-cream" size="sm" variant="secondary" onClick={() => onAction("editar", recebivel)}>Editar</Button> : null}{!recebivel.suspensa && recebivel.status !== "pago" ? <Button className="h-8 px-3 text-[9px] dark:border-white/10 dark:bg-white/[0.04] dark:text-cream" size="sm" variant="secondary" disabled={ocupado} onClick={() => void alterar("suspender")}>Suspender</Button> : null}{recebivel.suspensa || recebivel.status === "rejeitado" ? <Button className="h-8 px-3 text-[9px] dark:border-white/10 dark:bg-white/[0.04] dark:text-cream" size="sm" variant="secondary" disabled={ocupado} onClick={() => void alterar("reabrir")}><RotateCcw className="h-3.5 w-3.5" />Reabrir</Button> : null}{recebivel.status !== "pago" ? <Button className="h-8 px-3 text-[9px]" size="sm" variant="danger" disabled={ocupado} onClick={() => void alterar("excluir")}><Trash2 className="h-3.5 w-3.5" />Excluir</Button> : null}</div>
      </footer> : null}
    </aside>
  </div></Portal>;
}
