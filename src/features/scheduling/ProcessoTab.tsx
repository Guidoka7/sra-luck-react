import { useEffect, useState, type ReactNode } from "react";
import type { Cliente } from "@/types/database";
import type { ClienteCadastro } from "@/components/admin/useClienteCadastro";
import { centralApi, dataBr, dataHoraBr, diaSemana, diasEntre, FORMAS_CUSTEIO, moeda, proximoDiaUtil, rotuloFormaCusteio, type FormaCusteio } from "./api";
import { ETAPAS, ETAPA_POR_ID, PRAZO_LEVANTAMENTO_DIAS_UTEIS, ROTULO_RESPONSAVEL, faseLevantamento, faseLiberacao, passosDaEtapa, prazoLevantamento, situacao, type EstadoPasso } from "./jornada";
import type { CartaoCliente, EstagioCentral } from "./types";
import { estadoLiberacao, faltamTexto } from "./v46Cards";
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
 * Aba Processo do drawer: segue exatamente o fluxo real da etapa (ver
 * `jornada.ts` e docs/FLOWS.md §7.1). Trilha → "Agora" (passos internos, quem
 * age, situação, próxima ação) → conteúdo da etapa/sub-etapa → o que vem
 * depois → histórico. Toda ação chama as mesmas APIs/RPCs de antes.
 */
