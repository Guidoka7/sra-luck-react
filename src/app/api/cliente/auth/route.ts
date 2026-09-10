import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { apenasDigitos } from "@/lib/cpf";
import { criarTokenSessao, CLIENTE_COOKIE_NAME, CLIENTE_COOKIE_MAX_AGE } from "@/lib/session";

const MAX_TENTATIVAS = 8;
const JANELA_SEGUNDOS = 15 * 60;

async function gerarChaveRateLimit(req: NextRequest): Promise<string> {
  const ip = req.headers.get("x-real-ip")?.trim()
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  const secret = process.env.CLIENTE_SESSION_SECRET;
  if (!secret) throw new Error("CLIENTE_SESSION_SECRET não configurada no .env.local");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const assinatura = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`login:${ip}`));
  return Buffer.from(assinatura).toString("base64url");
}

export async function POST(req: NextRequest) {
  let body: { cpf?: string; dataNascimento?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const { cpf, dataNascimento } = body;
  if (!cpf || !dataNascimento) {
    return NextResponse.json({ erro: "Preencha CPF e data de nascimento." }, { status: 400 });
  }

  const cpfLimpo = apenasDigitos(cpf);
  if (cpfLimpo.length !== 11 || !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
    return NextResponse.json({ erro: "CPF ou data de nascimento inválidos." }, { status: 401 });
  }

  const supabase = createServiceSupabaseClient();
  const rateLimitKey = await gerarChaveRateLimit(req);
  const { data: podeTentar, error: rateLimitError } = await supabase.rpc("login_pode_tentar", {
    p_chave: rateLimitKey,
    p_max_falhas: MAX_TENTATIVAS,
    p_janela_segundos: JANELA_SEGUNDOS,
  });

  if (rateLimitError) {
    console.error("Falha no rate limit do login:", rateLimitError);
    return NextResponse.json({ erro: "Não foi possível validar o acesso agora. Tente novamente em instantes." }, { status: 503 });
  }

  if (!Boolean(podeTentar)) {
    return NextResponse.json({ erro: "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente." }, { status: 429 });
  }

  const { data: cliente, error } = await supabase
    .from("clientes")
    .select("id, ativo")
    .eq("cpf", cpfLimpo)
    .eq("data_nascimento", dataNascimento)
    .maybeSingle();

  if (error || !cliente) {
    await supabase.rpc("login_registrar_falha", {
      p_chave: rateLimitKey,
      p_max_falhas: MAX_TENTATIVAS,
      p_janela_segundos: JANELA_SEGUNDOS,
    });
    return NextResponse.json(
      { erro: "CPF ou data de nascimento não encontrados. Confira os dados ou fale com a clínica." },
      { status: 401 }
    );
  }

  if (!cliente.ativo) {
    await supabase.rpc("login_registrar_falha", {
      p_chave: rateLimitKey,
      p_max_falhas: MAX_TENTATIVAS,
      p_janela_segundos: JANELA_SEGUNDOS,
    });
    return NextResponse.json(
      { erro: "Seu acesso está temporariamente indisponível. Fale com a clínica." },
      { status: 403 }
    );
  }

  await supabase.rpc("login_limpar_rate_limit", { p_chave: rateLimitKey });

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
