# Sra. Luck — carga no ambiente isolado

Perfil: progressive. Shards: 10/10.
Requisições da aplicação: 21850; HTTP incluindo acesso ao Preview: 21890.
Falhas de aplicação: 20 (0.09%); 5xx: 10; 4xx: 10; timeouts: 0; desafios do Preview: 0.
Média HTTP: 298 ms; maior p50/p95/p99 entre shards: 292 ms / 634 ms / 1275 ms; máximo: 6774 ms.
10.000 VUs atingidos em todos os shards: não comprovado. Platô integral testemunhado: não comprovado (0/30 minutos).
Os percentis acima são os piores entre shards; percentis globais não podem ser reconstruídos dos resumos.

## Minutos observados

| Minuto | Requisições | Falhas | 5xx | 4xx | Timeouts | p95 pior shard | p99 pior shard | DB p95 | VUs testemunhados |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 991 | 0.00% | 0 | 0 | 0 | 888 ms | 6341 ms | 815 ms | 250 |
| 1 | 1248 | 0.00% | 0 | 0 | 0 | 683 ms | 926 ms | 578 ms | 250 |
| 2 | 1586 | 0.00% | 0 | 0 | 0 | 634 ms | 740 ms | 543 ms | 479 |
| 3 | 2441 | 0.00% | 0 | 0 | 0 | 607 ms | 777 ms | 532 ms | 500 |
| 4 | 2444 | 0.00% | 0 | 0 | 0 | 767 ms | 1754 ms | 597 ms | 500 |
| 5 | 4472 | 0.00% | 0 | 0 | 0 | 624 ms | 1027 ms | 544 ms | 1000 |
| 6 | 4832 | 0.21% | 0 | 10 | 0 | 503 ms | 696 ms | 362 ms | 1000 |
| 7 | 3834 | 0.26% | 10 | 0 | 0 | 1157 ms | 1951 ms | 1106 ms | 1000 |
| 8 | 2 | 0.00% | 0 | 0 | 0 | 430 ms | 430 ms | 289 ms | 2 |

## Rotas instrumentadas

| Rota | Amostra | Falhas | Taxa | DB calls máximo | p50 pior shard | p95 pior shard | p99 pior shard | DB p95 | Payload máximo (smoke) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| admin_central_visao_geral | 10 | 10 | 100.00% | 1 | 2727 ms | 2727 ms | 2727 ms | 436 ms | n/a |
| admin_monitoramento_app | 10 | 10 | 100.00% | 1 | 253 ms | 253 ms | 253 ms | 159 ms | n/a |
| admin_previsao_liberacoes | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_visao_geral | 10 | 0 | 0.00% | 3 | 2833 ms | 2833 ms | 2833 ms | 2973 ms | n/a |
| client_home_campanhas | 3056 | 0 | 0.00% | 2 | 249 ms | 511 ms | 939 ms | 391 ms | n/a |
| admin_solicitacoes_liberacao | 10 | 0 | 0.00% | 1 | 1358 ms | 1358 ms | 1358 ms | 659 ms | n/a |
| admin_page_clientes | 10 | 0 | 0.00% | n/a | 34 ms | 34 ms | 34 ms | n/a | n/a |
| client_config | 3037 | 0 | 0.00% | 4 | 248 ms | 544 ms | 1300 ms | 538 ms | n/a |
| admin_staff | 10 | 0 | 0.00% | 1 | 825 ms | 825 ms | 825 ms | 323 ms | n/a |
| client_notificacoes_ler_todas | 88 | 0 | 0.00% | 2 | 400 ms | 769 ms | 952 ms | 673 ms | n/a |
| admin_cliente_patch | 68 | 0 | 0.00% | 2 | 774 ms | 1221 ms | 1330 ms | 845 ms | n/a |
| client_notificacoes | 3048 | 0 | 0.00% | 2 | 396 ms | 671 ms | 1431 ms | 640 ms | n/a |
| admin_integrations_status | 10 | 0 | 0.00% | 1 | 4446 ms | 4446 ms | 4446 ms | 202 ms | n/a |
| admin_notificacoes | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_financeiro_clientes | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_clientes | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| client_session | 3018 | 0 | 0.00% | 1 | 247 ms | 476 ms | 1098 ms | 372 ms | n/a |
| admin_agenda_mensal | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_configuracoes | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_session | 10 | 0 | 0.00% | 1 | 730 ms | 730 ms | 730 ms | 407 ms | n/a |
| admin_agendamentos_termos | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_clientes_agendamentos | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_relatorios_catalogo | 10 | 0 | 0.00% | 1 | 1268 ms | 1268 ms | 1268 ms | 439 ms | n/a |
| client_agenda | 3173 | 0 | 0.00% | 2 | 406 ms | 748 ms | 1575 ms | 729 ms | n/a |
| admin_financeiro_recebiveis | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_cirurgias_confirmadas | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_central_cliente | 58 | 0 | 0.00% | 1 | 685 ms | 1089 ms | 1249 ms | 664 ms | n/a |
| client_boletos | 3115 | 0 | 0.00% | 2 | 398 ms | 704 ms | 1842 ms | 578 ms | n/a |
| admin_financeiro_resumo | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_clientes_pagina | 10 | 0 | 0.00% | 2 | 1209 ms | 1209 ms | 1209 ms | 1133 ms | n/a |
| admin_financeiro_validacoes | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_clientes_totais | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| client_page_agenda | 3031 | 0 | 0.00% | n/a | 30 ms | 49 ms | 142 ms | n/a | n/a |
| admin_cliente_boletos | 58 | 0 | 0.00% | 1 | 705 ms | 1837 ms | 1868 ms | 882 ms | n/a |
