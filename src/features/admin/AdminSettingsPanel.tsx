import { useEffect, useRef, useState } from "react";
import {
  Bell, Building2, CalendarClock, CheckCircle2, ImagePlus, Lock, MessageCircle, MonitorCog, Moon,
  Palette, Phone, QrCode, Save, ShieldCheck, Sun, Trash2, Unlock, UploadCloud, WalletCards,
} from "lucide-react";
import { useTheme } from "../../components/ui/ThemeProvider";
import { DEFAULT_ADMIN_PALETTE, normalizarPaleta, salvarPaletaLocal, type AdminPalette } from "./adminAppearance";

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

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body === "object" && body && "erro" in body && typeof body.erro === "string" ? body.erro : "Não foi possível concluir a operação.";
    throw new Error(message);
  }
  return body as T;
}

export function AdminSettingsPanel() {
  const { theme, setTheme } = useTheme();
  const [config, setConfig] = useState<ConfiguracoesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [palette, setPalette] = useState<AdminPalette>(DEFAULT_ADMIN_PALETTE);
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
      const response = await fetch("/api/admin/configuracoes", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
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
    await patchConfig("appearance", {
      temaCorPrimaria: normalized.primary,
      temaCorSecundaria: normalized.accent,
      temaCorDestaque: normalized.highlight,
    });
  }

  if (loading && !config) {
    return <div className="sl-settings-loading">Carregando configurações…</div>;
  }

  const c = config ?? {};
  const updated = c.updated_at ? new Date(c.updated_at).toLocaleString("pt-BR") : "—";
  const locked = Boolean(c.agenda_liberacao_financeira_bloqueada);

  return (
    <div className="sl-settings-page">
      <div className="sl-module-heading">
        <div>
          <span>Configurações</span>
          <h1>Central de controle</h1>
          <p>Identidade, aparência, pagamentos, agenda e preferências operacionais sem perder nenhuma função anterior.</p>
        </div>
        <div className="sl-module-status"><CheckCircle2 size={16} /> Atualizado {updated}</div>
      </div>

      {feedback && <div className={`sl-feedback ${feedback.tone}`}>{feedback.text}</div>}

      <div className="sl-settings-grid">
        <section className="sl-card sl-settings-card sl-settings-wide">
          <div className="sl-settings-title"><div className="sl-settings-icon"><Palette size={18} /></div><div><h2>Aparência do painel</h2><p>Modo claro/escuro e cores da identidade administrativa.</p></div></div>
          <div className="sl-theme-choice">
            <button type="button" className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}><Sun size={18} /><strong>Claro</strong><span>Visual leve e institucional</span></button>
            <button type="button" className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}><Moon size={18} /><strong>Escuro</strong><span>Menos brilho em ambientes noturnos</span></button>
          </div>
          <div className="sl-color-grid">
            <label><span>Cor principal</span><div><input type="color" value={palette.primary} onChange={(e) => { const next = { ...palette, primary: e.target.value }; setPalette(next); salvarPaletaLocal(next); }} /><input value={palette.primary} onChange={(e) => setPalette({ ...palette, primary: e.target.value })} /></div></label>
            <label><span>Cor secundária</span><div><input type="color" value={palette.accent} onChange={(e) => { const next = { ...palette, accent: e.target.value }; setPalette(next); salvarPaletaLocal(next); }} /><input value={palette.accent} onChange={(e) => setPalette({ ...palette, accent: e.target.value })} /></div></label>
            <label><span>Destaque</span><div><input type="color" value={palette.highlight} onChange={(e) => { const next = { ...palette, highlight: e.target.value }; setPalette(next); salvarPaletaLocal(next); }} /><input value={palette.highlight} onChange={(e) => setPalette({ ...palette, highlight: e.target.value })} /></div></label>
          </div>
          <div className="sl-settings-actions"><button type="button" onClick={() => { setPalette(DEFAULT_ADMIN_PALETTE); salvarPaletaLocal(DEFAULT_ADMIN_PALETTE); }}>Restaurar padrão Sra. Luck</button><button type="button" className="primary" disabled={saving === "appearance"} onClick={() => void saveAppearance()}><Save size={15} /> {saving === "appearance" ? "Salvando…" : "Salvar aparência"}</button></div>
        </section>

        <section className="sl-card sl-settings-card">
          <div className="sl-settings-title"><div className="sl-settings-icon"><Building2 size={18} /></div><div><h2>Identidade & planejamento</h2><p>Informações institucionais e limite orçamentário.</p></div></div>
          <label className="sl-field"><span>Nome da empresa</span><input value={String(c.nome_clinica ?? "Sra. Luck")} onChange={(e) => update("nome_clinica", e.target.value)} /></label>
          <label className="sl-field"><span>Limite orçamentário mensal</span><input type="number" min="0" step="0.01" value={Number(c.meta_orcamento_mensal ?? 0)} onChange={(e) => update("meta_orcamento_mensal", Number(e.target.value))} /></label>
          <label className="sl-field"><span>Mensagem executiva</span><textarea value={String(c.frase_sonho ?? "")} onChange={(e) => update("frase_sonho", e.target.value)} /></label>
          <button type="button" className="sl-save-button" disabled={saving === "identity"} onClick={() => void patchConfig("identity", { nomeClinica: c.nome_clinica ?? "Sra. Luck", metaOrcamentoMensal: c.meta_orcamento_mensal ?? 0, fraseSonho: c.frase_sonho ?? "" })}><Save size={15} /> {saving === "identity" ? "Salvando…" : "Salvar identidade"}</button>
        </section>

        <section className="sl-card sl-settings-card">
          <div className="sl-settings-title"><div className="sl-settings-icon"><CalendarClock size={18} /></div><div><h2>Agenda financeira</h2><p>Controle global das liberações sem alterar agendamentos já confirmados.</p></div></div>
          <div className={`sl-agenda-state ${locked ? "locked" : "open"}`}>
            <div>{locked ? <Lock size={20} /> : <ShieldCheck size={20} />}</div>
            <strong>{locked ? "Agenda pausada" : "Agenda ativa"}</strong>
            <span>{locked ? "Novas liberações estão temporariamente bloqueadas." : "O fluxo de liberações está disponível normalmente."}</span>
          </div>
          <button type="button" className={`sl-save-button ${locked ? "" : "danger"}`} disabled={saving === "agenda"} onClick={() => void patchConfig("agenda", { agendaLiberacaoFinanceiraBloqueada: !locked })}>
            {locked ? <Unlock size={15} /> : <Lock size={15} />} {saving === "agenda" ? "Atualizando…" : locked ? "Reabrir agenda" : "Pausar agenda"}
          </button>
        </section>

        <section className="sl-card sl-settings-card sl-settings-wide">
          <div className="sl-settings-title"><div className="sl-settings-icon"><WalletCards size={18} /></div><div><h2>Pagamento & contato</h2><p>Restaura PIX, desconto e canais exibidos para a cliente.</p></div></div>
          <div className="sl-settings-two">
            <label className="sl-field"><span>Chave PIX</span><input value={String(c.pix_chave ?? "")} onChange={(e) => update("pix_chave", e.target.value)} /></label>
            <label className="sl-field"><span>Desconto PIX</span><select value={Number(c.pix_desconto_percentual ?? 0)} onChange={(e) => update("pix_desconto_percentual", Number(e.target.value))}>{DESCONTOS.map((value) => <option key={value} value={value}>{value === 0 ? "Sem desconto" : `${value}% de desconto`}</option>)}</select></label>
            <label className="sl-field"><span><Phone size={14} /> Telefone</span><input value={String(c.telefone_contato ?? "")} onChange={(e) => update("telefone_contato", e.target.value)} /></label>
            <label className="sl-field"><span><MessageCircle size={14} /> WhatsApp</span><input value={String(c.whatsapp_contato ?? "")} onChange={(e) => update("whatsapp_contato", e.target.value)} /></label>
          </div>
          <div className="sl-qr-box">
            {c.pix_qrcode_base64 ? <><img src={String(c.pix_qrcode_base64)} alt="QR Code PIX" /><div><strong>QR Code carregado</strong><span>Imagem exibida na área de pagamento da cliente.</span><div><button type="button" onClick={() => fileRef.current?.click()}><UploadCloud size={14} /> Trocar</button><button type="button" onClick={() => update("pix_qrcode_base64", "")}><Trash2 size={14} /> Remover</button></div></div></> : <button type="button" className="sl-qr-empty" onClick={() => fileRef.current?.click()}><span><QrCode size={20} /></span><div><strong>Adicionar QR Code do PIX</strong><small>PNG, JPG ou WEBP · até 1,5 MB</small></div><ImagePlus size={18} /></button>}
            <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => selectQr(e.target.files?.[0] ?? null)} />
          </div>
          <div className="sl-settings-actions"><button type="button" className="primary" disabled={saving === "payments"} onClick={() => void patchConfig("payments", { pixChave: c.pix_chave ?? "", pixQrCodeBase64: c.pix_qrcode_base64 ?? "", pixDescontoPercentual: c.pix_desconto_percentual ?? 0, whatsappContato: c.whatsapp_contato ?? "", telefoneContato: c.telefone_contato ?? "" })}><Save size={15} /> {saving === "payments" ? "Salvando…" : "Salvar pagamento e contato"}</button></div>
        </section>

        <section className="sl-card sl-settings-card">
          <div className="sl-settings-title"><div className="sl-settings-icon"><Bell size={18} /></div><div><h2>Notificações</h2><p>Automações, templates, envio manual e histórico.</p></div></div>
          <div className="sl-settings-link-copy">A configuração completa continua disponível e foi restaurada no módulo de Notificações.</div>
          <button type="button" className="sl-save-button" onClick={() => { window.history.pushState({}, "", "/admin/notificacoes"); window.dispatchEvent(new Event("app:navigate")); }}><Bell size={15} /> Abrir central de notificações</button>
        </section>

        <section className="sl-card sl-settings-card">
          <div className="sl-settings-title"><div className="sl-settings-icon"><MonitorCog size={18} /></div><div><h2>Segurança & monitoramento</h2><p>Auditoria, sessões, webhooks e saúde operacional.</p></div></div>
          <ul className="sl-security-list"><li><ShieldCheck size={15} /> Sessões administrativas protegidas</li><li><ShieldCheck size={15} /> Auditoria de ações críticas</li><li><ShieldCheck size={15} /> Validação de webhooks</li><li><ShieldCheck size={15} /> Rate limit de autenticação</li></ul>
        </section>
      </div>
    </div>
  );
}
