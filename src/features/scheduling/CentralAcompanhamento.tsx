import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, CalendarRange, Plus, Route, Stethoscope } from "lucide-react";
import { ClienteDrawer } from "@/components/admin/cliente-drawer/ClienteDrawer";
import "./central-v46.css";
import "./agenda.css";
import { centralApi, dataBr, diaSemana } from "./api";
import type { CartaoCliente, EstagioCentral, VisaoGeralResponse } from "./types";
import { JornadaBoard } from "./JornadaBoard";
import { ETAPAS, contarAcaoEquipe } from "./jornada";
import { TermsAgendaTab } from "./TermsAgendaTab";
import { SurgeryAgendaTab } from "./SurgeryAgendaTab";
import { SystemDateModal } from "./SystemDateModal";

type Aba = "overview" | "terms" | "surgery";

const ABAS: { id: Aba; param: string | null; rotulo: string; descricao: string; icone: typeof Route }[] = [
  { id: "overview", param: null, rotulo: "Jornada das clientes", descricao: "Onde cada cliente está no processo, o que falta e quem precisa agir.", icone: Route },
  { id: "terms", param: "termos", rotulo: "Agenda de termos", descricao: "Datas abertas no app para a assinatura dos termos e quem vem em cada dia.", icone: CalendarRange },
  { id: "surgery", param: "cirurgia", rotulo: "Agenda cirúrgica", descricao: "Datas cirúrgicas, teto financeiro do mês e confirmação de pagamento.", icone: Stethoscope },
];

