import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Cliente, StatusContratoCliente } from "@/types/database";
import { STATUS_CONTRATO_LABEL } from "@/types/database";
import { deriveJourneySteps, journeyInputFromProcess } from "@/lib/journeySteps";
import { JourneyStepsView } from "@/components/journey/JourneyStepsView";
import { useClienteCadastro, type ClienteCadastro } from "@/components/admin-zip/cliente/useClienteCadastro";
import { ClienteProfilePanel } from "@/components/admin-zip/cliente/ClienteProfilePanel";
import { ClienteFinancePanel } from "@/components/admin-zip/cliente/ClienteFinancePanel";
import { ClienteCadastroModals } from "@/components/admin-zip/cliente/ClienteCadastroModals";
import { centralApi, iniciais, type FormaCusteio } from "./api";
import type { CartaoCliente, EstagioCentral, EstagioDrawer } from "./types";
import { ProcessoTab, ordemEstagio, type ModalDrawer, type FormLevantamento, eventosDoProcesso } from "./ProcessoTab";
import { AgendarCirurgiaModal, LiberacaoModal, QuitacaoModal, ResponsavelModal } from "./DrawerModals";
import { TermsRescheduleModal } from "./TermsRescheduleModal";
import { ConfirmModal } from "./V46Modal";
import { estadoLiberacao, faltamTexto } from "./v46Cards";

type Aba = "process" | "profile" | "finance" | "journey";

export interface DrawerProps {
  clienteId: string;
  estagioOrigem: EstagioCentral | null;
  hoje: string;
  sugestoesResponsavel: string[];
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onIrParaAgenda: (tipo: "terms" | "surgery", data: string | null) => void;
}

/**
 * Drawer V46 (`.client-drawer`): cabeçalho, abas segmentadas
 * Processo/Perfil/Financeiro/Jornada e barra de ações. Perfil e Financeiro
 * são os painéis reais compartilhados com Clientes e Financeiro
 * (`components/admin-zip/cliente/*`); Jornada usa o mesmo adaptador do app.
 */
export function ClienteProcessDrawer(props: DrawerProps) {
  const { clienteId, onClose } = props;
  const [central, setCentral] = useState<{ estagio: EstagioDrawer; cartao: CartaoCliente } | null>(null);
  const [cadastro, setCadastro] = useState<Cliente | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [r, cli] = await Promise.all([centralApi.cliente(clienteId), centralApi.clienteCadastro(clienteId)]);
      if (!cli) throw new Error("Cadastro da cliente não encontrado.");
      setCentral(r); setCadastro(cli); setErro(null);
      return r;
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar este processo.");
      return null;
    }
  }, [clienteId]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { const id = requestAnimationFrame(() => setAberto(true)); return () => cancelAnimationFrame(id); }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return <>
    <div className="drawer-backdrop" onClick={onClose} />
    <aside className={`client-drawer${aberto ? " open" : ""}`} aria-label="Detalhes da cliente" aria-hidden={false} role="dialog" aria-modal="true">
      {erro && !central
        ? <DrawerFallback mensagem={erro} onTentar={() => { setErro(null); void carregar(); }} onClose={onClose} />
        : !central || !cadastro
          ? <DrawerFallback carregando onClose={onClose} />
          : <DrawerErrorBoundary onClose={onClose}>
              <DrawerCarregado key={cadastro.id} {...props} central={central} cadastroInicial={cadastro} recarregarBase={carregar} setCadastro={setCadastro} cadastroAtual={cadastro} />
            </DrawerErrorBoundary>}
    </aside>
  </>;
}

function DrawerFallback({ mensagem, carregando, onTentar, onClose }: { mensagem?: string; carregando?: boolean; onTentar?: () => void; onClose: () => void }) {
  return <>
    <div className="drawer-header"><div className="drawer-title-row">
      <div className="avatar" aria-hidden="true">…</div>
      <div className="drawer-head-copy"><h2>{carregando ? "Carregando processo…" : "Processo indisponível"}</h2><p>{carregando ? "Buscando dados reais da cliente." : mensagem}</p></div>
      <div className="drawer-head-controls"><button type="button" className="icon-btn drawer-close" aria-label="Fechar drawer" onClick={onClose}>✕</button></div>
    </div></div>
    <div className="drawer-body">
      {carregando ? <div className="empty-card">Carregando…</div> : <div className="callout danger" role="alert">{mensagem}</div>}
    </div>
    {!carregando && onTentar && <div className="drawer-actions"><button type="button" className="secondary-btn" onClick={onClose}>Fechar</button><button type="button" className="primary-btn" onClick={onTentar}>Tentar novamente</button></div>}
  </>;
}

