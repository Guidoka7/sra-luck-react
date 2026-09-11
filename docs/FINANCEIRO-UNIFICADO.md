# Financeiro Unificado — Sra. Luck

## Objetivo

Substituir a fragmentação atual entre **Pagamentos** e **Parcelas** por um único módulo `/admin/financeiro`, desenhado especificamente para a operação financeira da Sra. Luck.

As telas atuais de `Pagamentos` e `Parcelas` servem **somente como inventário de funções e regras já existentes**. Não reutilizar a organização visual, a hierarquia, os cards, a tabela ou a composição atual.

Referência de produto: organização e clareza de um ERP financeiro como Conta Azul (contas a receber, fluxo de caixa, conciliação, filtros, visão por período), adaptada à identidade Sra. Luck. Não copiar pixel a pixel nem descaracterizar a marca.

## Princípios obrigatórios

- Uma única fonte operacional: `/admin/financeiro`.
- `/admin/pagamentos` e `/admin/parcelas` devem virar redirects para áreas equivalentes dentro de `/admin/financeiro`, preservando links antigos.
- Interface desktop premium, densa sem ser confusa, clara para uso diário do Financeiro.
- Creme/branco/dourado/burgundy, light/dark e componentes existentes de tema; visual de ERP profissional, não landing page.
- Nada de dado fake, botão decorativo ou integração simulada.
- Integrações externas ficam preparadas, mas **não devem executar chamadas live enquanto não houver configuração/homologação**.
- Toda ação real precisa de backend, persistência, validação, erro, feedback e auditoria.
- `valor_contrato`/carta de crédito não é receita. Receita da Sra. Luck é a taxa administrativa. Sempre separar principal, taxa administrativa, total contratado, recebido e receita administrativa realizada/futura.
- Elegibilidade da cliente continua baseada em **quantidade de parcelas pagas**, nunca em percentual monetário.

## Arquitetura de informação da tela

### 1. Cabeçalho e visão do período

No topo:

- título `Financeiro`;
- seletor de período: hoje, 7 dias, mês, 30/60/90 dias e intervalo personalizado;
- busca global por cliente, CPF, contrato, parcela ou identificador externo;
- atualização dos dados;
- indicador de última atualização.

### 2. Resumo executivo

KPIs compactos e clicáveis, filtrando a área operacional abaixo:

- A receber no período;
- Recebido/liquidado;
- Vencido;
- Aguardando validação;
- Divergências/conciliação;
- Receita administrativa realizada;
- Receita administrativa futura;
- Previsão 30/60/90 dias.

Não transformar a tela em coleção de cards grandes. Os indicadores devem ocupar pouco espaço e servir como navegação operacional.

### 3. Evolutivo financeiro

Área de análise inspirada em ERP financeiro:

- evolução diária/mensal de recebimentos;
- previsto x realizado;
- vencido por período;
- receita administrativa realizada x futura;
- projeção 30/60/90 dias;
- filtros por vendedora, origem/campanha, modalidade e instituição financeira quando esses dados existirem.

Gráficos devem responder ao período selecionado e aos dados reais. Não fabricar histórico.

### 4. Abas operacionais internas

Dentro de Financeiro, usar abas/subnav claras:

1. **Visão geral** — KPIs + evolutivo + alertas.
2. **Contas a receber** — todas as parcelas/recebíveis.
3. **Validação** — comprovantes e pagamentos externos aguardando conferência humana.
4. **Contratos recebidos** — futura fila de vendas vindas do RD Station.
5. **Conciliação** — banco/Conta Azul/Mercado Pago e divergências quando integrações estiverem disponíveis.

Não criar páginas de primeiro nível separadas para Pagamentos e Parcelas.

## Contas a receber

Tabela principal profissional e filtrável. Colunas mínimas:

- cliente;
- CPF/contrato;
- parcela `N/Total`;
- vencimento;
- valor original;
- juros;
- multa;
- desconto;
- valor esperado/recebido;
- status;
- forma de pagamento;
- origem/provedor;
- instituição financeira;
- data de pagamento;
- comprovante;
- identificador externo quando existir;
- ações.

Filtros rápidos:

- todos;
- vencendo hoje;
- próximos 7 dias;
- vencidos;
- aguardando validação;
- liquidados;
- suspensos/realocados;
- divergentes.

Filtros avançados por período, cliente, status, instituição, método de pagamento, vendedora e origem/campanha quando disponíveis.

A linha deve abrir **drawer lateral ou modal de detalhe financeiro**, sem levar a uma página desconectada.

## Detalhe financeiro da parcela

O detalhe deve concentrar:

