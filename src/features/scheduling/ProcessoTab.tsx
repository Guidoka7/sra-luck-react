import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Wallet } from "lucide-react";
import { resumoCarteira } from "@/components/admin/cliente-drawer/drawerModel";
import { hojeSaoPaulo, type ParcelaStatus } from "@/components/admin/cliente-drawer/drawerFormat";
import type { Cliente } from "@/types/database";
import type { ClienteCadastro } from "@/components/admin/useClienteCadastro";
import { centralApi, dataBr, dataHoraBr, diaSemana, FORMAS_CUSTEIO, moeda, proximoDiaUtil, rotuloFormaCusteio, type FormaCusteio } from "./api";
import { ETAPAS, ETAPA_POR_ID, ROTULO_RESPONSAVEL, faseLevantamento, faseLiberacao, prazoLevantamento, situacao } from "./jornada";
import type { CartaoCliente, EstagioCentral } from "./types";
import { estadoLiberacao } from "./v46Cards";
import { exigeTaxaCartao, normalizarFormas, validarLevantamento } from "./levantamento";
import "./processo.css";

export type ModalDrawer =
  | null
  | { tipo: "responsavel" }
  | { tipo: "reagendar" }
  | { tipo: "quitacao" }
  | { tipo: "naoQuitado" }
  | { tipo: "comparecimento"; compareceu: boolean }
  | { tipo: "liberacao" }
  | { tipo: "agendarCirurgia" }
  | { tipo: "pagamentoCirurgia" }
  | { tipo: "divergencia" }
  | { tipo: "atendimento" };

export const DIAS_PREVISAO_CIRURGICA = 90;

/**
 * Sugestão operacional da previsão cirúrgica.
 * A fonte de verdade do intervalo da cliente continua protegida no banco;
 * aqui apenas pré-preenchemos o campo administrativo com 90 dias corridos
 * após a data escolhida para a assinatura dos termos.
 */
export function sugerirPrevisaoCirurgica(c: Pick<CartaoCliente, "previsaoCirurgia" | "dataTermos">): string {
  if (c.previsaoCirurgia) return c.previsaoCirurgia.slice(0, 10);
  if (!c.dataTermos) return "";

  const [ano, mes, dia] = c.dataTermos.slice(0, 10).split("-").map(Number);
  if (!ano || !mes || !dia) return "";

  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (Number.isNaN(data.getTime())) return "";

  data.setUTCDate(data.getUTCDate() + DIAS_PREVISAO_CIRURGICA);
  return data.toISOString().slice(0, 10);
}

export interface FormLevantamento {
  saldo: string; setSaldo: (v: string) => void;
  taxa: string; setTaxa: (v: string) => void;
  formas: FormaCusteio[]; alternarForma: (f: FormaCusteio) => void;
  emAberto: number;
  /** Volta o editor para o levantamento persistido no backend. */
  restaurar: () => void;
}

export interface EventoProcesso { id: string; em: string; texto: string; estagio: EstagioCentral | null; financeiro: boolean }

const ORDEM: EstagioCentral[] = ["preEligibility", "financialReview", "termsConfirmed", "financialRelease", "surgeryConfirmed"];
export function ordemEstagio(s: EstagioCentral) { return Math.max(0, ORDEM.indexOf(s)); }

const TITULO_ETAPA = Object.fromEntries(ETAPAS.map((e) => [e.id, e.titulo])) as Record<EstagioCentral, string>;


