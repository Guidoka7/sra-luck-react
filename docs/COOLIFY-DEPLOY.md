# Hospedagem paralela no Coolify

O Dockerfile serve o frontend Vite e o mesmo bundle de API gerado pelo build
atual. O banco, Auth e Storage continuam no Supabase de produção. Esta
preparação não altera dados, migrations, domínios ou o deploy da Vercel.

## Aplicação de homologação

1. No Coolify, conecte `Guidoka7/sra-luck-react` como **Application / Dockerfile**
   na revisão que será testada. Use porta **3000** e domínio HTTPS separado.
2. Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` como variáveis
   disponíveis **durante o build**. São valores públicos do frontend.
3. Configure `PUBLIC_APP_URL` com a origem HTTPS dessa homologação. Configure
   os segredos de API, sessão, integrações e web push como variáveis **somente
   de runtime**, usando os nomes de `.env.local.example` e `api/index.ts`.
   Nunca cole a service role em `VITE_*`, build args, Dockerfile ou Git.
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `CLIENTE_SESSION_SECRET` são
   obrigatórios; sem eles o contêiner não inicia.
4. Ative HTTPS, deploy automático só depois do primeiro smoke, e limite de
   recursos compatível com o servidor. O Dockerfile tem health check em
   `/api/health`; ele testa disponibilidade da API, não os fluxos reais.
5. Se o servidor também fizer builds, deixe apenas um build por vez; monitore
   CPU, RAM e disco durante o build. Um servidor de build separado evita que
   compilar o frontend prejudique requisições de produção.

## Rotinas agendadas

O `vercel.json` agenda dois GETs. No Coolify, crie **Scheduled Tasks** na
aplicação, com o servidor configurado em UTC ou ajuste os horários para seu
fuso. Cada tarefa roda dentro do contêiner e exige seu segredo de runtime:

| Frequência UTC | Comando | Variável necessária |
| --- | --- | --- |
| `5 3 * * *` | `node server/run-cron.mjs mensagem-do-dia` | `CRON_SECRET` |
| `5 11 * * *` | `node server/run-cron.mjs notificacoes-financeiras` | `NOTIFICACOES_CRON_SECRET` |

Ative as tarefas apenas após verificar que a Vercel não executará os mesmos
crons, evitando envios duplicados. Verifique a primeira execução e o histórico
de cada tarefa antes de mudar o domínio.

## Endereços e integrações

Antes da troca de domínio, inventarie os destinos atualmente configurados:

- O segredo `sra_luck_app_url` do Supabase Vault é usado por rotinas do banco
  (`migration_091` e `migration_093`) para chamar a API. Atualize o valor com
  operação controlada **após** o novo endpoint estar testado, sem criar migration
  nova só para trocar URL. Confirme a execução posterior desses jobs.
- No Painel DEV, confirme a URL da API Sra. Luck e o token M2M. Ele é outra
  aplicação e não é transferido pelo Dockerfile deste repositório.
- Revise URLs de webhook e OAuth nos provedores RD Station, Conta Azul,
  Mercado Pago e bancos que estiverem ativos. Mude cada callback somente
  depois de testar HTTPS e autenticação no domínio novo.
- Web Push e service workers pertencem à origem do navegador: valide a
  inscrição de push no domínio novo. Uma inscrição da origem antiga não se
  transfere automaticamente.

## Gate antes da troca de domínio

- Confirmar SHA publicado, `/api/health`, páginas estáticas e assets, e
  resposta 401 de rota Admin sem sessão.
- Testar com contas de homologação: login/logout da cliente e Admin, drawer
  financeiro, comprovantes PDF/imagem, upload, carnês, termos, agenda
  cirúrgica, notificações e acesso do Painel DEV.
- Abrir Console e Network no navegador, conferir 4xx/5xx, tempo das chamadas,
  cookies, permissões e URLs de Storage. Não usar dados reais em screenshots.
- Monitorar logs e CPU sob tráfego pequeno. Só então apontar o domínio para
  Coolify. Guarde a imagem validada e o plano de retorno; a Vercel pausada não
  serve como rollback disponível neste momento.

O Painel DEV é outro repositório e precisa de aplicação própria no Coolify.
Não migrar PostgreSQL/Supabase junto com a hospedagem do frontend/API.
