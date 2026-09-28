import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Plus } from "lucide-react";
import { centralApi, dataBr, mesAno, moeda, somarMeses } from "./api";
import { AgendaCalendar, AppointmentRow, capacidadeAoLiberar, DayPanel, statusDoDia } from "./AgendaCalendar";
import type { AgendaCirurgiaResponse, CartaoCliente } from "./types";
import { AgendarCirurgiaModal } from "./DrawerModals";
import { ConfirmModal } from "./V46Modal";

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
    if (data < hoje) { toast.warning("Esta data já passou e está disponível somente para consulta."); return false; }
    if (ocupado) return false;
    setOcupado(true);
    try {
      await centralApi.abrirBloquearCirurgia(data, acao, vagas);
      toast.success(msg ?? (acao === "liberar" ? "Data cirúrgica aberta. O sistema ainda validará o teto financeiro de cada cliente." : "Data fechada: não aparece mais para novas escolhas no app."));
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
    if (data < hoje) { toast.warning("Não é possível criar cirurgia em uma data que já passou."); return; }
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

  return <div className="ag-agenda surgery-agenda">
    {atual && <section className={`ag-panel ag-teto is-${st.cls}`} aria-label="Teto financeiro do mês">
      <div className="ag-teto-head">
        <div>
          <span className="ag-eyebrow">Teto financeiro para cirurgias · {mesAno(data)}</span>
          <strong>{moeda(usado)} <small>de {moeda(teto)} comprometidos</small></strong>
        </div>
        <span className={`ag-status is-${st.cls === "success" ? "open" : st.cls === "wait" ? "warn" : "closed"}`}>{st.rotulo}</span>
      </div>
      <div className="ag-teto-barra" role="progressbar" aria-valuenow={Math.min(100, pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Teto financeiro comprometido"><span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>
      <p>{excedido > 0 ? <>O teto foi ultrapassado em <b>{moeda(excedido)}</b>. Novas escolhas deste mês ficam bloqueadas.</> : restante === 0 ? "O teto mensal foi atingido. Novas escolhas deste mês ficam bloqueadas." : <>Ainda cabem <b>{moeda(restante)}</b> em cartas de crédito neste mês. Cada nova cirurgia também passa por essa validação.</>}</p>
    </section>}

    <div className="ag-resumo" aria-label="Resumo da Agenda Cirúrgica">
      <div className="ag-resumo-item"><span>Cirurgias no mês</span><b>{mapa.length}</b></div>
      <div className={`ag-resumo-item${pendentes ? " is-alerta" : ""}`}><span>Aguardando pagamento</span><b>{pendentes}</b><small>{concluidos} concluídas</small></div>
      <div className="ag-resumo-item"><span>Datas abertas com vaga</span><b>{datasAbertas}</b><small>{Math.max(0, capacidade - usadasAbertas)} vagas livres</small></div>
      <div className="ag-resumo-item"><span>Liberadas para escolher</span><b>{liberadas.length}</b><small>{candidatas.length} cabem no teto</small></div>
    </div>

    <div className="ag-workspace">
      <div className="ag-panel ag-cal-panel">
        <AgendaCalendar selecionado={data} hoje={hoje} calendario={calendario} onSelecionar={onData} onMudarMes={(d) => onData(somarMeses(data, d))} />
      </div>
      <DayPanel tipo="surgery" data={data} hoje={hoje} dia={dia} ocupado={ocupado || !calendario} tetoAtingido={tetoAtingido}
        acaoLista={<button type="button" className="ag-btn is-primario" onClick={abrirNovaCirurgia} disabled={ocupado || !calendario}><Plus size={14} aria-hidden="true" />Agendar cirurgia</button>}
        onAbrir={() => void acaoDia("liberar", capacidadeAoLiberar(dia))}
        onBloquear={() => { const n = statusDoDia(dia).usadas; if (n > 0) setConfirmarBloqueio(n); else void acaoDia("bloquear"); }}
        onCapacidade={(n) => void acaoDia("liberar", n, "Capacidade atualizada.")}
        itens={doDia.map((m) => <AppointmentRow key={m.agendamentoId} tipo="surgery" horario={m.horario} nome={m.nome} detalhe={`${m.procedimento ?? "Procedimento não informado"} · ${moeda(m.cartaDeCredito)}`}
          badge={m.processoConcluido ? <span className="ag-situacao is-success">Processo concluído</span> : <span className="ag-situacao is-wait">Aguardando pagamento</span>}
          onAbrir={() => (m.processoConcluido ? onConsultarProcesso : onAbrirCliente)(m.clienteId)}
          acoes={m.processoConcluido ? undefined : <button type="button" className="ag-link" onClick={() => setPagamento({ agendamentoId: m.agendamentoId, nome: m.nome })}>Confirmar pagamento</button>} />)} />
    </div>

    <section className="ag-panel ag-mapa" aria-labelledby="ag-mapa-titulo">
      <header className="ag-panel-head">
        <div><h2 id="ag-mapa-titulo" className="ag-h2">Mapa cirúrgico · {mesAno(data)}</h2><p>Todas as cirurgias do mês. Processos concluídos ficam arquivados na data da cirurgia.</p></div>
        <button type="button" className="ag-btn" onClick={exportarCsv} disabled={!mapa.length}><Download size={14} aria-hidden="true" />Exportar CSV</button>
      </header>
      <div className="ag-tabela-wrap"><table className="ag-tabela">
        <thead><tr><th>Data</th><th>Cliente</th><th>Carta de crédito</th><th>Contrato</th><th>Situação</th><th><span className="ag-sr">Ações</span></th></tr></thead>
        <tbody>
          {!atual && <tr><td colSpan={6} className="ag-tabela-vazia">Carregando…</td></tr>}
          {atual && mapa.length === 0 && <tr><td colSpan={6} className="ag-tabela-vazia">Nenhuma cirurgia no mês selecionado.</td></tr>}
          {mapa.map((m) => {
            const c = cartoes.get(m.clienteId);
            return <tr key={m.agendamentoId} className={m.data === data ? "is-sel" : undefined}>
              <td><button type="button" className="ag-link ag-data" onClick={() => onData(m.data)}><b>{dataBr(m.data)}</b><small>{m.horario ?? "—"}</small></button></td>
              <td><b>{m.nome}</b><small>{m.procedimento ?? "—"}</small></td>
              <td className="ag-num">{moeda(m.cartaDeCredito)}</td>
              <td>{m.quitada ? <span className="ag-situacao is-success">Quitado</span> : c ? `${c.parcelasPagas} de ${c.totalParcelas} pagas` : "—"}</td>
              <td>{m.processoConcluido ? <span className="ag-situacao is-success">Processo concluído</span> : <span className="ag-situacao is-wait">Aguardando pagamento</span>}</td>
              <td className="ag-tabela-acoes">
                {m.processoConcluido
                  ? <button type="button" className="ag-link" onClick={() => onConsultarProcesso(m.clienteId)}>Consultar processo</button>
                  : <>
                    <button type="button" className="ag-link" onClick={() => onAbrirCliente(m.clienteId)}>Abrir cliente</button>
                    <button type="button" className="ag-btn is-primario is-pequeno" onClick={() => setPagamento({ agendamentoId: m.agendamentoId, nome: m.nome })}>Confirmar pagamento</button>
                  </>}
              </td>
            </tr>;
          })}
        </tbody>
      </table></div>
    </section>

    {confirmarBloqueio != null && <ConfirmModal titulo="Fechar data" perigo rotuloConfirmar="Fechar data"
      mensagem={`Esta data possui ${confirmarBloqueio} agendamento(s). Fechar a data só impede novas escolhas no app: os agendamentos existentes continuam valendo. Deseja continuar?`}
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
