# AGENTS.md — Sra. Luck React

Este arquivo é o contrato operacional para qualquer IA ou engenheiro que altere este repositório.

## 1. Missão do projeto

`sra-luck-react` é o produto oficial em evolução da Sra. Luck. A arquitetura alvo é **React + Vite no frontend, Cloudflare Workers no backend e Supabase para dados/serviços persistentes**.

O repositório `Guidoka7/sra-luck-pwa` na branch `main` é a **baseline funcional histórica**: ele representa como o sistema anterior funciona, quais comportamentos foram aprovados, quais fluxos existem e quais problemas já foram resolvidos.

A baseline não é uma prisão técnica. O objetivo é preservar conhecimento e equivalência funcional enquanto o novo produto é reorganizado, modernizado e evoluído.

## 2. Regra principal

Antes de alterar uma funcionalidade já existente, rastrear obrigatoriamente:

`UI anterior → componentes → API → regra de negócio → banco/RPC/migration → efeitos colaterais`

Depois classificar a alteração como uma das opções:

- **PRESERVAR** — já funciona e continua correto;
- **REFINAR** — melhorar UX/design sem remover comportamento;
- **RECONSTRUIR** — portar para React/Worker/Supabase mantendo comportamento;
- **CORRIGIR REGRA** — regra nova substitui regra antiga;
- **EVOLUIR** — ampliar uma capacidade existente;
- **NOVO** — capacidade que ainda não existe.

Nunca redesenhar uma tela apagando funções silenciosamente.

## 3. Fonte de verdade

A prioridade para decisões é:

1. regra de negócio atual documentada em `docs/BUSINESS-RULES.md`;
2. fluxo evolutivo aprovado em `docs/EVOLUTION-ROADMAP.md` e `docs/FLOWS.md`;
3. comportamento comprovado no `sra-luck-pwa/main` para funções existentes;
4. implementação ativa do `sra-luck-react/main`;
5. documentação técnica complementar.

Quando uma regra nova contradizer o PWA, a regra nova documentada vence. O PWA continua sendo referência de comportamento para tudo que não foi explicitamente substituído.

## 4. Princípios de arquitetura

### Frontend

- Organizar por domínio/feature, não por telas gigantes.
- Componentes visuais compartilhados ficam em uma camada de UI/design system.
- Regras de negócio não devem ficar duplicadas em componentes.
- Chamadas HTTP devem passar por clientes/serviços claros.
- Estados de carregamento, vazio, erro, sucesso e permissão devem ser explícitos.
- Light/dark mode e identidade visual são capacidades permanentes e não podem ser removidas por redesign.

### Backend

- `worker/index.ts` deve ser roteador/compositor, não depósito de regras.
- Separar rotas, serviços de domínio, validação, autenticação, providers e observabilidade.
- Segredos nunca chegam ao navegador.
- Operações financeiras e de agenda precisam ser idempotentes ou protegidas contra duplicidade/concor­rência.
- Regras sensíveis devem ter uma única implementação autoritativa.

### Supabase

- Migrations são versionadas e não destrutivas por padrão.
- Não renumerar migrations históricas já potencialmente aplicadas.
- Constraints/RPC/RLS existentes devem ser auditadas antes de migrar regra para outro lugar.
- Alterações de produção exigem evidência e plano de rollback.

## 5. Configurabilidade obrigatória

O sistema deve ser fácil de modificar por IA e por administração futura. Evitar hardcode para políticas operacionais que podem mudar.

Exemplos que devem ser configuráveis quando aplicável:

- percentuais mínimos por modalidade/parcelamento;
- taxa administrativa e sua composição;
- formas de pagamento permitidas;
- prazos operacionais;
- regras e faixas de comissão;
- permissões e papéis;
- campanhas/origens;
- provedores bancários ativos;
- textos e templates de notificação;
- cores, tema e identidade visual;
- disponibilidade e regras de agenda;
- catálogo e pontuação do Clube de Vantagens.

Configuração não significa ausência de validação: invariantes legais, financeiras e de integridade continuam explícitas e testadas.

## 6. Regras de preservação

Antes de mudar uma tela existente:

1. listar ações/botões atuais;
2. listar modais/drawers;
3. listar APIs consumidas;
4. listar dados exibidos;
5. listar permissões;
6. listar estados de erro/carregamento/vazio;
7. comparar com o PWA quando a função veio dele;
8. garantir equivalência antes de remover qualquer implementação anterior.

