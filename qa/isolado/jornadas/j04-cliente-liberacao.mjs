// J04 — cliente elegível (QA-02 Bruna 62,5%) solicita liberação pelo app
import { abrir } from "./lib.mjs";
import { loginCliente, aba } from "./clientelogin.mjs";
import { writeFileSync } from "node:fs";
const T = process.env.SP_TXT || "/tmp";
const { page, shot, fim, rede } = await abrir(process.env.FLOW || "J04-cliente-solicita-liberacao", { mobile: true });
const r = {};
r.login = await loginCliente(page, process.env.CPF || "90000000256", process.env.NASC || "20/03/1988");
await shot("home");
writeFileSync(`${T}/j04-home.txt`, await page.locator("body").innerText());
await aba(page, "Agenda"); await shot("agenda");
writeFileSync(`${T}/j04-agenda.txt`, await page.locator("body").innerText());
const sol = page.waitForResponse((res) => res.request().method() === "POST" && /solicit/.test(res.url()), { timeout: 20000 });
await page.getByRole("button", { name: "Solicitar liberação financeira" }).last().click();
await page.waitForTimeout(800); await shot("apos-clicar-solicitar");
const conf = page.getByRole("button", { name: /Confirmar|Solicitar/ }).last();
const rs = await Promise.race([sol, page.waitForTimeout(3000).then(() => null)]);
if (!rs && await conf.isVisible().catch(() => false)) { await conf.click(); }
const rs2 = rs || await sol.catch(() => null);
if (rs2) r.solicitar = { status: rs2.status(), path: new URL(rs2.url()).pathname, body: (await rs2.text()).slice(0, 300) };
await page.waitForTimeout(2000); await shot("apos-solicitar");
writeFileSync(`${T}/j04-apos.txt`, await page.locator("body").innerText());
r.botoes = await page.locator("main button, button").evaluateAll(els => els.map(e => (e.innerText || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ")).filter(Boolean));
await fim(r);
console.log(JSON.stringify(r, null, 1));
