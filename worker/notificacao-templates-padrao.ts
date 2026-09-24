/**
 * Catálogo padrão da régua de parcelas (Web Push + central do app).
 *
 * Fonte única dos textos padrão: a migration_092 grava estes textos em
 * `notificacao_templates`, o painel usa para "Restaurar texto padrão" e os
 * testes validam tom e variáveis. A equipe edita os textos pelo painel; o
 * que está no banco é o que vale no envio.
 *
 * Régua:
 *   parcela_vencer   D-2, D-1 e D0 (dias_referencia = dias até vencer)
 *   parcela_atrasada 1 a 30 (um texto por dia de atraso da parcela mais antiga)
 *                    31 = texto único para 31 dias ou mais (recorrente)
 *
 * Unificação: a cliente recebe UMA notificação por rodada, com todas as
 * parcelas em aberto. `titulo`/`corpo` valem para 1 parcela; `titulo_multiplas`/
 * `corpo_multiplas` quando há 2 ou mais parcelas na mesma mensagem.
 *
 * Tom Sra. Luck: acolhedor, direto e respeitoso. Nunca constranger, nunca
 * ameaçar, nunca prometer condição que não existe (renegociação, desconto).
 * Valores citados são sempre o valor da parcela; juros e encargos aparecem
 * atualizados no app.
 */

export type TemplatePadrao = {
  tipo: "parcela_vencer" | "parcela_atrasada";
  dias: number;
  emoji: string;
  titulo: string;
  corpo: string;
  titulo_multiplas: string;
  corpo_multiplas: string;
};

/** Variáveis aceitas nos textos (as antigas continuam valendo). */
export const VARIAVEIS_TEMPLATE: { chave: string; descricao: string }[] = [
  { chave: "nome", descricao: "Primeiro nome da cliente" },
  { chave: "parcela", descricao: "Número da parcela mais antiga (ex.: 3)" },
  { chave: "total", descricao: "Total de parcelas do plano (ex.: 12)" },
  { chave: "valor", descricao: "Valor da parcela mais antiga, sem encargos" },
  { chave: "vencimento", descricao: "Vencimento da parcela mais antiga" },
  { chave: "dias_atraso", descricao: "Dias de atraso da parcela mais antiga" },
  { chave: "quantidade", descricao: "Quantidade de parcelas nesta mensagem" },
  { chave: "valor_total", descricao: "Soma das parcelas desta mensagem, sem encargos" },
  { chave: "cliente", descricao: "Nome completo (use {{nome}} para ficar mais próximo)" },
];

const vencer = (dias: number, emoji: string, titulo: string, corpo: string, titulo_multiplas: string, corpo_multiplas: string): TemplatePadrao =>
  ({ tipo: "parcela_vencer", dias, emoji, titulo, corpo, titulo_multiplas, corpo_multiplas });
const atraso = (dias: number, emoji: string, titulo: string, corpo: string, titulo_multiplas: string, corpo_multiplas: string): TemplatePadrao =>
  ({ tipo: "parcela_atrasada", dias, emoji, titulo, corpo, titulo_multiplas, corpo_multiplas });

