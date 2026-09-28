// J05 — equipe confirma o levantamento financeiro da QA-02 Bruna (drawer > Processo)
import { abrir, BASE } from "./lib.mjs";
import { loginEquipe } from "./adminlogin.mjs";
import { writeFileSync } from "node:fs";
const T = process.env.SP_TXT || "/tmp";
const { page, shot, fim, rede } = await abrir(process.env.FLOW || "J05-equipe-levantamento");
const r = {};
r.login = await loginEquipe(page);
await page.goto(`${BASE}/admin/agenda?aba=liberacao`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(3000);
await shot("agenda-liberacao");
writeFileSync(`${T}/j05-agenda.txt`, await page.locator("body").innerText());
await page.getByRole("button", { name: "Fazer levantamento" }).click(); await page.waitForTimeout(2000);
await shot("levantamento-aberto");
writeFileSync(`${T}/j05-lev.txt`, await page.locator("body").innerText());
r.inputs = await page.locator("input").evaluateAll(els => els.map(e => [e.type, e.placeholder, e.value, e.getAttribute("aria-label"), e.name, e.checked]).filter(x => x[0] !== "file"));
await page.locator("label").filter({ hasText: /Cheques/ }).first().click(); await page.waitForTimeout(300);
await shot("levantamento-sem-cheques");
const lev = page.waitForResponse((res) => res.request().method() !== "GET" && res.url().includes("/api/admin/") && !res.url().includes("monitoramento"), { timeout: 20000 });
await page.getByRole("button", { name: "Concluir levantamento" }).click();
await page.waitForTimeout(600); await shot("confirmacao");
const confirmar = page.getByRole("button", { name: /Confirmar|Concluir/ }).last();
const rl = await Promise.race([lev, page.waitForTimeout(2500).then(() => null)]);
let resp = rl; if (!resp) { await confirmar.click(); resp = await lev; }
r.levantamento = { status: resp.status(), path: new URL(resp.url()).pathname, body: (await resp.text()).slice(0, 300) };
await page.waitForTimeout(2000); await shot("apos-levantamento");
r.botoes = await page.locator("button").evaluateAll(els => els.map(e => (e.innerText || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ")).filter(Boolean));
await fim(r);
console.log(JSON.stringify(r, null, 1));
