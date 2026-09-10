import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenAdmin } from "./session";

const ADMIN_COOKIE = "admin_session";

type Json = Record<string, any>;
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
async function admin(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  return verificarTokenAdmin(getCookie(request, ADMIN_COOKIE), env.CLIENTE_SESSION_SECRET);
}
async function body(request: Request): Promise<Json> {
  try { return await request.json(); } catch { return {}; }
}

export async function handleAdminPanel(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/admin/") || url.pathname === "/api/admin/auth" || url.pathname === "/api/admin/session" || url.pathname === "/api/admin/logout" || url.pathname === "/api/admin/visao-geral") return null;
  const session = await admin(request, env);
  if (!session) return json({ erro: "Sessão administrativa expirada." }, 401);
  const db = createServiceSupabaseClient(env);
  const path = url.pathname;

  if (path === "/api/admin/clientes" && request.method === "GET") {
    const { data, error } = await db.from("clientes").select("id,nome_completo,cpf,data_nascimento,telefone,email,procedimento,medico,hospital,consultora,valor_contrato,taxa_administrativa_percentual,status_cirurgia,status_financeiro,observacoes_internas,quantidade_parcelas,status_revisao_financeira,data_atingiu_percentual,observacao_revisao_financeira,financeiro_saldo_restante,financeiro_taxa_cartao,financeiro_total_com_taxa,financeiro_formas_custeio,financeiro_confirmado_em,custeio_confirmado_em,ativo,created_at,updated_at").order("created_at", { ascending: false });
    if (error) return json({ erro: error.message }, 500);
    const { data: boletos } = await db.from("boletos").select("cliente_id,status");
    const { data: agendamentos } = await db.from("agendamentos").select("cliente_id,status,horario_termos,termos_assinados_em,datas(data)").in("status", ["confirmado", "realizado"]);
    const resumo = new Map<string, { total: number; pagos: number }>();
    for (const b of boletos ?? []) { const r = resumo.get(b.cliente_id) ?? { total: 0, pagos: 0 }; r.total++; if (b.status === "pago") r.pagos++; resumo.set(b.cliente_id, r); }
    const agenda = new Map<string, any>();
    for (const a of (agendamentos ?? []) as any[]) { const d = Array.isArray(a.datas) ? a.datas[0]?.data : a.datas?.data; const old = agenda.get(a.cliente_id); if (!old || (a.status === "realizado" && old.status === "confirmado")) agenda.set(a.cliente_id, { data: d ?? null, horario: a.horario_termos ? String(a.horario_termos).slice(0,5) : null, termosAssinadosEm: a.termos_assinados_em ?? null, status: a.status }); }
    return json({ clientes: (data ?? []).map((c: any) => { const r = resumo.get(c.id); const a = agenda.get(c.id); return { ...c, porcentagem_pagamento: r?.total ? Math.round(r.pagos / r.total * 1000) / 10 : null, parcelas_pagas: r?.pagos ?? null, parcelas_total: r?.total ?? null, termos_assinados_em: a?.termosAssinadosEm ?? null, proximo_agendamento_data: a?.status === "confirmado" ? a.data : null, proximo_agendamento_horario: a?.status === "confirmado" ? a.horario : null }; }) });
  }

  if (path === "/api/admin/clientes" && request.method === "POST") {
    const b = await body(request); const cpf = String(b.cpf ?? "").replace(/\D/g, "");
    if (!b.nomeCompleto || cpf.length !== 11 || !b.dataNascimento) return json({ erro: "Nome, CPF e data de nascimento são obrigatórios." }, 400);
    const { data, error } = await db.from("clientes").insert({ nome_completo: b.nomeCompleto, cpf, data_nascimento: b.dataNascimento, telefone: b.telefone || null, email: b.email || null, procedimento: b.procedimento || null, medico: b.medico || null, hospital: b.hospital || null, consultora: b.consultora || null, valor_contrato: Number(b.valorContrato) || 0, taxa_administrativa_percentual: Number(b.taxaAdministrativaPercentual) || 0, observacoes_internas: b.observacoes || null, ativo: b.ativo !== false, status_cirurgia: "nao_agendada", status_financeiro: "a_pagar" }).select("*").single();
    if (error) return json({ erro: error.code === "23505" ? "Já existe uma cliente cadastrada com esse CPF." : error.message }, 400);
    return json({ cliente: data });
  }

  const clienteMatch = path.match(/^\/api\/admin\/clientes\/([^/]+)$/);
  if (clienteMatch && request.method === "PATCH") {
    const b = await body(request); const id = decodeURIComponent(clienteMatch[1]); const patch: Json = {};
    const map: Record<string,string> = { nomeCompleto:"nome_completo", cpf:"cpf", dataNascimento:"data_nascimento", telefone:"telefone", email:"email", procedimento:"procedimento", medico:"medico", hospital:"hospital", consultora:"consultora", valorContrato:"valor_contrato", taxaAdministrativaPercentual:"taxa_administrativa_percentual", observacoes:"observacoes_internas", ativo:"ativo" };
    for (const [from,to] of Object.entries(map)) if (b[from] !== undefined) patch[to] = from === "cpf" ? String(b[from]).replace(/\D/g, "") : b[from];
    const { data, error } = await db.from("clientes").update(patch).eq("id", id).select("*").single();
    if (error) return json({ erro: error.message }, 400); return json({ cliente: data });
  }

  const clienteBoletos = path.match(/^\/api\/admin\/clientes\/([^/]+)\/boletos$/);
  if (clienteBoletos) {
    const clienteId = decodeURIComponent(clienteBoletos[1]);
    if (request.method === "GET") { const { data, error } = await db.from("boletos").select("id,cliente_id,numero_parcela,total_parcelas,valor,status,data_vencimento,comprovante_url,data_pagamento,observacoes,created_at,updated_at").eq("cliente_id", clienteId).order("numero_parcela", { ascending: true }); if (error) return json({ erro: error.message }, 500); return json({ boletos: (data ?? []).map((x:any)=>({...x,valor:Number(x.valor)})) }); }
    const b = await body(request);
    if (request.method === "POST") { const { data: cliente } = await db.from("clientes").select("valor_contrato,quantidade_parcelas,taxa_administrativa_percentual").eq("id", clienteId).maybeSingle(); const total = Number(b.totalParcelas ?? cliente?.quantidade_parcelas ?? 1); const valor = Number(b.valor ?? ((Number(cliente?.valor_contrato ?? 0) * (1 + Number(cliente?.taxa_administrativa_percentual ?? 0)/100)) / Math.max(total,1))); const rows = Array.from({length: Math.max(1,total)},(_,i)=>({cliente_id:clienteId,numero_parcela:i+1,total_parcelas:total,valor,data_vencimento:b.dataVencimento ?? null,status:"pendente"})); const { data,error }=await db.from("boletos").insert(rows).select("*"); if(error)return json({erro:error.message},400); return json({boletos:data}); }
    if (request.method === "PATCH") { const id=b.boletoId; if(!id)return json({erro:"Boleto não informado."},400); const patch:any={}; if(b.valor!==undefined)patch.valor=Number(b.valor); if(b.dataVencimento!==undefined)patch.data_vencimento=b.dataVencimento||null; if(b.status!==undefined)patch.status=b.status; const {data,error}=await db.from("boletos").update(patch).eq("id",id).eq("cliente_id",clienteId).select("*").single(); if(error)return json({erro:error.message},400); return json({boleto:data}); }
  }

  const clienteParcelas = path.match(/^\/api\/admin\/clientes\/([^/]+)\/parcelas$/);
  if (clienteParcelas && (request.method === "GET" || request.method === "POST")) {
    const clienteId=decodeURIComponent(clienteParcelas[1]);
    if(request.method==="GET"){const {data,error}=await db.from("boletos").select("id,cliente_id,numero_parcela,total_parcelas,valor,status,data_vencimento,data_pagamento,observacoes").eq("cliente_id",clienteId).order("numero_parcela",{ascending:true});if(error)return json({erro:error.message},500);return json({parcelas:data??[],boletos:data??[]});}
    const b=await body(request); if(b.acao==="editar"&&b.boletoId){const patch:any={};if(b.valor!==undefined)patch.valor=Number(b.valor);if(b.dataVencimento!==undefined)patch.data_vencimento=b.dataVencimento||null;const {data,error}=await db.from("boletos").update(patch).eq("id",b.boletoId).eq("cliente_id",clienteId).select("*").single();if(error)return json({erro:error.message},400);return json({boleto:data});}
  }

  if (path === "/api/admin/boletos" && request.method === "GET") { let q=db.from("boletos").select("id,cliente_id,numero_parcela,total_parcelas,valor,status,data_vencimento,comprovante_url,data_pagamento,observacoes,created_at,updated_at,clientes(id,nome_completo,cpf)").order("created_at",{ascending:false}); const status=url.searchParams.get("status");const clienteId=url.searchParams.get("cliente_id");if(status)q=q.eq("status",status);if(clienteId)q=q.eq("cliente_id",clienteId);const {data,error}=await q;if(error)return json({erro:error.message},500);return json({boletos:(data??[]).map((x:any)=>({...x,valor:Number(x.valor)}))}); }
  if (path === "/api/admin/boletos/lote" && request.method === "PATCH") { const b=await body(request);const ids=Array.isArray(b.ids)?b.ids:[];if(!ids.length)return json({erro:"Nenhum boleto selecionado."},400);const {data,error}=await db.from("boletos").update({status:b.status??"pago",data_pagamento:b.dataPagamento??new Date().toISOString().slice(0,10)}).in("id",ids).select("*");if(error)return json({erro:error.message},400);return json({boletos:data??[]}); }

  if (path === "/api/admin/datas" && request.method === "GET") { const ano=Number(url.searchParams.get("ano"));const mes=Number(url.searchParams.get("mes"));let q=db.from("datas").select("id,data,status,vagas_totais").order("data",{ascending:true});if(ano&&mes)q=q.gte("data",`${ano}-${String(mes).padStart(2,"0")}-01`).lt("data",`${mes===12?ano+1:ano}-${String(mes===12?1:mes+1).padStart(2,"0")}-01`);const {data,error}=await q;if(error)return json({erro:error.message},500);const ids=(data??[]).map((x:any)=>x.id);let ag:any[]=[];if(ids.length){const r=await db.from("agendamentos").select("data_id,cliente_id,status").in("data_id",ids).eq("status","confirmado");ag=r.data??[];}const counts=new Map<string,number>();for(const a of ag)counts.set(a.data_id,(counts.get(a.data_id)??0)+1);return json({datas:(data??[]).map((x:any)=>({...x,vagasOcupadas:counts.get(x.id)??0}))}); }
  if (path === "/api/admin/datas" && request.method === "POST") { const b=await body(request);if(!b.data)return json({erro:"Data obrigatória."},400);const {data,error}=await db.from("datas").insert({data:b.data,vagas_totais:Number(b.vagasTotais??1),status:"disponivel"}).select("*").single();if(error)return json({erro:error.code==="23505"?"Esta data já está liberada.":error.message},400);return json({data}); }
  const dataMatch=path.match(/^\/api\/admin\/datas\/([^/]+)$/);if(dataMatch&&(request.method==="PATCH"||request.method==="DELETE")){const id=decodeURIComponent(dataMatch[1]);if(request.method==="DELETE"){const {error}=await db.from("datas").delete().eq("id",id);if(error)return json({erro:error.message},400);return json({ok:true});}const b=await body(request);const patch:any={};if(b.status!==undefined)patch.status=b.status;if(b.vagasTotais!==undefined)patch.vagas_totais=Math.max(Number(b.vagasTotais),0);const {data,error}=await db.from("datas").update(patch).eq("id",id).select("*").single();if(error)return json({erro:error.message},400);return json({data});}

  if (path === "/api/admin/configuracoes") { if(request.method==="GET"){const {data,error}=await db.from("configuracoes").select("*").maybeSingle();if(error)return json({erro:error.message},500);return json({configuracoes:data??{}});} if(request.method==="PATCH"){const b=await body(request);const {data:old}=await db.from("configuracoes").select("id").maybeSingle();const patch:any={};if(b.nomeClinica!==undefined)patch.nome_clinica=b.nomeClinica;if(b.metaOrcamentoMensal!==undefined)patch.meta_orcamento_mensal=Number(b.metaOrcamentoMensal);if(b.fraseSonho!==undefined)patch.frase_sonho=b.fraseSonho;if(b.agendaLiberacaoFinanceiraBloqueada!==undefined)patch.agenda_liberacao_financeira_bloqueada=Boolean(b.agendaLiberacaoFinanceiraBloqueada);const result=old?.id?await db.from("configuracoes").update(patch).eq("id",old.id).select("*").single():await db.from("configuracoes").insert(patch).select("*").single();if(result.error)return json({erro:result.error.message},400);return json({configuracoes:result.data});} }

  if (path === "/api/admin/clientes-agendamentos" && request.method === "GET") {const {data,error}=await db.from("agendamentos").select("id,cliente_id,status,horario_termos,termos_assinados_em,datas(id,data,status),clientes(id,nome_completo,cpf)").order("created_at",{ascending:false});if(error)return json({erro:error.message},500);return json({agendamentos:data??[]});}
  if (path === "/api/admin/agenda-mensal" && request.method === "GET") {const ano=Number(url.searchParams.get("ano"))||new Date().getFullYear();const {data,error}=await db.from("agendamentos").select("id,cliente_id,status,horario_termos,datas(data),clientes(nome_completo)").gte("datas.data",`${ano}-01-01`).lt("datas.data",`${ano+1}-01-01`).order("created_at",{ascending:true});if(error)return json({erro:error.message},500);return json({agendamentos:data??[]});}
  if (path === "/api/admin/datas-liberacao-financeira" && request.method === "GET") {const {data,error}=await db.from("datas_liberacao_financeira").select("*").order("data",{ascending:true});if(error)return json({erro:error.message},500);return json({datas:data??[]});}
  if ((path === "/api/admin/liberacoes-financeiras" || path === "/api/admin/solicitacoes-liberacao-financeira") && request.method === "GET") {const table=path.includes("solicitacoes")?"solicitacoes_liberacao_financeira":"liberacoes_financeiras";const {data,error}=await db.from(table).select("*").order("created_at",{ascending:false});if(error)return json({erro:error.message},500);return json({[path.includes("solicitacoes")?"solicitacoes":"liberacoes"]:data??[]});}
  if (path === "/api/admin/remarcacoes" && request.method === "GET") {const {data,error}=await db.from("remarcacoes").select("*").order("created_at",{ascending:false});if(error)return json({erro:error.message},500);return json({remarcacoes:data??[]});}
  if (path.match(/^\/api\/admin\/clientes\/[^/]+\/revisao-financeira$/) && request.method === "POST") {const id=path.split("/")[4];const b=await body(request);const patch:any={status_revisao_financeira:b.decisao,observacao_revisao_financeira:b.observacao??null};if(b.saldoRestante!==undefined)patch.financeiro_saldo_restante=Number(b.saldoRestante);if(b.taxaCartao!==undefined)patch.financeiro_taxa_cartao=Number(b.taxaCartao);if(b.formasCusteio!==undefined)patch.financeiro_formas_custeio=b.formasCusteio;if(b.decisao==="aprovada")patch.financeiro_confirmado_em=new Date().toISOString();const {data,error}=await db.from("clientes").update(patch).eq("id",id).select("*").single();if(error)return json({erro:error.message},400);return json({cliente:data});}

  return json({ erro: "Rota administrativa ainda não migrada.", rota: path }, 404);
}
