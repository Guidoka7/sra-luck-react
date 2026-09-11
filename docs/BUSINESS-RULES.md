# Regras de negócio — Sra. Luck

Este documento é a fonte de verdade funcional atual do novo projeto. Regras antigas do PWA que conflitarem com este arquivo devem ser tratadas como legado a ser substituído.

## 1. Natureza do negócio

A Sra. Luck não é uma clínica. Ela atua como facilitadora/intermediadora financeira para clientes que contratam uma carta/crédito destinada à realização de cirurgia programada.

O sistema deve separar claramente operação financeira, jornada contratual e agenda. Não modelar a empresa como prontuário ou sistema médico.

## 2. Receita da Sra. Luck

A Sra. Luck ganha dinheiro pela **taxa administrativa**.

A taxa administrativa é incorporada ao valor total que a cliente paga e fica embutida nas parcelas. Ela não precisa aparecer como cobrança isolada.

O modelo deve distinguir pelo menos:

- valor base/carta/crédito;
- percentual da taxa administrativa;
- valor da taxa administrativa;
- valor total contratado;
- quantidade de parcelas;
- valor das parcelas;
- receita administrativa prevista;
- receita administrativa realizada;
- receita administrativa ainda a receber.

Nunca tratar todo o valor do contrato como receita da empresa.

## 3. Progresso operacional da cliente

O percentual usado para elegibilidade é calculado por **quantidade de parcelas pagas**, não por valor monetário.

Fórmula conceitual:

`parcelas_pagas / total_parcelas × 100`

Exemplo: 7 de 12 parcelas = 58,3%. Se a regra exigir 60%, 7 parcelas ainda não atingem a elegibilidade. A quantidade mínima efetiva deve respeitar a política configurada para o contrato.

Valor pago, juros, multas, descontos e antecipações continuam relevantes para conciliação e saldo final, mas não mudam sozinhos a quantidade de parcelas pagas.

## 4. Contrato e política

Cada contrato deve permitir configuração/registro de:

- modalidade;
- valor base/crédito;
- taxa administrativa;
- valor total;
- quantidade de parcelas;
- calendário de vencimentos;
- percentual mínimo de elegibilidade;
- formas de quitação final permitidas;
- banco/provedor de cobrança;
- origem/campanha;
- vendedor/consultora;
- SDR quando aplicável;
- regras específicas vigentes na data da contratação.

Regras operacionais devem ser versionáveis para que mudança futura não altere silenciosamente contratos antigos.

## 5. Entrada comercial

Fluxo alvo:

RD Station CRM → venda/negócio fechado → criação/atualização da cliente/contrato → conferência interna → escolha/configuração do banco → geração das cobranças.

Evitar duplicidade por identificadores confiáveis, especialmente CPF e identificador externo do negócio.

Guardar origem/campanha para relatórios e forecast.

## 6. Cobrança e parcelas

Provedores previstos:

- BRB Cobrança;
- Banco do Brasil;
- Santander;
- Sicredi;
- Efí.

Cada parcela deve possuir identidade interna estável e vínculos externos suficientes para conciliação inequívoca.

Estados devem representar a realidade operacional, por exemplo:

- em aberto;
- vencida;
- aguardando validação;
- paga/liquidada;
- rejeitada;
- suspensa/realocada quando aplicável.

O sistema deve preservar histórico em vez de apagar eventos relevantes.

## 7. Comprovantes

Cliente anexa comprovante → parcela fica aguardando validação → financeiro aprova ou rejeita.

Se o banco liquidar a parcela por webhook antes/depois da validação manual:

- a liquidação bancária pode confirmar o pagamento;
- o comprovante anexado permanece no histórico;
- não duplicar a baixa;
- registrar origem e horário da confirmação.

## 8. Financeiro diário

A operação diária precisa separar pelo menos:

- liquidados no banco;
- vencidos;
- aguardando validação;
- divergências.

A equipe deve navegar por data e chegar rapidamente à ação necessária.

## 9. Conta Azul

Objetivo: sincronizar contas a receber/baixas com Conta Azul.

O sistema interno deve ser capaz de registrar e transmitir, quando a API permitir:

- parcela/recebível;
- data real de pagamento;
- valor recebido;
- juros;
- multa;
- desconto;
- observação;
- comprovante/referência;
- identificadores externos.

Baixas precisam ser idempotentes e vinculadas à parcela correta.

## 10. Mercado Pago

Objetivo: permitir pagamento por cartão associado à parcela correta ou ao saldo autorizado.

Evitar armazenar dados brutos de cartão.

Fluxo inicial conservador:

criar preferência/pagamento → receber webhook → vincular ao item correto → registrar como recebido/aguardando validação conforme política operacional → confirmação humana enquanto a integração ainda estiver em homologação.

Automação completa pode ser habilitada depois de comprovada estabilidade.

## 11. Jornada de elegibilidade e termos

### Etapa A — formação do contrato

A cliente paga suas parcelas normalmente.

### Etapa B — percentual mínimo

Ao atingir o percentual mínimo de parcelas pagas, a cliente pode iniciar o processo de termos.

