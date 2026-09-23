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

O RD Station é somente leitura: dados editáveis (nome, telefone, e-mail, valores, CPF, nascimento) são
alterados apenas no Sra. Luck, nunca no CRM.

**Excluir perfil (drawer do admin):** sem histórico financeiro/operacional, o cadastro é apagado; com
histórico, é **arquivado** (`clientes.arquivado_em`, função `clientes_arquivar`, migration_077): some
das áreas ativas, perde o acesso ao app e preserva parcelas, carnês, recebimentos e agenda para
auditoria. Nos dois casos o **CPF fica livre** para um novo cadastro (a unicidade de CPF vale só entre
clientes não arquivadas) e a venda do RD vinculada volta para "aguardando cadastro" no Sra. Luck. O login
usa sempre o cadastro ativo mais recente do CPF.

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

Regra vigente (2026-09-23), que substitui o texto anterior de "até 90 dias corridos" para a liberação:

- A janela só começa quando **termos assinados E quitação confirmada** existem — nenhum dos dois
  isoladamente inicia a contagem. A data-base é a mais recente entre os dois eventos.
- A agenda cirúrgica é liberada em **até 5 dias úteis** a partir da data-base (V46:
  `worker/surgery-release.ts`, cron da migration_065), com extensão manual (+1/+3/+5 dias úteis) e
  liberação antecipada pela equipe.
- **Regra interna — intervalo mínimo:** depois de liberada, a cliente só pode escolher datas a partir
  da **data que ela escolheu para a assinatura dos termos + 90 dias corridos**. Antes disso, todas as
  datas aparecem para ela como **lotadas** (o app não explica o intervalo). Depois dele, aparecem as
  datas realmente disponíveis.
  - Configurável em `configuracoes.cirurgia_intervalo_minimo_dias` (padrão 90, entre 0 e 365).
  - Implementação única: `agenda_data_minima_cirurgia` (calendário, via worker) e
    `agenda_reservar_cirurgia_cliente` (trava no banco, erro `DATA_CIRURGIA_LOTADA`) — migration_076.
  - Vale para a escolha feita pela cliente no app; a reserva feita pela equipe no admin
    (`agenda_reservar_cirurgia`) não é limitada por esse intervalo.
- A referência mensal (`configuracoes.meta_orcamento_mensal`, atualmente R$ 100.000) continua como
  teto por carta de crédito na escolha da data (V46 §17).

## 13. Cirurgia

Fluxo:

agenda cirúrgica liberada → cliente escolhe data disponível → confirmação → cirurgia agendada → posteriormente admin registra conclusão/realização.

A agenda deve manter histórico e evitar dupla ocupação/conflitos.

Após a cliente confirmar a data da cirurgia, essa etapa do app passa a ser somente leitura: exibe apenas a data cirúrgica, sem resumo dos termos e sem ação ou solicitação de alteração da cirurgia pela cliente.

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

### Como a cliente ganha pontos (regra vigente 2026-09-23)

Valores configuráveis em `clube_config` (admin → Clube → Pontuação); os valores atuais são:

| Missão | Pontos | Quando credita |
|---|---|---|
| 1ª parcela paga | 50 + voucher de consulta | quando a parcela 1 passa para `pago` |
| Parcela paga em dia | 10 por parcela | quando a parcela passa para `pago` com `data_pagamento <= data_vencimento` |
| Indicação que fechou | 200 para quem indicou | quando a equipe marca a indicação como **Fechou** (vinculando o cadastro da indicada) **e** a indicada tem a 1ª parcela paga — o que acontecer por último efetiva o crédito |

- Todo crédito é idempotente (uma vez por motivo + referência) e fica no extrato (`cliente_pontos_eventos`).
- Uma cliente só pode ser a "venda" de uma única indicação; ninguém indica a si mesma; indicação já premiada não muda de status.
- Voucher de consulta: liberado na 1ª parcela; a cliente pode solicitar a retirada e a equipe anexa o arquivo pelo admin, que fica disponível para ela no app.
- Implementação: `supabase/migration_075_clube_missoes_indicacoes.sql`, `worker/clube.ts`, `src/components/cliente/clube/`, `src/app/admin/(painel)/clube/page.tsx`.

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