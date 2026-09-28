/*
 * Reexporta a implementação consolidada da importação e substitui somente a leitura
 * das opções do RD pela versão que inventaria campos realmente observados por funil.
 * Mantém o restante do fluxo (pendências, deduplicação, snapshots e reprocessamento)
 * exatamente igual ao release anterior.
 */
export * from "./crm-importacao-base";
export { opcoesCrm } from "./crm-opcoes-funil";
