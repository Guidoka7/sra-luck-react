import { FormEvent, useState } from "react";
import { LockKeyhole, Mail, Users } from "lucide-react";
import { requestJson } from "../../lib/http";
import "../../styles/staff-pwa.css";
import "../../styles/staff-login.css";

export function StaffLoginPage() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErro(null);
    setLoading(true);
    try {
      await requestJson<{ ok?: boolean }>("/api/equipe/auth", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), senha }),
      }, { timeoutMs: 10_000 });
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
          <label><span><Mail size={15}/>E-mail corporativo</span><input type="email" maxLength={320} value={email} onChange={(e)=>setEmail(e.target.value)} autoComplete="email" required /></label>
          <label><span><LockKeyhole size={15}/>Senha</span><input type="password" maxLength={1024} value={senha} onChange={(e)=>setSenha(e.target.value)} autoComplete="current-password" required /></label>
          {erro && <div className="st-login-error">{erro}</div>}
          <button type="submit" disabled={loading}>{loading ? "Entrando..." : "Entrar no portal"}</button>
        </form>
        <small>Acessos são criados e gerenciados pela administração Sra. Luck.</small>
      </section>
    </main>
  );
}
