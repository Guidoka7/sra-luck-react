"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell, Building2, CalendarClock, CheckCircle2, ChevronDown, ImagePlus, Lock, MessageCircle, MonitorCog, Phone, QrCode, Save, ShieldCheck, Trash2, Unlock, UploadCloud, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { refreshInstant, invalidateInstantCache, getInstantCache } from "@/lib/instantCache";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/admin/ExecutiveUI";

interface ConfiguracoesData {
  id: number; nome_clinica: string; meta_orcamento_mensal: number; frase_sonho: string; pix_chave: string; pix_qrcode_base64: string; pix_desconto_percentual: number; whatsapp_contato: string; telefone_contato: string; agenda_liberacao_financeira_bloqueada: boolean; updated_at: string;
}
const MAX_QR = 1.5 * 1024 * 1024;
const DESCONTOS = [0, 5, 10, 15, 20, 25, 30];
const INPUT = "h-9 rounded-lg border border-burgundy/10 bg-white/75 px-3 text-sm text-clay outline-none transition focus:border-gold/60 focus:ring-2 focus:ring-gold/15 dark:border-white/10 dark:bg-white/[0.045] dark:text-pearl";
const CARD = "overflow-hidden rounded-2xl border border-burgundy/10 bg-white/70 shadow-[0_14px_45px_-32px_rgba(88,25,38,.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.045]";

