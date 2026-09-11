import type { CreditContract, DailyFinanceItem } from "./types";

export const contracts: CreditContract[] = [
  { id: "CTR-2026-0482", client: "Renata Oliveira", cpf: "123.456.789-00", campaign: "RD Station", modality: "Flex", total: 50000, paid: 32500, minimumPercent: 60, installmentsPaid: 15, installmentsTotal: 24, forecastMinimum: "Meta atingida", remaining: 17500, stage: "meta_atingida", bank: "Banco do Brasil" },
  { id: "CTR-2026-0310", client: "Carlos Mendes", cpf: "987.654.321-00", campaign: "Indicação", modality: "100% boleto", total: 35000, paid: 20300, minimumPercent: 60, installmentsPaid: 14, installmentsTotal: 24, forecastMinimum: "28/09/2026", remaining: 14700, stage: "proxima_meta", bank: "Santander" },
  { id: "CTR-2026-0296", client: "Juliana Costa", cpf: "456.789.123-00", campaign: "Instagram", modality: "Flex", total: 80000, paid: 46200, minimumPercent: 60, installmentsPaid: 21, installmentsTotal: 36, forecastMinimum: "05/10/2026", remaining: 33800, stage: "proxima_meta", bank: "BRB" },
  { id: "CTR-2026-0318", client: "Mariana Silva", cpf: "321.654.987-00", campaign: "RD Station", modality: "100% boleto", total: 60000, paid: 18000, minimumPercent: 60, installmentsPaid: 6, installmentsTotal: 36, forecastMinimum: "15/01/2027", remaining: 42000, stage: "formacao_saldo", bank: "Sicredi" },
  { id: "CTR-2026-0322", client: "Fernanda Alves", cpf: "789.456.123-00", campaign: "Site / Orgânico", modality: "Flex", total: 25000, paid: 14900, minimumPercent: 60, installmentsPaid: 11, installmentsTotal: 18, forecastMinimum: "Meta atingida", remaining: 10100, stage: "levantamento_financeiro", bank: "Efí" },
  { id: "CTR-2026-0288", client: "Paulo Ribeiro", cpf: "159.357.486-00", campaign: "Indicação", modality: "Flex", total: 70000, paid: 44800, minimumPercent: 60, installmentsPaid: 16, installmentsTotal: 24, forecastMinimum: "Meta atingida", remaining: 25200, stage: "forma_pagamento_liberada", bank: "Banco do Brasil" },
];

export const liquidated: DailyFinanceItem[] = [
  { id: "liq-1", client: "Renata Oliveira", contract: "#10384", installment: "03/36", amount: 2500, bank: "Banco do Brasil", detail: "Liquidado hoje às 08:14" },
  { id: "liq-2", client: "Carlos Mendes", contract: "#11827", installment: "01/48", amount: 3850, bank: "Santander", detail: "Liquidado hoje às 09:32" },
  { id: "liq-3", client: "Juliana Costa", contract: "#12566", installment: "05/60", amount: 4200, bank: "BRB", detail: "Liquidado hoje às 10:21" },
  { id: "liq-4", client: "Mariana Silva", contract: "#13109", installment: "02/36", amount: 2100, bank: "Sicredi", detail: "Liquidado hoje às 11:03" },
];

export const overdue: DailyFinanceItem[] = [
  { id: "ven-1", client: "Paulo Ribeiro", contract: "#11022", installment: "03/48", amount: 2800, bank: "Banco do Brasil", detail: "Vencido há 5 dias" },
  { id: "ven-2", client: "Fernanda Lima", contract: "#11876", installment: "02/60", amount: 3200, bank: "Santander", detail: "Vencido há 12 dias" },
  { id: "ven-3", client: "Tatiane Rocha", contract: "#11990", installment: "01/48", amount: 1950, bank: "BRB", detail: "Vencido há 18 dias" },
];

export const waitingValidation: DailyFinanceItem[] = [
  { id: "val-1", client: "Beatriz Lima", contract: "#13210", installment: "03/60", amount: 3500, bank: "Banco do Brasil", detail: "Comprovante enviado às 09:12" },
  { id: "val-2", client: "Diego Martins", contract: "#13177", installment: "01/48", amount: 2250, bank: "Santander", detail: "Comprovante enviado às 08:45" },
  { id: "val-3", client: "Larissa Nunes", contract: "#13045", installment: "02/60", amount: 1980, bank: "Sicredi", detail: "Comprovante enviado ontem" },
];

export const perks = [
  { id: "perk-1", title: "Kit Giovanna Baby", points: 600, category: "Autocuidado", description: "Kit presente com itens selecionados para autocuidado." },
  { id: "perk-2", title: "Massagem relaxante", points: 900, category: "Bem-estar", description: "Sessão de massagem em parceiro credenciado." },
  { id: "perk-3", title: "Nécessaire premium", points: 450, category: "Mimo", description: "Nécessaire Sra. Luck em edição especial." },
  { id: "perk-4", title: "Vale-spa", points: 1200, category: "Experiência", description: "Crédito para experiência de spa em parceiro selecionado." },
  { id: "perk-5", title: "Kit autocuidado", points: 750, category: "Autocuidado", description: "Seleção de cuidados pessoais e aromaterapia." },
  { id: "perk-6", title: "Voucher de beleza", points: 1000, category: "Experiência", description: "Voucher para serviço de beleza em estabelecimento parceiro." },
];

export const trainings = [
  { id: "tr-1", title: "Jornada Sra. Luck", kind: "Vídeo", duration: "18 min", audience: "Todos", progress: 100 },
  { id: "tr-2", title: "Venda consultiva e contrato", kind: "Vídeo", duration: "32 min", audience: "Vendedora", progress: 60 },
  { id: "tr-3", title: "Qualificação e comparecimento", kind: "Texto + vídeo", duration: "24 min", audience: "SDR", progress: 35 },
  { id: "tr-4", title: "Conciliação e recuperação", kind: "Vídeo", duration: "28 min", audience: "Financeiro", progress: 80 },
];
