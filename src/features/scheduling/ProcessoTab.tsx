import { useEffect, useState, type ReactNode } from "react";
import { BadgeDollarSign, CalendarCheck2, CircleX, UserCheck, UserX } from "lucide-react";
import type { Cliente } from "@/types/database";
import type { ClienteCadastro } from "@/components/admin/useClienteCadastro";
import { centralApi, dataBr, dataHoraBr, diasEntre, FORMAS_CUSTEIO, horaLocal, moeda, proximoDiaUtil, rotuloFormaCusteio, type FormaCusteio } from "./api";
import type { CartaoCliente, EstagioCentral } from "./types";
import { ChosenDate, estadoLiberacao, faltamTexto } from "./v46Cards";
import { exigeTaxaCartao, normalizarFormas, validarLevantamento } from "./levantamento";

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
  | { tipo: "divergencia" };

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

const TITULO_ETAPA: Record<EstagioCentral, string> = {
  preEligibility: "Elegibilidade para solicitar os termos",
  financialReview: "Levantamento financeiro",
  termsConfirmed: "Agendamento dos termos",
  financialRelease: "Liberação da agenda cirúrgica",
  surgeryConfirmed: "Cirurgia confirmada",
};

const RAIL = [
  { id: "preEligibility", l1: "Elegibilidade", l2: "financeira" },
  { id: "financialReview", l1: "Levantamento", l2: "financeiro" },
  { id: "termsConfirmed", l1: "Termos", l2: "agendados" },
  { id: "financialRelease", l1: "Liberação", l2: "cirúrgica" },
  { id: "surgeryConfirmed", l1: "Cirurgia", l2: "confirmada" },
] as const;

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

export function ProcessoTab(p: {
  c: CartaoCliente; cad: ClienteCadastro; cadastro: Cliente; real: EstagioCentral; estagio: EstagioCentral; concluido: boolean; hoje: string;
  ocupado: string | null; form: FormLevantamento; eventos: EventoProcesso[];
  executar: (chave: string, fn: () => Promise<unknown>, sucesso: string) => Promise<boolean>;
  abrirModal: (m: ModalDrawer) => void; irParaEstagio: (s: EstagioCentral) => void;
  registrarParcela: () => void; temParcelaAberta: boolean;
  concluirLevantamento: (d: "aprovada" | "recusada", obs?: string) => Promise<boolean>;
  irParaAgenda: (tipo: "terms" | "surgery", data: string | null) => void;
  /** Parcelas/comprovantes reais (mesmo componente da aba Financeiro), exibidos no Levantamento. */
  parcelas?: ReactNode;
}) {
  const { c, real, estagio } = p;
  const historico = ordemEstagio(estagio) < ordemEstagio(real);

  return <div className="process-page">
    <ProcessRail real={real} estagio={estagio} concluido={p.concluido} onAbrir={p.irParaEstagio} />
    {historico
      ? <>
          <div className="review-banner">
            <span className="review-icon" aria-hidden="true">↶</span>
            <div><b>Revisão de etapa anterior</b><br />Você está consultando uma fase já concluída. Nenhuma ação aqui altera a posição atual da cliente.</div>
          </div>
          <EtapaHistorica {...p} />
          <section className="next-stage-card">
            <span className="next-stage-icon" aria-hidden="true">→</span>
            <div><small>Depois desta etapa</small><b>A cliente avançou para “{TITULO_ETAPA[real]}”.</b><span className="auto-pill">Posição atual preservada</span></div>
          </section>
        </>
      : <>
          <StageFocus {...p} />
          {estagio === "preEligibility" && <OperacaoElegibilidade {...p} />}
          {estagio === "financialReview" && <OperacaoLevantamento {...p} />}
          {estagio === "termsConfirmed" && <OperacaoTermos {...p} />}
          {estagio === "financialRelease" && <OperacaoLiberacao {...p} />}
          {estagio === "surgeryConfirmed" && <OperacaoCirurgia {...p} />}
          {estagio !== "preEligibility" && estagio !== "termsConfirmed" && <ProximaEtapa c={c} estagio={estagio} concluido={p.concluido} />}
        </>}
    <Acordeoes c={c} cad={p.cad} eventos={p.eventos} />
  </div>;
}

