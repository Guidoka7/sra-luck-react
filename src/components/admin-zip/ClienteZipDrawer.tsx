"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import { formatarCpf } from "@/lib/cpf";
import { desmascararMoeda, mascararMoedaInput, formatarMoeda, percentualNecessario } from "@/lib/utils";
import type { Boleto, Carne, Cliente, ImportacaoBoleto, LogAlteracao, QuantidadeParcelas, StatusContratoCliente } from "@/types/database";
import { QUANTIDADE_PARCELAS_OPCOES, STATUS_BOLETO_LABEL, STATUS_CONTRATO_LABEL, TAXA_ADMINISTRATIVA_PADRAO } from "@/types/database";
import { financeiroApi } from "@/features/financeiro/financeiroApi";
import { zipChip } from "./zipUi";

/**
 * Drawer lateral único (Correção 3, mantida): compartilhado entre Clientes e
 * Financeiro, com as abas [ PERFIL ] [ FINANCEIRO ]. Visual transcrito do
 * painel lateral de Admin Clientes.dc.html / Admin Financeiro.dc.html —
 * mesma lógica real da versão anterior (ClienteDrawer.tsx), apenas com a
 * marcação reescrita para os tokens --s0/--s1/--line/--panel do ZIP.
 */

const STATUS_CONTRATO_OPCOES: StatusContratoCliente[] = ["ativo", "suspenso", "negativado", "cancelado"];
const moeda = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBr = (v: string | null | undefined) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "—");

const rowLabel: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 };
const softLabel: CSSProperties = { color: "var(--soft)" };
const strongVal: CSSProperties = { fontWeight: 600 };
const fieldLabel: CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 600, color: "var(--soft)", marginBottom: 4 };
const fieldInput: CSSProperties = { width: "100%", height: 33, padding: "0 10px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--ink)", fontSize: 12, outline: "none" };
const sectionTitle: CSSProperties = { fontSize: 8.5, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 10 };
const primaryBtn: CSSProperties = { height: 34, padding: "0 14px", borderRadius: 9, border: "1px solid var(--bg)", background: "var(--bg)", color: "#FFFDFC", fontSize: 12, fontWeight: 600, width: "100%" };
const secondaryBtn: CSSProperties = { height: 32, padding: "0 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)", fontSize: 11.5, fontWeight: 600 };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div style={{ minWidth: 0 }}><label style={fieldLabel}>{label}</label>{children}</div>;
}
function Row({ label, value, style }: { label: string; value: ReactNode; style?: CSSProperties }) {
  return <div style={rowLabel}><span style={softLabel}>{label}</span><span style={{ ...strongVal, ...style }}>{value}</span></div>;
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div style={{ borderTop: "1px solid var(--line)", padding: "13px 0" }}><div style={sectionTitle}>{title}</div><div style={{ display: "flex", flexDirection: "column", gap: 9 }}>{children}</div></div>;
}

