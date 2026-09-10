import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { verificarTokenSessao, CLIENTE_COOKIE_NAME } from "@/lib/session";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  const token = cookies().get(CLIENTE_COOKIE_NAME)?.value;
  const sessao = await verificarTokenSessao(token);
  if (!sessao) return NextResponse.json({ erro: "Sessão da cliente inválida." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const endpoint = body?.endpoint;
  if (!endpoint) return NextResponse.json({ erro: "Endpoint ausente." }, { status: 400 });
  const service = createServiceSupabaseClient();
  await service.from("web_push_subscriptions").delete().eq("cliente_id", sessao.clienteId).eq("endpoint", endpoint);
  return NextResponse.json({ ok: true });
}
