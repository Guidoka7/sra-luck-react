"use client";

import { useEffect, useMemo, useState } from "react";
import { zipChip, type ZipKind } from "@/components/admin-zip/zipUi";

/**
 * Aba INTEGRAÇÕES — reprodução de Admin Configuracoes.dc.html: tabela de
 * conexões + drawer com status/recursos habilitados/credenciais/teste de
 * conexão/histórico. Não existe "cadastrar conexão API" genérica no
 * sistema real (só os provedores fixos já mapeados) — o botão do ZIP foi
 * mantido apenas como rótulo informativo, sem criar um fluxo falso.
 */

type EstadoIntegracao = "pronto_para_configurar" | "credenciais_presentes" | "planejado" | "base_incompleta";
type GrupoIntegracao = "comunicacao" | "pagamentos" | "crm" | "bancos";
type Integracao = { id: string; nome: string; grupo: GrupoIntegracao; estado: EstadoIntegracao; credenciaisConfiguradas: boolean; persistenciaPronta: boolean; conexaoLiveVerificada: false; detalhes: string; eventosRegistrados?: number; };
type Payload = { integracoes: Integracao[]; resumo: { total: number; prontosParaConfigurar: number; credenciaisPresentes: number; planejados: number; baseIncompleta: number; conexoesLiveVerificadas: number }; observacao: string };
type OrigemCampo = "painel" | "variavel_de_ambiente" | "nao_configurado";
type CampoCredencial = { chave: string; label: string; obrigatorio: boolean; origem: OrigemCampo; mascara: string | null; atualizadoEm: string | null };
type ProvedorCredenciais = { id: string; nome: string; grupo: GrupoIntegracao; campos: CampoCredencial[] };
type CredenciaisPayload = { provedores: ProvedorCredenciais[]; persistenciaPronta: boolean };
type ResultadoTeste = { conectado: boolean; detalhe: string };
type EventoHistorico = { id: string; usuario: string; acao: string; entidade_id: string | null; detalhes: Record<string, unknown> | null; created_at: string };

const CAPACIDADES: Record<string, string[]> = {
  web_push: ["Enviar notificação push a dispositivos inscritos", "Registrar entrega/erro por assinatura"],
  mercado_pago: ["Criar preferência de pagamento por parcela", "Receber webhook de pagamento aprovado", "Baixar a parcela automaticamente (idempotente)"],
  conta_azul: ["Criar recebível a partir de uma parcela", "Atualizar parcela existente no Conta Azul"],
  rd_station: ["Receber venda via webhook e colocar em conferência"],
};

