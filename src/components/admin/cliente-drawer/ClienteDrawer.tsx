import { Component, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import type { Cliente, StatusContratoCliente } from "@/types/database";
import { centralApi, type FormaCusteio } from "@/features/scheduling/api";
import type { CartaoCliente, EstagioCentral, EstagioDrawer } from "@/features/scheduling/types";
import { ProcessoTab, ordemEstagio, eventosDoProcesso, type ModalDrawer, type FormLevantamento } from "@/features/scheduling/ProcessoTab";
import { AgendarCirurgiaModal, LiberacaoModal, QuitacaoModal, ResponsavelModal } from "@/features/scheduling/DrawerModals";
import { TermsRescheduleModal } from "@/features/scheduling/TermsRescheduleModal";
import { ConfirmModal } from "@/features/scheduling/V46Modal";
import { estadoLiberacao } from "@/features/scheduling/v46Cards";
import { formatarTaxa, formatarValor, normalizarFormas, validarLevantamento } from "@/features/scheduling/levantamento";
import "@/features/scheduling/central-v46.css";
import { useClienteCadastro, type ClienteCadastro } from "../useClienteCadastro";
import { PerfilPanel } from "./PerfilPanel";
import { BaixaManualModal, FinanceiroPanel, Shell, type FinanceiroPanelHandle } from "./FinanceiroPanel";
import { JornadaPanel } from "./JornadaPanel";
import { DrawerIcon } from "./DrawerIcons";
import { STATUS_CLIENTE, hojeSaoPaulo, statusCliente } from "./drawerFormat";
import { statusDoDrawer } from "./drawerModel";
import styles from "./ClienteDrawer.module.css";

export type AbaDrawer = "process" | "profile" | "finance" | "journey";
type Central = { estagio: EstagioDrawer; cartao: CartaoCliente };

export interface ClienteDrawerProps {
  /** `null` abre o cadastro de uma nova cliente (somente Perfil). */
  clienteId: string | null;
  /** Cadastro já carregado pela lista (evita uma ida extra à API). */
  cliente?: Cliente | null;
  abaInicial?: AbaDrawer;
  /** Etapa do quadro que originou a abertura (Central); nunca passa da etapa real. */
  estagioOrigem?: EstagioCentral | null;
  /** Data civil do servidor; fora da Central usa a data de São Paulo. */
  hoje?: string | null;
  sugestoesResponsavel?: string[];
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
  /** Na Central troca a aba da agenda; nas demais telas navega para `/admin/agenda`. */
  onIrParaAgenda?: (tipo: "terms" | "surgery", data: string | null) => void;
}

/**
 * Drawer único da cliente (padrão visual aprovado na referência k338) usado
 * por Clientes, Financeiro e Central de acompanhamento. Perfil e Financeiro
 * são os painéis compartilhados sobre `useClienteCadastro`; Processo é o
 * fluxo V46 real (`/api/admin/central/*`); Jornada usa o mesmo adaptador do
 * app da cliente. A Agenda continua sendo a da Central (não é embutida aqui).
 */
export function ClienteDrawer(props: ClienteDrawerProps) {
  const { clienteId, onClose } = props;
  const criando = !clienteId;
  const [cadastro, setCadastro] = useState<Cliente | null>(props.cliente ?? null);
  const [erroCadastro, setErroCadastro] = useState<string | null>(null);
  const [central, setCentral] = useState<Central | null>(null);
  const [erroCentral, setErroCentral] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<number | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const escBloqueado = useRef<() => boolean>(() => false);

  const carregarCadastro = useCallback(async () => {
    if (!clienteId) return null;
    try {
      const c = await centralApi.clienteCadastro(clienteId);
      if (!c) throw new Error("Cadastro da cliente não encontrado.");
      setCadastro(c); setErroCadastro(null);
      return c;
    } catch (e) { setErroCadastro(e instanceof Error ? e.message : "Não foi possível carregar a cliente."); return null; }
  }, [clienteId]);

  const carregarCentral = useCallback(async () => {
    if (!clienteId) return null;
    try { const r = await centralApi.cliente(clienteId); setCentral(r); setErroCentral(null); return r; }
    catch (e) { setErroCentral(e instanceof Error ? e.message : "Não foi possível carregar o processo."); return null; }
  }, [clienteId]);

  useEffect(() => {
    if (!clienteId) return;
    if (!props.cliente) void carregarCadastro();
    void carregarCentral();
    // Carrega uma vez por cliente; `props.cliente` é só o valor inicial.
  }, [clienteId, carregarCadastro, carregarCentral]);

  useEffect(() => {
    lastFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => { setEntered(true); drawerRef.current?.focus(); });
    return () => { cancelAnimationFrame(frame); document.body.style.overflow = overflow; if (closeTimer.current) window.clearTimeout(closeTimer.current); };
  }, []);

  const requestClose = useCallback(() => {
    if (closeTimer.current) return;
    setEntered(false);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      onClose();
      requestAnimationFrame(() => lastFocused.current?.focus());
    }, 220);
  }, [onClose]);

  useEffect(() => {
    // Modais internos tratam ESC em captura e interrompem a propagação.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !escBloqueado.current()) { e.preventDefault(); requestClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const titulo = criando ? "Nova cliente" : cadastro?.nome_completo || central?.cartao.nome || "Cliente";
  const carregando = !criando && !cadastro;

  return createPortal(<div className={styles.root}>
    <div className={`${styles.overlay} ${entered ? styles.open : ""}`} aria-hidden="true" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }} />
    <aside ref={drawerRef} className={`${styles.drawer} ${entered ? styles.open : ""}`} role="dialog" aria-modal="true" aria-labelledby="client-drawer-title" tabIndex={-1}>
      {carregando
        ? <Fallback titulo={titulo} erro={erroCadastro} onTentar={() => { setErroCadastro(null); void carregarCadastro(); }} onClose={requestClose} />
        : <DrawerErrorBoundary titulo={titulo} onClose={requestClose}>
            <DrawerConteudo key={cadastro?.id ?? "nova"} {...props} criando={criando} cadastro={cadastro} setCadastro={setCadastro}
              central={central} erroCentral={erroCentral} carregarCentral={carregarCentral} carregarCadastro={carregarCadastro} requestClose={requestClose} escBloqueado={escBloqueado} />
          </DrawerErrorBoundary>}
    </aside>
  </div>, document.body);
}