function ProcessRail({ real, estagio, concluido, onAbrir }: { real: EstagioCentral; estagio: EstagioCentral; concluido: boolean; onAbrir: (s: EstagioCentral) => void }) {
  const r = ordemEstagio(real), sel = ordemEstagio(estagio);
  const revisando = sel !== r;
  return <section className="process-map-card">
    <div className="process-map-head">
      <div><b>Evolução da cliente</b><small>Acompanhe o avanço pelas etapas do processo</small></div>
      <span className="subtle-pill">{revisando ? `Revisando etapa ${sel + 1}` : concluido ? "Processo concluído" : `Etapa atual ${r + 1} de 5`}</span>
    </div>
    <div className="process-rail">
      {RAIL.map((x, i) => {
        const status = i < r || (concluido && i === r) ? "done" : i === r ? "current" : "upcoming";
        const pode = i <= r;
        const legenda = i === sel && i < r ? "Visualizando" : i === r ? (concluido ? "Concluída" : "Etapa atual") : i < r ? "Revisar" : "Etapa futura";
        return <button key={x.id} type="button" className={`rail-step ${status}${i === sel ? " reviewing" : ""}${pode ? " clickable" : ""}`}
          disabled={!pode} aria-disabled={!pode} aria-current={i === sel ? "step" : undefined}
          aria-label={pode ? `Abrir etapa ${i + 1}: ${x.l1} ${x.l2}` : `Etapa ${i + 1}: ${x.l1} ${x.l2} (futura, bloqueada)`}
          onClick={() => pode && onAbrir(x.id)}>
          <span className="rail-dot">{i < r || (concluido && i === r) ? "✓" : i + 1}</span>
          <b>{x.l1}<br />{x.l2}</b>
          <span className="rail-step-caption">{legenda}</span>
        </button>;
      })}
    </div>
  </section>;
}

function proximaAcao(p: Parameters<typeof ProcessoTab>[0]): { titulo: string; detalhe: string } {
  const { c, estagio, hoje } = p;
  if (estagio === "financialReview") {
    if (c.statusRevisaoFinanceira === "aprovada") return { titulo: "Aguardar a cliente escolher a data dos termos.", detalhe: "" };
    if (c.statusRevisaoFinanceira === "recusada") return { titulo: "Refazer o levantamento financeiro.", detalhe: "Divergência registrada. Depois da regularização, confira e confirme novamente." };
    return { titulo: "Conferir financeiro e confirmar levantamento.", detalhe: "" };
  }
  if (estagio === "financialRelease") {
    const e = estadoLiberacao(c, hoje);
    if (!c.previsaoConfirmadaEm) return { titulo: "Confirmar a previsão cirúrgica", detalhe: "A previsão da agenda cirúrgica precisa estar confirmada antes de registrar comparecimento e quitação." };
    if (!e.compareceu) return { titulo: "Confirmar o comparecimento", detalhe: `A presença é uma das duas confirmações obrigatórias para iniciar a contagem dos ${e.totalDias} dias úteis.` };
    if (!e.quitada) return { titulo: "Confirmar a quitação do saldo restante", detalhe: `Comparecimento já confirmado. Falta registrar a quitação${c.custeioSaldo != null ? ` de ${moeda(c.custeioSaldo)}` : ""}.` };
    if (!e.liberada) return { titulo: e.decorridos === 0 ? `Aguardar início do prazo de ${e.totalDias} dias úteis` : `Aguardar liberação · ${e.decorridos} de ${e.totalDias} dias úteis concluídos`, detalhe: `A liberação está prevista para ${dataBr(e.previsao)}. Ao completar o prazo, a Agenda Cirúrgica é liberada automaticamente no app.` };
    return { titulo: "Aguardar a cliente escolher a data da cirurgia", detalhe: "A Agenda Cirúrgica já está liberada. A cliente permanece nesta etapa até escolher uma data disponível no app." };
  }
  return { titulo: "Acompanhar a cirurgia confirmada", detalhe: `Cirurgia marcada para ${dataBr(c.dataCirurgia)} às ${c.horarioCirurgia || "—"}. Todos os marcos anteriores permanecem registrados na Jornada.` };
}

