// Servidor do QA ISOLADO LOCAL: serve dist/client e encaminha /api ao mesmo
// handler que roda na Vercel (dist/server/vercel-handler.mjs).
// Recusa iniciar se SUPABASE_URL não for 127.0.0.1/localhost (trava contra produção).
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { extname, resolve, sep } from "node:path";

const repo = process.env.QA_REPO || "/home/user/sra-luck-react";
const root = resolve(repo, "dist/client");
const port = Number(process.env.PORT || 3100);
const origin = `http://localhost:${port}`;

const supa = new URL(process.env.SUPABASE_URL || "http://invalid");
if (!["127.0.0.1", "localhost"].includes(supa.hostname)) {
  console.error(`RECUSADO: SUPABASE_URL (${supa.host}) não é local. O QA isolado nunca aponta para produção.`);
  process.exit(2);
}
delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
process.env.PUBLIC_APP_URL = "";

const { handleRequest } = await import(resolve(repo, "dist/server/vercel-handler.mjs"));
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".wasm": "application/wasm", ".pdf": "application/pdf", ".traineddata": "application/octet-stream", ".gz": "application/gzip" };

async function sendFile(res, file) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;
  res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Content-Length": info.size, "Cache-Control": "no-store" });
  createReadStream(file).pipe(res);
  return true;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : Readable.toWeb(req);
      const r = await handleRequest(new Request(`${origin}${url.pathname}${url.search}`, { method: req.method, headers, body, ...(body ? { duplex: "half" } : {}) }), { waitUntil: (p) => Promise.resolve(p).catch(() => {}) });
      const out = Object.fromEntries(r.headers);
      if (r.headers.getSetCookie().length) out["set-cookie"] = r.headers.getSetCookie();
      res.writeHead(r.status, { "Cache-Control": "no-store", ...out });
      if (!r.body || req.method === "HEAD") res.end(); else Readable.fromWeb(r.body).pipe(res);
      console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} ${r.status}`);
      return;
    }
    const file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (file.startsWith(root + sep) && (await sendFile(res, file))) return;
    if (url.pathname.startsWith("/assets/")) { res.writeHead(404).end(); return; }
    await sendFile(res, resolve(root, "index.html"));
  } catch (e) {
    console.error("QA serve error", e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}).listen(port, "127.0.0.1", () => console.log(`QA app em ${origin} → Supabase ${supa.origin}`));
