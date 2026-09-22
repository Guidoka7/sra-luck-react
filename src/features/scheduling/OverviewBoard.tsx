import { useMemo, useState, type KeyboardEvent } from "react";
import { dataBr, moeda } from "./api";
import type { CartaoCliente, EstagioCentral, VisaoGeralResponse } from "./types";
import { ChosenDate, faltamTexto, rotuloLevantamento, rotuloLiberacao } from "./v46Cards";

type Ordem = "upcoming" | "nameAsc" | "nameDesc";

const COLUNAS: { id: EstagioCentral; titulo: string; desc: string }[] = [
  { id: "preEligibility", titulo: "Elegibilidade e solicitação", desc: "Acompanhe quem está próxima do percentual e quem já pode solicitar a liberação financeira pelo app." },
  { id: "financialReview", titulo: "Levantamentos", desc: "Já atingiram o percentual mínimo e estão prontas para análise financeira." },
  { id: "termsConfirmed", titulo: "Agendamentos confirmados", desc: "Próximos atendimentos para assinatura dos termos, ordenados pela data mais próxima." },
  { id: "financialRelease", titulo: "Liberações financeiras", desc: "No dia dos termos: conferir presença + quitação. Depois, acompanhar os 5 dias úteis até liberar a Agenda Cirúrgica." },
  { id: "surgeryConfirmed", titulo: "Cirurgias confirmadas", desc: "Aguardando confirmação do pagamento da cirurgia. Após a confirmação, o processo sai desta lista e fica arquivado na Agenda Cirúrgica." },
];

/**
 * Visão geral V46: 5 filas com identidade própria (`stage-column stage-*`),
 * cards específicos por etapa e filtro "Faltam" na Etapa 1. Dados reais de
 * `/api/admin/central/visao-geral`; nenhuma fila é calculada no navegador —
 * aqui só há filtro/ordenação de exibição.
 */
export function OverviewBoard({ dados, selecionadoId, onAbrirCliente }: {
  dados: VisaoGeralResponse;
  selecionadoId: string | null;
  onAbrirCliente: (clienteId: string, estagio: EstagioCentral) => void;
}) {
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("upcoming");
  const [faltam, setFaltam] = useState(1);

  const contagemFaltam = useMemo(() => {
    const c: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const x of dados.filas.preEligibility) if (c[x.parcelasFaltantes] !== undefined) c[x.parcelasFaltantes]++;
    return c;
  }, [dados]);

  const filas = useMemo(() => {
    const q = busca.trim().toLocaleLowerCase("pt-BR");
    const filtra = (l: CartaoCliente[]) => !q ? l : l.filter((c) => `${c.nome} ${c.cpf ?? ""} ${c.procedimento ?? ""}`.toLocaleLowerCase("pt-BR").includes(q));
    const ordena = (id: EstagioCentral, l: CartaoCliente[]) => {
      const lista = [...l];
      if (id !== "termsConfirmed" && id !== "surgeryConfirmed") {
        if (ordem === "nameAsc") lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        if (ordem === "nameDesc") lista.sort((a, b) => b.nome.localeCompare(a.nome, "pt-BR"));
      }
      return lista;
    };
    const out = {} as Record<EstagioCentral, CartaoCliente[]>;
    for (const col of COLUNAS) {
      let lista = dados.filas[col.id];
      if (col.id === "preEligibility") lista = lista.filter((c) => c.parcelasFaltantes === faltam);
      out[col.id] = filtra(ordena(col.id, lista));
    }
    return out;
  }, [dados, busca, ordem, faltam]);

  return <>
    <div className="filters">
      <div className="search-field"><span aria-hidden="true">⌕</span><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou CPF..." aria-label="Buscar por nome ou CPF" /></div>
      <label className="push">Ordenar por: <select className="select" value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)}>
        <option value="upcoming">Próximas</option><option value="nameAsc">Nome A-Z</option><option value="nameDesc">Nome Z-A</option>
      </select></label>
    </div>

    <div className="board-wrap"><div className="board">
      {COLUNAS.map((col) => {
        const lista = filas[col.id];
        return <section key={col.id} className={`stage-column stage-${col.id}`} aria-label={col.titulo}>
          <div className="stage-head">
            <div className="stage-title">{col.titulo}</div>
            <span className="stage-count" title={`${lista.length} cliente(s) neste filtro`}>
              <span className="stage-count-number">{lista.length}</span>
              <span className="stage-count-label">{lista.length === 1 ? "cliente" : "clientes"}</span>
            </span>
          </div>
          <div className="stage-desc">{col.desc}</div>
          {col.id === "preEligibility" && <div className="missing-filter">
            <span className="missing-filter-label">Faltam</span>
            <select className="missing-filter-select" value={faltam} onChange={(e) => setFaltam(Number(e.target.value))} aria-label="Filtrar por parcelas restantes">
              <option value={0}>Aguardando solicitação · {contagemFaltam[0]} {contagemFaltam[0] === 1 ? "cliente" : "clientes"}</option>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{faltamTexto(n)} · {contagemFaltam[n]} {contagemFaltam[n] === 1 ? "cliente" : "clientes"}</option>)}
            </select>
          </div>}
          {col.id === "financialRelease" && <div className="release-state-legend"><span>Comparecimento</span><span>Quitação</span><span>5 dias úteis</span><span>Agenda liberada</span></div>}
          <div className="client-stack">
            {lista.length === 0
              ? <div className="empty-card">Nenhuma cliente neste filtro.</div>
              : lista.map((c, i) => <ClientCard key={c.id} c={c} estagio={col.id} indice={i} hoje={dados.hoje} selecionado={selecionadoId === c.id} onAbrir={() => onAbrirCliente(c.id, col.id)} />)}
          </div>
        </section>;
      })}
    </div></div>
  </>;
}

