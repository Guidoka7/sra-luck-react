# Migration Map — Next/PWA → React + Vite + Cloudflare Workers

Este documento ajuda pessoas e IAs a entenderem o estado da migração sem confundir código legado com código ativo.

## Estado do projeto

- `sra-luck-pwa` = projeto base funcional atual e referência de comportamento durante a migração.
- `sra-luck-react` = projeto de destino.
- Quando a migração terminar, `sra-luck-react` será o projeto oficial.

## Regra de equivalência

Uma funcionalidade só deve ser marcada como migrada quando houver equivalência funcional em quatro camadas:

1. interface React;
2. API/Worker;
3. banco/Supabase;
4. comportamento observado no projeto base.

## Matriz de migração

| Domínio | Frontend React | Worker | Supabase | Legado ainda serve de referência? | Status |
|---|---|---|---|---|---|
| Login cliente | existente | existente | existente | sim | em validação |
| Sessão cliente | existente | existente | existente | sim | em validação |
| Login admin | existente | existente | existente | sim | em validação |
| Sessão admin | existente | existente | existente | sim | em validação |
| Agenda cliente | existente | existente | existente | sim | em validação |
| Agendamento cirurgia | existente | existente | existente | sim | em validação |
| Agenda admin | existente | existente | existente | sim | em validação |
| Clientes admin | existente | existente | existente | sim | em validação |
| Boletos/uploads | existente | existente | Storage/banco | sim | em validação |
| Pagamentos/parcelas | existente | existente | existente | sim | em validação |
| Relatórios | existente | existente | existente | sim | em validação |
| Notificações | parcial | existente | existente | sim | em migração |
| PWA/Web Push | parcial | parcial | existente | sim | em migração |
| Monitoramento | existente | existente | existente | sim | em validação |
| Remoção do Next legado | n/a | n/a | n/a | sim | não iniciar até equivalência |

> “Existente” significa que há implementação encontrada no repositório, não que o fluxo esteja garantidamente homologado ponta a ponta.

## Critério para marcar como concluído

Antes de trocar `em validação`/`em migração` por `concluído`, confirmar:

- rota/tela acessível;
- chamadas de API corretas;
- autenticação/autorização corretas;
- erros tratados;
- loading tratado;
- regras do PWA preservadas;
- RPCs/constraints relevantes preservadas;
- `npm run lint` passando;
- `npm run build` passando;
- teste manual do fluxo principal;
- ausência de dependência do runtime Next para aquele fluxo.

## Critério para remover legado

Um arquivo/rota Next pode ser removido quando:

1. nenhum código ativo o importa;
2. a funcionalidade equivalente existe no React/Worker;
3. não existe regra de negócio exclusiva ali;
4. banco/RPCs necessários já estão preservados;
5. build e testes continuam passando após remoção.

## Prioridade recomendada

1. autenticação e sessão;
2. agenda e agendamento;
3. admin de clientes;
4. boletos/uploads;
5. pagamentos/parcelas/financeiro;
6. relatórios;
7. notificações/Web Push;
8. monitoramento;
9. limpeza final do legado Next/Netlify.

## Atualização deste arquivo

Toda migração relevante deve atualizar a linha correspondente nesta tabela. Isso ajuda outra IA a saber imediatamente o que já pode ser alterado no runtime novo sem voltar ao legado por engano.
