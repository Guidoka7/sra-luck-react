import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../components/ui/ThemeProvider";
import { DEFAULT_ADMIN_PALETTE, normalizarPaleta, salvarPaletaLocal, type AdminPalette } from "./adminAppearance";

/**
 * Aba GERAL de Configurações — reprodução pixel a pixel dos cards
 * clicáveis de Admin Configuracoes.dc.html (grid auto-fit minmax(330,1fr),
 * clique abre drawer lateral com os campos reais). A aparência (tema +
 * paleta de cores) não existe no ZIP como card próprio, mas é uma
 * funcionalidade real que precisa continuar acessível — foi adicionada
 * como um 5º card, no mesmo padrão visual dos outros 4.
 */

interface ConfiguracoesData extends Record<string, unknown> {
  id?: number;
  nome_clinica?: string;
  meta_orcamento_mensal?: number;
  frase_sonho?: string;
  pix_chave?: string;
  pix_qrcode_base64?: string;
  pix_desconto_percentual?: number;
  whatsapp_contato?: string;
  telefone_contato?: string;
  agenda_liberacao_financeira_bloqueada?: boolean;
  tema_cor_primaria?: string;
  tema_cor_secundaria?: string;
  tema_cor_destaque?: string;
  updated_at?: string;
}

type Feedback = { tone: "ok" | "error"; text: string } | null;
const MAX_QR = 1.5 * 1024 * 1024;
const DESCONTOS = [0, 5, 10, 15, 20, 25, 30];
type CardId = "company" | "identity" | "pix" | "prefs";

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body === "object" && body && "erro" in body && typeof body.erro === "string" ? body.erro : "Não foi possível concluir a operação.";
    throw new Error(message);
  }
  return body as T;
}

const fieldLabel: React.CSSProperties = { display: "block", fontSize: 10, fontWeight: 700, color: "var(--soft)", marginBottom: 4 };
const fieldInput: React.CSSProperties = { width: "100%", height: 34, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--ink)", padding: "0 10px", fontSize: 11.5, outline: "none" };

