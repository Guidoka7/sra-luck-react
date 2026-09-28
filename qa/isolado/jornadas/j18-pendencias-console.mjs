// J18 — fila de pendências pelas telas e pelo proxy do Dev Console (RBAC) + vínculo no Admin
import { abrir, BASE, CREDS, EV, sql } from "./lib.mjs";
import { loginEquipe } from "./adminlogin.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const C = "http://localhost:3200";
const r = { casos: [] };
const caso = (papel, nome, esperado, res) => r.casos.push({ papel, nome, esperado, status: res.status, erro: res.erro ?? null, ok: String(esperado).split("|").map(Number).includes(res.status) });
async function loginConsole(e, p) {
  const x = await fetch(`${C}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: C }, body: JSON.stringify({ email: CREDS[e], password: CREDS[p] }) });
  return x.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const proxy = async (cookie, method, path, body) => {
  const x = await fetch(`${C}/api/sra-proxy?path=${encodeURIComponent(path)}`, { method, headers: { Cookie: cookie, Origin: C, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await x.json().catch(() => ({})); return { status: x.status, erro: j.erro ?? j.codigo ?? null, data: j };
};
const idDe = (tipo, sufixo) => sql(`select id from integracao_pendencias where tipo='${tipo}' and external_id like '%${sufixo}' and estado='aberta' limit 1`);

const viewer = await loginConsole("QA_CONSOLE_VIEWER_EMAIL", "QA_CONSOLE_VIEWER_PASSWORD");
const operator = await loginConsole("QA_CONSOLE_OPERATOR_EMAIL", "QA_CONSOLE_OPERATOR_PASSWORD");
const lista = await proxy(viewer, "GET", "/api/admin/integrations/pendencias");
caso("viewer", "lista a fila (sem dados pessoais)", 200, lista);
r.resumo = lista.data?.resumo;
r.semDadosPessoais = !JSON.stringify(lista.data).match(/9000002\d{4}|556191\d{7}|@sraluck|Contato QA/);
const d3 = idDe("vendedora_nao_vinculada", "00d3"), d9 = idDe("negociacao_com_erro", "00d9");
caso("viewer", "reprocessar", 403, await proxy(viewer, "POST", `/api/admin/integrations/pendencias/${d3}/reprocessar`, {}));
caso("viewer", "descartar", 403, await proxy(viewer, "POST", `/api/admin/integrations/pendencias/${d3}/descartar`, { motivo: "teste de permissão" }));
const rep3 = await proxy(operator, "POST", `/api/admin/integrations/pendencias/${d3}/reprocessar`, {});
caso("operator", "reprocessar pendência da venda (causa continua: sem vínculo)", 200, rep3);
r.d3AposReprocessar = rep3.data?.estado;
const rep9 = await proxy(operator, "POST", `/api/admin/integrations/pendencias/${d9}/reprocessar`, {});
caso("operator", "reprocessar negociação com o RD indisponível no QA (sem token) → falha visível", 502, rep9);
r.d9Erro = rep9.erro; r.d9ContinuaAberta = sql(`select estado from integracao_pendencias where id='${d9}'`) === "aberta";
caso("operator", "descartar sem motivo", 400, await proxy(operator, "POST", `/api/admin/integrations/pendencias/${d9}/descartar`, { motivo: "" }));
const dup = idDe("duplicidade_possivel", "00d7");
caso("operator", "duplicidade não se reprocessa pelo Console (decisão na revisão)", 409, await proxy(operator, "POST", `/api/admin/integrations/pendencias/${dup}/reprocessar`, {}));
// Backend direto: viewer não escreve nem burlando o Console
const direto = await fetch(`${BASE}/api/admin/integrations/pendencias/${d3}/descartar`, { method: "POST", headers: { "Content-Type": "application/json", "x-dev-console-token": CREDS.QA_DEV_CONSOLE_TOKEN, "x-dev-actor-id": "qa", "x-dev-actor-role": "viewer" }, body: JSON.stringify({ motivo: "burlar" }) });
caso("backend", "M2M viewer POST direto", 403, { status: direto.status });
r.auditoriaApp = sql("select json_agg(json_build_object('acao',acao,'n',n)) from (select acao, count(*) n from logs_alteracoes where acao like '%pendencia%' or acao='vinculou_responsavel_rd' group by 1) x");

// Telas: Console (viewer e operator) e Admin (vínculo do responsável)
for (const [papel, e, p] of [["viewer", "QA_CONSOLE_VIEWER_EMAIL", "QA_CONSOLE_VIEWER_PASSWORD"], ["operator", "QA_CONSOLE_OPERATOR_EMAIL", "QA_CONSOLE_OPERATOR_PASSWORD"]]) {
  const { page, shot, fim } = await abrir(`J18-console-pendencias-${papel}`);
  await page.goto(`${C}/login.html`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(700);
  await page.locator('input[type="email"]').fill(CREDS[e]); await page.locator('input[type="password"]').fill(CREDS[p]);
  await page.locator("button").filter({ hasText: /Entrar|Acessar/ }).first().click(); await page.waitForTimeout(2000);
  await page.goto(`${C}/pendencias.html`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(3500);
  await shot("fila");
  r[`tela_${papel}`] = { botoesReprocessar: await page.locator("button[data-reprocessar]").count(), somenteLeitura: await page.getByText("Somente leitura").count() };
  await fim(r[`tela_${papel}`]);
}
{
  const { page, shot, fim } = await abrir("J18-admin-vinculo-responsavel");
  await loginEquipe(page);
  // Caminho operacional da equipe: Clientes › Importações do RD
  await page.goto(`${BASE}/admin/clientes`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /Importações do RD/ }).first().click(); await page.waitForTimeout(2000);
  const painel = page.getByText(/Responsáveis do RD sem vínculo/);
  await painel.first().scrollIntoViewIfNeeded().catch(() => {});
  await shot("responsaveis-sem-vinculo");
  const select = page.locator('select[aria-label="Pessoa da equipe"]').first();
  r.adminPainelVisivel = await painel.count();
  if (await select.count()) {
    await select.selectOption({ index: 1 });
    await page.getByRole("button", { name: "Vincular" }).first().click(); await page.waitForTimeout(2000);
    await shot("apos-vincular");
  }
  // Revisão agrupada: uma linha por negociação, com o número de execuções em que apareceu
  r.revisaoTitulo = await page.getByText(/Aguardando revisão \(\d+\)/).first().textContent().catch(() => null);
  r.revisaoRepeticoes = await page.getByText(/vista em \d+ execuções/).count();
  const mesma = page.getByRole("button", { name: "É a mesma pessoa" });
  r.revisaoBotoes = await mesma.count();
  if (r.revisaoBotoes) { await mesma.first().click(); await page.waitForTimeout(2000); await shot("apos-mesma-pessoa"); }
  r.d7AposDecisao = sql(`select estado||'/'||coalesce(resolucao,'') from integracao_pendencias where tipo='duplicidade_possivel' and external_id like '%00d7'`);
  r.d7ItensAbertos = sql(`select count(*) from integracao_importacao_itens where external_id like '%00d7' and resultado in ('duplicada','cliente_existente') and revisado_em is null`);
  r.d3AposVinculo = sql(`select estado||'/'||coalesce(resolucao,'') from integracao_pendencias where tipo='vendedora_nao_vinculada' and external_id like '%00d3' order by primeira_ocorrencia_em desc limit 1`);
  await fim({ painel: r.adminPainelVisivel, d3: r.d3AposVinculo });
}
r.biFinal = sql("select count(*) from vw_vendas_validas_bi");
mkdirSync(`${EV}/J18-pendencias-console`, { recursive: true });
writeFileSync(`${EV}/J18-pendencias-console/result.json`, JSON.stringify(r, null, 1));
for (const c of r.casos) console.log(`${c.ok ? "OK   " : "FALHA"} [${c.papel}] ${c.nome} → ${c.status}${c.erro ? " " + c.erro : ""} (esperado ${c.esperado})`);
console.log(JSON.stringify({ resumo: r.resumo, semDadosPessoais: r.semDadosPessoais, d3AposReprocessar: r.d3AposReprocessar, d9Erro: r.d9Erro, d9ContinuaAberta: r.d9ContinuaAberta, telaViewer: r.tela_viewer, telaOperator: r.tela_operator, adminPainel: r.adminPainelVisivel, d3AposVinculo: r.d3AposVinculo, revisaoTitulo: r.revisaoTitulo, revisaoRepeticoes: r.revisaoRepeticoes, revisaoBotoes: r.revisaoBotoes, d7AposDecisao: r.d7AposDecisao, d7ItensAbertos: r.d7ItensAbertos, biFinal: r.biFinal, auditoria: r.auditoriaApp }, null, 1));
