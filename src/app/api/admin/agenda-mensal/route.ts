import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { nomeMes } from "@/lib/utils";

interface LinhaAgendamento {
  id: string;
  valor_contrato: number;
  clientes: {
    nome_completo: string;
    consultora: string | null;
    status_financeiro: string;
    status_cirurgia: string;
  } | null;
  datas: { data: string } | null;
}

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const hoje = new Date();
  const ano = Number(searchParams.get("ano")) || hoje.getFullYear();
  const statusFinanceiro = searchParams.get("statusFinanceiro") ?? "";
  const statusProcesso = searchParams.get("statusProcesso") ?? "";
  const responsavel = searchParams.get("responsavel") ?? "";

  // -------- agendamentos confirmados do ano selecionado --------
  const { data: agendamentos, error } = await supabase
    .from("agendamentos")
    .select(
      "id, valor_contrato, clientes(nome_completo, consultora, status_financeiro, status_cirurgia), datas!inner(data)"
    )
    .eq("status", "confirmado")
    .gte("datas.data", `${ano}-01-01`)
    .lt("datas.data", `${ano + 1}-01-01`)
    .order("data", { ascending: true, foreignTable: "datas" });

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const linhas = (agendamentos ?? []) as unknown as LinhaAgendamento[];

  const bateFiltro = (linha: LinhaAgendamento) => {
    const c = linha.clientes;
    if (!c) return false;
    if (statusFinanceiro && c.status_financeiro !== statusFinanceiro) return false;
    if (statusProcesso && c.status_cirurgia !== statusProcesso) return false;
    if (responsavel && c.consultora !== responsavel) return false;
    return true;
  };

  const filtradas = linhas.filter(bateFiltro);

  const meses = Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    const clientesDoMes = filtradas.filter((l) => {
      const data = l.datas?.data;
      return data && Number(data.slice(5, 7)) === mes;
    });
    return {
      mes,
      nome: nomeMes(mes),
      total: clientesDoMes.length,
      clientes: clientesDoMes.map((l) => ({
        agendamentoId: l.id,
        nome: l.clientes?.nome_completo ?? "—",
        responsavel: l.clientes?.consultora ?? null,
        statusFinanceiro: l.clientes?.status_financeiro ?? "a_pagar",
        statusCirurgia: l.clientes?.status_cirurgia ?? "nao_agendada",
        valorContrato: l.valor_contrato,
        data: l.datas?.data ?? null,
      })),
    };
  });

  // -------- anos disponíveis (com base em todos os agendamentos confirmados) --------
  const { data: todasDatas } = await supabase
    .from("agendamentos")
    .select("datas!inner(data)")
    .eq("status", "confirmado");

  const anosSet = new Set<number>([hoje.getFullYear()]);
  for (const linha of (todasDatas ?? []) as unknown as { datas: { data: string } | null }[]) {
    if (linha.datas?.data) anosSet.add(Number(linha.datas.data.slice(0, 4)));
  }
  const anosDisponiveis = Array.from(anosSet).sort((a, b) => b - a);

  // -------- opções de filtro (a partir do cadastro de clientes) --------
  const { data: clientesTodas } = await supabase
    .from("clientes")
    .select("consultora");

  const responsaveis = Array.from(
    new Set((clientesTodas ?? []).map((c) => c.consultora).filter((v): v is string => !!v && v.trim() !== ""))
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  return NextResponse.json({
    ano,
    meses,
    anosDisponiveis,
    opcoesFiltro: {
      responsaveis,
    },
  });
}