function Row({ l, v }: { l: string; v: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>{l}</span><span style={{ fontWeight: 600, maxWidth: "58%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span></div>;
}

export function AdminSettingsPanel() {
  const { theme, setTheme } = useTheme();
  const [config, setConfig] = useState<ConfiguracoesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [palette, setPalette] = useState<AdminPalette>(DEFAULT_ADMIN_PALETTE);
  const [drawer, setDrawer] = useState<CardId | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/configuracoes", { cache: "no-store", credentials: "include", signal: controller.signal })
      .then((response) => responseJson<{ configuracoes?: ConfiguracoesData }>(response))
      .then(({ configuracoes }) => {
        const next = configuracoes ?? {};
        setConfig(next);
        setPalette(normalizarPaleta({
          primary: typeof next.tema_cor_primaria === "string" ? next.tema_cor_primaria : undefined,
          accent: typeof next.tema_cor_secundaria === "string" ? next.tema_cor_secundaria : undefined,
          highlight: typeof next.tema_cor_destaque === "string" ? next.tema_cor_destaque : undefined,
        }));
      })
      .catch((error: unknown) => setFeedback({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível carregar as configurações." }))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  async function patchConfig(section: string, payload: Record<string, unknown>) {
    setSaving(section);
    setFeedback(null);
    try {
      const response = await fetch("/api/admin/configuracoes", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await responseJson<{ configuracoes?: ConfiguracoesData }>(response);
      if (data.configuracoes) setConfig(data.configuracoes);
      setFeedback({ tone: "ok", text: "Configurações salvas com sucesso." });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível salvar as configurações." });
    } finally {
      setSaving(null);
    }
  }

  function update<K extends keyof ConfiguracoesData>(key: K, value: ConfiguracoesData[K]) {
    setConfig((current) => ({ ...(current ?? {}), [key]: value }));
  }

  function selectQr(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setFeedback({ tone: "error", text: "Envie uma imagem válida para o QR Code." }); return; }
    if (file.size > MAX_QR) { setFeedback({ tone: "error", text: "A imagem deve ter no máximo 1,5 MB." }); return; }
    const reader = new FileReader();
    reader.onload = () => update("pix_qrcode_base64", String(reader.result ?? ""));
    reader.readAsDataURL(file);
  }

  async function saveAppearance() {
    const normalized = salvarPaletaLocal(palette);
    setPalette(normalized);
    await patchConfig("appearance", { temaCorPrimaria: normalized.primary, temaCorSecundaria: normalized.accent, temaCorDestaque: normalized.highlight });
  }

  if (loading && !config) return <div style={{ padding: 40, textAlign: "center", fontSize: 12, color: "var(--soft)" }}>Carregando configurações…</div>;

  const c = config ?? {};
  const cards: { id: CardId; icon: string; iconBg: string; iconColor: string; title: string; sub: string; rows: [string, string][] }[] = [
    { id: "company", icon: "⌂", iconBg: "var(--robg)", iconColor: "var(--bg)", title: "Perfil da empresa", sub: "Informações institucionais", rows: [["Empresa", String(c.nome_clinica ?? "Sra. Luck")], ["Telefone", String(c.telefone_contato ?? "—")], ["WhatsApp", String(c.whatsapp_contato ?? "—")]] },
    { id: "identity", icon: "◈", iconBg: "var(--gobg)", iconColor: "var(--gold)", title: "Aparência do painel", sub: "Tema e cores administrativas", rows: [["Tema", theme === "dark" ? "Escuro" : "Claro"], ["Cor principal", palette.primary], ["Destaque", palette.highlight]] },
    { id: "pix", icon: "Pix", iconBg: "var(--okbg)", iconColor: "var(--ok)", title: "Recebimentos · Chave PIX", sub: "Chave utilizada nas operações permitidas", rows: [["Chave", String(c.pix_chave || "Não configurada")], ["Desconto", `${Number(c.pix_desconto_percentual ?? 0)}%`], ["QR Code", c.pix_qrcode_base64 ? "Carregado" : "Não enviado"]] },
    { id: "prefs", icon: "⚙", iconBg: "var(--bluebg)", iconColor: "var(--blue)", title: "Preferências institucionais", sub: "Mensagem, fuso e moeda do sistema", rows: [["Mensagem executiva", String(c.frase_sonho || "Não configurada")], ["Fuso", "America/Sao_Paulo"], ["Moeda", "BRL"]] },
  ];

  return <div>
    {feedback && <div style={{ marginBottom: 12, borderRadius: 9, border: `1px solid ${feedback.tone === "ok" ? "var(--okbg)" : "var(--badbg)"}`, background: feedback.tone === "ok" ? "var(--okbg)" : "var(--badbg)", color: feedback.tone === "ok" ? "var(--ok)" : "var(--bad)", padding: "8px 12px", fontSize: 11 }}>{feedback.text}</div>}

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(330px,1fr))", gap: 12 }} className="zip-animate-fade-in">
      {cards.map((card) => <div key={card.id} onClick={() => setDrawer(card.id)} className="zip-row-hover" style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, padding: "15px 16px", boxShadow: "var(--panel-shadow)", cursor: "pointer", minHeight: 138 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: card.iconBg, display: "grid", placeItems: "center", color: card.iconColor, fontSize: card.icon.length > 1 ? 9 : 15, fontWeight: 800 }}>{card.icon}</div>
            <div><div style={{ fontSize: 13, fontWeight: 700 }}>{card.title}</div><div style={{ marginTop: 2, fontSize: 10.5, color: "var(--soft)" }}>{card.sub}</div></div>
          </div>
          <span style={{ color: "var(--soft)", fontSize: 13 }}>›</span>
        </div>
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>{card.rows.map(([l, v]) => <Row key={l} l={l} v={v} />)}</div>
      </div>)}
    </div>

    <div style={{ marginTop: 12, border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: 10 }}>
      <div style={{ width: 30, height: 30, borderRadius: 9, background: "var(--robg)", display: "grid", placeItems: "center", color: "var(--bg)", fontSize: 13, flex: "none" }}>i</div>
      <div><div style={{ fontSize: 12, fontWeight: 700 }}>Configurações enxutas por design</div><div style={{ marginTop: 3, fontSize: 11, color: "var(--soft)", lineHeight: 1.55 }}>Somente preferências já coerentes com a operação atual. Ajustes técnicos e integrações ficam separados nos tópicos próprios.</div></div>
    </div>

    {drawer && <>
      <div className="zip-animate-fade-in" style={{ position: "fixed", inset: 0, background: "var(--overlay-bg)", zIndex: 60 }} onClick={() => setDrawer(null)} />
      <aside className="zip-animate-slide-in" style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 61, width: "min(396px,100vw)", background: "var(--s0)", borderLeft: "1px solid var(--line)", boxShadow: "var(--sh)", overflowY: "auto" }}>
        <div style={{ padding: "14px 15px 12px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div><div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--rose)" }}>Configuração</div><h2 style={{ fontSize: 16, marginTop: 4, lineHeight: 1.25 }}>{cards.find((c2) => c2.id === drawer)?.title}</h2></div>
          <button onClick={() => setDrawer(null)} style={{ height: 28, width: 28, borderRadius: 8, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)", fontSize: 13 }}>✕</button>
        </div>

        {drawer === "company" && <div style={{ padding: "14px 15px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div><label style={fieldLabel}>Nome da empresa</label><input style={fieldInput} value={String(c.nome_clinica ?? "")} onChange={(e) => update("nome_clinica", e.target.value)} /></div>
          <div><label style={fieldLabel}>Telefone</label><input style={fieldInput} value={String(c.telefone_contato ?? "")} onChange={(e) => update("telefone_contato", e.target.value)} /></div>
          <div><label style={fieldLabel}>WhatsApp</label><input style={fieldInput} value={String(c.whatsapp_contato ?? "")} onChange={(e) => update("whatsapp_contato", e.target.value)} /></div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 7 }}><button onClick={() => setDrawer(null)} style={{ height: 32, padding: "0 12px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--soft)", fontSize: 11, fontWeight: 700 }}>Cancelar</button><button disabled={saving === "identity"} onClick={() => void patchConfig("identity", { nomeClinica: c.nome_clinica ?? "Sra. Luck", telefoneContato: c.telefone_contato ?? "", whatsappContato: c.whatsapp_contato ?? "", metaOrcamentoMensal: c.meta_orcamento_mensal ?? 0, fraseSonho: c.frase_sonho ?? "" })} style={{ height: 32, padding: "0 13px", border: "1px solid var(--bg)", borderRadius: 9, background: "var(--bg)", color: "var(--on-accent)", fontSize: 11, fontWeight: 700 }}>{saving === "identity" ? "Salvando…" : "Salvar alterações"}</button></div>
        </div>}

        {drawer === "identity" && <div style={{ padding: "14px 15px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={fieldLabel}>Tema</label>
            <div style={{ display: "flex", gap: 7 }}>
              <button onClick={() => setTheme("light")} style={{ flex: 1, height: 34, border: `1px solid ${theme === "light" ? "var(--bg)" : "var(--line)"}`, borderRadius: 9, background: theme === "light" ? "var(--robg)" : "var(--s0)", color: theme === "light" ? "var(--bg)" : "var(--ink)", fontSize: 11, fontWeight: 700 }}>☾ Claro</button>
              <button onClick={() => setTheme("dark")} style={{ flex: 1, height: 34, border: `1px solid ${theme === "dark" ? "var(--bg)" : "var(--line)"}`, borderRadius: 9, background: theme === "dark" ? "var(--robg)" : "var(--s0)", color: theme === "dark" ? "var(--bg)" : "var(--ink)", fontSize: 11, fontWeight: 700 }}>☀ Escuro</button>
            </div>
          </div>
          {([["primary", "Cor principal"], ["accent", "Cor secundária"], ["highlight", "Destaque"]] as const).map(([key, label]) => <div key={key}>
            <label style={fieldLabel}>{label}</label>
            <div style={{ display: "flex", gap: 7 }}>
              <input type="color" value={palette[key]} onChange={(e) => setPalette({ ...palette, [key]: e.target.value })} style={{ width: 34, height: 34, border: "1px solid var(--line)", borderRadius: 8, background: "var(--s0)" }} />
              <input style={{ ...fieldInput, flex: 1 }} value={palette[key]} onChange={(e) => setPalette({ ...palette, [key]: e.target.value })} />
            </div>
          </div>)}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 7 }}><button onClick={() => setPalette(DEFAULT_ADMIN_PALETTE)} style={{ height: 32, padding: "0 12px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--soft)", fontSize: 11, fontWeight: 700 }}>Restaurar padrão</button><button disabled={saving === "appearance"} onClick={() => void saveAppearance()} style={{ height: 32, padding: "0 13px", border: "1px solid var(--bg)", borderRadius: 9, background: "var(--bg)", color: "var(--on-accent)", fontSize: 11, fontWeight: 700 }}>{saving === "appearance" ? "Salvando…" : "Salvar aparência"}</button></div>
        </div>}

        {drawer === "pix" && <div style={{ padding: "14px 15px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div><label style={fieldLabel}>Chave PIX</label><input style={fieldInput} value={String(c.pix_chave ?? "")} onChange={(e) => update("pix_chave", e.target.value)} /></div>
          <div><label style={fieldLabel}>Desconto</label><select style={fieldInput} value={Number(c.pix_desconto_percentual ?? 0)} onChange={(e) => update("pix_desconto_percentual", Number(e.target.value))}>{DESCONTOS.map((v) => <option key={v} value={v}>{v === 0 ? "Sem desconto" : `${v}%`}</option>)}</select></div>
          <div>
            <label style={fieldLabel}>QR Code</label>
            {c.pix_qrcode_base64 ? <div style={{ display: "flex", alignItems: "center", gap: 10 }}><img src={String(c.pix_qrcode_base64)} alt="QR PIX" style={{ width: 56, height: 56, borderRadius: 8, border: "1px solid var(--line)" }} /><div style={{ display: "flex", gap: 6 }}><button onClick={() => fileRef.current?.click()} style={{ height: 30, padding: "0 10px", border: "1px solid var(--line)", borderRadius: 8, background: "var(--s0)", fontSize: 10, fontWeight: 700 }}>Trocar</button><button onClick={() => update("pix_qrcode_base64", "")} style={{ height: 30, padding: "0 10px", border: "1px solid var(--badbg)", borderRadius: 8, background: "var(--badbg)", color: "var(--bad)", fontSize: 10, fontWeight: 700 }}>Remover</button></div></div> : <button onClick={() => fileRef.current?.click()} style={{ width: "100%", height: 60, border: "1px dashed var(--line)", borderRadius: 10, background: "var(--s1)", fontSize: 11, fontWeight: 700, color: "var(--bg)" }}>+ Adicionar QR Code do PIX</button>}
            <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => selectQr(e.target.files?.[0] ?? null)} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}><button disabled={saving === "payments"} onClick={() => void patchConfig("payments", { pixChave: c.pix_chave ?? "", pixQrCodeBase64: c.pix_qrcode_base64 ?? "", pixDescontoPercentual: c.pix_desconto_percentual ?? 0, whatsappContato: c.whatsapp_contato ?? "", telefoneContato: c.telefone_contato ?? "" })} style={{ height: 32, padding: "0 13px", border: "1px solid var(--bg)", borderRadius: 9, background: "var(--bg)", color: "var(--on-accent)", fontSize: 11, fontWeight: 700 }}>{saving === "payments" ? "Salvando…" : "Salvar alterações"}</button></div>
        </div>}

        {drawer === "prefs" && <div style={{ padding: "14px 15px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div><label style={fieldLabel}>Mensagem executiva</label><textarea style={{ ...fieldInput, height: "auto", padding: 9 }} rows={4} value={String(c.frase_sonho ?? "")} onChange={(e) => update("frase_sonho", e.target.value)} /></div>
          <div><label style={fieldLabel}>Fuso horário</label><input style={fieldInput} value="America/Sao_Paulo" disabled /></div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}><button disabled={saving === "identity"} onClick={() => void patchConfig("identity", { nomeClinica: c.nome_clinica ?? "Sra. Luck", fraseSonho: c.frase_sonho ?? "" })} style={{ height: 32, padding: "0 13px", border: "1px solid var(--bg)", borderRadius: 9, background: "var(--bg)", color: "var(--on-accent)", fontSize: 11, fontWeight: 700 }}>{saving === "identity" ? "Salvando…" : "Salvar alterações"}</button></div>
        </div>}

      </aside>
    </>}
  </div>;
}