export function ProcessoTab(p: PropsProcesso) {
  const { real, estagio } = p;
  const historico = ordemEstagio(estagio) < ordemEstagio(real);

  return <div className="process-page pr">
    <ProcessRail real={real} estagio={estagio} concluido={p.concluido} onAbrir={p.irParaEstagio} />
    {historico
      ? <>
          <div className="pr-revisao"><span aria-hidden="true">↶</span><div><b>Consulta de etapa concluída</b><small>Nada aqui altera a posição atual da cliente, que está em “{TITULO_ETAPA[real]}”.</small></div></div>
          <EtapaHistorica {...p} />
        </>
      : <>
          <Agora {...p} />
          {estagio === "preEligibility" && <CorpoParcelas {...p} />}
          {estagio === "financialReview" && <CorpoLevantamento {...p} />}
          {estagio === "termsConfirmed" && <CorpoTermos {...p} />}
          {estagio === "financialRelease" && <CorpoLiberacao {...p} />}
          {estagio === "surgeryConfirmed" && <CorpoCirurgia {...p} />}
          <Depois {...p} />
        </>}
    <Acordeoes c={p.c} cad={p.cad} eventos={p.eventos} />
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

const ROTULO_ESTADO: Record<EstadoPasso, string> = { feito: "Concluído", atual: "Agora", pendente: "Depois", falhou: "Pendência" };

/** Onde a cliente está dentro da etapa, quem age e qual é a próxima ação. */
function Agora(p: PropsProcesso) {
  const { c, estagio, hoje, concluido } = p;
  const info = ETAPA_POR_ID.get(estagio)!;
  const s = situacao(c, estagio, hoje);
  const passos = passosDaEtapa(c, estagio, hoje, concluido);
  const responsavel = concluido ? "sistema" : s.responsavel;
  return <section className={`pr-agora is-${concluido ? "success" : s.tom}`} aria-labelledby="pr-agora-titulo">
    <header className="pr-agora-head">
      <span className="pr-agora-num" aria-hidden="true">{info.numero}</span>
      <div className="pr-agora-titulo">
        <small>Etapa {info.numero} de 5</small>
        <h3 id="pr-agora-titulo">{info.titulo}</h3>
      </div>
      <span className={`pr-quem is-${responsavel}`}>{concluido ? "Concluído" : ROTULO_RESPONSAVEL[s.responsavel]}</span>
    </header>
    <div className="pr-agora-situacao">
      <b>{concluido ? "Processo concluído e arquivado na data da cirurgia" : s.texto}</b>
      {!concluido && s.prazo && <small className={s.atrasado ? "is-late" : undefined}>{s.prazo}</small>}
    </div>
    <ol className="pr-passos">
      {passos.map((x, i) => <li key={x.rotulo} className={`is-${x.estado}`}>
        <span className="pr-passo-marca" aria-hidden="true">{x.estado === "feito" ? "✓" : x.estado === "falhou" ? "!" : i + 1}</span>
        <span className="pr-passo-texto"><b>{x.rotulo}</b><small>{ROTULO_RESPONSAVEL[x.responsavel]}{x.detalhe ? ` · ${x.detalhe}` : ""}</small></span>
        <span className="pr-passo-estado">{ROTULO_ESTADO[x.estado]}</span>
      </li>)}
    </ol>
  </section>;
}

/** Data em destaque (termos/cirurgia) com dia da semana, horário e distância. */
function DataDestaque({ iso, horario, hoje }: { iso: string | null; horario: string | null; hoje: string }) {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const dias = diasEntre(hoje, iso);
  const quando = dias === 0 ? "Hoje" : dias === 1 ? "Amanhã" : dias > 1 ? `Em ${dias} dias` : dias === -1 ? "Ontem" : `Há ${-dias} dias`;
  return <div className="pr-data">
    <div className="pr-data-dia" aria-hidden="true"><span>{d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</span><strong>{String(d.getDate()).padStart(2, "0")}</strong></div>
    <div className="pr-data-texto"><b>{diaSemana(iso)}, {dataBr(iso)}</b><small>{horario ? `às ${horario}` : "Horário a definir"} · {quando}</small></div>
  </div>;
}

function Bloco({ id, titulo, subtitulo, selo, children }: { id?: string; titulo: string; subtitulo?: ReactNode; selo?: ReactNode; children: ReactNode }) {
  return <section id={id} className="pr-bloco">
    <header className="pr-bloco-head"><div><b>{titulo}</b>{subtitulo && <small>{subtitulo}</small>}</div>{selo}</header>
    <div className="pr-bloco-corpo">{children}</div>
  </section>;
}

function Dados({ itens }: { itens: [string, ReactNode][] }) {
  return <dl className="pr-dados">{itens.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

function Aviso({ tom = "info", children }: { tom?: "info" | "atencao" | "perigo" | "ok"; children: ReactNode }) {
  return <div className={`pr-aviso is-${tom}`}>{children}</div>;
}

// Etapa 1 -------------------------------------------------------------------
function CorpoParcelas({ c }: PropsProcesso) {
  const pct = Math.min(100, Math.round((c.parcelasPagas / Math.max(1, c.parcelasNecessarias)) * 100));
  const elegivel = c.parcelasFaltantes === 0;
  return <Bloco titulo="Progresso para a elegibilidade" subtitulo={`Regra do plano: ${c.percentualRegra}% de ${c.totalParcelas} parcelas = ${c.parcelasNecessarias} pagas`}
    selo={<span className={`badge ${elegivel ? "success" : "info"}`}>{elegivel ? "Elegível" : faltamTexto(c.parcelasFaltantes)}</span>}>
    <div className="pr-progresso">
      <div className="pr-progresso-num"><strong>{c.parcelasPagas}</strong><span>de {c.parcelasNecessarias} necessárias</span></div>
      <div className="pr-barra" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
      <Dados itens={[["Parcelas pagas", `${c.parcelasPagas} de ${c.totalParcelas}`], ["Próxima parcela", c.proximaParcelaEm ? dataBr(c.proximaParcelaEm) : "—"]]} />
    </div>
    {elegivel
      ? <Aviso tom="ok"><b>O botão “Solicitar liberação financeira” já aparece no app.</b> A cliente continua nesta etapa até tocar nele; só então entra no levantamento financeiro.</Aviso>
      : <Aviso>Ao confirmar a {c.parcelasNecessarias}ª parcela paga, o app libera para a cliente o botão “Solicitar liberação financeira”.</Aviso>}
  </Bloco>;
}

// Etapa 2 -------------------------------------------------------------------
function CorpoLevantamento(p: PropsProcesso) {
  const { c, cadastro, cad, parcelas } = p;
  const fase = faseLevantamento(c);
  const prazo = prazoLevantamento(c);
  const pagas = cad.boletos.filter((b) => b.status === "pago").length;
  return <>
    {(fase === "analisar" || fase === "divergencia") && <>
      <Bloco titulo="Solicitação da cliente" selo={prazo && prazo < p.hoje ? <span className="badge danger">Prazo vencido</span> : <span className="badge wait">Em análise</span>}>
        <Dados itens={[
          ["Solicitado em", c.liberacaoFinanceiraSolicitadaEm ? dataHoraBr(c.liberacaoFinanceiraSolicitadaEm) : "—"],
          ["Prazo da equipe", prazo ? `${dataBr(prazo)} · ${PRAZO_LEVANTAMENTO_DIAS_UTEIS} dias úteis` : "—"],
        ]} />
        {fase === "divergencia" && <Aviso tom="perigo"><b>Divergência registrada.</b> A cliente vê no app que precisa de um ajuste. Depois de regularizar, confira e conclua o levantamento novamente.</Aviso>}
      </Bloco>
      <div id="pr-levantamento"><EditorLevantamento {...p} /></div>
    </>}
    {(fase === "forma" || fase === "data") && <>
      <ResumoLevantamento {...p} />
      <Bloco titulo="Escolha da cliente no app" selo={<span className="pr-quem is-cliente">Cliente</span>}>
        {fase === "forma"
          ? <Aviso>A cliente ainda não escolheu como vai quitar o saldo. No app aparecem só as formas liberadas neste levantamento: <b>{normalizarFormas((cadastro.financeiro_formas_custeio ?? []) as string[]).map(rotuloFormaCusteio).join(", ") || "—"}</b>.</Aviso>
          : <>
            <Dados itens={[["Forma escolhida", rotuloFormaCusteio(c.custeioForma)], ["Saldo a quitar", c.custeioSaldo != null ? moeda(c.custeioSaldo) : "—"]]} />
            {c.retornoTermos
              ? <Aviso tom="atencao"><b>{c.retornoTermos.motivo === "ausencia" ? "Faltou" : "Saldo não quitado"}{c.retornoTermos.dataTermos ? ` nos termos de ${dataBr(c.retornoTermos.dataTermos)}` : ""}.</b> O agendamento foi cancelado; o levantamento e a forma de pagamento continuam valendo e a cliente escolhe uma nova data.</Aviso>
              : <Aviso>Pronta para escolher a data da assinatura dos termos entre as datas abertas com vaga.</Aviso>}
            <div className="pr-acoes"><button type="button" className="secondary-btn tiny-btn" onClick={() => p.irParaAgenda("terms", null)}>Ver datas abertas de termos</button></div>
          </>}
      </Bloco>
    </>}
    <details className="drawer-accordion pr-parcelas" open={fase === "analisar" || fase === "divergencia"}>
      <summary>Parcelas e comprovantes <span>{pagas}/{cad.boletos.length || c.totalParcelas} pagas</span></summary>
      <div className="accordion-body" id="levantamento-parcelas">{parcelas}</div>
    </details>
  </>;
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
  return <Bloco titulo={editando ? "Editar levantamento" : "Fazer o levantamento financeiro"} subtitulo="A cliente vê no app o saldo e só as formas de pagamento marcadas aqui."
    selo={<span className="pr-quem is-equipe">Equipe</span>}>
    <ol className="lev-steps">
      <li>
        <div className="lev-step-title"><span className="lev-num">1</span>Conferir parcelas e comprovantes</div>
        <div className="lev-check">
          <span>{cad.boletos.length ? `${pagas} de ${cad.boletos.length} parcelas pagas` : "Parcelas e comprovantes"}{aguardando ? ` · ${aguardando} comprovante${aguardando > 1 ? "s" : ""} aguardando conferência` : ""}</span>
          <button type="button" className="mini-link" onClick={() => document.getElementById("levantamento-parcelas")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Ver parcelas ↓</button>
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
    {!editando && <p className="pr-nota">Ao concluir, a cliente é avisada e escolhe no app a forma de pagamento e depois a data dos termos.</p>}
  </Bloco>;
}

function ResumoLevantamento(p: PropsProcesso) {
  const { c, cadastro, form, ocupado } = p;
  const [editando, setEditando] = useState(false);
  if (editando) return <EditorLevantamento {...p} onCancelar={() => setEditando(false)} />;
  const formas = normalizarFormas((cadastro.financeiro_formas_custeio ?? []) as string[]);
  return <Bloco titulo="Levantamento concluído" subtitulo={c.financeiroConfirmadoEm ? `em ${dataHoraBr(c.financeiroConfirmadoEm)}` : undefined} selo={<span className="badge success">✓ Concluído</span>}>
    <Dados itens={[
      ["Saldo para quitação", moeda(Number(cadastro.financeiro_saldo_restante ?? 0))],
      ["Formas liberadas", formas.map(rotuloFormaCusteio).join(" · ") || "—"],
      ...(exigeTaxaCartao(formas) ? [["Taxa do cartão", `${String(Number(cadastro.financeiro_taxa_cartao ?? 0)).replace(".", ",")}%`] as [string, ReactNode]] : []),
    ]} />
    <div className="pr-acoes"><button type="button" className="ghost-btn tiny-btn" onClick={() => { form.restaurar(); setEditando(true); }} disabled={Boolean(ocupado)}>Editar levantamento</button></div>
  </Bloco>;
}

// Etapa 3 -------------------------------------------------------------------
function CorpoTermos({ c, hoje, ocupado, executar, abrirModal, irParaAgenda }: PropsProcesso) {
  const [previsao, setPrevisao] = useState(() => sugerirPrevisaoCirurgica(c));
  useEffect(() => { setPrevisao(sugerirPrevisaoCirurgica(c)); }, [c.id, c.previsaoCirurgia, c.dataTermos]);
  const minimo = c.dataTermos && c.dataTermos > hoje ? c.dataTermos : hoje;
  return <>
    <Bloco titulo="Assinatura dos termos" subtitulo="Data escolhida pela cliente no app" selo={<span className="badge success">Confirmada</span>}>
      <DataDestaque iso={c.dataTermos} horario={c.horarioTermos} hoje={hoje} />
      <div className="pr-acoes">
        <button type="button" className="secondary-btn tiny-btn" onClick={() => irParaAgenda("terms", c.dataTermos)}>Ver na agenda de termos</button>
      </div>
    </Bloco>
    <Bloco id="pr-preparar" titulo="Preparar o atendimento" subtitulo="Deixe tudo pronto antes do dia para registrar o atendimento sem espera." selo={<span className="pr-quem is-equipe">Equipe</span>}>
      <ul className="pr-checklist">
        <li className={c.termosResponsavel ? "is-feito" : undefined}>
          <span className="pr-check" aria-hidden="true">{c.termosResponsavel ? "✓" : "1"}</span>
          <div><b>Responsável pela assinatura</b><small>{c.termosResponsavel ?? "Ainda não definido"}</small></div>
          <button type="button" className="secondary-btn tiny-btn" onClick={() => abrirModal({ tipo: "responsavel" })} disabled={!c.agendamentoId}>{c.termosResponsavel ? "Alterar" : "Definir"}</button>
        </li>
        <li className={c.previsaoConfirmadaEm ? "is-feito" : undefined}>
          <span className="pr-check" aria-hidden="true">{c.previsaoConfirmadaEm ? "✓" : "2"}</span>
          <div><b>Previsão cirúrgica</b><small>{c.previsaoConfirmadaEm ? `Confirmada para ${dataBr(c.previsaoCirurgia)}. O valor da carta já está reservado no teto do mês.` : "Data mínima da cirurgia (sugestão: termos + 90 dias). Confirmar agora valida o teto do mês com antecedência."}</small></div>
          {!c.previsaoConfirmadaEm && c.agendamentoId && <form className="pr-inline-form" onSubmit={(ev) => { ev.preventDefault(); if (previsao) void executar("previsao", () => centralApi.confirmarPrevisao(c.agendamentoId!, previsao), "Previsão cirúrgica confirmada."); }}>
            <input type="date" aria-label="Previsão cirúrgica" value={previsao} min={minimo} onChange={(ev) => setPrevisao(ev.target.value)} disabled={Boolean(ocupado)} />
            <button type="submit" className="primary-btn tiny-btn" disabled={!previsao || Boolean(ocupado)} aria-busy={ocupado === "previsao"}>{ocupado === "previsao" ? "Salvando…" : "Confirmar"}</button>
          </form>}
        </li>
      </ul>
    </Bloco>
  </>;
}

// Etapa 4 -------------------------------------------------------------------
function CorpoLiberacao(p: PropsProcesso) {
  const { c, hoje, abrirModal } = p;
  const fase = faseLiberacao(c, hoje);
  const e = estadoLiberacao(c, hoje);
  if (fase === "registrar" || fase === "pendencia") {
    const previsao = c.previsaoConfirmadaEm ? `${dataBr(c.previsaoCirurgia)} (confirmada)` : `${dataBr(sugerirPrevisaoCirurgica(c))} (sugestão)`;
    return <Bloco titulo="Atendimento dos termos" subtitulo="Use “Registrar atendimento” para gravar tudo de uma vez, na ordem exigida."
      selo={<span className="pr-quem is-equipe">Equipe</span>}>
      <DataDestaque iso={c.dataTermos} horario={c.horarioTermos} hoje={hoje} />
      <Dados itens={[
        ["Responsável", c.termosResponsavel ?? "Não definido"],
        ["Previsão cirúrgica", previsao],
        ["Saldo a quitar", c.custeioSaldo != null ? moeda(c.custeioSaldo) : "—"],
        ["Forma escolhida", rotuloFormaCusteio(c.custeioForma)],
      ]} />
      <p className="pr-nota">Com comparecimento e quitação registrados, começa o prazo de {e.totalDias} dias úteis para liberar a agenda cirúrgica. Ausência ou saldo não quitado cancelam este agendamento: a vaga volta para a agenda e a cliente escolhe uma nova data (levantamento e forma de pagamento continuam valendo).</p>
    </Bloco>;
  }
  if (fase === "prazo") {
    const inicio = e.inicio ? proximoDiaUtil(e.inicio) : null;
    const pct = Math.max(0, Math.min(100, (e.decorridos / e.totalDias) * 100));
    const vencido = Boolean(e.previsao && e.previsao < hoje);
    return <Bloco titulo="Prazo de liberação da agenda cirúrgica" subtitulo="Comparecimento e quitação registrados. A liberação no app é automática ao fim do prazo."
      selo={<span className={`badge ${vencido ? "danger" : "wait"}`}>{vencido ? "Prazo vencido" : `${e.decorridos}/${e.totalDias} dias úteis`}</span>}>
      <div className="pr-prazo">
        <div><small>Liberação prevista</small><strong>{dataBr(e.previsao)}</strong></div>
        <div><small>Contagem desde</small><strong>{dataBr(inicio)}</strong></div>
        <div><small>Prazo total</small><strong>{e.totalDias} dias úteis</strong></div>
      </div>
      <div className="pr-barra" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
      {vencido && <Aviso tom="perigo">O prazo terminou e a agenda ainda não foi liberada. Libere agora para a cliente conseguir escolher a data.</Aviso>}
      {!vencido && <p className="pr-nota">Se precisar, “Gerenciar prazo” permite estender (+1, +3 ou +5 dias úteis) ou liberar antes.</p>}
    </Bloco>;
  }
  return <Bloco titulo="Agenda cirúrgica liberada" subtitulo={c.agendaCirurgicaLiberadaEm ? `em ${dataHoraBr(c.agendaCirurgicaLiberadaEm)}${c.agendaCirurgicaLiberadaManualmente ? " · liberação manual" : ""}` : undefined}
    selo={<span className="pr-quem is-cliente">Cliente</span>}>
    <Aviso>A cliente escolhe no app a data da cirurgia entre as datas cirúrgicas abertas, a partir de <b>{dataBr(c.previsaoCirurgia)}</b> e dentro do teto do mês.</Aviso>
    <div className="pr-acoes">
      <button type="button" className="secondary-btn tiny-btn" onClick={() => p.irParaAgenda("surgery", null)}>Ver datas cirúrgicas abertas</button>
    </div>
  </Bloco>;
}

// Etapa 5 -------------------------------------------------------------------
function CorpoCirurgia({ c, hoje, concluido }: PropsProcesso) {
  const realizada = Boolean(c.dataCirurgia && c.dataCirurgia < hoje);
  return <Bloco titulo={concluido ? "Processo concluído" : "Cirurgia agendada"} subtitulo={c.cirurgiaEscolhidaEm ? `Data escolhida em ${dataHoraBr(c.cirurgiaEscolhidaEm)}` : undefined}
    selo={<span className={`badge ${concluido ? "success" : realizada ? "wait" : "info"}`}>{concluido ? "Concluído" : realizada ? "Aguardando pagamento" : "Agendada"}</span>}>
    <DataDestaque iso={c.dataCirurgia} horario={c.horarioCirurgia} hoje={hoje} />
    <Dados itens={[["Procedimento", c.procedimento || "—"], ["Carta de crédito", moeda(c.cartaDeCredito)], ["Contrato", c.quitacaoStatus === "paga" ? "Quitado" : `${c.parcelasPagas}/${c.totalParcelas} parcelas pagas`]]} />
    {concluido
      ? <Aviso tom="ok"><b>Pagamento da cirurgia confirmado{c.pagamentoCirurgiaConfirmadoEm ? ` em ${dataHoraBr(c.pagamentoCirurgiaConfirmadoEm)}` : ""}.</b> O processo saiu das filas e fica arquivado na data da cirurgia.</Aviso>
      : realizada
        ? <Aviso tom="atencao">A data da cirurgia já passou. Confirme o pagamento (botão abaixo) para concluir o processo.</Aviso>
        : <Aviso>Depois da cirurgia, a equipe confirma o pagamento para concluir o processo.</Aviso>}
  </Bloco>;
}

/** O que acontece depois desta etapa (critério de saída real). */
function Depois({ estagio, concluido }: PropsProcesso) {
  if (concluido) return null;
  const info = ETAPA_POR_ID.get(estagio)!;
  const proxima = ETAPAS[info.numero];
  return <section className="pr-depois">
    <span aria-hidden="true">→</span>
    <div><small>Como sai desta etapa</small><b>{info.saida}</b>{proxima && <em>Próxima etapa: {proxima.titulo}</em>}</div>
  </section>;
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

function Acordeoes({ cad, eventos }: { c: CartaoCliente; cad: ClienteCadastro; eventos: EventoProcesso[] }) {
  const comprovantes = cad.boletos.filter((b) => b.comprovante_url);
  const financeiros = eventos.filter((e) => e.financeiro);
  return <>
    <details className="drawer-accordion"><summary>Histórico operacional <span>{eventos.length}</span></summary><div className="accordion-body"><div className="history-list">
      {eventos.length ? eventos.slice(0, 30).map((ev) => <div key={ev.id} className="history-item"><b>{ev.texto}</b><small>{new Date(ev.em).toLocaleString("pt-BR")}</small></div>) : <div className="empty-card">Sem eventos registrados.</div>}
    </div></div></details>
    <details className="drawer-accordion"><summary>Documentos <span>{comprovantes.length}</span></summary><div className="accordion-body">
      {comprovantes.length ? comprovantes.map((b) => <div key={b.id} className="document-row">
        <div><b>Comprovante · parcela {b.numero_parcela}/{b.total_parcelas}</b><small>{b.data_pagamento ? `Pago em ${dataBr(b.data_pagamento)}` : "Enviado para conferência"}</small></div>
        <a className="mini-link" href={cad.comprovanteHref(b)} target="_blank" rel="noreferrer">Abrir</a>
      </div>) : <div className="empty-card">Nenhum documento anexado.</div>}
    </div></details>
    <details className="drawer-accordion"><summary>Histórico financeiro <span>{financeiros.length}</span></summary><div className="accordion-body"><div className="history-list">
      {financeiros.length ? financeiros.slice(0, 12).map((ev) => <div key={ev.id} className="history-item"><b>{ev.texto}</b><small>{new Date(ev.em).toLocaleString("pt-BR")}</small></div>) : <div className="empty-card">Nenhum evento financeiro registrado.</div>}
    </div></div></details>
  </>;
}
