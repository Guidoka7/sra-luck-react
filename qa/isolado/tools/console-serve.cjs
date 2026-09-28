// Dev Console no QA ISOLADO LOCAL: aplica os rewrites do vercel.json e chama as
// funções api/*.js com a mesma assinatura (req, res) da Vercel.
// Recusa iniciar se DEV_SUPABASE_URL ou SRA_LUCK_BASE_URL não forem locais.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = process.env.CONSOLE_REPO || "/home/user/sra-luck-dev-console";
const PORT = Number(process.env.PORT || 3200);
for (const name of ["DEV_SUPABASE_URL", "SRA_LUCK_BASE_URL"]) {
  const host = new URL(process.env[name] || "http://invalid").hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) { console.error(`RECUSADO: ${name} não é local.`); process.exit(2); }
}
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const rewrites = (cfg.rewrites || []).filter((r) => r.source.startsWith("/api/") && !r.source.includes("("));
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

http.createServer(async (req, res) => {
  try {
    let url = new URL(req.url, `http://localhost:${PORT}`);
    const rw = rewrites.find((r) => r.source === url.pathname);
    if (rw) { const dest = new URL(rw.destination, url.origin); for (const [k, v] of url.searchParams) dest.searchParams.set(k, v); url = dest; }
    if (url.pathname.startsWith("/api/")) {
      const file = path.join(ROOT, "api", `${url.pathname.slice(5).replace(/[^a-z0-9-]/gi, "")}.js`);
      if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('{"error":"not found"}'); }
      req.query = Object.fromEntries(url.searchParams);
      req.url = url.pathname + url.search;
      const mod = require(file);
      const fn = typeof mod === "function" ? mod : mod.default || mod.handler;
      await fn(req, res);
      console.log(`${new Date().toISOString()} ${req.method} ${url.pathname}${url.search} ${res.statusCode}`);
      return;
    }
    let p = url.pathname === "/" ? "/index.html" : url.pathname;
    const f = path.join(ROOT, path.normalize(p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("Content-Type", mime[path.extname(f)] || "application/octet-stream");
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    console.error("console serve error", e);
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  }
}).listen(PORT, "127.0.0.1", () => console.log(`QA Dev Console em http://localhost:${PORT} → Sra ${process.env.SRA_LUCK_BASE_URL}`));
