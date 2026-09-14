# Auditoria final — regras críticas e integração RD Station (2026-09-14)

## Escopo

Este registro consolida as regras que devem permanecer invariantes no Admin ZIP e documenta a integração RD Station CRM. O ZIP continua sendo a fonte de verdade visual; esta rodada não reintroduz telas do painel antigo.

## 1. Liberação cirúrgica — 90 dias corridos

Regra vigente: **termos assinados + quitação/custeio confirmado**. Nenhum dos dois eventos isoladamente inicia a janela. A data-base é o evento mais recente entre os dois e o prazo máximo é **data-base + 90 dias corridos**.

`worker/surgery-release.ts` é a implementação ativa dessa regra. `PRAZO_MAXIMO_LIBERACAO_CIRURGICA_DIAS_CORRIDOS = 90` e `calcularLiberacaoCirurgica()` retorna `null` se faltar assinatura ou quitação.

A ocorrência de **5 dias úteis** em `PRAZO_REVISAO_FINANCEIRA_DIAS_UTEIS` / `RevisaoFinanceiraCard` corresponde ao SLA independente de revisão financeira e permanece válida. Texto de 5 dias que estava apresentado em **remarcações** foi removido porque não existe regra aprovada que aplique esse SLA à remarcação.

## 2. Elegibilidade

Elegibilidade financeira é calculada por **quantidade de parcelas pagas / quantidade de parcelas exigidas**. A API administrativa agrega `boletos` por cliente, conta registros com `status = pago` e deriva o percentual a partir dessas contagens. Valor pago / valor do contrato não governa elegibilidade.

## 3. Referência mensal de R$ 100 mil

`configuracoes.meta_orcamento_mensal` é referência de planejamento. O motor de agenda usa a referência para classificar/sugerir capacidade e sinalizar ultrapassagem; não é bloqueio de liberação. A interface ZIP também explicita: **Planejamento, não trava operacional**.

## 4. Mercado Pago — sem baixa automática

Fluxo obrigatório:

1. Worker cria checkout usando o valor real da parcela calculado no backend.
2. Mercado Pago envia webhook.
3. Worker valida a assinatura e consulta o pagamento no provedor.
4. O evento externo é persistido em `pagamentos_externos` / `integracao_eventos`.
5. Quando o provedor informa `approved`, a parcela pode ser sinalizada como **pendente de confirmação**, nunca como paga pelo webhook.
6. A baixa definitiva continua sendo ação humana do Financeiro e usa o fluxo/RPC financeiro auditado.

O webhook não chama `financeiro_baixar_boleto` e não grava `status = pago`.

## 5. RD Station CRM — fronteira somente leitura

Regra arquitetural absoluta:

- **RD Station → Sra. Luck: permitido**.
- **Sra. Luck → dados comerciais do RD Station: proibido**.

A camada `worker/rd-station-readonly.ts` possui guarda explícita que aceita somente `GET` nos recursos comerciais `/crm/v2/*`. POST é usado exclusivamente no endpoint OAuth `/oauth2/token`, para autenticação/renovação de token — nunca para negociação, contato, campanha, usuário ou qualquer outra entidade comercial.

### Dados externos x dados locais

`novas_vendas` mantém duas camadas:

- campos operacionais locais: `nome_completo`, `telefone`, `email`, `campanha_local`, `origem_venda`, `vendedora_responsavel`, valores e demais informações usadas pelo Sra. Luck;
- snapshot RD: campos `rd_*`, `payload_original` e `rd_snapshot`.

Na primeira entrada de uma negociação ganha, os valores RD podem inicializar a cópia local. Depois disso, sincronizações/webhooks atualizam **somente o snapshot externo**. Alterações locais de nome, campanha, origem, vendedora, telefone ou demais campos não geram chamada ao RD e não são sobrescritas por sincronização posterior.

### Sincronização e idempotência

- sincronização inicial/manual: GET paginado de negociações ganhas e dados auxiliares;
- `rd_station_id` único impede duplicação da mesma negociação no staging local;
- webhook usa `transaction_uuid` como chave idempotente;
- eventos de exclusão do RD marcam o snapshot externo como excluído, mas **não apagam cliente/venda local**;
- as tabelas de integração usam RLS sem policy direta: apenas o Worker/service role é autoridade.

### OAuth

São suportados Client ID, Client Secret, Redirect URI, Access Token, Refresh Token e rotação do refresh token. Credenciais persistidas pelo painel/Worker continuam cifradas por AES-GCM usando o mecanismo já existente de `integracoes_credenciais`. Nenhuma credencial é exposta ao frontend.

## 6. Endpoints RD internos

- `GET /api/admin/integrations/rd-station/authorize-url`
- `GET /api/integrations/rd-station/oauth/callback`
- `POST /api/admin/integrations/rd-station/test`
- `POST /api/admin/integrations/rd-station/sync`
- `POST /api/integrations/rd-station/webhook`

Todos os endpoints administrativos usam sessão/RBAC. O webhook exige segredo próprio e a sincronização é idempotente.

## 7. Interface

A tela ZIP de Integrações mantém seu desenho e recebe apenas os estados/funções reais: OAuth, teste de conexão, sincronização, última sincronização, último webhook, erros e a mensagem explícita de **somente leitura**. `Sincronizar agora` significa buscar dados do RD; nunca enviar alterações ao CRM.
