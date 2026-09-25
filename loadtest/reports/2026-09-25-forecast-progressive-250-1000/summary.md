# Sra. Luck — carga no ambiente isolado

Perfil: progressive. Shards: 10/10.
Requisições da aplicação: 21889; HTTP incluindo acesso ao Preview: 21929.
Falhas de aplicação: 1 (0.00%); 5xx: 1; 4xx: 0; timeouts: 0; desafios do Preview: 0.
Média HTTP: 287 ms; maior p50/p95/p99 entre shards: 290 ms / 613 ms / 1024 ms; máximo: 10069 ms.
10.000 VUs atingidos em todos os shards: não comprovado. Platô integral testemunhado: não comprovado (0/30 minutos).
Os percentis acima são os piores entre shards; percentis globais não podem ser reconstruídos dos resumos.

## Minutos observados

| Minuto | Requisições | Falhas | 5xx | 4xx | Timeouts | p95 pior shard | p99 pior shard | DB p95 | VUs testemunhados |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 968 | 0.00% | 0 | 0 | 0 | 699 ms | 5809 ms | 651 ms | 250 |
| 1 | 1223 | 0.00% | 0 | 0 | 0 | 2218 ms | 5781 ms | 2327 ms | 250 |
| 2 | 1569 | 0.00% | 0 | 0 | 0 | 631 ms | 970 ms | 580 ms | 470 |
| 3 | 2437 | 0.00% | 0 | 0 | 0 | 599 ms | 750 ms | 530 ms | 500 |
| 4 | 2452 | 0.00% | 0 | 0 | 0 | 582 ms | 984 ms | 540 ms | 500 |
| 5 | 4424 | 0.00% | 0 | 0 | 0 | 613 ms | 967 ms | 540 ms | 1000 |
| 6 | 4870 | 0.00% | 0 | 0 | 0 | 549 ms | 913 ms | 480 ms | 1000 |
| 7 | 3929 | 0.03% | 1 | 0 | 0 | 614 ms | 1052 ms | 607 ms | 1000 |
| 8 | 17 | 0.00% | 0 | 0 | 0 | 450 ms | 462 ms | 301 ms | 17 |

## Rotas instrumentadas

| Rota | Amostra | Falhas | Taxa | DB calls máximo | p50 pior shard | p95 pior shard | p99 pior shard | DB p95 | Payload máximo (smoke) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| admin_visao_geral | 18 | 1 | 5.56% | 3 | 1072 ms | 3312 ms | 3512 ms | 3417 ms | n/a |
| client_agenda | 3208 | 0 | 0.00% | 2 | 396 ms | 650 ms | 1266 ms | 567 ms | n/a |
| client_notificacoes_ler_todas | 108 | 0 | 0.00% | 2 | 400 ms | 1831 ms | 3602 ms | 1740 ms | n/a |
| admin_clientes | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_financeiro_resumo | 13 | 0 | 0.00% | 3 | 1231 ms | 1231 ms | 1231 ms | 1182 ms | n/a |
| client_session | 3004 | 0 | 0.00% | 1 | 244 ms | 485 ms | 830 ms | 388 ms | n/a |
| admin_session | 20 | 0 | 0.00% | 1 | 528 ms | 578 ms | 584 ms | 165 ms | n/a |
| client_notificacoes | 3038 | 0 | 0.00% | 2 | 389 ms | 661 ms | 1316 ms | 576 ms | n/a |
| admin_clientes_pagina | 16 | 0 | 0.00% | 2 | 527 ms | 716 ms | 745 ms | 668 ms | n/a |
| admin_cliente_patch | 29 | 0 | 0.00% | 2 | 702 ms | 4201 ms | 7590 ms | 465 ms | n/a |
| admin_agendamentos_termos | 12 | 0 | 0.00% | 1 | 1061 ms | 1061 ms | 1061 ms | 175 ms | n/a |
| admin_cirurgias_confirmadas | 16 | 0 | 0.00% | 1 | 718 ms | 718 ms | 718 ms | 403 ms | n/a |
| admin_solicitacoes_liberacao | 12 | 0 | 0.00% | 1 | 1089 ms | 1587 ms | 1631 ms | 292 ms | n/a |
| admin_financeiro_validacoes | 13 | 0 | 0.00% | 3 | 826 ms | 826 ms | 826 ms | 886 ms | n/a |
| admin_staff | 12 | 0 | 0.00% | 1 | 1097 ms | 1097 ms | 1097 ms | 172 ms | n/a |
| client_boletos | 3114 | 0 | 0.00% | 2 | 393 ms | 652 ms | 1134 ms | 561 ms | n/a |
| admin_page_clientes | 21 | 0 | 0.00% | n/a | 27 ms | 78 ms | 84 ms | n/a | n/a |
| admin_monitoramento_app | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_configuracoes | 12 | 0 | 0.00% | 2 | 408 ms | 437 ms | 439 ms | 299 ms | n/a |
| admin_agenda_mensal | 13 | 0 | 0.00% | 2 | 910 ms | 1019 ms | 1028 ms | 669 ms | n/a |
| admin_central_visao_geral | 17 | 0 | 0.00% | 2 | 1036 ms | 1036 ms | 1036 ms | 937 ms | n/a |
| admin_clientes_agendamentos | 18 | 0 | 0.00% | 2 | 1080 ms | 1080 ms | 1080 ms | 713 ms | n/a |
| admin_integrations_status | 12 | 0 | 0.00% | 1 | 5774 ms | 7454 ms | 7617 ms | 1537 ms | n/a |
| admin_financeiro_clientes | 15 | 0 | 0.00% | 5 | 965 ms | 1133 ms | 1148 ms | 1867 ms | n/a |
| client_home_campanhas | 3017 | 0 | 0.00% | 2 | 242 ms | 465 ms | 853 ms | 377 ms | n/a |
| admin_clientes_totais | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| admin_previsao_liberacoes | 17 | 0 | 0.00% | 2 | 667 ms | 667 ms | 667 ms | 613 ms | n/a |
| client_config | 3024 | 0 | 0.00% | 4 | 242 ms | 515 ms | 904 ms | 454 ms | n/a |
| admin_relatorios_catalogo | 12 | 0 | 0.00% | 1 | 487 ms | 593 ms | 602 ms | 155 ms | n/a |
| admin_notificacoes | 12 | 0 | 0.00% | 1 | 1391 ms | 1484 ms | 1492 ms | 164 ms | n/a |
| admin_financeiro_recebiveis | 13 | 0 | 0.00% | 3 | 775 ms | 775 ms | 775 ms | 867 ms | n/a |
| client_page_agenda | 2998 | 0 | 0.00% | n/a | 29 ms | 48 ms | 161 ms | n/a | n/a |
| admin_cliente_boletos | 28 | 0 | 0.00% | 1 | 557 ms | 848 ms | 876 ms | 430 ms | n/a |
| admin_central_cliente | 27 | 0 | 0.00% | 5 | 573 ms | 982 ms | 1111 ms | 1195 ms | n/a |
