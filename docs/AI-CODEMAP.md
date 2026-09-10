# AI Code Map — Sra. Luck React

Mapa rápido para localizar código antes de editar.

## 1. Entradas do sistema

| Área | Entrada | Responsabilidade |
|---|---|---|
| Frontend | `src/main.tsx` | Inicialização da SPA React |
| Backend | `worker/index.ts` | Entrada HTTP e roteamento das APIs |
| Cloudflare | `wrangler.jsonc` | Worker, assets e deploy |
| Build | `vite.config.ts` | Vite + integração Cloudflare |
| Banco | `supabase/` | schema, migrations, RPCs e políticas |

## 2. Onde mexer por tipo de pedido

### “Mude o visual / design / layout”

Leia primeiro:

- `src/pages/`
- `src/components/`
- `src/styles/`
- componentes específicos usados pela tela

Evite alterar backend se a mudança for apenas visual.

### “Mude um fluxo da cliente”

Normalmente envolve:

- página React em `src/pages/`
- componentes relacionados em `src/components/`
- chamadas HTTP em `src/lib/` ou na própria página
- rota correspondente em `worker/`
- possíveis regras no `supabase/`

Exemplos: login, agenda, agendamento, boletos.

### “Mude algo do admin”

Verifique:

- páginas/componentes administrativos no frontend
- sessão admin em `worker/session.ts`
- autenticação/dispatch em `worker/index.ts`
- módulos `worker/admin-*.ts`
- RPCs/tabelas no Supabase relacionadas

### “Mude agenda/agendamento”

Nunca trate como mudança só de interface.

Verifique em conjunto:

- UI da agenda
- endpoints Worker de agenda/agendamento
- módulos de ações de agendamento
- migrations/RPCs do Supabase para concorrência e vagas

### “Mude pagamentos/parcelas/financeiro”

Verifique:

- telas administrativas correspondentes
- `worker/admin-finance.ts`
- `worker/admin-reports.ts` quando houver impacto em relatório
- tabelas, views, RPCs e migrations relacionadas no Supabase

### “Mude notificações”

Verifique:

- UI/configuração de notificações
- `worker/admin-notificacoes.ts`
- scripts de notificação em `scripts/`
- VAPID/secrets
- service worker e arquivos PWA relevantes

### “Mude boletos/uploads”

Verifique:

- telas do cliente/admin relacionadas
- `worker/client-boletos.ts`
- Supabase Storage
- regras de autorização

## 3. Código ativo x legado

### Ativo no runtime de destino

Prioridade de leitura:

```text
src/main.tsx
src/pages/
src/components/
src/lib/
worker/
wrangler.jsonc
vite.config.ts
supabase/
```

### Legado/transição

Pode continuar necessário como referência durante a migração:

```text
src/app/
src/middleware.ts
src/lib/supabase/server.ts
next.config.js
arquivos/documentos Netlify antigos
```

Não implemente novas funcionalidades no legado sem motivo explícito.

## 4. Fluxo de leitura recomendado para IA

Para qualquer tarefa funcional:

1. Identifique a tela/rota pedida.
2. Ache a chamada HTTP usada pela tela.
3. Ache o handler correspondente no Worker.
4. Ache a tabela/RPC/política relacionada no Supabase.
5. Só então faça a alteração.

Isso evita corrigir apenas uma camada e quebrar outra.

## 5. Áreas sensíveis

Antes de editar, tenha cuidado extra com:

- autenticação de cliente por CPF + nascimento;
- autenticação administrativa;
- cookies e assinatura de sessão;
- service role do Supabase;
- rate limit;
- CSRF/origin checks;
- agenda concorrente e controle de vagas;
- Storage/arquivos privados;
- pagamentos e parcelas;
- Web Push/VAPID.

## 6. Padrão para novas funcionalidades

Quando uma feature nova for adicionada, prefira esta separação:

```text
src/
  features/
    <dominio>/
      components/
      hooks/
      api.ts
      types.ts

worker/
  routes/
    <dominio>.ts
  services/
    <dominio>.ts

supabase/
  migrations/
```

Essa é a direção desejada para código novo. Não é necessário mover todo o legado de uma vez.

## 7. Regra para IA

Uma alteração é considerada completa apenas quando a IA consegue responder:

- Qual tela foi alterada?
- Qual API ela usa?
- Qual regra de backend foi afetada?
- Qual dado/RPC/política do Supabase está envolvido?
- Existe equivalente no PWA que precisa ser preservado?
