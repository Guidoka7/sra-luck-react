# Sra. Luck — Modelo operacional do produto

Este documento define a experiência de destino do `sra-luck-react`.

## Natureza do negócio

A Sra. Luck atua como facilitadora de crédito/intermediadora financeira para clientes que contratam carta de crédito destinada a procedimentos cirúrgicos. O sistema não deve ser modelado como software de clínica.

## Jornada principal da cliente

1. Venda entra pelo RD Station.
2. Cliente/contrato fica aguardando conferência.
3. Parcelas/boletos são gerados no banco escolhido e disponibilizados no app.
4. O sistema acompanha o percentual efetivamente pago do contrato.
5. Ao atingir o percentual mínimo configurado (ex.: 60%), a cliente pode solicitar o processo de termos cirúrgicos.
6. Após a solicitação, o financeiro realiza levantamento em até 5 dias úteis.
7. O financeiro informa o saldo restante e as formas de quitação disponíveis conforme modalidade:
   - Flex: PIX, cartão de crédito, cheque mediante análise.
   - 100% boleto: pode incluir boleto do saldo, mediante análise.
8. A cliente escolhe a forma e se paga imediatamente ou no dia da assinatura.
9. A agenda de assinatura é liberada com datas/horários publicados pelo admin.
10. No dia da assinatura, o saldo restante precisa estar quitado; se não for possível, a cliente pode reagendar.
11. Com saldo quitado e termos assinados, após 5 dias úteis a agenda cirúrgica é liberada.
12. A cliente escolhe data da cirurgia e acompanha o processo pelo app.

## Financeiro e conciliação

Fontes: BRB Cobrança, Banco do Brasil, Santander, Sicredi, Efí, Mercado Pago, comprovantes enviados no app e Conta Azul.

A visão diária deve separar:
- liquidados no banco;
- vencidos;
- aguardando validação;
- divergências.

Se houver comprovante anexado e o banco posteriormente liquidar a mesma parcela, a parcela deve ser baixada pela liquidação bancária e o anexo deve permanecer no histórico.

Toda parcela deve possuir trilha de eventos e vínculos externos suficientes para conciliação inequívoca.

## Pipeline operacional

- Nova venda
- Aguardando conferência
- Em formação de saldo
- Próxima do percentual mínimo
- Percentual mínimo atingido
- Aguardando levantamento financeiro
- Forma de pagamento liberada
- Termos agendados
- Aguardando quitação final
- Quitado
- Agenda cirúrgica liberada
- Cirurgia agendada
- Concluído

## Planejamento

O sistema deve projetar quando os contratos atingirão o percentual mínimo com base em valores e vencimentos, não apenas quantidade de parcelas.

Deve permitir filtros por campanha/origem do RD Station, vendedor, modalidade, banco, mês da venda e status.

## Clube de vantagens

A cliente ganha pontos principalmente por indicações válidas. Os pontos podem ser trocados por mimos/experiências, por exemplo:
- kit Giovanna Baby;
- kit autocuidado;
- massagem relaxante;
- vale-spa;
- nécessaire premium;
- voucher de beleza;
- experiências/parcerias configuráveis.

## App de colaboradores

Perfis:
- Vendedora
- SDR
- Financeiro
- Gestão
- Admin/Diretoria

Módulos:
- início;
- comissões;
- treinamentos;
- metas/indicadores;
- perfil.

Regras iniciais de comissão:
- Vendedora: R$ 100 quando contrato vendido tiver a primeira parcela paga.
- SDR: R$ 10 por agendamento com comparecimento, independentemente de fechamento.
- Financeiro: 1,69% inicialmente sobre valor em atraso recuperado, com meta inicial de R$ 90.000 e faixas configuráveis pelo admin.

Admin deve poder criar acessos, definir permissões, alterar regras de comissão e publicar treinamentos em vídeo, imagem e texto.

## Integrações planejadas

- RD Station CRM: entrada de vendas/negócios.
- Conta Azul: contas a receber e baixas.
- Mercado Pago: pagamento por cartão associado à parcela correta.
- BRB Cobrança, Banco do Brasil, Santander, Sicredi e Efí: emissão, alteração, cancelamento, consulta e webhooks de liquidação.

Credenciais, homologação e particularidades de cada provedor devem ficar no backend/Worker e nunca no navegador.
