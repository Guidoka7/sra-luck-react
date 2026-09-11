import { useEffect, useState } from "react";
import { ThemeToggle } from "../components/ui/ThemeToggle";

function mensagemFalha(status: number, body: { erro?: string }): string {
  if (body.erro) return body.erro;
  if (status === 405) return "A API administrativa não foi publicada corretamente neste deployment. Abra a versão mais recente e tente novamente.";
  if (status === 503) return "O backend deste deployment ainda não está configurado para autenticação administrativa.";
  if (status === 401) return "E-mail ou senha inválidos.";
  if (status === 429) return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  return "Não foi possível entrar no painel administrativo.";
}

export function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);
  const isVercelPreview = window.location.hostname.toLowerCase().endsWith(".vercel.app");

  useEffect(() => {
    fetch("/api/admin/session", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (response.ok && body.autenticado) window.location.replace("/admin/visao-geral");
      })
      .catch(() => undefined);
  }, []);

  async function entrar(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setErro("");
    try {
      const response = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), senha }),
      });
      const body = await response.json().catch(() => ({})) as { ok?: boolean; erro?: string };
      if (!response.ok || !body.ok) {
        setErro(mensagemFalha(response.status, body));
        return;
      }
      window.location.replace("/admin/visao-geral");
    } catch {
      setErro("Não foi possível conectar ao servidor. Confira sua conexão e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-web-shell relative flex min-h-screen items-center justify-center bg-bloom px-6">
      <div className="absolute right-5 top-5"><ThemeToggle compact /></div>
      <section className="surface-glass w-full max-w-md rounded-3xl p-8 luxury-ring">
        <div className="mb-7 text-center">
          <img src="/brand/sra-luck-mark.png" alt="Sra. Luck" className="mx-auto mb-4 h-12 w-12" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-burgundy/45">Acesso restrito</p>
          <h1 className="mt-1 text-2xl font-semibold text-burgundy dark:text-pearl">Painel administrativo</h1>
        </div>
        <form onSubmit={entrar} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-clay/70 dark:text-pearl/65">E-mail</span>
            <input className="w-full rounded-xl border border-rose/15 bg-white/70 px-4 py-3 text-sm outline-none focus:border-burgundy/40 dark:border-white/10 dark:bg-white/[0.05] dark:text-pearl" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-clay/70 dark:text-pearl/65">Senha</span>
            <input className="w-full rounded-xl border border-rose/15 bg-white/70 px-4 py-3 text-sm outline-none focus:border-burgundy/40 dark:border-white/10 dark:bg-white/[0.05] dark:text-pearl" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required />
          </label>
          {erro && <p role="alert" className="rounded-xl bg-rose/10 px-3 py-2 text-xs text-burgundy dark:text-rose">{erro}</p>}
          <button disabled={loading} className="w-full rounded-full bg-burgundy px-5 py-3 text-xs font-semibold uppercase tracking-label text-pearl transition-opacity disabled:cursor-wait disabled:opacity-60" type="submit">
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>
        {isVercelPreview && (
          <div className="mt-6 border-t border-rose/15 pt-5 text-center dark:border-white/10">
            <p className="mb-3 text-xs leading-5 text-clay/55 dark:text-pearl/50">Quer apenas conferir o visual do painel sem usar uma conta administrativa?</p>
            <a href="/admin/visao-geral?preview=1" className="inline-flex w-full items-center justify-center rounded-full border border-burgundy/20 bg-white/70 px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-burgundy dark:border-white/10 dark:bg-white/[0.04] dark:text-pearl">Abrir demonstração</a>
          </div>
        )}
      </section>
    </main>
  );
}