function Cabecalho({ icon: Icon, title, description, aberto, onClick, badge }: { icon: React.ElementType; title: string; description: string; aberto: boolean; onClick: () => void; badge?: string }) {
  return <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-white/[0.035] sm:px-4">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-burgundy/8 text-burgundy dark:bg-white/[0.07] dark:text-rose"><Icon className="h-4 w-4" /></span>
    <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="text-xs font-semibold text-burgundy dark:text-pearl">{title}</span>{badge && <span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[0.5rem] font-semibold uppercase tracking-wider text-success">{badge}</span>}</span><span className="mt-0.5 block truncate text-[0.62rem] text-clay/45 dark:text-pearl/35">{description}</span></span>
    <ChevronDown className={`h-4 w-4 shrink-0 text-clay/30 transition-transform ${aberto ? "rotate-180" : ""}`} />
  </button>;
}

export default function ConfiguracoesPage() {
  const [dados, setDados] = useState<ConfiguracoesData | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aberta, setAberta] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false); const [salvandoPagamento, setSalvandoPagamento] = useState(false); const [salvandoAgenda, setSalvandoAgenda] = useState(false);
  const [nomeClinica, setNomeClinica] = useState(""); const [meta, setMeta] = useState(""); const [frase, setFrase] = useState("");
  const [pixChave, setPixChave] = useState(""); const [pixQrCode, setPixQrCode] = useState(""); const [pixDesconto, setPixDesconto] = useState("0"); const [whatsapp, setWhatsapp] = useState(""); const [telefone, setTelefone] = useState("");
  const [agendaBloqueada, setAgendaBloqueada] = useState(false); const inputArquivoRef = useRef<HTMLInputElement>(null);

  function aplicar(c: ConfiguracoesData) { setDados(c); setNomeClinica(c.nome_clinica ?? ""); setMeta(String(c.meta_orcamento_mensal ?? 0)); setFrase(c.frase_sonho ?? ""); setPixChave(c.pix_chave ?? ""); setPixQrCode(c.pix_qrcode_base64 ?? ""); setPixDesconto(String(c.pix_desconto_percentual ?? 0)); setWhatsapp(c.whatsapp_contato ?? ""); setTelefone(c.telefone_contato ?? ""); setAgendaBloqueada(Boolean(c.agenda_liberacao_financeira_bloqueada)); }
  async function carregar() {
    const url = "/api/admin/configuracoes"; const cached = getInstantCache<{ configuracoes?: ConfiguracoesData }>(url);
    if (cached?.configuracoes) { aplicar(cached.configuracoes); setCarregando(false); }
    try { const data = await refreshInstant<{ configuracoes?: ConfiguracoesData }>(url, { cache: "no-store" }); if (data.configuracoes) aplicar(data.configuracoes); } catch { if (!cached?.configuracoes) toast.error("Não foi possível carregar as configurações."); } finally { setCarregando(false); }
  }
  useEffect(() => { carregar(); }, []);

  async function salvarIdentidade(e: React.FormEvent) {
    e.preventDefault(); setSalvando(true);
    try { const res = await fetch("/api/admin/configuracoes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nomeClinica, metaOrcamentoMensal: meta, fraseSonho: frase }) }); const data = await res.json(); if (!res.ok) throw new Error(data.erro ?? "Não foi possível salvar."); aplicar(data.configuracoes); toast.success("Identidade atualizada."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao salvar."); } finally { setSalvando(false); }
  }
  function selecionarQr(file: File | null) {
    if (!file) return; if (!file.type.startsWith("image/")) return toast.error("Envie uma imagem do QR Code."); if (file.size > MAX_QR) return toast.error("Imagem muito grande. Use até 1.5MB."); const reader = new FileReader(); reader.onload = () => setPixQrCode(String(reader.result)); reader.readAsDataURL(file);
  }
  async function salvarPagamento(e: React.FormEvent) {
    e.preventDefault(); setSalvandoPagamento(true);
    try { const res = await fetch("/api/admin/configuracoes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pixChave, pixQrCodeBase64: pixQrCode, pixDescontoPercentual: Number(pixDesconto), whatsappContato: whatsapp, telefoneContato: telefone }) }); const data = await res.json(); if (!res.ok) throw new Error(data.erro ?? "Não foi possível salvar."); aplicar(data.configuracoes); toast.success("Pagamento e contato atualizados."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao salvar."); } finally { setSalvandoPagamento(false); }
  }
  async function alternarAgenda() {
    const novo = !agendaBloqueada; setSalvandoAgenda(true);
    try { const res = await fetch("/api/admin/configuracoes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agendaLiberacaoFinanceiraBloqueada: novo }) }); const data = await res.json(); if (!res.ok) throw new Error(data.erro ?? "Não foi possível atualizar a agenda."); aplicar(data.configuracoes); toast.success(novo ? "Agenda financeira bloqueada." : "Agenda financeira reaberta."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao atualizar agenda."); } finally { setSalvandoAgenda(false); }
  }

  const atualizado = dados?.updated_at ? new Date(dados.updated_at).toLocaleDateString("pt-BR") : "—";
  if (carregando && !dados) return <div className="space-y-3"><PageHeader eyebrow="Configurações" title="Central de controle" description="Configurações organizadas em painéis compactos." /><SkeletonRows count={4} /></div>;

  const abrir = (id: string) => setAberta((atual) => atual === id ? null : id);
  return <div className="space-y-3 pb-8">
    <PageHeader eyebrow="Configurações" title="Central de controle" description="Tudo permanece compacto. Clique em um tópico para abrir somente a configuração correspondente." actions={<span className="inline-flex items-center gap-1.5 rounded-full border border-burgundy/10 bg-white/60 px-2.5 py-1.5 text-[0.58rem] font-medium text-clay/50 dark:border-white/10 dark:bg-white/[0.04] dark:text-pearl/40"><CheckCircle2 className="h-3 w-3 text-success" /> Atualizado {atualizado}</span>} />

    <div className="grid gap-2 md:grid-cols-3">
      <div className={CARD}><Cabecalho icon={Building2} title="Identidade & orçamento" description="Empresa, meta e mensagem" aberto={aberta === "identidade"} onClick={() => abrir("identidade")} />{aberta === "identidade" && <div className="border-t border-white/8 p-3.5"><form onSubmit={salvarIdentidade} className="space-y-2.5"><div className="grid gap-2.5 sm:grid-cols-2"><div><Label>Nome da empresa</Label><Input value={nomeClinica} onChange={(e) => setNomeClinica(e.target.value)} className={INPUT} /></div><div><Label>Limite orçamentário mensal</Label><Input type="number" min="0" step="0.01" value={meta} onChange={(e) => setMeta(e.target.value)} className={INPUT} /></div><div className="sm:col-span-2"><Label>Mensagem executiva</Label><Textarea value={frase} onChange={(e) => setFrase(e.target.value)} className="min-h-[58px]" /></div></div><div className="flex justify-end"><Button type="submit" size="sm" loading={salvando}><Save className="h-3.5 w-3.5" /> Salvar</Button></div></form></div>}</div>
      <div className={CARD}><Cabecalho icon={CalendarClock} title="Agenda financeira" description="Bloquear ou reabrir liberações" aberto={aberta === "agenda"} onClick={() => abrir("agenda")} badge={agendaBloqueada ? "Pausada" : "Ativa"} />{aberta === "agenda" && <div className="border-t border-white/8 p-3.5"><div className={`rounded-xl border p-3 ${agendaBloqueada ? "border-alert/15 bg-alert/5" : "border-success/15 bg-success/5"}`}><div className="flex items-center gap-2.5"><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${agendaBloqueada ? "bg-alert/10 text-alert" : "bg-success/10 text-success"}`}>{agendaBloqueada ? <Lock className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}</span><div><p className="text-xs font-semibold text-burgundy dark:text-pearl">Agenda {agendaBloqueada ? "bloqueada" : "aberta"}</p><p className="text-[0.6rem] text-clay/45 dark:text-pearl/35">Não altera datas já confirmadas.</p></div></div><Button type="button" size="sm" variant={agendaBloqueada ? "secondary" : "danger"} loading={salvandoAgenda} onClick={alternarAgenda} className="mt-3 w-full">{agendaBloqueada ? <><Unlock className="h-3.5 w-3.5" /> Reabrir agenda</> : <><Lock className="h-3.5 w-3.5" /> Bloquear agenda</>}</Button></div></div>}</div>
      <div className={CARD}><Cabecalho icon={WalletCards} title="Pagamento & contato" description="PIX, desconto e canais" aberto={aberta === "pagamento"} onClick={() => abrir("pagamento")} />{aberta === "pagamento" && <div className="border-t border-white/8 p-3.5"><form onSubmit={salvarPagamento} className="space-y-2.5"><div className="grid gap-2.5 sm:grid-cols-2"><div className="sm:col-span-2"><Label>Chave PIX</Label><Input value={pixChave} onChange={(e) => setPixChave(e.target.value)} className={INPUT} /></div><div><Label>Desconto PIX</Label><select value={pixDesconto} onChange={(e) => setPixDesconto(e.target.value)} className={INPUT}>{DESCONTOS.map((v) => <option key={v} value={v}>{v ? `${v}% de desconto` : "Sem desconto"}</option>)}</select></div><div><Label>Telefone</Label><div className="relative"><Phone className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-clay/25" /><Input value={telefone} onChange={(e) => setTelefone(e.target.value)} className={`${INPUT} pl-9`} /></div></div><div className="sm:col-span-2"><Label>WhatsApp</Label><div className="relative"><MessageCircle className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-success/60" /><Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={`${INPUT} pl-9`} /></div></div></div><div><Label>QR Code do PIX</Label><div className="mt-1 flex items-center gap-3 rounded-xl border border-dashed border-burgundy/15 bg-burgundy/[0.025] p-2.5 dark:border-white/10">{pixQrCode ? <><img src={pixQrCode} alt="QR Code PIX" className="h-20 w-20 rounded-lg bg-white object-contain" /><div className="min-w-0 flex-1"><p className="text-[0.62rem] font-medium text-success">QR Code carregado</p><div className="mt-1.5 flex gap-1.5"><Button type="button" size="sm" variant="ghost" onClick={() => inputArquivoRef.current?.click()}><UploadCloud className="h-3.5 w-3.5" /> Trocar</Button><Button type="button" size="sm" variant="danger" onClick={() => setPixQrCode("")}><Trash2 className="h-3.5 w-3.5" /> Remover</Button></div></div></> : <button type="button" onClick={() => inputArquivoRef.current?.click()} className="flex flex-1 items-center gap-2 text-left"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold/10 text-gold"><QrCode className="h-4 w-4" /></span><span><span className="block text-xs font-semibold text-burgundy dark:text-pearl">Adicionar QR Code</span><span className="text-[0.58rem] text-clay/40">PNG, JPG ou WEBP · até 1.5MB</span></span><ImagePlus className="ml-auto h-4 w-4 text-clay/25" /></button>}<input ref={inputArquivoRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp" className="hidden" onChange={(e) => selecionarQr(e.target.files?.[0] ?? null)} /></div></div><div className="flex justify-end"><Button type="submit" size="sm" loading={salvandoPagamento}><Save className="h-3.5 w-3.5" /> Salvar</Button></div></form></div>}</div>
    </div>

    <div className="grid gap-2 md:grid-cols-2">
      <Link href="/admin/configuracoes/notificacoes" className={`${CARD} group flex items-center gap-3 px-3.5 py-3 transition hover:border-gold/30`}><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-burgundy/8 text-burgundy dark:bg-white/[0.07] dark:text-rose"><Bell className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-burgundy dark:text-pearl">Notificações</span><span className="text-[0.62rem] text-clay/45 dark:text-pearl/35">Avisos e acompanhamento de envios</span></span><span className="text-[0.55rem] font-semibold uppercase tracking-wider text-rose">Abrir</span></Link>
      <Link href="/admin/configuracoes/monitoramento" className={`${CARD} group flex items-center gap-3 px-3.5 py-3 transition hover:border-gold/30`}><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-burgundy/8 text-burgundy dark:bg-white/[0.07] dark:text-rose"><MonitorCog className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-burgundy dark:text-pearl">Monitoramento do app</span><span className="text-[0.62rem] text-clay/45 dark:text-pearl/35">Web, PWA e notificações</span></span><span className="text-[0.55rem] font-semibold uppercase tracking-wider text-rose">Abrir</span></Link>
    </div>
  </div>;
}
