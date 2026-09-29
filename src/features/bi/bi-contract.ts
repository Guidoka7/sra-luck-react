/** Contrato exclusivo do BI comercial. Nenhuma métrica vem das tabelas do app. */
export type BiArea = 'geral' | 'origens' | 'funis' | 'agendamentos' | 'vendas' | 'leads' | 'qualidade';
export interface BiOverview {
  source: 'rd_station';
  scope: 'company_commercial';
  collection: { state: 'not_implemented'; lastSyncedAt: null; historicalComplete: false };
  metrics: null;
}
export const BI_AREAS: {id: BiArea; label: string; description: string; indicators: string[]; columns: string[]}[] = [
  {id:'geral',label:'Visão comercial',description:'A operação comercial da Sra. Luck, da entrada do lead à venda.',indicators:['Novos leads','Agendamentos confirmados','Reuniões realizadas','Vendas ganhas'],columns:[]},
  {id:'origens',label:'Fontes e campanhas',description:'De onde os leads chegaram e quais origens geraram resultado.',indicators:['Leads por fonte','Agendamentos por origem','Vendas por campanha','Conversão por origem'],columns:['Fonte','Campanha','Leads únicos','Agendamentos','Comparecimentos','Vendas','Conversão']},
  {id:'funis',label:'Funis e conversão',description:'Movimentação, tempo em cada etapa, perdas e avanços nos funis reais do RD.',indicators:['Negociações em aberto','Avanços de etapa','Negociações perdidas','Tempo até a venda'],columns:['Funil','Etapa','Negociações','Entradas no período','Saídas no período','Tempo na etapa']},
  {id:'agendamentos',label:'SDR e agendamentos',description:'Quem atendeu, quem agendou e o que aconteceu com cada reunião.',indicators:['Agendados','Confirmados','Compareceram','Não compareceram'],columns:['Lead','SDR','Data da reunião','Modalidade','Confirmação','Comparecimento','Vendedora da reunião']},
  {id:'vendas',label:'Vendas e vendedoras',description:'Cada venda vinculada à negociação e à vendedora que a realizou.',indicators:['Vendas ganhas','Valor vendido','Sem vendedora identificada','Atribuições conflitantes'],columns:['Negociação','Lead','Vendedora','Data da venda','Valor','Fonte','Campanha','Situação da atribuição']},
  {id:'leads',label:'Jornada dos leads',description:'Cada lead desde sua origem, com todos os atendimentos e negociações relacionados.',indicators:['Leads novos','Leads em atendimento','Leads com venda','Sem responsável'],columns:['Lead / ID RD','Entrada no CRM','Fonte / campanha','Responsável atual','SDR','Funil / etapa','Vendedora','Última atividade']},
  {id:'qualidade',label:'Pendências',description:'Falhas de preenchimento, atribuição e coleta que precisam de conferência.',indicators:['Sem origem','Sem responsável','Vendedora / SDR em conflito','Duplicidades suspeitas'],columns:['Registro no RD','Problema','Campo afetado','Impacto no indicador','Responsável pela correção','Situação']},
];
/** Eventos distintos, com identificação de origem e sem assumir que todo lead tem venda. */
export type CommercialEventType = 'lead_created' | 'owner_changed' | 'source_changed' | 'stage_changed' | 'appointment_created' | 'appointment_confirmed' | 'attendance_recorded' | 'deal_won' | 'deal_lost' | 'deal_reopened';
export interface CommercialEvent {
  sourceEventId: string;
  companyId: string;
  leadId: string;
  dealId: string | null;
  type: CommercialEventType;
  occurredAt: string | null;
  observedAt: string;
  source: 'rd_station';
  actorId: string | null;
  mappingVersion: string;
}
