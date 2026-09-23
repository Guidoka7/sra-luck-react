"use client";

import { useEffect, useState } from "react";
import { zipChip, type ZipKind } from "@/components/admin-zip/zipUi";
import { WebPushSettings } from "@/features/admin/WebPushSettings";

type EstadoIntegracao = "pronto_para_configurar" | "credenciais_presentes" | "planejado" | "base_incompleta";
type GrupoIntegracao = "comunicacao" | "pagamentos" | "crm" | "bancos";
type Integracao = {
  id: string; nome: string; grupo: GrupoIntegracao; estado: EstadoIntegracao;
  credenciaisConfiguradas: boolean; persistenciaPronta: boolean; conexaoLiveVerificada: boolean;
  detalhes: string; eventosRegistrados?: number; ultimaVerificacao?: string | null;
  ultimaSincronizacao?: string | null; ultimoWebhook?: string | null; errosRecentes?: number;
  oauthConfigurado?: boolean; oauthAutorizado?: boolean; modoLeitura?: boolean;
};
type Payload = { integracoes: Integracao[]; resumo: { total: number; prontosParaConfigurar: number; credenciaisPresentes: number; planejados: number; baseIncompleta: number; conexoesLiveVerificadas: number }; observacao: string };
type OrigemCampo = "painel" | "variavel_de_ambiente" | "nao_configurado";
type CampoCredencial = { chave: string; label: string; obrigatorio: boolean; origem: OrigemCampo; mascara: string | null; atualizadoEm: string | null };
type ProvedorCredenciais = { id: string; nome: string; grupo: GrupoIntegracao; campos: CampoCredencial[] };
type CredenciaisPayload = { provedores: ProvedorCredenciais[]; persistenciaPronta: boolean };
type ResultadoTeste = { conectado: boolean; detalhe: string };
type EventoHistorico = { id: string; usuario: string; acao: string; entidade_id: string | null; detalhes: Record<string, unknown> | null; created_at: string };

const CAPACIDADES: Record<string, string[]> = {
  web_push: ["Enviar notificação push a dispositivos inscritos", "Registrar entrega/erro por assinatura"],
  mercado_pago: ["Criar preferência de pagamento por parcela", "Receber evento do provedor", "Encaminhar pagamento aprovado para conferência humana — sem baixa automática"],
  conta_azul: ["Criar recebível a partir de uma parcela", "Atualizar parcela existente no Conta Azul"],
  gemini: ["1 mensagem do dia, igual para todas as clientes (rotina diária às 00:05)", "No máximo 1 geração por dia; o app só lê a mensagem salva", "Nenhum dado de cliente enviado ao Gemini", "Se falhar, usa a frase de reserva do catálogo ou a última válida"],
  rd_station: ["Consultar negociações ganhas pela API v2 (GET)", "Receber criação/atualização via webhook", "Atualizar apenas o snapshot externo no Sra. Luck", "Nunca escrever dados comerciais de volta no RD Station"],
};

function estadoKind(estado: EstadoIntegracao): ZipKind { if (estado === "credenciais_presentes") return "warn"; if (estado === "pronto_para_configurar") return "ok"; if (estado === "planejado") return "neutral"; return "bad"; }
function estadoLabel(estado: EstadoIntegracao) { if (estado === "credenciais_presentes") return "Credenciais presentes"; if (estado === "pronto_para_configurar") return "Pronto para configurar"; if (estado === "planejado") return "Planejado"; return "Base incompleta"; }
function iconFor(id: string) { if (id === "web_push") return "↗"; if (id === "mercado_pago") return "MP"; if (id === "conta_azul") return "CA"; if (id === "rd_station") return "RD"; if (id === "gemini") return "✦"; return "$"; }
function dataHora(v?: string | null) { return v ? new Date(v).toLocaleString("pt-BR") : "Ainda não"; }

