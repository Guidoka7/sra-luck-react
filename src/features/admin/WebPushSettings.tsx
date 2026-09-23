"use client";

import { useEffect, useState } from "react";

type Diagnostico = {
  configurado: boolean;
  validado: boolean;
  detalhe: string;
  subject: string | null;
  publicKey: string | null;
  privateKeyConfigurada: boolean;
  assinaturas: number;
  ultimaVerificacao: string | null;
};

type RespostaAcao = Diagnostico & {
  ok?: boolean;
  conectado?: boolean;
  erro?: string;
  codigo?: string;
  chavePrivadaExposta?: boolean;
};

type RotacaoPendente = {
  payload: Record<string, unknown>;
  assinaturas: number;
};

const input: React.CSSProperties = {
  width: "100%",
  minHeight: 34,
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--s0)",
  color: "var(--ink)",
  padding: "0 9px",
  fontSize: 10.5,
  outline: "none",
};

const button: React.CSSProperties = {
  height: 32,
  padding: "0 11px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--s0)",
  color: "var(--bg)",
  fontSize: 10.5,
  fontWeight: 700,
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  const body = await response.json().catch(() => ({})) as T & { erro?: string; codigo?: string; assinaturas?: number };
  if (!response.ok) {
    const error = new Error(body.erro ?? "Não foi possível concluir a operação.") as Error & { status?: number; body?: typeof body };
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function formatarData(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "Ainda não testada";
}

export function WebPushSettings({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<Diagnostico | null>(null);
  const [subject, setSubject] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState<"gerar" | "salvar" | "testar" | "rotacionar" | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [rotacao, setRotacao] = useState<RotacaoPendente | null>(null);

  async function carregar() {
    try {
      const data = await requestJson<Diagnostico>("/api/admin/integrations/web-push/vapid");
      setStatus(data);
      setSubject(data.subject ?? "");
      setPublicKey(data.publicKey ?? "");
    } catch (error) {
      setFeedback({ ok: false, text: error instanceof Error ? error.message : "Falha ao carregar Web Push." });
    }
  }

  useEffect(() => { void carregar(); }, []);

  async function executar(payload: Record<string, unknown>, mode: "gerar" | "salvar" | "rotacionar") {
    setBusy(mode);
    setFeedback(null);
    setRotacao(null);
    try {
      const data = await requestJson<RespostaAcao>("/api/admin/integrations/web-push/vapid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setStatus(data);
      setSubject(data.subject ?? subject);
      setPublicKey(data.publicKey ?? publicKey);
      setPrivateKey("");
      setManual(false);
      setFeedback({ ok: true, text: data.detalhe || "Configuração VAPID salva e validada." });
      onChanged?.();
      await carregar();
    } catch (error) {
      const typed = error as Error & { status?: number; body?: { codigo?: string; assinaturas?: number } };
      if (typed.status === 409 && typed.body?.codigo === "ROTACAO_VAPID_COM_ASSINATURAS") {
        setRotacao({ payload, assinaturas: Number(typed.body.assinaturas ?? 0) });
        setFeedback({ ok: false, text: typed.message });
      } else {
        setFeedback({ ok: false, text: typed.message || "Falha ao configurar Web Push." });
      }
    } finally {
      setBusy(null);
    }
  }

  async function testar() {
    setBusy("testar");
    setFeedback(null);
    try {
      const data = await requestJson<RespostaAcao>("/api/admin/integrations/web-push/vapid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "testar" }),
      });
      setStatus(data);
      setFeedback({ ok: Boolean(data.validado), text: data.detalhe });
      onChanged?.();
      await carregar();
    } catch (error) {
      setFeedback({ ok: false, text: error instanceof Error ? error.message : "Configuração VAPID inválida." });
      onChanged?.();
      await carregar();
    } finally {
      setBusy(null);
    }
  }

  const gerando = busy === "gerar";
  const salvando = busy === "salvar";

  return <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
    <div style={{ border: "1px solid var(--line)", background: "var(--s1)", borderRadius: 10, padding: "9px 10px", fontSize: 10.5, lineHeight: 1.55 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <strong>Configuração VAPID</strong>
        <span style={{ fontWeight: 700, color: status?.validado ? "var(--ok)" : status?.configurado ? "var(--gold)" : "var(--soft)" }}>
          {status?.validado ? "✓ Validada" : status?.configurado ? "Aguardando validação" : "Não configurada"}
        </span>
      </div>
      <div style={{ marginTop: 6, color: "var(--soft)" }}>{status?.detalhe ?? "Carregando estado do Web Push…"}</div>
      <div style={{ marginTop: 7, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <span style={{ color: "var(--soft)" }}>Dispositivos inscritos</span><strong style={{ textAlign: "right" }}>{status?.assinaturas ?? 0}</strong>
        <span style={{ color: "var(--soft)" }}>Última verificação</span><span style={{ textAlign: "right" }}>{formatarData(status?.ultimaVerificacao ?? null)}</span>
        <span style={{ color: "var(--soft)" }}>Chave privada</span><strong style={{ textAlign: "right", color: status?.privateKeyConfigurada ? "var(--ok)" : "var(--soft)" }}>{status?.privateKeyConfigurada ? "Protegida no cofre" : "Ausente"}</strong>
      </div>
    </div>

    <div>
      <label style={{ display: "block", marginBottom: 4, fontSize: 10.5, fontWeight: 700 }}>Subject VAPID</label>
      <input style={input} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="contato@empresa.com.br ou mailto:contato@empresa.com.br" />
      <div style={{ marginTop: 4, fontSize: 9.5, color: "var(--soft)" }}>Identifica o responsável pelo envio. Um e-mail simples é convertido automaticamente para mailto:.</div>
    </div>

    {status?.publicKey && !manual && <div>
      <div style={{ marginBottom: 4, fontSize: 10.5, fontWeight: 700 }}>VAPID Public Key atual</div>
      <div className="zip-mono" style={{ border: "1px solid var(--line)", background: "var(--s1)", borderRadius: 8, padding: "8px 9px", fontSize: 9.5, wordBreak: "break-all", color: "var(--soft)" }}>{status.publicKey}</div>
    </div>}

    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      <button
        type="button"
        disabled={Boolean(busy) || !subject.trim()}
        onClick={() => void executar({ acao: "gerar", subject }, "gerar")}
        style={{ ...button, background: "var(--bg)", color: "var(--on-accent)", borderColor: "var(--bg)", opacity: Boolean(busy) || !subject.trim() ? .55 : 1 }}
      >{gerando ? "Gerando…" : status?.configurado ? "Gerar novo par VAPID" : "Gerar chaves automaticamente"}</button>
      <button type="button" disabled={Boolean(busy) || !status?.configurado} onClick={() => void testar()} style={{ ...button, opacity: Boolean(busy) || !status?.configurado ? .55 : 1 }}>{busy === "testar" ? "Validando…" : "Testar configuração"}</button>
      <button type="button" disabled={Boolean(busy)} onClick={() => setManual((v) => !v)} style={{ ...button, color: "var(--soft)" }}>{manual ? "Fechar importação" : "Importar par existente"}</button>
    </div>

    {manual && <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700 }}>Importar chaves VAPID existentes</div>
      <div><label style={{ display: "block", marginBottom: 4, fontSize: 10 }}>Public Key</label><textarea rows={3} style={{ ...input, padding: 8, resize: "vertical" }} value={publicKey} onChange={(e) => setPublicKey(e.target.value)} placeholder="Cole a chave pública VAPID" /></div>
      <div><label style={{ display: "block", marginBottom: 4, fontSize: 10 }}>Private Key</label><textarea rows={3} style={{ ...input, padding: 8, resize: "vertical" }} value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} placeholder="Cole a chave privada VAPID" /></div>
      <div style={{ fontSize: 9.5, color: "var(--soft)", lineHeight: 1.5 }}>A chave privada é usada somente nesta requisição, validada contra a chave pública e gravada cifrada. Ela não volta para o navegador depois de salva.</div>
      <button type="button" disabled={Boolean(busy) || !subject.trim() || !publicKey.trim() || !privateKey.trim()} onClick={() => void executar({ acao: "salvar", subject, publicKey, privateKey }, "salvar")} style={{ ...button, alignSelf: "flex-end", opacity: Boolean(busy) || !subject.trim() || !publicKey.trim() || !privateKey.trim() ? .55 : 1 }}>{salvando ? "Validando e salvando…" : "Salvar e validar"}</button>
    </div>}

    {rotacao && <div style={{ border: "1px solid var(--badbg)", background: "var(--badbg)", color: "var(--bad)", borderRadius: 9, padding: "9px 10px", fontSize: 10.5, lineHeight: 1.5 }}>
      <strong>Confirmação de rotação necessária.</strong> Existem {rotacao.assinaturas} dispositivo(s) inscritos com a chave atual. Trocar o par VAPID pode exigir que essas clientes ativem as notificações novamente.
      <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <button type="button" onClick={() => setRotacao(null)} style={button}>Cancelar</button>
        <button type="button" disabled={busy === "rotacionar"} onClick={() => void executar({ ...rotacao.payload, confirmarRotacao: true }, "rotacionar")} style={{ ...button, background: "var(--bad)", borderColor: "var(--bad)", color: "white" }}>{busy === "rotacionar" ? "Rotacionando…" : "Confirmar rotação"}</button>
      </div>
    </div>}

    {feedback && <div style={{ borderRadius: 9, padding: "8px 10px", background: feedback.ok ? "var(--okbg)" : "var(--badbg)", color: feedback.ok ? "var(--ok)" : "var(--bad)", fontSize: 10.5, lineHeight: 1.5 }}>{feedback.text}</div>}
  </div>;
}
