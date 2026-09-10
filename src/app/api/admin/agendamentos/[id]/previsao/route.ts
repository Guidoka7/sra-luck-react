import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { enviarWebPushParaCliente } from "@/lib/webPush";
import { formatarDataLonga } from "@/lib/utils";

function adicionarDias(dataIso: string | null, dias: number): string | null { if (!dataIso) return null; const [ano, mes, dia] = dataIso.split("-").map(Number); if (!ano || !mes || !dia) return null; const data = new Date(Date.UTC(ano, mes - 1, dia)); data.setUTCDate(data.getUTCDate() + dias); return data.toISOString().slice(0, 10); }
function canalNotificacoesCliente(clienteId: string) { return `notificacoes-cliente:${clienteId}`; }
const ACOES_PREVISAO = ["definiu_previsao_liberacao_financeira", "alterou_previsao_liberacao_financeira"] as const;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  const body = await req.json().catch(() => ({})); const campoFoiEnviado = Object.prototype.hasOwnProperty.call(body, "previsaoLiberacaoFinanceira"); const previsaoRecebida = body.previsaoLiberacaoFinanceira as string | null | undefined;
  const { data: agendamento } = await supabase.from("agendamentos").select("id, cliente_id, previsao_liberacao_financeira, clientes(nome_completo), datas(data)").eq("id", params.id).single();
  if (!agendamento) return NextResponse.json({ erro: "Agendamento não encontrado." }, { status: 404 });
  const dataTermos = (agendamento as any).datas?.data ?? null; const previsaoSugerida = adicionarDias(dataTermos, 90); const dataAnterior = (agendamento as any).previsao_liberacao_financeira ?? null; const dataNova = campoFoiEnviado ? (previsaoRecebida || null) : previsaoSugerida;
  if (!dataNova) return NextResponse.json({ erro: "Não foi possível calcular a previsão: a assinatura dos termos ainda não possui uma data." }, { status: 400 });
  const { data, error } = await supabase.from("agendamentos").update({ previsao_liberacao_financeira: dataNova }).eq("id", params.id).select("id, previsao_liberacao_financeira").single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  const alteradoEm = new Date().toISOString(); const alterouRegraPadrao = Boolean(previsaoSugerida && dataNova !== previsaoSugerida);
  await supabase.from("logs_alteracoes").insert({ usuario: user.email ?? "admin", acao: dataAnterior ? "alterou_previsao_liberacao_financeira" : "definiu_previsao_liberacao_financeira", entidade: "agendamentos", entidade_id: params.id, detalhes: { cliente: (agendamento as any).clientes?.nome_completo, data_termos: dataTermos, regra_padrao_dias: 90, data_sugerida_90_dias: previsaoSugerida, data_anterior: dataAnterior, data_nova: dataNova, alteracao_manual: alterouRegraPadrao, alterado_em: alteradoEm } });

  if (dataNova && dataNova !== dataAnterior) {
    const dataFormatada = formatarDataLonga(dataNova); const clienteId = (agendamento as any).cliente_id as string;
    const { data: notificacao, error: erroNotificacao } = await supabase.from("notificacoes_cliente").insert({ cliente_id: clienteId, tipo: dataAnterior ? "previsao_atualizada" : "previsao_criada", titulo: dataAnterior ? "Previsão de liberação atualizada" : "Nova etapa da sua jornada", mensagem: dataAnterior ? `Sua previsão de liberação financeira foi atualizada para ${dataFormatada}.` : `Sua previsão de liberação financeira foi definida para ${dataFormatada}.`, emoji: "🔔", destino: "agenda", referencia_id: params.id }).select("id, tipo, titulo, mensagem, emoji, destino, referencia_id, created_at").single();
    const serviceClient = createServiceSupabaseClient();
    if (!erroNotificacao && notificacao) await serviceClient.from("notificacao_logs").insert({ cliente_id: clienteId, notificacao_id: notificacao.id, referencia_id: params.id, tipo: notificacao.tipo, titulo: notificacao.titulo, corpo: notificacao.mensagem, status: "enviada" });
    if (!erroNotificacao && notificacao) {
      try { await serviceClient.channel(canalNotificacoesCliente(clienteId)).send({ type: "broadcast", event: "nova_notificacao", payload: notificacao }); } catch (erro) { console.error("Falha ao publicar notificação em tempo real:", erro); }
      let push = { enviadas: 0, falhas: 0, removidas: 0 };
      try { push = await enviarWebPushParaCliente(serviceClient, clienteId, { title: notificacao.titulo, body: notificacao.mensagem, icon: "/icons/sra-luck-app-256.png", badge: "/icons/sra-luck-notification-badge.png", url: "/agenda", tag: `previsao-${notificacao.id}`, notificationId: notificacao.id }); } catch (erro) { console.error("Falha ao enviar Web Push da previsão:", erro); }
      await serviceClient.from("notificacao_logs").update({ push_enviadas: push.enviadas, push_falhas: push.falhas, push_status: push.enviadas > 0 ? "enviada" : "sem_dispositivo" }).eq("notificacao_id", notificacao.id);
    }
  }
  return NextResponse.json({ agendamento: data, dataAnterior, dataNova, dataTermos, previsaoSugerida, alteracaoManual: alterouRegraPadrao, alteradoEm });
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  const { data, error } = await supabase.from("logs_alteracoes").select("id, usuario, acao, detalhes, created_at").eq("entidade", "agendamentos").eq("entidade_id", params.id).in("acao", ACOES_PREVISAO).order("created_at", { ascending: false }).limit(10);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  const historico = (data ?? []).map((log) => ({ id: log.id, usuario: log.usuario, dataAnterior: (log.detalhes as any)?.data_anterior ?? null, dataNova: (log.detalhes as any)?.data_nova ?? null, alteradoEm: (log.detalhes as any)?.alterado_em ?? log.created_at }));
  return NextResponse.json({ historico });
}
