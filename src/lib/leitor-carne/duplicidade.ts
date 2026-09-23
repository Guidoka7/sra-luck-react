import { mesesEntre } from "./normalizadores";
import type { Alerta, ComparacaoParcela, ParcelaExistente, ParcelaLida } from "./tipos";

/**
 * Duplicidade contra o que já está cadastrado. Chave lógica: cliente +
 * número da parcela (o banco garante uma parcela por número por cliente),
 * conferindo valor, vencimento e total; e o identificador do boleto (linha
 * digitável) para reconhecer o MESMO boleto já anexado.
 *
 * Quando o número impresso não bate (ex.: carnê complementar impresso como
 * "1/12" para as parcelas 61 a 72 de 72), procura uma parcela existente sem
 * boleto com o mesmo mês de vencimento e o mesmo valor e a SUGERE — nunca
 * troca o número sozinho.
 */
export function compararComExistentes(parcelas: ParcelaLida[], existentes: ParcelaExistente[]): { comparacoes: ComparacaoParcela[]; alertas: Alerta[] } {
  const porNumero = new Map(existentes.map((e) => [e.numero, e]));
  const alertas: Alerta[] = [];
  const comparacoes = parcelas.map((p): ComparacaoParcela => {
    const linha = p.linhaDigitavel.valor;
    const mesmaLinha = linha ? existentes.find((e) => e.identificador && e.identificador.replace(/\D/g, "") === linha) : undefined;
    if (mesmaLinha) {
      alertas.push({ codigo: "INSTALLMENT_ALREADY_EXISTS", severidade: "ALERTA", parcela: mesmaLinha.numero, item: p.id, pagina: p.pagina, mensagem: `Este boleto já está anexado à parcela ${mesmaLinha.numero}.` });
      return { item: p.id, situacao: "MESMO_BOLETO_JA_ANEXADO", existente: mesmaLinha, diferencas: [], correspondenciaProvavel: null };
    }
    const numero = p.numero.valor;
    const existente = numero != null ? porNumero.get(numero) ?? null : null;
    const provavel = (): ComparacaoParcela["correspondenciaProvavel"] => {
      if (!p.vencimento.valor || p.valorCentavos.valor == null) return null;
      const candidatas = existentes.filter((e) => !e.temBoleto && e.vencimento && mesesEntre(e.vencimento, p.vencimento.valor!) === 0 && e.valorCentavos === p.valorCentavos.valor);
      return candidatas.length === 1 && candidatas[0].numero !== numero
        ? { numero: candidatas[0].numero, motivo: `Mesmo mês de vencimento e mesmo valor da parcela ${candidatas[0].numero}/${candidatas[0].total} já cadastrada.` }
        : null;
    };
    if (!existente) return { item: p.id, situacao: "NOVA", existente: null, diferencas: [], correspondenciaProvavel: provavel() };

    const diferencas: ComparacaoParcela["diferencas"] = [];
    if (p.valorCentavos.valor != null && p.valorCentavos.valor !== existente.valorCentavos) diferencas.push("valor");
    if (p.vencimento.valor && existente.vencimento && mesesEntre(existente.vencimento, p.vencimento.valor) !== 0) diferencas.push("vencimento");
    if (p.total.valor != null && p.total.valor !== existente.total) diferencas.push("total");
    const situacao = existente.temBoleto ? "JA_TEM_BOLETO" : diferencas.length ? "JA_EXISTE_DIFERENTE" : "JA_EXISTE_IGUAL";
    if (situacao !== "JA_EXISTE_IGUAL") {
      alertas.push({
        codigo: "INSTALLMENT_ALREADY_EXISTS",
        severidade: "ALERTA",
        parcela: numero,
        item: p.id,
        pagina: p.pagina,
        mensagem: existente.temBoleto
          ? `A parcela ${numero} já existe e já tem boleto anexado.`
          : `A parcela ${numero} já existe com dados diferentes (${diferencas.join(", ")}).`,
        detalhes: { diferencas: diferencas.join(",") },
      });
    }
    return { item: p.id, situacao, existente, diferencas, correspondenciaProvavel: diferencas.includes("vencimento") || diferencas.includes("total") ? provavel() : null };
  });
  return { comparacoes, alertas };
}
