import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { centralApi, dataBr, diaSemana, somarMeses } from "./api";
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
export function TermsAgendaTab({ hoje, data, onData, sugestoesResponsavel, recarregarKey, onAbrirCliente, onMudou, acaoDoCliente }: {
  hoje: string; data: string; onData: (iso: string) => void; sugestoesResponsavel: string[]; recarregarKey: number;
  onAbrirCliente: (clienteId: string) => void; onMudou: () => void | Promise<void>;
  /** Preparar (antes do dia) ou registrar o atendimento (no dia), conforme a etapa real da cliente. */
  acaoDoCliente?: (clienteId: string) => { rotulo: string; executar: () => void } | null;
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
      toast.success(msg ?? (acao === "liberar" ? "Data aberta: já aparece para as clientes no app." : "Data fechada: não aparece mais para novas escolhas no app."));
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

  const semResponsavel = futuras.filter((a) => !a.responsavel).length;
  const porDia = new Map<string, typeof futuras>();
  for (const a of futuras) porDia.set(a.data, [...(porDia.get(a.data) ?? []), a]);
  const acoes = (a: (typeof futuras)[number]) => {
    const principal = acaoDoCliente?.(a.clienteId) ?? null;
    return <>
    {principal && <button type="button" className="ag-btn is-primario is-pequeno" onClick={principal.executar}>{principal.rotulo}</button>}
    <button type="button" className="ag-link" onClick={() => setResponsavel({ agendamentoId: a.agendamentoId, atual: a.responsavel })} aria-label={`${a.responsavel ? "Alterar" : "Definir"} responsável de ${a.nome}`}>{a.responsavel ? "Responsável" : "Definir responsável"}</button>
    {a.data >= hoje && <button type="button" className="ag-link" onClick={() => setReagendar({ agendamentoId: a.agendamentoId, nome: a.nome, data: a.data, horario: a.horario })} aria-label={`Reagendar assinatura de termos de ${a.nome}`}>Reagendar</button>}
  </>;
  };

  return <div className="ag-agenda terms-agenda">
    <div className="ag-resumo" aria-label="Resumo da Agenda de Termos">
      <div className="ag-resumo-item"><span>Assinaturas no mês</span><b>{doMes.length}</b></div>
      <div className="ag-resumo-item"><span>Datas abertas no app</span><b>{abertas}</b><small>{bloqueadas} fechadas</small></div>
      <div className="ag-resumo-item"><span>Ocupação das datas abertas</span><b>{ocupacao}%</b><small>{usadas} de {cap} vagas</small></div>
      <div className={`ag-resumo-item${semResponsavel ? " is-alerta" : ""}`}><span>Sem responsável</span><b>{semResponsavel}</b><small>próximas assinaturas</small></div>
    </div>
    <p className="ag-regra">A cliente só escolhe a data dos termos depois do levantamento concluído, e apenas entre as datas abertas com vagas livres.</p>

    <div className="ag-workspace">
      <div className="ag-panel ag-cal-panel">
        <AgendaCalendar selecionado={data} hoje={hoje} calendario={calendario} onSelecionar={onData} onMudarMes={(d) => onData(somarMeses(data, d))} />
      </div>
      <DayPanel tipo="terms" data={data} hoje={hoje} dia={dia} ocupado={ocupado || !calendario}
        onAbrir={() => void acaoDia("liberar", capacidadeAoLiberar(dia))}
        onBloquear={() => { const n = statusDoDia(dia).usadas; if (n > 0) setConfirmarBloqueio(n); else void acaoDia("bloquear"); }}
        onCapacidade={(n) => void acaoDia("liberar", n, "Vagas atualizadas.")}
        itens={doDia.map((a) => <AppointmentRow key={a.agendamentoId} tipo="terms" horario={a.horario} nome={a.nome}
          detalhe={`${a.procedimento ?? "Procedimento não informado"} · ${a.responsavel ? `com ${a.responsavel}` : "sem responsável"}`}
          badge={<span className="ag-situacao is-success">Confirmada</span>} onAbrir={() => onAbrirCliente(a.clienteId)}
          acoes={acoes(a)} />)} />
    </div>

    <section className="ag-panel ag-proximas" aria-labelledby="ag-proximas-titulo">
      <header className="ag-panel-head">
        <div><h2 id="ag-proximas-titulo" className="ag-h2">Próximas assinaturas</h2><p>Em ordem de atendimento. Toque na cliente para abrir o processo.</p></div>
      </header>
      {!dados && <div className="ag-vazio"><span>Carregando…</span></div>}
      {dados && futuras.length === 0 && <div className="ag-vazio"><strong>Nenhuma assinatura futura</strong><span>As datas escolhidas pelas clientes aparecem aqui.</span></div>}
      {[...porDia.entries()].map(([iso, lista]) => <div key={iso} className="ag-grupo-dia">
        <h3 className="ag-grupo-titulo"><button type="button" className="ag-link" onClick={() => onData(iso)}>{diaSemana(iso)}, {dataBr(iso)}</button><span>{lista.length} {lista.length === 1 ? "assinatura" : "assinaturas"}</span></h3>
        <div className="ag-compromissos">
          {lista.map((a) => <AppointmentRow key={a.agendamentoId} tipo="terms" horario={a.horario} nome={a.nome}
            detalhe={`${a.procedimento ?? "Procedimento não informado"}${a.cpf ? ` · CPF ${a.cpf}` : ""}`}
            badge={a.responsavel ? <span className="ag-pessoa">{a.responsavel}</span> : <span className="ag-situacao is-wait">Sem responsável</span>}
            onAbrir={() => onAbrirCliente(a.clienteId)} acoes={acoes(a)} />)}
        </div>
      </div>)}
    </section>

    {responsavel && <ResponsavelModal agendamentoId={responsavel.agendamentoId} atual={responsavel.atual} sugestoes={sugestoesResponsavel} onClose={() => setResponsavel(null)} onSalvo={async () => { await carregar(); await onMudou(); }} />}
    {reagendar && <TermsRescheduleModal agendamentoId={reagendar.agendamentoId} nome={reagendar.nome} dataAtual={reagendar.data} horarioAtual={reagendar.horario} hoje={hoje} onClose={() => setReagendar(null)} onDone={async () => { await carregar(); await onMudou(); }} />}
    {confirmarBloqueio != null && <ConfirmModal titulo="Fechar data" perigo rotuloConfirmar="Fechar data"
      mensagem={`Esta data possui ${confirmarBloqueio} agendamento(s). Fechar a data só impede novas escolhas no app: os agendamentos existentes continuam valendo. Deseja continuar?`}
      onConfirmar={() => acaoDia("bloquear")} onClose={() => setConfirmarBloqueio(null)} />}
  </div>;
}
