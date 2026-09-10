# Sra. Luck React — Arquitetura

> Fonte de verdade arquitetural baseada no código confirmado no repositório. Este documento não considera a arquitetura ideal como se já estivesse implementada.

## 1. Estado de referência e divergência entre branches

No momento desta documentação, as branches não representam exatamente o mesmo estado arquitetural:

- `develop` aponta para `530cd09c4d0c5bf05e9a08a7c4ed016c786fe40e` e ainda contém o runtime Next.js. O `package.json` dessa branch usa `next dev`, `next build` e `next start`, e declara `next` e `@supabase/ssr` como dependências.
- `main` contém a migração mais avançada para React + Vite + Cloudflare Workers. Nela, `src/main.tsx` é a entrada React, `vite.config.ts` integra Vite com Cloudflare e `wrangler.jsonc` aponta para `worker/index.ts`.

Portanto, **não é correto afirmar que `develop` já possui o runtime React + Vite do `main`**. A arquitetura de destino desta documentação é descrita a partir do runtime migrado existente em `main`, enquanto a situação efetivamente presente em `develop` é registrada como estado legado/de transição.

Este documento foi criado em `develop` exclusivamente como documentação arquitetural e não altera código de runtime.

## 2. Arquitetura atual do runtime migrado

No estado migrado confirmado em `main`, o fluxo principal é:

```text
Browser
  │
  ▼
React + Vite SPA
  │
  ├── páginas e componentes
  ├── sessão/estado da interface
  └── chamadas HTTP para /api/*
          │
          ▼
Cloudflare Worker
  │
  ├── autenticação/sessões protegidas
  ├── APIs de cliente
  ├── APIs administrativas
  ├── regras de backend
  └── acesso privilegiado aos dados
          │
          ▼
Supabase
  │
  ├── PostgreSQL
  ├── Storage
  ├── Realtime
  └── funções/RPCs SQL
```

O `wrangler.jsonc` do runtime migrado declara `worker/index.ts` como entrada do Worker, configura os assets como SPA e faz `/api/*` passar primeiro pelo Worker.

## 3. Frontend

A entrada React do runtime migrado é `src/main.tsx`.

O roteamento atual é feito pelo próprio código da aplicação, observando `window.location.pathname`. As áreas confirmadas são:

- `/login` — login da cliente;
- `/agenda` — área da cliente;
- `/admin/login` — login administrativo;
- `/admin/*` — painel administrativo, incluindo agenda, clientes, pagamentos, parcelas, relatórios, notificações, configurações e monitoramento.

`src/main.tsx` também instala o monitoramento global, `ThemeProvider` e `AppErrorBoundary`.

A área `/agenda` registra o PWA por meio de `PwaRegister`. Não há evidência, neste documento, de que o painel administrativo seja tratado como PWA.

## 4. Estrutura de código atualmente observada

A organização atual não corresponde integralmente a uma arquitetura por domínio `features/services/hooks/config`.

As principais áreas são:

```text
src/
  app/          código de páginas e também superfície herdada do Next
  pages/        páginas React do runtime migrado
  components/   componentes de interface e componentes administrativos
  lib/          bibliotecas, integração e lógica compartilhada
  types/        tipos
  styles/       estilos
  shims/        compatibilidade com algumas APIs/imports originalmente usados pelo Next

worker/
  index.ts      entrada e roteamento do Cloudflare Worker
  *.ts          handlers e lógica de backend

supabase/
  *.sql         schema e migrations do banco

docs/
  documentação arquitetural e operacional
```

A existência de uma pasta ou arquivo não significa, por si só, que ele esteja no caminho de execução atual.

## 5. Runtime ativo, legado e código não comprovado

### Runtime ativo confirmado

No runtime migrado de `main`, são confirmados como pontos de entrada:

- `src/main.tsx` para o navegador;
- `worker/index.ts` para as APIs do Cloudflare Worker;
- `wrangler.jsonc` para a configuração do Worker e da entrega SPA.

### Código legado

O repositório ainda contém uma superfície significativa originalmente criada para Next.js, incluindo arquivos em `src/app/api`, `src/middleware.ts`, `src/lib/supabase/server.ts`, `next.config.js` e outros arquivos dependentes do modelo Next.

Esses arquivos **não devem ser considerados automaticamente parte do runtime Vite/Worker**. Antes de remover qualquer um deles, deve-se confirmar seus consumidores, equivalentes no Worker, dependências de banco e relação com fluxos de negócio.

### Código existente, mas não comprovadamente ativo

Arquivos de funcionalidades como notificações, Web Push, feedback, monitoramento e outras integrações não devem ser classificados como funcionalidades efetivamente disponíveis somente porque seus arquivos existem.

