import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { enviarWebPushParaCliente } from "@/lib/webPush";

const DEFAULT_CONFIG = { atraso_habilitado: true, frequencia_atraso_horas: 24, max_tentativas: 3 };
function cronAuthorized(req: NextRequest) { const secret = process.env.NOTIFICACOES_CRON_SECRET; return Boolean(secret && req.headers.get("x-notificacoes-cron-secret") === secret); }
async function adminOrCron(req: NextRequest) { if (cronAuthorized(req)) return createServiceSupabaseClient(); const supabase = createServerSupabaseClient(); const { data: { user } } = await supabase.auth.getUser(); return user ? supabase : null; }
function renderTemplate(text: string, vars: Record<string, string | number>) { return Object.entries(vars).reduce((result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)), text); }
async function getConfig(supabase: any) { const { data } = await supabase.from("notificacoes_config").select("chave, valor, tipo"); const config: Record<string, any> = { ...DEFAULT_CONFIG }; for (const item of data ?? []) { if (item.tipo === "boolean") config[item.chave] = item.valor === "true"; else if (item.tipo === "number") config[item.chave] = Number(item.valor); else config[item.chave] = item.valor; } return config; }

async function runAtrasos(supabase: any, options: { ignorarIntervalo?: boolean } = {}) {
  const config = await getConfig(supabase); const ignorarIntervalo = options.ignorarIntervalo === true;
  if (!config.atraso_habilitado && !ignorarIntervalo) return { executado: true, habilitado: false, enviadas: 0, ignoradas: 0, falhas: 0, forcaram_envio: false };
  const frequenciaHoras = Math.max(1, Number(config.frequencia_atraso_horas || 24)); const limite = new Date(Date.now() - frequenciaHoras * 60 * 60 * 1000).toISOString();
  const [{ data: boletos, error: boletosError }, { data: templates, error: templatesError }] = await Promise.all([
    supabase.from("boletos").select("id, cliente_id, numero_parcela, total_parcelas, valor, data_vencimento, status, clientes(id, nome_completo, telefone)").eq("status", "nao_pago").lt("data_vencimento", new Date().toISOString().slice(0, 10)).order("data_vencimento", { ascending: true }),
    supabase.from("notificacao_templates").select("id, tipo, dias_referencia, titulo, corpo, emoji, is_active").eq("tipo", "parcela_atrasada").eq("is_active", true).order("dias_referencia", { ascending: true }),
  ]);
  if (boletosError) throw new Error(boletosError.message); if (templatesError) throw new Error(templatesError.message);
  const activeTemplates = (templates ?? []).filter((t: any) => Number(t.dias_referencia) > 0); let enviadas = 0; let ignoradas = 0; let falhas = 0;

  for (const boleto of boletos ?? []) {
    const diasAtraso = Math.max(1, Math.floor((Date.now() - new Date(`${boleto.data_vencimento}T00:00:00`).getTime()) / 86400000));
    const template = activeTemplates.filter((t: any) => Number(t.dias_referencia) <= diasAtraso).at(-1) ?? activeTemplates[0]; if (!template) continue;
    if (!ignorarIntervalo) { const { data: recente } = await supabase.from("notificacao_logs").select("id, created_at").eq("cliente_id", boleto.cliente_id).eq("tipo", "parcela_atrasada").eq("referencia_id", boleto.id).gte("created_at", limite).limit(1); if ((recente ?? []).length) { ignoradas++; continue; } }
    const cliente = boleto.clientes; const vars = { cliente: cliente?.nome_completo ?? "cliente", parcela: boleto.numero_parcela, total: boleto.total_parcelas, valor: Number(boleto.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), dias_atraso: diasAtraso, vencimento: new Date(`${boleto.data_vencimento}T00:00:00`).toLocaleDateString("pt-BR") };
    const titulo = renderTemplate(template.titulo, vars); const mensagem = renderTemplate(template.corpo, vars);
    try {
      const { data: notificacao, error } = await supabase.from("notificacoes_cliente").insert({ cliente_id: boleto.cliente_id, tipo: "parcela_atrasada", titulo, mensagem, emoji: template.emoji ?? "💳", destino: "pagamentos", referencia_id: boleto.id }).select("id, cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id, created_at").single();
      if (error) throw new Error(error.message);
      await supabase.from("notificacao_logs").insert({ cliente_id: boleto.cliente_id, notificacao_id: notificacao.id, referencia_id: boleto.id, tipo: "parcela_atrasada", titulo, corpo: mensagem, status: "enviada" });
      try { await supabase.channel(`notificacoes-cliente:${boleto.cliente_id}`).send({ type: "broadcast", event: "nova_notificacao", payload: notificacao }); } catch (realtimeError) { console.warn("Realtime da notificação não disponível:", realtimeError); }
      let push = { enviadas: 0, falhas: 0, removidas: 0 };
      try { push = await enviarWebPushParaCliente(createServiceSupabaseClient(), boleto.cliente_id, { title: titulo, body: mensagem, icon: "/icons/sra-luck-app-256.png", badge: "/icons/sra-luck-notification-badge.png", url: `/agenda?abrirComprovante=${encodeURIComponent(boleto.id)}`, tag: `parcela-atrasada-${boleto.id}`, notificationId: notificacao.id, installmentId: boleto.id, action: "upload_receipt" }); } catch (pushError) { console.warn("Web Push da cobrança não disponível:", pushError); }
      await supabase.from("notificacao_logs").update({ push_enviadas: push.enviadas, push_falhas: push.falhas, push_status: push.enviadas > 0 ? "enviada" : "sem_dispositivo" }).eq("notificacao_id", notificacao.id);
      enviadas++;
    } catch (error: any) { falhas++; await supabase.from("notificacao_logs").insert({ cliente_id: boleto.cliente_id, notificacao_id: null, referencia_id: boleto.id, tipo: "parcela_atrasada", status: "erro", erro_mensagem: error?.message ?? "Erro desconhecido" }); }
  }
  return { executado: true, habilitado: true, enviadas, ignoradas, falhas, frequencia_horas: frequenciaHoras, forcaram_envio: ignorarIntervalo };
}