/** Eventos reais: logs do cadastro + marcos persistidos no processo. */
export function eventosDoProcesso(c: CartaoCliente, cad: ClienteCadastro): EventoProcesso[] {
  const marcos: EventoProcesso[] = [];
  const add = (id: string, em: string | null | undefined, texto: string, estagio: EstagioCentral, financeiro = false) => { if (em) marcos.push({ id, em, texto, estagio, financeiro }); };
  add("m-solicitacao", c.liberacaoFinanceiraSolicitadaEm, "Cliente solicitou a liberação financeira pelo app.", "preEligibility");
  add("m-levantamento", c.financeiroConfirmadoEm, "Levantamento financeiro concluído e agenda de termos disponibilizada no app.", "financialReview", true);
  add("m-custeio", c.custeioConfirmadoEm, `Forma de pagamento do saldo confirmada${c.custeioForma ? ` (${rotuloFormaCusteio(c.custeioForma)})` : ""}.`, "financialReview", true);
  add("m-comparecimento", c.comparecimentoEm, c.comparecimentoStatus === "nao_compareceu" ? "Não comparecimento registrado." : "Comparecimento confirmado.", "financialRelease");
  add("m-quitacao", c.quitacaoEm, c.quitacaoStatus === "nao_realizada" ? "Saldo restante não foi quitado no dia da assinatura." : "Quitação do saldo confirmada.", "financialRelease", true);
  add("m-previsao", c.previsaoConfirmadaEm, `Previsão cirúrgica confirmada para ${dataBr(c.previsaoCirurgia)}.`, "financialRelease");
  add("m-liberacao", c.agendaCirurgicaLiberadaEm, c.agendaCirurgicaLiberadaManualmente ? "Agenda cirúrgica liberada manualmente antes do prazo automático." : "Agenda cirúrgica liberada após o prazo de dias úteis.", "financialRelease");
  add("m-cirurgia", c.cirurgiaEscolhidaEm, `Cirurgia agendada para ${dataBr(c.dataCirurgia)}${c.horarioCirurgia ? ` às ${c.horarioCirurgia}` : ""}.`, "surgeryConfirmed");
  add("m-pagamento", c.pagamentoCirurgiaConfirmadoEm, "Pagamento da cirurgia confirmado. Processo concluído e arquivado na Agenda Cirúrgica.", "surgeryConfirmed", true);
  const logs: EventoProcesso[] = cad.historico.map((h) => {
    const acao = h.acao || "";
    const estagio: EstagioCentral | null = /cirurgia/.test(acao) ? "surgeryConfirmed" : /quita|compare|liberac|prazo/.test(acao) ? "financialRelease" : /termo|agend/.test(acao) ? "termsConfirmed" : /revis|levantamento|custeio|forma/.test(acao) ? "financialReview" : /parcela|baixa|comprovante|boleto|pagamento|carne/.test(acao) ? "preEligibility" : null;
    return { id: h.id, em: h.created_at, texto: acao.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase()), estagio, financeiro: /parcela|baixa|comprovante|boleto|pagamento|quita|carne|financeir|custeio/.test(acao) };
  });
  return [...marcos, ...logs].sort((a, b) => b.em.localeCompare(a.em));
}

type PropsProcesso = {
  c: CartaoCliente; cad: ClienteCadastro; cadastro: Cliente; real: EstagioCentral; estagio: EstagioCentral; concluido: boolean; hoje: string;
  ocupado: string | null; form: FormLevantamento; eventos: EventoProcesso[];
  executar: (chave: string, fn: () => Promise<unknown>, sucesso: string) => Promise<boolean>;
  abrirModal: (m: ModalDrawer) => void; irParaEstagio: (s: EstagioCentral) => void;
  registrarParcela: () => void; temParcelaAberta: boolean;
  concluirLevantamento: (d: "aprovada" | "recusada", obs?: string) => Promise<boolean>;
  irParaAgenda: (tipo: "terms" | "surgery", data: string | null) => void;
  /** Parcelas/comprovantes reais (mesmo componente da aba Financeiro). */
  parcelas?: ReactNode;
};

/**
 * Aba Processo do drawer: trilha das 5 etapas e um único cartão "Agora" com a
 * situação real (mesma `situacao` do quadro), quem age e só os dados e
 * controles da sub-etapa atual (ver `jornada.ts` e docs/FLOWS.md §7.1). A ação
 * principal fica no rodapé do drawer. Toda ação chama as mesmas APIs/RPCs.
 */
export function ProcessoTab(p: PropsProcesso) {
  const { real, estagio } = p;
  const historico = ordemEstagio(estagio) < ordemEstagio(real);

  return <div className="process-page pr">
    <ProcessRail real={real} estagio={estagio} concluido={p.concluido} onAbrir={p.irParaEstagio} />
    {historico
      ? <>
          <p className="pr-revisao">Consultando uma etapa concluída. A cliente está em <b>{TITULO_ETAPA[real]}</b>.</p>
          <EtapaHistorica {...p} />
        </>
      : <Agora {...p} />}
    <Registros cad={p.cad} eventos={p.eventos} />
  </div>;
}

