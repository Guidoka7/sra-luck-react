# Recepção comercial do Power BI — 29/09/2026

Classificação: NOVO. Continuação do visual aprovado e mergeado no PR #79. Base desta alteração: a `main` que contém o visual aprovado; a antiga `develop` diverge em centenas de commits e não contém o BI. Não transportar mudanças de outros domínios entre essas branches.

## Fluxo entregue

RD CRM v2 → Console (OAuth e GETs paginados) → ponte M2M → tabelas `bi_*` no banco principal. As credenciais OAuth permanecem exclusivamente no banco do Console. O token do n8n permite somente processar a próxima página de uma carga existente.

A API `/api/admin/bi/collector/*` exige identidade técnica autenticada do Console; uma sessão comum do Admin não basta. O Admin só consulta disponibilidade via `/api/admin/bi/overview`, com `relatorios.visualizar`. Coleta recebida não equivale a indicador validado: `metrics` permanece `null`, `historicalComplete` permanece `false`.

## Contrato por ação

| Ação | Método | Persistência / resposta |
|---|---|---|
| register | POST | Ativa uma identidade de conexão RD, sem juntar contas anteriores. |
| mapping | POST | Versão esperada, mapeamento por funil e autor; conflito retorna 409. |
| start | POST | Inicia/reutiliza carga catalog/commercial; guarda o mapeamento usado. |
| claim | POST | Lease exclusivo de 120 s. Outro executor recebe 409. |
| commit | POST | Lote, registros, versões observadas e checkpoint numa única transação. |
| fail | POST | Erro sanitizado, contexto de página, retentativa; pausa após 5 falhas consecutivas. |
| resume | POST | Retoma a carga pausada, preservando checkpoint. |
| status/catalog/issues | GET | Estado, catálogo paginado e quarentena paginada; sem tokens. |

Registros identificados por `(source_id, entity, external_id)`. Contato, negócio, reunião e tarefa mantêm seus próprios IDs. Repetir um lote retorna o recibo original. O corpo é limitado a 2 MB e 100 registros; cada registro tem campos permitidos e hash SHA-256 conferido no receptor. Oversize, ID duplicado ou resposta inválida interrompem a página e mantêm seu checkpoint para correção, sem descarte silencioso.

Versão externa atrasada fica em quarentena com seu conteúdo. Mesmo timestamp com conteúdo diferente também fica, salvo mudança explícita na versão do mapeamento (nova projeção). Versões observadas não provam transições antigas que o RD não disponibilizou. Problemas em quarentena permanecem históricos nesta entrega; resolução operacional é fase seguinte.

## Dados recebidos

- Catálogos: funis, etapas de cada funil, fontes, campanhas, usuários, campos personalizados e motivos de perda.
- Comercial: contatos, negociações, reuniões e tarefas, sem filtro por cadastro no app ou elegibilidade financeira.
- Negociação preserva `total_price`, `one_time_price`, `recurrence_price`, situação, datas, IDs de contato, funil, etapa, responsável, fonte, campanha e motivo de perda.
- Campos personalizados só entram quando selecionados no mapeamento do funil. SDR, vendedora e vendedora da reunião exigem campo personalizado explícito; não há fallback para owner. Campos não escolhidos exigem releitura após serem mapeados.
- Telefones, e-mails, notas e documentos não são copiados por padrão. Não se trata de um backup integral do CRM.

## Instalação e rollback

1. Aplicar `supabase/migrations/20260929204811_bi_commercial_ingestion.sql` somente no banco principal. É uma migração aditiva, sem leitura/alteração de clientes, novas_vendas, parcelas, agenda ou ledger.
2. Publicar backend do App; publicar o Console com sua migration independente `20260929204824_bi_console_oauth.sql` no banco técnico.
3. Configurar chaves e consentimento no Console, conferir catálogo, selecionar campos e só então iniciar a coleta real.

Rollback operacional: interromper chamadas de automação, reverter o commit do coletor e a versão do Console. Manter as tabelas e versões recebidas preservadas com RLS e sem grants para anon/authenticated. Não é necessário desfazer nenhuma mudança no schema operacional nem apagar os dados BI. Uma reversão que elimine tabelas exige revisão separada.

## Validação reproduzível

`npm run lint`, `npm test`, `npm run build`.

Banco isolado (sem rede, dados/credenciais reais): instalar `@electric-sql/pglite@0.5.8` em diretório temporário e executar:

```sh
PGLITE_MODULE=/tmp/bi-db-qa/node_modules/@electric-sql/pglite/dist/index.js node qa/bi/ingestion-db.mjs
```

Cobre idempotência, lease concorrente, CAS de mapeamento, atraso/conflito, rollback forçado no meio do lote, alteração de projeção, retentativa/pausa e bloqueio de tabela/RPC para anon e authenticated.

## Limites antes de liberar indicadores

A primeira carga precisa ser confrontada com a conta RD real, incluindo permissões, quantidades, campos e totais por janela. Paginação usa janelas particionadas antes do teto de 10 mil contatos/negociações por filtro do RD. Janela mínima demasiado densa interrompe com `BI_RD_WINDOW_TOO_DENSE`; nunca é marcada como completa.

Ainda não entregues: atribuição homologada a pessoas/papéis, resolução de duplicatas entre IDs diferentes, cálculo dos indicadores, reconstrução de histórico anterior à coleta, captura de exclusões, webhooks e agendamento recorrente de novas cargas. O coletor aceita recarga incremental por `updated_at` informando `since`; o operador escolhe a janela. Paginação não é snapshot transacional do RD; atualizações durante a leitura exigem reconciliação/releitura com sobreposição. O n8n ainda precisa de instância e workflow configurados. Conta Azul/financeiro permanece para a fase seguinte.

Referências verificadas: https://developers.rdstation.com/reference/crm-v2-introduction ; https://developers.rdstation.com/reference/crm-v2-list-deals ; https://developers.rdstation.com/reference/crm-v2-list-custom-fields ; autenticação OAuth passos 2–4 da mesma documentação.

Instalação verificada em 29/09/2026: migration registrada como `20260929204811_bi_commercial_ingestion`. As 7 tabelas têm RLS e nenhum SELECT para anon/authenticated. Nenhuma fonte nem registro comercial criado. Arquivo alinhado à versão registrada pelo conector Supabase.

Advisor de segurança: somente aviso informativo “RLS Enabled No Policy” nas tabelas novas, esperado para acesso exclusivo via service_role e grants revogados aos clientes. Referência: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy .
