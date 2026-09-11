# Features frontend

Esta pasta é a direção oficial para código de produto do frontend React.

## Regra

Uma feature deve representar um domínio funcional, não apenas uma tela.

Estrutura sugerida por feature:

```text
feature/
  components/
  hooks/
  services/
  types.ts
  config.ts        # quando houver configuração pública/local da feature
  index.ts
```

Nem toda feature precisa de todas as pastas.

## Domínios alvo

À medida que a migração avançar, preferir domínios como:

- `auth/`
- `client/`
- `contracts/`
- `installments/`
- `finance/`
- `scheduling/`
- `journey/`
- `notifications/`
- `staff/`
- `rewards/`
- `admin/`

## Regras

- Não duplicar regra de negócio entre features.
- Não chamar provider externo diretamente de componente.
- Não colocar segredo/config privada no frontend.
- Serviços HTTP pertencem à feature quando específicos; serviços transversais podem ficar em `src/services/` no futuro.
- Componentes genéricos pertencem a `src/components/ui` ou camada equivalente.
- Antes de migrar uma feature do PWA, consultar `docs/PWA-FUNCTIONAL-BASELINE.md`.
- Antes de alterar fluxo, consultar `docs/BUSINESS-RULES.md` e `docs/FLOWS.md`.

## Migração incremental

Não mover arquivos apenas por estética. Mover quando estiver trabalhando naquele domínio e houver condição de manter imports, testes e runtime estáveis.

Ao concluir uma migração de estrutura, atualizar `docs/AI-CODEMAP.md`.