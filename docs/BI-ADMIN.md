# Power BI Comercial — escopo corrigido em 29/09/2026

## Decisão do usuário

A página se chama **Power BI**. Nesta fase trata exclusivamente do **comercial da empresa Sra. Luck**, alimentado pelo **RD Station CRM completo**. O sistema operacional Sra. Luck e o BI funcionam em paralelo. Estar no BI NÃO exige cadastro de cliente, contrato, boleto ou importação no app.

A implementação inicial que consultava clientes, novas_vendas e status contratuais do app foi rejeitada pelo usuário e removida deste PR. Não deve ser restaurada como fallback. Conta Azul e financeiro ficam para fase posterior.

O nome da página é Power BI; continua sendo o BI interno solicitado anteriormente, sem dependência do Microsoft Power BI neste incremento.

## Evolução da recepção

O visual do PR #79 foi aprovado pelo usuário e mergeado em 29/09/2026 (`88caea7`). A fundação de recepção foi implementada em seguida; veja [BI-INGESTION.md](BI-INGESTION.md) para endpoints, schema, garantias, validação e limites. A disponibilidade agora vem das tabelas BI, mantendo métricas indisponíveis até a homologação comercial.

## Página

- Rota principal `/admin/power-bi`, alias compatível `/admin/bi`.
- Item **Power BI** no menu Gestão.
- Visão comercial; Fontes e campanhas; Funis e conversão; SDR e agendamentos; Vendas e vendedoras; Jornada dos leads; Pendências.
- Mesma autenticação do Admin, com `relatorios.visualizar` no backend. Conexões e automações controladas exclusivamente pelo Console.
- Fonte explícita: RD Station CRM, abrangência comercial da empresa.
- Filtros previstos: intervalo e eixo temporal (entrada do lead versus data do evento), fonte, campanha, funil, etapa, SDR e vendedora.
- Até implementar o coletor, filtros estão desabilitados, métricas são indisponíveis e tabelas informam ausência de carga. Não há números fictícios, contagens do app ou datas de sincronização inventadas.

## Dados obrigatórios e evolução de cada lead

| Objeto | Dados e regra |
| --- | --- |
| Contato/lead | ID externo com escopo de conta, data de entrada, nome, contatos necessários, origem original, campanha e responsável atual. |
| Atribuição | Fonte/campanha originais preservadas; alterações têm histórico. UTM quando efetivamente disponível, nunca inferida como fato. |
| Negociação | ID próprio, vínculo com contato, funil, etapa, criação, atualizações, valor, ganho, perda, motivo e reabertura. |
| Atendimento | ID/identificador de evento, responsável, data, tipo e vínculo com lead/negociação. Atendimentos não aumentam a quantidade de pessoas. |
| Agendamento | ID, data, SDR, modalidade, confirmação, cancelamento/reagendamento, comparecimento e vendedora que realizou a reunião. |
| Venda | Negociação/contrato identificado, data efetiva, valor, vendedora validada e origem/campanha relacionada. |
| Evento | Identificador, tipo, data do fato quando conhecida, data de coleta, ator, origem e versão do mapeamento. |

Consultar timeline de cada lead: entrada → atendimentos → movimentações de funil → agendamentos → confirmação → comparecimento → venda/perda. O desenho não presume que todos seguem essa sequência ou têm um único contrato.

Não fabricar eventos históricos. Se o RD não disponibilizar determinada transição antiga, exibir a lacuna e a data de início do acompanhamento. Estado atual, histórico comprovado e instante em que o BI observou são conceitos distintos.

## Vendedora, SDR e responsável

- Vendedora: campos **Nome da vendedora** e **Vendedora que realizou a Reunião?**, selecionados por identificador real no mapeamento por funil.
- Ambos iguais e vinculados a pessoa cadastrada como vendedora: atribuição válida.
- Um preenchido e inequívoco: usar o vínculo válido.
- Ambos diferentes: conflito visível, sem escolha silenciosa.
- Ambos ausentes: venda permanece sem atribuição e gera pendência.
- SDR e dono/responsável do lead possuem campos e papéis distintos. Nunca usar seus nomes como reserva para vendedora.
- Pessoa com dois papéis requer cadastro explícito e evidência do papel no evento.
- Pendência possui responsável pela correção; isso não altera o responsável real da venda.

## Completude, atualização e duplicidade

