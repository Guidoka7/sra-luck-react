import { BASE, CREDS } from "./lib.mjs";
export async function loginEquipe(page, email = CREDS.QA_ADMIN_EMAIL, senha = CREDS.QA_ADMIN_PASSWORD) {
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(800);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(senha);
  const r = page.waitForResponse((res) => res.url().endsWith("/api/admin/auth"));
  await page.getByRole("button", { name: /Entrar|Acessar/ }).first().click();
  const res = await r; await page.waitForTimeout(2000);
  return res.status();
}
