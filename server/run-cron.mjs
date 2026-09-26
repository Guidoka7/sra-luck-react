const tasks = {
  "mensagem-do-dia": { secret: "CRON_SECRET", header: "authorization", prefix: "Bearer " },
  "notificacoes-financeiras": { secret: "NOTIFICACOES_CRON_SECRET", header: "x-notificacoes-cron-secret", prefix: "" },
};
const name = process.argv[2];
const task = tasks[name];
if (!task) throw new Error("Rotina desconhecida.");
const secret = process.env[task.secret];
if (!secret) throw new Error(`${task.secret} não configurado.`);

const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/cron/${name}`, {
  headers: { [task.header]: `${task.prefix}${secret}` },
  signal: AbortSignal.timeout(120_000),
});
if (!response.ok) {
  console.error(`Cron ${name} falhou: HTTP ${response.status}`);
  process.exitCode = 1;
} else {
  console.info(`Cron ${name}: HTTP ${response.status}`);
}
