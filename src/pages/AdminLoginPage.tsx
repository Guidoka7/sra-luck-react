import { useEffect, useState } from "react";

export function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/admin/session", { credentials: "same-origin", cache: "no-store" })
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
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim(), senha }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErro(body.erro || "Não foi possível entrar no painel administrativo.");
        return;
      }
      window.location.replace("/admin/visao-geral");
    } catch (error) {
      console.error("Falha no login administrativo:", error);
      setErro("Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-bloom px-6"><section className="surface-glass w-full max-w-md rounded-3xl p-8 luxury-ring"><div className="mb-7 text-center"><img src="/brand/sra-luck-mark.png" alt="Sra. Luck" className="mx-auto mb-4 h-12 w-12" /><p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-burgundy/45">Acesso restrito</p><h1 className="mt-1 text-2xl font-semibold text-burgundy">Painel administrativo</h1></div><form onSubmit={entrar} className="space-y-4"><label className="block"><span className="mb-1.5 block text-xs font-medium text-clay/70">E-mail</span><input className="w-full rounded-xl border border-rose/15 bg-white/70 px-4 py-3 text-sm outline-none focus:border-burgundy/40" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label><label className="block"><span className="mb-1.5 block text-xs font-medium text-clay/70">Senha</span><input className="w-full rounded-xl border border-rose/15 bg-white/70 px-4 py-3 text-sm outline-none focus:border-burgundy/40" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required /></label>{erro && <p role="alert" className="rounded-xl bg-rose/10 px-3 py-2 text-xs text-burgundy">{erro}</p>}<button disabled={loading} className="w-full rounded-full bg-burgundy px-5 py-3 text-xs font-semibold uppercase tracking-label text-pearl transition-opacity disabled:cursor-wait disabled:opacity-60" type="submit">{loading ? "Entrando…" : "Entrar"}</button></form></section></main>;
}
