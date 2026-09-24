"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Download,
  Scissors,
  SlidersHorizontal,
  UserRound,
  Users,
} from "lucide-react";
import { formatarMoeda } from "@/lib/utils";
import PrevisoesDetalhes from "./PrevisoesDetalhes";
import styles from "./previsoes.module.css";

interface ClienteForecast {
  clienteId: string;
  nome: string;
  totalParcelas: number;
  parcelasPagas: number;
  parcelasNecessarias: number | null;
  parcelasRestantes: number | null;
  parcelasVencidas: number;
  previsao: string | null;
  situacao: string;
  valorCarta: number | null;
  responsavel: string | null;
  campanha: string | null;
}
interface AgendaCliente {
  clienteId: string;
  dataTermos: string | null;
  termosAssinadosEm: string | null;
  agendaCirurgicaLiberarEm: string | null;
  previsaoAtual: string | null;
  custeioConfirmado: boolean;
}
interface Boleto {
  id: string;
  cliente_id: string;
  valor: number;
  data_vencimento: string | null;
  data_pagamento?: string | null;
  status: string;
  suspensa?: boolean | null;
}
interface Cirurgia {
  id: string;
  clienteId: string;
  nome: string;
  data: string;
  statusCirurgia: string;
  realizada: boolean;
}
interface ClienteBase {
  id: string;
  nome_completo: string;
  procedimento?: string | null;
  consultora?: string | null;
}
type FiltroStatus = "todos" | "risco" | "elegivel" | "agendado" | "liberacao" | "acompanhamento";

const STATUS_LABEL: Record<FiltroStatus, string> = {
  todos: "Todos os status",
  risco: "Em risco",
  elegivel: "Elegível",
  agendado: "Termos agendados",
  liberacao: "Aguardando liberação",
  acompanhamento: "Em acompanhamento",
};

const DIAS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function isoLocal(data = new Date()) {
  const y = data.getFullYear();
  const m = String(data.getMonth() + 1).padStart(2, "0");
  const d = String(data.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}
function adicionarDias(iso: string, dias: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const data = new Date(y, m - 1, d);
  data.setDate(data.getDate() + dias);
  return isoLocal(data);
}
function labelData(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const data = new Date(y, m - 1, d);
  return String(d).padStart(2, "0") + " " + MESES[m - 1];
}
function etapaDe(f: ClienteForecast, ag?: AgendaCliente): Exclude<FiltroStatus, "todos"> {
  if (f.situacao === "em_risco" || f.parcelasVencidas > 0) return "risco";
  if (ag?.agendaCirurgicaLiberarEm || ag?.previsaoAtual) return "liberacao";
  if (ag?.dataTermos) return "agendado";
  if (f.situacao === "elegivel") return "elegivel";
  return "acompanhamento";
}
function dinheiroCurto(valor: number) {
  if (Math.abs(valor) >= 1_000_000) return "R$ " + (valor / 1_000_000).toFixed(1).replace(".", ",") + " mi";
  if (Math.abs(valor) >= 1_000) return "R$ " + Math.round(valor / 1_000).toLocaleString("pt-BR") + " mil";
  return formatarMoeda(valor);
}
function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || "—";
}