A ação esperada é equivalente a:

**Solicitar agendamento dos termos cirúrgicos**.

### Etapa C — levantamento financeiro

Após solicitar, exibir que o levantamento financeiro está em andamento, com prazo operacional atual de até **5 dias úteis**.

O financeiro verifica a situação real do contrato e determina:

- saldo restante;
- pendências;
- formas de pagamento permitidas;
- condições específicas do contrato.

### Etapa D — formas de quitação

Modalidade Flex pode permitir, conforme análise:

- PIX;
- cartão de crédito;
- cheque.

Modalidade 100% boleto pode permitir saldo por boleto conforme análise e política de crédito.

As opções são definidas individualmente pelo financeiro/configuração do contrato. Não assumir que todas as formas estão disponíveis para todas as clientes.

### Etapa E — momento do pagamento

A cliente pode escolher, quando permitido:

- pagar agora;
- pagar no dia da assinatura dos termos.

### Etapa F — agenda dos termos

O admin publica datas/horários. A cliente escolhe somente entre slots disponíveis.

Se não conseguir cumprir a quitação para a data escolhida, pode reagendar conforme política. O histórico anterior deve permanecer.

### Etapa G — assinatura + quitação

No dia da assinatura, a cliente precisa cumprir a condição financeira definida. Para avançar, devem existir marcos claros de:

- termos assinados;
- quitação/saldo final confirmado.

## 12. Liberação da agenda cirúrgica

A regra nova substitui a lógica histórica de 90 dias.

Após **termos assinados + quitação confirmada**, inicia-se o prazo operacional atual de **5 dias úteis**.

Após esse prazo, a agenda cirúrgica é liberada para a cliente selecionar uma data publicada pelo admin.

O prazo deve ser configurável/politicamente versionável; o valor atual é 5 dias úteis.

## 13. Cirurgia

Fluxo:

agenda cirúrgica liberada → cliente escolhe data disponível → confirmação → cirurgia agendada → posteriormente admin registra conclusão/realização.

A agenda deve manter histórico e evitar dupla ocupação/conflitos.

## 14. Forecast / carteira futura

O sistema deve prever quando clientes tendem a atingir o percentual mínimo usando a sequência de vencimentos das parcelas e a quantidade necessária.

Horizontes desejados:

- 30 dias;
- 60 dias;
- 90 dias;
- 180 dias;
- períodos customizáveis.

Filtros importantes:

- campanha/origem;
- vendedor/consultora;
- SDR;
- modalidade;
- banco/provedor;
- mês da venda;
- status;
- quantidade de parcelas.

Manter separados, quando houver dados suficientes:

- forecast contratual pelo calendário esperado;
- forecast comportamental baseado no histórico real de pagamento.

## 15. Cliente — Clube de Vantagens

A cliente pode ganhar pontos principalmente por indicações válidas.

O sistema deve controlar:

- pontos disponíveis;
- pontos utilizados;
- histórico;
- origem do crédito;
- indicação vinculada;
- recompensa/resgate;
- prevenção de duplicidade/fraude.

Catálogo configurável, com exemplos como kits, massagem, spa, nécessaire, vouchers e benefícios de parceiros.

## 16. Colaboradores

Papéis iniciais:

- Vendedora;
- SDR;
- Financeiro;
- Gestão;
- Admin/Diretoria.

Permissões devem ser configuráveis e aplicadas no backend, não apenas escondidas no frontend.

### Comissão da vendedora

Regra inicial: R$ 100 quando um contrato atribuído à vendedora tiver a primeira parcela efetivamente paga.

Evitar comissão duplicada.

### Comissão do SDR

Regra inicial: R$ 10 por agendamento qualificado com comparecimento, independentemente de fechamento.

### Comissão do financeiro

Regra inicial informada: 1,69% sobre valor em atraso recuperado, com meta/faixa inicial em torno de R$ 90.000.

Essa regra deve ser configurável por faixas e vigência. Não hardcodar permanentemente.

### Treinamentos

Admin deve conseguir publicar treinamentos em vídeo, imagem e texto e acompanhar acesso/conclusão quando aplicável.

## 17. Notificações

Eventos relevantes incluem:

- parcela criada/próxima do vencimento/vencida;
- comprovante recebido/aprovado/rejeitado;
- percentual mínimo atingido;
- levantamento iniciado/concluído;
- formas de pagamento disponíveis;
- agenda liberada;
- agendamento confirmado/remarcado;
- lembrete de termos;
- quitação confirmada;
- agenda cirúrgica liberada;
- cirurgia agendada.

Templates e automações devem ser configuráveis.

## 18. Princípio de rastreabilidade

Para eventos financeiros, agenda, permissões, comissões e mudanças críticas, registrar quem/qual sistema fez a alteração, quando, sobre qual entidade e com quais identificadores necessários para auditoria.

## 19. Princípio de maleabilidade

Nenhuma regra operacional descrita como "atual", "inicial" ou "exemplo" deve virar constante difícil de alterar sem necessidade técnica.

O produto precisa aceitar evolução de fluxo, design, integrações, taxas, prazos, políticas e permissões sem desorganização estrutural.