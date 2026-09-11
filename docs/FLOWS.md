# Fluxos operacionais — Sra. Luck

Este arquivo resume os fluxos que devem orientar frontend, Worker e banco. Ele complementa `BUSINESS-RULES.md`.

## 1. Venda → contrato → parcelas

```text
RD Station / origem comercial
        ↓
Venda/negócio identificado
        ↓
Cliente/contrato criado ou atualizado
        ↓
Conferência interna
        ↓
Modalidade + valor base + taxa administrativa
        ↓
Quantidade de parcelas + política vigente
        ↓
Escolha do banco/provedor
        ↓
Geração das cobranças
        ↓
Cliente passa a acompanhar no app
```

Requisitos:

- evitar duplicidade por CPF/identificador externo;
- registrar origem/campanha;
- guardar vínculo com vendedor/SDR quando aplicável;
- não misturar valor base com receita administrativa;
- gerar cobranças com identidade externa por parcela.

## 2. Parcela → pagamento → conciliação

```text
Parcela em aberto
   ├─ banco liquida → webhook → validação → paga
   ├─ cliente envia comprovante → aguardando validação → financeiro aprova/rejeita
   └─ Mercado Pago → webhook → conciliação → política de validação
```

Se houver mais de uma evidência do mesmo pagamento, consolidar na mesma parcela. Nunca duplicar baixa.

Eventos relevantes devem ficar em histórico/auditoria.

## 3. Percentual de elegibilidade

```text
parcelas pagas
      ÷
total de parcelas
      ↓
percentual operacional
      ↓
comparar com política do contrato
```

Não usar valor monetário pago para essa elegibilidade.

## 4. Percentual atingido → levantamento

```text
Percentual mínimo atingido
        ↓
Cliente vê que já pode iniciar o processo
        ↓
"Solicitar agendamento dos termos cirúrgicos"
        ↓
Solicitação registrada
        ↓
Status: levantamento financeiro em andamento
        ↓
Prazo operacional atual: até 5 dias úteis
```

O financeiro calcula saldo real e define opções permitidas.

## 5. Levantamento → forma de quitação

```text
Financeiro conclui levantamento
        ↓
Saldo restante confirmado
        ↓
Formas permitidas definidas
        ↓
Cliente visualiza opções
        ↓
Escolhe forma
        ↓
Escolhe momento:
  pagar agora
  OU
  pagar no dia dos termos
```

Opções possíveis dependem do contrato/análise:

- PIX;
- cartão;
- cheque;
- boleto para modalidade/política compatível.

## 6. Agenda dos termos

```text
Admin publica data/horário
        ↓
Cliente vê somente slots disponíveis
        ↓
Seleciona
        ↓
Confirma
        ↓
Agendamento dos termos ativo
```

Remarcação:

```text
Cliente não conseguirá cumprir a data/condição
        ↓
Solicita remarcação
        ↓
Novo slot aprovado/confirmado
        ↓
Histórico anterior preservado
```

## 7. Termos + quitação → agenda da cirurgia

```text
Dia dos termos
   ↓
Termos assinados
   +
Quitação/saldo final confirmado
   ↓
Início do prazo operacional
   ↓
5 dias úteis (regra atual)
   ↓
Agenda cirúrgica liberada
   ↓
Cliente escolhe data publicada
   ↓
Cirurgia agendada
   ↓
Admin registra realização/conclusão
```

A regra antiga de 90 dias não deve governar o novo fluxo.

## 8. Financeiro diário

```text
Data selecionada
  ├─ Liquidados banco
  ├─ Vencidos
  ├─ Aguardando validação
  └─ Divergências
```

Cada item deve levar diretamente à ação operacional correspondente.

## 9. Conta Azul

```text
Evento financeiro interno confirmado
        ↓
Normalização
        ↓
Vínculo parcela/recebível
        ↓
Sincronização Conta Azul
        ↓
ID externo + resultado registrado
```

Falha externa não pode apagar o evento interno. Deve existir retry controlado/idempotente.

## 10. RD Station

```text
Negócio/venda no CRM
        ↓
Webhook/poll seguro
        ↓
Normalização
        ↓
Deduplicação
        ↓
Cliente + contrato + origem/campanha
        ↓
Fila/estado de conferência
```

## 11. Comissões

### Vendedora

```text
Contrato atribuído
   ↓
Primeira parcela efetivamente paga
   ↓
Evento de elegibilidade da comissão
   ↓
Comissão gerada uma única vez
```

### SDR

```text
Agendamento qualificado
   ↓
Comparecimento confirmado
   ↓
Comissão gerada
```

### Financeiro

```text
Valor vencido elegível
   ↓
Recuperação confirmada
   ↓
Aplicar faixa/regra vigente
   ↓
Comissão calculada
```

## 12. Indicação e Clube de Vantagens

```text
Cliente compartilha indicação
        ↓
Lead/venda identifica indicadora
        ↓
Condição configurada é atendida
        ↓
Crédito de pontos idempotente
        ↓
Saldo de pontos
        ↓
Resgate
        ↓
Histórico
```

## 13. Notificações

Uma notificação nasce de evento real, não da existência de uma tela.

```text
Evento de domínio
  ↓
Regra/template configurado
  ↓
Canal permitido
  ↓
Envio
  ↓
Resultado/log
```

Eventos importantes estão listados em `BUSINESS-RULES.md`.

## 14. Regra para implementação de qualquer fluxo

Cada transição importante deve responder:

- qual é o estado anterior?
- qual ação dispara a transição?
- quem pode executar?
- qual validação é obrigatória?
- qual é o novo estado?
- o que é persistido?
- qual evento/auditoria é registrado?
- há notificação?
- pode ser repetido sem duplicar efeito?
- qual tela reflete o resultado?

Se essas respostas não estiverem claras, o fluxo ainda não está pronto para implementação.