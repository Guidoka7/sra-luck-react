import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { centralApi, dataBr, somarMeses } from "./api";
import { AgendaCalendar, AppointmentRow, capacidadeAoLiberar, DayPanel, statusDoDia } from "./AgendaCalendar";
import type { AgendaTermosResponse } from "./types";
import { ResponsavelModal } from "./DrawerModals";
import { TermsRescheduleModal } from "./TermsRescheduleModal";
import { ConfirmModal } from "./V46Modal";

/**
 * Agenda de Termos V46: calendário + painel do dia + "Próximas assinaturas".
 * Dados de `/api/admin/central/termos`; abrir/bloquear/vagas via
 * `/termos/data`, responsável via `/termos/responsavel`.
 */
export function TermsAgendaTab({ hoje, data, onData, sugestoesResponsavel, recarregarKey, onAbrirCliente, onMudou }: {
  hoje: string; data: string; onData: (iso: string) => void; sugestoesResponsavel: string[]; recarregarKey: number;
  onAbrirCliente: (clienteId: string) => void; onMudou: () => void | Promise<void>;
}) {
  const [dados, setDados] = useState<AgendaTermosResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [responsavel, setResponsavel] = useState<{ agendamentoId: string; atual: string | null } | null>(null);
  const [reagendar, setReagendar] = useState<{ agendamentoId: string; nome: string; data: string; horario: string | null } | null>(null);
  const [confirmarBloqueio, setConfirmarBloqueio] = useState<number | null>(null);
  const ano = Number(data.slice(0, 4)), mes = Number(data.slice(5, 7));

  const carregar = useCallback(async () => {
    try { setDados(await centralApi.agendaTermos(ano, mes)); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível carregar a Agenda de Termos."); }
  }, [ano, mes]);
  useEffect(() => { void carregar(); }, [carregar, recarregarKey]);

  async function acaoDia(acao: "liberar" | "bloquear", vagas?: number, msg?: string) {
    if (data < hoje) { toast.warning("Esta data já passou e está disponível somente para consulta."); return false; }
    if (ocupado) return false;
    setOcupado(true);
    try {
      await centralApi.abrirBloquearTermos(data, acao, vagas);
      toast.success(msg ?? (acao === "liberar" ? "Data disponível para novos agendamentos." : "Data bloqueada."));
      await carregar(); await onMudou();
      return true;
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível atualizar a data."); return false; }
    finally { setOcupado(false); }
  }

  if (erro && !dados) return <div className="panel panel-pad"><div className="callout danger" role="alert">{erro}</div><div className="inline-actions" style={{ marginTop: 10 }}><button type="button" className="secondary-btn" onClick={() => void carregar()}>Tentar novamente</button></div></div>;

  const calendario = dados && dados.ano === ano && dados.mes === mes ? dados.calendario : null;
  const dia = calendario?.find((d) => d.data === data);
  const prefixo = data.slice(0, 7);
  const doMes = (dados?.proximasAssinaturas ?? []).filter((a) => a.data.startsWith(prefixo));
  const abertas = (calendario ?? []).filter((d) => d.status === "disponivel").length;
  const bloqueadas = (calendario ?? []).filter((d) => d.status !== "disponivel").length;
  const cap = (calendario ?? []).filter((d) => d.status === "disponivel").reduce((s, d) => s + (d.vagasTotais || 0), 0);
  const usadas = (calendario ?? []).filter((d) => d.status === "disponivel").reduce((s, d) => s + d.vagasOcupadas, 0);
  const ocupacao = cap ? Math.round((usadas / cap) * 100) : 0;
  const futuras = (dados?.proximasAssinaturas ?? []).filter((a) => a.data >= hoje);
  const doDia = (dados?.proximasAssinaturas ?? []).filter((a) => a.data === data);

  return <div className="calendar-page terms-agenda">
    <div className="agenda-meta-line" aria-label="Resumo da Agenda de Termos">
      <span><b>{doMes.length}</b> agendamentos no mês</span>
      <span><b>{abertas}</b> datas abertas</span>
      <span><b>{bloqueadas}</b> bloqueadas</span>
      <span><b>{ocupacao}%</b> ocupação</span>
      <span className="agenda-rule">Assinatura de termos · agenda administrativa com vagas e horários liberados para o app</span>
    </div>

    <div className="calendar-workspace">
      <div className="panel panel-pad v46-terms-calendar-panel">
        <AgendaCalendar selecionado={data} hoje={hoje} calendario={calendario} onSelecionar={onData} onMudarMes={(d) => onData(somarMeses(data, d))} />
      </div>
      <DayPanel tipo="terms" data={data} hoje={hoje} dia={dia} ocupado={ocupado || !calendario}
        onAbrir={() => void acaoDia("liberar", capacidadeAoLiberar(dia))}
        onBloquear={() => { const n = statusDoDia(dia).usadas; if (n > 0) setConfirmarBloqueio(n); else void acaoDia("bloquear"); }}
        onCapacidade={(n) => void acaoDia("liberar", n, "Vagas atualizadas.")}
        itens={doDia.map((a) => <AppointmentRow key={a.agendamentoId} tipo="terms" horario={a.horario} nome={a.nome}
          detalhe={`${a.procedimento ?? "—"}${a.responsavel ? ` · ${a.responsavel}` : ""}`}
          badge={<span className="badge success">Confirmado</span>} onAbrir={() => onAbrirCliente(a.clienteId)} />)} />
    </div>

    <div className="panel bottom-table terms-table">
      <div className="table-toolbar">
        <div><h3>Próximas assinaturas de termos</h3><small>Fila operacional em ordem de atendimento: data e horário mais próximos primeiro.</small></div>
      </div>
      <div className="table-wrap"><table className="data-table">
        <thead><tr><th>Data</th><th>Horário</th><th>Cliente</th><th>CPF</th><th>Procedimento</th><th>Responsável</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>
          {!dados && <tr><td colSpan={8}>Carregando…</td></tr>}
          {dados && futuras.length === 0 && <tr><td colSpan={8}>Nenhuma assinatura futura.</td></tr>}
          {futuras.map((a) => <tr key={a.agendamentoId}>
            <td><b>{dataBr(a.data)}</b></td><td>{a.horario ?? "—"}</td><td>{a.nome}</td><td>{a.cpf ?? "—"}</td><td>{a.procedimento ?? "—"}</td>
            <td>{a.responsavel ? <span className="responsible-name">{a.responsavel}</span> : <span className="muted-text">Não definido</span>}</td>
            <td><span className="badge success">Termos confirmados</span></td>
            <td><div className="table-actions-stack">
              <button type="button" className="mini-link" onClick={() => onAbrirCliente(a.clienteId)}>Abrir cliente</button>
              <button type="button" className="mini-link" onClick={() => setResponsavel({ agendamentoId: a.agendamentoId, atual: a.responsavel })}>{a.responsavel ? "Alterar responsável" : "Definir responsável"}</button>
              <button type="button" className="mini-link" onClick={() => setReagendar({ agendamentoId: a.agendamentoId, nome: a.nome, data: a.data, horario: a.horario })}>Reagendar</button>
            </div></td>
          </tr>)}
        </tbody>
      </table></div>
    </div>

    {responsavel && <ResponsavelModal agendamentoId={responsavel.agendamentoId} atual={responsavel.atual} sugestoes={sugestoesResponsavel} onClose={() => setResponsavel(null)} onSalvo={async () => { await carregar(); await onMudou(); }} />}
    {reagendar && <TermsRescheduleModal agendamentoId={reagendar.agendamentoId} nome={reagendar.nome} dataAtual={reagendar.data} horarioAtual={reagendar.horario} hoje={hoje} onClose={() => setReagendar(null)} onDone={async () => { await carregar(); await onMudou(); }} />}
    {confirmarBloqueio != null && <ConfirmModal titulo="Bloquear data" perigo rotuloConfirmar="Bloquear"
      mensagem={`Esta data possui ${confirmarBloqueio} agendamento(s). O bloqueio não apagará os agendamentos existentes. Deseja continuar?`}
      onConfirmar={() => acaoDia("bloquear")} onClose={() => setConfirmarBloqueio(null)} />}
  </div>;
}