class DrawerErrorBoundary extends Component<{ children: ReactNode; onClose: () => void }, { erro: Error | null }> {
  state = { erro: null as Error | null };
  static getDerivedStateFromError(erro: Error) { return { erro }; }
  render() {
    if (this.state.erro) return <DrawerFallback mensagem="Não foi possível exibir este processo. Recarregue a página ou tente novamente." onTentar={() => this.setState({ erro: null })} onClose={this.props.onClose} />;
    return this.props.children;
  }
}

function realDe(estagio: EstagioDrawer): EstagioCentral {
  return estagio === "concluido" ? "surgeryConfirmed" : estagio;
}

function DrawerCarregado({ central, cadastroInicial, cadastroAtual, setCadastro, recarregarBase, estagioOrigem, hoje, sugestoesResponsavel, onClose, onChanged, onIrParaAgenda }: DrawerProps & {
  central: { estagio: EstagioDrawer; cartao: CartaoCliente };
  cadastroInicial: Cliente;
  cadastroAtual: Cliente;
  setCadastro: (c: Cliente) => void;
  recarregarBase: () => Promise<{ estagio: EstagioDrawer; cartao: CartaoCliente } | null>;
}) {
  const c = central.cartao;
  const real = realDe(central.estagio);
  const concluido = central.estagio === "concluido" || Boolean(c.processoConcluidoEm);
  const [aba, setAba] = useState<Aba>("process");
  const [estagio, setEstagio] = useState<EstagioCentral>(() => estagioOrigem && ordemEstagio(estagioOrigem) <= ordemEstagio(real) ? estagioOrigem : real);
  const [modal, setModal] = useState<ModalDrawer>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const ocupadoRef = useRef<string | null>(null);

  const recarregar = useCallback(async () => {
    const r = await recarregarBase();
    if (r) setEstagio(realDe(r.estagio));
    await onChanged();
  }, [recarregarBase, onChanged]);

  const cad = useClienteCadastro(cadastroInicial, { onSalvo: () => { void recarregar(); }, onClose });

  const executar = useCallback(async (chave: string, fn: () => Promise<unknown>, sucesso: string) => {
    if (ocupadoRef.current) return false;
    ocupadoRef.current = chave; setOcupado(chave);
    try { await fn(); toast.success(sucesso); await recarregar(); return true; }
    catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível concluir a ação."); return false; }
    finally { ocupadoRef.current = null; setOcupado(null); }
  }, [recarregar]);

  const form = useFormLevantamento(cadastroAtual, cad);

  async function concluirLevantamento(decisao: "aprovada" | "recusada", observacao?: string) {
    if (decisao === "aprovada") {
      const saldo = Number(String(form.saldo).replace(/\./g, "").replace(",", "."));
      const taxa = Number(String(form.taxa).replace(",", "."));
      if (!Number.isFinite(saldo) || saldo < 0) { toast.error("Informe um saldo restante válido."); return false; }
      if (!Number.isFinite(taxa) || taxa < 0) { toast.error("Informe uma taxa de cartão válida."); return false; }
      if (!form.formas.length) { toast.error("Selecione ao menos uma forma de quitação."); return false; }
      return executar("levantamento", async () => {
        const r = await centralApi.concluirLevantamento(c.id, { decisao, saldoRestante: saldo, taxaCartao: taxa, formasCusteio: form.formas });
        if (r?.cliente) setCadastro({ ...cadastroAtual, ...r.cliente });
      }, "Levantamento concluído. Agenda de termos disponível no app.");
    }
    return executar("divergencia", async () => {
      const r = await centralApi.concluirLevantamento(c.id, { decisao, observacao: observacao || undefined });
      if (r?.cliente) setCadastro({ ...cadastroAtual, ...r.cliente });
    }, "Divergência registrada e cliente notificada.");
  }

  const eLib = estadoLiberacao(c, hoje);
  const historico = estagio !== real && ordemEstagio(estagio) < ordemEstagio(real);
  const statusBadge = estagio === "surgeryConfirmed" || eLib.liberada ? "success" : estagio === "preEligibility" ? "danger" : estagio === "financialRelease" ? "wait" : "info";
  const pagoBadge = c.quitacaoStatus === "paga" ? "Contrato quitado" : `${c.parcelasPagas}/${c.totalParcelas} parcelas`;
  const proximoBoleto = useMemo(() => [...cad.boletos].filter((b) => b.status !== "pago" && !b.suspensa).sort((a, b) => a.numero_parcela - b.numero_parcela)[0] ?? null, [cad.boletos]);

  function registrarParcela() {
    if (!proximoBoleto) { toast.warning("Não há parcela em aberto para registrar."); return; }
    cad.abrirBaixaManual(proximoBoleto);
  }

  function alterarStatus(novo: StatusContratoCliente) {
    if (novo === "suspenso") {
      setAba("profile");
      cad.setStatusMenuAberto(true);
      toast.info("Informe o período e o motivo da suspensão no Perfil.");
      return;
    }
    void cad.aplicarStatusContrato(novo);
  }

  const snapshot = journeyInputFromProcess({
    percentualPagamento: c.totalParcelas ? (c.parcelasPagas / c.totalParcelas) * 100 : 0,
    percentualAtingido: c.parcelasFaltantes === 0,
    statusRevisao: c.statusRevisaoFinanceira,
    custeioStatus: c.custeioStatus,
    temAgendamentoTermos: Boolean(c.dataTermos),
    comparecimentoConfirmado: c.comparecimentoStatus === "compareceu",
    processoConcluido: concluido,
    agendaCirurgicaLiberadaEm: c.agendaCirurgicaLiberadaEm,
    dataCirurgia: c.dataCirurgia,
    cirurgiaRealizada: c.statusCirurgia === "realizada",
  });
  const passos = deriveJourneySteps(snapshot);
  const eventos = eventosDoProcesso(c, cad);

  const acoes = acoesDaBarra();
  function acoesDaBarra(): ReactNode {
    const btn = (rotulo: string, onClick: () => void, cls = "secondary-btn", disabled = false) => <button key={rotulo} type="button" className={cls} onClick={onClick} disabled={disabled || Boolean(ocupado)}>{rotulo}</button>;
    if (historico) return btn("Voltar à etapa atual", () => { setEstagio(real); setAba("process"); }, "primary-btn");
    if (aba === "process") {
      if (estagio === "preEligibility") return c.parcelasFaltantes === 0
        ? btn("Ver Financeiro", () => setAba("finance"))
        : <>{btn("Ver Financeiro", () => setAba("finance"))}{btn("Registrar parcela paga", registrarParcela, "primary-btn", !proximoBoleto)}</>;
      if (estagio === "financialReview") return c.statusRevisaoFinanceira === "aprovada"
        ? btn("Ver levantamento", () => setAba("finance"))
        : <>{btn("Conferir Financeiro", () => setAba("finance"))}{btn(ocupado === "levantamento" ? "Salvando…" : "Concluir levantamento", () => void concluirLevantamento("aprovada"), "primary-btn")}</>;
      if (estagio === "termsConfirmed") return <>{btn("Ver Agenda de Termos", () => { onClose(); onIrParaAgenda("terms", c.dataTermos); })}{btn("Reagendar", () => setModal({ tipo: "reagendar" }), "primary-btn", !c.agendamentoId)}</>;
      if (estagio === "financialRelease") {
        if (!c.previsaoConfirmadaEm) return btn("Ver Jornada completa", () => setAba("journey"));
        if (eLib.liberada && !c.dataCirurgia) return btn("Agendar cirurgia", () => setModal({ tipo: "agendarCirurgia" }), "success-btn");
        if (!eLib.compareceu) return btn("Confirmar comparecimento", () => setModal({ tipo: "comparecimento", compareceu: true }), "primary-btn");
        if (!eLib.quitada) return btn("Confirmar quitação", () => setModal({ tipo: "quitacao" }), "primary-btn");
        return btn("Ver Jornada completa", () => setAba("journey"));
      }
      return <>{btn("Ver na Agenda Cirúrgica", () => { onClose(); onIrParaAgenda("surgery", c.dataCirurgia); }, "primary-btn")}{btn("Ver Jornada", () => setAba("journey"))}</>;
    }
    if (aba === "finance") {
      if (estagio === "preEligibility" && c.parcelasFaltantes > 0) return <>{btn("Voltar ao Processo", () => setAba("process"))}{btn("Registrar próxima parcela", registrarParcela, "primary-btn", !proximoBoleto)}</>;
      if (estagio === "financialRelease" && c.previsaoConfirmadaEm && !eLib.quitada) return <>{btn("Voltar ao Processo", () => setAba("process"))}{btn("Registrar quitação", () => setModal({ tipo: "quitacao" }), "primary-btn")}</>;
      return btn("Voltar ao Processo", () => setAba("process"));
    }
    if (aba === "journey") return btn("Voltar ao Processo", () => setAba("process"), "primary-btn");
    return <>{btn("Voltar ao Processo", () => setAba("process"))}<button type="submit" form="central-drawer-perfil" className="primary-btn" disabled={cad.salvandoPerfil}>{cad.salvandoPerfil ? "Salvando…" : "Salvar perfil"}</button></>;
  }

  return <>
    <div className="drawer-header">
      <div className="drawer-title-row">
        <div className="avatar" aria-hidden="true">{iniciais(c.nome)}</div>
        <div className="drawer-head-copy">
          <h2>{c.nome}</h2>
          <p>{c.procedimento || "—"}</p>
          <div className="drawer-head-meta">
            <span className={`badge ${statusBadge}`}>{statusDoDrawer(c, estagio, concluido, hoje)}</span>
            <span className="subtle-pill">{pagoBadge}</span>
          </div>
        </div>
        <div className="drawer-head-controls">
          <label className="status-control" title="Status do contrato">
            <span>Status</span>
            <select value={cad.statusContrato} onChange={(e) => alterarStatus(e.target.value as StatusContratoCliente)} disabled={cad.salvandoStatus} aria-label="Status do contrato">
              {(Object.keys(STATUS_CONTRATO_LABEL) as StatusContratoCliente[]).map((s) => <option key={s} value={s}>{STATUS_CONTRATO_LABEL[s]}</option>)}
            </select>
          </label>
          <button type="button" className="icon-btn drawer-close" aria-label="Fechar drawer" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="drawer-tabs" role="tablist" aria-label="Seções da cliente">
        {([["process", "Processo"], ["profile", "Perfil"], ["finance", "Financeiro"], ["journey", "Jornada"]] as [Aba, string][]).map(([id, rotulo]) => <button key={id} type="button" role="tab" aria-selected={aba === id} className={`drawer-tab${aba === id ? " active" : ""}`} onClick={() => setAba(id)}>
          {rotulo}{id === "finance" && <> <span className="tab-count">{cad.boletos.length || c.totalParcelas}</span></>}
        </button>)}
      </div>
    </div>

    <div className="drawer-body" role="tabpanel">
      {aba === "process" && <ProcessoTab c={c} cad={cad} cadastro={cadastroAtual} real={real} estagio={estagio} concluido={concluido} hoje={hoje} ocupado={ocupado} form={form}
        eventos={eventos} executar={executar} abrirModal={setModal} irParaEstagio={(s) => { setEstagio(s); setAba("process"); }}
        registrarParcela={registrarParcela} temParcelaAberta={Boolean(proximoBoleto)} concluirLevantamento={concluirLevantamento}
        irParaAgenda={(tipo, data) => { onClose(); onIrParaAgenda(tipo, data); }} />}
      {aba === "profile" && <div className="zip-admin v46-embed"><ClienteProfilePanel cad={cad} formId="central-drawer-perfil" /></div>}
      {aba === "finance" && <div className="zip-admin v46-embed"><ClienteFinancePanel cad={cad} /></div>}
      {aba === "journey" && <div className="process-page">
        <section className="process-map-card">
          <div className="process-map-head"><div><b>Jornada completa</b><small>Mesma lógica de evolução refletida no app da cliente</small></div><span className="subtle-pill">{passos.length} marcos</span></div>
        </section>
        <section className="drawer-section">
          <div className="drawer-section-head"><span>Jornada da cliente</span><span className="subtle-pill">Espelhada no app</span></div>
          <div className="drawer-section-body"><JourneyStepsView passos={passos} variant="compact" /></div>
        </section>
        <details className="drawer-accordion"><summary>Histórico operacional <span>{eventos.length}</span></summary><div className="accordion-body"><div className="history-list">
          {eventos.length ? eventos.slice(0, 30).map((ev) => <div key={ev.id} className="history-item"><b>{ev.texto}</b><small>{new Date(ev.em).toLocaleString("pt-BR")}</small></div>) : <div className="empty-card">Sem eventos registrados.</div>}
        </div></div></details>
      </div>}
    </div>

    <div className="drawer-actions">{acoes}</div>

    <div className="zip-admin"><ClienteCadastroModals cad={cad} /></div>

    {modal?.tipo === "responsavel" && c.agendamentoId && <ResponsavelModal agendamentoId={c.agendamentoId} atual={c.termosResponsavel} sugestoes={sugestoesResponsavel} onClose={() => setModal(null)} onSalvo={recarregar} />}
    {modal?.tipo === "reagendar" && c.agendamentoId && <TermsRescheduleModal agendamentoId={c.agendamentoId} nome={c.nome} dataAtual={c.dataTermos} horarioAtual={c.horarioTermos} hoje={hoje} onClose={() => setModal(null)} onDone={recarregar} />}
    {modal?.tipo === "quitacao" && c.agendamentoId && <QuitacaoModal c={c} saldo={c.custeioSaldo ?? cadastroAtual.financeiro_saldo_restante ?? null} onClose={() => setModal(null)} executar={executar} />}
    {modal?.tipo === "liberacao" && c.agendamentoId && <LiberacaoModal c={c} estado={eLib} onClose={() => setModal(null)} executar={executar} />}
    {modal?.tipo === "agendarCirurgia" && <AgendarCirurgiaModal clientes={[c]} hoje={hoje} onClose={() => setModal(null)} onAgendado={recarregar} />}
    {modal?.tipo === "comparecimento" && c.agendamentoId && <ConfirmModal
      titulo={modal.compareceu ? "Confirmar comparecimento" : "Registrar ausência"}
      mensagem={modal.compareceu ? `Confirmar que ${c.nome} compareceu para a assinatura dos termos?` : "A cliente não compareceu. O agendamento será cancelado, a vaga volta para a agenda e a cliente poderá escolher uma nova data no app. A contagem do prazo não começa."}
      rotuloConfirmar={modal.compareceu ? "Confirmar comparecimento" : "Registrar ausência"} perigo={!modal.compareceu}
      onConfirmar={() => executar("comparecimento", () => centralApi.registrarComparecimento(c.agendamentoId!, modal.compareceu), modal.compareceu ? "Comparecimento confirmado." : "Ausência registrada. Agenda de Termos reaberta para a cliente.")}
      onClose={() => setModal(null)} />}
    {modal?.tipo === "naoQuitado" && c.agendamentoId && <ConfirmModal titulo="Saldo não quitado"
      mensagem="O saldo não foi quitado no dia da assinatura. O agendamento será cancelado, a Agenda Cirúrgica permanece bloqueada e a cliente poderá escolher uma nova data dos termos no app."
      rotuloConfirmar="Registrar pendência" perigo
      onConfirmar={() => executar("quitacao", () => centralApi.registrarQuitacao(c.agendamentoId!, false), "Pendência de pagamento registrada.")}
      onClose={() => setModal(null)} />}
    {modal?.tipo === "pagamentoCirurgia" && c.agendamentoId && <ConfirmModal titulo="Confirmar pagamento da cirurgia"
      mensagem="O processo será concluído, sairá das filas operacionais e ficará arquivado na data cirúrgica."
      rotuloConfirmar="Confirmar pagamento"
      onConfirmar={async () => { const ok = await executar("pagamentoCirurgia", () => centralApi.confirmarPagamentoCirurgia(c.agendamentoId!), "Pagamento confirmado. Processo concluído e arquivado na Agenda Cirúrgica."); if (ok) onClose(); return ok; }}
      onClose={() => setModal(null)} />}
    {modal?.tipo === "divergencia" && <DivergenciaModal onClose={() => setModal(null)} onConfirmar={(obs) => concluirLevantamento("recusada", obs)} />}
  </>;
}