function StageFocus(p: Parameters<typeof ProcessoTab>[0]) {
  const { c, estagio, concluido } = p;
  const i = ordemEstagio(estagio);
  const e = estadoLiberacao(c, p.hoje);
  const cfg: Record<EstagioCentral, [string, string, string]> = {
    preEligibility: ["rose", c.parcelasFaltantes === 0 ? "Elegível para solicitar" : "Próxima da elegibilidade", c.parcelasFaltantes === 0 ? "Aguardando solicitação no app" : `${faltamTexto(c.parcelasFaltantes)} para liberar a solicitação`],
    financialReview: ["gold", "Levantamento financeiro", c.statusRevisaoFinanceira === "aprovada" ? "Concluído" : c.statusRevisaoFinanceira === "recusada" ? "Divergência registrada" : "Em conferência"],
    termsConfirmed: ["green", "Termos agendados", "Agendamento confirmado"],
    financialRelease: ["gold", "Liberação cirúrgica", `Conferência presencial + prazo de ${e.totalDias} dias úteis`],
    surgeryConfirmed: ["green", concluido ? "Processo concluído" : "Cirurgia confirmada", concluido ? "Pagamento da cirurgia confirmado" : "Data cirúrgica escolhida e confirmada"],
  };
  const [tom, titulo, status] = cfg[estagio];
  const cls = estagio === "surgeryConfirmed" || e.liberada || (estagio === "financialReview" && c.statusRevisaoFinanceira === "aprovada") ? "success" : estagio === "financialRelease" ? "wait" : estagio === "preEligibility" || (estagio === "financialReview" && c.statusRevisaoFinanceira === "recusada") ? "danger" : "info";
  const acao = estagio === "preEligibility" || estagio === "termsConfirmed" ? null : proximaAcao(p);
  return <section className={`stage-focus ${tom}`}>
    <div className="stage-focus-head">
      <span className="stage-focus-number" aria-hidden="true">0{i + 1}</span>
      <div className="stage-focus-copy"><small>Etapa atual · {i + 1} de 5</small><h3>{titulo}</h3></div>
      <span className={`badge ${cls} stage-focus-status`}>{status}</span>
    </div>
    {acao && <div className="next-action-box"><span>Próxima ação</span><b>{acao.titulo}</b>{acao.detalhe ? <p>{acao.detalhe}</p> : null}</div>}
  </section>;
}

function OperacaoElegibilidade({ c, ocupado, registrarParcela, temParcelaAberta }: Parameters<typeof ProcessoTab>[0]) {
  const req = c.parcelasNecessarias;
  const pct = Math.min(100, Math.round((c.parcelasPagas / Math.max(1, req)) * 100));
  if (c.parcelasFaltantes === 0) {
    return <section className="operation-card eligibility-operation eligibility-ready">
      <div className="operation-head"><div><b>Percentual atingido</b><small>{c.percentualRegra}% do parcelamento de {c.totalParcelas}x</small></div><span className="badge success">Elegível</span></div>
      <div className="operation-body">
        <div className="eligibility-main">
          <div><span>Parcelas pagas</span><strong>{c.parcelasPagas}<small> de {req} necessárias</small></strong></div>
          <div className="eligibility-ready-mark" aria-hidden="true">✓</div>
        </div>
        <div className="progress-track eligibility-track"><span style={{ width: "100%" }} /></div>
        <div className="app-request-callout">
          <span className="app-request-icon" aria-hidden="true">▣</span>
          <div><small>Disponível no app da cliente</small><b>Solicitar liberação financeira</b><p>A cliente permanece nesta etapa até tocar nesse botão. Somente depois da solicitação ela entra em <strong>Levantamentos</strong>.</p></div>
        </div>
      </div>
    </section>;
  }
  return <section className="operation-card eligibility-operation">
    <div className="operation-head"><div><b>Progresso para liberar a solicitação</b><small>{c.percentualRegra}% do parcelamento de {c.totalParcelas}x</small></div></div>
    <div className="operation-body">
      <div className="eligibility-main">
        <div><span>Parcelas pagas</span><strong>{c.parcelasPagas}<small> de {req} necessárias</small></strong></div>
        <div className="eligibility-missing"><span>{c.parcelasFaltantes === 1 ? "Falta" : "Faltam"}</span><strong>{c.parcelasFaltantes}</strong><small>{c.parcelasFaltantes === 1 ? "parcela" : "parcelas"}</small></div>
      </div>
      <div className="progress-track eligibility-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
      <div className="eligibility-transition">Ao atingir <b>{req} parcelas pagas</b>, o app libera o botão <b>Solicitar liberação financeira</b>. A cliente ainda não entra em Levantamentos automaticamente.</div>
      <div className="inline-actions" style={{ marginTop: 10 }}>
        <button type="button" className="primary-btn tiny-btn" onClick={registrarParcela} disabled={!temParcelaAberta || Boolean(ocupado)} title={temParcelaAberta ? undefined : "Não há parcela em aberto"}>Registrar próxima parcela paga</button>
      </div>
    </div>
  </section>;
}