function Fallback({ titulo, erro, onTentar, onClose }: { titulo: string; erro: string | null; onTentar: () => void; onClose: () => void }) {
  return <>
    <header className={styles.header}>
      <div className={styles.clientHead}><h2 className={styles.title} id="client-drawer-title">{erro ? "Cliente indisponível" : titulo}</h2></div>
      <div className={styles.actions}><button className={styles.iconBtn} type="button" aria-label="Fechar" onClick={onClose}><DrawerIcon name="close" /></button></div>
    </header>
    <section className={styles.content}>
      {erro
        ? <div className={styles.stateBox} role="alert"><strong>Não foi possível abrir a cliente</strong>{erro}<div><button type="button" className={styles.retryBtn} onClick={onTentar}>Tentar novamente</button></div></div>
        : <div className={styles.stack} aria-busy="true"><div className={styles.loading}><div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} /></div><div className={styles.loading}><div className={styles.skeleton} /><div className={styles.skeleton} /></div></div>}
    </section>
    <footer className={`${styles.footer} ${styles.single}`}><button className={`${styles.footerBtn} ${styles.closeBtn}`} type="button" onClick={onClose}>Fechar</button></footer>
  </>;
}

class DrawerErrorBoundary extends Component<{ children: ReactNode; titulo: string; onClose: () => void }, { erro: Error | null }> {
  state = { erro: null as Error | null };
  static getDerivedStateFromError(erro: Error) { return { erro }; }
  render() {
    if (this.state.erro) return <Fallback titulo={this.props.titulo} erro="Não foi possível exibir esta cliente. Recarregue a página ou tente novamente." onTentar={() => this.setState({ erro: null })} onClose={this.props.onClose} />;
    return this.props.children;
  }
}