function ProcessRail({ real, estagio, concluido, onAbrir }: { real: EstagioCentral; estagio: EstagioCentral; concluido: boolean; onAbrir: (s: EstagioCentral) => void }) {
  const r = ordemEstagio(real), sel = ordemEstagio(estagio);
  return <nav className="pr-trilha" aria-label="Etapas do processo">
    {ETAPAS.map((e, i) => {
      const status = i < r || (concluido && i === r) ? "feito" : i === r ? "atual" : "futuro";
      const pode = i <= r;
      return <button key={e.id} type="button" className={`pr-trilha-etapa is-${status}${i === sel ? " is-sel" : ""}`} disabled={!pode}
        aria-current={i === sel ? "step" : undefined} aria-label={pode ? `Etapa ${i + 1}: ${e.titulo}${i < r ? " (consultar)" : ""}` : `Etapa ${i + 1}: ${e.titulo} (futura)`}
        onClick={() => pode && onAbrir(e.id)}>
        <span className="pr-trilha-num">{status === "feito" ? "✓" : i + 1}</span>
        <span className="pr-trilha-rotulo">{e.titulo}</span>
      </button>;
    })}
  </nav>;
}

/** Situação atual + dados e controles da sub-etapa. */
function Agora(p: PropsProcesso) {
  const { c, estagio, hoje, concluido } = p;
  const info = ETAPA_POR_ID.get(estagio)!;
  const s = situacao(c, estagio, hoje);
  const fase = estagio === "financialReview" ? faseLevantamento(c) : null;
  return <>
    <section className={`pr-agora${!concluido && s.atrasado ? " is-atrasado" : ""}`} aria-labelledby="pr-agora-titulo">
      <header className="pr-agora-head">
        <div className="pr-agora-titulo">
          <small>Etapa {info.numero} · {info.titulo}</small>
          <h3 id="pr-agora-titulo">{concluido ? "Processo concluído" : s.texto}</h3>
          {!concluido && s.prazo && <p className={s.atrasado ? "is-late" : undefined}>{s.prazo}</p>}
        </div>
        <span className={`pr-quem is-${concluido ? "sistema" : s.responsavel}`}>{concluido ? "Arquivado" : ROTULO_RESPONSAVEL[s.responsavel]}</span>
      </header>
      {estagio === "preEligibility" && <CorpoParcelas {...p} />}
      {estagio === "financialReview" && <CorpoLevantamento {...p} />}
      {estagio === "termsConfirmed" && <CorpoTermos {...p} />}
      {estagio === "financialRelease" && <CorpoLiberacao {...p} />}
      {estagio === "surgeryConfirmed" && <CorpoCirurgia {...p} />}
    </section>
    {estagio === "financialReview" && <CarteiraParcelas {...p} />}
    {(fase === "analisar" || fase === "divergencia") && <div id="pr-levantamento"><EditorLevantamento {...p} /></div>}
  </>;
}

type Linha = [string, ReactNode] | [string, ReactNode, ReactNode];

/** Lista rótulo → valor (→ ação), uma linha por dado. */
function Fatos({ itens }: { itens: (Linha | false | null)[] }) {
  return <dl className="pr-fatos">{(itens.filter(Boolean) as Linha[]).map(([k, v, acao]) => <div key={k}>
    <dt>{k}</dt><dd>{v}</dd>{acao && <span className="pr-fato-acao">{acao}</span>}
  </div>)}</dl>;
}