function ClientCard({ c, estagio, indice, hoje, selecionado, onAbrir }: { c: CartaoCliente; estagio: EstagioCentral; indice: number; hoje: string; selecionado: boolean; onAbrir: () => void }) {
  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(); }
  }
  return <article className={`client-card${selecionado ? " selected" : ""}`} tabIndex={0} role="button" aria-label={`Abrir ${c.nome}`} onClick={onAbrir} onKeyDown={onKey}>
    <div className="card-top">
      <div className="client-identification"><div className="client-name">{c.nome}</div><div className="client-procedure">{c.procedimento || "—"}</div></div>
      <span className="more" aria-hidden="true">⋮</span>
    </div>
    <CardMeta c={c} estagio={estagio} indice={indice} hoje={hoje} />
  </article>;
}

function CardMeta({ c, estagio, indice, hoje }: { c: CartaoCliente; estagio: EstagioCentral; indice: number; hoje: string }) {
  if (estagio === "preEligibility") {
    const pct = Math.min(100, Math.round((c.parcelasPagas / Math.max(1, c.parcelasNecessarias)) * 100));
    if (c.parcelasFaltantes === 0) {
      return <div className="card-meta"><div><b>{c.parcelasPagas} de {c.totalParcelas} parcelas</b></div><div className="progress"><span style={{ width: "100%" }} /></div><span className="badge success">Elegível · aguardando solicitação no app</span></div>;
    }
    return <div className="card-meta">
      <div><b>{c.parcelasPagas} de {c.totalParcelas} parcelas</b></div>
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso para a elegibilidade"><span style={{ width: `${pct}%` }} /></div>
      {c.proximaParcelaEm && <div className="meta-row">▣ Próxima parcela: {dataBr(c.proximaParcelaEm)}</div>}
      <span className="badge danger">{faltamTexto(c.parcelasFaltantes)}</span>
    </div>;
  }
  if (estagio === "financialReview") {
    const r = rotuloLevantamento(c);
    return <div className="card-meta"><div className="meta-row">✓ {c.parcelasPagas}/{c.totalParcelas} pagas · mínimo {c.parcelasNecessarias}</div><span className={`badge ${r.tom}`}>{r.texto}</span></div>;
  }
  if (estagio === "termsConfirmed") {
    return <div className="card-meta">
      {indice === 0 && <span className="badge info">● Mais próximo</span>}
      <ChosenDate iso={c.dataTermos} horario={c.horarioTermos} rotulo="Assinatura dos termos" />
      <span className="badge success">Termos confirmados</span>
    </div>;
  }
  if (estagio === "financialRelease") {
    const r = rotuloLiberacao(c, hoje);
    return <div className="card-meta">
      <div className="meta-row">▣ Termos: {dataBr(c.dataTermos)} {c.horarioTermos ?? ""}</div>
      <span className={`badge ${r.tom}`}>{r.texto}</span>
      <div className="release-mini-progress" aria-hidden="true">
        <i className={r.passo >= 1 ? "done" : r.passo === 0 ? "current" : ""} />
        <i className={c.quitacaoStatus === "paga" ? "done" : c.comparecimentoStatus === "compareceu" ? "current" : ""} />
        <i className={r.passo >= 4 ? "done" : r.passo === 3 ? "current" : ""} />
        <i className={r.passo >= 4 ? "done" : ""} />
      </div>
    </div>;
  }
  return <div className="card-meta">
    <ChosenDate iso={c.dataCirurgia} horario={c.horarioCirurgia} rotulo="Data da cirurgia" />
    <div className="meta-row">◇ Carta de crédito: <b>{moeda(c.cartaDeCredito)}</b></div>
    <div className="meta-row">▤ {c.totalParcelas} parcelas · {c.parcelasPagas} pagas</div>
    {c.pagamentoCirurgiaConfirmadoEm ? <span className="status-completed">✓ Processo concluído</span> : <span className="badge success">Cirurgia confirmada</span>}
  </div>;
}
