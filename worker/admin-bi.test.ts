import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({session:vi.fn(),actor:vi.fn(),permission:vi.fn(),db:vi.fn(),source:null as null|{id:string},runs:[] as object[],error:null as unknown}));
vi.mock('./session',()=>({getCookie:()=>null,verificarTokenAdmin:mocks.session}));
vi.mock('./admin-auth',()=>({buscarColaboradorAdminAtivo:mocks.actor,temPermissaoAdmin:mocks.permission,PERMISSOES_ADMIN:{RELATORIOS_VISUALIZAR:'relatorios.visualizar'}}));
vi.mock('./supabase',()=>({createServiceSupabaseClient:mocks.db}));
import { adminBi } from './admin-bi';
import type { Env } from './supabase';
const env={CLIENTE_SESSION_SECRET:'test'} as Env;
const request=()=>new Request('https://example.com/api/admin/bi/overview');
const tables:string[]=[];
beforeEach(()=>{vi.clearAllMocks();mocks.source=null;mocks.runs=[];mocks.error=null;tables.length=0;mocks.session.mockResolvedValue({adminId:'qa'});mocks.actor.mockResolvedValue({id:'qa'});mocks.permission.mockReturnValue(true);
 mocks.db.mockReturnValue({from:(table:string)=>{tables.push(table);const q:any={select:()=>q,eq:()=>q,order:()=>q,maybeSingle:async()=>({data:mocks.source,error:mocks.error}),limit:async()=>({data:mocks.runs,error:mocks.error})};return q;}});
});
describe('Power BI comercial independente do app',()=>{
 it('nega sessão ausente e falta de permissão antes de ler o banco',async()=>{
  mocks.session.mockResolvedValueOnce(null);expect((await adminBi(request(),env))?.status).toBe(401);
  mocks.permission.mockReturnValueOnce(false);expect((await adminBi(request(),env))?.status).toBe(403);expect(mocks.db).not.toHaveBeenCalled();
 });
 it('não permite escrita de indicadores nem acesso técnico pela sessão comum do Admin',async()=>{
  expect((await adminBi(new Request(request(),{method:'POST'}),env))?.status).toBe(405);
  expect((await adminBi(new Request('https://example.com/api/admin/bi/collector/status'),env))?.status).toBe(403);expect(mocks.db).not.toHaveBeenCalled();
 });
 it('sem fonte configurada não inventa zeros e só consulta tabelas BI',async()=>{
  const r=await adminBi(request(),env);expect(r?.status).toBe(200);
  expect(await r?.json()).toEqual({source:'rd_station',scope:'company_commercial',collection:{state:'not_configured',lastSyncedAt:null,historicalComplete:false},metrics:null});expect(tables).toEqual(['bi_sources']);
 });
 it('carga recebida nunca significa indicadores validados ou histórico completo',async()=>{
  mocks.source={id:'qa-source'};mocks.runs=[{mode:'commercial',status:'collected',finished_at:'2026-09-29T20:00:00Z'}];
  const r=await (await adminBi(request(),env))?.json() as import('../src/features/bi/bi-contract').BiOverview;expect(r.collection.state).toBe('received_unvalidated');expect(r.collection.historicalComplete).toBe(false);expect(r.metrics).toBeNull();expect(tables).toEqual(['bi_sources','bi_runs']);
 });
 it('erro de armazenamento não é disfarçado de base vazia',async()=>{mocks.error={message:'QA database error'};expect((await adminBi(request(),env))?.status).toBe(503);});
});
