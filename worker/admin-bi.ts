import { createServiceSupabaseClient, type Env } from './supabase';
import { getCookie, verificarTokenAdmin } from './session';
import { buscarColaboradorAdminAtivo, temPermissaoAdmin, PERMISSOES_ADMIN } from './admin-auth';
import { mesSaoPaulo, periodoBi, type BiMetric, type BiOverview } from '../src/features/bi/bi-contract';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
type Db=ReturnType<typeof createServiceSupabaseClient>;

export async function lerBaseBi(db:Db, periodo:string):Promise<BiOverview> {
  const range=periodoBi(periodo);
  if(!range) throw new Error('INVALID_PERIOD');
  async function metric(id:string,label:string,scope:string,query:PromiseLike<{count:number|null;error:unknown}>):Promise<BiMetric>{
    try {const {count,error}=await query;if(error||count===null)throw new Error('COUNT_FAILED');return{id,label,scope,value:count};}
    catch{return{id,label,scope,value:null,error:'Não foi possível consultar esta contagem. Tente atualizar.'};}
  }
  const count=(table:string)=>db.from(table).select('id',{count:'exact',head:true});
  const metrics=await Promise.all([
    metric('clientes_mes','Clientes cadastradas','Cadastros do app no mês selecionado',count('clientes').gte('created_at',range.inicio+'T00:00:00-03:00').lt('created_at',range.fim+'T00:00:00-03:00')),
    metric('vendas_pendentes','Pré-cadastros aguardando','Posição atual da fila local; não é o total de vendas do RD',count('novas_vendas').eq('status','aguardando_cadastro')),
    metric('sem_vinculo','Clientes sem vínculo de vendedora','Posição atual: vendedora_id vazio; pode haver nome em texto',count('clientes').is('vendedora_id',null)),
  ]);
  const contracts=await Promise.all([
    ['ativo','Ativos'],['suspenso','Suspensos'],['negativado','Negativados'],['cancelado','Cancelados'],
  ].map(([status,label])=>metric(status,label,'Posição atual dos contratos cadastrados no app',count('clientes').eq('status_contrato',status))));
  return {periodo,consultedAt:new Date().toISOString(),source:'sra_luck',externalCollection:'not_implemented',metrics,contracts};
}
export async function adminBi(request:Request,env:Env):Promise<Response|null>{
  const url=new URL(request.url);
  if(url.pathname!=='/api/admin/bi/overview')return null;
  if(!env.CLIENTE_SESSION_SECRET)return json({erro:'Serviço indisponível.'},503);
  const session=await verificarTokenAdmin(getCookie(request,'admin_session'),env.CLIENTE_SESSION_SECRET);
  if(!session)return json({erro:'Sua sessão expirou. Entre novamente.'},401);
  const actor=await buscarColaboradorAdminAtivo(session.adminId,env);
  if(!actor||!temPermissaoAdmin(actor,PERMISSOES_ADMIN.RELATORIOS_VISUALIZAR))return json({erro:'Seu perfil não tem permissão para visualizar o BI.'},403);
  if(request.method!=='GET')return json({erro:'Método não permitido.'},405);
  const periodo=url.searchParams.get('periodo')??mesSaoPaulo();
  if(!periodoBi(periodo))return json({erro:'Informe um mês válido entre 2000 e 2099.'},400);
  return json(await lerBaseBi(createServiceSupabaseClient(env),periodo));
}
