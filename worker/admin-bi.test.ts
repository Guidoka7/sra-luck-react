import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({session:vi.fn(),actor:vi.fn(),permission:vi.fn(),db:vi.fn()}));
vi.mock('./session',()=>({getCookie:()=>null,verificarTokenAdmin:mocks.session}));
vi.mock('./admin-auth',()=>({buscarColaboradorAdminAtivo:mocks.actor,temPermissaoAdmin:mocks.permission,PERMISSOES_ADMIN:{RELATORIOS_VISUALIZAR:'relatorios.visualizar'}}));
vi.mock('./supabase',()=>({createServiceSupabaseClient:mocks.db}));
import { adminBi } from './admin-bi';
import type { Env } from './supabase';
const env={CLIENTE_SESSION_SECRET:'test'} as Env;
const request=()=>new Request('https://example.com/api/admin/bi/overview');
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({adminId:'qa'});mocks.actor.mockResolvedValue({id:'qa'});mocks.permission.mockReturnValue(true);});
describe('Power BI comercial independente do app',()=>{
  it('nega sessão ausente e falta de permissão',async()=>{
    mocks.session.mockResolvedValueOnce(null);expect((await adminBi(request(),env))?.status).toBe(401);
    mocks.permission.mockReturnValueOnce(false);expect((await adminBi(request(),env))?.status).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it('não permite escrita',async()=>{
    expect((await adminBi(new Request(request(),{method:'POST'}),env))?.status).toBe(405);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it('não usa base operacional como fallback e nunca devolve zeros sem carga do RD',async()=>{
    const response=await adminBi(request(),env);
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({source:'rd_station',scope:'company_commercial',collection:{state:'not_implemented',lastSyncedAt:null,historicalComplete:false},metrics:null});
    expect(mocks.db).not.toHaveBeenCalled();
  });
});
