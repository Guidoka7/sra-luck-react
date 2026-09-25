# Sra. Luck — carga no ambiente isolado

Perfil: progressive. Shards: 10/10.
Requisições da aplicação: 18894; HTTP incluindo acesso ao Preview: 18934.
Falhas de aplicação: 1827 (9.67%); 5xx: 1817; 4xx: 10; timeouts: 0; desafios do Preview: 0.
Média HTTP: 2900 ms; maior p50/p95/p99 entre shards: 395 ms / 25094 ms / 25106 ms; máximo: 25461 ms.
10.000 VUs atingidos em todos os shards: não comprovado. Platô integral testemunhado: não comprovado (0/30 minutos).
Os percentis acima são os piores entre shards; percentis globais não podem ser reconstruídos dos resumos.

## Minutos observados

| Minuto | Requisições | Falhas | 5xx | 4xx | Timeouts | p95 pior shard | p99 pior shard | DB p95 | VUs testemunhados |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 965 | 0.00% | 0 | 0 | 0 | 1124 ms | 6020 ms | 1317 ms | 250 |
| 1 | 1229 | 0.00% | 0 | 0 | 0 | 831 ms | 1182 ms | 1238 ms | 250 |
| 2 | 1570 | 0.00% | 0 | 0 | 0 | 683 ms | 991 ms | 967 ms | 472 |
| 3 | 2436 | 0.00% | 0 | 0 | 0 | 664 ms | 2012 ms | 951 ms | 500 |
| 4 | 2436 | 0.00% | 0 | 0 | 0 | 630 ms | 1422 ms | 930 ms | 500 |
| 5 | 4356 | 0.00% | 0 | 0 | 0 | 6658 ms | 12986 ms | 7574 ms | 1000 |
| 6 | 4595 | 14.62% | 662 | 10 | 0 | 25097 ms | 25117 ms | 2924 ms | 1000 |
| 7 | 1298 | 88.37% | 1147 | 0 | 0 | 25114 ms | 25188 ms | n/a | 971 |
| 8 | 9 | 88.89% | 8 | 0 | 0 | 25098 ms | 25098 ms | n/a | 9 |

## Rotas instrumentadas

| Rota | Amostra | Falhas | Taxa | DB calls máximo | p50 pior shard | p95 pior shard | p99 pior shard | DB p95 | Payload máximo (smoke) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| client_agenda | 2818 | 391 | 13.88% | 6 | 601 ms | 25096 ms | 25115 ms | 6091 ms | n/a |
| client_session | 2674 | 317 | 11.85% | 1 | 249 ms | 25097 ms | 25114 ms | 2210 ms | n/a |
| client_boletos | 2696 | 307 | 11.39% | 2 | 404 ms | 25097 ms | 25119 ms | 2044 ms | n/a |
| client_home_campanhas | 2611 | 272 | 10.42% | 2 | 396 ms | 25095 ms | 25108 ms | 1899 ms | n/a |
| client_config | 2597 | 250 | 9.63% | 2 | 411 ms | 25094 ms | 25109 ms | 2283 ms | n/a |
| client_notificacoes | 2585 | 245 | 9.48% | 2 | 400 ms | 25095 ms | 25103 ms | 2098 ms | n/a |
| admin_session | 10 | 10 | 100.00% | n/a | 25097 ms | 25097 ms | 25097 ms | n/a | n/a |
| admin_cliente_boletos | 61 | 10 | 16.39% | 1 | 1462 ms | 21642 ms | 24374 ms | 3069 ms | n/a |
| admin_monitoramento_app | 10 | 10 | 100.00% | 1 | 561 ms | 561 ms | 561 ms | 481 ms | n/a |
| admin_cliente_patch | 61 | 10 | 16.39% | 2 | 731 ms | 21445 ms | 24372 ms | 485 ms | n/a |
| client_notificacoes_ler_todas | 75 | 5 | 6.67% | 2 | 391 ms | 16498 ms | 23365 ms | 516 ms | n/a |
| admin_clientes | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_central_visao_geral | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| client_page_agenda | 2595 | 0 | 0.00% | n/a | 28 ms | 45 ms | 224 ms | n/a | n/a |
| admin_relatorios_catalogo | 10 | 0 | 0.00% | 1 | 384 ms | 384 ms | 384 ms | 156 ms | n/a |
| admin_agenda_mensal | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_clientes_pagina | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_solicitacoes_liberacao | 10 | 0 | 0.00% | 1 | 559 ms | 559 ms | 559 ms | 171 ms | n/a |
| admin_cirurgias_confirmadas | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_integrations_status | 10 | 0 | 0.00% | 1 | 21552 ms | 21552 ms | 21552 ms | 5374 ms | n/a |
| admin_page_clientes | 10 | 0 | 0.00% | n/a | 53 ms | 53 ms | 53 ms | n/a | n/a |
| admin_financeiro_validacoes | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_configuracoes | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_visao_geral | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_previsao_liberacoes | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_financeiro_resumo | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_central_cliente | 51 | 0 | 0.00% | 1 | 943 ms | 2508 ms | 2822 ms | 1249 ms | n/a |
| admin_financeiro_recebiveis | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_financeiro_clientes | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_clientes_agendamentos | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_notificacoes | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_staff | 10 | 0 | 0.00% | 1 | 627 ms | 627 ms | 627 ms | 172 ms | n/a |
| admin_clientes_totais | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_agendamentos_termos | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
