"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, History, PiggyBank } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Input";
import { cn, nomeMes, formatarMoeda, formatarDataLonga } from "@/lib/utils";

const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

interface ClienteNoDia {
  agendamentoId: string;
  clienteId: string | null;
  nome: string;
  valor: number;
  dataTermos: string | null;
}

interface DiaComPrevisao {
  data: string;
  valorTotal: number;
  clientes: ClienteNoDia[];
}

interface SemPrevisao extends ClienteNoDia {
  previsaoSugerida: string | null;
}

interface ClienteAgenda {
  agendamentoId: string;
  clienteId: string | null;
  nome: string;
  dataTermos: string | null;
  previsaoAtual: string | null;
  previsaoSugerida: string | null;
}

interface Resposta {
  meta: number;
  totalPrevistoMes: number;
  diasComPrevisao: DiaComPrevisao[];
  semPrevisao: SemPrevisao[];
  todosClientes: ClienteAgenda[];
}

interface HistoricoItem {
  id: string;
  usuario: string;
  dataAnterior: string | null;
  dataNova: string | null;
  alteradoEm: string;
}

function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PrevisaoLiberacaoFinanceira() {
  const hoje = new Date();
  const isoHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(
    hoje.getDate()
  ).padStart(2, "0")}`;

  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [dataSelecionada, setDataSelecionada] = useState<string | null>(null);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [datasInput, setDatasInput] = useState<Record<string, string>>({});

  const [agendamentoSelecionadoId, setAgendamentoSelecionadoId] = useState("");
  const [dataFormulario, setDataFormulario] = useState("");
  const [salvandoFormulario, setSalvandoFormulario] = useState(false);
  const [historico, setHistorico] = useState<HistoricoItem[]>([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);

  async function carregar() {
    setCarregando(true);
    const res = await fetch(`/api/admin/previsoes-liberacao?ano=${ano}&mes=${mes}`);
    const data = await res.json();
    setDados(res.ok ? data : null);
    setCarregando(false);
  }

  async function carregarHistorico(agendamentoId: string) {
    if (!agendamentoId) {
      setHistorico([]);
      return;
    }
    setCarregandoHistorico(true);
    try {
      const res = await fetch(`/api/admin/agendamentos/${agendamentoId}/previsao`);
      const data = await res.json();
      setHistorico(res.ok ? data.historico ?? [] : []);
    } finally {
      setCarregandoHistorico(false);
    }
  }

  function selecionarClienteFormulario(agendamentoId: string) {
    setAgendamentoSelecionadoId(agendamentoId);
    const cliente = dados?.todosClientes.find((c) => c.agendamentoId === agendamentoId);
    setDataFormulario(cliente?.previsaoAtual ?? cliente?.previsaoSugerida ?? "");
    carregarHistorico(agendamentoId);
  }

  async function salvarFormulario() {
    if (!agendamentoSelecionadoId) {
      toast.error("Selecione uma cliente.");
      return;
    }
    if (!dataFormulario) {
      toast.error("Escolha uma data de previsão.");
      return;
    }
    setSalvandoFormulario(true);
    try {
      const res = await fetch(`/api/admin/agendamentos/${agendamentoSelecionadoId}/previsao`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previsaoLiberacaoFinanceira: dataFormulario }),
      });
      const resultado = await res.json();
      if (!res.ok) {
        toast.error(resultado.erro ?? "Não foi possível salvar a previsão.");
        return;
      }
      const eraAlteracao = Boolean(resultado.dataAnterior);
      const ehPadrao90Dias = resultado.dataNova === resultado.previsaoSugerida;
      toast.success(
        eraAlteracao
          ? `Previsão atualizada de ${formatarDataLonga(resultado.dataAnterior)} para ${formatarDataLonga(
              resultado.dataNova
            )}. A cliente já vê a mudança no app.`
          : ehPadrao90Dias
          ? `Previsão definida para ${formatarDataLonga(resultado.dataNova)} — 90 dias após os termos.`
          : "Previsão de liberação cadastrada. A cliente já pode ver no app."
      );
      await Promise.all([carregar(), carregarHistorico(agendamentoSelecionadoId)]);
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setSalvandoFormulario(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, mes]);

  function mudarMes(delta: number) {
    let novoMes = mes + delta;
    let novoAno = ano;
    if (novoMes > 12) { novoMes = 1; novoAno++; }
    if (novoMes < 1) { novoMes = 12; novoAno--; }
    setMes(novoMes);
    setAno(novoAno);
    setDataSelecionada(null);
  }

  const diasDoMes = useMemo(() => {
    const primeiroDia = new Date(ano, mes - 1, 1);
    const totalDias = new Date(ano, mes, 0).getDate();
    const offset = primeiroDia.getDay();
    const dias: (number | null)[] = Array(offset).fill(null);
    for (let d = 1; d <= totalDias; d++) dias.push(d);
    return dias;
  }, [ano, mes]);

  const previsaoPorDia = useMemo(() => {
    const mapa = new Map<string, DiaComPrevisao>();
    for (const d of dados?.diasComPrevisao ?? []) mapa.set(d.data, d);
    return mapa;
  }, [dados]);

  function isoDoDia(dia: number) {
    return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  }

  async function salvarPrevisao(agendamentoId: string, novaData: string) {
    if (!novaData) {
      toast.error("Escolha uma data de previsão.");
      return;
    }
    setSalvandoId(agendamentoId);
    try {
      const res = await fetch(`/api/admin/agendamentos/${agendamentoId}/previsao`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previsaoLiberacaoFinanceira: novaData }),
      });
      const resultado = await res.json();
      if (!res.ok) {
        toast.error(resultado.erro ?? "Não foi possível salvar a previsão.");
        return;
      }
      toast.success(
        resultado.dataNova === resultado.previsaoSugerida
          ? `Previsão definida para ${formatarDataLonga(resultado.dataNova)} — 90 dias após os termos.`
          : "Previsão de liberação financeira registrada. A cliente já pode ver no app."
      );
      carregar();
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setSalvandoId(null);
    }
  }

  const meta = dados?.meta ?? 100000;
  const totalMes = dados?.totalPrevistoMes ?? 0;
  const ocupacaoMeta = meta > 0 ? Math.min(100, Math.round((totalMes / meta) * 100)) : 0;
  const diaSelecionadoInfo = dataSelecionada ? previsaoPorDia.get(dataSelecionada) : undefined;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ResumoPrevisao label="Previsto no mês" valor={formatarMoeda(totalMes)} />
        <ResumoPrevisao label="Meta mensal" valor={formatarMoeda(meta)} />
        <ResumoPrevisao label="% da meta" valor={`${ocupacaoMeta}%`} />
      </div>

      <Card className="p-6">
        <div className="flex items-center gap-2">
          <CalendarPlus className="h-4 w-4 text-rose" />
          <h2 className="font-heading text-base text-burgundy">Cadastrar ou alterar previsão</h2>
        </div>
        <p className="mt-1 text-xs text-clay/50">
          A sugestão é preenchida automaticamente com <strong>90 dias corridos após a assinatura dos termos</strong>. Você pode alterar a data quando houver uma solicitação excepcional.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1.3fr_0.9fr_auto] sm:items-end">
          <div>
            <Label htmlFor="cliente-previsao" className="mb-1 text-[0.65rem]">
              Cliente
            </Label>
            <Select
              id="cliente-previsao"
              value={agendamentoSelecionadoId}
              onChange={(e) => selecionarClienteFormulario(e.target.value)}
            >
              <option value="">Selecione uma cliente…</option>
              {(dados?.todosClientes ?? []).map((c) => (
                <option key={c.agendamentoId} value={c.agendamentoId}>
                  {c.nome}
                  {c.previsaoAtual
                    ? ` — previsão atual: ${formatarDataLonga(c.previsaoAtual)}`
                    : c.previsaoSugerida
                    ? ` — sugestão: ${formatarDataLonga(c.previsaoSugerida)}`
                    : " — sem data de termos"}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="data-previsao" className="mb-1 text-[0.65rem]">
              Data de previsão
            </Label>
            <Input
              id="data-previsao"
              type="date"
              value={dataFormulario}
              onChange={(e) => setDataFormulario(e.target.value)}
              disabled={!agendamentoSelecionadoId}
            />
            {agendamentoSelecionadoId && (() => {
              const cliente = dados?.todosClientes.find((c) => c.agendamentoId === agendamentoSelecionadoId);
              return cliente?.previsaoSugerida ? (
                <p className="mt-1 text-[0.62rem] text-clay/45">
                  Sugestão automática: {formatarDataLonga(cliente.previsaoSugerida)} (90 dias).
                </p>
              ) : null;
            })()}
          </div>
          <Button
            loading={salvandoFormulario}
            disabled={!agendamentoSelecionadoId}
            onClick={salvarFormulario}
          >
            Salvar
          </Button>
        </div>

        {agendamentoSelecionadoId && (
          <div className="mt-5 border-t border-rose/10 pt-4">
            <div className="flex items-center gap-1.5 text-clay/50">
              <History className="h-3.5 w-3.5" />
              <p className="text-[0.68rem] uppercase tracking-label">Histórico de alterações</p>
            </div>
            {carregandoHistorico ? (
              <p className="mt-2 text-xs text-clay/40">Carregando histórico…</p>
            ) : historico.length === 0 ? (
              <p className="mt-2 text-xs text-clay/40">Nenhuma alteração registrada ainda para essa cliente.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {historico.map((h) => (
                  <li key={h.id} className="text-xs text-clay/55">
                    <span className="font-medium text-burgundy">
                      {h.dataAnterior ? formatarDataLonga(h.dataAnterior) : "Sem data anterior"}
                    </span>
                    {" → "}
                    <span className="font-medium text-burgundy">
                      {h.dataNova ? formatarDataLonga(h.dataNova) : "—"}
                    </span>
                    <span className="text-clay/40"> · {formatarDataHora(h.alteradoEm)} · {h.usuario}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-base text-burgundy">Previsão de liberação financeira</h2>
            <p className="mt-1 text-xs text-clay/50">
              Data combinada com a cliente, no ato da assinatura dos termos, de quando faremos o pagamento da cirurgia dela.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-rose/12 bg-white/90 p-1.5 shadow-card">
            <button onClick={() => mudarMes(-1)} className="flex h-8 w-8 items-center justify-center rounded-full text-burgundy transition-colors hover:bg-blush" aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></button>
            <span className="w-32 text-center text-sm font-medium text-burgundy">{nomeMes(mes)} {ano}</span>
            <button onClick={() => mudarMes(1)} className="flex h-8 w-8 items-center justify-center rounded-full text-burgundy transition-colors hover:bg-blush" aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="mx-auto mt-5 max-w-md">
          <div className="mb-1.5 grid grid-cols-7 gap-2 text-center text-[0.65rem] uppercase tracking-label text-rose">{DIAS_SEMANA.map((d, i) => <span key={i}>{d}</span>)}</div>
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {diasDoMes.map((dia, i) => {
              if (dia === null) return <div key={i} />;
              const iso = isoDoDia(dia);
              const info = previsaoPorDia.get(iso);
              const ehHoje = iso === isoHoje;
              const selecionado = iso === dataSelecionada;
              const temPrevisao = Boolean(info);
              return (
                <button key={i} onClick={() => setDataSelecionada(iso)} className={cn("relative flex aspect-square flex-col items-center justify-center gap-0.5 rounded-xl border text-[0.72rem] transition-all duration-150", temPrevisao ? "border-gold bg-gold/15 font-bold text-burgundy hover:bg-gold/25" : "border-transparent bg-clay/5 text-clay/30 hover:bg-clay/10", ehHoje && "ring-2 ring-gold ring-offset-1", selecionado && "ring-2 ring-burgundy ring-offset-2")}>
                  <span className="text-[0.8rem] leading-none">{dia}</span>
                  {temPrevisao && <span className="text-[0.5rem] leading-none opacity-80">{info!.clientes.length} cli.</span>}
                </button>
              );
            })}
          </div>
          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-[0.7rem] text-clay/55"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-gold" /> Com previsão de pagamento</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full ring-2 ring-gold" /> Hoje</span></div>
        </div>
      </Card>

      {carregando && !dados && <p className="text-xs text-clay/40">Carregando previsões do mês…</p>}

      {dataSelecionada && (
        <Card className="p-6">
          <h2 className="font-heading text-base text-burgundy">{formatarDataLonga(dataSelecionada)}</h2>
          {!diaSelecionadoInfo || diaSelecionadoInfo.clientes.length === 0 ? <p className="mt-2 text-sm text-clay/50">Nenhuma liberação prevista para esse dia.</p> : (
            <div className="mt-4 space-y-2">
              <p className="text-[0.68rem] uppercase tracking-label text-clay/40">Total previsto: {formatarMoeda(diaSelecionadoInfo.valorTotal)}</p>
              {diaSelecionadoInfo.clientes.map((c) => <div key={c.agendamentoId} className="flex items-center justify-between gap-3 rounded-xl bg-blush/40 px-3.5 py-2.5"><span className="truncate text-sm font-medium text-burgundy">{c.nome}</span><span className="shrink-0 text-sm font-semibold text-burgundy">{formatarMoeda(c.valor)}</span></div>)}
            </div>
          )}
        </Card>
      )}

      <Card className="p-6">
        <div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-rose" /><h2 className="font-heading text-base text-burgundy">Assinaturas aguardando previsão</h2></div>
        <p className="mt-1 text-xs text-clay/50">Clientes que já assinaram os termos e aguardam a confirmação da previsão de liberação financeira. O sistema já sugere 90 dias após a assinatura.</p>

        {dados && dados.semPrevisao.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-rose/20 bg-blush/30 px-6 py-8 text-center"><PiggyBank className="h-5 w-5 text-clay/30" /><p className="text-sm text-clay/55">Nenhuma pendência no momento.</p></div>
        ) : (
          <div className="mt-4 space-y-3">
            {(dados?.semPrevisao ?? []).map((c) => (
              <div key={c.agendamentoId} className="grid gap-3 rounded-2xl border border-rose/10 bg-blush/30 p-4 sm:grid-cols-[1.2fr_0.7fr_0.8fr_auto] sm:items-end">
                <div className="min-w-0"><p className="truncate text-sm font-medium text-burgundy">{c.nome}</p><p className="text-xs text-clay/45">Termos: {c.dataTermos ? formatarDataLonga(c.dataTermos) : "—"}</p><p className="mt-1 text-[0.62rem] font-medium text-gold">Sugestão automática: {c.previsaoSugerida ? formatarDataLonga(c.previsaoSugerida) : "indisponível"}</p></div>
                <div><p className="text-xs uppercase tracking-[0.22em] text-clay/40">Contrato</p><p className="mt-1 text-sm text-burgundy">{formatarMoeda(c.valor)}</p></div>
                <div><Label htmlFor={`previsao-${c.agendamentoId}`} className="mb-1 text-[0.65rem]">Previsão de liberação</Label><Input id={`previsao-${c.agendamentoId}`} type="date" value={datasInput[c.agendamentoId] ?? c.previsaoSugerida ?? ""} onChange={(e) => setDatasInput((atual) => ({ ...atual, [c.agendamentoId]: e.target.value }))} /></div>
                <Button size="sm" loading={salvandoId === c.agendamentoId} onClick={() => salvarPrevisao(c.agendamentoId, datasInput[c.agendamentoId] ?? c.previsaoSugerida ?? "")}>Confirmar</Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ResumoPrevisao({ label, valor }: { label: string; valor: string }) {
  return <div className="relative overflow-hidden rounded-[22px] border border-rose/10 bg-white p-4"><div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-gold to-transparent" /><p className="text-[0.68rem] uppercase tracking-label text-clay/45">{label}</p><p className="mt-2 font-heading text-2xl text-burgundy">{valor}</p></div>;
}
