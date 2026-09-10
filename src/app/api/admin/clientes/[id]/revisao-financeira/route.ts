import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

const FORMAS = ["cartao", "pix", "cheques", "boleto_100"] as const;
type Forma = (typeof FORMAS)[number];
const TAXA_PADRAO_CARTAO = 5.4;

async function avisarCliente(clienteId: string, mensagem: string) {
  try {
    const supabase = createServiceSupabaseClient();
    await supabase.channel(`notificacoes-cliente:${clienteId}`).send({ type: "broadcast", event: "nova_notificacao", payload: { mensagem, tipo: "financeiro" } });
  } catch {}
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = createServerSupabaseClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const decisao = body.decisao as string | undefined;
  const observacao = typeof body.observacao === "string" ? body.observacao.trim() : null;
  if (!decisao || !["aprovada", "recusada"].includes(decisao)) return NextResponse.json({ erro: "Decisão inválida. Use 'aprovada' ou 'recusada'." }, { status: 400 });

  const adminDb = createServiceSupabaseClient();
  const { data: cliente } = await adminDb.from("clientes").select("id, nome_completo, status_revisao_financeira, quantidade_parcelas").eq("id", params.id).single();
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrada." }, { status: 404 });
  if (cliente.status_revisao_financeira !== "pendente") return NextResponse.json({ erro: "Essa cliente não está com uma revisão financeira pendente no momento." }, { status: 409 });

  if (decisao === "recusada") {
    const { data, error } = await adminDb.from("clientes").update({ status_revisao_financeira: "recusada", observacao_revisao_financeira: observacao || null }).eq("id", params.id).select("id, nome_completo, status_revisao_financeira").single();
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    await adminDb.from("logs_alteracoes").insert({ usuario: user.email ?? "admin", acao: "recusou_revisao_financeira", entidade: "clientes", entidade_id: params.id, detalhes: { cliente: cliente.nome_completo, observacao: observacao || null } });
    await avisarCliente(params.id, "Seu levantamento financeiro precisa de uma revisão. Confira o aplicativo.");
    return NextResponse.json({ cliente: data });
  }

  const saldoRestanteRaw = Number(body.saldoRestante);
  const formas = Array.isArray(body.formasCusteio) ? body.formasCusteio.filter((f: unknown): f is Forma => typeof f === "string" && FORMAS.includes(f as Forma)) : [];
  if (!Number.isFinite(saldoRestanteRaw) || saldoRestanteRaw < 0) return NextResponse.json({ erro: "Informe um saldo restante válido." }, { status: 400 });
  if (formas.length === 0) return NextResponse.json({ erro: "Selecione pelo menos uma forma de custeio." }, { status: 400 });
  const saldoRestante = Math.round(saldoRestanteRaw * 100) / 100;
  const taxaCartao = formas.includes("cartao") ? Math.max(0, Number(body.taxaCartao ?? TAXA_PADRAO_CARTAO)) : 0;
  const totalComTaxa = Math.round((saldoRestante * (1 + taxaCartao / 100)) * 100) / 100;

  const { data, error } = await adminDb.from("clientes").update({ status_revisao_financeira: "aprovada", observacao_revisao_financeira: observacao || null, financeiro_saldo_restante: saldoRestante, financeiro_taxa_cartao: taxaCartao, financeiro_total_com_taxa: totalComTaxa, financeiro_formas_custeio: formas, financeiro_confirmado_em: new Date().toISOString() }).eq("id", params.id).select("id, nome_completo, status_revisao_financeira, financeiro_saldo_restante, financeiro_taxa_cartao, financeiro_total_com_taxa, financeiro_formas_custeio, financeiro_confirmado_em").single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  await adminDb.from("logs_alteracoes").insert({ usuario: user.email ?? "admin", acao: "aprovou_revisao_financeira", entidade: "clientes", entidade_id: params.id, detalhes: { cliente: cliente.nome_completo, saldoRestante, taxaCartao, totalComTaxa, formasCusteio: formas, observacao: observacao || null } });
  await avisarCliente(params.id, "Seu levantamento financeiro foi confirmado. Sua agenda já está liberada.");
  return NextResponse.json({ cliente: data, agendaLiberada: true });
}
