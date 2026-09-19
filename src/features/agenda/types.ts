export type AgendaPrimaryTab = "terms" | "finance" | "surgeries";
export type AgendaTermsView = "eligible" | "confirmed";
export type AgendaDayState = "neutral" | "available" | "closed" | "full";

export interface AgendaCalendarDay {
  id?: string;
  date: string;
  total: number;
  used: number;
  remaining: number;
  manualClosed: boolean;
  state: Exclude<AgendaDayState, "neutral"> | "neutral";
}

export interface AgendaClientRow {
  clientId: string;
  name: string;
  cpf: string | null;
  creditLetter: number;
  paidInstallments: number;
  totalInstallments: number;
  paidPercentage: number;
  planTotal: number;
  calculatedBalance: number;
  settlementBalance: number;
  reviewStatus: string | null;
  reviewConfirmedAt: string | null;
  allowedMethods: string[];
  paymentChoice: string | null;
  paymentChoiceStatus: string | null;
  stage: string;
}

export interface AgendaEligibleRow extends AgendaClientRow {
  becameEligibleAt: string | null;
  returnedToStage4: boolean;
}

export interface AgendaTermsConfirmedRow extends AgendaClientRow {
  appointmentId: string;
  date: string;
  time: string | null;
  attendanceStatus: string | null;
}

export interface AgendaTermsPayload {
  month: string;
  minimumPaidPercentage: number;
  times: string[];
  calendar: AgendaCalendarDay[];
  eligible: AgendaEligibleRow[];
  confirmed: AgendaTermsConfirmedRow[];
}

export interface AgendaReleaseRow extends AgendaClientRow {
  appointmentId: string;
  termsDate: string;
  termsTime: string;
  forecastDate: string | null;
  forecastConfirmedAt: string | null;
  attendanceStatus: string;
  attendanceAt: string | null;
  settlementStatus: string;
  settlementAt: string | null;
  surgeryAgendaReleasedAt: string | null;
}

export interface AgendaReleasePayload {
  rows: AgendaReleaseRow[];
}

export interface AgendaSurgeryRow extends AgendaClientRow {
  appointmentId: string;
  date: string;
  time: string;
  status: string;
}

export interface AgendaMonthChartItem {
  month: string;
  value: number;
  cap: number;
  percent: number;
}

export interface AgendaSurgeriesPayload {
  month: string;
  calendar: AgendaCalendarDay[];
  rows: AgendaSurgeryRow[];
  chart: AgendaMonthChartItem[];
  monthlyCap: number;
  times: string[];
}

export interface AgendaPlannerRow {
  month: string;
  current: number;
  cap: number;
  creditLetter: number;
  projected: number;
  percent: number;
  remaining: number;
  classification: "safe" | "attention" | "over";
}

export interface AgendaFlowPayload {
  client: AgendaClientRow;
  appointment: null | {
    id: string;
    status: string;
    termsDate: string | null;
    termsTime: string | null;
    termsSignedAt: string | null;
    attendanceStatus: string;
    attendanceAt: string | null;
    forecastDate: string | null;
    forecastConfirmedAt: string | null;
    forecastSuggestedDate: string | null;
    settlementStatus: string;
    settlementAt: string | null;
    settlementMethod: string | null;
    surgeryAgendaReleasedAt: string | null;
    surgeryDate: string | null;
    surgeryTime: string | null;
    surgeryChosenAt: string | null;
  };
  previousCanceledAppointment: null | {
    id: string;
    termsDate: string | null;
    termsTime: string | null;
    attendanceStatus: string | null;
    settlementStatus: string | null;
    canceledAt: string;
  };
  planner: AgendaPlannerRow[];
  monthlyCap: number;
}
