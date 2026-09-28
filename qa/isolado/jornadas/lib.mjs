import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
export const PG = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const sql = (q) => execFileSync("psql", [PG, "-Atc", q], { encoding: "utf8" }).trim();
export const SP = process.env.QA_PRIVADO || "/tmp/sra-luck-qa"; // fora do repositório: credenciais e evidências
export const EV = `${SP}/qa-evidence`;
export const BASE = process.env.QA_BASE || "http://localhost:3100";
export const CREDS = Object.fromEntries(readFileSync(`${SP}/qa-credentials.env`, "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

export async function abrir(flow, { mobile = false, dark = false } = {}) {
  rmSync(`${EV}/${flow}`, { recursive: true, force: true });
  mkdirSync(`${EV}/${flow}`, { recursive: true });
  // QA local: zera o rate limit de login entre execuções repetidas (nunca em produção).
  sql("delete from public.login_rate_limits");
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 1, colorScheme: dark ? "dark" : "light", locale: "pt-BR", timezoneId: "America/Sao_Paulo",
  });
  const page = await context.newPage();
  const rede = [];
  page.on("response", async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/")) return;
    rede.push({ t: new Date().toISOString(), method: r.request().method(), path: u.pathname + u.search, status: r.status() });
  });
  const erros = [];
  page.on("pageerror", (e) => erros.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
  let n = 0;
  const shot = async (nome) => { n += 1; await page.waitForTimeout(400); await page.screenshot({ path: `${EV}/${flow}/${String(n).padStart(2, "0")}-${nome}.png`, fullPage: false }); };
  const fim = async (extra = {}) => {
    writeFileSync(`${EV}/${flow}/network.json`, JSON.stringify(rede, null, 1));
    writeFileSync(`${EV}/${flow}/console-errors.json`, JSON.stringify(erros, null, 1));
    writeFileSync(`${EV}/${flow}/result.json`, JSON.stringify(extra, null, 1));
    await browser.close();
  };
  return { browser, context, page, shot, fim, rede, erros };
}

export async function loginCliente(page, cpf, nasc) {
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  return { cpf, nasc };
}
