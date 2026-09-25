import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ClienteDrawer } from "@/components/admin/cliente-drawer/ClienteDrawer";
import "./central-v46.css";
import { centralApi, dataBr, diaSemana } from "./api";
import type { CartaoCliente, EstagioCentral, VisaoGeralResponse } from "./types";
import { OverviewBoard } from "./OverviewBoard";
import { TermsAgendaTab } from "./TermsAgendaTab";
import { SurgeryAgendaTab } from "./SurgeryAgendaTab";
import { SystemDateModal } from "./SystemDateModal";

type Aba = "overview" | "terms" | "surgery";

const CABECALHO: Record<Aba, { titulo: string; subtitulo: string }> = {
  overview: { titulo: "Central de acompanhamento", subtitulo: "Acompanhe todo o fluxo das clientes, desde o progresso financeiro até os termos e a cirurgia." },
  terms: { titulo: "Agenda de termos", subtitulo: "Controle as datas disponíveis para agendamentos de assinatura de termos." },
  surgery: { titulo: "Agenda cirúrgica", subtitulo: "Gerencie as datas cirúrgicas, a capacidade e as cirurgias confirmadas." },
};

/**
 * Central de acompanhamento — reprodução do V46 aprovado
 * (docs/design/sra-luck-central-v46.html). Visual 100% do V46 (CSS gerado
 * e escopado em `.v46`); dados e ações 100% reais via `/api/admin/central/*`
 * e as APIs do cadastro. Nenhuma regra de negócio é calculada aqui.
 */
