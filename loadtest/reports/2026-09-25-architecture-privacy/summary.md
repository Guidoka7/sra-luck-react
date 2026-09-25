# Arquitetura e privacidade — estado de 25/09/2026

Escopo: branch `load-test-10k-isolated`, banco **somente** `xqlxzdmleekbrietejoq`, Preview imutável da branch. Nenhum merge ou alteração no projeto de produção `sbohknqapprimtspczio` foi realizado por este trabalho. Integrações externas continuam desligadas.

## Arquitetura

Antes: telas administrativas de finanças baixavam até 5.000 parcelas e 5.000 recebimentos inteiros por requisição, agregavam na Edge e frequentemente ignoravam as outras 115.000 parcelas fictícias. O funil também baixava clientes e vendas completos. O painel de integrações fazia 16 chamadas internas.

Depois: leituras separadas por domínio via RPC de resumo, página de recebíveis, funil e página de recebidos/vencidos. Totais são agregados no banco; a tela pede no máximo 40–100 linhas por página. O perfil completo da cliente é carregado apenas ao abrir o drawer. O painel de integrações faz uma consulta de credenciais e uma RPC de snapshot, além da autorização. As escritas financeiras, idempotência e regras de negócio permanecem no fluxo existente.

No app da cliente, a página já buscava agenda e parcelas em paralelo, mas a aba Financeiro repetia a busca de parcelas para a barra de progresso e para a lista, cada uma com seu próprio polling a cada 30 segundos. Agora as duas usam o mesmo snapshot da página; a configuração de pagamento usa o retorno da configuração que a página já havia buscado. Após anexar um comprovante, a aba solicita uma revalidação única da página. Assim, abrir a aba passa de três GETs internos adicionais para zero; a fonte continua a API autenticada da cliente. A carga periódica de parcelas na aba cai de dois ciclos extras a cada 30 segundos para o ciclo compartilhado da página (60–90 segundos com jitter, além de Realtime e eventos de foco).

| Rota Admin | Chamadas de banco antes* | Depois* | Limite de resposta | Evidência SQL isolada, requisição individual |
| --- | ---: | ---: | --- | --- |
| `/financeiro/resumo` | 3 | 2 | JSON agregado | 708 bytes internos; 481,69 ms |
| `/financeiro/recebiveis` | 3 | 2 | 40, máximo 100 | 10.000 itens totais no mês, página 40; 40,38 ms |
| `/financeiro/clientes` | 5 | 2 | 50, máximo 100 | 10.000 clientes totais, página 50; 282,67 ms |
| `/financeiro/recebidos` | 3 | 2 | 50, máximo 100 | 34.595 vencidos, página 50; 136,87 ms após paginação prévia, 401,72 ms antes |
| `/integrations/status` | 16 | 3 | snapshot específico | Antes ~1.823 ms no smoke anterior, depois ainda sem smoke HTTP |

* Inclui a checagem de colaborador ativo quando a rota é chamada pelo Worker. As medições SQL são `EXPLAIN ANALYZE` isoladas, não p95 sob concorrência. Os p95 antes/depois de cada rota financeira não foram medidos; não devem ser inferidos desses tempos.

## Segurança e minimização

- Migrations 104–108 usam `SECURITY INVOKER`, removem `EXECUTE` de `PUBLIC`, `anon` e `authenticated`, e concedem `EXECUTE` a `service_role`. Apenas o banco de **dados fictícios** recebeu `GRANT EXECUTE` temporário para `anon` fora das migrations, por causa da credencial do Preview de teste. Essa exceção não é uma configuração para produção.
- Segredo temporário do Preview e segredo de assinatura de sessões sintéticas saíram dos arquivos atuais de workflow/k6. O workflow exige `LOADTEST_VERCEL_SHARE` e `LOADTEST_SESSION_SECRET` em GitHub Actions Secrets e falha antes de iniciar carga quando ausentes. O segredo antigo da sessão de teste e URLs de share presentes no histórico da branch devem ser rotacionados/revogados antes de novos ensaios.
- Snapshots de agenda/parcelas e prévia da foto deixam de ficar em `localStorage`; dados da cliente só aparecem depois de validar a sessão. Fila de erros passa a `sessionStorage`. Respostas privadas do Worker recebem `Cache-Control: private, no-store` e proteção contra sniffing e vazamento por Referer.
- O cache de consultas do painel de notificações Admin saiu de `sessionStorage` e agora permanece somente em memória por no máximo 60 segundos. Entradas antigas são removidas da aba e o logout esvazia esse cache.
- O HTML extraiu scripts inline e o Preview recebeu CSP com `script-src 'self'`, `object-src 'none'` e `frame-ancestors 'none'`. Estilos inline ainda são necessários à interface; isso deve ser reavaliado em uma etapa posterior.
- IDs de entidades em logs são ocultados; `request_id` válido é preservado. Telemetria periódica mudou de 60 segundos mais eventos frequentes para janela de 4–6 minutos com jitter e pausa em background. O identificador pseudônimo do aparelho foi mantido porque liga assinaturas push ao dispositivo.
- A chave `anon` do Supabase no bundle é uma chave pública, nunca um segredo. A segurança de dados reais depende de RLS e das regras de autorização. No banco isolado há apenas dados fictícios.

## Validação e pendências

578 testes passaram, TypeScript de frontend e Worker passou e o build Vite passou. Funções SQL foram executadas no banco isolado com os 120.000 boletos fictícios. A carga está pausada. O Preview da arquitetura ficou `READY`, mas o smoke HTTP das novas rotas e uma nova escada de VUs dependem de configurar e rotacionar as duas credenciais de teste fora do repositório; nenhuma taxa de erro ou p95 pós-reforma foi medida em carga. O maior VU estável permanece **não determinado**; o teste antigo de 10.000 foi interrompido em aproximadamente 2 minutos com 17,06% de falhas e não prova capacidade de 10.000.

A meta de conformidade LGPD também requer decisões fora do código: inventário e base legal por finalidade, aviso de privacidade, prazos de retenção, atendimento a titulares, contratos com operadores, revisão periódica de acessos, resposta a incidentes e validação jurídica. Estes controles técnicos não equivalem à certificação legal.

Dev Console `grjjatjnbcxksvftoqiv`: `ACTIVE_HEALTHY` confirmado pelo projeto Supabase em 25/09/2026. Banco isolado `xqlxzdmleekbrietejoq`: `INACTIVE`, mantendo apenas dados fictícios e migrations para continuação. A produção não foi acessada nem alterada por este trabalho.
