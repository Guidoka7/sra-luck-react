import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { centralApi, dataBr, diaSemana, HORARIOS_CIRURGIA, moeda, proximoDiaUtil, rotuloFormaCusteio, somarMeses } from "./api";
import type { CartaoCliente, DiaCalendario } from "./types";
import { V46Modal } from "./V46Modal";
import type { estadoLiberacao } from "./v46Cards";

type Executar = (chave: string, fn: () => Promise<unknown>, sucesso: string) => Promise<boolean>;

/** V46 `showTermsResponsibleModal` → `/api/admin/central/termos/responsavel`. */
export function ResponsavelModal({ agendamentoId, atual, sugestoes, onClose, onSalvo }: {
  agendamentoId: string; atual: string | null; sugestoes: string[]; onClose: () => void; onSalvo: () => void | Promise<void>;
}) {
  const [nome, setNome] = useState(atual ?? "");
  const [enviando, setEnviando] = useState(false);
  const listaId = "central-responsaveis-sugestoes";
  async function salvar() {
    const valor = nome.trim();
    if (!valor) { toast.warning("Informe o nome do responsável."); return; }
    if (enviando) return;
    setEnviando(true);
    try {
      await centralApi.definirResponsavelTermos(agendamentoId, valor);
      toast.success("Responsável definido.");
      await onSalvo();
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível salvar o responsável."); }
    finally { setEnviando(false); }
  }
  return <V46Modal titulo="Responsável pelo atendimento" onClose={onClose} bloqueado={enviando} footer={<>
    <button type="button" className="secondary-btn" onClick={onClose} disabled={enviando}>Cancelar</button>
    <button type="button" className="primary-btn" onClick={salvar} disabled={enviando} aria-busy={enviando}>{enviando ? "Salvando…" : "Salvar responsável"}</button>
  </>}>
    <form className="field" onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
      <label htmlFor="central-responsavel-input">Responsável</label>
      <input id="central-responsavel-input" list={listaId} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Digite ou selecione o nome do responsável" autoComplete="off" maxLength={120} />
      <datalist id={listaId}>{sugestoes.map((n) => <option key={n} value={n} />)}</datalist>
      <small>Os responsáveis já utilizados aparecem como sugestão. Você também pode digitar um novo nome.</small>
    </form>
  </V46Modal>;
}

/** V46 `showPaymentModal`: confirma a quitação do saldo escolhido pela cliente. */
export function QuitacaoModal({ c, saldo, onClose, executar }: { c: CartaoCliente; saldo: number | null; onClose: () => void; executar: Executar }) {
  const [enviando, setEnviando] = useState(false);
  async function confirmar() {
    setEnviando(true);
    const ok = await executar("quitacao", () => centralApi.registrarQuitacao(c.agendamentoId!, true), "Quitação do saldo confirmada.");
    setEnviando(false);
    if (ok) onClose();
  }
  return <V46Modal titulo="Confirmar quitação do saldo" onClose={onClose} bloqueado={enviando} footer={<>
    <button type="button" className="secondary-btn" onClick={onClose} disabled={enviando}>Cancelar</button>
    <button type="button" className="primary-btn" onClick={confirmar} disabled={enviando} aria-busy={enviando}>{enviando ? "Confirmando…" : "Confirmar pagamento"}</button>
  </>}>
    <div className="drawer-form">
      <div className="field"><label>Valor do saldo</label><input readOnly value={saldo != null ? moeda(saldo) : "—"} aria-readonly="true" /></div>
      <div className="field"><label>Forma escolhida pela cliente</label><input readOnly value={rotuloFormaCusteio(c.custeioForma)} aria-readonly="true" /></div>
    </div>
    <div className="process-note" style={{ marginTop: 10 }}>O valor e a forma vêm do levantamento e da escolha feita no app. A confirmação fica registrada no histórico da cliente.</div>
  </V46Modal>;
}

/** V46 `showReleaseManagementModal`: ajuste +1/+3/+5 ou liberação imediata. */
export function LiberacaoModal({ c, estado, onClose, executar }: {
  c: CartaoCliente; estado: ReturnType<typeof estadoLiberacao>; onClose: () => void; executar: Executar;
}) {
  const [enviando, setEnviando] = useState<string | null>(null);
  async function rodar(chave: string, fn: () => Promise<unknown>, msg: string) {
    if (enviando) return;
    setEnviando(chave);
    const ok = await executar(chave, fn, msg);
    setEnviando(null);
    if (ok) onClose();
  }
  const inicio = estado.inicio ? proximoDiaUtil(estado.inicio) : null;
  return <V46Modal titulo="Gerenciar liberação cirúrgica" onClose={onClose} bloqueado={Boolean(enviando)} footer={<button type="button" className="secondary-btn" onClick={onClose} disabled={Boolean(enviando)}>Fechar</button>}>
    <div className="release-manage-box">
      <small>Prazo automático atual</small>
      <b>{estado.liberada ? "Agenda cirúrgica liberada" : `Liberação prevista para ${dataBr(estado.previsao)}`}</b>
      <p>O prazo começou a contar a partir do próximo dia útil após a confirmação presencial e financeira: <strong>{dataBr(inicio)}</strong>.</p>
    </div>
    <div className="release-manage-grid">
      {([1, 3, 5] as const).map((d) => <button key={d} type="button" className="secondary-btn" disabled={Boolean(enviando) || estado.liberada} onClick={() => rodar(`prazo${d}`, () => centralApi.ajustarPrazo(c.agendamentoId!, d), `Prazo ajustado em +${d} dia${d > 1 ? "s" : ""} út${d > 1 ? "eis" : "il"}.`)}>{enviando === `prazo${d}` ? "Salvando…" : `+ ${d} dia${d > 1 ? "s úteis" : " útil"}`}</button>)}
      {estado.liberada
        ? <button type="button" className="primary-btn" disabled>Agenda já liberada</button>
        : <button type="button" className="primary-btn" disabled={Boolean(enviando)} onClick={() => rodar("liberarAgora", () => centralApi.liberarAgendaCirurgicaAgora(c.agendamentoId!), "Agenda cirúrgica liberada no app da cliente.")}>{enviando === "liberarAgora" ? "Liberando…" : "Liberar agenda cirúrgica agora"}</button>}
    </div>
  </V46Modal>;
}

interface DiaEscolha { data: string; vagas: number; livreNoMes: number }

/**
 * Agendamento administrativo da cirurgia (V46 `showScheduleModal` para
 * cirurgia / `showManualSurgeryModal`). Datas e teto vêm de
 * `/api/admin/central/cirurgia`; a reserva é validada no banco
 * (`agenda_reservar_cirurgia`, advisory lock + teto mensal).
 */
export function AgendarCirurgiaModal({ clientes, dataFixa, hoje, onClose, onAgendado }: {
  clientes: CartaoCliente[]; dataFixa?: string | null; hoje: string; onClose: () => void; onAgendado: () => void | Promise<void>;
}) {
  const [clienteId, setClienteId] = useState(clientes[0]?.id ?? "");
  const [dias, setDias] = useState<DiaEscolha[] | null>(null);
  const [data, setData] = useState<string | null>(dataFixa ?? null);
  const [horario, setHorario] = useState(HORARIOS_CIRURGIA[0]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const cliente = clientes.find((c) => c.id === clienteId) ?? null;

  useEffect(() => {
    let vivo = true;
    const meses = dataFixa ? [dataFixa] : [hoje, somarMeses(hoje, 1), somarMeses(hoje, 2)];
    Promise.all(meses.map((m) => centralApi.agendaCirurgia(Number(m.slice(0, 4)), Number(m.slice(5, 7)))))
      .then((respostas) => {
        if (!vivo) return;
        const lista: DiaEscolha[] = [];
        for (const r of respostas) {
          const livre = Math.max(0, r.tetoMensal - r.comprometidoMensal);
          for (const d of r.calendario as DiaCalendario[]) {
            const vagas = Math.max(0, d.vagasTotais - d.vagasOcupadas);
            if (d.status === "disponivel" && vagas > 0 && d.data >= hoje) lista.push({ data: d.data, vagas, livreNoMes: livre });
          }
        }
        setDias(lista);
      })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Não foi possível carregar as datas cirúrgicas."));
    return () => { vivo = false; };
  }, [dataFixa, hoje]);

  const opcoes = useMemo(() => (dias ?? []).filter((d) => !cliente || cliente.cartaDeCredito <= d.livreNoMes), [dias, cliente]);
  const diaFixo = dataFixa ? (dias ?? []).find((d) => d.data === dataFixa) ?? null : null;

  useEffect(() => { if (!dataFixa && opcoes.length && (!data || !opcoes.some((o) => o.data === data))) setData(opcoes[0].data); }, [opcoes, dataFixa, data]);

  async function confirmar() {
    if (!cliente) { toast.warning("Selecione a cliente liberada."); return; }
    if (!data) { toast.warning("Selecione uma data disponível."); return; }
    if (enviando) return;
    setEnviando(true);
    try {
      await centralApi.agendarDataCirurgia(cliente.id, data, horario);
      toast.success("Cirurgia confirmada e valor comprometido no teto mensal.");
      await onAgendado();
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível agendar a cirurgia."); }
    finally { setEnviando(false); }
  }

  const livre = dataFixa ? diaFixo?.livreNoMes ?? null : null;
  return <V46Modal titulo={dataFixa ? `Adicionar cirurgia em ${dataBr(dataFixa)}` : "Agendar cirurgia"} onClose={onClose} bloqueado={enviando} footer={<>
    <button type="button" className="secondary-btn" onClick={onClose} disabled={enviando}>Cancelar</button>
    <button type="button" className="primary-btn" onClick={confirmar} disabled={enviando || !cliente || !data || (dataFixa ? !diaFixo : false)} aria-busy={enviando}>{enviando ? "Salvando…" : dataFixa ? "Adicionar" : "Confirmar escolha"}</button>
  </>}>
    {erro && <div className="callout danger" role="alert">{erro}</div>}
    {!erro && dias === null && <div className="process-note">Carregando datas cirúrgicas…</div>}
    {!erro && dias !== null && <>
      <div className="callout info">
        {dataFixa
          ? (diaFixo ? <><b>{moeda(livre ?? 0)}</b> disponíveis no teto financeiro deste mês.</> : "A data selecionada não está aberta ou não possui vaga.")
          : <>São exibidas somente datas abertas com vaga em meses que comportem a carta de crédito de <b>{moeda(cliente?.cartaDeCredito ?? 0)}</b> dentro do teto mensal.</>}
      </div>
      {clientes.length > 1 || dataFixa
        ? <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="central-cirurgia-cliente">Cliente liberada</label>
            <select id="central-cirurgia-cliente" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome} — {c.procedimento ?? "—"} — {moeda(c.cartaDeCredito)}</option>)}
            </select>
          </div>
        : null}
      {!dataFixa && (opcoes.length === 0
        ? <div className="empty-card" style={{ marginTop: 10 }}>Nenhuma data aberta com vaga comporta esta carta de crédito nos próximos meses.</div>
        : <div className="choice-grid" role="listbox" aria-label="Datas disponíveis">
            {opcoes.slice(0, 12).map((d) => <button key={d.data} type="button" role="option" aria-selected={d.data === data} className={`choice-card${d.data === data ? " selected" : ""}`} onClick={() => setData(d.data)}>
              <b>{dataBr(d.data)}</b>
              <small>{diaSemana(d.data).toLowerCase()} · {d.vagas} vaga(s) · {moeda(d.livreNoMes)} livres no mês</small>
            </button>)}
          </div>)}
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="central-cirurgia-horario">Horário</label>
        <select id="central-cirurgia-horario" value={horario} onChange={(e) => setHorario(e.target.value)}>
          {HORARIOS_CIRURGIA.map((h) => <option key={h}>{h}</option>)}
        </select>
      </div>
    </>}
  </V46Modal>;
}