function diferencaEmDias(dataISO: string, hojeISO: string) {
  const [y, m, d] = dataISO.split("-").map(Number); const [hy, hm, hd] = hojeISO.split("-").map(Number);
  if (![y, m, d, hy, hm, hd].every(Number.isFinite)) return null;
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(hy, hm - 1, hd)) / 86400000);
}

async function runMomentosEspeciais(supabase: any) {
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: agendamentos, error } = await supabase
    .from("agendamentos")
    .select("id, cliente_id, status, previsao_liberacao_financeira, created_at, datas(data)")
    .in("status", ["confirmado", "realizado"])
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const vistos = new Set<string>();
  let enviadas = 0; let ignoradas = 0; let falhas = 0;
  for (const agenda of agendamentos ?? []) {
    if (vistos.has(agenda.cliente_id)) continue;
    vistos.add(agenda.cliente_id);
    const dataTermos = agenda.datas?.data as string | null | undefined;
    const dataLiberacao = agenda.previsao_liberacao_financeira as string | null | undefined;
    const diffTermos = dataTermos ? diferencaEmDias(dataTermos, hoje) : null;
    const diffLiberacao = dataLiberacao ? diferencaEmDias(dataLiberacao, hoje) : null;
    let momento: "termos-amanha" | "termos-hoje" | "cirurgia-hoje" | null = null;
    let dataEvento: string | null = null;
    if (diffLiberacao === 0) { momento = "cirurgia-hoje"; dataEvento = dataLiberacao ?? null; }
    else if (diffTermos === 0) { momento = "termos-hoje"; dataEvento = dataTermos ?? null; }
    else if (diffTermos === 1) { momento = "termos-amanha"; dataEvento = dataTermos ?? null; }
    if (!momento || !dataEvento) continue;
    const tipo = `momento_${momento}`;
    const { data: existente } = await supabase.from("notificacoes_cliente").select("id").eq("cliente_id", agenda.cliente_id).eq("tipo", tipo).eq("referencia_id", agenda.id).limit(1).maybeSingle();
    if (existente) { ignoradas++; continue; }
    const formatada = dataEvento.split("-").reverse().join("/");
    const texto = momento === "termos-amanha" ? { titulo: "Amanhã é um dia especial 💗", mensagem: `Amanhã, ${formatada}, será a assinatura dos seus termos cirúrgicos. Prepare-se para essa etapa especial da sua jornada.`, emoji: "💗" } : momento === "termos-hoje" ? { titulo: "Hoje é o dia da sua assinatura ✨", mensagem: "Chegou o dia da assinatura dos seus termos cirúrgicos. Estamos felizes em acompanhar você nesta etapa tão importante.", emoji: "✨" } : { titulo: "Hoje é o grande dia! 🎉", mensagem: "Sua jornada chegou à conclusão. Hoje acontece a sua cirurgia e todo o caminho percorrido até aqui se concretiza.", emoji: "🎉" };
    try {
      const { data: notificacao, error: insertError } = await supabase.from("notificacoes_cliente").insert({ cliente_id: agenda.cliente_id, tipo, titulo: texto.titulo, mensagem: texto.mensagem, emoji: texto.emoji, destino: "agenda", referencia_id: agenda.id }).select("id, cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id, created_at").single();
      if (insertError) throw new Error(insertError.message);
      try { await supabase.channel(`notificacoes-cliente:${agenda.cliente_id}`).send({ type: "broadcast", event: "nova_notificacao", payload: notificacao }); } catch {}
      try { await enviarWebPushParaCliente(createServiceSupabaseClient(), agenda.cliente_id, { title: texto.titulo, body: texto.mensagem, url: "/agenda", tag: `momento-${momento}-${agenda.id}`, notificationId: notificacao.id }); } catch (pushError) { console.warn("Web Push do momento especial não disponível:", pushError); }
      enviadas++;
    } catch (error: any) {
      falhas++;
      console.warn("Falha ao criar notificação de momento especial:", error?.message ?? error);
    }
  }
  return { executado: true, enviadas, ignoradas, falhas, data: hoje };
}