function realDe(estagio: EstagioDrawer): EstagioCentral {
  return estagio === "concluido" ? "surgeryConfirmed" : estagio;
}

type Botao = { rotulo: string; onClick: () => void; tipo?: "secondary" | "primary" | "success"; disabled?: boolean; submit?: string };

function DrawerConteudo(props: ClienteDrawerProps & {
  criando: boolean;
  cadastro: Cliente | null;
  setCadastro: (c: Cliente) => void;
  central: Central | null;
  erroCentral: string | null;
  carregarCentral: () => Promise<Central | null>;
  carregarCadastro: () => Promise<Cliente | null>;
  requestClose: () => void;
  escBloqueado: { current: () => boolean };
}) {
  const { criando, cadastro, setCadastro, central, erroCentral, carregarCentral, carregarCadastro, requestClose, onChanged, estagioOrigem, sugestoesResponsavel = [] } = props;
  const hoje = props.hoje ?? hojeSaoPaulo();
  const abaPadrao: AbaDrawer = criando ? "profile" : props.abaInicial ?? "process";
  const [aba, setAba] = useState<AbaDrawer>(abaPadrao);
  const [estagioSel, setEstagioSel] = useState<EstagioCentral | null>(null);
  const [modal, setModal] = useState<ModalDrawer>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [statusAberto, setStatusAberto] = useState(false);
  const [suspensao, setSuspensao] = useState(false);
  const ocupadoRef = useRef<string | null>(null);
  const contentRef = useRef<HTMLElement>(null);
  const financeRef = useRef<FinanceiroPanelHandle>(null);
  const formId = "cliente-drawer-perfil";

  const recarregar = useCallback(async (atualizado?: Cliente) => {
    if (atualizado && cadastro) setCadastro({ ...cadastro, ...atualizado });
    const r = await carregarCentral();
    if (r) setEstagioSel(realDe(r.estagio));
    await onChanged?.();
  }, [cadastro, setCadastro, carregarCentral, onChanged]);

  const cad = useClienteCadastro(cadastro, {
    onSalvo: (c) => { if (criando) void onChanged?.(); else void recarregar(c); },
    onClose: requestClose,
  });

  const c = central?.cartao ?? null;
  const real = central ? realDe(central.estagio) : null;
  const concluido = central ? central.estagio === "concluido" || Boolean(central.cartao.processoConcluidoEm) : false;
  const estagio: EstagioCentral | null = real ? estagioSel ?? (estagioOrigem && ordemEstagio(estagioOrigem) <= ordemEstagio(real) ? estagioOrigem : real) : null;

  const algumModal = Boolean(modal || cad.baixaAlvo || cad.confirmarExclusao || suspensao);
  props.escBloqueado.current = () => algumModal;
  useEffect(() => () => { props.escBloqueado.current = () => false; }, [props.escBloqueado]);
  useEffect(() => {
    if (!statusAberto) return;
    const fechar = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest("[data-client-status-control]")) setStatusAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setStatusAberto(false); } };
    document.addEventListener("pointerdown", fechar);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", fechar); document.removeEventListener("keydown", esc, true); };
  }, [statusAberto]);

  const executar = useCallback(async (chave: string, fn: () => Promise<unknown>, sucesso: string) => {
    if (ocupadoRef.current) return false;
    ocupadoRef.current = chave; setOcupado(chave);
    try { await fn(); toast.success(sucesso); await recarregar(); return true; }
    catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível concluir a ação."); return false; }
    finally { ocupadoRef.current = null; setOcupado(null); }
  }, [recarregar]);

  const form = useFormLevantamento(cadastro, cad);

  /**
   * Etapa 2: confirmação (ou edição) do levantamento com o payload validado em
   * `validarLevantamento`; depois do sucesso recarrega processo e cadastro do
   * backend. Reconfirmar um levantamento já aprovado só atualiza a configuração
   * financeira (o backend preserva `financeiro_confirmado_em`).
   */
  async function concluirLevantamento(decisao: "aprovada" | "recusada", observacao?: string) {
    if (!c || !cadastro) return false;
    if (decisao === "aprovada") {
      const v = validarLevantamento(form);
      if ("erro" in v) { toast.error(v.erro); return false; }
      const edicao = c.statusRevisaoFinanceira === "aprovada";
      const ok = await executar("levantamento", () => centralApi.concluirLevantamento(c.id, v.payload),
        edicao ? "Levantamento atualizado." : "Levantamento concluído. Agenda de Termos liberada no app.");
      if (ok) await carregarCadastro();
      return ok;
    }
    const ok = await executar("divergencia", () => centralApi.concluirLevantamento(c.id, { decisao, observacao: observacao || undefined }), "Divergência registrada e cliente notificada.");
    if (ok) await carregarCadastro();
    return ok;
  }

  const proximoBoleto = useMemo(() => [...cad.boletos].filter((b) => b.status !== "pago" && !b.suspensa).sort((a, b) => a.numero_parcela - b.numero_parcela)[0] ?? null, [cad.boletos]);
  function registrarParcela() {
    if (!proximoBoleto) { toast.warning("Não há parcela em aberto para registrar."); return; }
    cad.abrirBaixaManual(proximoBoleto);
  }

  function irParaAgenda(tipo: "terms" | "surgery", data: string | null) {
    requestClose();
    if (props.onIrParaAgenda) { props.onIrParaAgenda(tipo, data); return; }
    const q = new URLSearchParams({ aba: tipo === "terms" ? "termos" : "cirurgia" });
    if (data) q.set("data", data);
    window.history.pushState({}, "", `/admin/agenda?${q.toString()}`);
    window.dispatchEvent(new Event("app:navigate"));
  }

  function mudarAba(nova: AbaDrawer) {
    setAba(nova);
    requestAnimationFrame(() => { if (contentRef.current) contentRef.current.scrollTop = 0; });
  }

  function alterarStatus(novo: StatusContratoCliente) {
    setStatusAberto(false);
    if (novo === cad.statusContrato) return;
    if (novo === "suspenso") {
      if (!cad.suspensoDesde) cad.setSuspensoDesde(hoje);
      setSuspensao(true);
      return;
    }
    void cad.aplicarStatusContrato(novo);
  }

  const eLib = c ? estadoLiberacao(c, hoje) : null;
  const historico = Boolean(estagio && real && estagio !== real && ordemEstagio(estagio) < ordemEstagio(real));
  const eventos = c ? eventosDoProcesso(c, cad) : [];
  const status = statusCliente(cad.statusContrato);

  function botoesProcesso(): Botao[] {
    if (!c || !estagio || !real || !eLib) return [];
    const b = (rotulo: string, onClick: () => void, tipo: Botao["tipo"] = "secondary", disabled = false): Botao => ({ rotulo, onClick, tipo, disabled: disabled || Boolean(ocupado) });
    if (historico) return [b("Voltar à etapa atual", () => { setEstagioSel(real); mudarAba("process"); }, "primary")];
    if (estagio === "preEligibility") return c.parcelasFaltantes === 0
      ? [b("Ver Financeiro", () => mudarAba("finance"))]
      : [b("Ver Financeiro", () => mudarAba("finance")), b("Registrar parcela paga", registrarParcela, "primary", !proximoBoleto)];
    // A confirmação do levantamento fica no próprio bloco da Etapa 2.
    if (estagio === "financialReview") return [b("Ver Financeiro", () => mudarAba("finance"))];
    if (estagio === "termsConfirmed") return [b("Ver Agenda de Termos", () => irParaAgenda("terms", c.dataTermos)), b("Reagendar", () => setModal({ tipo: "reagendar" }), "primary", !c.agendamentoId)];
    if (estagio === "financialRelease") {
      if (!c.previsaoConfirmadaEm) return [b("Ver Jornada completa", () => mudarAba("journey"))];
      if (eLib.liberada && !c.dataCirurgia) return [b("Agendar cirurgia", () => setModal({ tipo: "agendarCirurgia" }), "success")];
      if (!eLib.compareceu) return [b("Confirmar comparecimento", () => setModal({ tipo: "comparecimento", compareceu: true }), "primary")];
      if (!eLib.quitada) return [b("Confirmar quitação", () => setModal({ tipo: "quitacao" }), "primary")];
      return [b("Ver Jornada completa", () => mudarAba("journey"))];
    }
    return [b("Ver na Agenda Cirúrgica", () => irParaAgenda("surgery", c.dataCirurgia), "primary"), b("Ver Jornada", () => mudarAba("journey"))];
  }

  function botoesRodape(): Botao[] {
    const fechar: Botao = { rotulo: "Fechar", onClick: requestClose, tipo: "secondary" };
    if (aba === "profile") return [fechar, { rotulo: cad.salvandoPerfil ? "Salvando…" : criando ? "Cadastrar cliente" : "Salvar alterações", onClick: () => undefined, submit: formId, tipo: "primary", disabled: cad.salvandoPerfil || cad.salvandoStatus }];
    if (aba === "journey") return [fechar];
    if (aba === "finance") {
      // Na etapa operacional, o atalho do processo continua disponível no Financeiro.
      if (c && estagio === "preEligibility" && !historico && c.parcelasFaltantes > 0) return [fechar, { rotulo: "Registrar próxima parcela", onClick: registrarParcela, tipo: "primary", disabled: !proximoBoleto || cad.salvandoBaixa }];
      if (c && eLib && estagio === "financialRelease" && !historico && c.previsaoConfirmadaEm && !eLib.quitada) return [fechar, { rotulo: "Registrar quitação", onClick: () => setModal({ tipo: "quitacao" }), tipo: "primary", disabled: Boolean(ocupado) }];
      return [fechar, { rotulo: cad.salvandoFin ? "Salvando…" : "Salvar alterações", onClick: () => void financeRef.current?.salvar(), tipo: "primary", disabled: cad.salvandoFin }];
    }
    const acoes = botoesProcesso();
    return acoes.length === 1 ? [fechar, ...acoes] : acoes.length ? acoes : [fechar];
  }

  const botoes = botoesRodape();
  const abas: Array<[AbaDrawer, string, "flow" | "user" | "finance" | "route"]> = criando
    ? [["profile", "Perfil", "user"], ["finance", "Financeiro", "finance"]]
    : [["process", "Processo", "flow"], ["profile", "Perfil", "user"], ["finance", "Financeiro", "finance"], ["journey", "Jornada", "route"]];
  const parcelasChip = c ? (c.quitacaoStatus === "paga" ? "Contrato quitado" : `${c.parcelasPagas}/${c.totalParcelas} parcelas`) : cad.totalParcelasReal ? `${cad.pagas}/${cad.totalParcelasReal} parcelas` : null;

  return <>
    <header className={styles.header}>
      <div className={styles.clientHead}>
        <h2 className={styles.title} id="client-drawer-title">{criando ? "Nova cliente" : cad.nome || c?.nome || "Cliente"}</h2>
        {!criando && <div className={styles.subtitle}>
          <span>{cad.procedimento || c?.procedimento || "Procedimento não informado"}</span>
          {c && estagio && <span className={styles.chip}>{statusDoDrawer(c, estagio, concluido, hoje)}</span>}
          {parcelasChip && <span className={styles.chip}>{parcelasChip}</span>}
        </div>}
      </div>
      <div className={styles.actions}>
        {!criando && <div className={styles.statusWrap} data-client-status-control>
          <button className={styles.status} data-status={status.key} type="button" aria-haspopup="menu" aria-expanded={statusAberto} aria-label={`Status da cliente: ${status.label}. Clique para alterar.`} disabled={cad.salvandoStatus} onClick={() => setStatusAberto((v) => !v)}>{status.label}</button>
          {statusAberto && <div className={styles.statusMenu} role="menu" aria-label="Status da cliente">
            {STATUS_CLIENTE.map((o) => <button key={o.db} className={styles.statusOpt} type="button" role="menuitemradio" aria-checked={cad.statusContrato === o.db} onClick={() => alterarStatus(o.db)}><span className={styles.dot} style={{ color: o.color }} />{o.label}</button>)}
            <div className={styles.statusMenuNote}>Suspensão pede período e motivo. Toda alteração fica no histórico.</div>
          </div>}
        </div>}
        <button className={styles.iconBtn} type="button" aria-label="Fechar" onClick={requestClose}><DrawerIcon name="close" /></button>
      </div>
    </header>

    <nav className={styles.tabs} aria-label="Seções da cliente">
      <div className={styles.tabsShell} role="tablist" style={{ "--tabs": abas.length } as CSSProperties}>
        {abas.map(([id, rotulo, icone]) => <button key={id} className={styles.tab} type="button" role="tab" id={`client-tab-${id}`} aria-selected={aba === id} aria-controls="client-drawer-content" disabled={criando && id !== "profile"} title={criando && id !== "profile" ? "Disponível depois do cadastro" : undefined} onClick={() => mudarAba(id)}>
          <DrawerIcon name={icone} aria-hidden="true" />{rotulo.toLocaleUpperCase("pt-BR")}
          {id === "finance" && !criando && (cad.boletos.length || c?.totalParcelas) ? <span className={styles.tabCount}>{cad.boletos.length || c?.totalParcelas}</span> : null}
        </button>)}
      </div>
    </nav>

    <section ref={contentRef} className={styles.content} id="client-drawer-content" role="tabpanel" aria-labelledby={`client-tab-${aba}`} tabIndex={0}>
      {aba === "process" && (c && cadastro && estagio && real
        ? <div className={`v46 ${styles.processWrap}`}>
            <ProcessoTab c={c} cad={cad} cadastro={cadastro} real={real} estagio={estagio} concluido={concluido} hoje={hoje} ocupado={ocupado} form={form}
              eventos={eventos} executar={executar} abrirModal={setModal} irParaEstagio={(s) => { setEstagioSel(s); mudarAba("process"); }}
              registrarParcela={registrarParcela} temParcelaAberta={Boolean(proximoBoleto)} concluirLevantamento={concluirLevantamento}
              irParaAgenda={irParaAgenda}
              parcelas={<div className={styles.root}><FinanceiroPanel cad={cad} modo="parcelas" /></div>} />
          </div>
        : <EstadoProcesso erro={erroCentral} onTentar={() => void carregarCentral()} />)}
      {aba === "profile" && <PerfilPanel cad={cad} formId={formId} previsaoLiberacao={c?.agendaCirurgicaLiberadaEm ?? c?.prazoCirurgico ?? null} onPedirExclusao={() => cad.setConfirmarExclusao(true)} />}
      {aba === "finance" && !criando && <FinanceiroPanel ref={financeRef} cad={cad} />}
      {aba === "journey" && <JornadaPanel cartao={c} concluido={concluido} erro={erroCentral} onTentar={() => void carregarCentral()} />}
    </section>

    <footer className={`${styles.footer} ${botoes.length === 1 ? styles.single : botoes.length === 3 ? styles.triple : ""}`}>
      {botoes.map((b) => <button key={b.rotulo} className={`${styles.footerBtn} ${b.tipo === "secondary" ? styles.closeBtn : b.tipo === "success" ? `${styles.saveBtn} ${styles.success}` : styles.saveBtn}`}
        type={b.submit ? "submit" : "button"} form={b.submit} disabled={b.disabled} onClick={b.submit ? undefined : b.onClick}>
        {b.submit ? <DrawerIcon name="save" aria-hidden="true" /> : null} {b.rotulo}
      </button>)}
    </footer>

    <BaixaManualModal cad={cad} />
    {cad.confirmarExclusao && <ExclusaoModal cad={cad} />}
    {suspensao && <SuspensaoModal cad={cad} onClose={() => setSuspensao(false)} />}

    {c && <div className={`v46 ${styles.v46Layer}`}>
      {modal?.tipo === "responsavel" && c.agendamentoId && <ResponsavelModal agendamentoId={c.agendamentoId} atual={c.termosResponsavel} sugestoes={sugestoesResponsavel} onClose={() => setModal(null)} onSalvo={recarregar} />}
      {modal?.tipo === "reagendar" && c.agendamentoId && <TermsRescheduleModal agendamentoId={c.agendamentoId} nome={c.nome} dataAtual={c.dataTermos} horarioAtual={c.horarioTermos} hoje={hoje} onClose={() => setModal(null)} onDone={recarregar} />}
      {modal?.tipo === "quitacao" && c.agendamentoId && <QuitacaoModal c={c} saldo={c.custeioSaldo ?? cadastro?.financeiro_saldo_restante ?? null} onClose={() => setModal(null)} executar={executar} />}
      {modal?.tipo === "liberacao" && c.agendamentoId && eLib && <LiberacaoModal c={c} estado={eLib} onClose={() => setModal(null)} executar={executar} />}
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
        onConfirmar={async () => { const ok = await executar("pagamentoCirurgia", () => centralApi.confirmarPagamentoCirurgia(c.agendamentoId!), "Pagamento confirmado. Processo concluído e arquivado na Agenda Cirúrgica."); if (ok) requestClose(); return ok; }}
        onClose={() => setModal(null)} />}
      {modal?.tipo === "divergencia" && <DivergenciaModal onClose={() => setModal(null)} onConfirmar={(obs) => concluirLevantamento("recusada", obs)} />}
    </div>}
  </>;
}

