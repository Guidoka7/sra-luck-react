"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CalendarDays, Check, IdCard, Paperclip, Receipt, UserRound, WalletCards, X } from "lucide-react";
import { toast } from "sonner";
import { Portal } from "@/components/ui/Portal";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Textarea } from "@/components/ui/Input";
import { formatarCpf } from "@/lib/cpf";
import { desmascararMoeda, formatarMoeda, mascararMoedaInput } from "@/lib/utils";
import type { Boleto, Cliente, QuantidadeParcelas } from "@/types/database";
import { QUANTIDADE_PARCELAS_OPCOES, STATUS_BOLETO_LABEL, TAXA_ADMINISTRATIVA_PADRAO } from "@/types/database";

function moeda(v: number) { return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function dataBr(v: string | null) { return v ? v.split("-").reverse().join("/") : "—"; }

export function ModalClienteCompactoV2({ cliente, onClose, onSalvo }: { cliente: Cliente | null; onClose: () => void; onSalvo: () => void }) {
  const editando = Boolean(cliente);
  const [aba, setAba] = useState<"dados" | "boletos">(cliente ? "boletos" : "dados");
  const [nome, setNome] = useState(cliente?.nome_completo ?? "");
  const [cpf, setCpf] = useState(cliente ? formatarCpf(cliente.cpf) : "");
  const [nascimento, setNascimento] = useState(cliente?.data_nascimento ?? "");
  const [telefone, setTelefone] = useState(cliente?.telefone ?? "");
  const [email, setEmail] = useState(cliente?.email ?? "");
  const [procedimento, setProcedimento] = useState(cliente?.procedimento ?? "");
  const [carta, setCarta] = useState(cliente ? moeda(cliente.valor_contrato) : "");
  const [quantidade, setQuantidade] = useState<QuantidadeParcelas>((cliente?.quantidade_parcelas ?? 12) as QuantidadeParcelas);
  const [taxa, setTaxa] = useState(cliente?.taxa_administrativa_percentual != null ? String(cliente.taxa_administrativa_percentual).replace(".", ",") : String(TAXA_ADMINISTRATIVA_PADRAO[(cliente?.quantidade_parcelas ?? 12) as QuantidadeParcelas]).replace(".", ","));
  const [vencimento, setVencimento] = useState("");
  const [observacoes, setObservacoes] = useState(cliente?.observacoes_internas ?? "");
  const [ativo, setAtivo] = useState(cliente?.ativo ?? true);
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [carregando, setCarregando] = useState(Boolean(cliente));
  const [salvando, setSalvando] = useState(false);
  const [ajustando, setAjustando] = useState(false);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [mostrarTodas, setMostrarTodas] = useState(false);

  const cartaNumero = Number(desmascararMoeda(carta)) || 0;
  const taxaNumero = Number(taxa.replace(",", ".")) || 0;
  const custoTotal = cartaNumero * (1 + taxaNumero / 100);
  const parcelaSugerida = quantidade ? custoTotal / quantidade : 0;
  const pagas = boletos.filter((b) => b.status === "pago").length;
  const visiveis = mostrarTodas ? boletos : boletos.slice(0, 8);

  async function carregarBoletos() {
    if (!cliente?.id) return;
    setCarregando(true);
    try {
      const res = await fetch(`/api/admin/clientes/${cliente.id}/boletos`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? "Não foi possível carregar os boletos.");
      setBoletos(data.boletos ?? []);
      if (data.boletos?.[0]?.total_parcelas) setQuantidade(Number(data.boletos[0].total_parcelas) as QuantidadeParcelas);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível carregar os boletos."); }
    finally { setCarregando(false); }
  }

  useEffect(() => { carregarBoletos(); }, [cliente?.id]);

  async function salvarPerfil(e: FormEvent) {
    e.preventDefault();
    if (!nome || !nascimento || cartaNumero <= 0) return void toast.error("Preencha nome, nascimento e carta de crédito.");
    if (!editando && !vencimento) return void toast.error("Informe o 1º vencimento para gerar as parcelas.");
    setSalvando(true);
    try {
      const res = await fetch(editando ? `/api/admin/clientes/${cliente!.id}` : "/api/admin/clientes", { method: editando ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nomeCompleto: nome, cpf, dataNascimento: nascimento, telefone, email, procedimento, valorContrato: cartaNumero, taxaAdministrativaPercentual: taxaNumero, ativo, observacoes, recalcularBoletosAbertos: true }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? "Não foi possível salvar.");
      if (!editando && data.cliente?.id) {
        const gerar = await fetch(`/api/admin/clientes/${data.cliente.id}/boletos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantidadeParcelas: quantidade, taxaPercentual: taxaNumero, primeiroVencimento: vencimento }) });
        if (!gerar.ok) { const d = await gerar.json(); throw new Error(d.erro ?? "Cliente criada, mas não foi possível gerar as parcelas."); }
      }
      toast.success(editando ? "Dados da cliente atualizados." : "Cliente cadastrada."); onSalvo(); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setSalvando(false); }
  }

  async function ajustarParcelamento() {
    if (!cliente) return;
    setAjustando(true);
    try {
      const res = await fetch(`/api/admin/clientes/${cliente.id}/boletos`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantidadeParcelas: quantidade, taxaPercentual: taxaNumero, recalcularAbertas: true, primeiroVencimento: vencimento || undefined }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? "Não foi possível ajustar o parcelamento.");
      setBoletos(data.boletos ?? []); toast.success("Parcelamento atualizado.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao ajustar parcelas."); }
    finally { setAjustando(false); }
  }

  async function avaliarComprovante(boleto: Boleto, acao: "confirmar" | "rejeitar") {
    if (!boleto.comprovante_url) return;
    const rejeitar = acao === "rejeitar";
    const pergunta = rejeitar ? `Rejeitar o comprovante da parcela ${boleto.numero_parcela}/${boleto.total_parcelas}? A parcela voltará para Em aberto.` : `Aprovar o comprovante da parcela ${boleto.numero_parcela}/${boleto.total_parcelas}? O pagamento será confirmado.`;
    if (!window.confirm(pergunta)) return;
    setEnviando(boleto.id);
    try {
      const res = await fetch(`/api/admin/boletos/${boleto.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao, observacoes: rejeitar ? "Comprovante rejeitado pelo administrador." : "Comprovante aprovado pelo administrador." }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? `Não foi possível ${rejeitar ? "rejeitar" : "aprovar"} o comprovante.`);
      setBoletos((prev) => prev.map((b) => b.id === boleto.id ? { ...b, status: rejeitar ? "nao_pago" : "pago", data_pagamento: rejeitar ? null : new Date().toISOString().slice(0, 10) } : b));
      toast.success(rejeitar ? "Comprovante rejeitado. A parcela voltou para Em aberto." : "Comprovante aprovado. Pagamento confirmado.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível processar o comprovante."); }
    finally { setEnviando(null); }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-burgundy-dark/55 px-2 py-2.5 backdrop-blur-md sm:px-4 sm:py-4">
        <div className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-rose/15 bg-white text-burgundy shadow-2xl dark:border-white/10 dark:bg-[#1b181b] dark:text-pearl">
          <header className="flex shrink-0 items-center justify-between border-b border-rose/10 px-3.5 py-3 sm:px-4 dark:border-white/10">
            <div className="flex min-w-0 items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose/15 text-rose"><UserRound className="h-4 w-4" /></span><div className="min-w-0"><p className="truncate font-heading text-base font-semibold text-burgundy dark:text-rose">{nome || "Nova cliente"}</p><p className="text-[0.58rem] uppercase tracking-[0.15em] text-burgundy/40 dark:text-pearl/35">{editando ? "Perfil compacto" : "Cadastro rápido"}</p></div></div>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-burgundy/40 hover:bg-blush/60 hover:text-burgundy dark:text-pearl/35 dark:hover:bg-white/5 dark:hover:text-pearl"><X className="h-4 w-4" /></button>
          </header>

          <div className="border-b border-rose/10 bg-blush/25 px-3 py-2 sm:px-4 dark:border-white/8 dark:bg-black/10"><div className="grid grid-cols-2 gap-1 rounded-xl bg-burgundy/[0.04] p-1 dark:bg-white/[0.035]">
            <button type="button" onClick={() => setAba("dados")} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[0.68rem] font-semibold ${aba === "dados" ? "bg-rose text-white shadow-sm" : "text-burgundy/55 hover:bg-blush dark:text-pearl/45 dark:hover:bg-white/5"}`}><IdCard className="h-3.5 w-3.5" /> Dados pessoais</button>
            <button type="button" disabled={!editando} onClick={() => setAba("boletos")} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[0.68rem] font-semibold disabled:opacity-30 ${aba === "boletos" ? "bg-rose text-white shadow-sm" : "text-burgundy/55 hover:bg-blush dark:text-pearl/45 dark:hover:bg-white/5"}`}><Receipt className="h-3.5 w-3.5" /> Boletos {boletos.length > 0 && <span className="rounded-full bg-burgundy/10 px-1.5 py-0.5 text-[0.5rem] dark:bg-white/15">{boletos.length}</span>}</button>
          </div></div>

          <form id="form-cliente-v2" onSubmit={salvarPerfil} className="min-h-0 flex-1 overflow-hidden"><div className="h-full overflow-y-auto p-3 sm:p-4">
            {aba === "dados" ? <div className="space-y-2.5">
              <section className="rounded-xl border border-rose/10 bg-blush/20 p-3 dark:bg-white/[0.025]"><div className="mb-2.5 flex items-center gap-2"><IdCard className="h-3.5 w-3.5 text-rose" /><h3 className="text-[0.62rem] font-semibold uppercase tracking-[0.15em] text-rose">Dados pessoais</h3></div><div className="grid grid-cols-2 gap-2"><div className="col-span-2"><Label htmlFor="v2-nome">Nome completo</Label><Input id="v2-nome" value={nome} onChange={(e) => setNome(e.target.value)} required /></div><div><Label htmlFor="v2-cpf">CPF</Label><Input id="v2-cpf" value={cpf} maxLength={14} disabled={editando} onChange={(e) => setCpf(formatarCpf(e.target.value))} /></div><div><Label htmlFor="v2-nasc">Nascimento</Label><Input id="v2-nasc" type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} required /></div><div><Label htmlFor="v2-tel">Telefone</Label><Input id="v2-tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} /></div><div><Label htmlFor="v2-email">E-mail</Label><Input id="v2-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div><div className="col-span-2"><Label htmlFor="v2-proc">Procedimento</Label><Input id="v2-proc" value={procedimento} onChange={(e) => setProcedimento(e.target.value)} /></div></div></section>
              <section className="rounded-xl border border-rose/10 bg-blush/20 p-3 dark:bg-white/[0.025]"><div className="mb-2 flex items-center gap-2"><WalletCards className="h-3.5 w-3.5 text-rose" /><h3 className="text-[0.62rem] font-semibold uppercase tracking-[0.15em] text-rose">Configuração financeira</h3></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-5"><div><Label>Plano</Label><Select value={String(quantidade)} onChange={(e) => setQuantidade(Number(e.target.value) as QuantidadeParcelas)}>{QUANTIDADE_PARCELAS_OPCOES.map((q) => <option key={q} value={q}>{q}x</option>)}</Select></div><div><Label>Taxa adm.</Label><Input value={taxa} onChange={(e) => setTaxa(e.target.value)} inputMode="decimal" /></div><div><Label>Carta</Label><Input value={carta} onChange={(e) => setCarta(mascararMoedaInput(e.target.value))} /></div><div><Label>Parcela sugerida</Label><div className="flex h-10 items-center rounded-lg border border-rose/10 bg-white px-2.5 text-xs font-semibold text-rose dark:border-white/10 dark:bg-black/10">{formatarMoeda(parcelaSugerida)}</div></div><div><Label>Total com taxa</Label><div className="flex h-10 items-center rounded-lg border border-rose/10 bg-white px-2.5 text-xs font-semibold text-burgundy/80 dark:border-white/10 dark:bg-black/10 dark:text-pearl/80">{formatarMoeda(custoTotal)}</div></div></div><div className="mt-2 grid grid-cols-[1fr_auto] items-end gap-2"><div><Label htmlFor="v2-venc">1º vencimento</Label><Input id="v2-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></div>{editando && <Button type="button" size="sm" variant="secondary" disabled={ajustando} onClick={ajustarParcelamento}><CalendarDays className="h-3.5 w-3.5" /> {ajustando ? "Atualizando" : "Atualizar abertas"}</Button>}</div></section>
              <section className="rounded-xl border border-rose/10 bg-blush/20 p-3 dark:bg-white/[0.025]"><Label htmlFor="v2-obs">Observações internas</Label><Textarea id="v2-obs" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} className="mt-1.5" /></section><label className="flex items-center gap-2 text-xs text-burgundy/55 dark:text-pearl/55"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Cliente ativa</label>
            </div> : <div className="space-y-2.5">
              <section className="rounded-xl border border-rose/10 bg-blush/20 p-3 dark:bg-white/[0.025]"><div className="flex items-center justify-between gap-3"><div><p className="text-[0.62rem] font-semibold uppercase tracking-[0.15em] text-rose">Comprovantes por parcela</p><p className="mt-0.5 text-[0.62rem] text-burgundy/45 dark:text-pearl/35">{pagas} de {boletos.length} parcelas pagas.</p></div><span className="rounded-full bg-success/10 px-2 py-1 text-[0.58rem] font-semibold text-success">Anexo = pagamento</span></div></section>
              {carregando ? <div className="rounded-xl border border-rose/10 p-6 text-center text-xs text-burgundy/40 dark:border-white/8 dark:text-pearl/35">Carregando parcelas…</div> : visiveis.length === 0 ? <div className="rounded-xl border border-rose/10 p-6 text-center text-xs text-burgundy/40 dark:border-white/8 dark:text-pearl/35">Nenhuma parcela encontrada.</div> : <div className="overflow-hidden rounded-xl border border-rose/10 dark:border-white/8">{visiveis.map((b) => <div key={b.id} className="grid grid-cols-[52px_1fr_auto] items-center gap-2 border-b border-rose/8 px-2.5 py-2 last:border-0 dark:border-white/6"><div className="text-[0.62rem] font-semibold text-burgundy/70 dark:text-pearl/70">{b.numero_parcela}/{b.total_parcelas}</div><div className="min-w-0"><div className="flex items-center gap-2"><span className="text-[0.62rem] text-burgundy/45 dark:text-pearl/45">{dataBr(b.data_vencimento)}</span><span className="text-[0.68rem] font-semibold text-burgundy/80 dark:text-pearl/80">R$ {moeda(b.valor)}</span></div><div className={`mt-0.5 flex items-center gap-1.5 text-[0.52rem] ${b.status === "pago" ? "text-success" : b.comprovante_url ? "text-alert" : "text-burgundy/35 dark:text-pearl/30"}`}><span>{STATUS_BOLETO_LABEL[b.status]}</span>{b.comprovante_url && <span>· comprovante anexado</span>}</div></div><div className="flex items-center gap-1">{b.comprovante_url ? <><a href={`/api/admin/boletos/${b.id}/comprovante`} target="_blank" rel="noopener noreferrer" title="Abrir comprovante" className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose/10 text-rose hover:bg-rose/20"><Paperclip className="h-4 w-4" /></a><button type="button" onClick={() => avaliarComprovante(b, "confirmar")} disabled={enviando === b.id} title="Aprovar comprovante" className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10 text-success hover:bg-success/15 disabled:opacity-40"><Check className="h-4 w-4" /></button><button type="button" onClick={() => avaliarComprovante(b, "rejeitar")} disabled={enviando === b.id} title="Rejeitar comprovante" className="flex h-8 w-8 items-center justify-center rounded-lg bg-alert/10 text-alert hover:bg-alert/15 disabled:opacity-40"><X className="h-4 w-4" /></button></> : <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-burgundy/5 text-burgundy/20 dark:bg-white/5 dark:text-pearl/20"><Paperclip className="h-4 w-4" /></span>}</div></div>)}</div>}
              {boletos.length > 8 && <button type="button" onClick={() => setMostrarTodas((v) => !v)} className="w-full rounded-lg py-2 text-[0.62rem] font-semibold text-rose hover:bg-rose/5">{mostrarTodas ? "Mostrar menos" : `Ver todas as ${boletos.length} parcelas`}</button>}
            </div>}
          </div></form>

          <footer className="flex shrink-0 items-center justify-between border-t border-rose/10 px-3.5 py-2.5 sm:px-4 dark:border-white/10"><div className="text-[0.55rem] uppercase tracking-[0.14em] text-burgundy/25 dark:text-pearl/25">Financeiro e comprovantes</div><div className="flex items-center gap-2"><Button type="button" variant="secondary" size="sm" onClick={onClose}>Fechar</Button>{aba === "dados" && <Button type="submit" form="form-cliente-v2" disabled={salvando} size="sm"><Check className="h-3.5 w-3.5" /> {salvando ? "Salvando" : "Salvar"}</Button>}</div></footer>
        </div>
      </div>
    </Portal>
  );
}