Se uma função ainda não tiver backend completo, não criar botão que finja funcionamento. Deve aparecer como indisponível/planejada ou não entrar no runtime principal.

## 7. Proibição de mocks operacionais

Não usar `sample-data`, valores fictícios ou arrays estáticos como fonte de verdade em telas operacionais.

Mocks são permitidos somente em:

- testes;
- Storybook/sandbox isolado;
- exemplos explicitamente marcados como demonstração;
- providers de desenvolvimento quando `INTEGRATION_MODE=mock` estiver explícito.

Nunca misturar mock com produção sem sinalização inequívoca.

## 8. Regras de negócio críticas

- Sra. Luck não é clínica; é facilitadora/intermediadora financeira.
- A receita da empresa vem da **taxa administrativa** embutida nas parcelas.
- O percentual de elegibilidade da cliente é baseado em **quantidade de parcelas pagas / total de parcelas**, não em valor financeiro pago.
- O fluxo novo de cirurgia substitui regras históricas incompatíveis, inclusive regra antiga de 90 dias.
- Após termos assinados + quitação confirmada, a agenda cirúrgica é liberada após o prazo operacional vigente documentado (atualmente 5 dias úteis).

Detalhes completos: `docs/BUSINESS-RULES.md`.

## 9. Integrações

Integrações externas devem usar adapters/providers claros.

Domínios previstos:

- RD Station CRM;
- Conta Azul;
- Mercado Pago;
- BRB Cobrança;
- Banco do Brasil;
- Santander;
- Sicredi;
- Efí.

Nenhuma regra específica de fornecedor deve vazar para componentes de UI.

## 10. Fluxo profissional de alteração

Para cada tarefa relevante:

1. entender a solicitação;
2. consultar `AGENTS.md`, `BUSINESS-RULES.md`, `PWA-FUNCTIONAL-BASELINE.md`, `AI-CODEMAP.md` e o fluxo aplicável;
3. consultar o PWA quando houver funcionalidade antecedente;
4. limitar escopo;
5. criar/usar branch de trabalho;
6. implementar;
7. rodar TypeScript/lint/test/build pertinentes;
8. revisar diff procurando regressão funcional;
9. publicar Preview;
10. aguardar validação quando a mudança for visual/operacional relevante;
11. só então considerar merge.

Evitar alterações gigantes que misturem vários domínios sem necessidade.

## 11. Definition of Done

Uma função só está pronta quando, conforme aplicável:

- usa dados reais;
- possui validação;
- possui endpoint/backend real;
- persiste corretamente;
- permanece após reload;
- trata erro e concorrência;
- respeita autenticação/permissão;
- registra auditoria quando necessário;
- possui feedback visual;
- não remove comportamento anterior aprovado;
- tem teste adequado ao risco;
- passa TypeScript/lint/build;
- foi testada no Preview para fluxos de interface.

## 12. Design e UX

O design pode e deve evoluir, mas precisa continuar facilmente editável.

- Centralizar tokens de cores, tipografia, raio, spacing e estados.
- Não espalhar cores hex e estilos críticos em dezenas de telas.
- Preservar a identidade Sra. Luck já aprovada enquanto houver equivalência funcional.
- Cliente: mobile-first, simples, elegante, acolhedor e direto.
- Admin: desktop-first, profissional, denso o suficiente para operação, responsivo.
- Não transformar o app da cliente em um dashboard administrativo.

## 13. Segurança

- Nunca commitar segredos.
- `VITE_*` é público por definição.
- Service role, tokens bancários, tokens de webhook, VAPID privado e segredo de sessão ficam exclusivamente no backend.
- Logs não devem armazenar credenciais, tokens ou dados sensíveis desnecessários.
- Webhooks precisam validar autenticidade quando o provedor oferecer mecanismo de assinatura/token.

## 14. Regra para código legado

Não apagar código Next/legado apenas porque parece antigo.

Antes de remover:

- confirmar que não está no runtime ativo;
- confirmar equivalente no Worker/React;
- confirmar dependências de banco;
- confirmar que o fluxo foi testado;
- confirmar que nenhum comportamento aprovado foi perdido.

Depois da equivalência comprovada, remover legado é desejável para reduzir complexidade.

## 15. Meta do projeto

Chegar a um MVP publicável, funcional e profissional, sem atalhos que deixem telas falsas. O projeto deve permanecer organizado para que uma IA futura localize rapidamente qualquer regra, fluxo, componente, API, provider ou migration e consiga evoluí-lo sem desorganizar o sistema.