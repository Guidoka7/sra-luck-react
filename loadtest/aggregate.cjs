// Aggregate only comparable results from the same isolated run. Never merge
// shard percentiles into a fictitious global percentile.
const fs = require("node:fs");
const path = require("node:path");

const directory = "load-results";
const files = fs.existsSync(directory)
  ? fs.readdirSync(directory).filter((name) => /^shard-\d+\.json$/.test(name)).sort()
  : [];
const shards = files.map((name) => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")));
const metric = (shard, name) => shard.metrics?.[name]?.values || {};
const sum = (values) => values.reduce((total, value) => total + (Number(value) || 0), 0);
const max = (values) => {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : null;
};
const tagsOf = (name) => Object.fromEntries(
  [...(name.match(/\{([^}]+)\}/)?.[1] || "").split(",")]
    .filter(Boolean).map((entry) => entry.split(":")),
);
const profile = process.env.LOAD_PROFILE || "unknown";
const timeline = new Map();
const routes = new Map();

for (const shard of shards) {
  if (shard.profile !== profile) throw new Error(`Mixed profile: ${shard.profile} vs ${profile}`);
  for (const [name, value] of Object.entries(shard.metrics || {})) {
    const tags = tagsOf(name);
    const v = value.values || {};
    if (name.startsWith("route_fail{") && tags.route && tags.bucket === undefined) {
      const failures = Number(v.passes || 0), total = failures + Number(v.fails || 0);
      const route = routes.get(tags.route) || { route: tags.route, failures: 0, total: 0 };
      route.failures += failures;
      route.total += total;
      const duration = metric(shard, `route_duration_${tags.route}`);
      route.worstShardP95Ms = max([route.worstShardP95Ms, Number(duration["p(95)"])]);
      route.worstShardP99Ms = max([route.worstShardP99Ms, Number(duration["p(99)"])]);
      routes.set(tags.route, route);
    }
    const match = name.match(/^minute_(\d+)_(requests|failures|server5xx|client4xx|timeouts|witnessedVus)$/);
    if (match) {
      const minute = Number(match[1]);
      const row = timeline.get(minute) || { minute, requests: 0, failures: 0, server5xx: 0, client4xx: 0, timeouts: 0, witnessedVus: 0 };
      row[match[2]] += Number(v.count || 0);
      timeline.set(minute, row);
    }
  }
}

const requests = sum(shards.map((s) => metric(s, "app_requests").count));
const httpRequests = sum(shards.map((s) => metric(s, "http_reqs").count));
const failed = sum(shards.map((s) => metric(s, "route_fail").passes));
const fiveHundreds = sum(shards.map((s) => metric(s, "server_5xx").passes));
const begun = shards.map((s) => Date.parse(s.startedAt)).filter(Number.isFinite);
const finished = shards.map((s) => Date.parse(s.generatedAt)).filter(Number.isFinite);
const durationSeconds = begun.length === shards.length && finished.length === shards.length
  ? (Math.max(...finished) - Math.min(...begun)) / 1000 : null;
const series = [...timeline.values()].sort((a, b) => a.minute - b.minute).map((row) => ({
  ...row,
  failureRate: row.requests ? row.failures / row.requests : null,
}));
const sortedRoutes = [...routes.values()].map((row) => ({
  ...row, failureRate: row.total ? row.failures / row.total : null,
})).sort((a, b) => b.failures - a.failures);
const rampReached = shards.length === 10 && shards.every((s) => Number(metric(s, "vus").max) >= 1000);
const plateau = series.filter((row) => row.minute >= 2 && row.minute < 32);
const witnessedAllMinutes = profile === "full" && plateau.length === 30 && plateau.every((row) => row.witnessedVus === 10000);

