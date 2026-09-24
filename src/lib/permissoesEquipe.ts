/**
 * Catálogo de permissões da equipe no painel administrativo.
 *
 * Fonte única usada pelo Worker (autorização) e pela tela Configurações >
 * Equipe (botões de liga/desliga). O cargo é só um rótulo: o que cada pessoa
 * acessa é definido pelas permissões ligadas pelo Admin. O cargo
 * "administrativo" continua com acesso total.
 *
 * Regra de leitura: ver uma aba exige a permissão "ver" dela OU qualquer
 * ação da mesma aba (quem pode editar clientes, vê clientes). Ações nunca
 * vêm junto com "ver": ligar só "ver" dá acesso somente leitura.
 *
 * Integrações: chaves e configuração são só do Dev; a operação (importações
 * do RD Station, conflitos e sincronização da Conta Azul) é só do cargo
 * Administrativo. Nenhuma das duas pode ser concedida a outros cargos, por
 * isso não aparecem aqui. Monitoramento também é só do Dev.
 */

export type PermissaoEquipe = { chave: string; nome: string; descricao: string; tipo: "ver" | "acao" };
export type AbaPermissoes = { id: string; nome: string; descricao: string; permissoes: PermissaoEquipe[] };

const ver = (chave: string, nome: string, descricao: string): PermissaoEquipe => ({ chave, nome, descricao, tipo: "ver" });
const acao = (chave: string, nome: string, descricao: string): PermissaoEquipe => ({ chave, nome, descricao, tipo: "acao" });

export const ABAS_PERMISSOES: AbaPermissoes[] = [
  {
    id: "visao_geral", nome: "Visão geral", descricao: "Painel inicial com os números da operação.",
    permissoes: [ver("visao_geral.ver", "Ver a Visão geral", "Indicadores, pendências do dia e atividade recente.")],
  },
  {
    id: "agenda", nome: "Agenda", descricao: "Termos, jornada e agenda cirúrgica.",
    permissoes: [
      ver("agenda.ver", "Ver a Agenda", "Calendário, termos agendados e jornada das clientes."),
      acao("agenda.gerenciar", "Gerenciar agenda e jornada", "Abrir datas, confirmar comparecimento, previsões, liberar e ajustar a agenda cirúrgica."),
    ],
  },
  {
    id: "clientes", nome: "Clientes", descricao: "Cadastro, contratos e vendas do CRM.",
    permissoes: [
      ver("clientes.ver", "Ver clientes", "Lista, perfil e histórico das clientes, sem alterar nada."),
      acao("clientes.editar", "Cadastrar e editar clientes", "Nova cliente e edição de dados pessoais, procedimento e venda."),
      acao("clientes.liberar_acesso_app", "Liberar acesso ao app", "Botão de liberar o aplicativo no Perfil da cliente."),
      acao("clientes.alterar_status_contrato", "Alterar status do contrato", "Ativo, suspenso, negativado ou cancelado."),
      acao("clientes.excluir", "Excluir cliente", "Excluir o perfil (quando não há histórico financeiro)."),
    ],
  },
  {
    id: "financeiro", nome: "Financeiro", descricao: "Parcelas, comprovantes e baixas.",
    permissoes: [
      ver("financeiro.ver", "Ver o Financeiro", "Funil financeiro, parcelas e comprovantes, sem alterar nada."),
      acao("financeiro.validar_comprovante", "Validar comprovantes", "Aprovar ou recusar comprovantes enviados pelas clientes."),
      acao("financeiro.baixa_manual", "Registrar baixa manual", "Dar baixa em parcela paga fora do app."),
      acao("financeiro.revisao", "Revisão e liberação financeira", "Revisão financeira, parcelas, carnês e liberação financeira."),
    ],
  },
  {
    id: "clube", nome: "Clube", descricao: "Clube de Vantagens, indicações e crédito.",
    permissoes: [
      ver("clube.ver", "Ver o Clube", "Pontos, indicações, resgates e vouchers."),
      acao("credito.gerenciar", "Gerenciar Clube e crédito", "Regras, recompensas, resgates, vouchers e operação de crédito."),
    ],
  },
  {
    id: "previsoes", nome: "Previsões", descricao: "Planejamento e previsões de liberação.",
    permissoes: [ver("previsoes.ver", "Ver Previsões", "Previsões de liberação e planejamento mensal.")],
  },
  {
    id: "relatorios", nome: "Relatórios", descricao: "Relatórios gerenciais.",
    permissoes: [
      ver("relatorios.visualizar", "Ver relatórios", "Abrir os relatórios da operação."),
      acao("relatorios.exportar", "Exportar relatórios", "Baixar relatórios em planilha ou PDF."),
    ],
  },
  {
    id: "configuracoes", nome: "Configurações", descricao: "Regras, notificações e equipe.",
    permissoes: [
      acao("configuracoes.gerenciar", "Configurações gerais", "Aba Gerais, Agenda, Elegibilidade e dados da empresa."),
      acao("notificacoes.gerenciar", "Notificações", "Régua de cobrança, avisos da jornada e envio manual."),
      acao("equipe.gerenciar", "Equipe e permissões", "Criar acessos, ativar/desativar e definir permissões (as de administrador ficam com o cargo Administrativo)."),
    ],
  },
];

