"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Wordmark } from "@/components/ui/Logo";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { formatarCpf } from "@/lib/cpf";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export default function LoginClientePage() {
  const router = useRouter();
  const [cpf, setCpf] = useState("");
  const [nascimento, setNascimento] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/cliente/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cpf, dataNascimento: nascimento }) });
      const data = await res.json();
      if (!res.ok) { toast.error(data.erro ?? "Não foi possível confirmar seus dados."); return; }
      router.push("/agenda");
      router.refresh();
    } catch { toast.error("Erro de conexão. Tente novamente."); }
    finally { setLoading(false); }
  }

  return (
    <main className="client-login min-h-screen flex items-center justify-center bg-bloom px-6 pt-[calc(env(safe-area-inset-top)+2rem)] pb-[calc(env(safe-area-inset-bottom)+2rem)]">
      <div className="relative flex w-full max-w-md flex-col items-center animate-fadeUp">
        <div className="absolute right-0 top-0"><ThemeToggle compact /></div>
        <Wordmark className="mb-8" />
        <Card className="w-full p-8 sm:p-9">
          <h1 className="mb-1 text-center text-2xl text-burgundy">Bem-vinda de volta</h1>
          <p className="mb-7 text-center text-sm leading-6 text-clay/60">Entre com seus dados para ver sua agenda.</p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div><Label htmlFor="cpf">CPF</Label><Input id="cpf" inputMode="numeric" placeholder="000.000.000-00" value={cpf} maxLength={14} onChange={(e) => setCpf(formatarCpf(e.target.value))} required /></div>
            <div><Label htmlFor="nascimento">Data de nascimento</Label><Input id="nascimento" type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} required /></div>
            <Button type="submit" loading={loading} className="mt-2 w-full">Entrar</Button>
          </form>
        </Card>
        <p className="mt-6 text-center text-xs text-clay/40">Seus dados de acesso foram cadastrados pela nossa equipe.<br />Em caso de dúvida, fale conosco.</p>
      </div>
    </main>
  );
}
