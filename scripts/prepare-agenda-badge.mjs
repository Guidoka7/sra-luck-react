import fs from "node:fs";

const path = "src/components/admin/PrevisaoLiberacaoFinanceiraInteligente.tsx";
let text = fs.readFileSync(path, "utf8");

const oldBadges = `          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full border border-gold/20 bg-gold/10 px-2.5 py-1 text-[0.58rem] font-semibold text-burgundy">Valor já liberado no mês: {formatarMoeda(valorJaLiberadoMes)}</span>
            <span className="rounded-full border border-rose/10 bg-[rgb(var(--surface-2))] px-2.5 py-1 text-[0.58rem] font-semibold text-clay/65">Orçamento: {formatarMoeda(analise?.orcamentoMensal ?? 0)}</span>
          </div>
`;

if ((text.match(/Valor já liberado no mês:/g) ?? []).length !== 1 || !text.includes(oldBadges)) {
  throw new Error("Não foi possível localizar de forma segura o bloco antigo do orçamento.");
}
text = text.replace(oldBadges, "");

const oldRestante = `  const valorRestante = solicitacaoSelecionada ? Number(solicitacaoSelecionada.saldo_restante) : null;\n`;
const newRestante = `${oldRestante}  const orcamentoAtingido = Boolean(analise?.orcamentoMensal) && valorJaLiberadoMes >= (analise?.orcamentoMensal ?? 0);\n`;
if ((text.match(/const valorRestante =/g) ?? []).length !== 1) {
  throw new Error("Ponto de inserção da regra de orçamento não encontrado.");
}
text = text.replace(oldRestante, newRestante);

const oldAgenda = `              </div>\n            </div>\n\n            <div className="mx-auto mt-3 w-full max-w-2xl">\n`;
const newAgenda = `              </div>\n            </div>\n\n            <div className="mt-3 flex justify-center">\n              <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-[0.62rem] font-semibold shadow-sm", orcamentoAtingido ? "border-burgundy/25 bg-burgundy/8 text-burgundy" : "border-success/25 bg-success/8 text-success")}>\n                Valor já liberado esse mês&nbsp; {formatarMoeda(valorJaLiberadoMes)}/{formatarMoeda(analise.orcamentoMensal)}\n              </span>\n            </div>\n\n            <div className="mx-auto mt-3 w-full max-w-2xl">\n`;
if ((text.match(/<div className=\"mx-auto mt-3 w-full max-w-2xl\">/g) ?? []).length !== 1) {
  throw new Error("Cabeçalho da agenda não encontrado de forma segura.");
}
text = text.replace(oldAgenda, newAgenda);

fs.writeFileSync(path, text, "utf8");
console.log("Indicador de orçamento preparado para a agenda.");