export const TODAS_PERMISSOES = ABAS_PERMISSOES.flatMap((a) => a.permissoes.map((p) => p.chave));
export const PERMISSOES_VALIDAS = new Set(TODAS_PERMISSOES);

/** Chaves de ações de uma aba (sem "ver"). */
export function acoesDaAba(id: string): string[] {
  return ABAS_PERMISSOES.find((a) => a.id === id)?.permissoes.filter((p) => p.tipo === "acao").map((p) => p.chave) ?? [];
}

/** Chaves que dão leitura da aba ("ver" + qualquer ação). */
export function leituraDaAba(id: string): string[] {
  return ABAS_PERMISSOES.find((a) => a.id === id)?.permissoes.map((p) => p.chave) ?? [];
}

/** Modelos para começar rápido; o Admin ajusta liga/desliga depois. */
export const MODELOS_CARGO: Record<string, { nome: string; descricao: string; permissoes: string[] }> = {
  financeiro: {
    nome: "Financeiro",
    descricao: "Parcelas, comprovantes e baixas; vê clientes e agenda.",
    permissoes: ["visao_geral.ver", "clientes.ver", "agenda.ver", "financeiro.ver", "financeiro.validar_comprovante", "financeiro.baixa_manual", "financeiro.revisao", "relatorios.visualizar"],
  },
  vendedora: {
    nome: "Vendedora",
    descricao: "Vê e cadastra clientes; sem acesso ao financeiro.",
    permissoes: ["clientes.ver", "clientes.editar", "clube.ver"],
  },
  sdr: {
    nome: "SDR",
    descricao: "Agenda de termos e comparecimentos; vê clientes.",
    permissoes: ["clientes.ver", "agenda.ver", "agenda.gerenciar"],
  },
  gestao: {
    nome: "Gestão",
    descricao: "Visão completa da operação, relatórios e previsões; sem equipe e sem configurações.",
    permissoes: ["visao_geral.ver", "agenda.ver", "agenda.gerenciar", "clientes.ver", "clientes.editar", "clientes.liberar_acesso_app", "clientes.alterar_status_contrato", "financeiro.ver", "financeiro.revisao", "clube.ver", "credito.gerenciar", "previsoes.ver", "relatorios.visualizar", "relatorios.exportar", "notificacoes.gerenciar"],
  },
  administrativo: { nome: "Administrativo", descricao: "Acesso total ao painel.", permissoes: [...TODAS_PERMISSOES] },
};

/** Tem acesso ao painel quem é Administrativo ou tem ao menos uma permissão do catálogo. */
export function temAcessoAoPainel(cargo: string | null | undefined, permissoes: readonly string[]) {
  return cargo === "administrativo" || permissoes.some((p) => PERMISSOES_VALIDAS.has(p));
}
