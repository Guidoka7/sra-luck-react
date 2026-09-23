import { extrairCandidatos, type Achado, type SegmentoTexto } from "./candidatos";
import { campoDeCandidatos, campoVazio } from "./confianca";
import { BANCOS, encontrarBoletos } from "./febraban";
import { cpfValido, normalizarCpf } from "./normalizadores";
import type { CampoRotulado } from "./rotulos";
import type { Alerta, CampoExtraido, Candidato, PaginaTexto } from "./tipos";

/**
 * Campos do documento como um todo (cliente, CPF, contrato, venda, carnê,
 * banco, beneficiário). Candidatos de TODAS as páginas são somados: o mesmo
 * valor repetido em várias folhas ganha confiança; valores diferentes geram
 * conflito para revisão.
 */

const extratorCpf = (t: string): Achado<string>[] => {
  const achados: Achado<string>[] = [];
  for (const m of t.matchAll(/(?<!\d)(\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?!\d)/g)) {
    const cpf = normalizarCpf(m[1]);
    if (cpf) achados.push({ valor: cpf, bruto: m[1], indice: m.index ?? 0 });
  }
  return achados;
};

const extratorNome = (t: string): Achado<string>[] => {
  const limpo = t.replace(/\b(cpf|cnpj|cpf\/cnpj)\b.*$/i, "").replace(/\d[\d.\-/]*/g, " ").replace(/[^A-Za-zÀ-ú' ]/g, " ").replace(/\s+/g, " ").trim();
  const palavras = limpo.split(" ").filter((p) => p.length >= 2);
  if (palavras.length < 2 || limpo.length > 90) return [];
  const nome = palavras.join(" ").toUpperCase();
  return [{ valor: nome, bruto: limpo, indice: Math.max(0, t.indexOf(palavras[0])) }];
};

const extratorIdentificador = (t: string): Achado<string>[] => {
  const m = t.match(/^\s*(?:n[ºo°.]?\s*)?[:\-]?\s*([0-9][0-9./-]{1,24})/i);
  return m ? [{ valor: m[1].replace(/[^0-9]/g, ""), bruto: m[1], indice: t.indexOf(m[1]) }] : [];
};

const extratorTexto = (t: string): Achado<string>[] => {
  const limpo = t.replace(/\b(cnpj|cpf)\b.*$/i, "").replace(/\s+/g, " ").trim();
  return limpo.length >= 3 && limpo.length <= 90 ? [{ valor: limpo.toUpperCase(), bruto: limpo, indice: 0 }] : [];
};

function somarPaginas<T>(paginas: PaginaTexto[], campo: CampoRotulado, extrator: (t: string) => Achado<T>[], semRotulo: number): Candidato<T>[] {
  const todos = paginas.flatMap((p) => extrairCandidatos<T>(p as SegmentoTexto, campo, extrator, { semRotulo }));
  const porValor = new Map<string, Candidato<T> & { n: number }>();
  for (const c of todos) {
    const k = String(c.valor);
    const atual = porValor.get(k);
    if (!atual) { porValor.set(k, { ...c, n: 1 }); continue; }
    atual.n += 1;
    if (c.pontuacao > atual.pontuacao) Object.assign(atual, { ...c, n: atual.n });
  }
  return [...porValor.values()]
    .map(({ n, ...c }) => ({ ...c, pontuacao: Math.min(1, c.pontuacao + Math.min(0.05, (n - 1) * 0.01)), motivos: n > 1 ? [...c.motivos, `repetido_em_${n}_trechos`] : c.motivos }))
    .sort((a, b) => b.pontuacao - a.pontuacao);
}

export interface CamposDocumento {
  nomeCliente: CampoExtraido<string>;
  cpf: CampoExtraido<string>;
  contrato: CampoExtraido<string>;
  venda: CampoExtraido<string>;
  carne: CampoExtraido<string>;
  banco: CampoExtraido<string>;
  beneficiario: CampoExtraido<string>;
  alertas: Alerta[];
}

export function lerCamposDocumento(paginas: PaginaTexto[], referenciaIso?: string): CamposDocumento {
  const alertas: Alerta[] = [];

  let { campo: cpf } = campoDeCandidatos(somarPaginas(paginas, "cpf", extratorCpf, 0.4));
  if (cpf.valor && !cpfValido(cpf.valor)) {
    cpf = { ...cpf, confianca: Math.min(cpf.confianca, 0.3), nivel: "BAIXA", fatores: [...(cpf.fatores ?? []), "cpf_com_digito_verificador_invalido"] };
    alertas.push({ codigo: "INVALID_CPF", severidade: "ALERTA", campo: "cpf", mensagem: "O CPF lido no documento é inválido (dígitos verificadores não conferem)." });
  }

  const { campo: nomeCliente } = campoDeCandidatos(somarPaginas(paginas, "nome", extratorNome, 0));
  const { campo: contrato } = campoDeCandidatos(somarPaginas(paginas, "contrato", extratorIdentificador, 0));
  const { campo: venda } = campoDeCandidatos(somarPaginas(paginas, "venda", extratorIdentificador, 0));
  const { campo: carne } = campoDeCandidatos(somarPaginas(paginas, "carne", extratorIdentificador, 0));
  const { campo: beneficiario } = campoDeCandidatos(somarPaginas(paginas, "beneficiario", extratorTexto, 0));

  // Banco: pelo código da linha digitável (evidência com DV), não por texto solto.
  const contagem = new Map<string, number>();
  for (const p of paginas) for (const l of p.linhas) for (const b of encontrarBoletos(l.texto, referenciaIso).validos) contagem.set(b.banco, (contagem.get(b.banco) ?? 0) + 1);
  const [codigoBanco] = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  const banco: CampoExtraido<string> = codigoBanco
    ? { valor: BANCOS[codigoBanco] ? `${BANCOS[codigoBanco]} (${codigoBanco})` : codigoBanco, confianca: 0.99, nivel: "ALTA", fonte: paginas[0]?.fonte ?? "PDF_TEXT", fatores: ["codigo_do_banco_na_linha_digitavel"] }
    : campoVazio<string>();

  return { nomeCliente, cpf, contrato, venda, carne, banco, beneficiario, alertas };
}