A confirmação deve considerar:

1. importação pelo runtime ativo;
2. rota realmente exposta pelo Worker;
3. chamada efetiva pela interface;
4. dependências/configuração necessárias;
5. persistência ou processamento correspondente no banco;
6. validação do fluxo, quando houver teste disponível.

## 6. Papel do frontend

O frontend é responsável principalmente por:

- renderização da experiência da cliente e do administrador;
- navegação da SPA;
- coleta e apresentação de dados;
- interação com APIs;
- estado visual e de interface;
- registro do PWA na área da cliente;
- apresentação de erros ao usuário.

Operações privilegiadas não devem depender de segredos entregues ao navegador.

O `package.json` do runtime migrado utiliza Vite para desenvolvimento, build e preview.

## 7. Papel do Cloudflare Worker

O Worker é a camada backend do runtime migrado.

Ele concentra as APIs expostas em `/api/*` e operações que precisam ocorrer fora do navegador, incluindo autenticação/sessões, operações administrativas e acesso privilegiado ao Supabase.

O Worker deve ser tratado como a fronteira entre a interface pública e as operações protegidas.

A implementação atual ainda possui regras distribuídas entre múltiplos handlers. Isso é uma característica do estado atual, não uma indicação de que já exista uma camada de domínio centralizada.

## 8. Papel do Supabase

O Supabase fornece a camada de dados e serviços persistentes.

No projeto existem evidências de uso de:

- PostgreSQL;
- Storage;
- Realtime;
- funções SQL/RPC para operações sensíveis à concorrência;
- migrations versionadas no diretório `supabase/`.

O banco não deve ser tratado como simples armazenamento passivo: parte das invariantes de negócio e da concorrência de agendamento é implementada no SQL.

A aplicação não deve assumir que uma regra é exclusivamente de frontend ou Worker sem verificar as funções e políticas do banco relacionadas.

## 9. Browser → Worker → Supabase

O fluxo arquitetural pretendido para operações protegidas é:

```text
Interface React
      │
      │ HTTP /api/*
      ▼
Cloudflare Worker
      │
      │ autenticação + autorização + regra de backend
      ▼
Supabase
      │
      ├── dados
      ├── Storage
      └── RPC / SQL
```

Há, entretanto, código administrativo que também utiliza diretamente o cliente Supabase público/realtime. Portanto, a separação `Browser → Worker → Supabase` **não deve ser considerada absoluta em todo o código atual**.

Essa exceção precisa ser mapeada antes de qualquer tentativa de impor uma camada única ou remover acessos existentes.

## 10. Autenticação

O runtime migrado possui dois conceitos de sessão:

- sessão da cliente, baseada no fluxo próprio de CPF + data de nascimento e cookie de sessão;
- sessão administrativa, associada à autenticação administrativa e a um cookie de sessão do Worker.

Os detalhes de autorização e RLS não devem ser inferidos apenas pela existência desses mecanismos. A auditoria identificou necessidade de verificar explicitamente o controle de papel/permissão administrativa antes de considerar a autorização concluída.

Não devem ser colocadas chaves privilegiadas em variáveis `VITE_*` ou no código entregue ao navegador.

## 11. APIs

No runtime migrado, as APIs são expostas pelo Worker sob `/api/*`.

Existem grupos para:

- saúde/runtime;
- sessão e autenticação da cliente;
- agenda e agendamento;
- boletos e arquivos;
- autenticação/sessão administrativa;
- visão geral administrativa;
- clientes;
- pagamentos e parcelas;
- datas e agenda administrativa;
- remarcações;
- relatórios;
- notificações;
- liberação financeira e previsões;
- monitoramento.

A lista acima representa grupos confirmados no código auditado; não deve ser interpretada como garantia de que cada rota representa uma funcionalidade de negócio completa ou validada ponta a ponta.

## 12. Onde as regras de negócio estão hoje

As regras atualmente estão distribuídas entre várias camadas:

```text
Frontend
  ├── componentes/páginas
  └── validações e decisões de interface

Worker
  ├── handlers de API
  └── regras de backend

Supabase
  ├── funções/RPCs
  ├── constraints
  ├── RLS
  └── migrations/schema

Legado Next
  └── regras e rotas históricas ainda presentes no repositório
```

Não existe ainda uma única camada de domínio que seja a autoridade universal para todas as regras.

Isso aumenta o risco de duplicação e divergência e é uma das razões para a futura reorganização por domínio precisar ser incremental.

## 13. Agendamento e concorrência

O banco possui funções/RPCs destinadas a tornar operações de agendamento atômicas e reduzir problemas de concorrência.