async function carregarStatus(): Promise<Payload> {
  const response = await fetch("/api/admin/integrations/status", { cache: "no-store", credentials: "same-origin" });
  const body = await response.json().catch(() => ({})) as Payload & { erro?: string };
  if (!response.ok) throw new Error(body.erro ?? "Não foi possível carregar o status das integrações.");
  return body;
}
async function carregarCredenciais(): Promise<CredenciaisPayload> {
  const response = await fetch("/api/admin/integrations/credenciais", { cache: "no-store", credentials: "same-origin" });
  const body = await response.json().catch(() => ({})) as CredenciaisPayload & { erro?: string };
  if (!response.ok) throw new Error((body as { erro?: string }).erro ?? "Não foi possível carregar as credenciais.");
  return body;
}

const fieldInput: React.CSSProperties = { height: 33, border: "1px solid var(--line)", borderRadius: 8, background: "var(--s0)", color: "var(--ink)", padding: "0 9px", fontSize: 10.5, width: "100%" };
const btn: React.CSSProperties = { height: 31, padding: "0 10px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--bg)", fontSize: 10.5, fontWeight: 700 };

function FormularioCredenciaisZip({ provedor, onSalvo }: { provedor: ProvedorCredenciais; onSalvo: () => void }) {
  const [valores, setValores] = useState<Record<string, string>>({});
  const [salvandoCampo, setSalvandoCampo] = useState<string | null>(null);
  const [erroCampo, setErroCampo] = useState<Record<string, string>>({});

  async function salvar(chave: string) {
    const valor = (valores[chave] || "").trim();
    if (!valor) return;
    setSalvandoCampo(chave); setErroCampo((a) => ({ ...a, [chave]: "" }));
    try {
      const response = await fetch("/api/admin/integrations/credenciais", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provedor: provedor.id, chave, valor }) });
      const body = await response.json().catch(() => ({})) as { erro?: string };
      if (!response.ok) throw new Error(body.erro ?? "Não foi possível salvar a credencial.");
      setValores((a) => ({ ...a, [chave]: "" })); onSalvo();
    } catch (error) { setErroCampo((a) => ({ ...a, [chave]: error instanceof Error ? error.message : "Falha ao salvar." })); }
    finally { setSalvandoCampo(null); }
  }
  async function remover(chave: string) {
    setSalvandoCampo(chave);
    try {
      const response = await fetch("/api/admin/integrations/credenciais", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provedor: provedor.id, chave, remover: true }) });
      const body = await response.json().catch(() => ({})) as { erro?: string };
      if (!response.ok) throw new Error(body.erro ?? "Não foi possível remover a credencial.");
      onSalvo();
    } catch (error) { setErroCampo((a) => ({ ...a, [chave]: error instanceof Error ? error.message : "Falha ao remover." })); }
    finally { setSalvandoCampo(null); }
  }

  return <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 7 }}>
    {provedor.campos.map((campo) => <div key={campo.chave} style={{ gridColumn: "1 / -1", marginBottom: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginBottom: 4 }}><span style={{ fontWeight: 600 }}>{campo.label}{campo.obrigatorio && <span style={{ color: "var(--bad)" }}> *</span>}</span><span style={{ color: "var(--soft)" }}>{campo.mascara ? `salvo: ${campo.mascara}` : "não configurada"}</span></div>
      <div style={{ display: "flex", gap: 6 }}>
        <input type="password" style={fieldInput} value={valores[campo.chave] || ""} onChange={(e) => setValores((a) => ({ ...a, [campo.chave]: e.target.value }))} placeholder={campo.mascara ? "Substituir valor salvo..." : "Colar valor..."} />
        <button onClick={() => void salvar(campo.chave)} disabled={salvandoCampo === campo.chave || !(valores[campo.chave] || "").trim()} style={btn}>Salvar</button>
        {campo.origem === "painel" && <button onClick={() => void remover(campo.chave)} disabled={salvandoCampo === campo.chave} style={{ height: 33, width: 33, border: "1px solid var(--badbg)", borderRadius: 8, background: "var(--badbg)", color: "var(--bad)" }}>✕</button>}
      </div>
      {erroCampo[campo.chave] && <p style={{ marginTop: 4, fontSize: 10, color: "var(--bad)" }}>{erroCampo[campo.chave]}</p>}
    </div>)}
  </div>;
}

