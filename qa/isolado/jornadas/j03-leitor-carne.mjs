// J03 — leitor de carnês: PDF fictício → leitura no navegador → revisão → importação (Storage privado + RPC)
import { abrir, BASE } from "./lib.mjs";
import { loginEquipe } from "./adminlogin.mjs";
import { writeFileSync } from "node:fs";
const T = process.env.SP_TXT || "/tmp";
const { page, shot, fim, rede } = await abrir(process.env.FLOW || "J03-leitor-carne");
const r = {};
r.login = await loginEquipe(page);
await page.goto(`${BASE}/admin/clientes`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2500);
await shot("clientes");
await page.getByText(process.env.FLOW === "J03b-leitor-carne-duplicado" ? "Cadastradas" : "Aguardando cadastro").first().click(); await page.waitForTimeout(1500);
const busca = page.getByPlaceholder(/Buscar|Pesquisar/i).first();
await busca.fill("Giovana"); await page.waitForTimeout(1500);
await shot("busca");
await page.getByText("Giovana Fictícia QA Carne").first().click(); await page.waitForTimeout(2000);
await shot("drawer");
writeFileSync(`${T}/j03-drawer.txt`, await page.locator("body").innerText());
await page.locator("button, [role=tab]").filter({ hasText: /^\s*financeiro(\s*\d+)?\s*$/i }).last().click(); await page.waitForTimeout(1500);
await shot("drawer-financeiro");
writeFileSync(`${T}/j03-fin.txt`, await page.locator("body").innerText());
await page.getByRole("button", { name: /Ler carnê/ }).click(); await page.waitForTimeout(1000);
await shot("leitor-aberto");
const inputs = page.locator('[aria-label="Ler carnê"] input[type="file"]');
r.inputsLeitor = await inputs.count();
await inputs.first().setInputFiles("/home/user/qa-supabase/qa/fixtures/carne-qa-giovana-12x.pdf");
await page.waitForTimeout(8000); await shot("leitura");
const textoLeitura = await page.locator('[aria-label="Ler carnê"]').innerText();
writeFileSync(`${T}/j03-leitura.txt`, textoLeitura);
if (process.env.FLOW === "J03b-leitor-carne-duplicado") {
  r.textoDuplicado = textoLeitura.split("\n").filter((l) => /import|duplic|já/i.test(l));
  r.botoes = await page.locator('[aria-label="Ler carnê"] button').evaluateAll(els => els.map(e => [e.innerText.trim(), e.disabled]));
  const btn = page.getByRole("button", { name: "Revisar e importar" });
  if (await btn.isVisible().catch(() => false) && await btn.isEnabled()) {
    await btn.click(); await page.waitForTimeout(1000); await shot("dup-confirmar");
    r.dupConfirmarTexto = await page.locator('[role=dialog]').last().innerText();
    const imp = page.waitForResponse((res) => res.url().includes("/leitor-carne/importar"), { timeout: 30000 }).catch(() => null);
    await page.getByRole("button", { name: /Confirmar importação/ }).last().click().catch(() => {});
    const ri = await imp; if (ri) r.dupImportar = { status: ri.status(), body: (await ri.text()).slice(0, 300) };
    await page.waitForTimeout(1500); await shot("dup-resultado");
  }
  await fim(r); console.log(JSON.stringify(r, null, 1)); process.exit(0);
}
await page.getByRole("button", { name: "Revisar e importar" }).click(); await page.waitForTimeout(1200);
await shot("confirmar-importacao");
writeFileSync(`${T}/j03-confirmar.txt`, await page.locator('[role=dialog]').last().innerText());
r.botoesConfirmar = await page.locator('[role=dialog] button').evaluateAll(els => els.map(e => e.innerText.trim()).filter(Boolean));
const imp = page.waitForResponse((res) => res.url().includes("/leitor-carne/importar"), { timeout: 60000 });
await page.getByRole("button", { name: /Confirmar importação|Importar/ }).last().click();
const ri = await imp; r.importar = { status: ri.status(), body: (await ri.text()).slice(0, 300) };
await page.waitForTimeout(2500); await shot("apos-importar");
await page.getByRole("button", { name: "Fechar" }).first().click(); await page.waitForTimeout(1500); await shot("drawer-apos-importar");
writeFileSync(`${T}/j03-drawer-apos.txt`, await page.locator("body").innerText());
r.botoes = await page.locator('[aria-label="Ler carnê"] button').evaluateAll(els => els.map(e => (e.innerText || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ")).filter(Boolean));
await fim(r);
console.log(JSON.stringify(r, null, 1));
