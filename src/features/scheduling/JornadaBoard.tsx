import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Info, Search } from "lucide-react";
import { ETAPAS, ROTULO_RESPONSAVEL, bloqueios, contarAcaoEquipe, contextoDe, situacao, type AcaoJornada, type Responsavel } from "./jornada";
import type { CartaoCliente, EstagioCentral, VisaoGeralResponse } from "./types";

type Ordem = "urgencia" | "nomeAsc" | "nomeDesc";
type FiltroQuem = "todos" | Responsavel;

/**
 * Jornada V46 em quadro (estilo funil de CRM): as 5 etapas lado a lado, cada
 * cartão com a situação da cliente, quem precisa agir e a próxima ação.
 * Filas reais de `/api/admin/central/visao-geral`; aqui só há filtro e ordem.
 */
export function JornadaBoard({ dados, etapa, selecionadoId, onAbrirCliente, onAcao }: {
  dados: VisaoGeralResponse;
  /** Etapa em destaque (ex.: vinda de um link da Visão geral). */
  etapa: EstagioCentral | null;
  selecionadoId: string | null;
  onAbrirCliente: (clienteId: string, estagio: EstagioCentral) => void;
  onAcao: (cliente: CartaoCliente, etapa: EstagioCentral, acao: AcaoJornada) => void;
}) {
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("urgencia");
  const [quem, setQuem] = useState<FiltroQuem>("todos");
  const hoje = dados.hoje;
  const ctx = useMemo(() => contextoDe(dados), [dados]);
  const alertas = useMemo(() => bloqueios(dados), [dados]);
  const colunasRef = useRef<Partial<Record<EstagioCentral, HTMLElement | null>>>({});

  // Link com ?etapa= leva a coluna para a vista.
  useEffect(() => {
    if (etapa) colunasRef.current[etapa]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [etapa]);

  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const colunas = useMemo(() => ETAPAS.map((e) => {
    const todos = dados.filas[e.id]
      .filter((c) => !termo || `${c.nome} ${c.cpf ?? ""} ${(c.cpf ?? "").replace(/\D/g, "")} ${c.procedimento ?? ""}`.toLocaleLowerCase("pt-BR").includes(termo))
      .map((c) => ({ c, s: situacao(c, e.id, hoje, ctx) }));
    const itens = todos.filter((x) => quem === "todos" || x.s.responsavel === quem);
    if (ordem === "nomeAsc") itens.sort((a, b) => a.c.nome.localeCompare(b.c.nome, "pt-BR"));
    else if (ordem === "nomeDesc") itens.sort((a, b) => b.c.nome.localeCompare(a.c.nome, "pt-BR"));
    else itens.sort((a, b) => a.s.urgencia - b.s.urgencia || a.c.nome.localeCompare(b.c.nome, "pt-BR"));
    return { etapa: e, total: todos.length, equipe: contarAcaoEquipe(todos.map((x) => x.c), e.id, hoje, ctx), itens };
  }), [dados, termo, quem, ordem, hoje, ctx]);

  const totais = useMemo(() => {
    const t = { todos: 0, equipe: 0, cliente: 0, sistema: 0 };
    for (const col of ETAPAS) for (const c of dados.filas[col.id]) { t.todos++; t[situacao(c, col.id, hoje, ctx).responsavel]++; }
    return t;
  }, [dados, hoje, ctx]);

  return <div className="ag-jornada">
    {alertas.map((a) => <div key={a.id} className="ag-alerta" role="alert">
      <AlertTriangle size={16} aria-hidden="true" />
      <span>{a.texto}</span>
      <button type="button" className="ag-btn is-pequeno" onClick={() => {
        const alvo = a.id === "termos" ? dados.filas.financialReview[0] : dados.filas.financialRelease[0];
        if (alvo) onAcao(alvo, a.id === "termos" ? "financialReview" : "financialRelease", a.id === "termos" ? "abrirDatasTermos" : "abrirDatasCirurgia");
      }}>{a.id === "termos" ? "Abrir datas de termos" : "Abrir datas cirúrgicas"}</button>
    </div>)}

    <div className="ag-toolbar ag-quadro-toolbar">
      <div className="ag-segmentos" role="group" aria-label="Filtrar por quem precisa agir">
        {([["todos", "Todas"], ["equipe", "Com a equipe"], ["cliente", "Com a cliente"], ["sistema", "Automático"]] as [FiltroQuem, string][]).map(([id, rotulo]) =>
          <button key={id} type="button" className="ag-segmento" aria-pressed={quem === id} onClick={() => setQuem(id)}>
            {id !== "todos" && <i className={`ag-ponto is-${id}`} aria-hidden="true" />}{rotulo}<span>{totais[id]}</span>
          </button>)}
      </div>
      <div className="ag-toolbar-direita">
        <label className="ag-busca"><Search size={14} aria-hidden="true" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome ou CPF" aria-label="Buscar cliente na jornada" /></label>
        <select className="ag-select" value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} aria-label="Ordenar cartões">
          <option value="urgencia">Mais urgentes primeiro</option>
          <option value="nomeAsc">Nome A–Z</option>
          <option value="nomeDesc">Nome Z–A</option>
        </select>
      </div>
    </div>

    <div className="ag-quadro-wrap">
      <div className="ag-quadro">
        {colunas.map(({ etapa: e, total, equipe, itens }) => <section key={e.id} ref={(el) => { colunasRef.current[e.id] = el; }}
          className={`ag-coluna${etapa === e.id ? " is-destaque" : ""}`} aria-labelledby={`ag-col-${e.id}`}>
          <header className="ag-coluna-head">
            <div className="ag-coluna-titulo">
              <span className="ag-trilha-num" aria-hidden="true">{e.numero}</span>
              <h2 id={`ag-col-${e.id}`} className="ag-h3">{e.titulo}</h2>
              <span className="ag-coluna-info" tabIndex={0} role="img" title={`${e.resumo}\n\n${e.saida}`} aria-label={`Sobre esta etapa: ${e.resumo} ${e.saida}`}><Info size={14} aria-hidden="true" /></span>
              <span className="ag-coluna-total" title={`${total} cliente(s) nesta etapa`}>{total}</span>
            </div>
            <span className={`ag-coluna-equipe${equipe ? "" : " is-vazio"}`}>{equipe ? <><i className="ag-ponto is-equipe" aria-hidden="true" />{equipe} com a equipe</> : "Nada com a equipe"}</span>
          </header>
          <div className="ag-coluna-cartoes">
            {itens.length === 0
              ? <div className="ag-vazio ag-vazio-compacto"><span>{termo || quem !== "todos" ? "Nenhuma cliente neste filtro." : "Nenhuma cliente nesta etapa."}</span></div>
              : itens.map(({ c, s }) => <article key={c.id} className={`ag-cartao${s.atrasado ? " is-late" : ""}${selecionadoId === c.id ? " is-selected" : ""}`}>
                <button type="button" className="ag-cartao-main" onClick={() => onAbrirCliente(c.id, e.id)} aria-label={`Abrir ${c.nome}: ${s.texto}. ${ROTULO_RESPONSAVEL[s.responsavel]}.`}>
                  <strong className="ag-cartao-nome">{c.nome}</strong>
                  <span className="ag-cartao-sit"><i className={`ag-ponto is-${s.responsavel}`} title={ROTULO_RESPONSAVEL[s.responsavel]} aria-hidden="true" />{s.texto}</span>
                </button>
                {(s.prazo || s.acao) && <div className="ag-cartao-rodape">
                  {s.prazo && <small className={`ag-cartao-prazo${s.atrasado ? " is-late" : ""}`}>{s.prazo}</small>}
                  {s.acao && <button type="button" className={`ag-btn is-pequeno${s.atrasado ? " is-primario" : ""}`} onClick={() => onAcao(c, e.id, s.acao!.id)}>{s.acao.rotulo}</button>}
                </div>}
              </article>)}
          </div>
        </section>)}
      </div>
    </div>
  </div>;
}