const ETAPAS_VALIDAS = new Set<string>(ETAPAS.map((e) => e.id));

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
  const [drawer, setDrawer] = useState<{ clienteId: string; estagio: EstagioCentral | null } | null>(null);
  const [novaCliente, setNovaCliente] = useState(false);
  const [escolherDia, setEscolherDia] = useState(false);
  // `?data=AAAA-MM-DD` (vindo de "Ver na agenda" no drawer das outras telas) só pré-seleciona o dia.
  const dataParam = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("data") ?? "") ? searchParams.get("data") : null;
  const [dataTermos, setDataTermos] = useState<string | null>(abaParam === "termos" ? dataParam : null);
  const [dataCirurgia, setDataCirurgia] = useState<string | null>(abaParam === "cirurgia" ? dataParam : null);
  const [recarregarKey, setRecarregarKey] = useState(0);
  const etapaParam = searchParams.get("etapa");
  const etapaNoEndereco = Boolean(etapaParam && ETAPAS_VALIDAS.has(etapaParam));
  const [etapa, setEtapa] = useState<EstagioCentral>(etapaNoEndereco ? etapaParam as EstagioCentral : "preEligibility");
  const [etapaDefinida, setEtapaDefinida] = useState(etapaNoEndereco);

  // Mantém a aba/etapa no endereço para que links (ex.: Visão geral) abram no lugar certo.
  const trocarAba = useCallback((nova: Aba, novaEtapa?: EstagioCentral) => {
    setAba(nova);
    if (novaEtapa) { setEtapa(novaEtapa); setEtapaDefinida(true); }
    const url = new URL(window.location.href);
    const param = ABAS.find((a) => a.id === nova)?.param;
    if (param) url.searchParams.set("aba", param); else url.searchParams.delete("aba");
    if (nova === "overview") url.searchParams.set("etapa", novaEtapa ?? etapa); else url.searchParams.delete("etapa");
    url.searchParams.delete("data");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }, [etapa]);

  const carregar = useCallback(async () => {
    try { setDados(await centralApi.visaoGeral()); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível carregar a Central."); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const hoje = dados?.hoje ?? null;
  // Sem etapa no endereço, abre na primeira etapa que tem trabalho para a equipe.
  useEffect(() => {
    if (!dados || etapaDefinida) return;
    setEtapa(ETAPAS.find((e) => contarAcaoEquipe(dados.filas[e.id], e.id, dados.hoje) > 0)?.id ?? "preEligibility");
    setEtapaDefinida(true);
  }, [dados, etapaDefinida]);
  useEffect(() => { if (hoje) { setDataTermos((d) => d ?? hoje); setDataCirurgia((d) => d ?? hoje); } }, [hoje]);

  const aoMudar = useCallback(async () => { setRecarregarKey((k) => k + 1); await carregar(); }, [carregar]);

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
  const abaAtual = ABAS.find((a) => a.id === aba)!;
  const abrir = (clienteId: string, estagio: EstagioCentral | null = null) => setDrawer({ clienteId, estagio });

  return <div className="ag"><div className="v46 ag-root">
    <header className="ag-head">
      <div>
        <span className="ag-eyebrow">{hoje ? `${diaSemana(hoje)}, ${dataBr(hoje)}` : "Agenda"}</span>
        <h1 className="ag-h1">Agenda</h1>
        <p className="ag-sub">{abaAtual.descricao}</p>
      </div>
      <div className="ag-head-acoes">
        {aba !== "overview" && <button type="button" className="ag-btn" aria-label="Ir para uma data nas agendas" disabled={!hoje} onClick={() => setEscolherDia(true)}>
          <CalendarDays size={15} aria-hidden="true" />
          {!hoje ? "Carregando…" : !diaRef || diaRef === hoje ? "Ir para data" : `Vendo ${dataBr(diaRef)}`}
        </button>}
        <button type="button" className="ag-btn is-primario" onClick={() => setNovaCliente(true)}><Plus size={15} aria-hidden="true" />Nova cliente</button>
      </div>
    </header>

    <div className="ag-abas" role="tablist" aria-label="Áreas da Agenda">
      {ABAS.map(({ id, rotulo, icone: Icone }) => <button key={id} type="button" role="tab" aria-selected={aba === id} className="ag-aba" onClick={() => trocarAba(id)}>
        <Icone size={15} aria-hidden="true" />{rotulo}
      </button>)}
    </div>

    {erro && !dados && <div className="ag-panel ag-erro" role="alert"><b>Não foi possível carregar a Agenda.</b><span>{erro}</span><button type="button" className="ag-btn" onClick={() => void carregar()}>Tentar novamente</button></div>}
    {!erro && !dados && <div className="ag-panel ag-vazio"><span>Carregando a Agenda…</span></div>}

    {dados && hoje && aba === "overview" && <JornadaBoard dados={dados} etapa={etapa} onEtapa={(e) => trocarAba("overview", e)} selecionadoId={drawer?.clienteId ?? null} onAbrirCliente={(id, estagio) => abrir(id, estagio)} />}
    {dados && hoje && aba === "terms" && dataTermos && <TermsAgendaTab hoje={hoje} data={dataTermos} onData={setDataTermos} sugestoesResponsavel={sugestoesResponsavel} recarregarKey={recarregarKey} onAbrirCliente={(id) => abrir(id)} onMudou={carregar} />}
    {dados && hoje && aba === "surgery" && dataCirurgia && <SurgeryAgendaTab hoje={hoje} data={dataCirurgia} onData={setDataCirurgia} recarregarKey={recarregarKey} liberadas={liberadas} cartoes={cartoes} onAbrirCliente={(id) => abrir(id)} onConsultarProcesso={(id) => abrir(id, "surgeryConfirmed")} onMudou={carregar} />}

    {drawer && hoje && <ClienteDrawer key={drawer.clienteId} clienteId={drawer.clienteId} abaInicial="process" estagioOrigem={drawer.estagio} hoje={hoje}
      sugestoesResponsavel={sugestoesResponsavel} onClose={() => setDrawer(null)} onChanged={aoMudar}
      onIrParaAgenda={(tipo, data) => {
        if (tipo === "terms") { trocarAba("terms"); if (data) setDataTermos(data); }
        else { trocarAba("surgery"); if (data) setDataCirurgia(data); }
      }} />}

    {escolherDia && hoje && <SystemDateModal atual={diaRef ?? hoje} hoje={hoje} contagens={contagens} onClose={() => setEscolherDia(false)}
      onAplicar={(iso) => { setDataTermos(iso); setDataCirurgia(iso); }} />}

    {novaCliente && <ClienteDrawer clienteId={null} hoje={hoje} onClose={() => setNovaCliente(false)} onChanged={carregar} />}
  </div></div>;
}
