import { useMemo, useState } from "react";
import { ArrowRight, ChevronRight, Info, Search } from "lucide-react";
import { iniciais } from "./api";
import { ETAPAS, ETAPA_POR_ID, ROTULO_RESPONSAVEL, contarAcaoEquipe, faseLiberacao, situacao } from "./jornada";
import { estadoLiberacao } from "./v46Cards";
import type { CartaoCliente, EstagioCentral, VisaoGeralResponse } from "./types";

type Ordem = "urgencia" | "nomeAsc" | "nomeDesc";

/**
 * Jornada V46 em 5 etapas: uma trilha com as etapas (quantas clientes e
 * quantas dependem da equipe) e, abaixo, a lista da etapa escolhida com o
 * que ela significa, como a cliente sai dela e quem age em cada caso.
 * Filas reais de `/api/admin/central/visao-geral`; aqui só há filtro e ordem.
 */
export function JornadaBoard({ dados, etapa, onEtapa, selecionadoId, onAbrirCliente }: {
  dados: VisaoGeralResponse;
  etapa: EstagioCentral;
  onEtapa: (etapa: EstagioCentral) => void;
  selecionadoId: string | null;
  onAbrirCliente: (clienteId: string, estagio: EstagioCentral) => void;
}) {
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("urgencia");
  const [segmentos, setSegmentos] = useState<Partial<Record<EstagioCentral, string>>>({});
  const hoje = dados.hoje;
  const info = ETAPA_POR_ID.get(etapa)!;
  const segmentoAtivo = segmentos[etapa] ?? "todas";

  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const corresponde = (c: CartaoCliente) => !termo || `${c.nome} ${c.cpf ?? ""} ${(c.cpf ?? "").replace(/\D/g, "")} ${c.procedimento ?? ""}`.toLocaleLowerCase("pt-BR").includes(termo);

  const resumo = useMemo(() => ETAPAS.map((e) => {
    const lista = dados.filas[e.id].filter(corresponde);
    return { id: e.id, total: lista.length, equipe: contarAcaoEquipe(lista, e.id, hoje) };
  }), [dados, termo]); // eslint-disable-line react-hooks/exhaustive-deps

  const daEtapa = useMemo(() => dados.filas[etapa].filter(corresponde), [dados, etapa, termo]); // eslint-disable-line react-hooks/exhaustive-deps
  const contagemSegmento = useMemo(() => new Map(info.segmentos.map((s) => [s.id, daEtapa.filter((c) => s.filtro(c, hoje)).length])), [info, daEtapa, hoje]);

  const linhas = useMemo(() => {
    const seg = info.segmentos.find((s) => s.id === segmentoAtivo) ?? info.segmentos[0];
    const itens = daEtapa.filter((c) => seg.filtro(c, hoje)).map((c) => ({ c, s: situacao(c, etapa, hoje) }));
    if (ordem === "nomeAsc") itens.sort((a, b) => a.c.nome.localeCompare(b.c.nome, "pt-BR"));
    else if (ordem === "nomeDesc") itens.sort((a, b) => b.c.nome.localeCompare(a.c.nome, "pt-BR"));
    else itens.sort((a, b) => a.s.urgencia - b.s.urgencia || a.c.nome.localeCompare(b.c.nome, "pt-BR"));
    return itens;
  }, [daEtapa, info, segmentoAtivo, ordem, etapa, hoje]);

  return <div className="ag-jornada">
    <ol className="ag-trilha" aria-label="Etapas da jornada">
      {ETAPAS.map((e, i) => {
        const r = resumo[i];
        const ativo = e.id === etapa;
        return <li key={e.id} className={ativo ? "is-active" : undefined}>
          <button type="button" className="ag-trilha-etapa" aria-pressed={ativo} onClick={() => onEtapa(e.id)}>
            <span className="ag-trilha-num" aria-hidden="true">{e.numero}</span>
            <span className="ag-trilha-texto">
              <span className="ag-trilha-titulo">{e.titulo}</span>
              <span className="ag-trilha-meta">
                <strong>{r.total}</strong> {r.total === 1 ? "cliente" : "clientes"}
                {r.equipe > 0 && <span className="ag-trilha-acao">{r.equipe} com a equipe</span>}
              </span>
            </span>
          </button>
          {i < ETAPAS.length - 1 && <ArrowRight className="ag-trilha-seta" size={14} aria-hidden="true" />}
        </li>;
      })}
    </ol>

    <section className="ag-panel ag-etapa" aria-labelledby="ag-etapa-titulo">
      <header className="ag-etapa-head">
        <div className="ag-etapa-id">
          <span className="ag-etapa-num" aria-hidden="true">{info.numero}</span>
          <div>
            <span className="ag-eyebrow">Etapa {info.numero} de 5</span>
            <h2 id="ag-etapa-titulo" className="ag-h2">{info.titulo}</h2>
            <p className="ag-etapa-resumo">{info.resumo}</p>
          </div>
        </div>
        <div className="ag-etapa-saida"><Info size={14} aria-hidden="true" /><span>{info.saida}</span></div>
      </header>

      <div className="ag-toolbar">
        <div className="ag-segmentos" role="group" aria-label={`Filtrar ${info.titulo}`}>
          {info.segmentos.map((s) => <button key={s.id} type="button" className="ag-segmento" aria-pressed={segmentoAtivo === s.id}
            onClick={() => setSegmentos((atual) => ({ ...atual, [etapa]: s.id }))}>
            {s.rotulo}<span>{contagemSegmento.get(s.id) ?? 0}</span>
          </button>)}
        </div>
        <div className="ag-toolbar-direita">
          <label className="ag-busca"><Search size={14} aria-hidden="true" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome ou CPF" aria-label="Buscar cliente na jornada" /></label>
          <select className="ag-select" value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} aria-label="Ordenar lista">
            <option value="urgencia">Mais urgentes primeiro</option>
            <option value="nomeAsc">Nome A–Z</option>
            <option value="nomeDesc">Nome Z–A</option>
          </select>
        </div>
      </div>

      {linhas.length === 0
        ? <div className="ag-vazio"><strong>{termo ? "Nenhuma cliente encontrada" : "Nenhuma cliente neste filtro"}</strong><span>{termo ? "Ajuste a busca ou veja as outras etapas na trilha acima." : "Quando houver clientes nesta situação, elas aparecem aqui."}</span></div>
        : <ul className="ag-lista">
          {linhas.map(({ c, s }) => <li key={c.id}>
            <button type="button" className={`ag-linha${selecionadoId === c.id ? " is-selected" : ""}`} onClick={() => onAbrirCliente(c.id, etapa)} aria-label={`Abrir ${c.nome}: ${s.texto}`}>
              <span className="ag-avatar" aria-hidden="true">{iniciais(c.nome)}</span>
              <span className="ag-linha-cliente">
                <strong>{c.nome}</strong>
                <small>{c.procedimento || "Procedimento não informado"}</small>
              </span>
              <span className="ag-linha-dado"><DadoDaEtapa c={c} etapa={etapa} hoje={hoje} /></span>
              <span className="ag-linha-situacao">
                <span className={`ag-quem is-${s.responsavel}`}>{ROTULO_RESPONSAVEL[s.responsavel]}</span>
                <span className={`ag-situacao is-${s.tom}`}>{s.texto}</span>
                {s.prazo && <small className={s.atrasado ? "is-late" : undefined}>{s.prazo}</small>}
              </span>
              <ChevronRight className="ag-linha-seta" size={16} aria-hidden="true" />
            </button>
          </li>)}
        </ul>}

      <footer className="ag-legenda-quem">
        <span><i className="ag-quem is-equipe">Equipe</i> precisa de uma ação sua</span>
        <span><i className="ag-quem is-cliente">Cliente</i> depende da cliente no app</span>
        <span><i className="ag-quem is-sistema">Automático</i> o sistema avança sozinho</span>
      </footer>
    </section>
  </div>;
}

