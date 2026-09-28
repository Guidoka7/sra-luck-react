import { BASE } from "./lib.mjs";
export async function loginCliente(page, cpf, nascBr) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(800);
  await page.getByPlaceholder("000.000.000-00").fill(cpf);
  await page.getByPlaceholder("DD/MM/AAAA").fill(nascBr);
  const r = page.waitForResponse((res) => res.url().endsWith("/api/cliente/auth"));
  await page.getByRole("button", { name: "Acessar minha área" }).click();
  const res = await r; await page.waitForTimeout(2500);
  const agoraNao = page.getByRole("button", { name: "Agora não" });
  if (await agoraNao.isVisible().catch(() => false)) await agoraNao.click();
  // Celebração de data especial (termos amanhã/hoje, cirurgia hoje): fecha para seguir o roteiro.
  const cel = page.locator("div.fixed.inset-0.z-\\[70\\]");
  if (await cel.count()) { await cel.locator("button").last().click({ timeout: 5000 }).catch(() => {}); await cel.first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {}); }
  return res.status();
}
export async function aba(page, nome) {
  await page.locator("nav button, button").filter({ hasText: new RegExp(`^\\s*${nome}\\s*$`, "i") }).last().click();
  await page.waitForTimeout(1500);
}
