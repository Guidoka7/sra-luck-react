import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { apenasDigitos } from "@/lib/cpf";
import { criarTokenSessao, CLIENTE_COOKIE_NAME, CLIENTE_COOKIE_MAX_AGE } from "@/lib/session";

export async function POST(req: NextRequest) {
  const { cpf, dataNascimento } = await req.json();

  if (!cpf || !dataNascimento) {
    return NextResponse.json({ erro: "Preencha CPF e data de nascimento." }, { status: 400 });
  }

  const cpfLimpo = apenasDigitos(cpf);
  const supabase = createServiceSupabaseClient();

  const { data: cliente, error } = await supabase
    .from("clientes")
    .select("id, ativo")
    .eq("cpf", cpfLimpo)
    .eq("data_nascimento", dataNascimento)
    .maybeSingle();

  if (error || !cliente) {
    return NextResponse.json(
      { erro: "CPF ou data de nascimento não encontrados. Confira os dados ou fale com a clínica." },
      { status: 401 }
    );
  }

  if (!cliente.ativo) {
    return NextResponse.json(
      { erro: "Seu acesso está temporariamente indisponível. Fale com a clínica." },
      { status: 403 }
    );
  }

  const token = await criarTokenSessao(cliente.id);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(CLIENTE_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: CLIENTE_COOKIE_MAX_AGE,
    path: "/",
  });
  return response;
}
