// J13 — Console na interface: viewer vê o cofre somente leitura; owner vê edição; páginas que consultam o Sra Luck
import { abrir, CREDS } from "./lib.mjs";
import { writeFileSync } from "node:fs";
const C = "http://localhost:3200";
const T = process.env.SP_TXT || "/tmp";
const r = {};
for (const [papel, e, p] of [["viewer", "QA_CONSOLE_VIEWER_EMAIL", "QA_CONSOLE_VIEWER_PASSWORD"], ["owner", "QA_CONSOLE_OWNER_EMAIL", "QA_CONSOLE_OWNER_PASSWORD"]]) {
  const { page, shot, fim, rede } = await abrir(`J13-console-ui-${papel}`);
  page.on("response", (res) => { const u = new URL(res.url()); if (u.port === "3200" && u.pathname.startsWith("/api/")) rede.push({ method: res.request().method(), path: u.pathname + u.search, status: res.status() }); });
  await page.goto(`${C}/login.html`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(800);
  await page.locator('input[type="email"]').fill(CREDS[e]); await page.locator('input[type="password"]').fill(CREDS[p]);
  await page.locator("button").filter({ hasText: /Entrar|Acessar/ }).first().click(); await page.waitForTimeout(2500);
  await shot("apos-login");
  await page.goto(`${C}/conexoes.html`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(3500);
  await shot("conexoes");
  const t = await page.locator("body").innerText(); writeFileSync(`${T}/j13-${papel}.txt`, t);
  r[papel] = { somenteLeitura: (t.match(/Somente leitura: owner ou developer/g) || []).length, botoesSalvar: await page.locator("button").filter({ hasText: "Salvar e testar" }).count() };
  for (const pg of ["problemas.html", "visao-geral.html", "jornada-v46.html"]) { await page.goto(`${C}/${pg}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(3500); await shot(pg.replace(".html", "")); }
  await fim(r[papel]);
}
console.log(JSON.stringify(r));
