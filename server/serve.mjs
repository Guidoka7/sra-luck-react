import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { dirname, extname, resolve, sep } from "node:path";
import handler from "../api/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/client");
const port = Number(process.env.PORT || 3000);
const publicUrl = process.env.PUBLIC_APP_URL;
for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CLIENTE_SESSION_SECRET"]) {
  if (!process.env[name]) throw new Error(`${name} precisa estar configurado no runtime.`);
}
if (!publicUrl || new URL(publicUrl).protocol !== "https:") {
  throw new Error("PUBLIC_APP_URL precisa ser uma URL HTTPS no Coolify.");
}
const origin = new URL(publicUrl).origin;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
};
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), usb=(), serial=()",
  "X-Permitted-Cross-Domain-Policies": "none",
};

async function sendFile(response, file, method, cacheControl) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;
  response.writeHead(200, {
    ...securityHeaders,
    "Content-Type": mime[extname(file)] || "application/octet-stream",
    "Content-Length": info.size,
    "Cache-Control": cacheControl,
  });
  if (method === "HEAD") response.end();
  else createReadStream(file).on("error", () => response.destroy()).pipe(response);
  return true;
}

async function serveStatic(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { ...securityHeaders, Allow: "GET, HEAD" }).end();
    return;
  }
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { response.writeHead(400, securityHeaders).end(); return; }
  if (decoded.includes("\0") || decoded.includes("\\")) {
    response.writeHead(400, securityHeaders).end();
    return;
  }
  if (decoded.split("/").some((part) => part.startsWith("."))) {
    response.writeHead(404, securityHeaders).end();
    return;
  }
  const file = resolve(root, `.${decoded}`);
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    response.writeHead(403, securityHeaders).end();
    return;
  }
  const noCache = decoded === "/index.html" || decoded.endsWith("-sw.js") || decoded.endsWith(".webmanifest");
  const cacheControl = noCache ? "no-store, no-cache, must-revalidate"
    : decoded.startsWith("/assets/") ? "public, max-age=31536000, immutable"
    : "public, max-age=604800, stale-while-revalidate=86400";
  if (await sendFile(response, file, request.method, cacheControl)) return;

  // Never return the SPA HTML for a missing asset or a non-navigation request.
  if (decoded.startsWith("/assets/") || !request.headers.accept?.includes("text/html")) {
    response.writeHead(404, securityHeaders).end();
    return;
  }
  await sendFile(response, resolve(root, "index.html"), request.method, "no-cache, must-revalidate");
}

async function serveApi(request, response) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : Readable.toWeb(request);
  // Do not let an absolute-form request target override the configured origin.
  const incomingUrl = new URL(request.url, "http://localhost");
  const webRequest = new Request(`${origin}${incomingUrl.pathname}${incomingUrl.search}`, {
    method: request.method, headers, body, ...(body ? { duplex: "half" } : {}),
  });
  const result = await handler(webRequest, {
    waitUntil(promise) {
      void Promise.resolve(promise).catch(() => console.error("Background task failed"));
    },
  });
  const outgoing = Object.fromEntries(result.headers);
  if (result.headers.getSetCookie().length) outgoing["set-cookie"] = result.headers.getSetCookie();
  response.writeHead(result.status, { ...securityHeaders, "Cache-Control": "no-store", ...outgoing });
  if (request.method === "HEAD" || !result.body) response.end();
  else Readable.fromWeb(result.body).on("error", () => response.destroy()).pipe(response);
}

createServer((request, response) => {
  void (async () => {
    const pathname = new URL(request.url, origin).pathname;
    if (pathname === "/api" || pathname.startsWith("/api/")) await serveApi(request, response);
    else await serveStatic(request, response, pathname);
  })().catch((error) => {
    console.error("HTTP request failed", error);
    if (!response.headersSent) response.writeHead(500, { ...securityHeaders, "Cache-Control": "no-store" });
    response.end();
  });
}).listen(port, "0.0.0.0", () => console.info(`Sra. Luck ready on port ${port}`));