function Progresso({ valor, maximo, rotulo }: { valor: number; maximo: number; rotulo: string }) {
  const pct = Math.min(100, Math.round((valor / Math.max(1, maximo)) * 100));
  return <span className="ag-progresso">
    <span className="ag-progresso-rotulo">{rotulo}</span>
    <span className="ag-progresso-barra" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></span>
  </span>;
}

/** Coluna central: o dado que importa em cada etapa. */
function DadoDaEtapa({ c, etapa, hoje }: { c: CartaoCliente; etapa: EstagioCentral; hoje: string }) {
  if (etapa === "preEligibility" || etapa === "financialReview") {
    return <Progresso valor={c.parcelasPagas} maximo={c.parcelasNecessarias} rotulo={`${c.parcelasPagas} de ${c.totalParcelas} pagas · mínimo ${c.parcelasNecessarias}`} />;
  }
  if (etapa === "termsConfirmed") {
    return <span className="ag-dado-texto"><b>{c.termosResponsavel ?? "Sem responsável"}</b><small>responsável pela assinatura</small></span>;
  }
  if (etapa === "financialRelease") {
    const e = estadoLiberacao(c, hoje);
    const fase = faseLiberacao(c, hoje);
    const passos: { rotulo: string; estado: "feito" | "atual" | "falhou" | "" }[] = [
      { rotulo: "Comparecimento", estado: c.comparecimentoStatus === "nao_compareceu" ? "falhou" : e.compareceu ? "feito" : "atual" },
      { rotulo: "Quitação", estado: c.quitacaoStatus === "nao_realizada" ? "falhou" : e.quitada ? "feito" : e.compareceu ? "atual" : "" },
      { rotulo: `Prazo ${e.totalDias}d úteis`, estado: fase === "liberada" ? "feito" : fase === "prazo" ? "atual" : "" },
      { rotulo: "Agenda liberada", estado: fase === "liberada" ? "feito" : "" },
    ];
    return <span className="ag-passos" aria-label="Andamento da liberação">
      {passos.map((p) => <span key={p.rotulo} className={p.estado ? `is-${p.estado}` : undefined}><i aria-hidden="true" />{p.rotulo}</span>)}
    </span>;
  }
  return <span className="ag-dado-texto"><b>{c.cartaDeCredito.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</b><small>carta de crédito · {c.parcelasPagas}/{c.totalParcelas} parcelas pagas</small></span>;
}