export const TEMPLATES_PADRAO: TemplatePadrao[] = [
  // ── Antes do vencimento ────────────────────────────────────────────────
  vencer(2, "🗓️", "Sua parcela vence em 2 dias",
    "{{nome}}, a parcela {{parcela}}/{{total}} de {{valor}} vence em {{vencimento}}. Pague pelo app e siga tranquila.",
    "Suas parcelas vencem em breve",
    "{{nome}}, você tem {{quantidade}} parcelas vencendo nos próximos dias, somando {{valor_total}}. Organize tudo pelo app em poucos toques."),
  vencer(1, "⏰", "Sua parcela vence amanhã",
    "{{nome}}, amanhã ({{vencimento}}) vence a parcela {{parcela}}/{{total}} de {{valor}}. Se preferir, já deixe paga hoje pelo app.",
    "Parcelas vencendo amanhã",
    "{{nome}}, amanhã vencem {{quantidade}} parcelas, somando {{valor_total}}. Pagando pelo app, sua jornada continua em dia."),
  vencer(0, "💳", "Sua parcela vence hoje",
    "{{nome}}, hoje é o vencimento da parcela {{parcela}}/{{total}} de {{valor}}. Pelo app você paga em segundos com PIX.",
    "Suas parcelas vencem hoje",
    "{{nome}}, hoje vencem {{quantidade}} parcelas, somando {{valor_total}}. Resolva tudo de uma vez pelo app."),

  // ── Dias 1 a 3: passou despercebido ────────────────────────────────────
  atraso(1, "🔔", "Sua parcela venceu ontem",
    "{{nome}}, a parcela {{parcela}}/{{total}} venceu ontem. Às vezes passa, acontece! Pague pelo app e o valor atualizado já aparece para você.",
    "Parcelas em aberto",
    "{{nome}}, você tem {{quantidade}} parcelas em aberto, a mais antiga venceu em {{vencimento}}. Regularize tudo de uma vez pelo app."),
  atraso(2, "🔔", "Ainda dá tempo de resolver hoje",
    "{{nome}}, a parcela {{parcela}}/{{total}} está em aberto há 2 dias. É rapidinho pelo app.",
    "Suas parcelas seguem em aberto",
    "{{nome}}, {{quantidade}} parcelas seguem em aberto, somando {{valor_total}}. Pelo app você vê o valor atualizado e paga na hora."),
  atraso(3, "💬", "Podemos ajudar com sua parcela?",
    "{{nome}}, sua parcela {{parcela}}/{{total}} está há 3 dias em aberto. Se já pagou, envie o comprovante pelo app. Se não, dá para resolver agora.",
    "Podemos ajudar com suas parcelas?",
    "{{nome}}, há {{quantidade}} parcelas em aberto no seu plano. Se já pagou, envie os comprovantes pelo app. Se não, resolva em poucos toques."),

  // ── Dias 4 a 7: lembrete com apoio ─────────────────────────────────────
  atraso(4, "💬", "Sua parcela continua em aberto",
    "{{nome}}, a parcela {{parcela}}/{{total}} venceu em {{vencimento}}. Manter o plano em dia é o que aproxima a sua cirurgia. Resolva pelo app.",
    "Suas parcelas continuam em aberto",
    "{{nome}}, {{quantidade}} parcelas continuam em aberto. Manter o plano em dia é o que aproxima a sua cirurgia. Resolva tudo pelo app."),
  atraso(5, "💬", "Um lembrete com carinho",
    "{{nome}}, sua parcela {{parcela}}/{{total}} está há 5 dias em aberto. Estamos aqui se precisar de ajuda: é só chamar a nossa equipe.",
    "Um lembrete com carinho",
    "{{nome}}, suas {{quantidade}} parcelas em aberto somam {{valor_total}}. Estamos aqui se precisar de ajuda: é só chamar a nossa equipe."),
  atraso(6, "📌", "Sua parcela precisa de atenção",
    "{{nome}}, a parcela {{parcela}}/{{total}} está em aberto há 6 dias. O valor atualizado está no app, pronto para pagar.",
    "Suas parcelas precisam de atenção",
    "{{nome}}, {{quantidade}} parcelas estão em aberto e a mais antiga já tem 6 dias. O valor atualizado está no app."),
  atraso(7, "📌", "Uma semana de parcela em aberto",
    "{{nome}}, faz uma semana que a parcela {{parcela}}/{{total}} venceu. Vamos colocar em dia? Pelo app leva menos de um minuto.",
    "Uma semana de parcelas em aberto",
    "{{nome}}, a mais antiga das suas {{quantidade}} parcelas em aberto venceu há uma semana. Vamos colocar tudo em dia pelo app?"),

  // ── Dias 8 a 14: firme e próximo ───────────────────────────────────────
  atraso(8, "📌", "Sua parcela segue pendente",
    "{{nome}}, a parcela {{parcela}}/{{total}} segue pendente há {{dias_atraso}} dias. Se algo aconteceu, fale com a gente pelo WhatsApp.",
    "Suas parcelas seguem pendentes",
    "{{nome}}, {{quantidade}} parcelas seguem pendentes, somando {{valor_total}}. Se algo aconteceu, fale com a gente pelo WhatsApp."),
  atraso(9, "📌", "Vamos resolver juntas?",
    "{{nome}}, sua parcela {{parcela}}/{{total}} está há {{dias_atraso}} dias em aberto. Nossa equipe pode te orientar no melhor caminho.",
    "Vamos resolver juntas?",
    "{{nome}}, suas {{quantidade}} parcelas em aberto já passam de uma semana. Nossa equipe pode te orientar no melhor caminho."),
  atraso(10, "📌", "10 dias de parcela em aberto",
    "{{nome}}, a parcela {{parcela}}/{{total}} completa 10 dias em aberto. Regularize pelo app para manter sua jornada caminhando.",
    "10 dias de parcelas em aberto",
    "{{nome}}, a parcela mais antiga das suas {{quantidade}} em aberto completa 10 dias. Regularize pelo app para manter sua jornada caminhando."),
  atraso(11, "📌", "Sua parcela ainda está em aberto",
    "{{nome}}, a parcela {{parcela}}/{{total}} venceu em {{vencimento}} e ainda está em aberto. Se já pagou, envie o comprovante pelo app.",
    "Suas parcelas ainda estão em aberto",
    "{{nome}}, {{quantidade}} parcelas ainda estão em aberto no seu plano. Se já pagou alguma, envie o comprovante pelo app."),
  atraso(12, "📌", "Seu plano precisa de você",
    "{{nome}}, sua parcela {{parcela}}/{{total}} está há {{dias_atraso}} dias em aberto. Cada parcela paga conta para liberar sua agenda.",
    "Seu plano precisa de você",
    "{{nome}}, você tem {{quantidade}} parcelas em aberto. Cada parcela paga conta para liberar sua agenda. Resolva pelo app."),
  atraso(13, "📌", "Lembrete da sua parcela",
    "{{nome}}, a parcela {{parcela}}/{{total}} segue em aberto há {{dias_atraso}} dias. O valor atualizado está no app, com PIX na hora.",
    "Lembrete das suas parcelas",
    "{{nome}}, suas {{quantidade}} parcelas em aberto somam {{valor_total}}. O valor atualizado está no app, com PIX na hora."),
  atraso(14, "🤝", "Duas semanas de parcela em aberto",
    "{{nome}}, sua parcela {{parcela}}/{{total}} está em aberto há duas semanas. Queremos te ajudar: fale com a nossa equipe ou resolva pelo app.",
    "Duas semanas de parcelas em aberto",
    "{{nome}}, a mais antiga das suas {{quantidade}} parcelas em aberto já tem duas semanas. Fale com a nossa equipe ou resolva pelo app."),

  // ── Dias 15 a 21: importância e caminho ────────────────────────────────
  atraso(15, "🤝", "Precisamos falar da sua parcela",
    "{{nome}}, a parcela {{parcela}}/{{total}} está há {{dias_atraso}} dias em aberto. Conte com a gente para encontrar o melhor caminho.",
    "Precisamos falar das suas parcelas",
    "{{nome}}, {{quantidade}} parcelas estão em aberto há mais de duas semanas. Conte com a gente para encontrar o melhor caminho."),
  atraso(16, "🤝", "Sua parcela segue em aberto",
    "{{nome}}, a parcela {{parcela}}/{{total}} continua pendente. Colocar em dia mantém sua jornada rumo à cirurgia. Resolva pelo app.",
    "Suas parcelas seguem em aberto",
    "{{nome}}, {{quantidade}} parcelas continuam pendentes, somando {{valor_total}}. Colocar em dia mantém sua jornada rumo à cirurgia."),
  atraso(17, "🤝", "Estamos aqui por você",
    "{{nome}}, sabemos que imprevistos acontecem. Sua parcela {{parcela}}/{{total}} está há {{dias_atraso}} dias em aberto: chame a gente.",
    "Estamos aqui por você",
    "{{nome}}, sabemos que imprevistos acontecem. Você tem {{quantidade}} parcelas em aberto: chame a nossa equipe para conversar."),
  atraso(18, "🤝", "Sua parcela pede atenção",
    "{{nome}}, a parcela {{parcela}}/{{total}} está há {{dias_atraso}} dias em aberto. Pague pelo app ou fale com a equipe.",
    "Suas parcelas pedem atenção",
    "{{nome}}, suas {{quantidade}} parcelas em aberto já passam de duas semanas. Pague pelo app ou fale com a equipe."),
  atraso(19, "🤝", "Vamos colocar seu plano em dia?",
    "{{nome}}, sua parcela {{parcela}}/{{total}} venceu em {{vencimento}}. Um passo de cada vez: comece por ela pelo app.",
    "Vamos colocar seu plano em dia?",
    "{{nome}}, são {{quantidade}} parcelas em aberto. Um passo de cada vez: comece pela mais antiga, direto pelo app."),
  atraso(20, "🤝", "20 dias de parcela em aberto",
    "{{nome}}, a parcela {{parcela}}/{{total}} completa 20 dias em aberto. Nossa equipe está disponível para te orientar.",
    "20 dias de parcelas em aberto",
    "{{nome}}, a mais antiga das suas {{quantidade}} parcelas em aberto completa 20 dias. Nossa equipe está disponível para te orientar."),
  atraso(21, "🤝", "Três semanas de parcela em aberto",
    "{{nome}}, sua parcela {{parcela}}/{{total}} está em aberto há três semanas. Vamos resolver juntas? Fale com a nossa equipe.",
    "Três semanas de parcelas em aberto",
    "{{nome}}, você tem {{quantidade}} parcelas em aberto e a mais antiga já tem três semanas. Vamos resolver juntas?"),

  // ── Dias 22 a 30: atenção necessária, sempre com respeito ──────────────
  atraso(22, "⚠️", "Sua parcela precisa ser regularizada",
    "{{nome}}, a parcela {{parcela}}/{{total}} está há {{dias_atraso}} dias em aberto. Regularize pelo app ou fale com a nossa equipe.",
    "Suas parcelas precisam ser regularizadas",
    "{{nome}}, {{quantidade}} parcelas estão em aberto, somando {{valor_total}}. Regularize pelo app ou fale com a nossa equipe."),
  atraso(23, "⚠️", "Precisamos da sua atenção",
    "{{nome}}, sua parcela {{parcela}}/{{total}} segue em aberto há {{dias_atraso}} dias. Se já pagou, envie o comprovante pelo app.",
    "Precisamos da sua atenção",
    "{{nome}}, suas {{quantidade}} parcelas seguem em aberto. Se já pagou alguma, envie o comprovante pelo app para conferirmos."),
  atraso(24, "⚠️", "Sua parcela continua pendente",
    "{{nome}}, a parcela {{parcela}}/{{total}} continua pendente. Manter o plano em dia é o que garante o avanço da sua jornada.",
    "Suas parcelas continuam pendentes",
    "{{nome}}, {{quantidade}} parcelas continuam pendentes. Manter o plano em dia é o que garante o avanço da sua jornada."),
  atraso(25, "⚠️", "Vamos conversar sobre sua parcela?",
    "{{nome}}, sua parcela {{parcela}}/{{total}} está há {{dias_atraso}} dias em aberto. Chame a nossa equipe para entender o melhor caminho.",
    "Vamos conversar sobre suas parcelas?",
    "{{nome}}, você tem {{quantidade}} parcelas em aberto. Chame a nossa equipe para entender o melhor caminho para colocar tudo em dia."),
  atraso(26, "⚠️", "Parcela aguardando pagamento",
    "{{nome}}, a parcela {{parcela}}/{{total}} venceu em {{vencimento}} e segue em aberto. O valor atualizado está no app.",
    "Parcelas aguardando pagamento",
    "{{nome}}, {{quantidade}} parcelas seguem em aberto, somando {{valor_total}} sem encargos. O valor atualizado está no app."),
  atraso(27, "⚠️", "Lembrete importante da sua parcela",
    "{{nome}}, sua parcela {{parcela}}/{{total}} está há {{dias_atraso}} dias em aberto. Resolva pelo app ou fale com a equipe.",
    "Lembrete importante das suas parcelas",
    "{{nome}}, suas {{quantidade}} parcelas em aberto precisam de atenção. Resolva pelo app ou fale com a nossa equipe."),
  atraso(28, "⚠️", "Quatro semanas de parcela em aberto",
    "{{nome}}, a parcela {{parcela}}/{{total}} está em aberto há quatro semanas. Estamos aqui para te ajudar a colocar em dia.",
    "Quatro semanas de parcelas em aberto",
    "{{nome}}, a mais antiga das suas {{quantidade}} parcelas em aberto já tem quatro semanas. Estamos aqui para te ajudar."),
  atraso(29, "⚠️", "Sua parcela precisa de você",
    "{{nome}}, a parcela {{parcela}}/{{total}} segue pendente há {{dias_atraso}} dias. Pague pelo app ou chame a nossa equipe.",
    "Suas parcelas precisam de você",
    "{{nome}}, {{quantidade}} parcelas seguem pendentes. Pague pelo app ou chame a nossa equipe para conversar."),
  atraso(30, "⚠️", "Um mês de parcela em aberto",
    "{{nome}}, sua parcela {{parcela}}/{{total}} completa um mês em aberto. Fale com a nossa equipe para regularizar o seu plano.",
    "Um mês de parcelas em aberto",
    "{{nome}}, a mais antiga das suas {{quantidade}} parcelas em aberto completa um mês. Fale com a nossa equipe para regularizar o plano."),

  // ── 31 dias ou mais: mensagem única, só a quantidade muda ──────────────
  atraso(31, "📋", "Seu plano tem parcela em aberto",
    "{{nome}}, a parcela {{parcela}}/{{total}} está em aberto há {{dias_atraso}} dias. Regularize pelo app ou fale com a nossa equipe.",
    "Seu plano tem {{quantidade}} parcelas em aberto",
    "{{nome}}, seu plano tem {{quantidade}} parcelas em aberto, somando {{valor_total}} sem encargos. Regularize pelo app ou fale com a nossa equipe."),
];

/** Dia a partir do qual o texto é único (31+). */
export const DIA_RECORRENTE = 31;
