const baseUrl = (process.env.NOTIFICACOES_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const secret = process.env.NOTIFICACOES_CRON_SECRET;
const intervaloMs = 30 * 60 * 1000;

if (!secret) {
  console.error('Defina NOTIFICACOES_CRON_SECRET antes de iniciar o worker.');
  process.exit(1);
}

async function executarAcao(acao) {
  const response = await fetch(`${baseUrl}/api/admin/notificacoes/automacao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-notificacoes-cron-secret': secret },
    body: JSON.stringify({ acao }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.erro || `HTTP ${response.status}`);
  return data;
}

async function executar() {
  try {
    const [atrasos, momentos] = await Promise.all([
      executarAcao('verificar_atrasos'),
      executarAcao('verificar_momentos_especiais'),
    ]);
    console.log(`[notificacoes] ${new Date().toISOString()}`, { atrasos, momentos });
  } catch (error) {
    console.error('[notificacoes] falha:', error.message);
  }
}

await executar();
setInterval(executar, intervaloMs);