- dados da cliente e do contrato;
- número da parcela;
- vencimento;
- composição financeira;
- status e timeline;
- comprovante;
- histórico de alterações;
- instituição/provedor;
- IDs externos;
- observações;
- ações disponíveis conforme estado.

Ações internas previstas:

- editar vencimento antes da liquidação;
- suspender/realocar conforme regra existente;
- registrar/confirmar baixa manual;
- validar/rejeitar comprovante;
- registrar juros, multa e desconto;
- adicionar observação;
- ver auditoria;
- gerar cobrança por banco **somente quando provider estiver configurado**;
- gerar pagamento/cartão **somente quando Mercado Pago estiver configurado**.

Parcela paga não pode ser alterada silenciosamente. Correção posterior exige evento auditável/estorno/reabertura conforme regra implementada.

## Baixa manual estilo ERP

A baixa manual precisa de um modal estruturado com:

- data do pagamento;
- valor original;
- juros;
- multa;
- desconto;
- valor final recebido;
- método de pagamento;
- instituição/conta quando aplicável;
- observação;
- comprovante/anexo quando aplicável.

O backend deve calcular/validar valores e registrar um evento de recebimento. Não depender apenas de mudar `boletos.status`.

## Modelo de recebimento

Preferir um ledger de recebimentos separado de `boletos`, em vez de sobrecarregar a parcela.

Entidade sugerida: `financeiro_recebimentos` (nome final pode seguir o padrão do repositório), ligada a `boleto_id` e `cliente_id`, contendo no mínimo:

- valor_original;
- juros;
- multa;
- desconto;
- valor_recebido;
- data_pagamento;
- forma_pagamento;
- origem (`manual`, `comprovante`, `banco`, `mercado_pago`, `conta_azul` etc.);
- status_validacao;
- comprovante/arquivo;
- external_payment_id / external_reference quando existir;
- criado_por;
- created_at / updated_at.

A confirmação de recebimento deve ser idempotente e, quando validada, atualizar a parcela para paga de forma transacional. Isso é crítico porque o progresso/elegibilidade da cliente depende da contagem de parcelas pagas.

## Validação de comprovantes

Preservar a função existente, porém reorganizada dentro da aba **Validação**.

Fila deve mostrar prioridade por antiguidade e vencimento. Ao abrir:

- visualizar comprovante;
- parcela e cliente correspondentes;
- vencimento e valor;
- confirmar ou rejeitar;
- observação obrigatória quando houver rejeição/divergência;
- registrar quem validou e quando.

Nunca marcar como `enviada` uma notificação ou `pago` um recebimento apenas por UI otimista.

## Contratos recebidos do RD Station

Fluxo futuro, mas a interface e o domínio devem ficar preparados.

Quando a API do RD Station for conectada, uma venda marcada no CRM deverá entrar em uma fila **Contratos recebidos** com os dados que a vendedora já preencheu.

Fluxo:

`Venda no RD -> staging -> conferência humana -> cadastro/associação da cliente -> contrato de crédito -> geração/configuração das parcelas -> cobrança`.

A tela deve:

- mostrar novos contratos ainda não processados;
- exibir dados recebidos sem reentrada manual desnecessária;
- sinalizar campos faltantes/divergentes;
- permitir revisar antes de cadastrar;
- impedir duplicidade por CPF/deal/external id;
- permitir associar a cliente já existente quando correto;
- registrar origem, campanha e vendedora;
- só gerar parcelas após confirmação humana.

**Estado atual do banco conectado em 11/09/2026:** existem `clientes` e `boletos`, mas ainda não existem no schema aplicado `crm_vendas_entrada`, `contratos_credito`, `pagamentos_externos`, `conta_azul_operacoes` e `integracao_eventos`. Se a implementação precisar dessas estruturas, criar novas migrations versionadas, sem assumir que migrations históricas foram aplicadas e sem aplicar produção automaticamente pelo Codex.

## Geração de parcelas e cobranças bancárias

A função atual de gerar/editar parcelas deve migrar para o Financeiro.

Separar conceitualmente:

1. criar o plano/parcela interna;
2. emitir cobrança externa no banco.

Nunca fingir que um boleto bancário foi emitido se apenas existe uma parcela interna.

Quando os bancos forem conectados:

- BRB, Banco do Brasil, Santander, Sicredi ou Efí serão providers;
- emissão retorna identificador externo, linha/URL/arquivo conforme API do provedor;
- webhook atualiza liquidação;
- eventos precisam ser idempotentes;
- guardar provider, external id e payload técnico necessário para auditoria sem expor segredos.

Enquanto provider não estiver configurado, a UI deve mostrar `Integração bancária ainda não configurada` e não criar boleto falso.

