export type CreditStage =
  | "nova_venda"
  | "aguardando_conferencia"
  | "formacao_saldo"
  | "proxima_meta"
  | "meta_atingida"
  | "levantamento_financeiro"
  | "forma_pagamento_liberada"
  | "termos_agendados"
  | "aguardando_quitacao"
  | "quitado"
  | "agenda_cirurgica_liberada"
  | "cirurgia_agendada"
  | "concluido";

export type BankProvider = "BRB" | "Banco do Brasil" | "Santander" | "Sicredi" | "Efí";

export interface CreditContract {
  id: string;
  client: string;
  cpf: string;
  campaign: string;
  modality: "Flex" | "100% boleto";
  total: number;
  paid: number;
  minimumPercent: number;
  installmentsPaid: number;
  installmentsTotal: number;
  forecastMinimum: string;
  remaining: number;
  stage: CreditStage;
  bank: BankProvider;
}

export interface DailyFinanceItem {
  id: string;
  client: string;
  contract: string;
  installment: string;
  amount: number;
  bank: BankProvider;
  detail: string;
}
