/**
 * Catálogo dos avisos da jornada da cliente (fora da régua de cobrança).
 *
 * Fonte única dos textos padrão: a migration_093 grava este catálogo em
 * `notificacao_eventos`; o painel (Configurações > Notificações) edita os
 * textos e liga/desliga cada aviso. Quem dispara é o banco:
 * `public.notificar_cliente(cliente, evento, variáveis, referência, chave)`
 * é chamada pelos gatilhos de agendamentos, parcelas, revisão financeira,
 * liberação financeira e Clube, e pela rotina diária de lembretes. O Web Push
 * de cada aviso é entregue pelo Worker (despacharPushPendentes).
 *
 * Tom Sra. Luck: acolhedor, claro, sem promessas que a regra não garante.
 */

export type CategoriaEvento = "pagamentos" | "agenda" | "jornada" | "clube";

export type EventoPadrao = {
  chave: string;
  categoria: CategoriaEvento;
  nome: string;
  quando: string;
  destino: "parcelas" | "agenda" | "jornada" | "clube";
  emoji: string;
  titulo: string;
  corpo: string;
  variaveis: string[];
};

const e = (chave: string, categoria: CategoriaEvento, destino: EventoPadrao["destino"], nome: string, quando: string, emoji: string, titulo: string, corpo: string, variaveis: string[] = []): EventoPadrao =>
  ({ chave, categoria, destino, nome, quando, emoji, titulo, corpo, variaveis: ["nome", ...variaveis] });