function Link({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return <button type="button" className="pr-link" onClick={onClick} disabled={disabled}>{children}</button>;
}

function Bloco({ titulo, subtitulo, children }: { titulo: string; subtitulo?: ReactNode; children: ReactNode }) {
  return <section className="pr-bloco">
    <header className="pr-bloco-head"><b>{titulo}</b>{subtitulo && <small>{subtitulo}</small>}</header>
    <div className="pr-bloco-corpo">{children}</div>
  </section>;
}

function Nota({ tom, children }: { tom?: "perigo" | "ok"; children: ReactNode }) {
  return <p className={`pr-nota${tom ? ` is-${tom}` : ""}`}>{children}</p>;
}

function dataHora(iso: string | null, hora: string | null) {
  return iso ? `${diaSemana(iso).slice(0, 3)}, ${dataBr(iso)}${hora ? ` às ${hora}` : ""}` : "—";
}

// Etapa 1 -------------------------------------------------------------------
function CorpoParcelas({ c }: PropsProcesso) {
  const pct = Math.min(100, Math.round((c.parcelasPagas / Math.max(1, c.parcelasNecessarias)) * 100));
  return <>
    <div className="pr-barra" role="progressbar" aria-label="Parcelas pagas para a elegibilidade" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
    <Fatos itens={[
      ["Parcelas pagas", `${c.parcelasPagas} de ${c.totalParcelas}`],
      ["Mínimo para solicitar", `${c.parcelasNecessarias} (${c.percentualRegra}%)`],
      c.parcelasFaltantes > 0 && ["Próxima parcela", c.proximaParcelaEm ? dataBr(c.proximaParcelaEm) : "—"],
    ]} />
    {c.parcelasFaltantes === 0 && <Nota tom="ok">O botão “Solicitar liberação financeira” já aparece no app.</Nota>}
  </>;
}

// Etapa 2 -------------------------------------------------------------------
function CorpoLevantamento(p: PropsProcesso) {
  const { c, cadastro, form, ocupado } = p;
  const fase = faseLevantamento(c);
  const [editando, setEditando] = useState(false);
  if (fase === "analisar" || fase === "divergencia") {
    const prazo = prazoLevantamento(c);
    return <>
      <Fatos itens={[
        ["Solicitado em", c.liberacaoFinanceiraSolicitadaEm ? dataHoraBr(c.liberacaoFinanceiraSolicitadaEm) : "—"],
        ["Prazo da equipe", prazo ? dataBr(prazo) : "—"],
      ]} />
      {fase === "divergencia" && <Nota tom="perigo">Divergência registrada: a cliente vê no app que precisa de um ajuste.</Nota>}
    </>;
  }
  if (editando) return <EditorLevantamento {...p} onCancelar={() => setEditando(false)} />;
  const formas = normalizarFormas((cadastro.financeiro_formas_custeio ?? []) as string[]);
  const editar = <Link onClick={() => { form.restaurar(); setEditando(true); }} disabled={Boolean(ocupado)}>Editar</Link>;
  const r = c.retornoTermos;
  return <Fatos itens={[
    ["Saldo para quitação", moeda(Number(cadastro.financeiro_saldo_restante ?? 0)), editar],
    fase === "forma"
      ? ["Formas liberadas", formas.map(rotuloFormaCusteio).join(" · ") || "—"]
      : ["Forma escolhida", rotuloFormaCusteio(c.custeioForma)],
    fase === "forma" && exigeTaxaCartao(formas) && ["Taxa do cartão", `${String(Number(cadastro.financeiro_taxa_cartao ?? 0)).replace(".", ",")}%`],
    Boolean(r) && ["Últimos termos", `${r!.dataTermos ? dataBr(r!.dataTermos) : "—"} · ${r!.motivo === "ausencia" ? "não compareceu" : "saldo não quitado"}`],
    fase === "data" && ["Datas de termos", "Escolha no app", <Link onClick={() => p.irParaAgenda("terms", null)}>Ver datas</Link>],
  ]} />;
}

const ROTULO_PARCELA: Record<ParcelaStatus, string> = { paid: "Paga", pending: "Em aberto", overdue: "Vencida", review: "Comprovante em conferência", rejected: "Comprovante rejeitado", suspended: "Suspensa" };

/**
 * Carteira de parcelas e comprovantes (etapa 2): resumo e mapa sempre
 * visíveis; ao clicar, abre a tabela real do Financeiro (mesmas ações de
 * baixa, anexo e conferência de comprovante).
 */
function CarteiraParcelas({ cad, parcelas }: PropsProcesso) {
  const [aberta, setAberta] = useState(false);
  const r = resumoCarteira(cad.boletos, hojeSaoPaulo());
  const carregando = cad.carregandoFin && r.total === 0;
  return <section className={`pr-carteira${aberta ? " is-aberta" : ""}`}>
    <button type="button" id="pr-carteira-toggle" className="pr-carteira-resumo" aria-expanded={aberta} aria-controls="levantamento-parcelas" onClick={() => setAberta((v) => !v)}>
      <span className="pr-carteira-head">
        <span className="pr-carteira-icone" aria-hidden="true"><Wallet size={18} /></span>
        <span className="pr-carteira-titulo"><b>Carteira de parcelas e comprovantes</b><small>{carregando ? "Carregando parcelas…" : `${r.total} parcelas · ${r.comprovantes} ${r.comprovantes === 1 ? "comprovante" : "comprovantes"}`}</small></span>
        <span className="pr-carteira-ver">{aberta ? "Recolher" : "Ver parcelas"}<ChevronDown size={15} aria-hidden="true" /></span>
      </span>
      {!carregando && r.total > 0 && <>
        <span className="pr-carteira-kpis">
          <span className="is-ok"><small>Pagas</small><b>{r.pagas}/{r.total}</b></span>
          <span><small>Em aberto</small><b>{moeda(r.valorEmAberto)}</b></span>
          <span className={r.vencidas ? "is-perigo" : undefined}><small>Vencidas</small><b>{r.vencidas}</b></span>
          <span className={r.emConferencia ? "is-atencao" : undefined}><small>Em conferência</small><b>{r.emConferencia}</b></span>
        </span>
        <span className="pr-carteira-mapa" aria-label={`Mapa das parcelas: ${r.pagas} pagas de ${r.total}`}>
          {r.itens.map((i) => <span key={i.id} className={`pr-parcela is-${i.status}`} title={`Parcela ${i.numero} · ${ROTULO_PARCELA[i.status]}${i.vencimento ? ` · vence ${dataBr(i.vencimento)}` : ""} · ${moeda(i.valor)}`}>{i.numero}</span>)}
        </span>
        <span className="pr-carteira-legenda" aria-hidden="true"><i className="pr-parcela is-paid" />Paga<i className="pr-parcela is-review" />Em conferência<i className="pr-parcela is-overdue" />Vencida<i className="pr-parcela" />Em aberto</span>
      </>}
    </button>
    <div id="levantamento-parcelas" className="pr-carteira-tabela" hidden={!aberta}>{parcelas}</div>
  </section>;
}

/**
 * Editor do levantamento (etapa 2 · analisar/divergência): conferência →
 * saldo → formas → taxa (se cartão) → concluir. Mesmas regras de
 * `validarLevantamento`; o backend preserva `financeiro_confirmado_em`.
 */
function EditorLevantamento({ c, cad, form, ocupado, abrirModal, concluirLevantamento, onCancelar }: PropsProcesso & { onCancelar?: () => void }) {
  const [erro, setErro] = useState<string | null>(null);
  const ocupadoAqui = ocupado === "levantamento";
  const editando = c.statusRevisaoFinanceira === "aprovada";
  async function confirmar() {
    const v = validarLevantamento(form);
    if ("erro" in v) { setErro(v.erro); return; }
    setErro(null);
    if (await concluirLevantamento("aprovada")) onCancelar?.();
  }
  const pagas = cad.boletos.filter((b) => b.status === "pago").length;
  const aguardando = cad.boletos.filter((b) => b.status === "pendente_confirmacao").length;
  return <Bloco titulo={editando ? "Editar levantamento" : "Fazer o levantamento"} subtitulo="A cliente vê no app o saldo e só as formas marcadas aqui.">
    <ol className="lev-steps">
      <li>
        <div className="lev-step-title"><span className="lev-num">1</span>Conferir parcelas e comprovantes</div>
        <div className="lev-check">
          <span>{cad.boletos.length ? `${pagas} de ${cad.boletos.length} parcelas pagas` : "Parcelas e comprovantes"}{aguardando ? ` · ${aguardando} comprovante${aguardando > 1 ? "s" : ""} aguardando conferência` : ""}</span>
          <button type="button" className="mini-link" onClick={() => { const alvo = document.getElementById("pr-carteira-toggle"); if (alvo?.getAttribute("aria-expanded") === "false") alvo.click(); alvo?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Ver parcelas ↑</button>
        </div>
      </li>
      <li>
        <label className="lev-step-title" htmlFor="central-saldo"><span className="lev-num">2</span>Saldo para quitação</label>
        <div className="field lev-field">
          <input id="central-saldo" inputMode="decimal" placeholder="0,00" value={form.saldo} onChange={(e) => { form.setSaldo(e.target.value); setErro(null); }} disabled={ocupadoAqui} aria-describedby="central-saldo-hint" />
          <small id="central-saldo-hint">Parcelas em aberto somam {moeda(form.emAberto)}. Informe o valor final combinado para a quitação.</small>
        </div>
      </li>
      <li>
        <div className="lev-step-title" id="central-formas-label"><span className="lev-num">3</span>Formas de pagamento liberadas</div>
        <div className="lev-formas" role="group" aria-labelledby="central-formas-label">
          {FORMAS_CUSTEIO.map((f) => {
            const on = form.formas.includes(f.value);
            return <label key={f.value} className={`lev-forma${on ? " on" : ""}`}>
              <input type="checkbox" checked={on} onChange={() => { form.alternarForma(f.value); setErro(null); }} disabled={ocupadoAqui} />
              <span className="lev-forma-check" aria-hidden="true">{on ? "✓" : ""}</span>{f.label}
            </label>;
          })}
        </div>
      </li>
      {exigeTaxaCartao(form.formas) && <li>
        <label className="lev-step-title" htmlFor="central-taxa"><span className="lev-num">4</span>Taxa do cartão (%)</label>
        <div className="field lev-field lev-field-short"><input id="central-taxa" inputMode="decimal" value={form.taxa} onChange={(e) => { form.setTaxa(e.target.value); setErro(null); }} disabled={ocupadoAqui} /></div>
      </li>}
    </ol>
    {erro && <div className="callout danger lev-erro" role="alert">{erro}</div>}
    <div className="lev-actions">
      <button type="button" className="primary-btn lev-confirmar" onClick={() => void confirmar()} disabled={Boolean(ocupado)} aria-busy={ocupadoAqui}>
        {ocupadoAqui ? "Salvando…" : editando ? "Salvar levantamento" : "Concluir levantamento"}
      </button>
      {onCancelar
        ? <button type="button" className="ghost-btn tiny-btn" onClick={() => { form.restaurar(); setErro(null); onCancelar(); }} disabled={ocupadoAqui}>Cancelar edição</button>
        : <button type="button" className="ghost-btn tiny-btn" onClick={() => abrirModal({ tipo: "divergencia" })} disabled={Boolean(ocupado)}>Registrar divergência</button>}
    </div>
  </Bloco>;
}

// Etapa 3 -------------------------------------------------------------------
function CorpoTermos({ c, hoje, ocupado, executar, abrirModal, irParaAgenda }: PropsProcesso) {
  const [previsao, setPrevisao] = useState(() => sugerirPrevisaoCirurgica(c));
  useEffect(() => { setPrevisao(sugerirPrevisaoCirurgica(c)); }, [c.id, c.previsaoCirurgia, c.dataTermos]);
  const minimo = c.dataTermos && c.dataTermos > hoje ? c.dataTermos : hoje;
  return <Fatos itens={[
    ["Assinatura", dataHora(c.dataTermos, c.horarioTermos), <Link onClick={() => irParaAgenda("terms", c.dataTermos)}>Ver na agenda</Link>],
    ["Responsável", c.termosResponsavel ?? <span className="pr-falta">Não definido</span>,
      <Link onClick={() => abrirModal({ tipo: "responsavel" })} disabled={!c.agendamentoId}>{c.termosResponsavel ? "Alterar" : "Definir"}</Link>],
    ["Previsão cirúrgica", c.previsaoConfirmadaEm
      ? dataBr(c.previsaoCirurgia)
      : c.agendamentoId
        ? <form className="pr-inline-form" onSubmit={(ev) => { ev.preventDefault(); if (previsao) void executar("previsao", () => centralApi.confirmarPrevisao(c.agendamentoId!, previsao), "Previsão cirúrgica confirmada."); }}>
            <input type="date" aria-label="Previsão cirúrgica" value={previsao} min={minimo} onChange={(ev) => setPrevisao(ev.target.value)} disabled={Boolean(ocupado)} />
            <button type="submit" className="primary-btn tiny-btn" disabled={!previsao || Boolean(ocupado)} aria-busy={ocupado === "previsao"}>{ocupado === "previsao" ? "Salvando…" : "Confirmar"}</button>
          </form>
        : <span className="pr-falta">Não confirmada</span>],
  ]} />;
}

// Etapa 4 -------------------------------------------------------------------
function CorpoLiberacao(p: PropsProcesso) {
  const { c, hoje } = p;
  const fase = faseLiberacao(c, hoje);
  const e = estadoLiberacao(c, hoje);
  if (fase === "registrar" || fase === "pendencia") {
    return <>
      <Fatos itens={[
        ["Termos", dataHora(c.dataTermos, c.horarioTermos)],
        ["Responsável", c.termosResponsavel ?? <span className="pr-falta">Não definido</span>],
        ["Previsão cirúrgica", c.previsaoConfirmadaEm ? dataBr(c.previsaoCirurgia) : <span className="pr-falta">{dataBr(sugerirPrevisaoCirurgica(c))} · a confirmar</span>],
        ["Saldo a quitar", `${c.custeioSaldo != null ? moeda(c.custeioSaldo) : "—"} · ${rotuloFormaCusteio(c.custeioForma)}`],
      ]} />
      {fase === "pendencia" && <Nota tom="perigo">O agendamento foi cancelado; a cliente escolhe uma nova data no app.</Nota>}
    </>;
  }
  if (fase === "prazo") {
    const pct = Math.max(0, Math.min(100, (e.decorridos / e.totalDias) * 100));
    return <>
      <div className="pr-barra" role="progressbar" aria-label="Prazo de liberação" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
      <Fatos itens={[
        ["Liberação prevista", dataBr(e.previsao)],
        ["Contagem desde", dataBr(e.inicio ? proximoDiaUtil(e.inicio) : null)],
      ]} />
    </>;
  }
  return <Fatos itens={[
    ["Agenda liberada em", `${c.agendaCirurgicaLiberadaEm ? dataBr(c.agendaCirurgicaLiberadaEm) : "—"}${c.agendaCirurgicaLiberadaManualmente ? " · manual" : ""}`],
    ["Cirurgia a partir de", dataBr(c.previsaoCirurgia), <Link onClick={() => p.irParaAgenda("surgery", null)}>Ver datas</Link>],
  ]} />;
}

// Etapa 5 -------------------------------------------------------------------
function CorpoCirurgia({ c, concluido }: PropsProcesso) {
  return <Fatos itens={[
    ["Cirurgia", dataHora(c.dataCirurgia, c.horarioCirurgia)],
    ["Procedimento", c.procedimento || "—"],
    ["Carta de crédito", moeda(c.cartaDeCredito)],
    concluido && ["Pagamento confirmado", c.pagamentoCirurgiaConfirmadoEm ? dataHoraBr(c.pagamentoCirurgiaConfirmadoEm) : "—"],
  ]} />;
}

function Fato({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return <div className="history-fact"><label>{rotulo}</label><strong>{valor}</strong></div>;
}

function EtapaHistorica({ c, cadastro, estagio, eventos }: PropsProcesso) {
  let fatos: ReactNode = null;
  if (estagio === "preEligibility") fatos = <>
    <Fato rotulo="Modalidade" valor={`${c.totalParcelas} parcelas`} />
    <Fato rotulo="Regra aplicada" valor={`${c.percentualRegra}% · ${c.parcelasNecessarias} parcelas necessárias`} />
    <Fato rotulo="Parcelas confirmadas hoje" valor={`${c.parcelasPagas}/${c.totalParcelas}`} />
    <Fato rotulo="Resultado" valor={c.liberacaoFinanceiraSolicitadaEm ? `Solicitação enviada em ${dataHoraBr(c.liberacaoFinanceiraSolicitadaEm)}` : "Meta mínima atingida"} />
  </>;
  if (estagio === "financialReview") fatos = <>
    <Fato rotulo="Status" valor={c.statusRevisaoFinanceira === "aprovada" ? "Levantamento concluído" : "Levantamento iniciado"} />
    <Fato rotulo="Concluído em" valor={c.financeiroConfirmadoEm ? dataHoraBr(c.financeiroConfirmadoEm) : "—"} />
    <Fato rotulo="Saldo definido" valor={moeda(Number(cadastro.financeiro_saldo_restante ?? 0))} />
    <Fato rotulo="Formas liberadas" valor={((cadastro.financeiro_formas_custeio ?? []) as string[]).map(rotuloFormaCusteio).join(" · ") || "—"} />
  </>;
  if (estagio === "termsConfirmed") fatos = <>
    <Fato rotulo="Data dos termos" valor={dataBr(c.dataTermos)} />
    <Fato rotulo="Horário" valor={c.horarioTermos || "—"} />
    <Fato rotulo="Responsável" valor={c.termosResponsavel || "Não definido"} />
    <Fato rotulo="Situação" valor={c.comparecimentoStatus === "compareceu" ? "Assinatura/comparecimento realizados" : "Agendamento registrado"} />
  </>;
  if (estagio === "financialRelease") fatos = <>
    <Fato rotulo="Comparecimento" valor={`${c.comparecimentoStatus === "compareceu" ? "Confirmado" : "—"} ${c.comparecimentoEm ? `· ${dataHoraBr(c.comparecimentoEm)}` : ""}`} />
    <Fato rotulo="Quitação" valor={`${c.quitacaoStatus === "paga" ? "Confirmada" : "—"} ${c.quitacaoEm ? `· ${dataHoraBr(c.quitacaoEm)}` : ""}`} />
    <Fato rotulo="Previsão de liberação" valor={dataBr(c.prazoCirurgico)} />
    <Fato rotulo="Agenda cirúrgica" valor={c.agendaCirurgicaLiberadaEm ? `Liberada em ${dataHoraBr(c.agendaCirurgicaLiberadaEm)}` : "Ainda não liberada"} />
  </>;
  const daEtapa = eventos.filter((ev) => ev.estagio === estagio).slice(0, 8);
  return <section className="history-stage-card">
    <div className="history-stage-head"><div><small>Etapa concluída · consulta</small><h3>{TITULO_ETAPA[estagio]}</h3></div><span className="badge success">Concluída</span></div>
    <div className="history-stage-body">
      <div className="history-facts">{fatos}</div>
      <div className="history-events">
        <div className="history-events-title">Histórico da etapa</div>
        {daEtapa.length === 0
          ? <div className="process-note">Ainda não há um evento específico registrado para esta etapa.</div>
          : daEtapa.map((ev) => <div key={ev.id} className="history-event"><time dateTime={ev.em}>{new Date(ev.em).toLocaleDateString("pt-BR")}</time><span>{ev.texto}</span></div>)}
      </div>
    </div>
  </section>;
}

function Registros({ cad, eventos }: { cad: ClienteCadastro; eventos: EventoProcesso[] }) {
  const comprovantes = cad.boletos.filter((b) => b.comprovante_url);
  const financeiros = eventos.filter((e) => e.financeiro);
  return <div className="pr-registros">
    <details><summary>Histórico <span>{eventos.length}</span></summary><div className="history-list">
      {eventos.length ? eventos.slice(0, 30).map((ev) => <div key={ev.id} className="history-item"><b>{ev.texto}</b><small>{new Date(ev.em).toLocaleString("pt-BR")}</small></div>) : <div className="empty-card">Sem eventos registrados.</div>}
    </div></details>
    <details><summary>Histórico financeiro <span>{financeiros.length}</span></summary><div className="history-list">
      {financeiros.length ? financeiros.slice(0, 12).map((ev) => <div key={ev.id} className="history-item"><b>{ev.texto}</b><small>{new Date(ev.em).toLocaleString("pt-BR")}</small></div>) : <div className="empty-card">Nenhum evento financeiro registrado.</div>}
    </div></details>
    <details><summary>Documentos <span>{comprovantes.length}</span></summary><div>
      {comprovantes.length ? comprovantes.map((b) => <div key={b.id} className="document-row">
        <div><b>Comprovante · parcela {b.numero_parcela}/{b.total_parcelas}</b><small>{b.data_pagamento ? `Pago em ${dataBr(b.data_pagamento)}` : "Enviado para conferência"}</small></div>
        <a className="mini-link" href={cad.comprovanteHref(b)} target="_blank" rel="noreferrer">Abrir</a>
      </div>) : <div className="empty-card">Nenhum documento anexado.</div>}
    </div></details>
  </div>;
}