export function ClienteZipDrawer({ cliente, onClose, onSalvo, abaInicial = "perfil" }: { cliente: Cliente | null; onClose: () => void; onSalvo: () => void; abaInicial?: "perfil" | "financeiro" }) {
  const editando = Boolean(cliente);
  const [aba, setAba] = useState<"perfil" | "financeiro">(editando ? abaInicial : "perfil");

  const [nome, setNome] = useState(cliente?.nome_completo ?? "");
  const [cpf, setCpf] = useState(cliente ? formatarCpf(cliente.cpf ?? "") : "");
  const [nascimento, setNascimento] = useState(cliente?.data_nascimento ?? "");
  const [telefone, setTelefone] = useState(cliente?.telefone ?? "");
  const [email, setEmail] = useState(cliente?.email ?? "");
  const [procedimento, setProcedimento] = useState(cliente?.procedimento ?? "");
  const [observacoes, setObservacoes] = useState(cliente?.observacoes_internas ?? "");
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [baixaAlvo, setBaixaAlvo] = useState<Boleto | null>(null);
  const [baixaData, setBaixaData] = useState(() => new Date().toISOString().slice(0, 10));
  const [baixaJuros, setBaixaJuros] = useState("0");
  const [baixaMulta, setBaixaMulta] = useState("0");
  const [baixaForma, setBaixaForma] = useState("pix");
  const [baixaBanco, setBaixaBanco] = useState("");
  const [baixaObs, setBaixaObs] = useState("");
  const [baixaArquivo, setBaixaArquivo] = useState<File | null>(null);
  const [salvandoBaixa, setSalvandoBaixa] = useState(false);

  const [statusContrato, setStatusContrato] = useState<StatusContratoCliente>(cliente?.status_contrato ?? "ativo");
  const [statusMenuAberto, setStatusMenuAberto] = useState(false);
  const [suspensoDesde, setSuspensoDesde] = useState(cliente?.suspenso_desde ?? "");
  const [suspensoAte, setSuspensoAte] = useState(cliente?.suspenso_ate ?? "");
  const [suspensaoMotivo, setSuspensaoMotivo] = useState(cliente?.suspensao_motivo ?? "");
  const [salvandoStatus, setSalvandoStatus] = useState(false);
  const [historico, setHistorico] = useState<LogAlteracao[]>([]);
  const [historicoAberto, setHistoricoAberto] = useState(false);

  const [carta, setCarta] = useState(cliente ? moeda(Number(cliente.valor_contrato ?? 0)) : "");
  const [quantidade, setQuantidade] = useState<QuantidadeParcelas>((cliente?.quantidade_parcelas ?? 12) as QuantidadeParcelas);
  const [taxa, setTaxa] = useState(cliente?.taxa_administrativa_percentual != null ? String(cliente.taxa_administrativa_percentual).replace(".", ",") : String(TAXA_ADMINISTRATIVA_PADRAO[(cliente?.quantidade_parcelas ?? 12) as QuantidadeParcelas]).replace(".", ","));
  const [total, setTotal] = useState(() => (cliente ? moeda(Number(cliente.valor_contrato ?? 0) * (1 + Number(cliente.taxa_administrativa_percentual ?? 0) / 100)) : ""));
  const [parcela, setParcela] = useState("");
  const [parcelaManual, setParcelaManual] = useState(false);
  const [vencimento, setVencimento] = useState("");
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [carregandoFin, setCarregandoFin] = useState(Boolean(cliente));
  const [salvandoFin, setSalvandoFin] = useState(false);
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

  useEffect(() => { if (!parcela && !parcelaManual && parcelaAutomatica > 0) setParcela(moeda(parcelaAutomatica)); }, [parcela, parcelaManual, parcelaAutomatica]);
  function atualizarCarta(valor: string) { const novo = mascararMoedaInput(valor); setCarta(novo); const n = Number(desmascararMoeda(novo)) || 0; const t = n * (1 + taxaNumero / 100); setTotal(moeda(t)); if (!parcelaManual) setParcela(moeda(quantidade ? t / quantidade : 0)); }
  function atualizarTaxa(valor: string) { setTaxa(valor); const n = Number(valor.replace(",", ".")) || 0; const t = cartaNumero * (1 + n / 100); setTotal(moeda(t)); if (!parcelaManual) setParcela(moeda(quantidade ? t / quantidade : 0)); }
  function atualizarQuantidade(valor: string) { const q = Number(valor) as QuantidadeParcelas; setQuantidade(q); if (!parcelaManual) setParcela(moeda(q ? totalNumero / q : 0)); }
  function atualizarParcela(valor: string) { setParcelaManual(true); setParcela(mascararMoedaInput(valor)); }

  async function carregarBoletos() { if (!cliente?.id) { setBoletos([]); setParcelaManual(false); setCarregandoFin(false); return; } setCarregandoFin(true); try { const r = await fetch(`/api/admin/clientes/${cliente.id}/boletos`, { cache: "no-store" }); const d = await r.json(); if (!r.ok) throw new Error(d.erro ?? "Não foi possível carregar os boletos."); const lista = d.boletos ?? []; setBoletos(lista); if (d.cliente?.valor_contrato != null) setCarta(moeda(Number(d.cliente.valor_contrato))); if (d.cliente?.taxa_administrativa_percentual != null) setTaxa(String(d.cliente.taxa_administrativa_percentual).replace(".", ",")); if (d.cliente?.custo_total != null) setTotal(moeda(Number(d.cliente.custo_total))); if (lista[0]?.total_parcelas) setQuantidade(Number(lista[0].total_parcelas) as QuantidadeParcelas); if (lista[0]?.valor) { setParcela(moeda(Number(lista[0].valor))); setParcelaManual(true); } else setParcelaManual(false); } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao carregar parcelas."); } finally { setCarregandoFin(false); } }
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

  async function aplicarStatusContrato(novo: StatusContratoCliente) {
    if (!cliente?.id) { setStatusContrato(novo); setStatusMenuAberto(false); return; }
    setStatusContrato(novo);
    setStatusMenuAberto(false);
    if (novo === statusContrato) return;
    setSalvandoStatus(true);
    try {
      const r = await fetch(`/api/admin/clientes/${cliente.id}/status-contrato`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: novo, suspensoDesde: suspensoDesde || undefined, suspensoAte: suspensoAte || undefined, motivo: suspensaoMotivo || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro ?? "Não foi possível alterar o status do contrato.");
      toast.success(`Status do contrato alterado para ${STATUS_CONTRATO_LABEL[novo]}.`);
      void carregarPerfilExtra();
      onSalvo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao alterar status.");
      setStatusContrato(cliente.status_contrato ?? "ativo");
    } finally {
      setSalvandoStatus(false);
    }
  }

  async function gerarOuAjustarParcelas() {
    if (!cliente?.id) return;
    if (cartaNumero <= 0) return toast.error("Informe a carta de crédito.");
    if (parcelaNumero <= 0) return toast.error("Informe o valor da parcela.");
    setSalvandoFin(true);
    try {
      const jaTemFinanceiro = boletos.length > 0;
      const url = `/api/admin/clientes/${cliente.id}/boletos`;
      const base = { valorContrato: cartaNumero, quantidadeParcelas: quantidade, taxaPercentual: taxaNumero, valorParcela: parcelaNumero };
      const body = jaTemFinanceiro
        ? { ...base, recalcularAbertas: true, primeiroVencimento: vencimento || undefined }
        : { ...base, primeiroVencimento: vencimento };
      if (!jaTemFinanceiro && !vencimento) return toast.error("Informe o 1º vencimento para gerar as parcelas.");
      const r = await fetch(url, { method: jaTemFinanceiro ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro ?? "Não foi possível salvar o plano financeiro.");
      setBoletos(d.boletos ?? []);
      setParcelaManual(true);
      toast.success(jaTemFinanceiro ? "Parcelamento atualizado." : "Financeiro criado.");
      void carregarBoletos();
      onSalvo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar plano financeiro.");
    } finally {
      setSalvandoFin(false);
    }
  }

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
  const proximaLiberacao = boletos.find((b) => b.status !== "pago");
  const aguardandoConferencia = boletos.find((b) => b.status === "pendente_confirmacao");
  const [validando, setValidando] = useState(false);

  async function confirmarPagamento() {
    if (!aguardandoConferencia) return;
    setValidando(true);
    try {
      await financeiroApi.validar(aguardandoConferencia.id, "confirmar", "");
      toast.success("Pagamento confirmado.");
      void carregarBoletos();
      onSalvo();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível confirmar o pagamento."); }
    finally { setValidando(false); }
  }
  async function rejeitarComprovante() {
    if (!aguardandoConferencia) return;
    const motivo = window.prompt("Motivo da rejeição ou divergência (obrigatório):");
    if (!motivo || !motivo.trim()) return;
    setValidando(true);
    try {
      await financeiroApi.validar(aguardandoConferencia.id, "rejeitar", motivo);
      toast.success("Comprovante rejeitado. Parcela voltou para aberto.");
      void carregarBoletos();
      onSalvo();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível rejeitar o comprovante."); }
    finally { setValidando(false); }
  }

  function abrirBaixaManual(b: Boleto) {
    setBaixaAlvo(b);
    setBaixaData(new Date().toISOString().slice(0, 10));
    setBaixaJuros("0"); setBaixaMulta("0"); setBaixaForma("pix"); setBaixaBanco(""); setBaixaObs(""); setBaixaArquivo(null);
  }
  async function confirmarBaixaManual() {
    if (!baixaAlvo) return;
    setSalvandoBaixa(true);
    try {
      if (baixaArquivo) await financeiroApi.anexarComprovante(baixaAlvo.id, baixaArquivo);
      await financeiroApi.baixa(baixaAlvo.id, { dataPagamento: baixaData, juros: Number(baixaJuros) || 0, multa: Number(baixaMulta) || 0, formaPagamento: baixaForma, instituicaoConta: baixaBanco, observacao: baixaObs });
      toast.success("Baixa manual registrada.");
      setBaixaAlvo(null);
      void carregarBoletos();
      onSalvo();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível registrar a baixa."); }
    finally { setSalvandoBaixa(false); }
  }

  const hojeIso = new Date().toISOString().slice(0, 10);
  const vencidas = boletos.filter((b) => b.status !== "pago" && b.data_vencimento && b.data_vencimento < hojeIso).length;
  const situacao = statusContrato === "cancelado" ? "Contrato cancelado" : vencidas > 0 ? "Em atraso" : "Em dia";
  const situacaoKind = statusContrato === "cancelado" ? "neutral" : vencidas > 0 ? "bad" : "ok";
  const totalParcelasReal = boletos.length || cliente?.quantidade_parcelas || 0;
  const percentualMeta = percentualNecessario(totalParcelasReal || undefined);
  const metaParcelas = totalParcelasReal ? Math.ceil((totalParcelasReal * percentualMeta) / 100) : 0;
  const elegivel = totalParcelasReal > 0 && pagas >= metaParcelas;

  const statusKind = statusContrato === "ativo" ? "ok" : statusContrato === "suspenso" ? "warn" : "bad";

  return <>
    <div className="zip-admin zip-animate-fade-in" style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(30,12,16,.42)", backdropFilter: "blur(3px)" }} onClick={onClose} />
    <aside className="zip-admin zip-animate-slide-in" style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 61, width: "min(430px,100vw)", background: "var(--s0)", borderLeft: "1px solid var(--line)", boxShadow: "var(--sh)", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 16px 13px", borderBottom: "1px solid var(--line)", display: "flex", gap: 11, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 16, lineHeight: 1.25 }}>{nome || "Nova cliente"}</h2>
          {editando && <div style={{ marginTop: 6 }}><span style={zipChip(statusKind)}>● {STATUS_CONTRATO_LABEL[cliente?.status_contrato ?? "ativo"]}</span></div>}
        </div>
        {editando && <button onClick={() => setConfirmarExclusao(true)} title="Excluir perfil" style={{ height: 28, width: 28, flex: "none", borderRadius: 8, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--bad)", fontSize: 12 }}>🗑</button>}
        <button onClick={onClose} style={{ height: 28, width: 28, flex: "none", borderRadius: 8, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)", fontSize: 13 }}>✕</button>
      </div>

      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", gap: 5 }}>
        <button onClick={() => setAba("perfil")} style={{ flex: 1, height: 30, borderRadius: 8, border: aba === "perfil" ? "1px solid var(--bg)" : "1px solid var(--line)", background: aba === "perfil" ? "var(--bg)" : "var(--s0)", color: aba === "perfil" ? "#FFFDFC" : "var(--soft)", fontSize: 11, fontWeight: 700 }}>PERFIL</button>
        <button onClick={() => setAba("financeiro")} disabled={!editando} style={{ flex: 1, height: 30, borderRadius: 8, border: aba === "financeiro" ? "1px solid var(--bg)" : "1px solid var(--line)", background: aba === "financeiro" ? "var(--bg)" : "var(--s0)", color: aba === "financeiro" ? "#FFFDFC" : "var(--soft)", fontSize: 11, fontWeight: 700, opacity: editando ? 1 : .4 }}>FINANCEIRO{boletos.length > 0 ? ` · ${boletos.length}` : ""}</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 16px" }}>
        {aba === "perfil" ? <form id="zip-drawer-perfil" onSubmit={salvarPerfil}>
          <div style={{ padding: "14px 0", display: "flex", flexDirection: "column", gap: 9 }}>
            <Field label="Nome completo"><input style={fieldInput} value={nome} onChange={(e) => setNome(e.target.value)} required /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="CPF"><input style={fieldInput} value={cpf} maxLength={14} disabled={editando} onChange={(e) => setCpf(formatarCpf(e.target.value))} /></Field>
              <Field label="Nascimento"><input type="date" style={fieldInput} value={nascimento} onChange={(e) => setNascimento(e.target.value)} required /></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Telefone"><input style={fieldInput} value={telefone ?? ""} onChange={(e) => setTelefone(e.target.value)} /></Field>
              <Field label="E-mail"><input style={fieldInput} value={email ?? ""} onChange={(e) => setEmail(e.target.value)} /></Field>
            </div>
            <Field label="Procedimento"><input style={fieldInput} value={procedimento ?? ""} onChange={(e) => setProcedimento(e.target.value)} /></Field>
          </div>

          {editando && <Section title="Informações da venda">
            <Row label="Vendedora" value={cliente?.consultora || "—"} />
            <Row label="Campanha / origem" value={cliente?.origem_venda || "—"} />
            <Row label="Banco" value={cliente?.banco || "—"} />
          </Section>}

          {editando && <Section title="Contrato">
            <div style={{ ...rowLabel, alignItems: "center", position: "relative" }}>
              <span style={softLabel}>Status</span>
              <button type="button" onClick={() => setStatusMenuAberto((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 6, height: 26, padding: "0 7px 0 9px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--s0)", fontSize: 11.5, fontWeight: 600, color: "var(--ink)" }}>
                <span style={zipChip(statusKind)}>● {STATUS_CONTRATO_LABEL[statusContrato]}</span><span style={{ fontSize: 9, color: "var(--soft)" }}>▾</span>
              </button>
              {statusMenuAberto && <div className="zip-animate-pop-in" style={{ position: "absolute", top: 30, right: 0, zIndex: 8, width: 186, border: "1px solid var(--line)", background: "var(--s0)", borderRadius: 10, boxShadow: "var(--sh)", overflow: "hidden" }}>
                {STATUS_CONTRATO_OPCOES.map((o) => <div key={o} className="zip-row-hover" onClick={() => aplicarStatusContrato(o)} style={{ padding: "9px 12px", fontSize: 12, fontWeight: 600, borderBottom: "1px solid var(--line2)", cursor: "pointer", display: "flex", justifyContent: "space-between" }}>{STATUS_CONTRATO_LABEL[o]}<span style={zipStatusColor(o)}>●</span></div>)}
                <div style={{ padding: "8px 12px", fontSize: 10.5, color: "var(--soft)", lineHeight: 1.45 }}>Ativo é definido ao gerar as parcelas. Suspenso, negativado e cancelado são manuais.</div>
              </div>}
            </div>
            {statusContrato === "suspenso" && <div style={{ borderRadius: 10, border: "1px solid var(--line)", background: "var(--s1)", padding: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Field label="Suspenso desde"><input type="date" style={fieldInput} value={suspensoDesde ?? ""} onChange={(e) => setSuspensoDesde(e.target.value)} /></Field>
              <Field label="Até (opcional)"><input type="date" style={fieldInput} value={suspensoAte ?? ""} onChange={(e) => setSuspensoAte(e.target.value)} /></Field>
              <div style={{ gridColumn: "1 / -1" }}><Field label="Motivo"><input style={fieldInput} value={suspensaoMotivo ?? ""} onChange={(e) => setSuspensaoMotivo(e.target.value)} placeholder="Ex.: inadimplência, revisão de contrato…" /></Field></div>
              <div style={{ gridColumn: "1 / -1" }}><button type="button" disabled={salvandoStatus} onClick={() => aplicarStatusContrato("suspenso")} style={{ ...secondaryBtn, width: "100%", borderColor: "var(--bad)", color: "var(--bad)" }}>Confirmar suspensão</button></div>
            </div>}
          </Section>}

          <Section title="Observações internas">
            <textarea value={observacoes ?? ""} onChange={(e) => setObservacoes(e.target.value)} rows={3} style={{ ...fieldInput, height: "auto", padding: 10, resize: "vertical" as const }} />
          </Section>

          {editando && <Section title="Histórico operacional">
            <button type="button" onClick={() => setHistoricoAberto((v) => !v)} style={{ ...secondaryBtn, width: "100%" }}>{historicoAberto ? "Ocultar histórico" : `Ver histórico (${historico.length})`}</button>
            {historicoAberto && (historico.length === 0 ? <p style={{ fontSize: 11, color: "var(--soft)" }}>Nenhum evento registrado ainda.</p> : <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              {historico.slice(0, 30).map((h) => <div key={h.id} style={{ display: "flex", gap: 11, paddingBottom: 8, borderBottom: "1px solid var(--line2)" }}>
                <span style={{ width: 72, flex: "none", fontSize: 11, color: "var(--soft)" }} className="zip-mono">{new Date(h.created_at).toLocaleDateString("pt-BR")}</span>
                <div style={{ minWidth: 0 }}><div style={{ fontSize: 12, fontWeight: 600 }}>{h.acao.replace(/_/g, " ")}</div><div style={{ fontSize: 11, color: "var(--soft)" }}>{new Date(h.created_at).toLocaleTimeString("pt-BR")}</div></div>
              </div>)}
            </div>)}
          </Section>}
        </form> : <div style={{ padding: "14px 0", display: "flex", flexDirection: "column", gap: 0 }}>
          {carregandoFin ? <p style={{ padding: "40px 0", textAlign: "center", fontSize: 12, color: "var(--soft)" }}>Carregando financeiro…</p> : <>
            {aguardandoConferencia && <div style={{ border: "1px solid var(--gobg)", background: "var(--gobg)", borderRadius: 12, padding: "12px 13px", marginBottom: 12 }}>
              <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--gold)" }}>Comprovante aguardando análise</div>
              <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 7 }}>
                <Row label="Parcela" value={`${aguardandoConferencia.numero_parcela} de ${aguardandoConferencia.total_parcelas}`} />
                <Row label="Enviado em" value={dataBr(aguardandoConferencia.data_pagamento)} />
                <Row label="Valor informado" value={formatarMoeda(Number(aguardandoConferencia.valor ?? 0))} />
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 7 }}>
                {aguardandoConferencia.comprovante_url && <a href={aguardandoConferencia.comprovante_url} target="_blank" rel="noreferrer" style={{ flex: 1, height: 33, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--ink)", fontSize: 11.5, fontWeight: 600 }}>Ver comprovante</a>}
                <button type="button" disabled={validando} onClick={rejeitarComprovante} style={{ flex: 1, height: 33, borderRadius: 9, border: "1px solid var(--bad)", background: "var(--s0)", color: "var(--bad)", fontSize: 11.5, fontWeight: 600 }}>Rejeitar</button>
                <button type="button" disabled={validando} onClick={confirmarPagamento} style={{ flex: 1, height: 33, borderRadius: 9, border: "1px solid var(--bg)", background: "var(--bg)", color: "#FFFDFC", fontSize: 11.5, fontWeight: 600 }}>Confirmar pagamento</button>
              </div>
            </div>}
            <div style={{ borderRadius: 11, border: "1px solid var(--line)", background: "var(--s1)", padding: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Row label="Carta de crédito" value={<input style={{ ...fieldInput, height: 26, textAlign: "right", width: 110 }} value={carta} onChange={(e) => atualizarCarta(e.target.value)} />} />
                <Row label="Taxa administrativa" value={<input style={{ ...fieldInput, height: 26, textAlign: "right", width: 70 }} value={taxa} onChange={(e) => atualizarTaxa(e.target.value)} />} />
                <Row label="Parcelas" value={<select style={{ ...fieldInput, height: 26, width: 70 }} value={String(quantidade)} onChange={(e) => atualizarQuantidade(e.target.value)}>{QUANTIDADE_PARCELAS_OPCOES.map((q) => <option key={q} value={q}>{q}x</option>)}</select>} />
                <Row label="Valor da parcela" value={<input style={{ ...fieldInput, height: 26, textAlign: "right", width: 90 }} value={parcela} onChange={(e) => atualizarParcela(e.target.value)} />} />
                <Row label="Pagas" value={`${pagas} / ${boletos.length || 0}`} />
                {boletos.length === 0 && <Field label="1º vencimento"><input type="date" style={fieldInput} value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></Field>}
              </div>
              <div style={{ marginTop: 8, fontSize: 10, color: "var(--soft)", lineHeight: 1.45 }}>A carta de crédito e o valor da parcela são independentes. Ao editar manualmente a parcela, o valor da carta não é alterado.</div>
              {proximaLiberacao && <div style={{ marginTop: 11, paddingTop: 10, borderTop: "1px solid var(--line)", display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{ color: "var(--gold)", fontSize: 12 }}>★</span>
                <div><div style={{ fontSize: 11.5, fontWeight: 600 }}>Próxima parcela em aberto: {proximaLiberacao.numero_parcela}/{proximaLiberacao.total_parcelas}</div><div style={{ fontSize: 11, color: "var(--soft)" }}>Vencimento {dataBr(proximaLiberacao.data_vencimento)}</div></div>
              </div>}
              <button type="button" disabled={salvandoFin} onClick={gerarOuAjustarParcelas} style={{ ...primaryBtn, marginTop: 11 }}>{boletos.length === 0 ? "Criar financeiro" : "Salvar ajuste de parcelas"}</button>
            </div>

            {boletos.length > 0 && <>
              <Section title="Situação financeira">
                <div style={{ ...rowLabel, alignItems: "center" }}>
                  <span style={zipChip(situacaoKind)}>● {situacao}</span>
                  <span style={{ fontSize: 11.5, color: "var(--soft)" }}>{vencidas > 0 ? `${vencidas} parcela(s) vencida(s)` : "Nenhuma parcela vencida"}</span>
                </div>
              </Section>
              <Section title="Previsão de liberação da agenda">
                <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                  <span style={{ fontSize: 17, fontFamily: "Fraunces,Georgia,serif" }}>{elegivel ? "Disponível agora" : `${Math.max(metaParcelas - pagas, 0)} parcela(s) restantes`}</span>
                  {elegivel && <span style={zipChip("ok")}>Pode solicitar</span>}
                </div>
                <div style={{ fontSize: 11, color: "var(--soft)", lineHeight: 1.5 }}>Para {totalParcelasReal}x, a cliente pode solicitar os próximos passos após a {metaParcelas}ª parcela ({percentualMeta}%).</div>
                <div style={{ height: 6, borderRadius: 999, background: "var(--line2)", overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(Math.round((pagas / (metaParcelas || 1)) * 100), 100)}%`, borderRadius: 999, background: elegivel ? "var(--ok)" : "var(--bg)" }} /></div>
              </Section>
            </>}

            {boletos.length > 0 && <Section title="Parcelas e comprovantes">
              {visiveis.map((b) => <div key={b.id} style={{ display: "grid", gridTemplateColumns: "24px 1fr auto auto", gap: 8, alignItems: "center", padding: "7px 0", borderBottom: "1px solid var(--line2)", fontSize: 11.5 }} className="zip-mono">
                <span style={{ color: "var(--soft)", fontWeight: 600 }}>{b.numero_parcela}</span>
                <div><div style={{ fontWeight: 600 }}>{dataBr(b.data_vencimento)}</div><div style={{ fontSize: 10, color: "var(--soft)" }}>R$ {moeda(Number(b.valor || 0))}</div></div>
                <span style={zipChip(b.status === "pago" ? "ok" : b.status === "pendente_confirmacao" ? "warn" : "neutral")}>{STATUS_BOLETO_LABEL[b.status] ?? b.status}</span>
                <span style={{ display: "flex", gap: 5 }}>
                  {b.comprovante_url && <a href={b.comprovante_url} target="_blank" rel="noreferrer" style={{ ...secondaryBtn, height: 24, padding: "0 8px" }}>Ver</a>}
                  {b.status === "nao_pago" && <button type="button" onClick={() => abrirBaixaManual(b)} style={{ ...secondaryBtn, height: 24, padding: "0 8px" }}>Baixa manual</button>}
                </span>
              </div>)}
              {boletos.length > 8 && <button type="button" onClick={() => setMostrarTodas((v) => !v)} style={{ ...secondaryBtn, width: "100%", marginTop: 8 }}>{mostrarTodas ? "Mostrar menos" : `Mostrar todas as ${boletos.length} parcelas`}</button>}
            </Section>}

            <Section title="Carnês">
              {carnes.length === 0 ? <p style={{ fontSize: 11.5, color: "var(--soft)" }}>Nenhum carnê registrado ainda.</p> : carnes.map((c) => <Row key={c.id} label={`${c.instituicao_financeira} · ${c.identificador_externo}`} value={`${c.quantidade_parcelas}x · R$ ${moeda(c.valor_total)}`} />)}
              <form onSubmit={criarCarne} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
                <input placeholder="Instituição (ex.: BRB)" style={fieldInput} value={novoCarneBanco} onChange={(e) => setNovoCarneBanco(e.target.value)} />
                <input placeholder="Identificador" style={fieldInput} value={novoCarneIdentificador} onChange={(e) => setNovoCarneIdentificador(e.target.value)} />
                <input type="date" style={fieldInput} value={novoCarneData} onChange={(e) => setNovoCarneData(e.target.value)} />
                <button type="submit" disabled={criandoCarne} style={secondaryBtn}>Registrar carnê</button>
              </form>
              <label style={{ marginTop: 8, display: "flex", cursor: "pointer", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 10, border: "1px dashed var(--rose)", background: "var(--robg)", padding: "10px 12px", fontSize: 11.5, fontWeight: 600, color: "var(--bg)" }}>
                {importando ? "Importando…" : "↥ Importar carnê em PDF"}
                <input type="file" accept="application/pdf" className="hidden" style={{ display: "none" }} disabled={importando || !novoCarneBanco} onChange={(e) => { const arquivo = e.target.files?.[0]; if (arquivo) void importarCarne(arquivo, novoCarneBanco || carnes[0]?.instituicao_financeira || "Não informado"); e.target.value = ""; }} />
              </label>
              {pendentesRevisao.length > 0 && <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <p style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--gold)" }}>Páginas para confirmar/revisar</p>
                {pendentesRevisao.map((i) => <div key={i.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderRadius: 9, border: "1px solid var(--gobg)", background: "var(--gobg)", padding: "8px 10px", fontSize: 11 }}>
                  <span>{i.numero_parcela ? `Parcela ${i.numero_parcela}` : "Não identificada"} · {i.status_vinculacao === "revisar" ? "revisar manualmente" : `confiança ${i.nivel_confianca ?? "—"}`}</span>
                  <span style={{ display: "flex", gap: 5 }}>
                    {i.boleto_sugerido_id && <button type="button" onClick={() => vincularImportacao(i)} style={{ ...secondaryBtn, height: 24, padding: "0 8px", color: "var(--ok)", borderColor: "var(--okbg)" }}>Vincular</button>}
                    <button type="button" onClick={() => ignorarImportacao(i.id)} style={{ ...secondaryBtn, height: 24, padding: "0 8px" }}>Ignorar</button>
                  </span>
                </div>)}
              </div>}
            </Section>
          </>}
        </div>}
      </div>

      <div style={{ borderTop: "1px solid var(--line)", padding: "13px 16px", display: "flex", gap: 9, justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} style={secondaryBtn}>Fechar</button>
        {aba === "perfil" && <button type="submit" form="zip-drawer-perfil" disabled={salvandoPerfil} style={primaryBtn}>Salvar</button>}
      </div>

      {confirmarExclusao && <div className="zip-animate-fade-in" style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(30,12,16,.5)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }}>
        <div className="zip-animate-pop-in" style={{ width: 420, maxWidth: "100%", background: "var(--s0)", border: "1px solid var(--line)", borderRadius: 14, boxShadow: "var(--sh)", padding: 20 }}>
          <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
            <div style={{ width: 34, height: 34, flex: "none", borderRadius: 10, background: "var(--badbg)", color: "var(--bad)", display: "grid", placeItems: "center", fontSize: 15 }}>!</div>
            <div><h2 style={{ fontSize: 16 }}>Excluir perfil da Sra. Luck?</h2><p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--soft)", lineHeight: 1.55 }}>O perfil de <strong style={{ color: "var(--ink)" }}>{nome}</strong> deixará de aparecer nas áreas operacionais e o acesso ao aplicativo será removido.</p></div>
          </div>
          <div style={{ marginTop: 13, border: "1px solid var(--line)", background: "var(--s1)", borderRadius: 11, padding: "11px 12px", fontSize: 11.5, color: "var(--ink)", lineHeight: 1.55 }}>Isso não remove o cadastro no RD Station. Excluir perfil é diferente de cancelar contrato.</div>
          <div style={{ marginTop: 16, display: "flex", gap: 9, justifyContent: "flex-end" }}>
            <button onClick={() => setConfirmarExclusao(false)} style={secondaryBtn}>Cancelar</button>
            <button onClick={excluirCliente} disabled={excluindo} style={{ ...primaryBtn, width: "auto", border: "1px solid var(--bad)", background: "var(--bad)" }}>Excluir perfil</button>
          </div>
        </div>
      </div>}

      {baixaAlvo && <div className="zip-animate-fade-in" style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(30,12,16,.5)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }}>
        <div className="zip-animate-pop-in" style={{ width: 440, maxWidth: "100%", background: "var(--s0)", border: "1px solid var(--line)", borderRadius: 14, boxShadow: "var(--sh)", padding: 20, maxHeight: "90vh", overflowY: "auto" }}>
          <h2 style={{ fontSize: 16 }}>Baixa manual · parcela {baixaAlvo.numero_parcela}/{baixaAlvo.total_parcelas}</h2>
          <p style={{ margin: "6px 0 12px", fontSize: 11.5, color: "var(--soft)", lineHeight: 1.5 }}>Valor original R$ {moeda(Number(baixaAlvo.valor || 0))}. O total é validado e recalculado no servidor.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Data do pagamento"><input type="date" style={fieldInput} value={baixaData} onChange={(e) => setBaixaData(e.target.value)} /></Field>
            <Field label="Forma de pagamento"><select style={fieldInput} value={baixaForma} onChange={(e) => setBaixaForma(e.target.value)}><option value="pix">PIX</option><option value="dinheiro">Dinheiro</option><option value="transferencia">Transferência</option><option value="boleto">Boleto</option><option value="cartao">Cartão</option><option value="cheque">Cheque</option><option value="outro">Outro</option></select></Field>
            <Field label="Juros"><input inputMode="decimal" style={fieldInput} value={baixaJuros} onChange={(e) => setBaixaJuros(e.target.value)} /></Field>
            <Field label="Multa"><input inputMode="decimal" style={fieldInput} value={baixaMulta} onChange={(e) => setBaixaMulta(e.target.value)} /></Field>
            <div style={{ gridColumn: "1 / -1" }}><Field label="Banco"><input style={fieldInput} value={baixaBanco} onChange={(e) => setBaixaBanco(e.target.value)} placeholder="Ex.: Itaú, Nubank, Caixa" /></Field></div>
            <div style={{ gridColumn: "1 / -1" }}><Field label="Observações"><textarea style={{ ...fieldInput, height: "auto", padding: 9 }} rows={2} value={baixaObs} onChange={(e) => setBaixaObs(e.target.value)} /></Field></div>
            <div style={{ gridColumn: "1 / -1" }}><label style={{ display: "flex", cursor: "pointer", alignItems: "center", gap: 8, borderRadius: 9, border: "1px dashed var(--rose)", background: "var(--robg)", padding: "9px 10px", fontSize: 11, fontWeight: 600, color: "var(--bg)" }}>{baixaArquivo ? baixaArquivo.name : "Comprovante opcional (PDF, JPG, PNG)"}<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={(e) => setBaixaArquivo(e.target.files?.[0] ?? null)} /></label></div>
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 9, justifyContent: "flex-end" }}>
            <button onClick={() => setBaixaAlvo(null)} style={secondaryBtn}>Cancelar</button>
            <button onClick={confirmarBaixaManual} disabled={salvandoBaixa} style={{ ...primaryBtn, width: "auto" }}>{salvandoBaixa ? "Salvando…" : "Confirmar baixa"}</button>
          </div>
        </div>
      </div>}
    </aside>
  </>;
}

function zipStatusColor(status: StatusContratoCliente): CSSProperties {
  if (status === "ativo") return { color: "var(--ok)" };
  if (status === "suspenso") return { color: "var(--gold)" };
  return { color: "var(--bad)" };
}
