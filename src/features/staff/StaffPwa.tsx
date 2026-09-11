import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeDollarSign, BookOpenCheck, CheckCircle2, ChevronRight, Home, LogOut, Medal, PlayCircle, RefreshCw, UserRound } from "lucide-react";
import "../../styles/staff-pwa.css";

type Cargo = "vendedora" | "sdr" | "financeiro" | "administrativo";
type Tab = "inicio" | "comissoes" | "treinamentos" | "perfil";

type Regra = {
  id: string;
  cargo: Cargo;
  nome: string;
  tipo: "valor_fixo" | "percentual" | "faixa";
  valor: number | string;
  meta_base: number | string | null;
  configuracao?: Record<string, unknown> | null;
};

type Comissao = {
  id: string;
  referencia_tipo: string | null;
  referencia_id: string | null;
  base_calculo: number | string | null;
  valor_comissao: number | string;
  status: "prevista" | "validada" | "paga" | "cancelada";
  competencia: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

type Treinamento = {
  id: string;
  titulo: string;
  descricao: string | null;
  tipo: "video" | "imagem" | "texto" | "misto";
  conteudo_url: string | null;
  conteudo_texto: string | null;
  obrigatorio: boolean;
  progresso: number;
  concluidoEm: string | null;
};

type StaffData = {
  colaborador: { id: string; nome: string; email: string; cargo: Cargo; permissoes: string[] };
  regraAtual: Regra | null;
  competencia: string;
  comissaoPrevista: number;
  basePeriodo: number;
  metricas: { eventos: number; validados: number; pagos: number };
  comissoes: Comissao[];
  treinamentos: Treinamento[];
};

const tabs = [
  ["inicio", "Início", Home],
  ["comissoes", "Comissões", BadgeDollarSign],
  ["treinamentos", "Treinamentos", BookOpenCheck],
  ["perfil", "Perfil", UserRound],
] as const;

function labelCargo(cargo: Cargo) {
  if (cargo === "vendedora") return "Vendedora";
  if (cargo === "sdr") return "SDR";
  if (cargo === "financeiro") return "Financeiro";
  return "Administrativo";
}

function moeda(value: number | string | null | undefined) {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function iniciais(nome: string) {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map((parte) => parte[0]?.toUpperCase()).join("") || "SL";
}

function regraTexto(regra: Regra | null) {
  if (!regra) return "Nenhuma regra de comissão ativa para este cargo.";
  if (regra.tipo === "percentual") {
    const meta = regra.meta_base ? ` · meta base ${moeda(regra.meta_base)}` : "";
    return `${Number(regra.valor).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% · ${regra.nome}${meta}`;
  }
  return `${moeda(regra.valor)} · ${regra.nome}`;
}

function headline(cargo: Cargo, eventos: number) {
  if (cargo === "vendedora") return eventos ? `${eventos} evento(s) de comissão registrado(s) neste mês.` : "As comissões aparecem aqui quando os eventos elegíveis forem confirmados.";
  if (cargo === "sdr") return eventos ? `${eventos} comparecimento(s) já impactaram sua comissão neste mês.` : "Comparecimentos confirmados entram automaticamente no seu histórico de comissão.";
  if (cargo === "financeiro") return eventos ? `${eventos} recuperação(ões) registrada(s) no período.` : "Recuperações elegíveis aparecem aqui após a confirmação do pagamento.";
  return "Acompanhe seu acesso, treinamentos e informações operacionais da equipe.";
}

function dataCurta(value: string) {
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin", headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({})) as T & { erro?: string };
  if (response.status === 401) {
    window.location.replace("/equipe/login");
    throw new Error("Sessão expirada.");
  }
  if (!response.ok) throw new Error(body.erro ?? "Não foi possível concluir a operação.");
  return body;
}

export function StaffPwa() {
  const [tab, setTab] = useState<Tab>("inicio");
  const [data, setData] = useState<StaffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvandoTreinamento, setSalvandoTreinamento] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const body = await fetchJson<StaffData>("/api/equipe/me");
      setData(body);
      setErro(null);
    } catch (error) {
      if (error instanceof Error && error.message !== "Sessão expirada.") setErro(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  async function sair() {
    try { await fetch("/api/equipe/logout", { method: "POST", credentials: "same-origin" }); }
    finally { window.location.replace("/equipe/login"); }
  }

  async function concluirTreinamento(treinamentoId: string) {
    setSalvandoTreinamento(treinamentoId);
    setErro(null);
    try {
      await fetchJson(`/api/equipe/trainings/${encodeURIComponent(treinamentoId)}/progress`, {
        method: "PATCH",
        body: JSON.stringify({ progresso: 100 }),
      });
      await carregar();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível atualizar o treinamento.");
    } finally {
      setSalvandoTreinamento(null);
    }
  }

  if (loading) {
    return <main className="st-app"><div className="st-loading"><img src="/brand/sra-luck-mark.png" alt="Sra. Luck"/><span>Carregando portal da equipe...</span></div></main>;
  }

  if (!data) {
    return <main className="st-app"><div className="st-loading"><strong>Não foi possível carregar seu portal.</strong><span>{erro ?? "Tente novamente em instantes."}</span><button onClick={() => { setLoading(true); void carregar(); }}><RefreshCw size={14}/> Tentar novamente</button></div></main>;
  }

  const cargo = data.colaborador.cargo;
  const pendentes = data.treinamentos.filter((item) => item.progresso < 100).length;

  return (
    <div className="st-app">
      <header>
        <div><img src="/brand/sra-luck-mark.png" alt="Sra. Luck"/><div><small>Portal da equipe</small><strong>Olá, {data.colaborador.nome.split(" ")[0]}</strong></div></div>
        <span>{labelCargo(cargo)}</span>
      </header>
      <main>
        {erro && <div className="st-error">{erro}</div>}
        {tab === "inicio" && <StaffHome data={data} pendentes={pendentes} setTab={setTab}/>} 
        {tab === "comissoes" && <Commissions data={data}/>} 
        {tab === "treinamentos" && <Trainings treinamentos={data.treinamentos} salvando={salvandoTreinamento} onConcluir={concluirTreinamento}/>} 
        {tab === "perfil" && <Profile data={data} onSair={sair}/>} 
      </main>
      <nav>{tabs.map(([id, label, Icon]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id)}><Icon size={18}/><span>{label}</span></button>)}</nav>
    </div>
  );
}

function StaffHome({ data, pendentes, setTab }: { data: StaffData; pendentes: number; setTab: (tab: Tab) => void }) {
  const ultimos = data.comissoes.filter((item) => item.status !== "cancelada").slice(0, 3);
  return <div className="st-stack">
    <section className="st-hero"><div><small>{labelCargo(data.colaborador.cargo)}</small><h1>Seu trabalho, com dados reais.</h1><p>{headline(data.colaborador.cargo, data.metricas.eventos)}</p></div><Medal/></section>
    <div className="st-kpis"><article><small>Comissão prevista</small><b>{moeda(data.comissaoPrevista)}</b><span>{regraTexto(data.regraAtual)}</span></article><article><small>Eventos no mês</small><b>{data.metricas.eventos}</b><span>{data.metricas.pagos} pago(s) · {data.metricas.validados} validado(s)</span></article></div>
    <section className="st-card"><div className="st-title"><div><h2>Regra atual</h2><p>Configuração válida para o seu cargo.</p></div></div><p className="st-copy st-copy-strong">{regraTexto(data.regraAtual)}</p>{data.regraAtual?.tipo === "percentual" && <p className="st-copy">Base registrada no período: <strong>{moeda(data.basePeriodo)}</strong>.</p>}<button onClick={() => setTab("comissoes")}>Ver comissões <ChevronRight size={15}/></button></section>
    <section className="st-card"><div className="st-title"><div><h2>Treinamentos</h2><p>{pendentes ? `${pendentes} conteúdo(s) ainda não concluído(s).` : data.treinamentos.length ? "Tudo em dia." : "Nenhum treinamento publicado para seu cargo."}</p></div></div>{data.treinamentos.slice(0, 3).map((t) => <div className="st-learning" key={t.id}><PlayCircle/><div><strong>{t.titulo}</strong><small>{t.tipo} · {t.obrigatorio ? "Obrigatório" : "Opcional"}</small></div><span>{t.progresso}%</span></div>)}<button onClick={() => setTab("treinamentos")}>Abrir treinamentos <ChevronRight size={15}/></button></section>
    <section className="st-card"><div className="st-title"><div><h2>Atividades recentes</h2><p>Eventos reais que impactaram sua remuneração.</p></div></div>{ultimos.length ? ultimos.map((item) => <div className="st-activity" key={item.id}><CheckCircle2/><div><strong>{item.referencia_tipo?.replace(/_/g, " ") ?? "Evento de comissão"}</strong><small>{dataCurta(item.created_at)} · {item.status}</small></div><b>{moeda(item.valor_comissao)}</b></div>) : <Empty text="Nenhum evento de comissão registrado neste mês."/>}</section>
  </div>;
}

function Commissions({ data }: { data: StaffData }) {
  const entries = useMemo(() => data.comissoes.filter((item) => item.status !== "cancelada"), [data.comissoes]);
  return <div className="st-stack"><div className="st-section"><h1>Comissões</h1><p>Eventos persistidos e regra vigente do seu cargo.</p></div><section className="st-commission-hero"><small>Previsto no mês</small><h2>{moeda(data.comissaoPrevista)}</h2><p>{regraTexto(data.regraAtual)}</p></section><section className="st-card"><h2>Resumo</h2><div className="st-entry"><strong>Eventos válidos</strong><b>{data.metricas.eventos}</b></div><div className="st-entry"><strong>Validados</strong><b>{data.metricas.validados}</b></div><div className="st-entry"><strong>Pagos</strong><b>{data.metricas.pagos}</b></div>{data.regraAtual?.tipo === "percentual" && <div className="st-entry"><strong>Base do período</strong><b>{moeda(data.basePeriodo)}</b></div>}</section><section className="st-card"><h2>Eventos do período</h2>{entries.length ? entries.map((item) => <article className="st-entry" key={item.id}><div><strong>{item.referencia_tipo?.replace(/_/g, " ") ?? "Comissão"}</strong><small>{dataCurta(item.created_at)} · {item.status}{item.base_calculo != null ? ` · base ${moeda(item.base_calculo)}` : ""}</small></div><b>{moeda(item.valor_comissao)}</b></article>) : <Empty text="Nenhuma comissão registrada para esta competência."/>}</section></div>;
}

function Trainings({ treinamentos, salvando, onConcluir }: { treinamentos: Treinamento[]; salvando: string | null; onConcluir: (id: string) => void }) {
  return <div className="st-stack"><div className="st-section"><h1>Treinamentos</h1><p>Conteúdos publicados pela Sra. Luck para o seu cargo.</p></div>{treinamentos.length ? treinamentos.map((t) => <section className="st-card st-course" key={t.id}><div className="st-course-art"><PlayCircle/></div><div><span>{t.obrigatorio ? "Obrigatório" : "Conteúdo disponível"}</span><h2>{t.titulo}</h2><p>{t.descricao ?? t.tipo}</p><div className="st-progress"><i style={{ width: `${Math.max(0, Math.min(100, t.progresso))}%` }}/></div><small>{t.progresso}% concluído</small></div>{t.conteudo_url ? <a className="st-course-link" href={t.conteudo_url} target="_blank" rel="noreferrer">Abrir conteúdo <ChevronRight size={14}/></a> : t.conteudo_texto ? <p className="st-course-text">{t.conteudo_texto}</p> : null}{t.progresso < 100 ? <button disabled={salvando === t.id} onClick={() => onConcluir(t.id)}>{salvando === t.id ? "Salvando..." : "Marcar como concluído"} <CheckCircle2 size={14}/></button> : <div className="st-complete"><CheckCircle2 size={14}/> Concluído</div>}</section>) : <section className="st-card"><Empty text="Nenhum treinamento foi publicado para o seu cargo ainda."/></section>}</div>;
}

function Profile({ data, onSair }: { data: StaffData; onSair: () => void }) {
  return <div className="st-stack"><div className="st-section"><h1>Meu perfil</h1><p>Identidade e autorização vindas do cadastro administrativo.</p></div><section className="st-card st-profile"><div className="st-avatar">{iniciais(data.colaborador.nome)}</div><h2>{data.colaborador.nome}</h2><span>{labelCargo(data.colaborador.cargo)}</span><small>{data.colaborador.email}</small></section><section className="st-card"><h2>Acesso</h2><p className="st-copy">Seu cargo é controlado pela administração e validado no servidor a cada sessão. Alterações de cargo ou desativação revogam o acesso sem depender deste aparelho.</p>{data.colaborador.permissoes.length > 0 && <div className="st-permissions">{data.colaborador.permissoes.map((item) => <span key={item}>{item}</span>)}</div>}<button onClick={onSair}><LogOut size={14}/> Sair do portal</button></section></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="st-empty">{text}</div>;
}