export default function IntegracoesAdminPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [credenciais, setCredenciais] = useState<CredenciaisPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [testando, setTestando] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [conectando, setConectando] = useState(false);
  const [resultadoTeste, setResultadoTeste] = useState<Record<string, ResultadoTeste>>({});
  const [historico, setHistorico] = useState<EventoHistorico[]>([]);
  const [drawer, setDrawer] = useState<Integracao | null>(null);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);

  async function testarConexao(provedor: string) {
    setTestando(provedor);
    try {
      const isRd = provedor === "rd_station";
      const endpoint = isRd ? "/api/admin/integrations/rd-station/test" : "/api/admin/integrations/testar-conexao";
      const init: RequestInit = isRd
        ? { method: "POST", credentials: "same-origin" }
        : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provedor }) };
      const response = await fetch(endpoint, init);
      const body = await response.json().catch(() => ({})) as ResultadoTeste & { erro?: string };
      setResultadoTeste((a) => ({ ...a, [provedor]: response.ok ? body : { conectado: false, detalhe: body.erro ?? body.detalhe ?? "Falha ao testar." } }));
      await atualizar();
    } catch { setResultadoTeste((a) => ({ ...a, [provedor]: { conectado: false, detalhe: "Erro de conexão ao testar." } })); }
    finally { setTestando(null); }
  }

  /** Roda a rotina da mensagem do dia (idempotente: se já existe a de hoje, só mostra). */
  async function mensagemDeHoje() {
    setTestando("gemini_mensagem");
    try {
      const response = await fetch("/api/admin/integrations/gemini/mensagem-do-dia", { method: "POST", credentials: "same-origin" });
      const body = await response.json().catch(() => ({})) as { texto?: string; origem?: string; reutilizada?: boolean; motivo?: string; erro?: string };
      const origem = body.origem === "ia" ? "gerada pelo Gemini" : body.origem === "ultima_valida" ? "última mensagem válida" : "frase de reserva do catálogo";
      const detalhe = response.ok && body.texto
        ? `${body.reutilizada ? "Mensagem de hoje já existia" : "Mensagem de hoje criada"} (${origem}): ${body.texto.replace(/\*/g, "")}${body.motivo && body.origem !== "ia" ? ` — motivo: ${body.motivo}` : ""}`
        : body.erro ?? "Não foi possível preparar a mensagem de hoje.";
      setResultadoTeste((a) => ({ ...a, gemini: { conectado: response.ok && body.origem === "ia", detalhe } }));
      await atualizar();
    } catch { setResultadoTeste((a) => ({ ...a, gemini: { conectado: false, detalhe: "Erro de conexão." } })); }
    finally { setTestando(null); }
  }

  async function sincronizarRd() {
    setSincronizando(true); setErro(null);
    try {
      const response = await fetch("/api/admin/integrations/rd-station/sync", { method: "POST", credentials: "same-origin" });
      const body = await response.json().catch(() => ({})) as { erro?: string; totalRd?: number; criadas?: number; atualizadas?: number };
      if (!response.ok) throw new Error(body.erro ?? "Falha ao sincronizar RD Station.");
      setResultadoTeste((a) => ({ ...a, rd_station: { conectado: true, detalhe: `Sync: ${body.totalRd ?? 0} negócio(s), ${body.criadas ?? 0} nova(s), ${body.atualizadas ?? 0} snapshot(s) atualizado(s).` } }));
      await Promise.all([atualizar(), carregarHistorico()]);
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao sincronizar RD Station."); }
    finally { setSincronizando(false); }
  }

  async function conectarRd() {
    setConectando(true); setErro(null);
    try {
      const response = await fetch("/api/admin/integrations/rd-station/authorize-url", { cache: "no-store", credentials: "same-origin" });
      const body = await response.json().catch(() => ({})) as { url?: string; erro?: string };
      if (!response.ok || !body.url) throw new Error(body.erro ?? "Não foi possível iniciar o OAuth do RD Station.");
      window.location.assign(body.url);
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao iniciar OAuth."); setConectando(false); }
  }

  async function carregarHistorico() { try { const r = await fetch("/api/admin/integrations/historico", { cache: "no-store", credentials: "same-origin" }); const b = await r.json().catch(() => ({})) as { eventos?: EventoHistorico[] }; setHistorico(b.eventos ?? []); } catch { /* complementar */ } }
  async function atualizarCredenciais() { try { setCredenciais(await carregarCredenciais()); } catch { /* status principal continua */ } }
  async function atualizar() { setLoading(true); setErro(null); try { setData(await carregarStatus()); await atualizarCredenciais(); } catch (error) { setErro(error instanceof Error ? error.message : "Falha ao carregar."); } finally { setLoading(false); } }
  useEffect(() => { void atualizar(); void carregarHistorico(); }, []);

  const provedorDrawer = drawer ? credenciais?.provedores.find((p) => p.id === drawer.id) : undefined;
  const drawerAtual = drawer ? data?.integracoes.find((i) => i.id === drawer.id) ?? drawer : null;

  return <div className="zip-animate-fade-in">
    <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div><h2 style={{ fontSize: 15 }}>Conexões</h2><div style={{ marginTop: 3, fontSize: 10.5, color: "var(--soft)" }}>Credenciais, saúde, recursos habilitados e histórico.</div></div>
        <div style={{ display: "flex", gap: 7 }}><button onClick={() => { setMostrarHistorico((v) => !v); if (!mostrarHistorico) void carregarHistorico(); }} style={{ ...btn, color: "var(--soft)" }}>Histórico</button><button disabled title="Apenas os provedores já mapeados na arquitetura podem ser configurados" style={{ ...btn, color: "var(--soft)", opacity: .6, cursor: "not-allowed" }}>+ Cadastrar conexão API</button></div>
      </div>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", fontSize: 10.5, color: "var(--soft)", lineHeight: 1.5, background: "var(--s1)" }}><strong style={{ color: "var(--ink)" }}>Status real:</strong> credenciais salvas não significam conexão validada. O RD Station opera em integração estritamente somente leitura.</div>

      {mostrarHistorico && <div style={{ maxHeight: 220, overflowY: "auto", borderBottom: "1px solid var(--line)" }}>
        {historico.length === 0 ? <div style={{ padding: 20, textAlign: "center", fontSize: 10.5, color: "var(--soft)" }}>Nenhum evento registrado ainda.</div> : historico.map((ev) => <div key={ev.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--line2)", fontSize: 10.5 }}><span>{ev.acao.replace(/_/g, " ")}{ev.entidade_id ? ` · ${ev.entidade_id}` : ""}</span><span style={{ color: "var(--soft)" }}>{new Date(ev.created_at).toLocaleString("pt-BR")}</span></div>)}
      </div>}

      <div style={{ overflow: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,1.3fr) 130px 150px 170px", gap: 10, minWidth: 700, padding: "9px 14px", background: "var(--s1)", borderBottom: "1px solid var(--line)" }}>{["Conexão", "Tipo", "Status", "Última verificação"].map((h) => <div key={h} style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" }}>{h}</div>)}</div>
        {loading && !data ? <div style={{ padding: 32, textAlign: "center", fontSize: 11, color: "var(--soft)" }}>Carregando…</div> : (data?.integracoes ?? []).map((i) => <div key={i.id} onClick={() => setDrawer(i)} className="zip-row-hover" style={{ display: "grid", gridTemplateColumns: "minmax(200px,1.3fr) 130px 150px 170px", gap: 10, minWidth: 700, alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--line2)", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}><div style={{ width: 31, height: 31, borderRadius: 9, background: "var(--robg)", display: "grid", placeItems: "center", color: "var(--bg)", fontSize: 9, fontWeight: 800 }}>{iconFor(i.id)}</div><div><div style={{ fontSize: 12, fontWeight: 700 }}>{i.nome}</div><div style={{ fontSize: 9.5, color: "var(--soft)" }}>{i.detalhes}</div></div></div>
          <div style={{ fontSize: 10.5, color: "var(--soft)" }}>{i.grupo}</div>
          <span style={zipChip(i.conexaoLiveVerificada ? "ok" : estadoKind(i.estado))}>{i.conexaoLiveVerificada ? (i.id === "web_push" ? "Validada" : "Conectada") : estadoLabel(i.estado)}</span>
          <div className="zip-mono" style={{ fontSize: 10.5, color: "var(--soft)" }}>{resultadoTeste[i.id] ? (resultadoTeste[i.id].conectado ? "Conectada agora" : resultadoTeste[i.id].detalhe) : dataHora(i.ultimaVerificacao)}</div>
        </div>)}
      </div>
    </div>

    {erro && <div style={{ marginTop: 10, borderRadius: 9, border: "1px solid var(--badbg)", background: "var(--badbg)", color: "var(--bad)", padding: "8px 12px", fontSize: 11 }}>{erro}</div>}

    {drawerAtual && <>
      <div className="zip-animate-fade-in" style={{ position: "fixed", inset: 0, background: "rgba(30,12,16,.42)", zIndex: 60 }} onClick={() => setDrawer(null)} />
      <aside className="zip-animate-slide-in" style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 61, width: "min(396px,100vw)", background: "var(--s0)", borderLeft: "1px solid var(--line)", boxShadow: "var(--sh)", overflowY: "auto" }}>
        <div style={{ padding: "14px 15px 12px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div><div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--rose)" }}>Integração</div><h2 style={{ fontSize: 16, marginTop: 4 }}>{drawerAtual.nome}</h2><div style={{ marginTop: 4, fontSize: 10.5, color: "var(--soft)" }}>{drawerAtual.detalhes}</div></div>
          <button onClick={() => setDrawer(null)} style={{ height: 28, width: 28, borderRadius: 8, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)", fontSize: 13 }}>✕</button>
        </div>

        {drawerAtual.id === "rd_station" && <div style={{ margin: "12px 15px 0", border: "1px solid var(--okbg)", background: "var(--okbg)", borderRadius: 10, padding: "9px 10px", fontSize: 10.5, lineHeight: 1.5, color: "var(--ok)" }}><strong>Somente leitura.</strong> O Sra. Luck recebe e consulta dados do RD Station. Alterações de nome, campanha, origem, vendedora ou qualquer outro campo feitas aqui ficam somente no Sra. Luck e nunca são enviadas ao CRM.</div>}

        <div style={{ padding: "14px 15px", display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>Status</span><span style={zipChip(drawerAtual.conexaoLiveVerificada ? "ok" : estadoKind(drawerAtual.estado))}>{drawerAtual.conexaoLiveVerificada ? (drawerAtual.id === "web_push" ? "Validada" : "Conectada") : estadoLabel(drawerAtual.estado)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>Persistência</span><strong style={{ color: drawerAtual.persistenciaPronta ? "var(--ok)" : "var(--bad)" }}>{drawerAtual.persistenciaPronta ? "Pronta" : "Incompleta"}</strong></div>
          {typeof drawerAtual.eventosRegistrados === "number" && <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>Registros internos</span><strong>{drawerAtual.eventosRegistrados}</strong></div>}
          {drawerAtual.id === "rd_station" && <>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>OAuth</span><strong style={{ color: drawerAtual.oauthAutorizado ? "var(--ok)" : "var(--gold)" }}>{drawerAtual.oauthAutorizado ? "Autorizado" : drawerAtual.oauthConfigurado ? "Aguardando autorização" : "Não configurado"}</strong></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>Última sincronização</span><span className="zip-mono">{dataHora(drawerAtual.ultimaSincronizacao)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>Último webhook</span><span className="zip-mono">{dataHora(drawerAtual.ultimoWebhook)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>Erros registrados</span><strong style={{ color: (drawerAtual.errosRecentes ?? 0) > 0 ? "var(--bad)" : "var(--ok)" }}>{drawerAtual.errosRecentes ?? 0}</strong></div>
          </>}
        </div>

        {CAPACIDADES[drawerAtual.id] && <div style={{ padding: "0 15px 13px" }}>
          <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 8 }}>Recursos habilitados</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{CAPACIDADES[drawerAtual.id].map((cap) => <div key={cap} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid var(--line)", background: "var(--s1)", borderRadius: 8, padding: "8px 9px", fontSize: 10.5 }}><span>{cap}</span><span style={{ color: "var(--ok)" }}>✓</span></div>)}</div>
        </div>}
        <div style={{ margin: "0 15px", borderTop: "1px solid var(--line)" }} />
        <div style={{ padding: "13px 15px" }}>
          <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 8 }}>Credenciais</div>
          {provedorDrawer ? (credenciais?.persistenciaPronta ? (drawerAtual.id === "web_push" ? <WebPushSettings onChanged={() => void atualizar()} /> : <FormularioCredenciaisZip provedor={provedorDrawer} onSalvo={() => void atualizar()} />) : <p style={{ fontSize: 10.5, color: "var(--gold)" }}>Estrutura de persistência ainda não aplicada neste ambiente.</p>) : <p style={{ fontSize: 10.5, color: "var(--soft)" }}>Este provedor não tem campos de credencial cadastrados.</p>}
        </div>
        <div style={{ padding: "0 15px 15px", display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 7 }}>
          {(drawerAtual.id === "mercado_pago" || drawerAtual.id === "gemini") && <button onClick={() => void testarConexao(drawerAtual.id)} disabled={testando === drawerAtual.id || !drawerAtual.credenciaisConfiguradas} style={btn}>{testando === drawerAtual.id ? "Testando…" : "Testar conexão"}</button>}
          {drawerAtual.id === "gemini" && <button onClick={() => void mensagemDeHoje()} disabled={testando === "gemini_mensagem"} style={btn}>{testando === "gemini_mensagem" ? "Preparando…" : "Mensagem de hoje"}</button>}
          {drawerAtual.id === "rd_station" && <>
            <button onClick={() => void conectarRd()} disabled={conectando || !drawerAtual.oauthConfigurado} style={btn}>{conectando ? "Abrindo OAuth…" : drawerAtual.oauthAutorizado ? "Reautorizar OAuth" : "Conectar OAuth"}</button>
            <button onClick={() => void testarConexao("rd_station")} disabled={testando === "rd_station" || !drawerAtual.oauthAutorizado} style={btn}>{testando === "rd_station" ? "Testando…" : "Testar conexão"}</button>
            <button onClick={() => void sincronizarRd()} disabled={sincronizando || !drawerAtual.oauthAutorizado} style={{ ...btn, background: "var(--bg)", color: "#FFFDFC", borderColor: "var(--bg)" }}>{sincronizando ? "Sincronizando…" : "Sincronizar agora"}</button>
          </>}
        </div>
        {resultadoTeste[drawerAtual.id] && <div style={{ margin: "0 15px 15px", borderRadius: 9, padding: "8px 10px", background: resultadoTeste[drawerAtual.id].conectado ? "var(--okbg)" : "var(--badbg)", color: resultadoTeste[drawerAtual.id].conectado ? "var(--ok)" : "var(--bad)", fontSize: 10.5 }}>{resultadoTeste[drawerAtual.id].detalhe}</div>}
      </aside>
    </>}
  </div>;
}