## Mercado Pago / cartão

Haverá dois caminhos futuros:

1. **Link de pagamento** gerado para a parcela específica;
2. pagamento dentro do modal da cliente.

Regras obrigatórias de segurança:

- o Sra. Luck **não armazena PAN, CVV ou dados brutos do cartão**;
- o formulário da cliente deve usar componente/tokenização oficial do provedor (ex.: Mercado Pago Card Payment Brick/SDK) para que os dados sensíveis sejam tratados pelo ambiente PCI do provedor;
- o backend recebe token/identificador seguro, valor/parcela e dados mínimos permitidos;
- usar chave de idempotência em criação de pagamento;
- autenticação da sessão da cliente;
- origem/CSRF protegida;
- valor e `boleto_id` recalculados/validados no servidor, nunca confiados ao frontend;
- webhook assinado confirma o estado do pagamento;
- pagamento aprovado externamente entra inicialmente em validação conforme política operacional definida, sem baixa duplicada.

A UI pode ser preparada agora, mas não deve renderizar formulário próprio de número de cartão/CVV antes da integração oficial do SDK/Brick.

## Conta Azul

Conta Azul será referência de **organização operacional** e futura integração de apoio/controle. A Sra. Luck continua dona do seu domínio financeiro.

Preparar:

- contas a receber;
- baixa manual;
- juros/multa/desconto;
- data de pagamento;
- observação;
- conciliação;
- IDs externos;
- status de sincronização;
- histórico de erro/reprocessamento.

Não tornar o Conta Azul fonte única da regra de elegibilidade da cliente.

## Backend mínimo esperado

O Codex deve consolidar/introduzir endpoints coerentes, evitando duplicação dos endpoints antigos. Direção sugerida:

- `GET /api/admin/financeiro/resumo`
- `GET /api/admin/financeiro/recebiveis`
- `GET /api/admin/financeiro/recebiveis/:id`
- `POST /api/admin/financeiro/recebiveis/:id/baixa`
- `PATCH /api/admin/financeiro/recebiveis/:id`
- `GET /api/admin/financeiro/validacoes`
- `POST /api/admin/financeiro/validacoes/:id/confirmar`
- `POST /api/admin/financeiro/validacoes/:id/rejeitar`
- `GET /api/admin/financeiro/contratos-entrada`

Os nomes podem ser ajustados ao padrão real do Worker. O importante é não espalhar novamente a lógica em múltiplos módulos sem domínio claro.

## Evolução e métricas

O Financeiro deve conseguir evoluir para:

- previsão 30/60/90 dias;
- 6/12 meses;
- inadimplência por faixa de atraso;
- recebimento por instituição/método;
- realizado x previsto;
- taxa administrativa realizada/futura;
- campanha/origem;
- vendedora;
- modalidade FLEX x 100% boleto.

Não apresentar métricas que o banco ainda não suporta como se fossem reais. Quando o dado não existir, esconder ou sinalizar `ainda sem base suficiente`.

## Compatibilidade / migração

Funções que precisam sobreviver à migração das telas antigas:

- busca de cliente;
- listagem de parcelas;
- geração interna de parcelas;
- alteração de valor/vencimento conforme regra;
- suspensão/realocação;
- histórico;
- seleção/lote quando fizer sentido;
- validação de comprovante;
- confirmação/rejeição de pagamento;
- visualização de comprovante.

Não copiar o design das telas antigas.

Rotas antigas:

- `/admin/pagamentos` -> `/admin/financeiro?aba=validacao` ou equivalente;
- `/admin/parcelas` -> `/admin/financeiro?aba=recebiveis` ou equivalente.

Remover `Pagamentos` e `Parcelas` do menu principal após o Financeiro novo estar funcional.

## Escopo da primeira implementação Codex

Primeira PR deve entregar o **núcleo financeiro unificado**, não as APIs externas:

- nova UI `/admin/financeiro` premium e funcional;
- migração das funções reais de Pagamentos/Parcelas para dentro dela;
- redirects das rotas antigas;
- backend financeiro consolidado para dados internos atuais;
- ledger/baixa manual e auditoria se necessários por migration;
- visão geral + contas a receber + validação;
- evolutivo somente com dados reais disponíveis;
- placeholders técnicos honestos para `Contratos recebidos` e `Conciliação` quando a base ainda não existir, sem dados falsos e sem botões que prometam integração;
- nenhuma chamada live para Mercado Pago, Conta Azul, RD Station ou bancos;
- nenhuma credencial nova;
- lint/build/CI;
- abrir PR e **não fazer merge**.

Depois dessa PR, revisar schema e UI antes de implementar adapters externos.