export default function PrevisoesPage() {
  const [detalhes, setDetalhes] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [forecast, setForecast] = useState<ClienteForecast[]>([]);
  const [agenda, setAgenda] = useState<AgendaCliente[]>([]);
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [cirurgias, setCirurgias] = useState<Cirurgia[]>([]);
  const [clientes, setClientes] = useState<ClienteBase[]>([]);
  const [periodo, setPeriodo] = useState(30);
  const [responsavel, setResponsavel] = useState("todos");
  const [procedimento, setProcedimento] = useState("todos");
  const [status, setStatus] = useState<FiltroStatus>("todos");
  const chartRef = useRef<HTMLElement | null>(null);
  const attentionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let ativo = true;
    Promise.all([
      fetch("/api/admin/previsao-liberacoes", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/clientes-agendamentos", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/boletos", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/cirurgias-confirmadas", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/clientes", { cache: "no-store" }).then((r) => r.json()),
    ]).then(([f, a, b, c, cl]) => {
      if (!ativo) return;
      setForecast(f.clientes ?? []);
      setAgenda(a.clientes ?? []);
      setBoletos(b.boletos ?? []);
      setCirurgias(c.cirurgias ?? []);
      setClientes(cl.clientes ?? []);
    }).finally(() => ativo && setCarregando(false));
    return () => { ativo = false; };
  }, []);

  const agendaPorCliente = useMemo(() => new Map(agenda.map((a) => [a.clienteId, a])), [agenda]);
  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);
  const forecastPorId = useMemo(() => new Map(forecast.map((f) => [f.clienteId, f])), [forecast]);
  const responsaveis = useMemo(() => Array.from(new Set([
    ...forecast.map((f) => f.responsavel),
    ...clientes.map((c) => c.consultora),
  ].filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "pt-BR")), [forecast, clientes]);
  const procedimentos = useMemo(() => Array.from(new Set(clientes.map((c) => c.procedimento).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "pt-BR")), [clientes]);

  const clientePermitido = useMemo(() => {
    const ids = new Set<string>();
    for (const c of clientes) {
      const f = forecastPorId.get(c.id);
      const responsavelEfetivo = f?.responsavel ?? c.consultora ?? "";
      if (responsavel !== "todos" && responsavelEfetivo !== responsavel) continue;
      if (procedimento !== "todos" && (c.procedimento ?? "") !== procedimento) continue;
      if (status !== "todos") {
        if (!f || etapaDe(f, agendaPorCliente.get(c.id)) !== status) continue;
      }
      ids.add(c.id);
    }
    if (clientes.length === 0) {
      for (const f of forecast) {
        if (responsavel !== "todos" && (f.responsavel ?? "") !== responsavel) continue;
        if (status !== "todos" && etapaDe(f, agendaPorCliente.get(f.clienteId)) !== status) continue;
        ids.add(f.clienteId);
      }
    }
    return ids;
  }, [clientes, responsavel, procedimento, status, forecast, forecastPorId, agendaPorCliente]);

  const hoje = isoLocal();
  const fim = adicionarDias(hoje, periodo - 1);
  const fimComparacao = adicionarDias(fim, periodo);

  const boletosFiltrados = useMemo(() => boletos.filter((b) => clientePermitido.has(b.cliente_id)), [boletos, clientePermitido]);
  const forecastFiltrado = useMemo(() => forecast.filter((f) => clientePermitido.has(f.clienteId)), [forecast, clientePermitido]);
  const cirurgiasFiltradas = useMemo(() => cirurgias.filter((c) => clientePermitido.has(c.clienteId)), [cirurgias, clientePermitido]);

  const recebimentos = boletosFiltrados.filter((b) => b.status !== "pago" && !b.suspensa && b.data_vencimento && b.data_vencimento >= hoje && b.data_vencimento <= fim);
  const recebimentosValor = recebimentos.reduce((s, b) => s + Number(b.valor || 0), 0);
  const liberacoes = forecastFiltrado.filter((f) => f.previsao && f.previsao.slice(0, 10) >= hoje && f.previsao.slice(0, 10) <= fim);
  const cirurgiasPeriodo = cirurgiasFiltradas.filter((c) => !c.realizada && c.data >= hoje && c.data <= fim);
  const vencidos = boletosFiltrados.filter((b) => b.status !== "pago" && !b.suspensa && b.data_vencimento && b.data_vencimento < hoje);
  const riscoValor = vencidos.reduce((s, b) => s + Number(b.valor || 0), 0);

  const kpis = [
    { label: "Recebimentos previstos", value: formatarMoeda(recebimentosValor), note: recebimentos.length + " parcelas no período", icon: <CircleDollarSign size={21} /> },
    { label: "Liberações previstas", value: liberacoes.length.toLocaleString("pt-BR"), note: "clientes com previsão no período", icon: <CalendarDays size={21} /> },
    { label: "Cirurgias previstas", value: cirurgiasPeriodo.length.toLocaleString("pt-BR"), note: "datas cirúrgicas já escolhidas", icon: <Scissors size={21} /> },
    { label: "Risco de inadimplência", value: formatarMoeda(riscoValor), note: vencidos.length + " parcelas vencidas na carteira", icon: <AlertTriangle size={21} /> },
  ];

  const buckets = useMemo(() => {
    const tamanho = periodo <= 30 ? 2 : periodo <= 60 ? 4 : 6;
    const lista: Array<{ inicio: string; fim: string; label: string; recebimentos: number; cirurgias: number; liberacoes: number }> = [];
    for (let i = 0; i < periodo; i += tamanho) {
      const ini = adicionarDias(hoje, i);
      const end = adicionarDias(hoje, Math.min(periodo - 1, i + tamanho - 1));
      lista.push({
        inicio: ini,
        fim: end,
        label: labelData(ini),
        recebimentos: boletosFiltrados.filter((b) => b.status !== "pago" && !b.suspensa && b.data_vencimento && b.data_vencimento >= ini && b.data_vencimento <= end).reduce((s, b) => s + Number(b.valor || 0), 0),
        cirurgias: cirurgiasFiltradas.filter((c) => !c.realizada && c.data >= ini && c.data <= end).length,
        liberacoes: forecastFiltrado.filter((f) => f.previsao && f.previsao.slice(0, 10) >= ini && f.previsao.slice(0, 10) <= end).length,
      });
    }
    return lista;
  }, [periodo, hoje, boletosFiltrados, cirurgiasFiltradas, forecastFiltrado]);

  const maxReceita = Math.max(1, ...buckets.map((b) => b.recebimentos));
  const maxContagem = Math.max(1, ...buckets.flatMap((b) => [b.cirurgias, b.liberacoes]));
  const chartWidth = 1000;
  const chartHeight = 220;
  const chartTop = 14;
  const chartBottom = 200;
  const chartUsable = chartBottom - chartTop;
  const step = buckets.length ? 920 / buckets.length : 1;
  const barWidth = Math.min(38, Math.max(9, step * .5));
  const linha = (key: "cirurgias" | "liberacoes") => buckets.map((b, i) => {
    const x = 50 + step * i + step / 2;
    const y = chartBottom - (b[key] / maxContagem) * chartUsable;
    return x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");

  const etapas = useMemo(() => {
    const counts = {
      acompanhamento: 0,
      elegivel: 0,
      agendado: 0,
      liberacao: 0,
      risco: 0,
    };
    for (const f of forecastFiltrado) counts[etapaDe(f, agendaPorCliente.get(f.clienteId))]++;
    const max = Math.max(1, ...Object.values(counts));
    return [
      ["Em acompanhamento", counts.acompanhamento],
      ["Elegíveis", counts.elegivel],
      ["Termos agendados", counts.agendado],
      ["Aguardando liberação", counts.liberacao],
      ["Em risco", counts.risco],
    ].map(([label, count], i) => ({ label: String(label), count: Number(count), pct: Math.round(Number(count) / max * 100), tone: i }));
  }, [forecastFiltrado, agendaPorCliente]);

  const atencao = useMemo(() => {
    const porCliente = new Map<string, { total: number; qtd: number }>();
    for (const b of vencidos) {
      const atual = porCliente.get(b.cliente_id) ?? { total: 0, qtd: 0 };
      atual.total += Number(b.valor || 0);
      atual.qtd++;
      porCliente.set(b.cliente_id, atual);
    }
    return [...porCliente.entries()].map(([id, r]) => ({
      id,
      nome: clientePorId.get(id)?.nome_completo ?? forecastPorId.get(id)?.nome ?? "Cliente",
      procedimento: clientePorId.get(id)?.procedimento ?? "Procedimento não informado",
      valor: r.total,
      qtd: r.qtd,
    })).sort((a, b) => b.qtd - a.qtd || b.valor - a.valor).slice(0, 5);
  }, [vencidos, clientePorId, forecastPorId]);

  const semana = useMemo(() => {
    const datas: string[] = [];
    let deslocamento = 0;
    while (datas.length < 5 && deslocamento < 10) {
      const iso = adicionarDias(hoje, deslocamento++);
      const [y, m, d] = iso.split("-").map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      if (dow !== 0 && dow !== 6) datas.push(iso);
    }
    return datas.map((data) => {
      const cir = cirurgiasFiltradas.filter((c) => !c.realizada && c.data === data).length;
      const lib = forecastFiltrado.filter((f) => f.previsao?.slice(0, 10) === data).length;
      const rec = boletosFiltrados.filter((b) => b.status !== "pago" && !b.suspensa && b.data_vencimento === data).reduce((s, b) => s + Number(b.valor || 0), 0);
      const [y, m, d] = data.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      return { data, dow: DIAS[date.getDay()], dia: d, cir, lib, rec };
    });
  }, [hoje, cirurgiasFiltradas, forecastFiltrado, boletosFiltrados]);

  const proximoPeriodo = useMemo(() => {
    const ini = adicionarDias(fim, 1);
    return {
      inicio: ini,
      fim: fimComparacao,
      recebimentos: boletosFiltrados.filter((b) => b.status !== "pago" && !b.suspensa && b.data_vencimento && b.data_vencimento >= ini && b.data_vencimento <= fimComparacao).reduce((s, b) => s + Number(b.valor || 0), 0),
      liberacoes: forecastFiltrado.filter((f) => f.previsao && f.previsao.slice(0, 10) >= ini && f.previsao.slice(0, 10) <= fimComparacao).length,
      cirurgias: cirurgiasFiltradas.filter((c) => !c.realizada && c.data >= ini && c.data <= fimComparacao).length,
    };
  }, [fim, fimComparacao, boletosFiltrados, forecastFiltrado, cirurgiasFiltradas]);

  function exportarCsv() {
    const linhas = [
      ["Período", "Recebimentos previstos", "Cirurgias previstas", "Liberações previstas"],
      ...buckets.map((b) => [b.inicio + " a " + b.fim, String(b.recebimentos), String(b.cirurgias), String(b.liberacoes)]),
    ];
    const csv = "\uFEFF" + linhas.map((l) => l.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "previsoes-sra-luck-" + hoje + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (detalhes) {
    return <div className="zip-admin">
      <button type="button" className={styles.backButton} onClick={() => setDetalhes(false)}>← Voltar ao painel de previsões</button>
      <PrevisoesDetalhes allowedClientIds={Array.from(clientePermitido)} />
    </div>;
  }

  return <div className={["zip-admin", styles.page].join(" ")}>
    <header className={styles.hero}>
      <div><div className={styles.eyebrow}>PREVISÕES</div><h1>Previsões</h1><p>Acompanhe as projeções operacionais e financeiras dos próximos dias.</p></div>
      <div className={styles.quote}>Disciplina hoje,<br />mais histórias amanhã.<span /></div>
    </header>

    <section className={styles.filters}>
      <label><span>Período</span><div className={styles.selectBox}><CalendarDays size={17} /><select value={periodo} onChange={(e) => setPeriodo(Number(e.target.value))}><option value={30}>Próximos 30 dias</option><option value={60}>Próximos 60 dias</option><option value={90}>Próximos 90 dias</option></select><ChevronDown size={14} /></div></label>
      <label><span>Responsável</span><div className={styles.selectBox}><UserRound size={17} /><select value={responsavel} onChange={(e) => setResponsavel(e.target.value)}><option value="todos">Todos os responsáveis</option>{responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}</select><ChevronDown size={14} /></div></label>
      <label><span>Procedimento</span><div className={styles.selectBox}><SlidersHorizontal size={17} /><select value={procedimento} onChange={(e) => setProcedimento(e.target.value)}><option value="todos">Todos os procedimentos</option>{procedimentos.map((p) => <option key={p} value={p}>{p}</option>)}</select><ChevronDown size={14} /></div></label>
      <label><span>Status</span><div className={styles.selectBox}><AlertTriangle size={17} /><select value={status} onChange={(e) => setStatus(e.target.value as FiltroStatus)}>{(Object.keys(STATUS_LABEL) as FiltroStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select><ChevronDown size={14} /></div></label>
    </section>

    {carregando ? <div className={styles.loading}>Calculando previsões reais da carteira…</div> : <>
      <section className={styles.kpis}>
        {kpis.map((k, index) => <article key={k.label} className={styles.kpi}>
          <div className={styles.kpiTop}><span className={styles.kpiIcon}>{k.icon}</span><span>{k.label}</span></div>
          <strong>{k.value}</strong>
          <div className={index === 3 ? styles.kpiNoteRisk : styles.kpiNote}>{k.note}</div>
        </article>)}
      </section>

      <section className={styles.middleGrid}>
        <article className={styles.panel} ref={chartRef}>
          <div className={styles.panelHead}><h2>Projeção dos próximos {periodo} dias</h2><button type="button" onClick={() => setDetalhes(true)}>Ver detalhe <ArrowRight size={13} /></button></div>
          <div className={styles.legend}><span><i className={styles.dotReceita} />Recebimentos (R$)</span><span><i className={styles.dotCirurgia} />Cirurgias previstas</span><span><i className={styles.dotLiberacao} />Liberações previstas</span></div>
          <div className={styles.chart}>
            <svg viewBox={"0 0 " + chartWidth + " " + chartHeight} role="img" aria-label="Projeção de recebimentos, cirurgias e liberações">
              {[0, .25, .5, .75, 1].map((p) => <line key={p} x1="48" x2="970" y1={chartBottom - chartUsable * p} y2={chartBottom - chartUsable * p} className={styles.gridLine} />)}
              {buckets.map((b, i) => {
                const x = 50 + step * i + step / 2 - barWidth / 2;
                const h = Math.max(2, b.recebimentos / maxReceita * chartUsable);
                return <rect key={b.inicio} x={x} y={chartBottom - h} width={barWidth} height={h} rx="3" className={styles.bar} />;
              })}
              <polyline points={linha("cirurgias")} className={styles.lineCirurgia} />
              <polyline points={linha("liberacoes")} className={styles.lineLiberacao} />
              {buckets.map((b, i) => {
                const x = 50 + step * i + step / 2;
                return <g key={"points-" + b.inicio}>
                  <circle cx={x} cy={chartBottom - b.cirurgias / maxContagem * chartUsable} r="3" className={styles.pointCirurgia} />
                  <circle cx={x} cy={chartBottom - b.liberacoes / maxContagem * chartUsable} r="3" className={styles.pointLiberacao} />
                </g>;
              })}
              <text x="3" y="24" className={styles.axisText}>{dinheiroCurto(maxReceita)}</text>
              <text x="3" y="202" className={styles.axisText}>R$ 0</text>
              <text x="975" y="24" textAnchor="end" className={styles.axisText}>{maxContagem}</text>
              <text x="975" y="202" textAnchor="end" className={styles.axisText}>0</text>
            </svg>
            <div className={styles.chartLabels}>{buckets.map((b, i) => (i % Math.max(1, Math.ceil(buckets.length / 7)) === 0 || i === buckets.length - 1) ? <span key={b.inicio}>{b.label}</span> : <span key={b.inicio} />)}</div>
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}><h2>Previsões por etapa</h2><button type="button" onClick={() => setDetalhes(true)}>Ver detalhe <ArrowRight size={13} /></button></div>
          <div className={styles.stages}>
            {etapas.map((e) => <div className={styles.stageRow} key={e.label}><span>{e.label}</span><div className={styles.stageTrack}><i style={{ width: e.pct + "%" }} data-tone={e.tone} /></div><strong>{e.count}</strong><em>{forecastFiltrado.length ? Math.round(e.count / forecastFiltrado.length * 100) : 0}%</em></div>)}
          </div>
        </article>
      </section>

      <section className={styles.bottomGrid}>
        <article className={styles.panel} ref={attentionRef} id="clientes-atencao">
          <div className={styles.panelHead}><h2>Clientes com atenção</h2><button type="button" onClick={() => { setStatus("risco"); setDetalhes(true); }}>Ver todas <ArrowRight size={13} /></button></div>
          <div className={styles.attentionList}>
            {atencao.length === 0 ? <div className={styles.empty}>Nenhuma cliente com parcela vencida nos filtros atuais.</div> : atencao.map((c) => <div className={styles.attentionRow} key={c.id}>
              <span className={c.qtd >= 2 ? styles.riskHigh : styles.riskMedium}><AlertTriangle size={14} /></span>
              <div><strong>{c.nome}</strong><small>{c.procedimento}</small></div>
              <div className={styles.attentionValue}><strong>{formatarMoeda(c.valor)}</strong><small>{c.qtd} {c.qtd === 1 ? "parcela vencida" : "parcelas vencidas"}</small></div>
              <span className={c.qtd >= 2 ? styles.badgeHigh : styles.badgeMedium}>{c.qtd >= 2 ? "Alto risco" : "Médio risco"}</span>
            </div>)}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}><h2>Agenda prevista da semana</h2><a href="/admin/agenda">Ver agenda <ArrowRight size={13} /></a></div>
          <div className={styles.weekList}>
            {semana.map((d) => <div className={styles.weekRow} key={d.data}>
              <span className={styles.dateBox}><small>{d.dow}</small><strong>{d.dia}</strong></span>
              <div><strong>{d.cir} {d.cir === 1 ? "cirurgia prevista" : "cirurgias previstas"}</strong><small>{d.lib} liberações · {formatarMoeda(d.rec)}</small></div>
              <ArrowRight size={14} />
            </div>)}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}><h2>Ações rápidas</h2></div>
          <div className={styles.actions}>
            <button type="button" className={styles.actionPrimary} onClick={() => { setPeriodo(90); chartRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }}><CalendarDays size={20} /><span>Projeção 90 dias</span><ArrowRight size={14} /></button>
            <button type="button" onClick={() => attentionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}><Users size={20} /><span>Ver inadimplência</span><ArrowRight size={14} /></button>
            <button type="button" onClick={exportarCsv}><Download size={20} /><span>Exportar previsão</span><ArrowRight size={14} /></button>
            <button type="button" onClick={() => setPeriodo((p) => p === 30 ? 60 : 30)}><BarChart3 size={20} /><span>Alternar período</span><ArrowRight size={14} /></button>
          </div>
          <div className={styles.compareHint}>Próximo período: {dinheiroCurto(proximoPeriodo.recebimentos)} · {proximoPeriodo.cirurgias} cirurgias · {proximoPeriodo.liberacoes} liberações</div>
        </article>
      </section>

      <footer className={styles.footer}><span>♡</span> Cada paciente representa um sonho. Obrigada por fazer parte dessa jornada!<i />Sra. Luck Cirurgias Programadas</footer>
    </>}
  </div>;
}