export async function GET(req: NextRequest) { const supabase = await adminOrCron(req); if (!supabase) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 }); const config = await getConfig(supabase); const { data: logs } = await supabase.from("notificacao_logs").select("id, cliente_id, notificacao_id, tipo, titulo, corpo, status, erro_mensagem, created_at, clientes(nome_completo)").order("created_at", { ascending: false }).limit(200); const { data: templates } = await supabase.from("notificacao_templates").select("id, tipo, dias_referencia, titulo, corpo, emoji, is_active, updated_at").order("tipo").order("dias_referencia", { ascending: true }); const { data: clientes } = await supabase.from("clientes").select("id, nome_completo, telefone, ativo").eq("ativo", true).order("nome_completo"); const { count: atrasadas } = await supabase.from("boletos").select("id", { count: "exact", head: true }).eq("status", "nao_pago").lt("data_vencimento", new Date().toISOString().slice(0, 10)); return NextResponse.json({ config, logs: logs ?? [], templates: templates ?? [], clientes: clientes ?? [], atrasadas: atrasadas ?? 0 }); }

export async function PATCH(req: NextRequest) { const supabase = await adminOrCron(req); if (!supabase) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 }); const body = await req.json().catch(() => ({})); const allowed: Record<string, string> = { atraso_habilitado: "boolean", frequencia_atraso_horas: "number", max_tentativas: "number" }; for (const [chave, tipo] of Object.entries(allowed)) { if (!(chave in body)) continue; const value = body[chave]; if (tipo === "number" && (!Number.isFinite(Number(value)) || Number(value) < 1)) return NextResponse.json({ erro: `Valor inválido para ${chave}.` }, { status: 400 }); await supabase.from("notificacoes_config").upsert({ chave, valor: String(value), tipo }, { onConflict: "chave" }); } return NextResponse.json({ ok: true, config: await getConfig(supabase) }); }

export async function POST(req: NextRequest) { const supabase = await adminOrCron(req); if (!supabase) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 }); const body = await req.json().catch(() => ({})); if (!["verificar_atrasos", "enviar_agora_todas", "verificar_momentos_especiais"].includes(body.acao)) return NextResponse.json({ erro: "Ação inválida." }, { status: 400 }); try { if (body.acao === "verificar_momentos_especiais") return NextResponse.json(await runMomentosEspeciais(supabase)); const forcar = body.acao === "enviar_agora_todas"; return NextResponse.json(await runAtrasos(supabase, { ignorarIntervalo: forcar })); } catch (error: any) { return NextResponse.json({ erro: error?.message ?? "Falha ao executar a automação." }, { status: 500 }); } }
