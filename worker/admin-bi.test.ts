import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({session:vi.fn(),actor:vi.fn(),permission:vi.fn(),db:vi.fn()}));
vi.mock('./session',()=>({getCookie:()=>null,verificarTokenAdmin:mocks.session}));
vi.mock('./admin-auth',()=>({buscarColaboradorAdminAtivo:mocks.actor,temPermissaoAdmin:mocks.permission,PERMISSOES_ADMIN:{RELATORIOS_VISUALIZAR:'relatorios.visualizar'}}));
vi.mock('./supabase',()=>({createServiceSupabaseClient:mocks.db}));
import { adminBi, lerBaseBi } from './admin-bi';
import { periodoBi } from '../src/features/bi/bi-contract';
import type { Env } from './supabase';
const env={CLIENTE_SESSION_SECRET:'test'} as Env;
const request=(q='')=>new Request('https://example.com/api/admin/bi/overview'+q);
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({adminId:'qa'});mocks.actor.mockResolvedValue({id:'qa'});mocks.permission.mockReturnValue(true);});
describe('BI: segurança e integridade',()=>{
  it('nega sessão ausente e falta de permissão antes de consultar dados',async()=>{
    mocks.session.mockResolvedValueOnce(null);expect((await adminBi(request(),env))?.status).toBe(401);
    mocks.permission.mockReturnValueOnce(false);expect((await adminBi(request(),env))?.status).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it('rejeita mês inválido e não permite escrita',async()=>{
    expect((await adminBi(request('?periodo=2026-13'),env))?.status).toBe(400);
    expect((await adminBi(new Request(request(),{method:'POST'}),env))?.status).toBe(405);
    expect(mocks.db).not.toHaveBeenCalled();
    expect(periodoBi('2026-12')).toEqual({inicio:'2026-12-01',fim:'2027-01-01'});
  });
  it('usa contagem exata, sem limite de registros, e falha parcial não vira zero',async()=>{
    const queries:Array<{table:string;clauses:unknown[][]}>=[];
    const db={from:(table:string)=>{
      const clauses:unknown[][]=[];queries.push({table,clauses});
      const q={select:(...a:unknown[])=>{clauses.push(['select',...a]);return q;},gte:(...a:unknown[])=>{clauses.push(['gte',...a]);return q;},lt:(...a:unknown[])=>{clauses.push(['lt',...a]);return q;},eq:(...a:unknown[])=>{clauses.push(['eq',...a]);return q;},is:(...a:unknown[])=>{clauses.push(['is',...a]);return q;},then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(table==='novas_vendas'?{count:null,error:{message:'private detail'}}:{count:2501,error:null}).then(resolve)};return q;
    }};
    const data=await lerBaseBi(db as never,'2026-09');
    expect(data.metrics[0].value).toBe(2501);
    expect(data.metrics[1].value).toBeNull();
    expect(JSON.stringify(data)).not.toContain('private detail');
    expect(data.externalCollection).toBe('not_implemented');
    expect(queries.every(q=>JSON.stringify(q.clauses[0])===JSON.stringify(['select','id',{count:'exact',head:true}]))).toBe(true);
    expect(queries[0].clauses).toContainEqual(['gte','created_at','2026-09-01T00:00:00-03:00']);
    expect(queries[0].clauses).toContainEqual(['lt','created_at','2026-10-01T00:00:00-03:00']);
  });
});
