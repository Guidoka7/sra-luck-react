import { afterEach, expect, it, vi } from 'vitest';
import type { Env } from './supabase';
const cofre = vi.hoisted(() => ({ token: 'antigo' }));
vi.mock('./integrations-credenciais', () => ({
  obterCredencial: vi.fn(async (_e, _p, chave) => chave === 'access_token' ? cofre.token : 'credencial-teste'),
  obterCredencialParaValidacao: vi.fn(async () => 'credencial-teste'),
  salvarCredencialInterna: vi.fn(async (_e, _p, chave, valor) => { if (chave === 'access_token') cofre.token = valor; }),
}));
import { rdGet, erroOpcoesRd } from './rd-station-readonly';
afterEach(() => { vi.unstubAllGlobals(); cofre.token = 'antigo'; });
it('três consultas paralelas renovam uma só vez e repetem os GETs', async () => {
  let renovacoes = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith('/oauth2/token')) {
      renovacoes++;
      await new Promise((r) => setTimeout(r, 15));
      return Response.json({ access_token: 'novo', refresh_token: 'refresh-novo', expires_in: 7200 });
    }
    return (options.headers as Record<string, string>).Authorization === 'Bearer antigo'
      ? new Response('{}', { status: 401 }) : Response.json({ data: [{ id: 'qa' }] });
  }));
  const resultados = await Promise.all(['/pipelines', '/contacts', '/custom_fields'].map((path) => rdGet({} as Env, path)));
  expect(renovacoes).toBe(1);
  expect(resultados.every((r) => r.data[0].id === 'qa')).toBe(true);
});
it('401 atrasado reutiliza o token já renovado por outra chamada', async () => {
  let oauth = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith('/oauth2/token')) { oauth++; throw Error('não deve renovar'); }
    if ((options.headers as Record<string, string>).Authorization === 'Bearer antigo') {
      cofre.token = 'novo'; return new Response('{}', { status: 401 });
    }
    return Response.json({ data: [] });
  }));
  await expect(rdGet({} as Env, '/pipelines')).resolves.toEqual({ data: [] });
  expect(oauth).toBe(0);
});
it('erro orienta o usuário sem expor detalhes desconhecidos', () => {
  expect(erroOpcoesRd(new Error('RD_OAUTH_HTTP_400'))).toMatchObject({ codigo: 'RD_OAUTH_HTTP_400' });
  expect(erroOpcoesRd(new Error('segredo privado')).erro).not.toContain('segredo privado');
});