Isso é parte importante da arquitetura atual e não deve ser substituído por uma simples validação no frontend.

Qualquer alteração futura que envolva vagas, datas, agendamentos, cirurgia, parcelas, pagamentos ou liberação financeira deve considerar simultaneamente:

- frontend;
- Worker;
- RPC/função SQL;
- constraints;
- RLS;
- migrations relacionadas.

## 14. PWA

A área da cliente `/agenda` possui registro de PWA por componente dedicado.

O PWA é uma preocupação específica da experiência da cliente. A presença de arquivos de service worker, manifest ou Web Push não é suficiente para afirmar que todas as notificações ou recursos offline estão operacionalmente comprovados.

## 15. Monitoramento

Existe monitoramento global no frontend migrado e uma API de persistência de erros no Worker/banco.

O monitoramento cobre classes de erros de interface e rede, mas a auditoria não confirmou uma cobertura preventiva completa de todas as falhas de servidor.

Em particular, não se deve considerar um arquivo de monitoramento preventivo existente como prova de execução agendada. A configuração atual auditada do Worker não comprova, por si só, um cron preventivo contínuo.

## 16. Arquitetura alvo

A arquitetura alvo é uma evolução gradual do runtime migrado, não uma reconstrução simultânea.

```text
Browser
  │
  ▼
React + Vite
  │
  ├── features/
  ├── components/
  ├── services/
  ├── hooks/
  ├── lib/
  ├── types/
  └── config/
          │
          ▼
Cloudflare Worker
  │
  ├── autenticação/autorização
  ├── API
  ├── serviços de domínio
  └── observabilidade
          │
          ▼
Supabase
  ├── PostgreSQL
  ├── RPCs/constraints
  ├── RLS
  ├── Storage
  └── Realtime
```

Essa estrutura é **alvo**, não descrição do estado já concluído.

## 17. Estratégia de migração gradual

A migração deve obedecer às seguintes regras:

1. preservar a identidade visual existente;
2. não alterar `main` sem autorização explícita;
3. desenvolver experimentalmente em `develop`;
4. migrar um domínio por vez;
5. não apagar código legado apenas por aparência de antiguidade;
6. antes de remover legado, mapear consumidores, dependências, equivalente no Worker e dependências de banco;
7. não modificar banco de produção sem autorização;
8. não criar migrations destrutivas;
9. validar cada etapa antes de iniciar a próxima;
10. diferenciar sempre código existente de código comprovadamente ativo.

A remoção do legado deve ser uma etapa posterior, baseada em evidência de que o fluxo novo substitui completamente o antigo.

## 18. Riscos arquiteturais conhecidos

### Alto

- divergência arquitetural entre `develop` e o runtime migrado de `main`;
- regras distribuídas entre frontend, Worker, SQL e legado Next;
- autorização administrativa ainda requer validação específica de papel/permissão;
- ausência de uma camada de testes que prove os fluxos críticos ponta a ponta.

### Médio

- shims de compatibilidade com imports do Next;
- componentes e páginas grandes com responsabilidades múltiplas;
- acesso direto ao Supabase em partes da área administrativa;
- migrations com histórico de numeração que precisa ser tratado com cuidado antes de qualquer reorganização.

Nenhum desses problemas deve ser corrigido automaticamente apenas por este documento.

## 19. Regra para futuras IAs

Antes de alterar qualquer parte do projeto, a IA deve responder:

1. Este arquivo pertence ao runtime ativo?
2. Qual branch contém o código em questão?
3. Existe equivalente no Worker?
4. Existe código legado que implementa a mesma regra?
5. Existe RPC, constraint, RLS ou migration relacionada?
6. O fluxo é financeiro, agenda, autenticação, autorização ou dados de cliente?
7. A alteração pode afetar produção?
8. O comportamento foi comprovado ou apenas inferido pela existência do arquivo?

Se a resposta não puder ser comprovada pelo código ou pelos artefatos disponíveis, registrar **NÃO FOI POSSÍVEL CONFIRMAR** em vez de assumir.

## 20. Princípio central

O objetivo desta arquitetura não é apagar o passado rapidamente. É tornar a migração rastreável:

```text
AUDITAR
   ↓
IDENTIFICAR RUNTIME
   ↓
MAPEAR DEPENDÊNCIAS
   ↓
MIGRAR UM DOMÍNIO
   ↓
VALIDAR
   ↓
COMPROVAR SUBSTITUIÇÃO
   ↓
SOMENTE ENTÃO REMOVER LEGADO
```

A arquitetura React + Vite + Cloudflare Worker + Supabase é a direção de evolução. O estado real de cada branch e de cada arquivo deve continuar sendo a autoridade para decisões técnicas.
