# Baseline funcional — `sra-luck-pwa/main`

Este documento descreve o que deve ser entendido como patrimônio funcional do sistema anterior. Ele não obriga a copiar a implementação Next.js; ele define comportamentos e capacidades que precisam ser preservados ou conscientemente substituídos no `sra-luck-react`.

## 1. Papel do PWA antigo

O repositório `Guidoka7/sra-luck-pwa`, branch `main`, é a referência para:

- comportamento aprovado da área da cliente;
- experiência de agenda e boletos;
- funcionalidades administrativas existentes;
- regras históricas de parcelas, revisão financeira e notificações;
- migrations que registram correções de bugs reais;
- identidade visual e padrões de interação que já funcionavam.

Quando houver conflito entre o PWA e regras novas aprovadas, prevalece a regra nova documentada no React.

## 2. Área da cliente — preservar

### Login

- acesso por CPF + data de nascimento;
- sessão própria da cliente;
- sem necessidade de senha tradicional para a cliente;
- visual simples, profissional e coerente com a marca;
- light/dark mode preservado.

### Estrutura principal

A experiência aprovada é centrada em duas áreas principais:

- **Minha Agenda**;
- **Meus Boletos**.

O app é mobile-first e não deve ser transformado em dashboard administrativo.

### Minha Agenda

Comportamentos já existentes/relevantes:

- exibição do estágio atual da jornada;
- calendário de datas liberadas pela equipe;
- seleção de data/horário para assinatura dos termos;
- confirmação visual do agendamento;
- acompanhamento de revisão/liberação financeira;
- remarcação quando aplicável;
- acompanhamento posterior da data de cirurgia;
- notificações e atualização em tempo real quando disponíveis.

O design e a hierarquia visual aprovados no PWA devem ser tratados como referência até que uma evolução seja explicitamente aprovada.

### Meus Boletos

Capacidades já existentes/relevantes:

- progresso do contrato;
- quantidade de parcelas pagas e total;
- listagem de parcelas;
- status por parcela;
- vencimento;
- valor;
- boleto/arquivo quando disponível;
- PIX configurável;
- ação "Já paguei";
- upload de comprovante;
- comprovante em análise;
- comprovante rejeitado;
- parcela paga;
- tratamento de parcela vencida;
- juros/multa/desconto PIX existentes no fluxo anterior quando configurados.

A evolução com bancos e Mercado Pago deve entrar dentro deste fluxo, não substituí-lo por outra experiência incompatível.

### Notificações e PWA

O projeto anterior possui:

- central de notificações da cliente;
- Web Push;
- assinatura por dispositivo;
- PWA instalável;
- mensagens relacionadas a parcelas e jornada.

No React, cada capacidade deve ser revalidada ponta a ponta antes de ser considerada equivalente.

## 3. Percentual e parcelas

A baseline já possui função de percentual baseada em:

`parcelas pagas / total real de parcelas × 100`

Portanto, o percentual operacional não é `valor pago / valor do contrato`.

As faixas históricas presentes no PWA são referência inicial, não hardcode eterno. Hoje existem regras por quantidade de parcelas e elas devem migrar para política configurável no novo sistema.

## 4. Taxa administrativa

O PWA já distingue:

- `valor_contrato` como valor base/carta/crédito;
- `taxa_administrativa_percentual`;
- `custo_total` como valor base + taxa administrativa.

A taxa administrativa é a receita da Sra. Luck e está embutida no parcelamento.

Essa distinção deve ser preservada e tornada ainda mais explícita no novo modelo financeiro.

## 5. Admin — patrimônio funcional

O painel anterior possui áreas relevantes que não podem desaparecer durante redesign:

- Visão Geral;
- Agenda;
- Clientes;
- Pagamentos;
- Parcelas;
- Relatórios;
- Configurações;
- Notificações;
- monitoramento/capacidades operacionais relacionadas.

### Clientes

- busca/listagem;
- cadastro e edição;
- CPF e dados pessoais;
- procedimento/contexto comercial;
- valor base/carta;
- taxa administrativa;
- quantidade de parcelas;
- geração/ajuste de boletos;
- visualização de andamento do ciclo;
- dados financeiros e de agenda associados.

### Pagamentos

- agrupamento por cliente;
- filtro por status;
- comprovantes aguardando validação;
- confirmação/rejeição;
- parcelas vencidas/pagas/rejeitadas;
- marcação de pagamentos;
- acesso ao comprovante.

### Gestão de parcelas

- pesquisar cliente;
- abrir carnê;
- gerar parcelas;
- alterar valor/vencimento de parcela aberta;
- reabrir quando permitido;
- excluir quando permitido;
- suspender/realocar;
- histórico de alterações;
- proteção de parcelas pagas.

As migrations antigas relacionadas à numeração de parcelas e suspensão registram problemas reais já encontrados. A reconstrução não deve reintroduzir esses bugs.

### Agenda administrativa

- calendário de termos;
- liberação/fechamento de datas;
- quantidade de vagas;
- ocupação;
- acompanhamento de clientes;
- revisão financeira;
- área de previsão/liberação financeira;
- remarcações.

A lógica antiga de 90 dias após termos é considerada **obsoleta** quando conflitar com a nova regra documentada de liberação da agenda cirúrgica após quitação + termos e prazo de 5 dias úteis.

### Configurações

O PWA possui configurações operacionais que são patrimônio funcional:

- identidade;
- meta/orçamento;
- PIX;
- QR Code;
- desconto PIX;
- WhatsApp;
- telefone;
- bloqueio/controle de agenda;
- light/dark mode no produto.

No React, configurações devem evoluir para uma central ainda mais configurável, não ser reduzidas.

### Notificações administrativas

A central anterior contempla:

- visão geral;
- automação;
- templates;
- envio manual;
- logs/histórico;
- rotina para parcelas atrasadas;
- configuração de frequência/tentativas.

A reconstrução deve manter essas capacidades e conectá-las ao backend novo.

## 6. Revisão/liberação financeira

A baseline já introduziu o conceito de revisão financeira manual antes da agenda:

- percentual mínimo atingido;
- status pendente/aprovado/recusado;
- confirmação administrativa;
- saldo restante;
- formas de custeio permitidas;
- PIX/cartão/cheques/boleto 100% em determinadas condições;
- solicitação vinculada ao agendamento.

O evolutivo atual reorganiza e profissionaliza esse ciclo, mas aproveita esses conceitos.

## 7. O que não deve ser copiado cegamente

O PWA contém dívida e regras antigas que precisam ser substituídas, entre elas:

- Next.js como runtime principal;
- regras de 90 dias incompatíveis com o novo processo;
- nomes/textos que tratam a Sra. Luck como clínica;
- lógica distribuída em várias camadas;
- migrations duplicadas/numeração histórica irregular;
- componentes grandes e regras misturadas com UI;
- integrações ainda inexistentes ou manuais.

## 8. Regra de equivalência

Uma função migrada do PWA para React só pode ser marcada como substituída quando houver evidência de:

- UI equivalente ou melhor;
- API real;
- persistência real;
- regra correta;
- autenticação/permissão;
- estados de erro/sucesso;
- testes adequados;
- comportamento comprovado em Preview.

Somente depois disso o legado correspondente pode ser removido.