function EstadoProcesso({ erro, onTentar }: { erro: string | null; onTentar: () => void }) {
  if (!erro) return <div className={styles.stack} aria-busy="true"><div className={styles.loading}><div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} /></div></div>;
  return <div className={styles.stateBox} role="alert">
    <strong>Processo indisponível</strong>{erro}
    <div><button type="button" className={styles.retryBtn} onClick={onTentar}>Tentar novamente</button></div>
  </div>;
}

function ExclusaoModal({ cad }: { cad: ClienteCadastro }) {
  return <Shell titulo="Excluir perfil da cliente" onClose={() => { if (!cad.excluindo) cad.setConfirmarExclusao(false); }}>
    <div className={styles.warning}>O perfil de <b>{cad.nome || "esta cliente"}</b> será excluído. A exclusão só é permitida pelo servidor quando não há pagamentos, agendamentos ou vínculos que precisem ser preservados.</div>
    <div className={styles.modalActions}>
      <button className={`${styles.modalBtn} ${styles.secondary}`} type="button" onClick={() => cad.setConfirmarExclusao(false)} disabled={cad.excluindo}>Cancelar</button>
      <button className={`${styles.modalBtn} ${styles.deleteBtn}`} type="button" onClick={() => void cad.excluirCliente()} disabled={cad.excluindo} aria-busy={cad.excluindo}>{cad.excluindo ? "Excluindo…" : "Excluir perfil"}</button>
    </div>
  </Shell>;
}

