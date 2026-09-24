/**
 * Áreas exclusivas do Dev: Integrações (chaves, configuração, conexões OAuth,
 * testes) e Monitoramento. Só a sessão técnica do Dev Console
 * ("dev-console:<ator>") passa; o Admin recebe 403 mesmo com permissão.
 *
 * Exceção: a OPERAÇÃO do dia a dia continua com a equipe no Admin
 * (decisão do responsável, 24/09/2026):
 *   - status das conexões (leitura, usado por Notificações e Configurações);
 *   - revisão das vendas importadas do RD Station e "Importar agora";
 *   - conflitos, fila, vínculos, histórico, sincronização e envio/vínculo
 *     de parcelas da Conta Azul.
 * Callbacks OAuth (/api/integrations/...) e webhooks não passam por aqui.
 */
const OPERACAO_EQUIPE: readonly { metodo: "GET" | "POST"; rota: RegExp }[] = [
  { metodo: "GET", rota: /^\/api\/admin\/integrations\/status$/ },
  // RD Station: importação e revisão (a configuração da importação é do Dev).
  { metodo: "GET", rota: /^\/api\/admin\/integrations\/rd-station\/importacoes$/ },
  { metodo: "GET", rota: /^\/api\/admin\/integrations\/rd-station\/importacoes\/revisao$/ },
  { metodo: "GET", rota: /^\/api\/admin\/integrations\/rd-station\/importacoes\/[0-9a-f-]{36}\/itens$/ },
  { metodo: "POST", rota: /^\/api\/admin\/integrations\/rd-station\/importacoes\/itens\/[0-9a-f-]{36}\/(importar|descartar)$/ },
  { metodo: "POST", rota: /^\/api\/admin\/integrations\/rd-station\/importar$/ },
  // Conta Azul: operação financeira (conexão e configuração são do Dev).
  { metodo: "GET", rota: /^\/api\/admin\/integrations\/conta-azul\/(painel|conflitos|fila|vinculos|historico)$/ },
  { metodo: "POST", rota: /^\/api\/admin\/integrations\/conta-azul\/conflitos\/[0-9a-f-]{36}\/resolver$/ },
  { metodo: "POST", rota: /^\/api\/admin\/integrations\/conta-azul\/fila\/[0-9a-f-]{36}\/reprocessar$/ },
  { metodo: "POST", rota: /^\/api\/admin\/integrations\/conta-azul\/(sincronizar|enviar-cliente|vincular)$/ },
];

export function rotaExclusivaDoDev(pathname: string, method: string): boolean {
  const monitoramento = /^\/api\/admin\/(monitoramento(?:-[a-z]+)?(?:\/.*)?|diagnostico)$/.test(pathname);
  const integracoes = pathname === "/api/admin/integrations" || pathname.startsWith("/api/admin/integrations/");
  if (!monitoramento && !integracoes) return false;
  if (monitoramento) return true;
  const m = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
  return !OPERACAO_EQUIPE.some((r) => r.metodo === m && r.rota.test(pathname));
}
