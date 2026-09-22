import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { centralApi, dataBr, mesAno, moeda, somarMeses } from "./api";
import { AgendaCalendar, AppointmentRow, DayPanel, statusDoDia } from "./AgendaCalendar";
import type { AgendaCirurgiaResponse, CartaoCliente } from "./types";
import { AgendarCirurgiaModal } from "./DrawerModals";
import { ConfirmModal } from "./V46Modal";

const VAGAS_PADRAO_CIRURGIA = 4;

/**
 * Agenda Cirúrgica V46: calendário, painel do dia com teto financeiro do
 * mês (`agenda_comprometimento_mes`), "＋ Nova cirurgia" e mapa cirúrgico.
 * Toda validação de teto/vaga é do banco (`agenda_reservar_cirurgia`).
 */
export function SurgeryAgendaTab({ hoje, data, onData, recarregarKey, liberadas, cartoes, onAbrirCliente, onConsultarProcesso, onMudou }: {
  hoje: string; data: string; onData: (iso: string) => void; recarregarKey: number;
  liberadas: CartaoCliente[]; cartoes: Map<string, CartaoCliente>;
  onAbrirCliente: (clienteId: string) => void; onConsultarProcesso: (clienteId: string) => void; onMudou: () => void | Promise<void>;
}) {
  const [dados, setDados] = useState<AgendaCirurgiaResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarBloqueio, setConfirmarBloqueio] = useState<number | null>(null);
  const [pagamento, setPagamento] = useState<{ agendamentoId: string; nome: string } | null>(null);
  const [novaCirurgia, setNovaCirurgia] = useState(false);
  const ano = Number(data.slice(0, 4)), mes = Number(data.slice(5, 7));

  const carregar = useCallback(async () => {
    try { setDados(await centralApi.agendaCirurgia(ano, mes)); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível carregar a Agenda Cirúrgica."); }
  }, [ano, mes]);
  useEffect(() => { void carregar(); }, [carregar, recarregarKey]);

  async function acaoDia(acao: "liberar" | "bloquear", vagas?: number, msg?: string) {
    if (ocupado) return false;
    setOcupado(true);
    try {
      await centralApi.abrirBloquearCirurgia(data, acao, vagas);
      toast.success(msg ?? (acao === "liberar" ? "Data cirúrgica aberta. O sistema ainda validará o teto financeiro de cada cliente." : "Data bloqueada."));
      await carregar(); await onMudou();
      return true;
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível atualizar a data."); return false; }
    finally { setOcupado(false); }
  }

  if (erro && !dados) return <div className="panel panel-pad"><div className="callout danger" role="alert">{erro}</div><div className="inline-actions" style={{ marginTop: 10 }}><button type="button" className="secondary-btn" onClick={() => void carregar()}>Tentar novamente</button></div></div>;

  const atual = dados && dados.ano === ano && dados.mes === mes ? dados : null;
  const calendario = atual?.calendario ?? null;
  const dia = calendario?.find((d) => d.data === data);
  const mapa = [...(atual?.mapaCirurgico ?? [])].sort((a, b) => `${a.data} ${a.horario ?? ""}`.localeCompare(`${b.data} ${b.horario ?? ""}`));
  const concluidos = mapa.filter((m) => m.processoConcluido).length;
  const pendentes = mapa.length - concluidos;
  const abertos = (calendario ?? []).filter((d) => d.status === "disponivel");
  const datasAbertas = abertos.filter((d) => d.vagasOcupadas < d.vagasTotais).length;
  const capacidade = abertos.reduce((s, d) => s + (d.vagasTotais || 0), 0);
  const usadasAbertas = abertos.reduce((s, d) => s + d.vagasOcupadas, 0);
  const ocupacao = capacidade ? Math.round((usadasAbertas / capacidade) * 100) : 0;
  const teto = atual?.tetoMensal ?? 0, usado = atual?.comprometidoMensal ?? 0;
  const restante = Math.max(0, teto - usado), excedido = Math.max(0, usado - teto);
  const pct = teto ? Math.round((usado / teto) * 100) : 0;
  const tetoAtingido = Boolean(atual) && restante <= 0;
  const st = usado >= teto && teto > 0 ? { rotulo: excedido > 0 ? "Teto excedido" : "Teto atingido", cls: "danger" } : pct >= 80 ? { rotulo: "Atenção ao limite", cls: "wait" } : { rotulo: "Limite disponível", cls: "success" };
  const doDia = mapa.filter((m) => m.data === data);
  const candidatas = liberadas.filter((c) => c.cartaDeCredito <= restante);

  function abrirNovaCirurgia() {
    const s = statusDoDia(dia);
    if (!(s.kind === "available" || s.kind === "partial")) { toast.warning("A data selecionada não está disponível."); return; }
    if (tetoAtingido) { toast.warning(`O teto financeiro deste mês já foi atingido (${moeda(teto)}).`); return; }
    if (!candidatas.length) { toast.warning(`Nenhuma cliente liberada cabe no saldo mensal disponível de ${moeda(restante)}.`); return; }
    setNovaCirurgia(true);
  }

  function exportarCsv() {
    const linhas = [
      ["Data", "Horário", "Cliente", "Procedimento", "Carta de crédito", "Parcelamento", "Quitação do contrato", "Status do processo"],
      ...mapa.map((m) => {
        const c = cartoes.get(m.clienteId);
        return [dataBr(m.data), m.horario ?? "", m.nome, m.procedimento ?? "", moeda(m.cartaDeCredito), c ? `${c.totalParcelas}x · ${c.parcelasPagas} pagas` : "", m.quitada ? "Quitada" : "Pendente", m.processoConcluido ? "Processo concluído" : "Aguardando pagamento da cirurgia"];
      }),
    ];
    const csv = linhas.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `mapa-cirurgico-${data.slice(0, 7)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
    toast.success("CSV exportado.");
  }

  return <div className="calendar-page surgery-agenda">
    <div className="agenda-meta-line" aria-label="Resumo da Agenda Cirúrgica">
      <span><b>{datasAbertas}</b> datas cirúrgicas abertas</span>
      <span><b>{pendentes}</b> aguardando pagamento</span>
      <span><b>{concluidos}</b> processos concluídos</span>
      <span><b>{Math.max(0, capacidade - usadasAbertas)}</b> vagas disponíveis</span>
      <span><b>{ocupacao}%</b> ocupação</span>
      <span className="agenda-rule">Agenda cirúrgica · novas escolhas também respeitam o teto financeiro mensal de {moeda(teto || 100000)}</span>
    </div>

    <div className="calendar-workspace">
      <div className="panel panel-pad v46-surgery-calendar-panel">
        <AgendaCalendar selecionado={data} hoje={hoje} calendario={calendario} onSelecionar={onData} onMudarMes={(d) => onData(somarMeses(data, d))} />
      </div>
      <DayPanel tipo="surgery" data={data} dia={dia} ocupado={ocupado || !calendario} tetoAtingido={tetoAtingido}
        antesDaLista={atual && <div className={`surgery-financial-cap ${st.cls}`}>
          <div className="surgery-financial-cap-head">
            <div><small>Teto financeiro para cirurgias · {mesAno(data).replace(/^./, (x) => x.toUpperCase())}</small><strong>{moeda(teto)}</strong></div>
            <span className={`badge ${st.cls}`}>{st.rotulo}</span>
          </div>
          <div className="surgery-financial-numbers">
            <div><span>Comprometido</span><b>{moeda(usado)}</b></div>
            <div><span>Disponível</span><b>{moeda(restante)}</b></div>
            <div><span>Cirurgias no mês</span><b>{mapa.length}</b></div>
          </div>
          <div className="surgery-financial-track" role="progressbar" aria-valuenow={Math.min(100, pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Teto financeiro comprometido"><span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>
          <p>{excedido > 0 ? <>O teto foi ultrapassado em <b>{moeda(excedido)}</b>. Novas escolhas deste mês ficam bloqueadas.</> : restante === 0 ? "O teto mensal foi atingido. Novas escolhas deste mês ficam bloqueadas." : <>Ainda há <b>{moeda(restante)}</b> disponíveis para novas liberações neste mês.</>}</p>
        </div>}
        acaoLista={<button type="button" className="primary-btn" onClick={abrirNovaCirurgia} disabled={ocupado || !calendario}>＋ Nova cirurgia</button>}
        onAbrir={() => void acaoDia("liberar", dia?.vagasTotais || VAGAS_PADRAO_CIRURGIA)}
        onBloquear={() => { const n = statusDoDia(dia).usadas; if (n > 0) setConfirmarBloqueio(n); else void acaoDia("bloquear"); }}
        onCapacidade={(n) => void acaoDia("liberar", n, "Capacidade atualizada.")}
        itens={doDia.map((m) => <AppointmentRow key={m.agendamentoId} tipo="surgery" horario={m.horario} nome={m.nome} detalhe={m.procedimento ?? "—"}
          badge={m.processoConcluido ? <span className="badge success">Processo concluído</span> : <span className="badge wait">Aguardando pagamento</span>}
          onAbrir={() => (m.processoConcluido ? onConsultarProcesso : onAbrirCliente)(m.clienteId)} />)} />
    </div>

    <div className="panel bottom-table surgery-table">
      <div className="table-toolbar">
        <div><h3>Mapa cirúrgico do mês</h3><small>Registro mensal das cirurgias agendadas. Processos concluídos permanecem arquivados somente no mês e na data escolhida.</small></div>
        <button type="button" className="secondary-btn" onClick={exportarCsv} disabled={!mapa.length}>Exportar CSV</button>
      </div>
      <div className="table-wrap"><table className="data-table">
        <thead><tr><th>Data</th><th>Horário</th><th>Cliente</th><th>Procedimento</th><th>Carta de crédito</th><th>Parcelamento</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>
          {!atual && <tr><td colSpan={8}>Carregando…</td></tr>}
          {atual && mapa.length === 0 && <tr><td colSpan={8}>Nenhuma cirurgia no mês selecionado.</td></tr>}
          {mapa.map((m) => {
            const c = cartoes.get(m.clienteId);
            return <tr key={m.agendamentoId}>
              <td><b>{dataBr(m.data)}</b></td><td>{m.horario ?? "—"}</td><td>{m.nome}</td><td>{m.procedimento ?? "—"}</td>
              <td><b>{moeda(m.cartaDeCredito)}</b></td>
              <td>{m.quitada ? <span className="paid-off-label">Quitada</span> : c ? `${c.totalParcelas}x · ${c.parcelasPagas} pagas` : "—"}</td>
              <td>{m.processoConcluido ? <span className="badge success">Processo concluído</span> : <span className="badge wait">Aguardando pagamento</span>}</td>
              <td><div className="table-actions-stack">
                {m.processoConcluido
                  ? <button type="button" className="mini-link consult-process-btn" onClick={() => onConsultarProcesso(m.clienteId)}>Consultar processo</button>
                  : <>
                      <button type="button" className="mini-link" onClick={() => onAbrirCliente(m.clienteId)}>Abrir cliente</button>
                      <button type="button" className="mini-link" onClick={() => setPagamento({ agendamentoId: m.agendamentoId, nome: m.nome })}>Confirmar pagamento</button>
                    </>}
              </div></td>
            </tr>;
          })}
        </tbody>
      </table></div>
    </div>

    {confirmarBloqueio != null && <ConfirmModal titulo="Bloquear data" perigo rotuloConfirmar="Bloquear"
      mensagem={`Esta data possui ${confirmarBloqueio} agendamento(s). O bloqueio não apagará os agendamentos existentes. Deseja continuar?`}
      onConfirmar={() => acaoDia("bloquear")} onClose={() => setConfirmarBloqueio(null)} />}
    {pagamento && <ConfirmModal titulo="Confirmar pagamento da cirurgia" rotuloConfirmar="Confirmar pagamento"
      mensagem={`Confirmar o pagamento da cirurgia de ${pagamento.nome}? O processo será concluído e ficará arquivado nesta data cirúrgica.`}
      onConfirmar={async () => {
        try { await centralApi.confirmarPagamentoCirurgia(pagamento.agendamentoId); toast.success("Pagamento confirmado. Processo concluído e arquivado na Agenda Cirúrgica."); await carregar(); await onMudou(); return true; }
        catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível confirmar o pagamento."); return false; }
      }}
      onClose={() => setPagamento(null)} />}
    {novaCirurgia && <AgendarCirurgiaModal clientes={candidatas} dataFixa={data} hoje={hoje} onClose={() => setNovaCirurgia(false)} onAgendado={async () => { await carregar(); await onMudou(); }} />}
  </div>;
}
