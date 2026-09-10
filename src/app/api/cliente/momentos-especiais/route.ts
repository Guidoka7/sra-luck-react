import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { CLIENTE_COOKIE_NAME, verificarTokenSessao } from "@/lib/session";
import { enviarWebPushParaCliente } from "@/lib/webPush";

type Momento = "termos-amanha" | "termos-hoje" | "cirurgia-hoje";

function dataValida(valor: string | null | undefined) {
  return Boolean(valor && /^\d{4}-\d{2}-\d{2}$/.test(valor));
}

function diferencaEmDias(dataISO: string, hojeISO: string) {
  const [y, m, d] = dataISO.split("-").map(Number);
  const [hy, hm, hd] = hojeISO.split("-").map(Number);
  if (![y, m, d, hy, hm, hd].every(Number.isFinite)) return null;
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(hy, hm - 1, hd)) / 86400000);
}

function conteudo(momento: Momento, data: string) {
  const formatada = data.split("-").reverse().join("/");
  if (momento === "termos-amanha") return {
    titulo: "Amanhã é um dia especial 💗",
    mensagem: `Amanhã, ${formatada}, será a assinatura dos seus termos cirúrgicos. Prepare-se para essa etapa especial da sua jornada.`,
    emoji: "💗",
  };
  if (momento === "termos-hoje") return {
    titulo: "Hoje é o dia da sua assinatura ✨",
    mensagem: "Chegou o dia da assinatura dos seus termos cirúrgicos. Estamos felizes em acompanhar você nesta etapa tão importante.",
    emoji: "✨",
  };
  return {
    titulo: "Hoje é o grande dia! 🎉",
    mensagem: "Sua jornada chegou à conclusão. Hoje acontece a sua cirurgia e todo o caminho percorrido até aqui se concretiza.",
    emoji: "🎉",
  };
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE_NAME)?.value;
  const sessao = await verificarTokenSessao(token);
  if (!sessao) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const momento = body.momento as Momento;
  const dataEvento = body.dataEvento as string;
  if (!["termos-amanha", "termos-hoje", "cirurgia-hoje"].includes(momento) || !dataValida(dataEvento)) {
    return NextResponse.json({ erro: "Momento inválido." }, { status: 400 });
  }

  const supabase = createServiceSupabaseClient();
  const { data: agendamentos, error: agendaError } = await supabase
    .from("agendamentos")
    .select("id, status, horario_termos, previsao_liberacao_financeira, datas(data)")
    .eq("cliente_id", sessao.clienteId)
    .in("status", ["confirmado", "realizado"])
    .order("created_at", { ascending: false });
  if (agendaError) return NextResponse.json({ erro: agendaError.message }, { status: 500 });

  const agenda = (agendamentos ?? [])[0] as any;
  if (!agenda) return NextResponse.json({ ok: false, ignorado: true });
  const dataTermos = agenda.datas?.data as string | null | undefined;
  const dataLiberacao = agenda.previsao_liberacao_financeira as string | null | undefined;
  const testDate = req.cookies.get("sra_luck_test_date")?.value;
  const hoje = dataValida(testDate) ? testDate! : new Date().toISOString().slice(0, 10);
  const diffTermos = dataTermos ? diferencaEmDias(dataTermos, hoje) : null;
  const diffLiberacao = dataLiberacao ? diferencaEmDias(dataLiberacao, hoje) : null;
  const esperado: Momento | null = diffLiberacao === 0 ? "cirurgia-hoje" : diffTermos === 0 ? "termos-hoje" : diffTermos === 1 ? "termos-amanha" : null;
  if (esperado !== momento || dataEvento !== (momento === "cirurgia-hoje" ? dataLiberacao : dataTermos)) {
    return NextResponse.json({ ok: false, ignorado: true });
  }

  const { data: existente } = await supabase
    .from("notificacoes_cliente")
    .select("id")
    .eq("cliente_id", sessao.clienteId)
    .eq("tipo", `momento_${momento}`)
    .eq("referencia_id", agenda.id)
    .limit(1)
    .maybeSingle();
  if (existente) return NextResponse.json({ ok: true, duplicada: true, notificacaoId: existente.id });

  const texto = conteudo(momento, dataEvento);
  const { data: notificacao, error: insertError } = await supabase
    .from("notificacoes_cliente")
    .insert({
      cliente_id: sessao.clienteId,
      tipo: `momento_${momento}`,
      titulo: texto.titulo,
      mensagem: texto.mensagem,
      emoji: texto.emoji,
      destino: "agenda",
      referencia_id: agenda.id,
    })
    .select("id, cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id, created_at")
    .single();
  if (insertError) return NextResponse.json({ erro: insertError.message }, { status: 500 });

  try {
    await supabase.channel(`notificacoes-cliente:${sessao.clienteId}`).send({ type: "broadcast", event: "nova_notificacao", payload: notificacao });
  } catch {}

  let push = { enviadas: 0, falhas: 0, removidas: 0 };
  try {
    push = await enviarWebPushParaCliente(supabase, sessao.clienteId, {
      title: texto.titulo,
      body: texto.mensagem,
      url: "/agenda",
      tag: `momento-${momento}-${agenda.id}`,
      notificationId: notificacao.id,
    });
  } catch (error) {
    console.warn("Web Push do momento especial não disponível:", error);
  }

  return NextResponse.json({ ok: true, notificacaoId: notificacao.id, push });
}
