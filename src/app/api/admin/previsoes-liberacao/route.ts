import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Regra padrão do negócio: a previsão de liberação financeira é 90 dias
 * corridos após a data escolhida para assinatura dos termos.
 *
 * A sugestão é automática no painel, mas continua editável pelo admin para
 * atender alterações solicitadas pela cliente. A data efetivamente salva é
 * a que o admin confirmar.
 */
function adicionarDias(dataIso: string | null, dias: number): string | null {
  if (!dataIso) return null;
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  if (!ano || !mes || !dia) return null;
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function respostaNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return respostaNoStore({ erro: "Não autenticado." }, 401);

  const { searchParams } = new URL(req.url);
  const ano = Number(searchParams.get("ano"));
  const mes = Number(searchParams.get("mes"));

  const inicioMes = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const proximoMes = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;

  const { data: config } = await supabase
    .from("configuracoes")
    .select("meta_orcamento_mensal")
    .eq("id", 1)
    .single();

  const { data: agendamentos, error } = await supabase
    .from("agendamentos")
    .select(
      "id, valor_contrato, previsao_liberacao_financeira, clientes(id, nome_completo), datas(data)"
    )
    .eq("status", "confirmado");

  if (error) return respostaNoStore({ erro: error.message }, 500);

  type Linha = {
    agendamentoId: string;
    clienteId: string | null;
    nome: string;
    valor: number;
    dataTermos: string | null;
  };

  const comPrevisaoNoMes = new Map<string, Linha[]>();
  const semPrevisao: (Linha & { previsaoSugerida: string | null })[] = [];
  const todosClientes: {
    agendamentoId: string;
    clienteId: string | null;
    nome: string;
    dataTermos: string | null;
    previsaoAtual: string | null;
    previsaoSugerida: string | null;
  }[] = [];
  let totalPrevistoMes = 0;

  for (const item of agendamentos ?? []) {
    const linha: Linha = {
      agendamentoId: item.id,
      clienteId: (item as any).clientes?.id ?? null,
      nome: (item as any).clientes?.nome_completo ?? "Cliente",
      valor: Number(item.valor_contrato),
      dataTermos: (item as any).datas?.data ?? null,
    };
    const previsaoAtual = (item.previsao_liberacao_financeira as string | null) ?? null;
    const previsaoSugerida = adicionarDias(linha.dataTermos, 90);

    todosClientes.push({
      agendamentoId: linha.agendamentoId,
      clienteId: linha.clienteId,
      nome: linha.nome,
      dataTermos: linha.dataTermos,
      previsaoAtual,
      previsaoSugerida,
    });

    // Regra da interface: enquanto não houver uma previsão efetivamente
    // cadastrada, a cliente permanece em "Aguardando previsão". Assim que
    // o admin confirmar uma data, ela deixa esta lista automaticamente.
    if (!previsaoAtual) {
      semPrevisao.push({ ...linha, previsaoSugerida });
      continue;
    }

    const data = previsaoAtual;
    if (data >= inicioMes && data < proximoMes) {
      totalPrevistoMes += linha.valor;
      const lista = comPrevisaoNoMes.get(data) ?? [];
      lista.push(linha);
      comPrevisaoNoMes.set(data, lista);
    }
  }

  todosClientes.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  semPrevisao.sort((a, b) => (a.dataTermos ?? "").localeCompare(b.dataTermos ?? ""));

  const diasComPrevisao = Array.from(comPrevisaoNoMes.entries())
    .map(([data, clientes]) => ({
      data,
      valorTotal: clientes.reduce((soma, c) => soma + c.valor, 0),
      clientes,
    }))
    .sort((a, b) => a.data.localeCompare(b.data));

  return respostaNoStore({
    meta: config?.meta_orcamento_mensal ?? 100000,
    totalPrevistoMes,
    diasComPrevisao,
    semPrevisao,
    todosClientes,
  });
}
