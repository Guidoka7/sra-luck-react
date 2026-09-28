// J07 — equipe registra o atendimento dos termos (previsão, presença, quitação) da QA-03 Camila
import { abrir, BASE } from "./lib.mjs";
import { loginEquipe } from "./adminlogin.mjs";
import { writeFileSync } from "node:fs";
const T = process.env.SP_TXT || "/tmp";
const NOME = process.env.NOME || "Camila Fictícia QA Termos";
const { page, shot, fim, rede } = await abrir(process.env.FLOW || "J07-equipe-atendimento-termos");
const r = {};
r.login = await loginEquipe(page);
await page.goto(`${BASE}/admin/agenda?aba=liberacao`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(3000);
const linha = page.locator("button").filter({ hasText: NOME }).first();
await linha.locator("xpath=..").getByRole("button", { name: "Registrar" }).click().catch(async () => { await page.getByRole("button", { name: "Registrar" }).first().click(); });
await page.waitForTimeout(2000); await shot("registrar-aberto");
writeFileSync(`${T}/j07-reg.txt`, await page.locator("body").innerText());
await page.getByRole("button", { name: "Registrar atendimento" }).last().click(); await page.waitForTimeout(1500);
await shot("guiado-passo1");
writeFileSync(`${T}/j07-guiado.txt`, await page.locator("[role=dialog]").last().innerText().catch(async () => await page.locator("body").innerText()));
const muts = [];
page.on("response", async (res) => { if (res.request().method() !== "GET" && res.url().includes("/api/admin/") && !res.url().includes("monitoramento")) muts.push({ status: res.status(), path: new URL(res.url()).pathname, body: (await res.text().catch(() => "")).slice(0, 200) }); });
if (process.env.AUSENTE) { await page.locator("button").filter({ hasText: /Não compareceu/ }).click(); }
else { await page.locator("button").filter({ hasText: /Sim, compareceu/ }).click();
await page.locator("button").filter({ hasText: /^\s*Recebida/ }).click(); }
await page.waitForTimeout(400); await shot("guiado-preenchido");
await page.locator("button").filter({ hasText: process.env.AUSENTE ? /Registrar e cancelar agendamento/ : /^\s*Registrar atendimento\s*$/ }).last().click();
await page.waitForTimeout(1200); await shot("guiado-confirmacao");
const confirma = page.locator("button").filter({ hasText: /^\s*(Confirmar|Confirmar registro|Sim, registrar)\s*$/i });
if (await confirma.count()) { await confirma.last().click(); }
await page.waitForTimeout(4000); await shot("apos-registro");
writeFileSync(`${T}/j07-apos.txt`, await page.locator("body").innerText());
r.mutacoes = muts;
r.inputs = await page.locator("input, select, textarea").evaluateAll(els => els.map(e => [e.tagName, e.type, e.placeholder, e.value, e.getAttribute("aria-label")]).filter(x => x[1] !== "file"));
r.botoes = await page.locator("button").evaluateAll(els => els.map(e => (e.innerText || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ")).filter(Boolean).filter(t => !/^\d+$/.test(t)));
await fim(r);
console.log(JSON.stringify(r, null, 1));
