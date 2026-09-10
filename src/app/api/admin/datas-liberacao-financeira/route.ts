import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Calendário PRÓPRIO da aba "Previsão de liberação financeira".
 * Independente da tabela `datas` (que é usada pela agenda de "Termos
 * cirúrgicos"): liberar um dia aqui não libera esse mesmo dia lá, e
 * vice-versa.
 *
 * Cada data liberada aqui comporta 1 liberação financeira por vez — assim
 * que uma cliente tem uma previsão confirmada nela, a data fica ocupada
 * (ver /api/admin/liberacao-inteligente).
 */

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ano = Number(searchParams.get("ano"));
  const mes = Number(searchParams.get("mes"));
  if (!ano || !mes) {
    return NextResponse.json({ erro: "Parâmetros obrigatórios: ano, mes" }, { status: 400 });
  }

  const inicioMes = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const proximoMes = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;

  const { data: datas, error } = await supabase
    .from("datas_liberacao_financeira")
    .select("*")
    .gte("data", inicioMes)
    .lt("data", proximoMes)
    .order("data", { ascending: true });

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  // Ocupação: previsões de liberação já confirmadas em agendamentos, que
  // caem dentro do mês exibido.
  const { data: liberacoesConfirmadas } = await supabase
    .from("agendamentos")
    .select("previsao_liberacao_financeira, valor_contrato, clientes(nome_completo)")
    .eq("status", "confirmado")
    .gte("previsao_liberacao_financeira", inicioMes)
    .lt("previsao_liberacao_financeira", proximoMes);

  type Ocupante = { nome: string; valor: number };
  const ocupantesPorData = new Map<string, Ocupante[]>();
  for (const item of liberacoesConfirmadas ?? []) {
    const dataOcupada = (item as any).previsao_liberacao_financeira as string | null;
    if (!dataOcupada) continue;
    const clienteInfo = Array.isArray((item as any).clientes) ? (item as any).clientes[0] : (item as any).clientes;
    const lista = ocupantesPorData.get(dataOcupada) ?? [];
    lista.push({ nome: clienteInfo?.nome_completo ?? "Cliente", valor: Number(item.valor_contrato) });
    ocupantesPorData.set(dataOcupada, lista);
  }

  const resultado = (datas ?? []).map((d) => {
    const clientes = ocupantesPorData.get(d.data) ?? [];
    return {
      ...d,
      vagasOcupadas: clientes.length,
      clientes,
    };
  });

  return NextResponse.json({ datas: resultado });
}

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const body = await req.json();
  if (!body.data) return NextResponse.json({ erro: "Informe a data." }, { status: 400 });

  const { data, error } = await supabase
    .from("datas_liberacao_financeira")
    .upsert(
      {
        data: body.data,
        status: "disponivel",
      },
      { onConflict: "data" }
    )
    .select("*")
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 400 });

  await supabase.from("logs_alteracoes").insert({
    usuario: user.email ?? "admin",
    acao: "liberou_data_liberacao_financeira",
    entidade: "datas_liberacao_financeira",
    entidade_id: data.id,
    detalhes: { data: body.data },
  });

  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dataSolicitada = searchParams.get("data");
  if (!dataSolicitada) {
    return NextResponse.json({ erro: "Informe a data." }, { status: 400 });
  }

  // Não permite fechar uma data que já tenha uma previsão confirmada.
  const { data: ocupacoes } = await supabase
    .from("agendamentos")
    .select("id, cliente_id")
    .eq("status", "confirmado")
    .eq("previsao_liberacao_financeira", dataSolicitada)
    .limit(1);

  if ((ocupacoes ?? []).length > 0) {
    return NextResponse.json(
      { erro: "Esta data já possui uma previsão confirmada e não pode ser fechada." },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from("datas_liberacao_financeira")
    .delete()
    .eq("data", dataSolicitada)
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ erro: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ erro: "Data não encontrada ou já estava fechada." }, { status: 404 });

  await supabase.from("logs_alteracoes").insert({
    usuario: user.email ?? "admin",
    acao: "fechou_data_liberacao_financeira",
    entidade: "datas_liberacao_financeira",
    entidade_id: data.id,
    detalhes: { data: dataSolicitada },
  });

  return NextResponse.json({ data });
}
