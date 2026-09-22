# Revisão de segurança do runtime — 22/09/2026

Base: `ac9ed8c140a545dd1808b3571beeeb966451b09f`, branch `main`, inicialmente limpa e sincronizada. Trabalho direto na main, sem PR, reset ou merge. O fetch anterior ao commit confirmou a mesma base remota.

## Escopo e invariantes

Varredura de todos os `worker/*.ts`, incluindo métodos HTTP, autenticação, service role, RPCs, queries, mutações, chamadas externas, auditoria e respostas de erro. Revisão também do adaptador `api/index.ts`, headers Vercel e metadados do Supabase `sbohknqapprimtspczio`.

Não foram alteradas regras de negócio V46, migrations históricas, tiers, cinco dias úteis, teto mensal de R$100.000, advisory locks, quitação, comparecimento, extensões, `data_cirurgia` ou agendas. GETs de agenda continuam sem processar liberações. Nenhuma alteração visual ou dependência nova.

## Falhas corrigidas

| Achado | Correção |
|---|---|
| Leituras administrativas sensíveis aceitavam sessão ativa sem permissão granular | Matriz de permissões no roteador antes dos handlers GET/HEAD |
| Observações de recebíveis sem autorização específica | `FINANCEIRO_BAIXA_MANUAL` antes da mutação |
| Login com consulta e incremento separados; primeira criação concorrente do rate limit | Consumo atômico antes da autenticação e migration 068 com INSERT ON CONFLICT seguido de bloqueio de linha |
| Login bem-sucedido podia limpar quota compartilhada de IP | Sucesso não limpa contadores de segurança |
| Cabeçalho Cloudflare falsificável no adaptador Vercel | Remove cabeçalhos não confiáveis e usa o X-Forwarded-For sobrescrito pela Vercel |
| Limites baseados só em Content-Length/MIME eram contornáveis | Leitura incremental com contagem real de bytes antes dos parsers |
| Proteções same-origin espalhadas/incompletas | Proteção central para mutações admin/cliente/equipe e telemetria; Origin ausente aceito; webhooks usam autenticação própria |
| Erros SQL/Supabase/provedores retornados por diversos módulos | Mensagens públicas estáveis, mantendo mapeamentos explícitos de domínio |
| Alteração de colaborador e auditoria podiam divergir | Migration 069: mutação e log atômicos, com revalidação de ator, cargo, alvo e permissões dentro da transação |
| Concorrência entre pagamento e upload/remoção de comprovante | UPDATE condicionado ao proprietário, status e referência anterior; conflito 409 e limpeza somente do novo upload |
| Upsert de push podia trocar proprietário numa corrida | INSERT ou UPDATE vinculado ao cliente; conflito de unicidade não transfere assinatura |
| Redirecionamento HTTP no envio de push poderia sair da allowlist | `redirect: error`, mantendo validação no cadastro e no envio |
| ID de pagamento do corpo não estava necessariamente coberto pela assinatura | Consulta somente pelo ID da query assinado; evento sem ID assinado recusado |
| Corpo completo de pagamento externo e duplicação de PII em auditoria | Payload mínimo de pagamento; logs por entidade/campos, sem nome de arquivo, texto redundante de observação ou nome completo |
| Estado OAuth com segmentos extras ou expiração malformada | Exatamente dois segmentos, limite de tamanho, expiração finita e limitada; colaborador revalidado no callback |
| Telemetria armazenava stack; arquivos estáticos sem todos os headers | Stack descartada/omitida, sanitização adicional; headers globais antes do filesystem |

## Matriz administrativa

O papel `administrativo` mantém o acesso integral já definido no projeto. `gestao` e `financeiro` exigem permissões explícitas. Todos passam por sessão assinada e colaborador ativo. Nenhuma permissão nova foi criada.