function SuspensaoModal({ cad, onClose }: { cad: ClienteCadastro; onClose: () => void }) {
  return <Shell titulo="Suspender contrato" onClose={() => { if (!cad.salvandoStatus) onClose(); }}>
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (!cad.suspensoDesde) { toast.error("Informe a data de início da suspensão."); return; }
      if (cad.suspensoAte && cad.suspensoAte < cad.suspensoDesde) { toast.error("A data final não pode ser anterior ao início."); return; }
      await cad.aplicarStatusContrato("suspenso");
      onClose();
    }}>
      <div className={styles.modalGrid}>
        <div className={styles.field}><label htmlFor="susp-desde">Suspensa desde</label><input id="susp-desde" className={styles.input} type="date" value={cad.suspensoDesde} onChange={(e) => cad.setSuspensoDesde(e.target.value)} required /></div>
        <div className={styles.field}><label htmlFor="susp-ate">Até (opcional)</label><input id="susp-ate" className={styles.input} type="date" value={cad.suspensoAte} onChange={(e) => cad.setSuspensoAte(e.target.value)} /></div>
        <div className={`${styles.field} ${styles.span2}`}><label htmlFor="susp-motivo">Motivo</label><textarea id="susp-motivo" className={styles.input} rows={3} maxLength={500} value={cad.suspensaoMotivo} onChange={(e) => cad.setSuspensaoMotivo(e.target.value)} /></div>
      </div>
      <div className={styles.modalActions}>
        <button className={`${styles.modalBtn} ${styles.secondary}`} type="button" onClick={onClose} disabled={cad.salvandoStatus}>Cancelar</button>
        <button className={`${styles.modalBtn} ${styles.primary}`} type="submit" disabled={cad.salvandoStatus} aria-busy={cad.salvandoStatus}>{cad.salvandoStatus ? "Salvando…" : "Suspender contrato"}</button>
      </div>
    </form>
  </Shell>;
}

