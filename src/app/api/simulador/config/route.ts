import { NextResponse } from "next/server";

// O simulador de iPhone (public/simulador-iphone.html) é um HTML estático,
// fora do bundle do Next.js, então não tem acesso direto às variáveis
// NEXT_PUBLIC_*. Essa rota só devolve o que já é público por natureza (URL
// do projeto Supabase + chave anon, a mesma que já vai pro navegador em
// qualquer página do app) — nunca a service_role.
export async function GET() {
  return NextResponse.json({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
  });
}