| Módulos/rotas | Permissões existentes |
|---|---|
| `admin-api`: clientes, status, liberação de app, exclusão | `CLIENTES_EDITAR`, `CLIENTES_ALTERAR_STATUS_CONTRATO`, `CLIENTES_LIBERAR_ACESSO_APP`, `CLIENTES_EXCLUIR` conforme ação |
| `admin-novas-vendas`: CRM local | `CLIENTES_EDITAR` para alterações; leitura compatível com atendimento/financeiro/agenda |
| `admin-finance`, `admin-financeiro`, `admin-parcelas`, `admin-carnes` | Revisão, baixa manual ou validação de comprovantes conforme operação |
| `admin-agenda-central`, `admin-surgery-flow`, `agendamento-acoes`, datas e remarcações | `AGENDA_GERENCIAR`; ações financeiras continuam com suas permissões específicas |
| `admin-reports`, `admin-relatorios`, `admin-visao-geral` | Visualização/exportação de relatórios; agenda nos relatórios operacionais de agenda |
| `staff-api` e `credit-ops/team` | `EQUIPE_GERENCIAR`; apenas administrativo concede permissões ou altera cargos elevados |
| `credit-ops` contratos/recompensas | `CREDITO_GERENCIAR`; relatório financeiro diário exige permissão financeira |
| `journey` | Agenda, revisão financeira e baixa manual conforme ação |
| `admin-notificacoes` | `NOTIFICACOES_GERENCIAR`; acesso dedicado a comprovantes preserva validação financeira |
| Configurações | `CONFIGURACOES_GERENCIAR` |
| Monitoramento/diagnóstico | `MONITORAMENTO_VISUALIZAR` |
| Integrações, credenciais, RD, configuração push | `INTEGRACOES_GERENCIAR_CREDENCIAIS` |
| Operações Conta Azul | `INTEGRACOES_OPERAR_FINANCEIRO` |
| Automação interna de notificações | Segredo próprio no header, não cookie nem query |

`admin-route-permissions.ts` contém a matriz executável de leitura. Os handlers mantêm a autorização específica para cada mutação. Rotas inexistentes não ganham acesso a dados pelo resolver.

## Cliente, sessões e entradas

`client-boletos`, `client-agenda`, `client-config`, `client-notificacoes`, `client-push`, `credit-ops`, `journey` e `agendamento-acoes`: identidade da sessão e filtros de propriedade no backend. IDOR de comprovantes retorna 404 antes de storage; notificações, benefícios, contratos e subscriptions usam o proprietário da sessão. Agendas consultam ocupação agregada, sem expor dados de outras clientes.

Sessões preservam HMAC, comparação constante, dois segmentos, tamanho máximo 8192, iat obrigatório, tolerância futura de cinco minutos e expiração. Cookies HttpOnly, SameSite=Lax e Secure em HTTPS; admin/equipe com Path restrito. A desativação administrativa é revalidada no backend.

Ingress: autenticação até 16KiB; JSON genérico 256KiB; integrações 512.000 bytes e RD 1.000.000. Telemetria tem teto no ingress e limite específico do handler. Multipart tem limites próprios com espaço para envelope: recibo cliente 6MiB, recibo admin 9MiB, perfil 5MiB e PDF de importação 21MiB. O arquivo de comprovante da cliente continua limitado a 5MiB, PDF/JPEG/PNG com assinatura de conteúdo, nome UUID gerado pelo servidor e `upsert:false`.

Login: quotas de IP e identificador HMAC (sem CPF/e-mail em claro), consumo transacional, falha do banco impede autenticação. Telemetria pública mantém `rate_limit_consumir`, 60 eventos/900s. Proteção de IP da Vercel documentada em https://vercel.com/docs/headers/request-headers.

## Integrações e logs

Webhook RD: segredo no header, comparação constante, limite de body; segredo na query não autentica. Mercado Pago: HMAC sobre o ID notificado na query, sem confiança no corpo para escolher pagamento. Protocolo conforme https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/notifications/webhooks. Nenhuma baixa automática foi introduzida.

OAuth RD mantém state assinado e revalida colaborador ativo e RBAC antes de trocar/persistir tokens. Credenciais novas continuam AES-GCM com domínio `sra-luck:integrations-credentials:v2:`; derivação legada somente para leitura. Tokens seguem em headers/body de protocolo, nunca em logs ou query de webhook. Conta Azul retorna apenas protocolo/status operacional.

Push mantém allowlist dos provedores conhecidos nos dois lados e impede redirects. Logs passam pelo sanitizador existente; auditoria usa IDs/campos/valores operacionais. Trigger LGPD existente no banco permanece ativo. Histórico não foi apagado. Observações intencionais que são conteúdo operacional continuam sob o controle LGPD existente.

## Supabase, storage e migrations

Auditoria de metadados, sem consulta a dados de clientes:

- Todas as tabelas públicas com RLS. Sem grants de tabelas públicas nem EXECUTE de funções públicas para anon/authenticated.
- View `vw_notificacoes_resumo` com security_invoker e sem SELECT público.
- Buckets `boletos-clientes` e `clientes-perfil` privados; sem policies de storage amplas. Grants internos do esquema storage preservados; RLS/policies continuam delimitando acesso.
- Comprovantes por backend/service role e signed URL de 300s; sem URL pública financeira.
- Extensões existentes em pg_catalog/extensions/vault; nenhuma extensão adicionada.
- Migration **068** aplicada: primeira utilização concorrente de `rate_limit_consumir`.
- Migration **069** aplicada: `admin_salvar_colaborador_auditado`, restrita a service_role. Criação/PATCH e auditoria são uma transação. O ator vem da sessão verificada, nunca do frontend.
- Nenhuma migration histórica editada; nenhuma policy alterada; sem DROP/TRUNCATE/reset.
- `agenda-v46-liberacoes` ativo a cada minuto, execuções recentes bem-sucedidas. `agenda_processar_liberacoes_v46` sem EXECUTE público.

Advisors: 48 INFO de RLS sem policy, compatíveis com Worker/service role; WARN preexistente de proteção contra senhas vazadas desativada. Esse ajuste de Auth não foi alterado por SQL.

## Evidências de teste

- Suite Vitest com handlers reais, mock apenas da fronteira Supabase/provedor: RBAC, escalada POST/PATCH, cookies inválidos, sessões, CSRF, JSON em stream com comprimento forjado, multipart, erros internos, IDOR, signed URL, corrida no upload, push arbitrário, OAuth e criptografia.
- Regressões adicionais em `security-rbac-regression.test.ts` exercitam a matriz de permissões.
- SQL `supabase/tests/security_staff_atomic_audit.sql`: criação e edição válidas com log, escalada negada, ator inativo negado e EXECUTE público negado. Dados sintéticos criados dentro da transação e revertidos com ROLLBACK.
- Rate limit: 12 chamadas concorrentes para chave exclusiva de QA com limite 3 resultaram em 3 permitidas e 9 negadas, sem erro. Chave removida ao concluir.
- 16 arquivos / 203 testes aprovados. TypeScript e build de produção executados; auditoria `npm audit --omit=dev --audit-level=high` sem vulnerabilidades. Resultados finais de contagem, CI, SHA e deploy acompanham a entrega.

## Limites da validação

Testes locais com fixtures não equivalem a usar contas reais. Nenhuma senha de cliente/admin foi obtida para QA. Fluxos reais de pagamento, emissão Conta Azul, troca OAuth e entrega de push não são disparados para testar segurança. Testes de produção ficam limitados a requisições sem efeito de negócio, autenticação inválida e consulta de saúde. Não foi feito pentest externo independente.

Permanece o WARN do Supabase Auth sobre senhas vazadas. O mecanismo de login da cliente existente no produto não foi reformulado. Credenciais antigas seguem legíveis para compatibilidade, e histórico antigo não foi reescrito. Estes limites devem acompanhar qualquer avaliação operacional de risco; esta revisão não é uma garantia de ausência universal de vulnerabilidades.

## Arquivos alterados

- `api/index.ts`
- `docs/SECURITY-HARDENING-2026-09-22.md`
- `supabase/migration_068_security_rate_limit_first_use.sql`
- `supabase/migration_069_security_staff_atomic_audit.sql`
- `supabase/tests/security_staff_atomic_audit.sql`
- `vercel.json`
- `worker/admin-agenda-central.ts`
- `worker/admin-api.ts`
- `worker/admin-auth.ts`
- `worker/admin-carnes.ts`
- `worker/admin-finance.ts`
- `worker/admin-financeiro.ts`
- `worker/admin-notificacoes.ts`
- `worker/admin-novas-vendas.ts`
- `worker/admin-parcelas.ts`
- `worker/admin-relatorios.ts`
- `worker/admin-reports.ts`
- `worker/admin-route-permissions.ts`
- `worker/admin-surgery-flow.ts`
- `worker/admin-visao-geral.ts`
- `worker/client-boletos.ts`
- `worker/client-push.ts`
- `worker/credit-ops.ts`
- `worker/http-security.ts`
- `worker/index.ts`
- `worker/integrations-core.ts`
- `worker/journey.ts`
- `worker/logger.ts`
- `worker/monitoramento-erros.ts`
- `worker/monitoramento-preventivo.ts`
- `worker/rd-station-readonly.ts`
- `worker/security-rbac-regression.test.ts`
- `worker/security-runtime.test.ts`
- `worker/session.test.ts`
- `worker/staff-api.ts`
- `worker/web-push-sender.ts`