1. Carga histórica paginada de todos os contatos e negociações do escopo comercial escolhido no RD. Incluir abertos, ganhos, perdidos e arquivados quando disponíveis na API; documentar qualquer exclusão.
2. Nada de limite silencioso de 100/1000 registros, amostra do catálogo ou filtro de elegibilidade ao pré-cadastro do app.
3. Persistir progresso por entidade/conta/página. Falha na página intermediária mantém lote incompleto e permite retomada.
4. Atualização incremental de novos leads e alterações via eventos quando disponíveis e varredura periódica de reconciliação. Webhook não substitui conferência de completude.
5. Eventos repetidos e atrasados não duplicam venda nem fazem estado atual retroceder.
6. Pessoa, atividade, agendamento, negociação e contrato têm granularidades próprias. Mesma pessoa com dois contratos legítimos não é excluída como duplicata.
7. Constraints únicas por conta/provedor/ID. Suspeita de duplicidade entre IDs distintos vai à revisão, nunca mesclagem automática pelo nome.
8. Mostrar última sincronização, janela coberta, quantidade de IDs coletados, páginas pendentes, erros e comparação com a fonte.

## Definição dos indicadores antes de ativar

- Novos leads: IDs de contato distintos com data de entrada na janela.
- Atendimentos: atividades distintas; pessoas atendidas é outra medida.
- Agendamentos: IDs de agendamento; confirmação e presença admitem desconhecido, que não equivale a não.
- Vendas: negócios ganhos identificados; contratos fechados é medida distinta quando houver contrato confiável.
- Valores: quantia e moeda da origem; divergência excluída da soma homologada, mas preservada na fila de conferência.
- Conversão por origem/coorte: explicitar denominador (leads que entraram na coorte) e janela para observar resultado. Contar cada lead uma vez na conversão lead→venda, mesmo que tenha duas vendas.
- Vendas por período: usar data da venda, não a data de importação no app nem necessariamente a entrada do lead.
- Conversão por etapa: usar eventos de entrada/saída e identificação da negociação, não dividir estoques atuais como se fossem uma coorte.
- Ranking por vendedora: atribuição validada; grupo Sem atribuição conserva negócios sem vendedora, sem misturá-los com SDR.
- Investimento publicitário, CPL e ROAS ficam fora desta primeira fase sem fonte de custos homologada.

## Entrega inicial do PR #79 (histórico)

Estrutura da página comercial, navegação, tabelas e indicadores previstos, contrato de disponibilidade e endpoint protegido. A API devolve `source: rd_station`, `scope: company_commercial`, `metrics: null` e informa que o coletor não foi implementado. Não consulta tabelas operacionais para simular BI.

**Ainda falta:** banco analítico, OAuth/gateway do Console, coletor histórico/incremental, mapeamento real, n8n, indicadores calculados, detalhes/timeline preenchidos e fila de correção. Não anunciar sangria completa ou atualização contínua como funcionando nesta entrega.

## Validação e publicação

Testes: negação de sessão/permissão, recusa de escrita e ausência de fallback para dados do app. TypeScript frontend/worker e build. QA visual não aprovado: navegador do ambiente bloqueou localhost (`ERR_BLOCKED_BY_CLIENT`). Preview deve ser revisado antes da promoção conforme AGENTS.md.

Sem migração e sem escrita em dados reais. Rollback por reversão do commit. Desenvolvido na branch do PR #79; produção não alterada.

## Refinamento visual — espaço próprio de relatórios

Solicitado pelo usuário: aparência mais próxima de uma ferramenta de BI, com interface própria nesta aba. Classificação: REFINAR. Preservados a consulta de disponibilidade, as sete análises, a navegação por URL/histórico, os estados de carregamento/erro/ausência de carga e a permissão `relatorios.visualizar`.

- A rota do BI usa uma composição independente da sidebar operacional, com barra superior compacta, retorno ao Admin, tema claro/escuro e saída da sessão. O alias `/admin/bi` também participa do redirecionamento por permissão.
- Navegação por páginas à esquerda, área central com indicadores, espaços de gráficos sem séries inventadas, tabela por vendedora e acesso às pendências.
- Painel de filtros recolhível à direita. Continua desabilitado, com explicação da dependência da coleta. Abrir/fechar filtros não altera dados.
- Modo foco recolhe as laterais. Páginas e filtros podem ser restaurados. Em telas estreitas, as páginas viram navegação horizontal e os filtros aparecem acima do relatório.
- Tipografia sem serifa, superfícies neutras, contornos discretos e acentos azul/dourado, restritos ao BI. Tema das outras páginas preservado.
- A ação “Verificar dados” apenas repete o GET de disponibilidade; não inicia sincronização. Sem novos endpoints, migrations, credenciais ou escrita comercial.

Validação desta revisão: TypeScript frontend/worker, build e 3 testes do endpoint passaram. Acesso ao Preview no navegador redirecionou para `/admin/login`; revisão visual autenticada e interações em mobile permanecem pendentes. Nenhum dado fictício introduzido no produto.
