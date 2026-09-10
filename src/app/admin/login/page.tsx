"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClientSupabaseClient } from "@/lib/supabase/client";
import { Wordmark } from "@/components/ui/Logo";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClientSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setLoading(false);
    if (error) { toast.error("E-mail ou senha incorretos."); return; }
    router.push("/admin/agenda");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bloom px-6">
      <div className="flex w-full max-w-md flex-col items-center animate-fadeUp">
        <Wordmark className="mb-7" />
        <Card className="w-full p-8 sm:p-9">
          <h1 className="mb-1 text-center text-2xl text-burgundy">Painel administrativo</h1>
          <p className="mb-7 text-center text-sm text-clay/60">Acesso restrito à equipe.</p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div><Label htmlFor="email">E-mail</Label><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <div><Label htmlFor="senha">Senha</Label><Input id="senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required /></div>
            <Button type="submit" loading={loading} className="mt-2 w-full">Entrar</Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
