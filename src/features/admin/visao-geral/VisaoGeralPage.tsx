import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronRight, RefreshCw, Search, Smartphone } from "lucide-react";
import { apiJson } from "@/lib/api";
import { carregarPerfilAdmin, type AdminAccessProfile } from "@/lib/adminAccess";
import type { VisaoGeralAdmin } from "@/lib/visaoGeralContrato";
import { AgendaSemana } from "./AgendaSemana";
import { FilaTrabalho } from "./FilaTrabalho";
import { GraficoRecebimentos } from "./GraficoRecebimentos";
import { hrefAgenda, hrefFinanceiro, podeBuscarClientes } from "./destinos";
import { dataPorExtenso, horaMinuto, moeda, moedaDestaque, numero, percentual, plural } from "./formatos";
import "@/styles/admin-visao-geral.css";

/**
 * Visão geral do Admin: fila de trabalho do dia, saúde financeira do mês,
 * agenda da semana e jornada das clientes. Tudo vem de um único endpoint
 * (`GET /api/admin/visao-geral`, contrato em src/lib/visaoGeralContrato.ts);
 * nenhum número é calculado ou simulado no navegador.
 */

const ATUALIZACAO_AUTOMATICA_MS = 5 * 60 * 1000;

function resumoDoDia(dados: VisaoGeralAdmin) {
  const criticas = dados.pendencias.filter((p) => p.severidade === "critica").length;
  const acoes = dados.pendencias.filter((p) => p.severidade === "critica" || p.severidade === "atencao").length;
  if (criticas > 0) return { texto: `${plural(criticas, "frente com prazo vencido", "frentes com prazo vencido")} · ${plural(acoes, "fila exige ação", "filas exigem ação")}`, tom: "critica" };
  if (acoes > 0) return { texto: `${plural(acoes, "fila exige ação", "filas exigem ação")} hoje · nenhum prazo vencido`, tom: "atencao" };
  return { texto: "Operação em dia · nenhuma fila exige ação", tom: "ok" };
}

function Indicador({ rotulo, valor, detalhe, tom, rodape }: {
  rotulo: string;
  valor: string;
  detalhe: string;
  tom?: "critica" | "neutro";
  rodape?: ReactNode;
}) {
  return <article className={`vg-kpi${tom === "critica" ? " is-critica" : ""}`}>
    <span className="vg-kpi-rotulo">{rotulo}</span>
    <strong className="vg-kpi-valor">{valor}</strong>
    <span className="vg-kpi-detalhe">{detalhe}</span>
    {rodape}
  </article>;
}