export const EVENTOS_PADRAO: EventoPadrao[] = [
  // ── Pagamentos ─────────────────────────────────────────────────────────
  e("comprovante_recebido", "pagamentos", "parcelas", "Comprovante recebido", "A cliente envia o comprovante de uma parcela", "📎",
    "Recebemos seu comprovante",
    "{{nome}}, o comprovante da parcela {{parcela}}/{{total}} chegou e está em conferência. Avisamos assim que for confirmado.", ["parcela", "total"]),
  e("pagamento_confirmado", "pagamentos", "parcelas", "Pagamento confirmado", "A parcela é confirmada como paga", "✅",
    "Pagamento confirmado",
    "{{nome}}, a parcela {{parcela}}/{{total}} foi confirmada. Obrigada por manter seu plano em dia!", ["parcela", "total"]),
  e("comprovante_rejeitado", "pagamentos", "parcelas", "Comprovante não aprovado", "A equipe recusa o comprovante enviado", "⚠️",
    "Comprovante não aprovado",
    "{{nome}}, não conseguimos confirmar o comprovante da parcela {{parcela}}/{{total}}.{{motivo}} Envie outro pelo app ou fale com a equipe.", ["parcela", "total", "motivo"]),
  e("plano_quitado", "pagamentos", "parcelas", "Plano quitado", "A última parcela em aberto é confirmada", "🎉",
    "Seu plano está quitado!",
    "{{nome}}, todas as {{total}} parcelas do seu plano estão pagas. Que conquista! Obrigada por caminhar com a Sra. Luck.", ["total"]),

  // ── Jornada e liberação ────────────────────────────────────────────────
  e("revisao_aprovada", "jornada", "agenda", "Revisão financeira aprovada", "A equipe aprova a revisão financeira da cliente", "🌷",
    "Você já pode agendar seus termos",
    "{{nome}}, sua revisão financeira foi aprovada. Escolha no app a data para assinar os termos da sua cirurgia."),
  e("revisao_recusada", "jornada", "agenda", "Revisão financeira com pendência", "A equipe recusa a revisão financeira", "💬",
    "Sua revisão precisa de um ajuste",
    "{{nome}}, sua revisão financeira ainda não pôde ser aprovada.{{motivo}} Fale com a nossa equipe para seguir.", ["motivo"]),
  e("liberacao_em_analise", "jornada", "agenda", "Liberação financeira em análise", "A solicitação de liberação financeira entra em análise", "🔎",
    "Sua solicitação está em análise",
    "{{nome}}, recebemos sua solicitação de liberação financeira e ela já está com a nossa equipe. Avisamos assim que houver resposta."),
  e("liberacao_aprovada", "jornada", "agenda", "Liberação financeira aprovada", "A liberação financeira é aprovada", "✨",
    "Liberação financeira aprovada",
    "{{nome}}, sua liberação financeira foi aprovada. Acompanhe os próximos passos da sua cirurgia pelo app."),
  e("liberacao_recusada", "jornada", "agenda", "Liberação financeira não aprovada", "A liberação financeira é recusada", "💬",
    "Precisamos ajustar sua solicitação",
    "{{nome}}, sua solicitação de liberação financeira não pôde ser aprovada.{{motivo}} Nossa equipe está à disposição.", ["motivo"]),
  e("previsao_liberacao", "jornada", "jornada", "Previsão de liberação", "A equipe define ou altera a previsão de liberação financeira", "🗓️",
    "Previsão de liberação atualizada",
    "{{nome}}, a previsão de liberação financeira da sua cirurgia é {{data}}. Qualquer mudança, avisamos por aqui.", ["data"]),

  // ── Agenda: termos ─────────────────────────────────────────────────────
  e("termos_agendados", "agenda", "agenda", "Assinatura agendada", "A cliente agenda a assinatura dos termos", "🗓️",
    "Assinatura dos termos agendada",
    "{{nome}}, sua assinatura dos termos está marcada para {{data}}{{horario}}. Te esperamos!", ["data", "horario"]),
  e("termos_remarcados", "agenda", "agenda", "Assinatura remarcada", "A data ou o horário da assinatura muda", "🔁",
    "Sua assinatura foi remarcada",
    "{{nome}}, a assinatura dos termos agora é em {{data}}{{horario}}. Se não puder comparecer, fale com a equipe.", ["data", "horario"]),
  e("termos_cancelados", "agenda", "agenda", "Assinatura cancelada", "O agendamento dos termos é cancelado", "📅",
    "Agendamento cancelado",
    "{{nome}}, o agendamento da assinatura em {{data}} foi cancelado. Se precisar, escolha uma nova data pelo app ou fale com a equipe.", ["data"]),
  e("termos_lembrete_vespera", "agenda", "agenda", "Lembrete: véspera da assinatura", "Rotina diária, um dia antes da assinatura", "⏰",
    "Amanhã é o dia da sua assinatura",
    "{{nome}}, amanhã ({{data}}{{horario}}) você assina os termos da sua cirurgia. Qualquer dúvida, fale com a equipe.", ["data", "horario"]),
  e("termos_lembrete_dia", "agenda", "agenda", "Lembrete: dia da assinatura", "Rotina diária, no dia da assinatura", "✨",
    "Hoje é o dia da sua assinatura",
    "{{nome}}, hoje{{horario}} é a assinatura dos termos da sua cirurgia. Estamos te esperando!", ["horario"]),
  e("termos_assinados", "agenda", "agenda", "Termos assinados", "A equipe registra a assinatura dos termos", "🖋️",
    "Termos assinados",
    "Parabéns, {{nome}}! Seus termos foram assinados. Com a quitação confirmada, sua agenda cirúrgica é liberada em até 5 dias úteis."),

  // ── Agenda: cirurgia ───────────────────────────────────────────────────
  e("quitacao_confirmada", "agenda", "agenda", "Quitação confirmada", "A equipe confirma a quitação do valor da cirurgia", "💗",
    "Quitação confirmada",
    "{{nome}}, sua quitação foi confirmada. Sua agenda cirúrgica será liberada em até 5 dias úteis."),
  e("agenda_cirurgica_liberada", "agenda", "agenda", "Agenda cirúrgica liberada", "A agenda cirúrgica da cliente é liberada", "🎉",
    "Sua agenda cirúrgica foi liberada!",
    "{{nome}}, chegou a hora: escolha no app a data da sua cirurgia."),
  e("previsao_cirurgia", "agenda", "agenda", "Previsão da cirurgia", "A equipe define ou altera a previsão da cirurgia", "🗓️",
    "Previsão da sua cirurgia",
    "{{nome}}, a previsão da sua cirurgia é {{data}}. A data final é confirmada quando sua agenda for liberada.", ["data"]),
  e("cirurgia_agendada", "agenda", "agenda", "Cirurgia agendada", "A data da cirurgia é definida", "💐",
    "Sua cirurgia está marcada",
    "{{nome}}, sua cirurgia está marcada para {{data}}{{horario}}. A equipe Sra. Luck está com você em cada passo.", ["data", "horario"]),
  e("cirurgia_remarcada", "agenda", "agenda", "Cirurgia remarcada", "A data da cirurgia muda", "🔁",
    "Sua cirurgia foi remarcada",
    "{{nome}}, a data da sua cirurgia agora é {{data}}{{horario}}. Qualquer dúvida, fale com a nossa equipe.", ["data", "horario"]),
  e("cirurgia_lembrete_vespera", "agenda", "agenda", "Lembrete: véspera da cirurgia", "Rotina diária, um dia antes da cirurgia", "💗",
    "Amanhã é o seu grande dia",
    "{{nome}}, amanhã é a sua cirurgia. Siga as orientações da equipe médica e conte com a gente para o que precisar."),
  e("processo_concluido", "jornada", "jornada", "Jornada concluída", "A equipe conclui o processo da cliente", "🌸",
    "Sua jornada foi concluída",
    "{{nome}}, sua jornada com a Sra. Luck foi concluída. Obrigada por confiar na gente para realizar esse sonho!"),

  // ── Clube de Vantagens ─────────────────────────────────────────────────
  e("clube_pontos_parcela_em_dia", "clube", "clube", "Pontos por parcela em dia", "A parcela é paga até o vencimento", "⭐",
    "Parcela em dia: pontos creditados",
    "{{nome}}, você pagou a parcela {{parcela}} em dia e ganhou {{pontos}} pontos no Clube de Vantagens.", ["parcela", "pontos"]),
  e("clube_bonus_primeira_parcela", "clube", "clube", "Bônus da primeira parcela", "A primeira parcela é paga", "🎁",
    "Bônus da primeira parcela liberado!",
    "{{nome}}, você ganhou {{pontos}} pontos e o {{beneficio}} no Clube de Vantagens.", ["pontos", "beneficio"]),
  e("clube_indicacao_fechou", "clube", "clube", "Indicação fechou", "A indicada fecha contrato e paga a 1ª parcela", "💝",
    "Sua indicação fechou!",
    "{{nome}}, {{indicada}} fechou contrato e pagou a 1ª parcela. Você ganhou {{pontos}} pontos no Clube de Vantagens.", ["indicada", "pontos"]),
  e("clube_voucher_disponivel", "clube", "clube", "Voucher disponível", "A equipe anexa o voucher da cliente", "🎟️",
    "Seu voucher está disponível",
    "{{nome}}, a equipe liberou o seu voucher. Abra o Clube de Vantagens para visualizar."),
  e("clube_resgate_solicitado", "clube", "clube", "Resgate solicitado", "A cliente resgata uma recompensa", "🎁",
    "Resgate solicitado",
    "{{nome}}, seu resgate de \"{{recompensa}}\" foi enviado para a equipe. Avisamos a cada etapa.", ["recompensa"]),
  e("clube_resgate_aprovado", "clube", "clube", "Resgate aprovado", "A equipe aprova o resgate", "🎁",
    "Resgate aprovado",
    "{{nome}}, seu resgate de \"{{recompensa}}\" foi aprovado e segue para preparação.", ["recompensa"]),
  e("clube_resgate_separacao", "clube", "clube", "Resgate em separação", "O resgate entra em separação", "📦",
    "Seu benefício está em separação",
    "{{nome}}, a equipe Sra. Luck está separando o seu \"{{recompensa}}\".", ["recompensa"]),
  e("clube_resgate_entregue", "clube", "clube", "Resgate entregue", "O resgate é marcado como entregue", "💝",
    "Resgate entregue",
    "{{nome}}, seu resgate de \"{{recompensa}}\" foi concluído. Aproveite!", ["recompensa"]),
  e("clube_resgate_cancelado", "clube", "clube", "Resgate cancelado", "O resgate é cancelado", "↩️",
    "Resgate cancelado",
    "{{nome}}, seu resgate de \"{{recompensa}}\" foi cancelado e os pontos voltaram para o seu saldo.", ["recompensa"]),
];

export const NOMES_CATEGORIA: Record<CategoriaEvento, string> = {
  pagamentos: "Pagamentos",
  jornada: "Jornada e liberação",
  agenda: "Agenda",
  clube: "Clube de Vantagens",
};