/**
 * Etapa 2 — Levantamento financeiro: um único bloco operacional.
 * Pendente (ou em edição): conferência → saldo → formas → taxa (se cartão) →
 * confirmar. Aprovado: resumo compacto do que foi persistido + Editar.
 * Editar é só ajuste administrativo da configuração financeira: não muda a
 * etapa nem a Agenda de Termos (o backend preserva `financeiro_confirmado_em`).
 */
function OperacaoLevantamento({ c, cad, cadastro, form, ocupado, abrirModal, concluirLevantamento, parcelas }: Parameters<typeof ProcessoTab>[0]) {
  const aprovado = c.statusRevisaoFinanceira === "aprovada";
  const [editando, setEditando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const mostrarEditor = !aprovado || editando;
  const ocupadoAqui = ocupado === "levantamento";

  async function confirmar() {
    const v = validarLevantamento(form);
    if ("erro" in v) { setErro(v.erro); return; }
    setErro(null);
    if (await concluirLevantamento("aprovada")) setEditando(false);
  }

  const pagas = cad.boletos.filter((b) => b.status === "pago").length;
  const aguardando = cad.boletos.filter((b) => b.status === "pendente_confirmacao").length;
  const formasPersistidas = normalizarFormas((cadastro.financeiro_formas_custeio ?? []) as string[]);
  const irParaParcelas = () => document.getElementById("levantamento-parcelas")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return <>
    {mostrarEditor
      ? <section className="drawer-section lev-editor" aria-label="Levantamento financeiro">
          <div className="drawer-section-head"><span>{editando ? "Editar levantamento" : "Levantamento financeiro"}</span>
            {c.statusRevisaoFinanceira === "recusada" && !editando ? <span className="badge danger">Divergência</span> : editando ? <span className="badge info">Editando</span> : null}</div>
          <div className="drawer-section-body">
            <ol className="lev-steps">
              <li>
                <div className="lev-step-title"><span className="lev-num">1</span>Conferência</div>
                <div className="lev-check">
                  <span>{cad.boletos.length ? `${pagas} de ${cad.boletos.length} parcelas pagas` : "Parcelas e comprovantes"}{aguardando ? ` · ${aguardando} comprovante${aguardando > 1 ? "s" : ""} aguardando` : ""}</span>
                  <button type="button" className="mini-link" onClick={irParaParcelas}>Ver parcelas ↓</button>
                </div>
              </li>
              <li>
                <label className="lev-step-title" htmlFor="central-saldo"><span className="lev-num">2</span>Saldo para quitação</label>
                <div className="field lev-field">
                  <input id="central-saldo" inputMode="decimal" placeholder="0,00" value={form.saldo} onChange={(e) => { form.setSaldo(e.target.value); setErro(null); }} disabled={ocupadoAqui} aria-describedby="central-saldo-hint" />
                  <small id="central-saldo-hint">Valor restante para quitação · parcelas em aberto somam {moeda(form.emAberto)}</small>
                </div>
              </li>
              <li>
                <div className="lev-step-title" id="central-formas-label"><span className="lev-num">3</span>Formas de pagamento disponíveis</div>
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
                {ocupadoAqui ? "Salvando…" : editando ? "Salvar levantamento" : "Confirmar levantamento e liberar Agenda de Termos"}
              </button>
              {editando
                ? <button type="button" className="ghost-btn tiny-btn" onClick={() => { form.restaurar(); setErro(null); setEditando(false); }} disabled={ocupadoAqui}>Cancelar edição</button>
                : <button type="button" className="ghost-btn tiny-btn" onClick={() => abrirModal({ tipo: "divergencia" })} disabled={Boolean(ocupado)}>Registrar divergência</button>}
            </div>
          </div>
        </section>
      : <section className="operation-card lev-resumo" aria-label="Levantamento concluído">
          <div className="operation-head"><div><b>✓ Levantamento concluído</b><small>Agenda de Termos liberada no app{c.financeiroConfirmadoEm ? ` · ${dataHoraBr(c.financeiroConfirmadoEm)}` : ""}</small></div></div>
          <div className="operation-body">
            <div className="operation-summary lev-resumo-grid">
              <div><label>Saldo restante</label><strong>{moeda(Number(cadastro.financeiro_saldo_restante ?? 0))}</strong></div>
              <div><label>Formas liberadas</label><strong>{formasPersistidas.map(rotuloFormaCusteio).join(" · ") || "—"}</strong></div>
              {exigeTaxaCartao(formasPersistidas) && <div><label>Taxa do cartão</label><strong>{String(Number(cadastro.financeiro_taxa_cartao ?? 0)).replace(".", ",")}%</strong></div>}
              <div><label>Agenda de Termos</label><strong>Liberada no app</strong></div>
            </div>
            <p className="lev-nota">A cliente agora escolhe uma data disponível.{c.custeioStatus ? ` Forma escolhida por ela: ${rotuloFormaCusteio(c.custeioForma)} (${c.custeioStatus === "aprovada" ? "confirmada" : c.custeioStatus === "recusada" ? "recusada" : "em análise"}).` : ""}</p>
            <div className="lev-actions"><button type="button" className="secondary-btn tiny-btn" onClick={() => { form.restaurar(); setErro(null); setEditando(true); }} disabled={Boolean(ocupado)}>Editar levantamento</button></div>
          </div>
        </section>}
    <div id="levantamento-parcelas" className="lev-parcelas">{parcelas}</div>
  </>;
}

function OperacaoTermos({ c, hoje, abrirModal, irParaAgenda }: Parameters<typeof ProcessoTab>[0]) {
  const diff = c.dataTermos ? diasEntre(hoje, c.dataTermos) : null;
  return <section className="operation-card">
    <div className="operation-head">
      <div><b>Próximo atendimento de termos</b><small>Data escolhida pela cliente</small></div>
      <span className="badge success">{diff === 0 ? "Hoje" : diff === 1 ? "Amanhã" : diff != null && diff > 1 ? `Em ${diff} dias` : "Data atingida"}</span>
    </div>
    <div className="operation-body">
      <ChosenDate iso={c.dataTermos} horario={c.horarioTermos} rotulo="Assinatura dos termos" />
      <div className="operation-summary terms-summary">
        <div className="responsible-summary">
          <label>Responsável pelo atendimento</label>
          <strong>{c.termosResponsavel || "Não definido"}</strong>
          <button type="button" className="mini-link responsible-link" onClick={() => abrirModal({ tipo: "responsavel" })} disabled={!c.agendamentoId}>{c.termosResponsavel ? "Alterar responsável" : "Definir responsável"}</button>
        </div>
      </div>
      <div className="terms-auto-transition">No dia agendado, a cliente passa automaticamente para <b>Liberações financeiras</b>.</div>
      <div className="inline-actions" style={{ marginTop: 9 }}>
        <button type="button" className="secondary-btn tiny-btn" onClick={() => irParaAgenda("terms", c.dataTermos)}>Ver na agenda</button>
        <button type="button" className="primary-btn tiny-btn" onClick={() => abrirModal({ tipo: "reagendar" })} disabled={!c.agendamentoId}>Reagendar</button>
      </div>
    </div>
  </section>;
}

function OperacaoLiberacao(p: Parameters<typeof ProcessoTab>[0]) {
  const { c, hoje, ocupado, abrirModal, executar } = p;
  const e = estadoLiberacao(c, hoje);
  const [previsao, setPrevisao] = useState(() => sugerirPrevisaoCirurgica(c));
  const previsaoOk = Boolean(c.previsaoConfirmadaEm);

  useEffect(() => {
    setPrevisao(sugerirPrevisaoCirurgica(c));
  }, [c.id, c.agendamentoId, c.previsaoCirurgia, c.dataTermos]);

  if (e.ambos) {
    const inicio = e.inicio ? proximoDiaUtil(e.inicio) : null;
    const aguardandoInicio = inicio ? hoje < inicio : false;
    const pct = e.liberada ? 100 : Math.max(0, Math.min(100, (e.decorridos / e.totalDias) * 100));
    return <section className="operation-card">
      <div className="operation-head">
        <div><b>Liberação cirúrgica</b><small>Conferência concluída. Agora você pode aguardar o prazo ou agir manualmente.</small></div>
        <span className={`badge ${e.liberada ? "success" : "wait"}`}>{e.liberada ? "Agenda liberada" : "Aguardando prazo"}</span>
      </div>
      <div className="operation-body">
        <div className="release-summary">
          <span className="release-summary-chip done">✓ <b>Comparecimento</b><small>{horaLocal(c.comparecimentoEm)}</small></span>
          <span className="release-summary-chip done">✓ <b>Quitação</b><small>{horaLocal(c.quitacaoEm)}</small></span>
        </div>
        <button type="button" className="release-deadline-card" onClick={() => abrirModal({ tipo: "liberacao" })}>
          <div className="release-deadline-copy">
            <small>Prazo automático</small>
            <h4>{e.liberada ? "Agenda cirúrgica liberada" : `Liberação prevista para ${dataBr(e.previsao)}`}</h4>
            <p>{e.liberada ? "A agenda já foi disponibilizada no app da cliente." : aguardandoInicio ? "Comparecimento e quitação já foram confirmados. O prazo começa a contar no próximo dia útil." : "O prazo já está em andamento e você pode ajustar manualmente se necessário."}</p>
          </div>
          <div className="release-deadline-side">
            <span className="release-deadline-pill">{e.liberada ? "Liberada" : aguardandoInicio ? "Aguardando início do prazo" : `${e.decorridos}/${e.totalDias} dias úteis corridos`}</span>
            <strong>{e.liberada ? "Clique para revisar" : aguardandoInicio ? "Clique para ajustar" : "Clique para gerenciar"}</strong>
          </div>
        </button>
        <div className="release-meta-grid">
          <div><label>Prazo total</label><strong>{e.totalDias} dias úteis</strong></div>
          <div><label>Início da contagem</label><strong>{dataBr(inicio)}</strong></div>
        </div>
        <div className="progress-track eligibility-track" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
        <div className="inline-actions" style={{ marginTop: 10 }}>
          {e.liberada
            ? !c.dataCirurgia && <button type="button" className="secondary-btn tiny-btn" onClick={() => abrirModal({ tipo: "agendarCirurgia" })}>Agendar cirurgia</button>
            : <button type="button" className="secondary-btn tiny-btn" onClick={() => abrirModal({ tipo: "liberacao" })}>Gerenciar prazo</button>}
        </div>
      </div>
    </section>;
  }

  const att = c.comparecimentoStatus, pay = c.quitacaoStatus;
  return <section className="operation-card">
    <div className="operation-head">
      <div><b>Liberação cirúrgica</b><small>Confirme o comparecimento e a quitação no dia agendado.</small></div>
      <span className="badge wait">Conferência presencial</span>
    </div>
    <div className="operation-body">
      <div className={`release-task${previsaoOk ? " done" : ""}`}>
        <div className="release-task-main">
          <span className="release-task-icon" aria-hidden="true">{previsaoOk ? "✓" : "▣"}</span>
          <div className="release-task-copy">
            <b>Previsão cirúrgica</b>
            <small>{previsaoOk ? `Confirmada para ${dataBr(c.previsaoCirurgia)}.` : previsao ? "Sugestão automática: 90 dias após a assinatura dos termos. Você pode ajustar a data antes de confirmar." : "Confirme a data-alvo da agenda cirúrgica antes da conferência presencial."}</small>
          </div>
        </div>
        {!previsaoOk && c.agendamentoId && <form className="release-forecast-form" onSubmit={(ev) => { ev.preventDefault(); if (previsao) void executar("previsao", () => centralApi.confirmarPrevisao(c.agendamentoId!, previsao), "Previsão cirúrgica confirmada."); }}>
          <label className="release-date-field">
            <span>Data prevista</span>
            <input type="date" aria-label="Data da previsão cirúrgica" value={previsao} min={hoje} onChange={(ev) => setPrevisao(ev.target.value)} disabled={Boolean(ocupado)} />
          </label>
          <button type="submit" className="release-action-btn positive" disabled={!previsao || Boolean(ocupado)} aria-busy={ocupado === "previsao"}>
            <CalendarCheck2 size={14} strokeWidth={1.8} aria-hidden="true" />
            <span>{ocupado === "previsao" ? "Salvando…" : "Confirmar previsão"}</span>
          </button>
        </form>}
      </div>

      <div className={`release-task${att === "compareceu" ? " done" : att === "nao_compareceu" ? " failed" : ""}`}>
        <div className="release-task-main">
          <span className="release-task-icon" aria-hidden="true">{att === "compareceu" ? "✓" : att === "nao_compareceu" ? "✕" : "1"}</span>
          <div className="release-task-copy">
            <b>Comparecimento</b>
            <small>{att === "compareceu" ? `Confirmado às ${horaLocal(c.comparecimentoEm)}.` : att === "nao_compareceu" ? "Ausência registrada." : previsaoOk ? "Confirme quando a cliente comparecer para assinatura." : "Disponível após confirmar a previsão cirúrgica."}</small>
          </div>
        </div>
        {att === "pendente" && <div className="release-task-actions" role="group" aria-label="Ações de comparecimento">
          <button type="button" className="release-action-btn positive" disabled={!previsaoOk || Boolean(ocupado)} onClick={() => abrirModal({ tipo: "comparecimento", compareceu: true })}>
            <UserCheck size={14} strokeWidth={1.8} aria-hidden="true" />
            <span>Confirmar comparecimento</span>
          </button>
          <button type="button" className="release-action-btn negative" disabled={!previsaoOk || Boolean(ocupado)} onClick={() => abrirModal({ tipo: "comparecimento", compareceu: false })}>
            <UserX size={14} strokeWidth={1.8} aria-hidden="true" />
            <span>Não compareceu</span>
          </button>
        </div>}
      </div>

      <div className={`release-task${pay === "paga" ? " done" : pay === "nao_realizada" ? " failed" : ""}`}>
        <div className="release-task-main">
          <span className="release-task-icon" aria-hidden="true">{pay === "paga" ? "✓" : pay === "nao_realizada" ? "✕" : "2"}</span>
          <div className="release-task-copy">
            <b>Quitação do saldo</b>
            <small>{pay === "paga" ? `Confirmada às ${horaLocal(c.quitacaoEm)}.` : pay === "nao_realizada" ? "Quitação não confirmada." : `Saldo a conferir: ${c.custeioSaldo != null ? moeda(c.custeioSaldo) : "—"}${c.custeioForma ? ` · ${rotuloFormaCusteio(c.custeioForma)}` : ""}`}</small>
          </div>
        </div>
        {pay === "pendente" && <div className="release-task-actions" role="group" aria-label="Ações de quitação">
          <button type="button" className="release-action-btn positive" disabled={!previsaoOk || Boolean(ocupado)} onClick={() => abrirModal({ tipo: "quitacao" })}>
            <BadgeDollarSign size={14} strokeWidth={1.8} aria-hidden="true" />
            <span>Confirmar quitação</span>
          </button>
          <button type="button" className="release-action-btn negative" disabled={!previsaoOk || Boolean(ocupado)} onClick={() => abrirModal({ tipo: "naoQuitado" })}>
            <CircleX size={14} strokeWidth={1.8} aria-hidden="true" />
            <span>Não quitado</span>
          </button>
        </div>}
      </div>
    </div>
  </section>;
}

function OperacaoCirurgia({ c, concluido, abrirModal, ocupado }: Parameters<typeof ProcessoTab>[0]) {
  return <section className="operation-card">
    <div className="operation-head"><div><b>{concluido ? "Processo concluído" : "Cirurgia confirmada"}</b><small>{concluido ? "Pagamento confirmado e fluxo encerrado" : "A cliente escolheu a data após a liberação da agenda"}</small></div><span className="badge success">{concluido ? "Concluído" : "Confirmada"}</span></div>
    <div className="operation-body">
      <ChosenDate iso={c.dataCirurgia} horario={c.horarioCirurgia} rotulo="Data da cirurgia" />
      <div className="operation-summary">
        <div><label>Procedimento</label><strong>{c.procedimento || "—"}</strong></div>
        <div><label>Carta de crédito</label><strong>{moeda(c.cartaDeCredito)}</strong></div>
      </div>
      {concluido
        ? <div className="completion-callout"><b>Processo concluído</b><br />{c.pagamentoCirurgiaConfirmadoEm ? `Pagamento da cirurgia confirmado em ${dataHoraBr(c.pagamentoCirurgiaConfirmadoEm)}.` : "Pagamento da cirurgia confirmado."}{c.quitacaoStatus === "paga" ? " Contrato quitado." : ""} Este registro permanece disponível para consulta nesta data cirúrgica.</div>
        : <div className="inline-actions" style={{ marginTop: 10 }}><button type="button" className="success-btn strong tiny-btn" disabled={!c.agendamentoId || Boolean(ocupado)} onClick={() => abrirModal({ tipo: "pagamentoCirurgia" })}>Confirmar pagamento da cirurgia</button></div>}
    </div>
  </section>;
}

function ProximaEtapa({ c, estagio, concluido }: { c: CartaoCliente; estagio: EstagioCentral; concluido: boolean }) {
  const totalDias = 5 + Math.max(0, c.prazoAjusteDias || 0);
  const copy: Partial<Record<EstagioCentral, [string, string, string]>> = {
    financialReview: ["Depois desta etapa", "A cliente escolhe a data dos termos no app.", "Após a confirmação"],
    financialRelease: ["Depois desta etapa", `Comparecimento + quitação iniciam ${totalDias} dias úteis. Ao fim do prazo, a Agenda Cirúrgica libera no app; a cliente só vai para Cirurgias confirmadas depois de escolher uma data.`, "Regra automática"],
    surgeryConfirmed: [concluido ? "Processo arquivado" : "Etapa atual", concluido ? "O processo foi concluído e permanece arquivado na data cirúrgica. Use a Jornada para consultar todo o caminho percorrido." : "A cirurgia já possui data e horário confirmados. Use a Jornada para consultar todo o caminho percorrido pela cliente.", "Fluxo concluído"],
  };
  const x = copy[estagio];
  if (!x || (estagio === "financialReview" && c.statusRevisaoFinanceira === "aprovada")) return null;
  return <section className="next-stage-card">
    <span className="next-stage-icon" aria-hidden="true">→</span>
    <div><small>{x[0]}</small><b>{x[1]}</b><span className="auto-pill">{x[2]}</span></div>
  </section>;
}

function Fato({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return <div className="history-fact"><label>{rotulo}</label><strong>{valor}</strong></div>;
}

function EtapaHistorica({ c, cadastro, estagio, eventos }: Parameters<typeof ProcessoTab>[0]) {
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
