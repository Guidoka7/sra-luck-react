import type { Env } from './supabase';
import { getCookie, verificarTokenAdmin } from './session';
import { buscarColaboradorAdminAtivo, temPermissaoAdmin, PERMISSOES_ADMIN } from './admin-auth';
import type { BiOverview } from '../src/features/bi/bi-contract';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

export async function adminBi(request:Request,env:Env):Promise<Response|null>{
  if(new URL(request.url).pathname!=='/api/admin/bi/overview')return null;
  if(!env.CLIENTE_SESSION_SECRET)return json({erro:'Serviço indisponível.'},503);
  const session=await verificarTokenAdmin(getCookie(request,'admin_session'),env.CLIENTE_SESSION_SECRET);
  if(!session)return json({erro:'Sua sessão expirou. Entre novamente.'},401);
  const actor=await buscarColaboradorAdminAtivo(session.adminId,env);
  if(!actor||!temPermissaoAdmin(actor,PERMISSOES_ADMIN.RELATORIOS_VISUALIZAR))return json({erro:'Seu perfil não tem permissão para visualizar o Power BI comercial.'},403);
  if(request.method!=='GET')return json({erro:'Método não permitido.'},405);
  // A coleta BI do RD ainda não existe. Não usar clientes/novas_vendas/boletos
  // como fallback: isso excluiria leads que nunca entraram no sistema operacional.
  const result:BiOverview={source:'rd_station',scope:'company_commercial',collection:{state:'not_implemented',lastSyncedAt:null,historicalComplete:false},metrics:null};
  return json(result);
}
