"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, IdCard, Receipt, Save, Trash2, UploadCloud, UserRound, WalletCards, X } from "lucide-react";
import { toast } from "sonner";
import { Portal } from "@/components/ui/Portal";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Textarea } from "@/components/ui/Input";
import { formatarCpf } from "@/lib/cpf";
import { desmascararMoeda, mascararMoedaInput } from "@/lib/utils";
import type { Boleto, Cliente, QuantidadeParcelas } from "@/types/database";
import { QUANTIDADE_PARCELAS_OPCOES, STATUS_BOLETO_LABEL, TAXA_ADMINISTRATIVA_PADRAO } from "@/types/database";

function moeda(v: number) { return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function Section({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return <section className="rounded-xl border border-rose/10 bg-white/[0.025] p-3"><div className="mb-2.5 flex items-center gap-2"><Icon className="h-3.5 w-3.5 text-rose" /><h3 className="text-[0.62rem] font-semibold uppercase tracking-[0.15em] text-rose">{title}</h3></div>{children}</section>;
}

export function ModalClienteCompacto({ cliente, onClose, onSalvo }: { cliente: Cliente | null; onClose: () => void; onSalvo: () => void }) {
  const editando = Boolean(cliente);
  const [aba, setAba] = useState<"dados" | "boletos">("dados");
  const [nome, setNome] = useState(cliente?.nome_completo ?? "");
  const [cpf, setCpf] = useState(cliente ? formatarCpf(cliente.cpf) : "");
  const [nascimento, setNascimento] = useState(cliente?.data_nascimento ?? "");
  const [telefone, setTelefone] = useState(cliente?.telefone ?? "");
  const [email, setEmail] = useState(cliente?.email ?? "");
  const [procedimento, setProcedimento] = useState(cliente?.procedimento ?? "");
  const [carta, setCarta] = useState(cliente ? moeda(cliente.valor_contrato) : "");
  const [quantidade, setQuantidade] = useState<QuantidadeParcelas>((cliente?.quantidade_parcelas ?? 12) as QuantidadeParcelas);
  const [taxa, setTaxa] = useState(String(cliente?.taxa_administrativa_percentual ?? TAXA_ADMINISTRATIVA_PADRAO[(cliente?.quantidade_parcelas ?? 12) as QuantidadeParcelas]).replace(".", ","));
  const [vencimento, setVencimento] = useState("");
  const [observacoes, setObservacoes] = useState(cliente?.observacoes_internas ?? "");
  const [ativo, setAtivo] = useState(cliente?.ativo ?? true);
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [carregandoBoletos, setCarregandoBoletos] = useState(Boolean(cliente));
  const [salvando, setSalvando] = useState(false);
  const [enviandoCarne, setEnviandoCarne] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const inputCarneRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAba("dados"); setNome(cliente?.nome_completo ?? ""); setCpf(cliente ? formatarCpf(cliente.cpf) : ""); setNascimento(cliente?.data_nascimento ?? ""); setTelefone(cliente?.telefone ?? ""); setEmail(cliente?.email ?? ""); setProcedimento(cliente?.procedimento ?? ""); setCarta(cliente ? moeda(cliente.valor_contrato) : ""); setQuantidade((cliente?.quantidade_parcelas ?? 12) as QuantidadeParcelas); setTaxa(String(cliente?.taxa_administrativa_percentual ?? TAXA_ADMINISTRATIVA_PADRAO[(cliente?.quantidade_parcelas ?? 12) as QuantidadeParcelas]).replace(".", ",")); setObservacoes(cliente?.observacoes_internas ?? ""); setAtivo(cliente?.ativo ?? true); setConfirmarExclusao(false);
  }, [cliente]);

  useEffect(() => {
    if (!cliente?.id) { setBoletos([]); setCarregandoBoletos(false); return; }
    setCarregandoBoletos(true);
    fetch(`/api/admin/clientes/${cliente.id}/boletos`, { cache: "no-store" }).then(async (res) => { const data = await res.json(); if (!res.ok) throw new Error(data.erro ?? "Não foi possível carregar os boletos."); setBoletos(data.boletos ?? []); }).catch((e) => toast.error(e instanceof Error ? e.message : "Erro ao carregar boletos.")).finally(() => setCarregandoBoletos(false));
  }, [cliente?.id]);

  const cartaNumero = Number(desmascararMoeda(carta)) || 0;
  const taxaNumero = Number(taxa.replace(",", ".")) || 0;
  const parcelaSugerida = quantidade ? cartaNumero * (1 + taxaNumero / 100) / quantidade : 0;

  async function salvarPerfil(e: React.FormEvent) {
    e.preventDefault();
    if (!nome || !nascimento || cartaNumero <= 0) { toast.error("Preencha nome, nascimento e carta de crédito."); return; }
    if (!editando && !vencimento) { toast.error("Informe o 1º vencimento para gerar as parcelas."); return; }
    setSalvando(true);
    try {
      const res = await fetch(editando ? `/api/admin/clientes/${cliente!.id}` : "/api/admin/clientes", { method: editando ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nomeCompleto: nome, cpf, dataNascimento: nascimento, telefone, email, procedimento, valorContrato: cartaNumero, taxaAdministrativaPercentual: taxaNumero, ativo, observacoes, recalcularBoletosAbertos: true }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? "Não foi possível salvar.");
      toast.success(editando ? "Dados pessoais atualizados." : "Cliente cadastrada.");
      onSalvo();
      if (!editando && data.cliente?.id) {
        await fetch(`/api/admin/clientes/${data.cliente.id}/boletos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantidadeParcelas: quantidade, taxaPercentual: taxaNumero, primeiroVencimento: vencimento }) });
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível salvar."); } finally { setSalvando(false); }
  }

  async function excluirCliente() {
    if (!cliente?.id || excluindo) return;
    setExcluindo(true);
    try {
      const res = await fetch(`/api/admin/clientes/${cliente.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.erro ?? "Não foi possível excluir a cliente.");
      toast.success("Cliente excluída com sucesso.");
      onSalvo(); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível excluir a cliente."); } finally { setExcluindo(false); setConfirmarExclusao(false); }
  }

  async function anexarCarne(file: File | null) {
    if (!cliente?.id || !file) return;
    if (file.type !== "application/pdf") { toast.error("O carnê precisa ser um PDF."); return; }
    setEnviandoCarne(true);
    try { const form = new FormData(); form.append("arquivo", file); const res = await fetch(`/api/admin/clientes/${cliente.id}/boletos/carne`, { method: "POST", body: form }); const data = await res.json(); if (!res.ok) throw new Error(data.erro ?? "Não foi possível anexar o carnê."); toast.success(`Carnê anexado: ${data.parcelas_atualizadas ?? 0} parcela(s).`); const b = await fetch(`/api/admin/clientes/${cliente.id}/boletos`, { cache: "no-store" }).then(r => r.json()); setBoletos(b.boletos ?? []); } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao anexar carnê."); } finally { setEnviandoCarne(false); if (inputCarneRef.current) inputCarneRef.current.value = ""; }
  }

  return <Portal>
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-burgundy-dark/55 px-2 py-2.5 backdrop-blur-md sm:px-4 sm:py-4">
      <div className="relative flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#1b181b] text-pearl shadow-2xl animate-scaleIn">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-3.5 py-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2.5"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose/15 text-rose"><UserRound className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate font-heading text-base font-semibold text-rose">{nome || "Nova cliente"}</p><p className="text-[0.58rem] uppercase tracking-[0.15em] text-pearl/35">{editando ? "Perfil compacto" : "Cadastro rápido"}</p></div></div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-pearl/35 hover:bg-white/5 hover:text-pearl" aria-label="Fechar"><X className="h-4 w-4" /></button>
        </header>

        <div className="border-b border-white/8 bg-black/10 px-3 py-2 sm:px-4"><div className="grid grid-cols-2 gap-1 rounded-xl bg-white/[0.035] p-1"><button type="button" onClick={() => setAba("dados")} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[0.68rem] font-semibold ${aba === "dados" ? "bg-rose text-white" : "text-pearl/45"}`}><IdCard className="h-3.5 w-3.5" /> Dados pessoais</button><button type="button" onClick={() => setAba("boletos")} disabled={!editando} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[0.68rem] font-semibold ${aba === "boletos" ? "bg-rose text-white" : "text-pearl/45"}`}><Receipt className="h-3.5 w-3.5" /> Boletos {boletos.length > 0 && <span>({boletos.length})</span>}</button></div></div>

        <form id="form-cliente-compacto" onSubmit={salvarPerfil} className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {aba === "dados" ? <div className="space-y-2.5">
            <Section title="Dados pessoais" icon={IdCard}><div className="grid grid-cols-2 gap-2"><div className="col-span-2"><Label htmlFor="mc-nome">Nome completo</Label><Input id="mc-nome" value={nome} onChange={(e) => setNome(e.target.value)} required /></div><div><Label htmlFor="mc-cpf">CPF</Label><Input id="mc-cpf" value={cpf} maxLength={14} disabled={editando} onChange={(e) => setCpf(formatarCpf(e.target.value))} /></div><div><Label htmlFor="mc-nascimento">Nascimento</Label><Input id="mc-nascimento" type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} required /></div><div><Label htmlFor="mc-telefone">Telefone</Label><Input id="mc-telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} /></div><div><Label htmlFor="mc-email">E-mail</Label><Input id="mc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div><div><Label htmlFor="mc-procedimento">Procedimento</Label><Input id="mc-procedimento" value={procedimento} onChange={(e) => setProcedimento(e.target.value)} /></div><div><Label htmlFor="mc-carta">Carta de crédito</Label><Input id="mc-carta" value={carta} onChange={(e) => setCarta(mascararMoedaInput(e.target.value))} required /></div></div></Section>
            <Section title="Parcelamento" icon={WalletCards}><div className="grid grid-cols-2 gap-2"><div><Label htmlFor="mc-quantidade">Quantidade de parcelas</Label><Select id="mc-quantidade" value={String(quantidade)} onChange={(e) => setQuantidade(Number(e.target.value) as QuantidadeParcelas)}>{QUANTIDADE_PARCELAS_OPCOES.map((q) => <option key={q} value={q}>{q} parcelas</option>)}</Select></div><div><Label htmlFor="mc-taxa">Taxa administrativa (%)</Label><Input id="mc-taxa" value={taxa} onChange={(e) => setTaxa(e.target.value)} /></div>{!editando && <div className="col-span-2"><Label htmlFor="mc-vencimento">1º vencimento</Label><Input id="mc-vencimento" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></div>}</div><div className="mt-2 rounded-lg border border-white/5 bg-black/10 px-3 py-2 text-[0.65rem] text-pearl/50">Parcela sugerida: <strong className="text-pearl">R$ {moeda(parcelaSugerida)}</strong></div></Section>
            <Section title="Observações" icon={FileText}><Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Observações internas..." rows={3} /></Section>
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] p-3"><div><p className="text-xs font-semibold text-pearl">Status da cliente</p><p className="text-[0.62rem] text-pearl/40">Controla se o cadastro aparece como ativo.</p></div><label className="flex cursor-pointer items-center gap-2 text-xs text-pearl/60"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="accent-rose" /> Ativa</label></div>
          </div> : <div className="space-y-2.5">
            {carregandoBoletos ? <div className="py-12 text-center text-sm text-pearl/40">Carregando boletos...</div> : <><Section title="Resumo financeiro" icon={WalletCards}><div className="grid grid-cols-3 gap-2"><div className="rounded-lg border border-white/5 p-2.5"><p className="text-[0.55rem] uppercase text-pearl/35">Total</p><p className="mt-1 text-sm font-semibold">{boletos.length}</p></div><div className="rounded-lg border border-emerald-400/10 p-2.5"><p className="text-[0.55rem] uppercase text-pearl/35">Pagas</p><p className="mt-1 text-sm font-semibold text-emerald-300">{boletos.filter((b) => b.status === "pago").length}</p></div><div className="rounded-lg border border-rose/10 p-2.5"><p className="text-[0.55rem] uppercase text-pearl/35">Abertas</p><p className="mt-1 text-sm font-semibold text-rose">{boletos.filter((b) => b.status !== "pago").length}</p></div></div></Section><Section title="Parcelas" icon={Receipt}><div className="space-y-1.5">{boletos.slice(0, 12).map((b) => <div key={b.id} className="flex items-center justify-between rounded-lg border border-white/5 px-2.5 py-2"><div><p className="text-xs font-semibold">{b.numero_parcela}/{b.total_parcelas} · R$ {moeda(Number(b.valor))}</p><p className="text-[0.58rem] text-pearl/35">{new Date(`${b.data_vencimento}T12:00:00`).toLocaleDateString("pt-BR")} · {STATUS_BOLETO_LABEL[b.status]}</p></div></div>)}</div></Section><Section title="Carnê" icon={UploadCloud}><input ref={inputCarneRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => anexarCarne(e.target.files?.[0] ?? null)} /><Button type="button" onClick={() => inputCarneRef.current?.click()} disabled={enviandoCarne}>{enviandoCarne ? "Enviando..." : "Anexar carnê PDF"}</Button></Section></>}
          </div>}
        </form>

        {editando && <div className="shrink-0 border-t border-white/10 bg-black/10 px-3 py-3 sm:px-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><button type="button" onClick={() => setConfirmarExclusao(true)} disabled={excluindo} className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-[0.68rem] font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Excluir cliente</button><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" form="form-cliente-compacto" disabled={salvando}>{salvando ? "Salvando..." : <><Save className="h-3.5 w-3.5" /> Salvar alterações</>}</Button></div></div></div>}

        {confirmarExclusao && <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"><div className="w-full max-w-sm rounded-2xl border border-red-400/20 bg-[#211b1e] p-5 shadow-2xl"><div className="mb-3 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/15 text-red-300"><Trash2 className="h-5 w-5" /></div><div><h3 className="text-sm font-semibold text-pearl">Excluir cliente?</h3><p className="text-[0.65rem] text-pearl/45">{nome}</p></div></div><p className="mb-4 text-xs leading-relaxed text-pearl/60">Essa ação removerá o cadastro e os dados relacionados. <strong className="text-red-300">Essa ação não pode ser desfeita.</strong></p><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setConfirmarExclusao(false)} disabled={excluindo}>Cancelar</Button><button type="button" onClick={excluirCliente} disabled={excluindo} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-[0.68rem] font-semibold text-white hover:bg-red-700 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> {excluindo ? "Excluindo..." : "Sim, excluir cliente"}</button></div></div></div>}
      </div>
    </div>
  </Portal>;
}