function estadoKind(estado: EstadoIntegracao): ZipKind { if (estado === "credenciais_presentes") return "warn"; if (estado === "pronto_para_configurar") return "ok"; if (estado === "planejado") return "neutral"; return "bad"; }
function estadoLabel(estado: EstadoIntegracao) { if (estado === "credenciais_presentes") return "Credenciais presentes"; if (estado === "pronto_para_configurar") return "Pronto para configurar"; if (estado === "planejado") return "Planejado"; return "Base incompleta"; }
function iconFor(id: string) { if (id === "web_push") return "↗"; if (id === "mercado_pago") return "MP"; if (id === "conta_azul") return "CA"; if (id === "rd_station") return "RD"; return "$"; }

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
        <button onClick={() => void salvar(campo.chave)} disabled={salvandoCampo === campo.chave || !(valores[campo.chave] || "").trim()} style={{ height: 33, padding: "0 10px", border: "1px solid var(--line)", borderRadius: 8, background: "var(--s0)", color: "var(--bg)", fontSize: 10, fontWeight: 700 }}>Salvar</button>
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
  const [resultadoTeste, setResultadoTeste] = useState<Record<string, ResultadoTeste>>({});
  const [historico, setHistorico] = useState<EventoHistorico[]>([]);
  const [drawer, setDrawer] = useState<Integracao | null>(null);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);

  async function testarConexao(provedor: string) {
    setTestando(provedor);
    try {
      const response = await fetch("/api/admin/integrations/testar-conexao", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provedor }) });
      const body = await response.json().catch(() => ({})) as ResultadoTeste & { erro?: string };
      setResultadoTeste((a) => ({ ...a, [provedor]: response.ok ? body : { conectado: false, detalhe: body.erro ?? "Falha ao testar." } }));
    } catch { setResultadoTeste((a) => ({ ...a, [provedor]: { conectado: false, detalhe: "Erro de conexão ao testar." } })); }
    finally { setTestando(null); }
  }
  async function carregarHistorico() { try { const r = await fetch("/api/admin/integrations/historico", { cache: "no-store", credentials: "same-origin" }); const b = await r.json().catch(() => ({})) as { eventos?: EventoHistorico[] }; setHistorico(b.eventos ?? []); } catch { /* complementar */ } }
  async function atualizarCredenciais() { try { setCredenciais(await carregarCredenciais()); } catch { /* status principal continua */ } }
  async function atualizar() { setLoading(true); setErro(null); try { setData(await carregarStatus()); await atualizarCredenciais(); } catch (error) { setErro(error instanceof Error ? error.message : "Falha ao carregar."); } finally { setLoading(false); } }
  useEffect(() => { void atualizar(); void carregarHistorico(); }, []);

  const provedorDrawer = drawer ? credenciais?.provedores.find((p) => p.id === drawer.id) : undefined;

  return <div className="zip-animate-fade-in">
    <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div><h2 style={{ fontSize: 15 }}>Conexões</h2><div style={{ marginTop: 3, fontSize: 10.5, color: "var(--soft)" }}>Credenciais, saúde, recursos habilitados e histórico.</div></div>
        <div style={{ display: "flex", gap: 7 }}><button onClick={() => { setMostrarHistorico((v) => !v); if (!mostrarHistorico) void carregarHistorico(); }} style={{ height: 31, padding: "0 12px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--soft)", fontSize: 11, fontWeight: 700 }}>Histórico</button><button disabled title="Apenas os provedores já mapeados na arquitetura podem ser configurados" style={{ height: 31, padding: "0 12px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--soft)", fontSize: 11, fontWeight: 700, opacity: .6, cursor: "not-allowed" }}>+ Cadastrar conexão API</button></div>
      </div>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", fontSize: 10.5, color: "var(--soft)", lineHeight: 1.5, background: "var(--s1)" }}><strong style={{ color: "var(--ink)" }}>Status real:</strong> credenciais salvas não significam conexão validada. O badge verde é reservado para conexões verificadas.</div>

      {mostrarHistorico && <div style={{ maxHeight: 220, overflowY: "auto", borderBottom: "1px solid var(--line)" }}>
        {historico.length === 0 ? <div style={{ padding: 20, textAlign: "center", fontSize: 10.5, color: "var(--soft)" }}>Nenhum evento registrado ainda.</div> : historico.map((ev) => <div key={ev.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--line2)", fontSize: 10.5 }}><span>{ev.acao.replace(/_/g, " ")}{ev.entidade_id ? ` · ${ev.entidade_id}` : ""}</span><span style={{ color: "var(--soft)" }}>{new Date(ev.created_at).toLocaleString("pt-BR")}</span></div>)}
      </div>}

      <div style={{ overflow: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,1.3fr) 130px 150px 170px", gap: 10, minWidth: 700, padding: "9px 14px", background: "var(--s1)", borderBottom: "1px solid var(--line)" }}>{["Conexão", "Tipo", "Status", "Última verificação"].map((h) => <div key={h} style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" }}>{h}</div>)}</div>
        {loading && !data ? <div style={{ padding: 32, textAlign: "center", fontSize: 11, color: "var(--soft)" }}>Carregando…</div> : (data?.integracoes ?? []).map((i) => <div key={i.id} onClick={() => setDrawer(i)} className="zip-row-hover" style={{ display: "grid", gridTemplateColumns: "minmax(200px,1.3fr) 130px 150px 170px", gap: 10, minWidth: 700, alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--line2)", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}><div style={{ width: 31, height: 31, borderRadius: 9, background: "var(--robg)", display: "grid", placeItems: "center", color: "var(--bg)", fontSize: 9, fontWeight: 800 }}>{iconFor(i.id)}</div><div><div style={{ fontSize: 12, fontWeight: 700 }}>{i.nome}</div><div style={{ fontSize: 9.5, color: "var(--soft)" }}>{i.detalhes}</div></div></div>
          <div style={{ fontSize: 10.5, color: "var(--soft)" }}>{i.grupo}</div>
          <span style={zipChip(estadoKind(i.estado))}>{estadoLabel(i.estado)}</span>
          <div className="zip-mono" style={{ fontSize: 10.5, color: "var(--soft)" }}>{resultadoTeste[i.id] ? (resultadoTeste[i.id].conectado ? "Conectada agora" : resultadoTeste[i.id].detalhe) : "Não homologada"}</div>
        </div>)}
      </div>
    </div>

    {erro && <div style={{ marginTop: 10, borderRadius: 9, border: "1px solid var(--badbg)", background: "var(--badbg)", color: "var(--bad)", padding: "8px 12px", fontSize: 11 }}>{erro}</div>}

    {drawer && <>
      <div className="zip-animate-fade-in" style={{ position: "fixed", inset: 0, background: "rgba(30,12,16,.42)", zIndex: 60 }} onClick={() => setDrawer(null)} />
      <aside className="zip-animate-slide-in" style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 61, width: "min(396px,100vw)", background: "var(--s0)", borderLeft: "1px solid var(--line)", boxShadow: "var(--sh)", overflowY: "auto" }}>
        <div style={{ padding: "14px 15px 12px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div><div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--rose)" }}>Integração</div><h2 style={{ fontSize: 16, marginTop: 4 }}>{drawer.nome}</h2><div style={{ marginTop: 4, fontSize: 10.5, color: "var(--soft)" }}>{drawer.detalhes}</div></div>
          <button onClick={() => setDrawer(null)} style={{ height: 28, width: 28, borderRadius: 8, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)", fontSize: 13 }}>✕</button>
        </div>
        <div style={{ padding: "14px 15px", display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>Status</span><span style={zipChip(estadoKind(drawer.estado))}>{estadoLabel(drawer.estado)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>Persistência</span><strong style={{ color: drawer.persistenciaPronta ? "var(--ok)" : "var(--bad)" }}>{drawer.persistenciaPronta ? "Pronta" : "Incompleta"}</strong></div>
          {typeof drawer.eventosRegistrados === "number" && <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>Registros internos</span><strong>{drawer.eventosRegistrados}</strong></div>}
        </div>
        {CAPACIDADES[drawer.id] && <div style={{ padding: "0 15px 13px" }}>
          <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 8 }}>Recursos habilitados</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{CAPACIDADES[drawer.id].map((cap) => <div key={cap} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid var(--line)", background: "var(--s1)", borderRadius: 8, padding: "8px 9px", fontSize: 10.5 }}><span>{cap}</span><span style={{ color: "var(--ok)" }}>✓</span></div>)}</div>
        </div>}
        <div style={{ margin: "0 15px", borderTop: "1px solid var(--line)" }} />
        <div style={{ padding: "13px 15px" }}>
          <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 8 }}>Credenciais</div>
          {provedorDrawer ? (credenciais?.persistenciaPronta ? <FormularioCredenciaisZip provedor={provedorDrawer} onSalvo={() => void atualizar()} /> : <p style={{ fontSize: 10.5, color: "var(--gold)" }}>Estrutura de persistência ainda não aplicada neste ambiente.</p>) : <p style={{ fontSize: 10.5, color: "var(--soft)" }}>Este provedor não tem campos de credencial cadastrados.</p>}
        </div>
        <div style={{ padding: "0 15px 15px", display: "flex", justifyContent: "flex-end", gap: 7 }}>
          {drawer.id === "mercado_pago" && <button onClick={() => void testarConexao(drawer.id)} disabled={testando === drawer.id || !drawer.credenciaisConfiguradas} style={{ height: 31, padding: "0 10px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--bg)", fontSize: 10.5, fontWeight: 700 }}>{testando === drawer.id ? "Testando…" : "Testar conexão"}</button>}
        </div>
      </aside>
    </>}
  </div>;
}
