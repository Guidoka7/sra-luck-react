import { biCollector } from './bi-collector';
import { isDevConsoleSyntheticAdminId } from './dev-console-auth';
import { createServiceSupabaseClient, type Env } from './supabase';
import { getCookie, verificarTokenAdmin } from './session';
import { buscarColaboradorAdminAtivo, temPermissaoAdmin, PERMISSOES_ADMIN } from './admin-auth';
import type { BiOverview } from '../src/features/bi/bi-contract';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

export async function adminBi(request:Request,env:Env):Promise<Response|null>{
  const path=new URL(request.url).pathname;
  if(path!=='/api/admin/bi/overview'&&!path.startsWith('/api/admin/bi/collector/'))return null;
  if(!env.CLIENTE_SESSION_SECRET)return json({erro:'Serviço indisponível.'},503);
  const session=await verificarTokenAdmin(getCookie(request,'admin_session'),env.CLIENTE_SESSION_SECRET);
  if(!session)return json({erro:'Sua sessão expirou. Entre novamente.'},401);
  const actor=await buscarColaboradorAdminAtivo(session.adminId,env);
  if(!actor||!temPermissaoAdmin(actor,PERMISSOES_ADMIN.RELATORIOS_VISUALIZAR))return json({erro:'Seu perfil não tem permissão para visualizar o Power BI comercial.'},403);
  if(path.startsWith('/api/admin/bi/collector/')) {
    if(!isDevConsoleSyntheticAdminId(session.adminId))return json({erro:'A coleta é controlada exclusivamente pelo painel Dev.'},403);
    return biCollector(request,env,session.adminId);
  }
  if(request.method!=='GET')return json({erro:'Método não permitido.'},405);
  // Estado real da recepção. Nunca usar tabelas operacionais como fallback.
  try {
    const db=createServiceSupabaseClient(env);
    const {data:source,error}=await db.from('bi_sources').select('id').eq('active',true).maybeSingle();
    if(error)throw error;
    let state:BiOverview['collection']['state']='not_configured';
    let lastSyncedAt:string|null=null;
    if(source){
      const {data:runs,error:runError}=await db.from('bi_runs').select('mode,status,finished_at').eq('source_id',source.id).eq('mode','commercial').order('started_at',{ascending:false}).limit(20);
      if(runError)throw runError;
      const last=runs?.[0];
      state=last?.status==='running'?'receiving':last?.status==='paused'?'paused':last?.status==='collected'?'received_unvalidated':'configured';
      lastSyncedAt=runs?.find(r=>r.status==='collected')?.finished_at??null;
    }
    const result:BiOverview={source:'rd_station',scope:'company_commercial',collection:{state,lastSyncedAt,historicalComplete:false},metrics:null};
    return json(result);
  }catch{return json({erro:'A estrutura de recebimento do BI está indisponível.',codigo:'BI_STORAGE_UNAVAILABLE'},503);}
}
