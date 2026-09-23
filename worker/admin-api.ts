import { publicError } from "./http-security";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenAdmin } from "./session";
import { buscarColaboradorAdminAtivo, temPermissaoAdmin, PERMISSOES_ADMIN } from "./admin-auth";
import { dataNascimentoValida, getAppAccessRequirements } from "./app-access";

type Json = Record<string, any>;

export function exclusaoClienteDeveArquivar(error: unknown): boolean {
  const e = (error ?? {}) as { code?: string; message?: string; details?: string; constraint?: string };
  const texto = [e.message, e.details, e.constraint].filter(Boolean).join(" ").toLowerCase();
  return e.code === "23503"
    || texto.includes("clientes_historico_financeiro_protegido")
    || texto.includes("histórico financeiro")
    || texto.includes("historico financeiro");
}
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }); }
async function body(request: Request): Promise<Json> { try { return await request.json(); } catch { return {}; } }
async function exigirAdmin(request: Request, env: Env) { if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503); const token=getCookie(request,"admin_session"); return (await verificarTokenAdmin(token,env.CLIENTE_SESSION_SECRET))?null:json({erro:"Sessão administrativa expirada."},401); }

async function exigirPermissao(request: Request, env: Env, permissao: string, mensagem: string): Promise<Response | null> {
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);
  const sessao = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  if (!sessao) return json({ erro: "Sessão administrativa expirada." }, 401);
  try {
    const colaborador = await buscarColaboradorAdminAtivo(sessao.adminId, env);
    if (!colaborador || !temPermissaoAdmin(colaborador, permissao)) return json({ erro: mensagem }, 403);
    return null;
  } catch {
    return json({ erro: "Não foi possível validar sua permissão agora." }, 503);
  }
}

export const STATUS_CONTRATO_VALIDOS = ["ativo", "suspenso", "negativado", "cancelado"] as const;
export type StatusContratoInput = (typeof STATUS_CONTRATO_VALIDOS)[number];

