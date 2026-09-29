export type BiArea = 'geral' | 'marketing' | 'sdr' | 'comercial' | 'financeiro' | 'qualidade';
export type BiMetric = { id: string; label: string; value: number | null; scope: string; error?: string };
export interface BiOverview {
  periodo: string;
  consultedAt: string;
  source: 'sra_luck';
  externalCollection: 'not_implemented';
  metrics: BiMetric[];
  contracts: BiMetric[];
}
export const BI_AREAS: {id: BiArea; label: string; description: string; indicators: string[]}[] = [
  {id:'geral',label:'Visão geral',description:'Uma visão da empresa, com a origem de cada informação.',indicators:[]},
  {id:'marketing',label:'Marketing',description:'Da origem do lead ao resultado de cada campanha.',indicators:['Leads por fonte','Campanhas e conversões','Custo por lead','Retorno por campanha']},
  {id:'sdr',label:'SDR',description:'Atendimentos, agendamentos e comparecimento por SDR.',indicators:['Pessoas atendidas','Agendamentos confirmados','Não confirmados','Compareceram / não compareceram']},
  {id:'comercial',label:'Comercial',description:'Reuniões, contratos e atribuição correta das vendas.',indicators:['Contratos fechados','Em negociação e perdidos','Vendas por vendedora','Reuniões realizadas']},
  {id:'financeiro',label:'Financeiro',description:'Recebimentos, vencimentos e conciliação financeira.',indicators:['Recebidos em dia','Recebidos em atraso','Vencidos em aberto','Estornos e baixas parciais']},
  {id:'qualidade',label:'Qualidade dos dados',description:'O que precisa ser conferido antes de virar resultado.',indicators:['Leads sem responsável','Fonte ou campanha ausente','Vendedora / SDR em conflito','Possíveis duplicidades']},
];
export function periodoBi(value: string) {
  if(!/^(20\d{2})-(0[1-9]|1[0-2])$/.test(value)) return null;
  const [year,month]=value.split('-').map(Number);
  return {inicio:`${value}-01`,fim:new Date(Date.UTC(year,month,1)).toISOString().slice(0,10)};
}
export function mesSaoPaulo() {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).formatToParts(new Date());
  return `${parts.find(p=>p.type==='year')?.value}-${parts.find(p=>p.type==='month')?.value}`;
}
