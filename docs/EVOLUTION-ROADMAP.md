# Roadmap evolutivo — Sra. Luck React

Este roadmap transforma o `sra-luck-pwa` em baseline funcional e o `sra-luck-react` em produto oficial evolutivo.

## 1. Estratégia

Não fazer reescrita cega.

Processo por domínio:

`entender PWA → mapear dependências → reproduzir no runtime novo → validar equivalência → aplicar evolução → testar → Preview → aprovar → remover legado quando seguro`

Cada domínio deve ser classificado em:

- preservar;
- refinar;
- reconstruir;
- corrigir regra;
- evoluir;
- novo.

## 2. Ordem recomendada para o MVP

### Fase 0 — Fundação e segurança

Objetivo: deixar o projeto fácil de navegar e seguro para evolução por IA.

- AGENTS.md;
- baseline funcional;
- regras de negócio;
- codemap;
- mapa de migrations;
- CI confiável;
- Preview por branch;
- secrets somente em backend;
- eliminar telas operacionais com sample data;
- mapear rotas ativas e rotas legadas.

### Fase 1 — Autenticação e shell

Preservar:

- login cliente por CPF + nascimento;
- login administrativo;
- light/dark mode;
- identidade visual;
- navegação base.

Evoluir:

- seletor profissional de data de nascimento;
- sessão robusta no Worker;
- autorização por papel;
- mensagens de erro consistentes;
- Preview conectado ao backend real.

### Fase 2 — Cliente: Minha Agenda + Meus Boletos

Preservar design/fluxo aprovado do PWA.

Reconstruir e validar:

- jornada;
- boletos;
- arquivo do boleto;
- PIX;
- upload de comprovante;
- estados da parcela;
- Minha Agenda;
- calendário de termos;
- notificações.

Evoluir:

- novos estados do levantamento financeiro;
- pagamento agora/no dia dos termos;
- agenda cirúrgica após regra nova;
- Mercado Pago;
- dados de liquidação bancária;
- Clube de Vantagens.

### Fase 3 — Clientes, contratos e parcelas

Preservar:

- cadastro/edição;
- carnê;
- geração/edição/suspensão/reabertura;
- histórico;
- taxa administrativa.

Evoluir:

- contrato como entidade explícita quando necessário;
- versão da política contratual;
- modalidade Flex/100% boleto;
- origem/campanha;
- vendedor/SDR;
- provedor bancário;
- identificadores externos;
- composição de receita administrativa.

### Fase 4 — Financeiro operacional

Construir sobre Pagamentos/Parcelas existentes.

Visão diária:

- liquidados;
- vencidos;
- aguardando validação;
- divergências.

Evoluir:

- conciliação bancária;
- comprovante + webhook;
- baixa idempotente;
- histórico de eventos financeiros;
- ajustes de juros/multa/desconto;
- Conta Azul;
- Mercado Pago em homologação controlada.

### Fase 5 — Jornada de liberação e agendas

Preservar a experiência de calendário e administração de vagas.

Substituir regra antiga incompatível:

- remover dependência funcional dos 90 dias;
- usar percentual por parcelas;
- solicitação de levantamento;
- prazo de até 5 dias úteis;
- saldo e formas liberadas;
- pagar agora/no dia;
- termos;
- quitação;
- 5 dias úteis após termos + quitação;
- agenda cirúrgica;
- cirurgia realizada.

Todas as transições devem possuir histórico/auditoria.

### Fase 6 — Integrações comerciais e bancárias

#### RD Station

- webhook/entrada de negócio;
- deduplicação;
- origem/campanha;
- vendedor/SDR;
- vínculo externo;
- conferência interna antes da cobrança.

#### Bancos

Criar contrato de provider comum para:

- emitir;
- consultar;
- alterar quando suportado;
- cancelar quando suportado;
- obter arquivo/linha digitável;
- processar webhook/liquidação;
- normalizar erros/status.

Providers:

- BRB;
- Banco do Brasil;
- Santander;
- Sicredi;
- Efí.

### Fase 7 — Planejamento e forecast

Evoluir a previsão já existente.

- 30/60/90/180 dias;
- quantidade de clientes que atingirão elegibilidade;
- campanha;
- vendedor;
- modalidade;
- banco;
- receita administrativa prevista;
- valor de cartas/créditos previsto;
- forecast contratual;
- forecast comportamental futuro.

### Fase 8 — Colaboradores

Novo domínio:

- acesso por papel;
- treinamentos;
- comissões;
- metas;
- histórico;
- notificações internas.

Regras devem ser administráveis por configuração e vigência.

### Fase 9 — Clube de Vantagens

Novo domínio:

- pontos;
- indicação;
- prevenção de duplicidade;
- catálogo;
- estoque/disponibilidade quando aplicável;
- resgates;
- histórico.

### Fase 10 — Hardening para publicação

- testes dos fluxos críticos;
- testes de concorrência/idempotência;
- auditoria de autorização/RLS;
- observabilidade;
- rate limiting;
- validação de webhooks;
- backup/rollback;
- política de migrations;
- performance;
- acessibilidade;
- PWA e push;
- domínio oficial;
- configuração de produção;
- remoção de legado comprovadamente substituído.

## 3. Critério de prioridade

Priorizar nesta ordem:

1. regressão que impede operação;
2. segurança/integridade financeira;
3. equivalência com PWA;
4. jornada principal da cliente;
5. operação diária do admin/financeiro;
6. integrações que reduzem trabalho manual;
7. planejamento/forecast;
8. novos produtos complementares.

## 4. O que não fazer

- Não redesenhar tudo de uma vez.
- Não substituir módulo funcional por mock.
- Não criar integração fictícia.
- Não mover dezenas de arquivos sem necessidade funcional/testes.
- Não alterar banco de produção como parte de refactor puramente estrutural.
- Não misturar três ou quatro domínios críticos no mesmo PR se puderem ser separados.

## 5. Critério para remover legado

Um bloco legado pode ser removido quando:

- não está mais no runtime ativo;
- existe equivalente React/Worker;
- banco/RPC necessário foi preservado ou migrado;
- testes passam;
- Preview foi validado;
- não há consumidor conhecido;
- documentação/codemap foi atualizado.

## 6. Estado desejado do MVP

O MVP publicável deve permitir, ponta a ponta:

- entrada/login seguro;
- cliente real e contrato real;
- parcelas reais;
- boleto/comprovante/pagamento;
- acompanhamento do percentual por parcelas;
- levantamento financeiro;
- agenda de termos;
- quitação;
- liberação da agenda cirúrgica pela regra vigente;
- agendamento da cirurgia;
- operação administrativa;
- financeiro diário;
- notificações essenciais;
- trilha de auditoria;
- pelo menos as integrações prioritárias homologadas ou uma operação manual explícita e segura onde a integração ainda não estiver disponível.

Funcionalidade complementar pode entrar após o núcleo estar estável, sem impedir evolução contínua.