export default function VisaoGeralPage() {
  const router = useRouter();
  const [dados, setDados] = useState<VisaoGeralAdmin | null>(null);
  const [perfil, setPerfil] = useState<AdminAccessProfile | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const emAndamento = useRef(false);
  const ultimaCarga = useRef(0);

  const carregar = useCallback(async () => {
    if (emAndamento.current) return;
    emAndamento.current = true;
    setCarregando(true);
    try {
      const resposta = await apiJson<VisaoGeralAdmin>("/api/admin/visao-geral", { cache: "no-store" });
      setDados(resposta);
      setErro(null);
      ultimaCarga.current = Date.now();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar a visão geral.");
    } finally {
      emAndamento.current = false;
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
    void carregarPerfilAdmin().then(setPerfil);
    // Atualiza sozinho com a aba visível; ao voltar para a aba, recarrega se os dados envelheceram.
    const intervalo = window.setInterval(() => { if (document.visibilityState === "visible") void carregar(); }, ATUALIZACAO_AUTOMATICA_MS);
    const aoVoltar = () => { if (document.visibilityState === "visible" && Date.now() - ultimaCarga.current > 2 * 60 * 1000) void carregar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { window.clearInterval(intervalo); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [carregar]);

  function buscar(e: FormEvent) {
    e.preventDefault();
    const termo = busca.trim();
    router.push(termo ? `/admin/clientes?busca=${encodeURIComponent(termo)}` : "/admin/clientes");
  }

  if (!dados) {
    return <div className="vg">
      {erro
        ? <div className="vg-panel vg-estado" role="alert">
          <AlertTriangle size={22} aria-hidden="true" />
          <strong>Não foi possível carregar a visão geral</strong>
          <span>{erro}</span>
          <button type="button" className="vg-botao" onClick={() => void carregar()} disabled={carregando}>{carregando ? "Tentando…" : "Tentar novamente"}</button>
        </div>
        : <div className="vg-esqueleto" aria-busy="true" aria-label="Carregando a visão geral">
          <div className="vg-esq vg-esq-titulo" />
          <div className="vg-kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="vg-esq vg-esq-kpi" />)}</div>
          <div className="vg-grid"><div className="vg-esq vg-esq-painel" /><div className="vg-esq vg-esq-painel" /></div>
        </div>}
    </div>;
  }

  const { financeiro, carteira, jornada, app } = dados;
  const resumo = resumoDoDia(dados);
  const vencMes = financeiro.mes.vencimentos;
  const quitadosPct = vencMes.parcelas > 0 ? Math.round((vencMes.quitadas / vencMes.parcelas) * 100) : 0;
  const maiorEtapa = Math.max(1, ...jornada.etapas.map((e) => e.total));
  const linkFinanceiro = hrefFinanceiro(perfil);
  const linkAgenda = hrefAgenda(perfil);

  return <div className="vg">
    <header className="vg-head">
      <div className="vg-head-texto">
        <span className="vg-eyebrow">{dataPorExtenso(dados.hoje)}</span>
        <h1>Visão geral</h1>
        <p className={`vg-resumo is-${resumo.tom}`}><span className="vg-resumo-ponto" aria-hidden="true" />{resumo.texto}</p>
      </div>
      <div className="vg-head-acoes">
        {podeBuscarClientes(perfil) && <form className="vg-busca" onSubmit={buscar} role="search">
          <Search size={15} aria-hidden="true" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente por nome ou CPF" aria-label="Buscar cliente" />
        </form>}
        <button type="button" className="vg-botao vg-botao-atualizar" onClick={() => void carregar()} disabled={carregando} title={`Atualizado às ${horaMinuto(dados.geradoEm)}`}>
          <RefreshCw size={14} className={carregando ? "vg-girando" : undefined} aria-hidden="true" />
          <span>{carregando ? "Atualizando…" : `Atualizado às ${horaMinuto(dados.geradoEm)}`}</span>
        </button>
      </div>
    </header>

    {erro && <div className="vg-aviso is-erro" role="alert"><AlertTriangle size={14} aria-hidden="true" />Não foi possível atualizar agora ({erro}). Exibindo os dados das {horaMinuto(dados.geradoEm)}.</div>}
    {dados.avisos.map((aviso) => <div key={aviso} className="vg-aviso"><AlertTriangle size={14} aria-hidden="true" />{aviso}</div>)}

    <section className="vg-kpis" aria-label={`Indicadores financeiros de ${dados.periodo.rotulo}`}>
      <Indicador
        rotulo={`Recebido em ${dados.periodo.rotulo.split(" ")[0]}`}
        valor={moedaDestaque(financeiro.mes.recebido)}
        detalhe={`${plural(financeiro.mes.parcelasRecebidas, "parcela", "parcelas")} · ${moeda(financeiro.semana.recebido)} nesta semana`}
        rodape={<div className="vg-kpi-progresso" title={`${vencMes.quitadas} de ${vencMes.parcelas} parcelas com vencimento no mês já quitadas`}>
          <div className="vg-barra"><span style={{ width: `${quitadosPct}%` }} /></div>
          <span>{vencMes.parcelas > 0 ? `${quitadosPct}% dos vencimentos do mês quitados (${numero(vencMes.quitadas)}/${numero(vencMes.parcelas)})` : "Sem vencimentos no mês"}</span>
        </div>}
      />
      <Indicador
        rotulo="Receita administrativa no mês"
        valor={moedaDestaque(financeiro.mes.receitaAdministrativaRealizada)}
        detalhe={`${moeda(financeiro.mes.receitaAdministrativaPrevista)} ainda a realizar nos vencimentos do mês`}
      />
      <Indicador
        rotulo="Em atraso"
        valor={moedaDestaque(financeiro.atraso.valor)}
        detalhe={financeiro.atraso.parcelas > 0
          ? `${plural(financeiro.atraso.clientes, "cliente", "clientes")} · ${plural(financeiro.atraso.parcelas, "parcela", "parcelas")} · ${percentual(financeiro.atraso.percentualParcelas)} das parcelas vencidas`
          : "Nenhuma parcela vencida na carteira ativa"}
        tom={financeiro.atraso.parcelas > 0 ? "critica" : "neutro"}
      />
      <Indicador
        rotulo="A vencer em 7 dias"
        valor={moedaDestaque(financeiro.aVencer7.valor)}
        detalhe={`${plural(financeiro.aVencer7.parcelas, "parcela", "parcelas")} · ${moedaDestaque(financeiro.aVencer30.valor)} em 30 dias`}
      />
    </section>

    <div className="vg-grid">
      <FilaTrabalho pendencias={dados.pendencias} perfil={perfil} />
      <div className="vg-coluna">
        <AgendaSemana eventos={dados.agenda.proximos} hoje={dados.hoje} mes={dados.agenda.mes} rotuloMes={dados.periodo.rotulo.split(" ")[0]} perfil={perfil} />

        <section className="vg-panel" aria-labelledby="vg-jornada-titulo">
          <header className="vg-panel-head">
            <div>
              <h2 id="vg-jornada-titulo">Jornada das clientes</h2>
              <p>Onde cada cliente ativa está no fluxo V46.</p>
            </div>
            {linkAgenda && <Link href={linkAgenda} className="vg-link">Abrir jornada<ChevronRight size={13} aria-hidden="true" /></Link>}
          </header>
          <ol className="vg-jornada">
            {jornada.etapas.map((etapa, i) => <li key={etapa.id}>
              <span className="vg-jornada-passo" aria-hidden="true">{i + 1}</span>
              <span className="vg-jornada-rotulo">{etapa.rotulo}</span>
              <span className="vg-jornada-barra" aria-hidden="true"><span style={{ width: `${etapa.total > 0 ? Math.max(3, (etapa.total / maiorEtapa) * 100) : 0}%` }} /></span>
              <strong className="vg-jornada-total">{numero(etapa.total)}</strong>
            </li>)}
          </ol>
          <footer className="vg-panel-foot">
            <span><strong>{numero(jornada.elegiveisSemSolicitacao)}</strong> já elegíveis sem solicitação</span>
            <span><strong>{numero(jornada.concluidasNoMes)}</strong> {jornada.concluidasNoMes === 1 ? "processo concluído" : "processos concluídos"} no mês</span>
          </footer>
        </section>
      </div>
    </div>

    <div className="vg-grid vg-grid-base">
      <section className="vg-panel" aria-labelledby="vg-receb-titulo">
        <header className="vg-panel-head">
          <div>
            <h2 id="vg-receb-titulo">Recebimentos</h2>
            <p>Vencimentos previstos e valores recebidos, mês a mês.</p>
          </div>
          {linkFinanceiro && <Link href={linkFinanceiro} className="vg-link">Financeiro<ChevronRight size={13} aria-hidden="true" /></Link>}
        </header>
        <GraficoRecebimentos serie={financeiro.serie} />
      </section>

      <section className="vg-panel" aria-labelledby="vg-carteira-titulo">
        <header className="vg-panel-head">
          <div>
            <h2 id="vg-carteira-titulo">Carteira</h2>
            <p>Contratos por situação e crédito contratado.</p>
          </div>
        </header>
        <dl className="vg-numeros">
          <div><dt>Ativas</dt><dd>{numero(carteira.ativas)}</dd></div>
          <div><dt>Suspensas</dt><dd>{numero(carteira.suspensas)}</dd></div>
          <div><dt>Negativadas</dt><dd>{numero(carteira.negativadas)}</dd></div>
          <div><dt>Novas no mês</dt><dd>{numero(carteira.novasNoMes)}</dd></div>
        </dl>
        <dl className="vg-linhas">
          <div><dt>Crédito contratado (ativas)</dt><dd>{moeda(carteira.creditoContratadoAtivo)}</dd></div>
          <div><dt>Ticket médio</dt><dd>{moeda(carteira.ticketMedio)}</dd></div>
          <div><dt>Comprovantes em conferência</dt><dd>{moeda(financeiro.conferencia.valor)}</dd></div>
        </dl>
        <h3 className="vg-subtitulo"><Smartphone size={14} aria-hidden="true" />App da cliente</h3>
        {app
          ? <dl className="vg-linhas">
            <div><dt>Instalado como app</dt><dd>{numero(app.pwaInstalados)} de {numero(app.dispositivos)} ({app.pwaPercentual}%)</dd></div>
            <div><dt>Sem acesso há 7 dias</dt><dd>{plural(app.semAcessoRecente, "dispositivo", "dispositivos")}</dd></div>
            <div><dt>Notificações push</dt><dd className={app.webPushConfigurado ? undefined : "is-late"}>{app.webPushConfigurado ? `Ativas · ${plural(app.pushHoje, "envio", "envios")} hoje` : "Não configuradas"}</dd></div>
          </dl>
          : <p className="vg-indisponivel">Indicadores do app indisponíveis no momento.</p>}
      </section>
    </div>
  </div>;
}
