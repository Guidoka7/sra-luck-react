import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const clienteId = url.searchParams.get("cliente_id");

  let query = supabase
    .from("boletos")
    .select(
      `id, cliente_id, numero_parcela, total_parcelas, valor, status,
       data_vencimento, comprovante_url, data_pagamento, observacoes, created_at, updated_at,
       clientes ( id, nome_completo, cpf )`
    )
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (clienteId) query = query.eq("cliente_id", clienteId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  return NextResponse.json({
    boletos: (data ?? []).map((b) => ({ ...b, valor: Number(b.valor) })),
  });
}