function useFormLevantamento(cliente: Cliente | null, cad: ClienteCadastro): FormLevantamento {
  const persistido = (cl: Cliente | null) => ({
    saldo: cl?.financeiro_saldo_restante != null ? formatarValor(Number(cl.financeiro_saldo_restante)) : "",
    taxa: cl?.financeiro_taxa_cartao != null ? formatarTaxa(Number(cl.financeiro_taxa_cartao)) : "5,4",
    formas: cl?.financeiro_formas_custeio?.length ? normalizarFormas(cl.financeiro_formas_custeio) : (["cartao", "pix", "cheques", "boleto_100"] as FormaCusteio[]),
  });
  const inicial = persistido(cliente);
  const [saldo, setSaldoState] = useState(inicial.saldo);
  const [editado, setEditado] = useState(cliente?.financeiro_saldo_restante != null);
  const [taxa, setTaxa] = useState(inicial.taxa);
  const [formas, setFormas] = useState<FormaCusteio[]>(inicial.formas);
  const emAberto = useMemo(() => cad.boletos.filter((b) => b.status !== "pago").reduce((s, b) => s + Number(b.valor || 0), 0), [cad.boletos]);
  useEffect(() => { if (!editado && cad.boletos.length) setSaldoState(formatarValor(emAberto)); }, [editado, emAberto, cad.boletos.length]);
  const clienteRef = useRef(cliente);
  clienteRef.current = cliente;
  return {
    saldo, setSaldo: (v: string) => { setEditado(true); setSaldoState(v); }, taxa, setTaxa, formas,
    alternarForma: (f: FormaCusteio) => setFormas((a) => normalizarFormas(a.includes(f) ? a.filter((x) => x !== f) : [...a, f])),
    emAberto,
    /** Recarrega o editor com o levantamento persistido (Editar levantamento). */
    restaurar: () => {
      const v = persistido(clienteRef.current);
      setSaldoState(v.saldo || formatarValor(emAberto)); setEditado(Boolean(v.saldo)); setTaxa(v.taxa); setFormas(v.formas);
    },
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
