import { compararComExistentes } from "./duplicidade";
import { codigoBarrasValido, linhaDigitavelValida } from "./febraban";
import { somenteDigitos } from "./normalizadores";
import type { Alerta, CarneLido, Caixa, NivelConfianca, ParcelaExistente, ParcelaLida, SituacaoParcela } from "./tipos";

/**
 * Estado da revisão humana (puro, testável). A leitura PROPÕE; a equipe
 * decide item a item. Nenhuma ação é presumida quando falta dado essencial,
 * a confiança é baixa ou a parcela já existe com dados diferentes: o item
 * fica "sem decisão" e bloqueia a confirmação até alguém escolher.
 */

export type AcaoItem = "criar" | "anexar" | "substituir" | "ignorar";
export type CampoEditavel = "numero" | "total" | "vencimento" | "valorCentavos" | "linhaDigitavel";

export interface ItemRevisao {
  id: string;
  pagina: number;
  regiao?: Caixa;
  caixas: Partial<Record<CampoEditavel, Caixa>>;
  numero: number | null;
  total: number | null;
  vencimento: string | null;
  valorCentavos: number | null;
  linhaDigitavel: string | null;
  /** Campos alterados pela equipe (fonte USER_CORRECTED). */
  corrigidos: CampoEditavel[];
  /** null = aguardando decisão humana. */
  acao: AcaoItem | null;
  boletoId: string | null;
  situacao: SituacaoParcela;
  existente: ParcelaExistente | null;
  sugestaoAnexo: { numero: number; boletoId: string; motivo: string } | null;
  /** Sugestão de correção de OCR para a linha digitável (nunca aplicada sozinha). */
  sugestaoLinha: string | null;
  confianca: number;
  nivel: NivelConfianca;
  alertas: Alerta[];
}

function acaoPadrao(p: ParcelaLida, situacao: SituacaoParcela, existente: ParcelaExistente | null, temSugestaoAnexo: boolean): { acao: AcaoItem | null; boletoId: string | null } {
  const essenciais = p.numero.valor != null && p.total.valor != null && p.vencimento.valor != null && p.valorCentavos.valor != null;
  const erro = p.alertas.some((a) => a.severidade === "ERRO");
  if (situacao === "MESMO_BOLETO_JA_ANEXADO") return { acao: "ignorar", boletoId: null };
  if (situacao === "JA_TEM_BOLETO") return temSugestaoAnexo ? { acao: null, boletoId: null } : { acao: "ignorar", boletoId: null };
  if (p.nivel === "BAIXA" || erro || temSugestaoAnexo) return { acao: null, boletoId: null };
  if (situacao === "JA_EXISTE_IGUAL" && existente) return { acao: "anexar", boletoId: existente.id };
  if (situacao === "NOVA" && essenciais) return { acao: "criar", boletoId: null };
  return { acao: null, boletoId: null };
}

export function montarRevisao(carne: CarneLido, existentes: ParcelaExistente[]): { itens: ItemRevisao[]; alertas: Alerta[] } {
  const { comparacoes, alertas } = compararComExistentes(carne.parcelas, existentes);
  const porNumero = new Map(existentes.map((e) => [e.numero, e]));
  const itens = carne.parcelas.map((p, i): ItemRevisao => {
    const c = comparacoes[i];
    const alvo = c.correspondenciaProvavel ? porNumero.get(c.correspondenciaProvavel.numero) : undefined;
    const sugestaoAnexo = c.correspondenciaProvavel && alvo ? { numero: alvo.numero, boletoId: alvo.id, motivo: c.correspondenciaProvavel.motivo } : null;
    // Se o número não foi impresso/lido, mas vencimento exato + valor (+ total,
    // quando disponível) identificam uma única parcela sem boleto, o vínculo
    // pode ser pré-selecionado sem inventar o número da parcela.
    const anexoExatoSemNumero = p.numero.valor == null && c.correspondenciaProvavel?.exata === true && alvo && !alvo.temBoleto;
    const { acao, boletoId } = anexoExatoSemNumero
      ? { acao: "anexar" as const, boletoId: alvo.id }
      : acaoPadrao(p, c.situacao, c.existente, Boolean(sugestaoAnexo));
    return {
      id: p.id,
      pagina: p.pagina,
      regiao: p.regiao,
      caixas: { numero: p.numero.caixa, total: p.total.caixa, vencimento: p.vencimento.caixa, valorCentavos: p.valorCentavos.caixa, linhaDigitavel: p.linhaDigitavel.caixa },
      numero: p.numero.valor,
      total: p.total.valor,
      vencimento: p.vencimento.valor,
      valorCentavos: p.valorCentavos.valor,
      linhaDigitavel: p.linhaDigitavel.valor ?? p.codigoBarras.valor,
      corrigidos: [],
      acao,
      boletoId,
      situacao: c.situacao,
      existente: c.existente,
      sugestaoAnexo,
      sugestaoLinha: p.linhaDigitavel.sugestao?.valor ?? null,
      confianca: p.confianca,
      nivel: p.nivel,
      alertas: [...p.alertas, ...alertas.filter((a) => a.item === p.id)],
    };
  });
  return { itens, alertas };
}