const report = {
  profile, generatedAt: new Date().toISOString(), expectedShards: profile === "smoke" ? 0 : 10,
  completedShards: shards.length, preflightResult: process.env.PREFLIGHT_RESULT,
  loadResult: process.env.LOAD_RESULT, totalHttpRequests: httpRequests,
  totalAppRequests: requests, appFailures: failed, appFailureRate: requests ? failed / requests : null,
  totalServer5xx: fiveHundreds, total4xx: sum(shards.map((s) => metric(s, "client_4xx").count)),
  totalTimeouts: sum(shards.map((s) => metric(s, "request_timeouts").count)),
  worstShardP50Ms: max(shards.map((s) => Number(metric(s, "http_req_duration").med))),
  worstShardP95Ms: max(shards.map((s) => Number(metric(s, "http_req_duration")["p(95)"]))),
  worstShardP99Ms: max(shards.map((s) => Number(metric(s, "http_req_duration")["p(99)"]))),
  maxObservedMs: max(shards.map((s) => Number(metric(s, "http_req_duration").max))),
  meanHttpMs: httpRequests ? sum(shards.map((s) => Number(metric(s, "http_req_duration").avg || 0) * Number(metric(s, "http_reqs").count || 0))) / httpRequests : null,
  durationSeconds, appThroughputPerSecond: durationSeconds ? requests / durationSeconds : null,
  shardStarts: shards.map((s) => ({ shard: s.shard, startedAt: s.startedAt, endedAt: s.generatedAt, maxVus: metric(s, "vus").max })),
  rampReached, fullPlateauWitnessed: witnessedAllMinutes,
  plateauMinutesWitnessed: plateau.filter((row) => row.witnessedVus === 10000).length,
  firstObservedDegradationMinute: series.find((row) => row.server5xx > 0 || row.timeouts > 0)?.minute ?? null,
  timeline: series, routes: sortedRoutes,
};
fs.writeFileSync("aggregate.json", JSON.stringify(report, null, 2));
const pct = (value) => value == null ? "n/a" : `${(value * 100).toFixed(2)}%`;
const ms = (value) => value == null || !Number.isFinite(value) ? "n/a" : `${Math.round(value)} ms`;
const lines = [
  "# Sra. Luck — carga no ambiente isolado", "",
  `Perfil: ${profile}. Shards: ${shards.length}/${report.expectedShards}.`,
  `Requisições da aplicação: ${requests}; HTTP incluindo acesso ao Preview: ${httpRequests}.`,
  `Falhas de aplicação: ${failed} (${pct(report.appFailureRate)}); 5xx: ${fiveHundreds}; 4xx: ${report.total4xx}; timeouts: ${report.totalTimeouts}.`,
  `Média HTTP: ${ms(report.meanHttpMs)}; maior p50/p95/p99 entre shards: ${ms(report.worstShardP50Ms)} / ${ms(report.worstShardP95Ms)} / ${ms(report.worstShardP99Ms)}; máximo: ${ms(report.maxObservedMs)}.`,
  `10.000 VUs atingidos em todos os shards: ${rampReached ? "sim" : "não comprovado"}. Platô integral testemunhado: ${witnessedAllMinutes ? "sim" : "não comprovado"} (${report.plateauMinutesWitnessed}/30 minutos).`,
  "Os percentis acima são os piores entre shards; percentis globais não podem ser reconstruídos dos resumos.",
  "", "## Minutos observados", "",
  "| Minuto | Requisições | Falhas | 5xx | 4xx | Timeouts | VUs testemunhados |", "|---:|---:|---:|---:|---:|---:|---:|",
  ...series.map((row) => `| ${row.minute} | ${row.requests} | ${pct(row.failureRate)} | ${row.server5xx} | ${row.client4xx} | ${row.timeouts} | ${row.witnessedVus} |`),
  "", "## Rotas instrumentadas", "",
  "| Rota | Amostra | Falhas | Taxa | Maior p95 | Maior p99 |", "|---|---:|---:|---:|---:|---:|",
  ...sortedRoutes.map((row) => `| ${row.route} | ${row.total} | ${row.failures} | ${pct(row.failureRate)} | ${ms(row.worstShardP95Ms)} | ${ms(row.worstShardP99Ms)} |`),
  "",
];
fs.writeFileSync("summary.md", lines.join("\n"));
console.log(lines.slice(0, 9).join("\n"));
