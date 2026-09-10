import { FormEvent, useState } from "react";
import { apiJson } from "../lib/api";

function formatCpf(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  return digits.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

export function LoginPage() {
  const [cpf, setCpf] = useState("");
  const [nascimento, setNascimento] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setErro(null);
    setLoading(true);
    try {
      // O Worker cria a sessão em cookie HttpOnly. Não fazemos uma segunda
      // requisição antes da navegação, evitando uma corrida entre o Set-Cookie
      // da resposta de autenticação e a primeira leitura da sessão.
      await apiJson("/api/cliente/auth", {
        method: "POST",
        body: JSON.stringify({ cpf, dataNascimento: nascimento }),
      });
      window.location.replace("/agenda");
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível confirmar seus dados.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="client-login min-h-screen flex items-center justify-center bg-bloom px-6 py-10">
      <div className="relative flex w-full max-w-md flex-col items-center animate-fadeUp">
        <img src="/brand/sra-luck-logo.png" alt="Sra. Luck — Cirurgia Programada" className="mb-8 h-auto w-full max-w-[320px] object-contain" />
        <section className="surface-glass luxury-ring w-full rounded-3xl p-8 sm:p-9">
          <h1 className="mb-1 text-center text-2xl text-burgundy">Bem-vinda de volta</h1>
          <p className="mb-7 text-center text-sm leading-6 text-clay/60">Entre com seus dados para ver sua agenda.</p>
          <form onSubmit={submit} className="flex flex-col gap-5">
            <label className="block"><span className="mb-2 block text-[0.68rem] uppercase tracking-label text-burgundy/62">CPF</span><input className="w-full rounded-2xl border border-rose/20 bg-white/90 px-4 py-3 text-clay outline-none focus:ring-4 focus:ring-rose/12" inputMode="numeric" autoComplete="username" placeholder="000.000.000-00" value={cpf} maxLength={14} onChange={(e) => setCpf(formatCpf(e.target.value))} required /></label>
            <label className="block"><span className="mb-2 block text-[0.68rem] uppercase tracking-label text-burgundy/62">Data de nascimento</span><input className="w-full rounded-2xl border border-rose/20 bg-white/90 px-4 py-3 text-clay outline-none focus:ring-4 focus:ring-rose/12" type="date" autoComplete="bday" value={nascimento} onChange={(e) => setNascimento(e.target.value)} required /></label>
            {erro && <div role="alert" className="rounded-2xl border border-alert/20 bg-alert/5 px-4 py-3 text-sm text-alert">{erro}</div>}
            <button disabled={loading} className="mt-2 inline-flex items-center justify-center rounded-full bg-burgundy px-6 py-3 text-sm font-medium uppercase tracking-[0.18em] text-pearl transition hover:bg-burgundy-light disabled:cursor-not-allowed disabled:opacity-50" type="submit">{loading ? "Entrando…" : "Entrar"}</button>
          </form>
        </section>
        <p className="mt-6 text-center text-xs text-clay/40">Seus dados de acesso foram cadastrados pela nossa equipe.<br />Em caso de dúvida, fale conosco.</p>
      </div>
    </main>
  );
}
