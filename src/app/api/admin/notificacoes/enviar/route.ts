import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { enviarWebPushParaCliente } from "@/lib/webPush";

function canalNotificacoesCliente(clienteId: string) {
  return `notificacoes-cliente:${clienteId}`;
}

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { clienteId, titulo, mensagem } = body as { clienteId?: string; titulo?: string; mensagem?: string; };
  if (!clienteId) return NextResponse.json({ erro: "Selecione uma cliente." }, { status: 400 });
  if (!titulo?.trim()) return NextResponse.json({ erro: "Informe um título." }, { status: 400 });
  if (!mensagem?.trim()) return NextResponse.json({ erro: "Informe uma mensagem." }, { status: 400 });

  const { data: cliente } = await supabase.from("clientes").select("id, nome_completo").eq("id", clienteId).single();
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrada." }, { status: 404 });

  const { data: notificacao, error } = await supabase.from("notificacoes_cliente").insert({
    cliente_id: clienteId,
    tipo: "manual",
    titulo: titulo.trim(),
    mensagem: mensagem.trim(),
    emoji: "📬",
    destino: "agenda",
  }).select("id, tipo, titulo, mensagem, emoji, destino, referencia_id, created_at").single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const serviceClient = createServiceSupabaseClient();
  const { error: logError } = await serviceClient.from("notificacao_logs").insert({
    cliente_id: clienteId,
    notificacao_id: notificacao.id,
    tipo: "manual",
    titulo: notificacao.titulo,
    corpo: notificacao.mensagem,
    status: "enviada",
  });
  if (logError) console.error("Falha ao gravar log de notificação manual:", logError.message);

  await supabase.from("logs_alteracoes").insert({
    usuario: user.email ?? "admin",
    acao: "enviou_notificacao_manual",
    entidade: "notificacoes_cliente",
    entidade_id: notificacao.id,
    detalhes: { cliente: cliente.nome_completo, titulo: notificacao.titulo, mensagem: notificacao.mensagem },
  });

  try {
    await serviceClient.channel(canalNotificacoesCliente(clienteId)).send({ type: "broadcast", event: "nova_notificacao", payload: notificacao });
  } catch (erro) {
    console.error("Falha ao publicar notificação manual em tempo real:", erro);
  }

  let push: { enviadas: number; falhas: number; removidas: number; erros?: string[] } = { enviadas: 0, falhas: 0, removidas: 0 };
  let pushErroFatal: string | null = null;
  try {
    push = await enviarWebPushParaCliente(serviceClient, clienteId, {
      title: notificacao.titulo,
      body: notificacao.mensagem,
      icon: "/icons/sra-luck-app-256.png",
      badge: "/icons/sra-luck-notification-badge.png",
      url: "/agenda",
      tag: `notificacao-${notificacao.id}`,
      notificationId: notificacao.id,
    });
  } catch (erro: any) {
    pushErroFatal = erro?.message ?? String(erro);
    console.error("Falha ao enviar Web Push manual:", erro);
  }
  const pushStatus = push.enviadas > 0 ? "enviada" : (pushErroFatal ? "erro" : (push.removidas > 0 || push.falhas > 0 ? "falhou" : "sem_dispositivo"));
  await serviceClient.from("notificacao_logs").update({
    push_enviadas: push.enviadas,
    push_falhas: push.falhas,
    push_status: pushStatus,
    erro_mensagem: pushErroFatal ?? push.erros?.join(" | ") ?? null,
  }).eq("notificacao_id", notificacao.id);

  return NextResponse.json({ notificacao, cliente: { id: cliente.id, nome: cliente.nome_completo }, push });
}
