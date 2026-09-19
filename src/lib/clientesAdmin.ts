import type { Cliente } from "@/types/database";

export type ClientesAdminTab = "cadastradas" | "aguardando" | "canceladas";

export function clienteTemFinanceiro(cliente: Cliente) {
  if (typeof cliente.tem_financeiro === "boolean") return cliente.tem_financeiro;
  return Number(cliente.parcelas_total ?? 0) > 0;
}

export function clienteAdminTab(cliente: Cliente): ClientesAdminTab {
  if (cliente.status_contrato === "cancelado") return "canceladas";
  return clienteTemFinanceiro(cliente) ? "cadastradas" : "aguardando";
}

export function separarClientesAdmin(clientes: Cliente[]) {
  const cadastradas: Cliente[] = [];
  const aguardando: Cliente[] = [];
  const canceladas: Cliente[] = [];

  for (const cliente of clientes) {
    const tab = clienteAdminTab(cliente);
    if (tab === "cadastradas") cadastradas.push(cliente);
    else if (tab === "aguardando") aguardando.push(cliente);
    else canceladas.push(cliente);
  }

  return { cadastradas, aguardando, canceladas };
}