export interface PatchStatusContrato {
  status_contrato: StatusContratoInput;
  suspenso_desde: string | null;
  suspenso_ate: string | null;
  suspensao_motivo: string | null;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Regra pura da Fase 1: valida e normaliza uma transição de status de
 * contrato antes de persistir. Extraída para ser testável sem depender do
 * Supabase — a rota HTTP só orquestra (buscar estado atual, persistir, auditar).
 */
export function validarTransicaoStatusContrato(
  body: Json,
  statusAnterior: string,
): { erro: string } | { patch: PatchStatusContrato } {
  const status = String(body.status ?? "");
  if (!STATUS_CONTRATO_VALIDOS.includes(status as StatusContratoInput)) {
    return { erro: "Status de contrato inválido." };
  }
  if (status === statusAnterior) {
    return { erro: `O contrato já está com o status "${status}".` };
  }

  const motivo = body.motivo ? String(body.motivo).trim().slice(0, 500) : null;

  if (status === "suspenso") {
    const suspensoDesde = String(body.suspensoDesde ?? "").trim();
    if (!suspensoDesde || !DATA_ISO.test(suspensoDesde)) {
      return { erro: "Informe a data inicial da suspensão (AAAA-MM-DD)." };
    }
    const suspensoAte = body.suspensoAte ? String(body.suspensoAte).trim() : null;
    if (suspensoAte && !DATA_ISO.test(suspensoAte)) {
      return { erro: "Data final da suspensão inválida." };
    }
    if (suspensoAte && suspensoAte < suspensoDesde) {
      return { erro: "A data final não pode ser anterior à data inicial." };
    }
    return {
      patch: { status_contrato: "suspenso", suspenso_desde: suspensoDesde, suspenso_ate: suspensoAte, suspensao_motivo: motivo },
    };
  }

  return {
    patch: {
      status_contrato: status as StatusContratoInput,
      suspenso_desde: null,
      suspenso_ate: null,
      suspensao_motivo: status === "ativo" ? null : motivo,
    },
  };
}

/** Formas de quitação aceitas no levantamento (mesmos valores de FORMAS_CUSTEIO no admin). */
export const FORMAS_CUSTEIO_VALIDAS = ["cartao", "pix", "cheques", "boleto_100"] as const;

/**
 * Levantamento financeiro (Etapa 2): valida e monta o patch de
 * `POST /clientes/:id/revisao-financeira`.
 * - "aprovada" exige saldo >= 0, ao menos uma forma válida e taxa 0–100 quando
 *   enviada; na primeira aprovação grava `financeiro_confirmado_em`.
 * - Reaprovar um levantamento já aprovado é só edição da configuração
 *   financeira: preserva `financeiro_confirmado_em` (marco, relatórios e
 *   Agenda de Termos não mudam).
 * - "recusada" mantém o comportamento anterior (divergência).
 */
export function montarPatchRevisaoFinanceira(
  body: Json,
  statusAtual: string | null,
  agoraIso: string,
): { erro: string } | { patch: Record<string, unknown> } {
  const decisao = String(body.decisao ?? "");
  if (decisao !== "aprovada" && decisao !== "recusada") return { erro: "Decisão do levantamento inválida." };
  const patch: Record<string, unknown> = {
    status_revisao_financeira: decisao,
    observacao_revisao_financeira: body.observacao ? String(body.observacao).trim().slice(0, 500) : null,
  };
  if (decisao === "recusada") {
    if (body.saldoRestante !== undefined) patch.financeiro_saldo_restante = Number(body.saldoRestante);
    if (body.taxaCartao !== undefined) patch.financeiro_taxa_cartao = Number(body.taxaCartao);
    if (body.formasCusteio !== undefined) patch.financeiro_formas_custeio = body.formasCusteio;
    return { patch };
  }
  const saldo = Number(body.saldoRestante);
  if (body.saldoRestante === undefined || body.saldoRestante === null || body.saldoRestante === "" || !Number.isFinite(saldo) || saldo < 0) {
    return { erro: "Informe um saldo restante válido." };
  }
  const formas = Array.isArray(body.formasCusteio) ? [...new Set(body.formasCusteio.map((f: unknown) => String(f)))] : [];
  if (!formas.length) return { erro: "Selecione ao menos uma forma de quitação." };
  if (formas.some((f) => !(FORMAS_CUSTEIO_VALIDAS as readonly string[]).includes(f))) return { erro: "Forma de quitação inválida." };
  patch.financeiro_saldo_restante = Math.round(saldo * 100) / 100;
  patch.financeiro_formas_custeio = formas;
  if (body.taxaCartao !== undefined && body.taxaCartao !== null) {
    const taxa = Number(body.taxaCartao);
    if (!Number.isFinite(taxa) || taxa < 0 || taxa > 100) return { erro: "Informe uma taxa de cartão válida." };
    patch.financeiro_taxa_cartao = taxa;
  }
  if (statusAtual !== "aprovada") patch.financeiro_confirmado_em = agoraIso;
  return { patch };
}

export async function adminApi(request: Request, env: Env): Promise<Response | null> {
  const url=new URL(request.url), path=url.pathname;
  if(!path.startsWith("/api/admin/")||["/api/admin/auth","/api/admin/session","/api/admin/logout","/api/admin/visao-geral"].includes(path))return null;
  const auth=await exigirAdmin(request,env);if(auth)return auth;const supabase=createServiceSupabaseClient(env);
  if(path==="/api/admin/clientes"&&request.method==="GET"){const {data,error}=await supabase.from("clientes").select("id,nome_completo,cpf,data_nascimento,telefone,email,procedimento,medico,hospital,consultora,valor_contrato,taxa_administrativa_percentual,status_cirurgia,status_financeiro,observacoes_internas,quantidade_parcelas,status_revisao_financeira,data_atingiu_percentual,observacao_revisao_financeira,financeiro_saldo_restante,financeiro_taxa_cartao,financeiro_total_com_taxa,financeiro_formas_custeio,financeiro_confirmado_em,custeio_confirmado_em,ativo,status_contrato,suspenso_desde,suspenso_ate,suspensao_motivo,vendedora_id,acesso_app_liberado,acesso_app_liberado_em,inicio_plano,forma_pagamento_plano,instituicao_pagamento,dia_cobranca,status_plano,valor_total_plano,valor_parcela_plano,created_at,updated_at").order("created_at",{ascending:false});if(error)return json({erro:publicError(error)},500);const {data:boletos}=await supabase.from("boletos").select("cliente_id,status");const {data:agendamentos}=await supabase.from("agendamentos").select("cliente_id,status,horario_termos,termos_assinados_em,datas(data)").in("status",["confirmado","realizado"]);const {data:carnesRows}=await supabase.from("carnes").select("cliente_id,instituicao_financeira,data_geracao").order("data_geracao",{ascending:false});const {data:vendasRows}=await supabase.from("novas_vendas").select("cliente_id,origem_venda").not("cliente_id","is",null);const resumo=new Map<string,{total:number;pagos:number}>();for(const b of boletos??[]){const r=resumo.get(b.cliente_id)??{total:0,pagos:0};r.total++;if(b.status==="pago")r.pagos++;resumo.set(b.cliente_id,r);}const agenda=new Map<string,any>();for(const a of (agendamentos??[]) as any[]){const d=Array.isArray(a.datas)?a.datas[0]?.data:a.datas?.data;const old=agenda.get(a.cliente_id);if(!old||(a.status==="realizado"&&old.status==="confirmado"))agenda.set(a.cliente_id,{data:d??null,horario:a.horario_termos?String(a.horario_termos).slice(0,5):null,termosAssinadosEm:a.termos_assinados_em??null,status:a.status});}const bancoPorCliente=new Map<string,string>();for(const cn of (carnesRows??[]) as any[]){if(!bancoPorCliente.has(cn.cliente_id)&&cn.instituicao_financeira)bancoPorCliente.set(cn.cliente_id,cn.instituicao_financeira);}const origemPorCliente=new Map<string,string>();for(const v of (vendasRows??[]) as any[]){if(v.cliente_id&&!origemPorCliente.has(v.cliente_id)&&v.origem_venda)origemPorCliente.set(v.cliente_id,v.origem_venda);}return json({clientes:(data??[]).map((c:any)=>{const r=resumo.get(c.id),a=agenda.get(c.id);return {...c,porcentagem_pagamento:r?.total?Math.round(r.pagos/r.total*1000)/10:null,parcelas_pagas:r?.pagos??null,parcelas_total:r?.total??null,termos_assinados_em:a?.termosAssinadosEm??null,proximo_agendamento_data:a?.status==="confirmado"?a.data:null,proximo_agendamento_horario:a?.status==="confirmado"?a.horario:null,banco:bancoPorCliente.get(c.id)??null,origem_venda:origemPorCliente.get(c.id)??null};})});}
  if(path==="/api/admin/clientes"&&request.method==="POST"){const semPermissao=await exigirPermissao(request,env,PERMISSOES_ADMIN.CLIENTES_EDITAR,"Seu papel não tem permissão para criar clientes.");if(semPermissao)return semPermissao;const b=await body(request),cpf=String(b.cpf??"").replace(/\D/g,""),dataNascimento=String(b.dataNascimento??"").trim();if(!b.nomeCompleto||cpf.length!==11)return json({erro:"Nome e CPF são obrigatórios."},400);if(!dataNascimentoValida(dataNascimento))return json({erro:"Informe uma data de nascimento válida."},400);const {data,error}=await supabase.from("clientes").insert({nome_completo:b.nomeCompleto,cpf,data_nascimento:dataNascimento,telefone:b.telefone||null,email:b.email||null,procedimento:b.procedimento||null,medico:b.medico||null,hospital:b.hospital||null,consultora:b.consultora||null,valor_contrato:Number(b.valorContrato)||0,taxa_administrativa_percentual:Number(b.taxaAdministrativaPercentual)||0,observacoes_internas:b.observacoes||null,ativo:b.ativo!==false,status_cirurgia:"nao_agendada",status_financeiro:"a_pagar"}).select("*").single();if(error)return json({erro:error.code==="23505"?"Já existe uma cliente cadastrada com esse CPF.":publicError(error)},400);return json({cliente:data});}
  const cliente=path.match(/^\/api\/admin\/clientes\/([^/]+)$/);if(cliente&&request.method==="PATCH"){const semPermissao=await exigirPermissao(request,env,PERMISSOES_ADMIN.CLIENTES_EDITAR,"Seu papel não tem permissão para editar clientes.");if(semPermissao)return semPermissao;const b=await body(request),id=decodeURIComponent(cliente[1]),patch:any={};if(b.dataNascimento!==undefined&&!dataNascimentoValida(String(b.dataNascimento??"").trim()))return json({erro:"Informe uma data de nascimento válida."},400);const map:any={nomeCompleto:"nome_completo",cpf:"cpf",dataNascimento:"data_nascimento",telefone:"telefone",email:"email",procedimento:"procedimento",medico:"medico",hospital:"hospital",consultora:"consultora",valorContrato:"valor_contrato",taxaAdministrativaPercentual:"taxa_administrativa_percentual",observacoes:"observacoes_internas",ativo:"ativo"};for(const [a,k]of Object.entries(map))if(b[a]!==undefined)patch[k]=a==="cpf"?String(b[a]).replace(/\D/g,""):a==="dataNascimento"?String(b[a]).trim():b[a];const {data,error}=await supabase.from("clientes").update(patch).eq("id",id).select("*").single();if(error)return json({erro:error.code==="23505"?"Já existe uma cliente ativa cadastrada com esse CPF.":publicError(error)},400);return json({cliente:data});}
  if(cliente&&request.method==="DELETE"){
    const id=decodeURIComponent(cliente[1]);
    const token1=getCookie(request,"admin_session");
    const session1=await verificarTokenAdmin(token1,env.CLIENTE_SESSION_SECRET!);
    const colaborador1=session1?await buscarColaboradorAdminAtivo(session1.adminId,env):null;
    if(!colaborador1||!temPermissaoAdmin(colaborador1,PERMISSOES_ADMIN.CLIENTES_EXCLUIR)){
      return json({erro:"Seu papel não tem permissão para excluir o perfil de uma cliente."},403);
    }
    const {data:existente,error:erroExistente}=await supabase.from("clientes").select("id,nome_completo,cpf").eq("id",id).maybeSingle();
    if(erroExistente)return json({erro:publicError(erroExistente)},500);
    if(!existente)return json({erro:"Cliente não encontrada."},404);
    const {data:vendasVinculadas}=await supabase.from("novas_vendas").select("id").eq("cliente_id",id);
    const {error}=await supabase.from("clientes").delete().eq("id",id);
    if(error){
      if(!exclusaoClienteDeveArquivar(error))return json({erro:publicError(error)},400);

      // O banco protege histórico financeiro/operacional contra DELETE físico.
      // Nesses casos, "Excluir perfil" vira arquivamento (migration_077):
      // preserva parcelas/agendamentos/recebimentos para auditoria, revoga o
      // acesso ao app, libera o CPF para um novo cadastro e devolve a venda
      // do RD para "aguardando cadastro" (sem escrever no RD Station).
      const {error:erroArquivar}=await supabase.rpc("clientes_arquivar",{p_cliente_id:id,p_usuario:colaborador1.id});
      if(erroArquivar){
        if(String(erroArquivar.message??"").includes("CLIENTE_NAO_ENCONTRADA"))return json({erro:"Cliente não encontrada."},404);
        return json({erro:publicError(erroArquivar)},400);
      }
      return json({ok:true,arquivado:true});
    }
    // Exclusão física: o FK já solta a venda (ON DELETE SET NULL); ela volta
    // para a fila de cadastro para poder gerar a cliente de novo.
    const idsVendas=(vendasVinculadas??[]).map((v:any)=>v.id);
    if(idsVendas.length)await supabase.from("novas_vendas").update({status:"aguardando_cadastro",updated_at:new Date().toISOString()}).in("id",idsVendas).is("cliente_id",null);
    await supabase.from("logs_alteracoes").insert({usuario:colaborador1.id,acao:"excluiu_cliente",entidade:"clientes",entidade_id:id,detalhes:{registroExcluido:true,modo:"fisico"}});
    return json({ok:true,arquivado:false});
  }
  const cb=path.match(/^\/api\/admin\/clientes\/([^/]+)\/(boletos|parcelas)$/);if(cb){const id=decodeURIComponent(cb[1]);if(request.method==="GET"){const {data,error}=await supabase.from("boletos").select("id,cliente_id,numero_parcela,total_parcelas,valor,data_vencimento,status,comprovante_url,boleto_url,data_pagamento,observacoes,suspensa,suspensa_em,suspensa_por,created_at,updated_at").eq("cliente_id",id).order("numero_parcela",{ascending:true});if(error)return json({erro:publicError(error)},500);return json({boletos:data??[],parcelas:data??[]});}const semPermissaoParcelas=await exigirPermissao(request,env,PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL,"Seu papel não tem permissão para alterar parcelas.");if(semPermissaoParcelas)return semPermissaoParcelas;const b=await body(request);if(request.method==="POST"&&cb[2]==="boletos"){const {data:c}=await supabase.from("clientes").select("valor_contrato,quantidade_parcelas,taxa_administrativa_percentual").eq("id",id).maybeSingle();const total=Math.max(Number(b.totalParcelas??c?.quantidade_parcelas??1),1);const valor=Number(b.valor??((Number(c?.valor_contrato??0)*(1+Number(c?.taxa_administrativa_percentual??0)/100))/total));const rows=Array.from({length:total},(_,i)=>({cliente_id:id,numero_parcela:i+1,total_parcelas:total,valor,data_vencimento:b.dataVencimento??null,status:"pendente"}));const {data,error}=await supabase.from("boletos").insert(rows).select("*");if(error)return json({erro:publicError(error)},400);return json({boletos:data});}if(request.method==="POST"&&cb[2]==="parcelas"){if(b.acao==="excluir"&&b.boletoId){const {error}=await supabase.from("boletos").delete().eq("id",b.boletoId).eq("cliente_id",id);if(error)return json({erro:publicError(error)},400);return json({ok:true});}if(b.acao==="editar"&&b.boletoId){const patch:any={};if(b.valor!==undefined)patch.valor=Number(b.valor);if(b.dataVencimento!==undefined)patch.data_vencimento=b.dataVencimento||null;const {data,error}=await supabase.from("boletos").update(patch).eq("id",b.boletoId).eq("cliente_id",id).select("*").single();if(error)return json({erro:publicError(error)},400);return json({boleto:data});}}if(request.method==="PATCH"){const idB=b.boletoId;if(!idB)return json({erro:"Boleto não informado."},400);const patch:any={};if(b.valor!==undefined)patch.valor=Number(b.valor);if(b.dataVencimento!==undefined)patch.data_vencimento=b.dataVencimento||null;if(b.status!==undefined)patch.status=b.status;const {data,error}=await supabase.from("boletos").update(patch).eq("id",idB).eq("cliente_id",id).select("*").single();if(error)return json({erro:publicError(error)},400);return json({boleto:data});}}
  if(path==="/api/admin/boletos"&&request.method==="GET"){let q=supabase.from("boletos").select("id,cliente_id,numero_parcela,total_parcelas,valor,data_vencimento,status,comprovante_url,boleto_url,data_pagamento,observacoes,suspensa,suspensa_em,suspensa_por,created_at,updated_at,clientes(id,nome_completo,cpf)").order("created_at",{ascending:false});const status=url.searchParams.get("status"),cid=url.searchParams.get("cliente_id");if(status&&status!=="todos")q=q.eq("status",status);if(cid)q=q.eq("cliente_id",cid);const {data,error}=await q;if(error)return json({erro:publicError(error)},500);return json({boletos:(data??[]).map((x:any)=>({...x,valor:Number(x.valor)}))});}
  const boleto=path.match(/^\/api\/admin\/boletos\/([^/]+)$/);if(boleto&&request.method==="PATCH"){const id=decodeURIComponent(boleto[1]),b=await body(request),acao=b.acao;const permissao=acao==="confirmar"||acao==="rejeitar"?PERMISSOES_ADMIN.FINANCEIRO_VALIDAR_COMPROVANTE:PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL;const semPermissao=await exigirPermissao(request,env,permissao,acao==="confirmar"||acao==="rejeitar"?"Seu papel não tem permissão para validar comprovantes.":"Seu papel não tem permissão para alterar o status financeiro.");if(semPermissao)return semPermissao;const status=acao==="confirmar"?"pago":acao==="rejeitar"?"rejeitado":b.status;if(!status)return json({erro:"Ação de pagamento inválida."},400);const {data,error}=await supabase.from("boletos").update({status,observacoes:b.observacoes??undefined,data_pagamento:acao==="confirmar"?new Date().toISOString().slice(0,10):undefined}).eq("id",id).select("*").single();if(error)return json({erro:publicError(error)},400);return json({boleto:data});}
  if(path==="/api/admin/boletos/lote"&&request.method==="PATCH"){const semPermissao=await exigirPermissao(request,env,PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL,"Seu papel não tem permissão para realizar baixa em lote.");if(semPermissao)return semPermissao;const b=await body(request),ids=Array.isArray(b.ids)?b.ids:[];if(!ids.length)return json({erro:"Nenhum boleto selecionado."},400);const {data,error}=await supabase.from("boletos").update({status:b.status??"pago",data_pagamento:b.dataPagamento??new Date().toISOString().slice(0,10)}).in("id",ids).select("*");if(error)return json({erro:publicError(error)},400);return json({boletos:data??[]});}
  if(path==="/api/admin/datas"&&request.method==="GET"){const ano=Number(url.searchParams.get("ano")),mes=Number(url.searchParams.get("mes"));let q=supabase.from("datas").select("*").order("data",{ascending:true});if(ano&&mes){const ini=`${ano}-${String(mes).padStart(2,"0")}-01`,next=mes===12?`${ano+1}-01-01`:`${ano}-${String(mes+1).padStart(2,"0")}-01`;q=q.gte("data",ini).lt("data",next);}const {data,error}=await q;if(error)return json({erro:publicError(error)},500);const ids=(data??[]).map((x:any)=>x.id);let ag:any[]=[];if(ids.length){const r=await supabase.from("agendamentos").select("data_id,cliente_id,status").in("data_id",ids).eq("status","confirmado");ag=r.data??[];}const counts=new Map<string,number>();for(const a of ag)counts.set(a.data_id,(counts.get(a.data_id)??0)+1);return json({datas:(data??[]).map((x:any)=>({...x,vagasOcupadas:counts.get(x.id)??0}))});}
  if(path==="/api/admin/datas"&&request.method==="POST"){const semPermissao=await exigirPermissao(request,env,PERMISSOES_ADMIN.AGENDA_GERENCIAR,"Seu papel não tem permissão para gerenciar a agenda.");if(semPermissao)return semPermissao;const b=await body(request);if(!b.data)return json({erro:"Data obrigatória."},400);const {data,error}=await supabase.from("datas").insert({data:b.data,vagas_totais:Number(b.vagasTotais??1),status:"disponivel"}).select("*").single();if(error)return json({erro:error.code==="23505"?"Esta data já está liberada.":publicError(error)},400);return json({data});}
  const dm=path.match(/^\/api\/admin\/datas\/([^/]+)$/);if(dm&&(request.method==="PATCH"||request.method==="DELETE")){const semPermissao=await exigirPermissao(request,env,PERMISSOES_ADMIN.AGENDA_GERENCIAR,"Seu papel não tem permissão para gerenciar a agenda.");if(semPermissao)return semPermissao;const id=decodeURIComponent(dm[1]);if(request.method==="DELETE"){const {error}=await supabase.from("datas").delete().eq("id",id);if(error)return json({erro:publicError(error)},400);return json({ok:true});}const b=await body(request),patch:any={};if(b.status!==undefined)patch.status=b.status;if(b.vagasTotais!==undefined)patch.vagas_totais=Math.max(Number(b.vagasTotais),0);const {data,error}=await supabase.from("datas").update(patch).eq("id",id).select("*").single();if(error)return json({erro:publicError(error)},400);return json({data});}
  if(path==="/api/admin/configuracoes"){
    if(request.method==="GET"){
      const {data,error}=await supabase.from("configuracoes").select("*").maybeSingle();
      if(error)return json({erro:publicError(error)},500);
      return json({configuracoes:data??{}});
    }
    if(request.method==="PATCH"){
      const semPermissao=await exigirPermissao(request,env,PERMISSOES_ADMIN.CONFIGURACOES_GERENCIAR,"Seu papel não tem permissão para alterar configurações.");if(semPermissao)return semPermissao;
      const b=await body(request),patch:any={};
      const hex=(value:unknown)=>typeof value==="string"&&/^#[0-9A-Fa-f]{6}$/.test(value.trim())?value.trim().toUpperCase():null;
      if(b.nomeClinica!==undefined)patch.nome_clinica=String(b.nomeClinica).trim();
      if(b.metaOrcamentoMensal!==undefined){const v=Number(b.metaOrcamentoMensal);if(!Number.isFinite(v)||v<0||v>1000000000)return json({erro:"Informe um limite orçamentário válido."},400);patch.meta_orcamento_mensal=v;}
      if(b.fraseSonho!==undefined)patch.frase_sonho=String(b.fraseSonho).slice(0,1000);
      if(b.agendaLiberacaoFinanceiraBloqueada!==undefined)patch.agenda_liberacao_financeira_bloqueada=Boolean(b.agendaLiberacaoFinanceiraBloqueada);
      if(b.pixChave!==undefined)patch.pix_chave=String(b.pixChave).trim().slice(0,250);
      if(b.pixQrCodeBase64!==undefined){const qr=String(b.pixQrCodeBase64);if(qr&&(!qr.startsWith("data:image/")||qr.length>2100000))return json({erro:"QR Code inválido ou muito grande."},400);patch.pix_qrcode_base64=qr;}
      if(b.pixDescontoPercentual!==undefined){const v=Number(b.pixDescontoPercentual);if(!Number.isFinite(v)||v<0||v>100)return json({erro:"Informe um desconto PIX entre 0% e 100%."},400);patch.pix_desconto_percentual=v;}
      if(b.whatsappContato!==undefined)patch.whatsapp_contato=String(b.whatsappContato).trim().slice(0,40);
      if(b.telefoneContato!==undefined)patch.telefone_contato=String(b.telefoneContato).trim().slice(0,40);
      if(b.temaCorPrimaria!==undefined){const v=hex(b.temaCorPrimaria);if(!v)return json({erro:"Cor principal inválida."},400);patch.tema_cor_primaria=v;}
      if(b.temaCorSecundaria!==undefined){const v=hex(b.temaCorSecundaria);if(!v)return json({erro:"Cor secundária inválida."},400);patch.tema_cor_secundaria=v;}
      if(b.temaCorDestaque!==undefined){const v=hex(b.temaCorDestaque);if(!v)return json({erro:"Cor de destaque inválida."},400);patch.tema_cor_destaque=v;}
      patch.updated_at=new Date().toISOString();
      const r=await supabase.from("configuracoes").update(patch).eq("id",1).select("*").maybeSingle();
      if(r.error)return json({erro:publicError(r.error)},400);
      return json({configuracoes:r.data});
    }
  }
  if(path==="/api/admin/clientes-agendamentos"&&request.method==="GET"){const {data,error}=await supabase.from("agendamentos").select("id,cliente_id,status,horario_termos,termos_assinados_em,datas(id,data,status),clientes(id,nome_completo,cpf)").order("created_at",{ascending:false});if(error)return json({erro:publicError(error)},500);return json({agendamentos:data??[]});}
  if(path==="/api/admin/agenda-mensal"&&request.method==="GET"){const ano=Number(url.searchParams.get("ano"))||new Date().getFullYear();const {data,error}=await supabase.from("agendamentos").select("id,cliente_id,status,horario_termos,datas(data),clientes(nome_completo)").gte("datas.data",`${ano}-01-01`).lt("datas.data",`${ano+1}-01-01`).order("created_at",{ascending:true});if(error)return json({erro:publicError(error)},500);return json({agendamentos:data??[]});}
  if(path==="/api/admin/remarcacoes"){
    if(request.method==="GET"){const {data,error}=await supabase.from("solicitacoes_remarcacao_agendamento").select("id,tipo,data_solicitada,horario_termos,status,created_at,clientes(nome_completo)").eq("status","pendente").order("created_at",{ascending:true}).limit(100);if(error)return json({remarcacoes:[]});return json({remarcacoes:data??[]});}
    if(request.method==="POST"){
      const semPermissao=await exigirPermissao(request,env,PERMISSOES_ADMIN.AGENDA_GERENCIAR,"Seu papel não tem permissão para analisar remarcações.");if(semPermissao)return semPermissao;
      const b=await body(request);
      if(!b.id||!["aprovar","recusar"].includes(b.acao))return json({erro:"Solicitação inválida."},400);
      const {data:solicitacao,error:erroSolicitacao}=await supabase.from("solicitacoes_remarcacao_agendamento").select("id,agendamento_id,tipo,data_id,data_solicitada,horario_termos,status").eq("id",b.id).maybeSingle();
      if(erroSolicitacao)return json({erro:publicError(erroSolicitacao)},500);
      if(!solicitacao)return json({erro:"Solicitação não encontrada."},404);
      if(solicitacao.status!=="pendente")return json({erro:"Esta solicitação já foi analisada."},409);
      if(b.acao==="recusar"){const {data,error}=await supabase.from("solicitacoes_remarcacao_agendamento").update({status:"recusada",analisada_em:new Date().toISOString()}).eq("id",b.id).select("*").single();if(error)return json({erro:publicError(error)},400);return json({remarcacao:data});}
      if(solicitacao.tipo==="termos"){
        if(!solicitacao.data_id||!solicitacao.horario_termos)return json({erro:"Solicitação sem data ou horário válidos."},400);
        const {data:dataAlvo}=await supabase.from("datas").select("id,vagas_totais,status").eq("id",solicitacao.data_id).maybeSingle();
        if(!dataAlvo||dataAlvo.status!=="disponivel")return json({erro:"Essa data não está mais disponível para aprovar."},409);
        const {count}=await supabase.from("agendamentos").select("id",{count:"exact",head:true}).eq("data_id",solicitacao.data_id).eq("status","confirmado").neq("id",solicitacao.agendamento_id);
        if((count??0)>=dataAlvo.vagas_totais)return json({erro:"Essa data não está mais disponível para aprovar."},409);
        const {error:erroAplicar,count:linhasAfetadas}=await supabase.from("agendamentos").update({data_id:solicitacao.data_id,horario_termos:solicitacao.horario_termos,updated_at:new Date().toISOString()},{count:"exact"}).eq("id",solicitacao.agendamento_id).eq("status","confirmado");
        if(erroAplicar)return json({erro:"Não foi possível aplicar a nova data dos termos."},500);
        if(!linhasAfetadas)return json({erro:"O agendamento não está mais disponível para alteração."},409);
      } else {
        if(!solicitacao.data_solicitada)return json({erro:"Solicitação sem data válida."},400);
        const {error:erroAplicar}=await supabase.rpc("agendar_cirurgia_data",{p_agendamento_id:solicitacao.agendamento_id,p_data:solicitacao.data_solicitada});
        if(erroAplicar){const m=String(erroAplicar.message??"");if(m.includes("DATA_CIRURGIA_OCUPADA")||m.includes("DATA_CIRURGIA_INDISPONIVEL"))return json({erro:"Essa data não está mais disponível para aprovar."},409);return json({erro:"Não foi possível aplicar a nova data da cirurgia."},500);}
      }
      const {data,error}=await supabase.from("solicitacoes_remarcacao_agendamento").update({status:"aprovada",analisada_em:new Date().toISOString()}).eq("id",b.id).select("*").single();
      if(error)return json({erro:publicError(error)},400);
      return json({remarcacao:data});
    }
  }
  if(path==="/api/admin/datas-liberacao-financeira"&&request.method==="GET"){const {data,error}=await supabase.from("datas_liberacao_financeira").select("*").order("data",{ascending:true});if(error)return json({erro:publicError(error)},500);return json({datas:data??[]});}
  if(path==="/api/admin/previsoes-liberacao"&&request.method==="GET"){const {data,error}=await supabase.from("agendamentos").select("id,cliente_id,previsao_liberacao_financeira,status,clientes(id,nome_completo,cpf)").not("previsao_liberacao_financeira","is",null).order("previsao_liberacao_financeira",{ascending:true});if(error)return json({previsoes:[]});return json({previsoes:data??[]});}
  if((path==="/api/admin/liberacoes-financeiras"||path==="/api/admin/solicitacoes-liberacao-financeira")&&request.method==="GET"){const table=path.includes("solicitacoes")?"solicitacoes_liberacao_financeira":"liberacoes_financeiras";const {data,error}=await supabase.from(table).select("*").order("created_at",{ascending:false});if(error)return json({erro:publicError(error)},500);return json({[path.includes("solicitacoes")?"solicitacoes":"liberacoes"]:data??[]});}
  const rev=path.match(/^\/api\/admin\/clientes\/([^/]+)\/revisao-financeira$/);if(rev&&request.method==="POST"){const semPermissao=await exigirPermissao(request,env,PERMISSOES_ADMIN.FINANCEIRO_REVISAO,"Seu papel não tem permissão para concluir revisões financeiras.");if(semPermissao)return semPermissao;const id=decodeURIComponent(rev[1]),b=await body(request);const atual=await supabase.from("clientes").select("status_revisao_financeira").eq("id",id).maybeSingle();if(atual.error)return json({erro:publicError(atual.error)},400);if(!atual.data)return json({erro:"Cliente não encontrada."},404);const montado=montarPatchRevisaoFinanceira(b,atual.data.status_revisao_financeira??null,new Date().toISOString());if("erro" in montado)return json({erro:montado.erro},400);const {data,error}=await supabase.from("clientes").update(montado.patch).eq("id",id).select("*").single();if(error)return json({erro:publicError(error)},400);return json({cliente:data});}

  const statusContrato=path.match(/^\/api\/admin\/clientes\/([^/]+)\/status-contrato$/);
  if(statusContrato&&request.method==="POST"){
    const id=decodeURIComponent(statusContrato[1]);
    const b=await body(request);

    const token0=getCookie(request,"admin_session");
    const session0=await verificarTokenAdmin(token0,env.CLIENTE_SESSION_SECRET!);
    const colaborador=session0?await buscarColaboradorAdminAtivo(session0.adminId,env):null;
    if(!colaborador||!temPermissaoAdmin(colaborador,PERMISSOES_ADMIN.CLIENTES_ALTERAR_STATUS_CONTRATO)){
      return json({erro:"Seu papel não tem permissão para alterar o status do contrato."},403);
    }

    const {data:atual,error:erroAtual}=await supabase.from("clientes").select("id,nome_completo,status_contrato").eq("id",id).maybeSingle();
    if(erroAtual)return json({erro:publicError(erroAtual)},500);
    if(!atual)return json({erro:"Cliente não encontrada."},404);

    const resultado=validarTransicaoStatusContrato(b,String(atual.status_contrato));
    if("erro" in resultado)return json({erro:resultado.erro},400);

    const {data,error}=await supabase.from("clientes").update(resultado.patch).eq("id",id).select("*").single();
    if(error)return json({erro:publicError(error)},400);

    await supabase.from("logs_alteracoes").insert({
      usuario:colaborador.id,
      acao:"alterou_status_contrato",
      entidade:"clientes",
      entidade_id:id,
      detalhes:{de:atual.status_contrato,para:resultado.patch.status_contrato,motivoInformado:Boolean(resultado.patch.suspensao_motivo),suspensoDesde:resultado.patch.suspenso_desde,suspensoAte:resultado.patch.suspenso_ate},
    });

    return json({cliente:data});
  }

  const liberarAcessoApp=path.match(/^\/api\/admin\/clientes\/([^/]+)\/liberar-acesso-app$/);
  if(liberarAcessoApp&&request.method==="POST"){
    const semPermissao=await exigirPermissao(request,env,PERMISSOES_ADMIN.CLIENTES_LIBERAR_ACESSO_APP,"Seu papel não tem permissão para liberar acesso ao aplicativo.");
    if(semPermissao)return semPermissao;

    const id=decodeURIComponent(liberarAcessoApp[1]);
    const [{data:clienteAcesso,error:erroClienteAcesso},{count:parcelasCount,error:erroParcelas}]=await Promise.all([
      supabase.from("clientes").select("id,nome_completo,cpf,data_nascimento,ativo,acesso_app_liberado,acesso_app_liberado_em").eq("id",id).maybeSingle(),
      supabase.from("boletos").select("id",{count:"exact",head:true}).eq("cliente_id",id),
    ]);
    if(erroClienteAcesso)return json({erro:"Não foi possível validar os dados da cliente."},500);
    if(erroParcelas)return json({erro:"Não foi possível validar o financeiro da cliente."},500);
    if(!clienteAcesso)return json({erro:"Cliente não encontrada."},404);
    if(clienteAcesso.ativo!==true)return json({erro:"Cliente inativa não pode receber acesso ao aplicativo."},409);

    const requisitos=getAppAccessRequirements({
      name:clienteAcesso.nome_completo,
      cpf:clienteAcesso.cpf,
      birthDate:clienteAcesso.data_nascimento,
      installmentCount:parcelasCount??0,
    });
    if(!requisitos.canRelease){
      return json({erro:"A cliente ainda não possui todos os requisitos para acesso ao app.",faltando:requisitos.missing,requisitos},409);
    }
    if(clienteAcesso.acesso_app_liberado){
      return json({cliente:clienteAcesso,requisitos,jaLiberado:true});
    }

    const liberadoEm=new Date().toISOString();
    const {data:clienteLiberada,error:erroLiberar}=await supabase.from("clientes")
      .update({acesso_app_liberado:true,acesso_app_liberado_em:liberadoEm,updated_at:liberadoEm})
      .eq("id",id)
      .eq("acesso_app_liberado",false)
      .select("id,nome_completo,cpf,data_nascimento,ativo,acesso_app_liberado,acesso_app_liberado_em")
      .maybeSingle();
    if(erroLiberar)return json({erro:"Não foi possível liberar o acesso ao aplicativo."},500);

    const sessaoAcesso=await verificarTokenAdmin(getCookie(request,"admin_session"),env.CLIENTE_SESSION_SECRET!);
    const colaboradorAcesso=sessaoAcesso?await buscarColaboradorAdminAtivo(sessaoAcesso.adminId,env):null;
    if(clienteLiberada){
      await supabase.from("logs_alteracoes").insert({
        usuario:colaboradorAcesso?.id??"admin",
        acao:"liberou_acesso_app",
        entidade:"clientes",
        entidade_id:id,
        detalhes:{requisitos:["nome","cpf","data_nascimento","financeiro"],parcelas:parcelasCount??0,liberadoEm},
      });
    }

    return json({cliente:clienteLiberada??clienteAcesso,requisitos,jaLiberado:!clienteLiberada});
  }

  const historicoCliente=path.match(/^\/api\/admin\/clientes\/([^/]+)\/historico$/);
  if(historicoCliente&&request.method==="GET"){
    const id=decodeURIComponent(historicoCliente[1]);
    const [porEntidade,porDetalhe]=await Promise.all([
      supabase.from("logs_alteracoes").select("id,usuario,acao,entidade,entidade_id,detalhes,created_at").eq("entidade_id",id).order("created_at",{ascending:false}).limit(200),
      supabase.from("logs_alteracoes").select("id,usuario,acao,entidade,entidade_id,detalhes,created_at").eq("entidade","boleto").filter("detalhes->>cliente_id","eq",id).order("created_at",{ascending:false}).limit(200),
    ]);
    if(porEntidade.error)return json({erro:publicError(porEntidade.error)},500);
    if(porDetalhe.error)return json({erro:publicError(porDetalhe.error)},500);
    const vistos=new Set<string>();
    const eventos=[...(porEntidade.data??[]),...(porDetalhe.data??[])]
      .filter((e:any)=>{if(vistos.has(e.id))return false;vistos.add(e.id);return true;})
      .sort((a:any,b:any)=>String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0,200);
    return json({historico:eventos});
  }

  return json({erro:"Rota administrativa ainda não migrada.",rota:path},404);
}
