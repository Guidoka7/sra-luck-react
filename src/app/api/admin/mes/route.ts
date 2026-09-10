import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ano = Number(searchParams.get("ano"));
  const mes = Number(searchParams.get("mes"));

  const { data: orcamento, error: errOrc } = await supabase.rpc("orcamento_do_mes", {
    p_ano: ano,
    p_mes: mes,
  });
  if (errOrc) return NextResponse.json({ erro: errOrc.message }, { status: 500 });

  const { data: config } = await supabase
    .from("configuracoes")
    .select("meta_orcamento_mensal, nome_clinica")
    .eq("id", 1)
    .single();

  const inicioMes = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const proximoMes = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;

  const { data: agendamentosDoMes } = await supabase
    .from("agendamentos")
    .select("id, valor_contrato, status, clientes(nome_completo), datas!inner(data)")
    .eq("status", "confirmado")
    .gte("datas.data", inicioMes)
    .lt("datas.data", proximoMes);

  return NextResponse.json({
    orcamentoAtual: orcamento ?? 0,
    meta: config?.meta_orcamento_mensal ?? 100000,
    nomeClinica: config?.nome_clinica ?? "Sra. Luck",
    agendamentos: agendamentosDoMes ?? [],
  });
}
