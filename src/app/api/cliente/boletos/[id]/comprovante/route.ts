import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { CLIENTE_COOKIE_NAME, verificarTokenSessao } from "@/lib/session";

const BUCKET = "boletos-clientes";

async function sessaoCliente(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE_NAME)?.value;
  return verificarTokenSessao(token);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const sessao = await sessaoCliente(req);
  if (!sessao) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const supabase = createServiceSupabaseClient();
  const { data: boleto } = await supabase.from("boletos").select("cliente_id, comprovante_url").eq("id", params.id).single();
  if (!boleto || boleto.cliente_id !== sessao.clienteId || !boleto.comprovante_url) return NextResponse.json({ erro: "Comprovante não encontrado." }, { status: 404 });
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(boleto.comprovante_url, 60 * 5);
  if (error || !data?.signedUrl) return NextResponse.json({ erro: "Não foi possível gerar o link do comprovante." }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const sessao = await sessaoCliente(req);
  if (!sessao) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const supabase = createServiceSupabaseClient();
  const { data: boleto } = await supabase.from("boletos").select("id, cliente_id, comprovante_url, status").eq("id", params.id).single();
  if (!boleto || boleto.cliente_id !== sessao.clienteId) return NextResponse.json({ erro: "Boleto não encontrado." }, { status: 404 });
  if (!boleto.comprovante_url) return NextResponse.json({ erro: "Esta parcela não possui comprovante." }, { status: 404 });
  await supabase.from("boletos").update({ comprovante_url: null, status: "nao_pago", data_pagamento: null, observacoes: null }).eq("id", params.id);
  const { error } = await supabase.storage.from(BUCKET).remove([boleto.comprovante_url]);
  if (error) console.error("Erro ao remover arquivo do comprovante:", error);
  return NextResponse.json({ sucesso: true, status: "nao_pago" });
}
