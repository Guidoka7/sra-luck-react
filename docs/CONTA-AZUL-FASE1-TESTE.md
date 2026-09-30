# Conta Azul — validação real da Fase 1 (ERP de teste)

Tudo aqui acontece **fora da produção**: banco de teste, Preview da Vercel e o App de
Desenvolvimento da Conta Azul (conta ERP de teste, dados fictícios). Nada é mesclado na `main`.

## 1. Ambiente isolado

| Peça | Teste | Produção (não tocar) |
|---|---|---|
| Banco Supabase | projeto de teste (ex.: `sra-luck-load-test-10k`, reativado) com o schema + `migration_124` | `sbohknqapprimtspczio` |
| Sra Luck | Preview da Vercel do branch `claude/conta-azul-parcela-unica` | sraluckapp (main) |
| Dev Console | Preview do branch `claude/laughing-maxwell-aqttx9` | Dev Console (main) |

Variáveis **só no escopo Preview, restritas ao branch** (Vercel → Settings → Environment Variables →
Preview → *branch*), para o Preview **não** herdar as de produção:

- Sra Luck (`claude/conta-azul-parcela-unica`): `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do banco de
  teste, `CLIENTE_SESSION_SECRET` e `DEV_CONSOLE_SERVICE_TOKEN` novos (não reutilizar os de produção),
  `PUBLIC_APP_URL` = URL do Preview e `CONTA_AZUL_PREVIEW_PERMITIDO=1`.
  Sem `CONTA_AZUL_PREVIEW_PERMITIDO=1`, a integração responde 503 em qualquer Preview (trava no código).
- Dev Console (`claude/laughing-maxwell-aqttx9`): `SRA_LUCK_PREVIEW_BASE_URL` = URL do Preview do Sra Luck e
  `SRA_LUCK_PREVIEW_SERVICE_TOKEN` = o mesmo `DEV_CONSOLE_SERVICE_TOKEN` do Preview do Sra Luck. Em Preview,
  essas duas têm prioridade sobre o cofre compartilhado; a produção continua lendo o cofre.
- `vercel.json` do Sra Luck desliga deploy de `claude/*`: o Preview é criado manualmente (Redeploy /
  `vercel deploy` do branch) **depois** das variáveis acima.
- Crons da Vercel só rodam em produção; no teste, a sincronização é disparada pelo Dev Console.

## 2. App de Desenvolvimento da Conta Azul

No Portal do Desenvolvedor, o App de Desenvolvimento (ex.: `DEV-Sra-1790792215267`) usa a Redirect URI `https://contaazul.com`
(conferido no portal em 30/09/2026; a documentação cita `www.contaazul.com`). O navegador pode terminar em
`https://www.contaazul.com/?code=…`: o Concluir conexão aceita os dois, e a troca usa a Redirect URI cadastrada, exata.
O retorno do login não chega ao Sra Luck, por isso o Dev Console tem **Concluir conexão**: cole o
endereço completo da barra do navegador (`?code=…&state=…`) em até 3 minutos. O state é validado contra
a sessão que gerou o link e o code é trocado no backend; nem o code nem os tokens são gravados em log.

Dev Console → Integrações → Conta Azul → **Central**:

1. Configuração do App: Client ID, Client Secret, Redirect URI (`https://contaazul.com`, igual ao portal), ambiente
   Teste e as URLs oficiais → Salvar configuração (só máscaras voltam para a tela).
2. Conectar (OAuth) → entrar com o usuário do ERP de teste → copiar o endereço → Concluir conexão.
3. Testar conexão (empresa conectada), Renovar token agora (refresh), Validar e ativar.
4. Diagnóstico da API com o CPF de uma pessoa do ERP de teste: grava a estrutura real de cada resposta
   (evento `diagnostico_api`), sem nome, documento ou e-mail.

## 3. Roteiro (evidência de cada item)

| # | Item | Onde fica a evidência |
|---|---|---|
| 1–3 | pessoa por CPF, pessoa por ID, receitas da pessoa | diagnóstico (etapas `pessoas_por_cpf`, `pessoa_por_id`, `receitas_da_pessoa_*`) |
| 4–10 | estrutura da parcela, status, vencimentos, valores, juros, multa, desconto | diagnóstico (`parcela_por_id`) + prévia de importação |
| 11 | `versao` para `PATCH` | diagnóstico (`parcela_por_id`: `versao=`) + log `atualizou_parcela_conta_azul` |
| 12 | resposta do `POST` de baixa | log `enviou_baixa_conta_azul` (`camposResposta`, `conferidaNaContaAzul`) |
| 13 | `/alteracoes` | diagnóstico (`alteracoes_24h`) + evento `sync_manual` |
| 14 | limites/paginação | cabeçalhos de cada etapa do diagnóstico, `itens_totais` |
| 15 | refresh token | eventos `token_renovado` / `token_falhou` |
| 16 | revogação | Desconectar → evento `desconectado` (`revogadaNaContaAzul`) → nova renovação falha → Reautorizar |

Fluxos no Admin do Preview (clientes **de teste** criadas no banco de teste):

- Vínculo: CPF inexistente, pessoa encontrada, pessoa já vinculada a outra cliente, vínculo duplicado.
- Financeiro que nasce da Conta Azul: prévia → desmarcar avulsos → importar; conferir pagas/abertas/vencidas
  e juros/multa no ledger (`financeiro_recebimentos`, origem `conta_azul`).
- Cliente com financeiro: correspondência exata, vencimento divergente (vincular sem alterar datas), valor
  divergente, só Sra Luck, só Conta Azul, paga só de um lado (vai para revisão, nunca baixa sozinha).
- Sra Luck → Conta Azul: baixa manual com principal + juros + multa (+ desconto) → Sincronização manual →
  a baixa é relida na Conta Azul e conferida (`conferidaNaContaAzul: true`), senão abre conflito.
- Conta Azul → Sra Luck: baixa feita no ERP de teste → Sincronização manual → recebimento `conta_azul`
  na parcela certa; repetir a sincronização não duplica nem devolve a baixa (anti-loop).
- Falhas: token expirado (renova sozinho), revogado (sync em erro, fila intacta), indisponível/timeout/429
  (operação local fica válida e a fila tenta de novo sem duplicar).

## 4. Depois da validação

Sem autorização explícita: nada de merge, `migration_124` em produção ou deploy de produção.
Ao final, desligar o App de Desenvolvimento (Desconectar) e remover as variáveis de Preview.