export function editarCampo<K extends CampoEditavel>(item: ItemRevisao, campo: K, valor: ItemRevisao[K]): ItemRevisao {
  if (item[campo] === valor) return item;
  return { ...item, [campo]: valor, corrigidos: item.corrigidos.includes(campo) ? item.corrigidos : [...item.corrigidos, campo] };
}

export function definirAcao(item: ItemRevisao, acao: AcaoItem | null, boletoId: string | null = null): ItemRevisao {
  return { ...item, acao, boletoId: acao === "anexar" || acao === "substituir" ? boletoId : null };
}

export function linhaValida(linha: string | null): boolean {
  if (!linha) return true;
  const d = somenteDigitos(linha);
  return linhaDigitavelValida(d) || codigoBarrasValido(d);
}

/** Motivos que impedem importar o item como está (vazio = pronto). */
export function pendenciasItem(item: ItemRevisao, itens: ItemRevisao[], existentes: ParcelaExistente[]): string[] {
  const p: string[] = [];
  if (item.acao === null) return ["Escolha o que fazer com esta parcela."];
  if (item.acao === "ignorar") return p;
  if (!linhaValida(item.linhaDigitavel)) p.push("A linha digitável não confere. Corrija ou apague.");
  if (item.acao === "criar") {
    if (item.numero == null || item.total == null) p.push("Informe o número e o total de parcelas.");
    else if (item.numero < 1 || item.numero > item.total) p.push("O número da parcela não pode ser maior que o total.");
    if (!item.vencimento) p.push("Informe o vencimento.");
    if (!item.valorCentavos || item.valorCentavos <= 0) p.push("Informe o valor.");
    if (item.numero != null && existentes.some((e) => e.numero === item.numero)) p.push(`A parcela ${item.numero} já existe no cadastro. Escolha anexar ou ignorar.`);
    const totalCadastro = existentes.length ? Math.max(...existentes.map((e) => e.total)) : null;
    if (totalCadastro != null && item.total != null && item.total !== totalCadastro) p.push(`O cadastro tem ${totalCadastro} parcelas; este item diz ${item.total}.`);
    if (item.numero != null && itens.some((o) => o.id !== item.id && o.acao === "criar" && o.numero === item.numero)) p.push(`Outra folha também vai criar a parcela ${item.numero}.`);
  } else {
    const alvo = existentes.find((e) => e.id === item.boletoId);
    if (!alvo) p.push("Escolha a parcela do cadastro.");
    else if (item.acao === "anexar" && alvo.temBoleto) p.push(`A parcela ${alvo.numero} já tem boleto. Use substituir ou ignore.`);
    else if (item.acao === "substituir" && !alvo.temBoleto) p.push(`A parcela ${alvo.numero} ainda não tem boleto. Use anexar.`);
    else if (item.acao === "substituir" && (alvo.status === "pago" || alvo.status === "pendente_confirmacao")) p.push(`A parcela ${alvo.numero} está paga ou em conferência.`);
    if (item.boletoId && itens.some((o) => o.id !== item.id && (o.acao === "anexar" || o.acao === "substituir") && o.boletoId === item.boletoId)) p.push("Outra folha também vai para esta parcela.");
  }
  return p;
}

export interface ResumoDecisoes {
  criar: number;
  anexar: number;
  substituir: number;
  ignorar: number;
  semDecisao: number;
  comPendencia: number;
  corrigidos: number;
}

export function resumoDecisoes(itens: ItemRevisao[], existentes: ParcelaExistente[]): ResumoDecisoes {
  const r: ResumoDecisoes = { criar: 0, anexar: 0, substituir: 0, ignorar: 0, semDecisao: 0, comPendencia: 0, corrigidos: 0 };
  for (const it of itens) {
    if (it.acao === null) r.semDecisao += 1;
    else r[it.acao] += 1;
    if (it.acao !== null && pendenciasItem(it, itens, existentes).length) r.comPendencia += 1;
    if (it.corrigidos.length) r.corrigidos += 1;
  }
  return r;
}

export function podeConfirmar(itens: ItemRevisao[], existentes: ParcelaExistente[], cpfDivergente: boolean, cpfConfirmado: boolean): boolean {
  const r = resumoDecisoes(itens, existentes);
  return r.semDecisao === 0 && r.comPendencia === 0 && r.criar + r.anexar + r.substituir > 0 && (!cpfDivergente || cpfConfirmado);
}