export function CentralAcompanhamento() {
  const searchParams = useSearchParams();
  const abaParam = searchParams.get("aba");
  const [aba, setAba] = useState<Aba>(abaParam === "cirurgia" ? "surgery" : abaParam === "termos" ? "terms" : "overview");
  const [dados, setDados] = useState<VisaoGeralResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregandoMais, setCarregandoMais] = useState<EstagioCentral | null>(null);
  const [drawer, setDrawer] = useState<{ clienteId: string; estagio: EstagioCentral | null } | null>(null);
  const [novaCliente, setNovaCliente] = useState(false);
  const [escolherDia, setEscolherDia] = useState(false);
  // `?data=AAAA-MM-DD` (vindo de "Ver na agenda" no drawer das outras telas) só pré-seleciona o dia.
  const dataParam = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("data") ?? "") ? searchParams.get("data") : null;
  const [dataTermos, setDataTermos] = useState<string | null>(abaParam === "termos" ? dataParam : null);
  const [dataCirurgia, setDataCirurgia] = useState<string | null>(abaParam === "cirurgia" ? dataParam : null);
  const [recarregarKey, setRecarregarKey] = useState(0);

  const carregar = useCallback(async () => {
    try { setDados(await centralApi.visaoGeral()); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível carregar a Central."); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const hoje = dados?.hoje ?? null;
  useEffect(() => { if (hoje) { setDataTermos((d) => d ?? hoje); setDataCirurgia((d) => d ?? hoje); } }, [hoje]);

  const aoMudar = useCallback(async () => { setRecarregarKey((k) => k + 1); await carregar(); }, [carregar]);
  const carregarMais = useCallback(async (estagio: EstagioCentral) => {
    const atual = dados?.filas[estagio] ?? [];
    const cursor = dados?.cursores?.[estagio];
    if (!cursor || carregandoMais || atual.length >= (dados?.totais?.[estagio] ?? atual.length)) return;
    setCarregandoMais(estagio);
    try {
      const proxima = await centralApi.visaoGeral({ estagio, aposNome: cursor.nome, aposId: cursor.id });
      setDados((anterior) => anterior ? {
        ...anterior,
        filas: { ...anterior.filas, [estagio]: [
          ...anterior.filas[estagio],
          ...proxima.filas[estagio].filter((c) => !anterior.filas[estagio].some((a) => a.id === c.id)),
        ] },
        totais: proxima.totais,
        cursores: { ...anterior.cursores, [estagio]: proxima.cursores?.[estagio] },
      } : anterior);
      setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível carregar mais clientes."); }
    finally { setCarregandoMais(null); }
  }, [dados, carregandoMais]);

  const todos = useMemo(() => dados ? Object.values(dados.filas).flat() as CartaoCliente[] : [], [dados]);
  const cartoes = useMemo(() => new Map(todos.map((c) => [c.id, c])), [todos]);
  const sugestoesResponsavel = useMemo(() => [...new Set(todos.map((c) => c.termosResponsavel).filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b, "pt-BR")), [todos]);
  const liberadas = useMemo(() => (dados?.filas.financialRelease ?? []).filter((c) => c.agendaCirurgicaLiberadaEm && !c.dataCirurgia), [dados]);
  const contagens = useMemo(() => {
    const m = new Map<string, { termos: number; cirurgias: number }>();
    for (const c of todos) {
      if (c.dataTermos) { const x = m.get(c.dataTermos) ?? { termos: 0, cirurgias: 0 }; x.termos++; m.set(c.dataTermos, x); }
      if (c.dataCirurgia) { const x = m.get(c.dataCirurgia) ?? { termos: 0, cirurgias: 0 }; x.cirurgias++; m.set(c.dataCirurgia, x); }
    }
    return m;
  }, [todos]);

  const diaRef = aba === "surgery" ? dataCirurgia : dataTermos;
  const cab = CABECALHO[aba];
  const abrir = (clienteId: string, estagio: EstagioCentral | null = null) => setDrawer({ clienteId, estagio });

  return <div className="v46">
    <div className="page-head">
      <div>
        <h1>{cab.titulo}</h1>
        <p>{cab.subtitulo}</p>
      </div>
      <div className="head-actions">
        <button type="button" className="today-card today-picker-btn" aria-label="Escolher dia das agendas" disabled={!hoje} onClick={() => setEscolherDia(true)}>
          <span className="today-calendar-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 2v3M17 2v3M3.5 9h17M5.5 4h13a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
            </svg>
          </span>
          <div className="today-copy">
            <b>{!hoje ? "Carregando…" : !diaRef || diaRef === hoje ? `Hoje é ${dataBr(hoje)}` : `Visualizando ${dataBr(diaRef)}`}</b>
            <small>{diaSemana(diaRef ?? hoje)}</small>
          </div>
          <span className="today-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m7 10 5 5 5-5" />
            </svg>
          </span>
        </button>
        <button type="button" className="primary-btn" onClick={() => setNovaCliente(true)}>＋ Nova cliente</button>
      </div>
    </div>

    <div className="main-tabs" role="tablist" aria-label="Áreas da Central">
      {([["overview", "⌂", "Visão geral"], ["terms", "▤", "Termos"], ["surgery", "⚑", "Cirurgia"]] as [Aba, string, string][]).map(([id, icone, rotulo]) =>
        <button key={id} type="button" role="tab" aria-selected={aba === id} className={`main-tab${aba === id ? " active" : ""}`} onClick={() => setAba(id)}><span aria-hidden="true">{icone}</span> <span>{rotulo}</span></button>)}
    </div>

    {erro && !dados && <div className="panel panel-pad" role="alert"><div className="callout danger">{erro}</div><div className="inline-actions" style={{ marginTop: 10 }}><button type="button" className="secondary-btn" onClick={() => void carregar()}>Tentar novamente</button></div></div>}
    {erro && dados && <div className="panel panel-pad" role="alert"><div className="callout danger">{erro}</div></div>}
    {!erro && !dados && <div className="panel panel-pad"><div className="empty-card">Carregando a Central…</div></div>}

    {dados && hoje && aba === "overview" && <section className="view active v46-overview">
      <OverviewBoard dados={dados} selecionadoId={drawer?.clienteId ?? null} onAbrirCliente={(id, estagio) => abrir(id, estagio)} onCarregarMais={carregarMais} carregandoMais={carregandoMais} />
    </section>}
    {dados && hoje && aba === "terms" && dataTermos && <section className="view active">
      <TermsAgendaTab hoje={hoje} data={dataTermos} onData={setDataTermos} sugestoesResponsavel={sugestoesResponsavel} recarregarKey={recarregarKey} onAbrirCliente={(id) => abrir(id)} onMudou={carregar} />
    </section>}
    {dados && hoje && aba === "surgery" && dataCirurgia && <section className="view active">
      <SurgeryAgendaTab hoje={hoje} data={dataCirurgia} onData={setDataCirurgia} recarregarKey={recarregarKey} liberadas={liberadas} cartoes={cartoes} onAbrirCliente={(id) => abrir(id)} onConsultarProcesso={(id) => abrir(id, "surgeryConfirmed")} onMudou={carregar} />
    </section>}

    {drawer && hoje && <ClienteDrawer key={drawer.clienteId} clienteId={drawer.clienteId} abaInicial="process" estagioOrigem={drawer.estagio} hoje={hoje}
      sugestoesResponsavel={sugestoesResponsavel} onClose={() => setDrawer(null)} onChanged={aoMudar}
      onIrParaAgenda={(tipo, data) => {
        if (tipo === "terms") { if (data) setDataTermos(data); setAba("terms"); }
        else { if (data) setDataCirurgia(data); setAba("surgery"); }
      }} />}

    {escolherDia && hoje && <SystemDateModal atual={diaRef ?? hoje} hoje={hoje} contagens={contagens} onClose={() => setEscolherDia(false)}
      onAplicar={(iso) => { setDataTermos(iso); setDataCirurgia(iso); }} />}

    {novaCliente && <ClienteDrawer clienteId={null} hoje={hoje} onClose={() => setNovaCliente(false)} onChanged={carregar} />}
  </div>;
}
