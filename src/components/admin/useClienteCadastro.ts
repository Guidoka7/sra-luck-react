import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { formatarCpf } from "@/lib/cpf";
import { desmascararMoeda, mascararMoedaInput, percentualNecessario } from "@/lib/utils";
import type { Boleto, Carne, Cliente, ImportacaoBoleto, LogAlteracao, NovaVenda, QuantidadeParcelas, StatusContratoCliente } from "@/types/database";
import { STATUS_CONTRATO_LABEL, TAXA_ADMINISTRATIVA_PADRAO } from "@/types/database";
import { financeiroApi } from "@/features/financeiro/financeiroApi";
import { dataNascimentoValida } from "../../../worker/app-access";
const moedaNumero = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Estado e ações reais do cadastro da cliente (Perfil + Financeiro).
 * Implementação única usada pelo drawer compartilhado da cliente
 * (Clientes, Financeiro e Central de acompanhamento).
 * Perfil e Financeiro compartilham estado (ex.: salvar o perfil também envia
 * carta de crédito/taxa), por isso ficam no mesmo hook.
 */
export function useClienteCadastro(cliente: Cliente | null, { onSalvo, onClose, preCadastro = null }: { onSalvo: (cliente?: Cliente) => void; onClose: () => void; preCadastro?: NovaVenda | null }) {
  const editando = Boolean(cliente);

  const [nome, setNome] = useState(cliente?.nome_completo ?? preCadastro?.nome_completo ?? "");
  const [cpf, setCpf] = useState(cliente ? formatarCpf(cliente.cpf) : preCadastro?.cpf ? formatarCpf(preCadastro.cpf) : "");
  const [nascimento, setNascimento] = useState(cliente?.data_nascimento ?? "");
  const [telefone, setTelefone] = useState(cliente?.telefone ?? preCadastro?.telefone ?? "");
  const [email, setEmail] = useState(cliente?.email ?? preCadastro?.email ?? "");
  const [procedimento, setProcedimento] = useState(cliente?.procedimento ?? "");
  const [observacoes, setObservacoes] = useState(cliente?.observacoes_internas ?? "");
  const [consultora, setConsultora] = useState(cliente?.consultora ?? preCadastro?.vendedora_responsavel ?? "");
  const [acessoLiberado, setAcessoLiberado] = useState(Boolean(cliente?.acesso_app_liberado));
  const [acessoLiberadoEm, setAcessoLiberadoEm] = useState<string | null>(cliente?.acesso_app_liberado_em ?? null);
  const [liberandoAcesso, setLiberandoAcesso] = useState(false);
  const [alterandoParcela, setAlterandoParcela] = useState(false);
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

  const quantidadeInicial = (cliente?.quantidade_parcelas ?? preCadastro?.quantidade_parcelas ?? 12) as QuantidadeParcelas;
  const taxaInicial = cliente?.taxa_administrativa_percentual ?? preCadastro?.taxa_administrativa ?? TAXA_ADMINISTRATIVA_PADRAO[quantidadeInicial] ?? 0;
  const valorInicial = Number(cliente?.valor_contrato ?? preCadastro?.valor_contrato ?? 0);
  const [carta, setCarta] = useState(valorInicial > 0 ? moedaNumero(valorInicial) : "");
  const [quantidade, setQuantidade] = useState<QuantidadeParcelas>(quantidadeInicial);
  const [taxa, setTaxa] = useState(String(taxaInicial).replace(".", ","));
  const [total, setTotal] = useState(() => valorInicial > 0 ? moedaNumero(valorInicial * (1 + Number(taxaInicial) / 100)) : "");
  const [parcela, setParcela] = useState(preCadastro?.valor_parcela ? moedaNumero(Number(preCadastro.valor_parcela)) : "");
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
  const [validando, setValidando] = useState(false);

  const cartaNumero = Number(desmascararMoeda(carta)) || 0;
  const taxaNumero = Number(taxa.replace(",", ".")) || 0;
  const totalNumero = Number(desmascararMoeda(total)) || 0;
  const parcelaNumero = Number(desmascararMoeda(parcela)) || 0;
  const totalAutomatico = cartaNumero * (1 + taxaNumero / 100);
  const parcelaAutomatica = quantidade ? totalAutomatico / quantidade : 0;

  useEffect(() => { if (!parcela && !parcelaManual && parcelaAutomatica > 0) setParcela(moedaNumero(parcelaAutomatica)); }, [parcela, parcelaManual, parcelaAutomatica]);
  function atualizarCarta(valor: string) { const novo = mascararMoedaInput(valor); setCarta(novo); const n = Number(desmascararMoeda(novo)) || 0; const t = n * (1 + taxaNumero / 100); setTotal(moedaNumero(t)); if (!parcelaManual) setParcela(moedaNumero(quantidade ? t / quantidade : 0)); }
  function atualizarTaxa(valor: string) { setTaxa(valor); const n = Number(valor.replace(",", ".")) || 0; const t = cartaNumero * (1 + n / 100); setTotal(moedaNumero(t)); if (!parcelaManual) setParcela(moedaNumero(quantidade ? t / quantidade : 0)); }
  function atualizarQuantidade(valor: string) { const q = Number(valor) as QuantidadeParcelas; setQuantidade(q); if (!parcelaManual) setParcela(moedaNumero(q ? totalNumero / q : 0)); }
  function atualizarParcela(valor: string) { setParcelaManual(true); setParcela(mascararMoedaInput(valor)); }

  async function carregarBoletos() { if (!cliente?.id) { setBoletos([]); setParcelaManual(false); setCarregandoFin(false); return; } setCarregandoFin(true); try { const r = await fetch(`/api/admin/clientes/${cliente.id}/boletos`, { cache: "no-store" }); const d = await r.json(); if (!r.ok) throw new Error(d.erro ?? "Não foi possível carregar os boletos."); const lista = d.boletos ?? []; setBoletos(lista); if (d.cliente?.valor_contrato != null) setCarta(moedaNumero(Number(d.cliente.valor_contrato))); if (d.cliente?.taxa_administrativa_percentual != null) setTaxa(String(d.cliente.taxa_administrativa_percentual).replace(".", ",")); if (d.cliente?.custo_total != null) setTotal(moedaNumero(Number(d.cliente.custo_total))); if (lista[0]?.total_parcelas) setQuantidade(Number(lista[0].total_parcelas) as QuantidadeParcelas); if (lista[0]?.valor) { setParcela(moedaNumero(Number(lista[0].valor))); setParcelaManual(true); } else setParcelaManual(false); } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao carregar parcelas."); } finally { setCarregandoFin(false); } }
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

  async function salvarPerfil(e: FormEvent) {
    e.preventDefault();
    if (!nome || !nascimento) return toast.error("Preencha nome e data de nascimento.");
    if (!dataNascimentoValida(nascimento)) return toast.error("Informe uma data de nascimento válida.");
    const cpfLimpo = cpf.replace(/\D/g, "");
    if (!editando && cpfLimpo.length !== 11) return toast.error("Informe um CPF válido para concluir o cadastro.");
    setSalvandoPerfil(true);
    try {
      const origemCrm = Boolean(preCadastro && !editando);
      const url = editando
        ? `/api/admin/clientes/${cliente!.id}`
        : origemCrm
          ? `/api/admin/novas-vendas/${encodeURIComponent(preCadastro!.id)}/cadastrar`
          : "/api/admin/clientes";
      const r = await fetch(url, {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nomeCompleto: nome,
          cpf,
          dataNascimento: nascimento,
          telefone,
          email,
          procedimento,
          consultora: consultora.trim() || null,
          observacoes,
          valorContrato: cartaNumero || undefined,
          taxaAdministrativaPercentual: taxaNumero || undefined,
          quantidadeParcelas: quantidade || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro ?? "Não foi possível salvar.");
      toast.success(editando ? "Perfil atualizado." : origemCrm ? "Pré-cadastro concluído. Cliente vinculada ao CRM." : "Cliente cadastrada. Configure o financeiro na aba Financeiro.");
      onSalvo(d.cliente ?? undefined);
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

  async function excluirCliente() { if (!cliente?.id) return; setExcluindo(true); try { const r = await fetch(`/api/admin/clientes/${cliente.id}`, { method: "DELETE" }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.erro ?? "Não foi possível excluir o perfil da cliente."); toast.success(d.arquivado ? "Perfil removido das áreas operacionais. O histórico foi preservado." : "Perfil da cliente excluído com sucesso."); setConfirmarExclusao(false); onSalvo(); onClose(); } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao excluir o perfil."); } finally { setExcluindo(false); } }

  async function criarCarne(e: FormEvent) {
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

  async function confirmarPagamento(alvo: Boleto | null = aguardandoConferencia ?? null) {
    if (!alvo) return false;
    setValidando(true);
    try {
      await financeiroApi.validar(alvo.id, "confirmar", "");
      toast.success("Pagamento confirmado.");
      await carregarBoletos();
      void carregarPerfilExtra();
      onSalvo();
      return true;
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível confirmar o pagamento."); return false; }
    finally { setValidando(false); }
  }
  /** Rejeição exige motivo (validado também no servidor). */
  async function rejeitarComprovante(motivo: string, alvo: Boleto | null = aguardandoConferencia ?? null) {
    if (!alvo) return false;
    if (!motivo.trim()) { toast.error("Informe o motivo da rejeição."); return false; }
    setValidando(true);
    try {
      await financeiroApi.validar(alvo.id, "rejeitar", motivo.trim());
      toast.success("Comprovante rejeitado. Parcela voltou para aberto.");
      await carregarBoletos();
      void carregarPerfilExtra();
      onSalvo();
      return true;
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível rejeitar o comprovante."); return false; }
    finally { setValidando(false); }
  }

  /** Editar/suspender/reabrir/excluir parcela — `/api/admin/financeiro/recebiveis/:id`. */
  async function alterarParcela(alvo: Boleto, payload: { acao: "editar" | "suspender" | "reabrir" | "excluir"; valor?: number; dataVencimento?: string; observacoes?: string }, sucesso: string) {
    if (alterandoParcela) return false;
    setAlterandoParcela(true);
    try {
      await financeiroApi.alterar(alvo.id, payload);
      toast.success(sucesso);
      await carregarBoletos();
      void carregarPerfilExtra();
      onSalvo();
      return true;
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível alterar a parcela."); return false; }
    finally { setAlterandoParcela(false); }
  }
  async function anexarComprovante(alvo: Boleto, arquivo: File) {
    if (alterandoParcela) return false;
    setAlterandoParcela(true);
    try {
      await financeiroApi.anexarComprovante(alvo.id, arquivo);
      toast.success("Comprovante anexado.");
      await carregarBoletos();
      void carregarPerfilExtra();
      onSalvo();
      return true;
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível anexar o comprovante."); return false; }
    finally { setAlterandoParcela(false); }
  }
  /** Link assinado de curta duração (o storage é privado). */
  const comprovanteHref = (alvo: Boleto) => `/api/admin/boletos/${encodeURIComponent(alvo.id)}/comprovante`;

  /** Liberação do acesso ao app — regra e requisitos validados no servidor. */
  async function liberarAcessoApp() {
    if (!cliente?.id || acessoLiberado || liberandoAcesso) return;
    setLiberandoAcesso(true);
    try {
      const r = await fetch(`/api/admin/clientes/${encodeURIComponent(cliente.id)}/liberar-acesso-app`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro ?? "Não foi possível liberar o acesso ao aplicativo.");
      setAcessoLiberado(Boolean(d.cliente?.acesso_app_liberado ?? true));
      setAcessoLiberadoEm(d.cliente?.acesso_app_liberado_em ?? null);
      toast.success(d.jaLiberado ? "O acesso ao aplicativo já estava liberado." : "Acesso ao aplicativo liberado.");
      void carregarPerfilExtra();
      onSalvo();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível liberar o acesso ao aplicativo."); }
    finally { setLiberandoAcesso(false); }
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
      await carregarBoletos();
      void carregarPerfilExtra();
      onSalvo();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível registrar a baixa."); }
    finally { setSalvandoBaixa(false); }
  }

  const hojeIso = new Date().toISOString().slice(0, 10);
  const vencidas = boletos.filter((b) => b.status !== "pago" && b.data_vencimento && b.data_vencimento < hojeIso).length;
  const situacao = statusContrato === "cancelado" ? "Contrato cancelado" : vencidas > 0 ? "Em atraso" : "Em dia";
  const situacaoKind = statusContrato === "cancelado" ? "neutral" as const : vencidas > 0 ? "bad" as const : "ok" as const;
  const totalParcelasReal = boletos.length || cliente?.quantidade_parcelas || 0;
  const percentualMeta = percentualNecessario(totalParcelasReal || undefined);
  const metaParcelas = totalParcelasReal ? Math.ceil((totalParcelasReal * percentualMeta) / 100) : 0;
  const elegivel = totalParcelasReal > 0 && pagas >= metaParcelas;
  const statusKind = statusContrato === "ativo" ? "ok" as const : statusContrato === "suspenso" ? "warn" as const : "bad" as const;

  return {
    cliente, preCadastro, editando,
    consultora, setConsultora, acessoLiberado, acessoLiberadoEm, liberandoAcesso, liberarAcessoApp,
    alterandoParcela, alterarParcela, anexarComprovante, comprovanteHref, carregarPerfilExtra,
    nome, setNome, cpf, setCpf, nascimento, setNascimento, telefone, setTelefone, email, setEmail, procedimento, setProcedimento, observacoes, setObservacoes,
    salvandoPerfil, salvarPerfil,
    excluindo, confirmarExclusao, setConfirmarExclusao, excluirCliente,
    statusContrato, statusMenuAberto, setStatusMenuAberto, suspensoDesde, setSuspensoDesde, suspensoAte, setSuspensoAte, suspensaoMotivo, setSuspensaoMotivo, salvandoStatus, aplicarStatusContrato, statusKind,
    historico, historicoAberto, setHistoricoAberto,
    carta, atualizarCarta, taxa, atualizarTaxa, quantidade, atualizarQuantidade, parcela, atualizarParcela, vencimento, setVencimento,
    boletos, visiveis, pagas, mostrarTodas, setMostrarTodas, carregandoFin, salvandoFin, gerarOuAjustarParcelas, carregarBoletos,
    carnes, importacoes, pendentesRevisao, novoCarneBanco, setNovoCarneBanco, novoCarneIdentificador, setNovoCarneIdentificador, novoCarneData, setNovoCarneData, criandoCarne, criarCarne, importando, importarCarne, vincularImportacao, ignorarImportacao,
    proximaLiberacao, aguardandoConferencia, validando, confirmarPagamento, rejeitarComprovante,
    baixaAlvo, setBaixaAlvo, baixaData, setBaixaData, baixaJuros, setBaixaJuros, baixaMulta, setBaixaMulta, baixaForma, setBaixaForma, baixaBanco, setBaixaBanco, baixaObs, setBaixaObs, baixaArquivo, setBaixaArquivo, salvandoBaixa, abrirBaixaManual, confirmarBaixaManual,
    vencidas, situacao, situacaoKind, totalParcelasReal, percentualMeta, metaParcelas, elegivel,
  };
}

export type ClienteCadastro = ReturnType<typeof useClienteCadastro>;