function statusDoDrawer(c: CartaoCliente, estagio: EstagioCentral, concluido: boolean, hoje: string): string {
  if (estagio === "preEligibility") return c.parcelasFaltantes === 0 ? "Etapa 1 · Aguardando solicitação" : `Etapa 1 · ${faltamTexto(c.parcelasFaltantes)}`;
  if (estagio === "financialReview") return c.statusRevisaoFinanceira === "aprovada" ? "Etapa 2 · Aguardando escolha dos termos" : "Etapa 2 · Levantamento";
  if (estagio === "termsConfirmed") return "Etapa 3 · Próximos termos";
  if (estagio === "financialRelease") {
    const e = estadoLiberacao(c, hoje);
    if (e.liberada) return "Etapa 4 · Agenda cirúrgica liberada";
    if (e.ambos) return e.decorridos === 0 ? `Etapa 4 · Aguardando prazo de ${e.totalDias} dias úteis` : `Etapa 4 · ${e.decorridos} de ${e.totalDias} dias úteis`;
    return "Etapa 4 · Conferência presencial";
  }
  return concluido ? "Etapa 5 · Processo concluído" : "Etapa 5 · Cirurgia confirmada";
}

function useFormLevantamento(cliente: Cliente, cad: ClienteCadastro): FormLevantamento {
  const formasIniciais = (cliente.financeiro_formas_custeio?.length ? cliente.financeiro_formas_custeio : ["cartao", "pix", "cheques", "boleto_100"]) as FormaCusteio[];
  const [saldo, setSaldoState] = useState(cliente.financeiro_saldo_restante != null ? String(cliente.financeiro_saldo_restante) : "");
  const [editado, setEditado] = useState(cliente.financeiro_saldo_restante != null);
  const [taxa, setTaxa] = useState(cliente.financeiro_taxa_cartao != null ? String(cliente.financeiro_taxa_cartao) : "5.4");
  const [formas, setFormas] = useState<FormaCusteio[]>(formasIniciais);
  const emAberto = useMemo(() => cad.boletos.filter((b) => b.status !== "pago").reduce((s, b) => s + Number(b.valor || 0), 0), [cad.boletos]);
  useEffect(() => { if (!editado && cad.boletos.length) setSaldoState(emAberto.toFixed(2)); }, [editado, emAberto, cad.boletos.length]);
  return {
    saldo, setSaldo: (v: string) => { setEditado(true); setSaldoState(v); }, taxa, setTaxa, formas,
    alternarForma: (f: FormaCusteio) => setFormas((a) => a.includes(f) ? a.filter((x) => x !== f) : [...a, f]),
    emAberto,
  };
}

function DivergenciaModal({ onClose, onConfirmar }: { onClose: () => void; onConfirmar: (obs: string) => Promise<boolean> }) {
  const [obs, setObs] = useState("");
  return <ConfirmModal titulo="Registrar divergência no levantamento" rotuloConfirmar="Registrar divergência" perigo
    mensagem={<span className="field" style={{ display: "block" }}>
      <label htmlFor="central-divergencia">Descreva a divergência encontrada (opcional)</label>
      <textarea id="central-divergencia" value={obs} onChange={(e) => setObs(e.target.value)} rows={3} maxLength={500} />
      <small>A cliente é notificada para regularizar e o levantamento poderá ser refeito.</small>
    </span>}
    onConfirmar={() => onConfirmar(obs.trim())} onClose={onClose} />;
}
