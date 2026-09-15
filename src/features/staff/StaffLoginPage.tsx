import { FormEvent, useState } from "react";
import { LockKeyhole, Mail, Users } from "lucide-react";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import "../../styles/staff-pwa.css";
import "../../styles/staff-login.css";

export function StaffLoginPage() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErro(null);
    setLoading(true);
    try {
      const response = await fetch("/api/equipe/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, senha, turnstileToken }),
      });
      const data = await response.json().catch(() => ({})) as { erro?: string };
      if (!response.ok) throw new Error(data.erro || "Não foi possível entrar.");
      window.location.href = "/equipe";
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="st-login-page">
      <section className="st-login-card">
        <img src="/brand/sra-luck-logo.png" alt="Sra. Luck" />
        <div className="st-login-icon"><Users size={22} /></div>
        <h1>Portal da equipe</h1>
        <p>Acesse seus treinamentos, metas, comissões e informações da sua função.</p>
        <form onSubmit={submit}>
          <label><span><Mail size={15}/>E-mail corporativo</span><input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} autoComplete="email" required /></label>
          <label><span><LockKeyhole size={15}/>Senha</span><input type="password" value={senha} onChange={(e)=>setSenha(e.target.value)} autoComplete="current-password" required /></label>
          <TurnstileWidget onToken={setTurnstileToken} />
          {erro && <div className="st-login-error">{erro}</div>}
          <button type="submit" disabled={loading}>{loading ? "Entrando..." : "Entrar no portal"}</button>
        </form>
        <small>Acessos são individuais, protegidos e gerenciados pela administração Sra. Luck.</small>
      </section>
    </main>
  );
}
