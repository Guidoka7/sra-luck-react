import { analisarSequencia, validarContraCliente } from "./analise";
import { confiancaDoDocumento, nivelDaConfianca } from "./confianca";
import { lerCamposDocumento } from "./documento";
import { escolherParser, fingerprintLayout } from "./layouts";
import { lerParcela } from "./parcela";
import { segmentarPagina } from "./segmentador";
import type { Alerta, CarneLido, ContextoLeitura, PaginaTexto, ParcelaLida, ProvedorLeituraDocumento } from "./tipos";

/**
 * Leitor local (sem IA, sem serviço externo): orquestra segmentação, parser
 * de cada parcela, campos do documento, análise da sequência, validação
 * contra a cliente e a confiança final. É o provedor principal; um provedor
 * externo futuro implementaria a mesma interface apenas como fallback.
 */
export class LeitorLocalCarne implements ProvedorLeituraDocumento {
  readonly id = "local";

  analisar(paginas: PaginaTexto[], contexto: ContextoLeitura): CarneLido {
    const legiveis = paginas.filter((p) => p.linhas.length > 0);
    const { fingerprint, banco } = fingerprintLayout(legiveis);
    const parser = escolherParser(legiveis, banco);

    const lidas: ParcelaLida[] = [];
    for (const pagina of legiveis) {
      for (const segmento of segmentarPagina(pagina)) {
        const parcela = lerParcela(segmento, contexto.referenciaIso);
        const temConteudo = parcela.numero.valor != null || parcela.vencimento.valor != null || parcela.valorCentavos.valor != null || parcela.linhaDigitavel.valor != null || parcela.linhaDigitavel.sugestao;
        if (temConteudo) lidas.push(parcela);
      }
    }

    const campos = lerCamposDocumento(legiveis, contexto.referenciaIso);
    const { parcelas, resumo, alertas: alertasSequencia } = analisarSequencia(lidas);
    const alertas: Alerta[] = [
      ...contexto.paginasIlegiveis.map((pagina): Alerta => ({ codigo: "UNREADABLE_PAGE", severidade: "ALERTA", pagina, mensagem: `Não foi possível ler a página ${pagina}.` })),
      ...paginas.filter((p) => p.fonte === "OCR" && p.confiancaOcr != null && p.confiancaOcr < 0.6 && p.linhas.length).map((p): Alerta => ({ codigo: "LOW_OCR_CONFIDENCE", severidade: "ALERTA", pagina: p.pagina, mensagem: `Página ${p.pagina} com baixa qualidade de leitura.`, detalhes: { confiancaOcr: Math.round((p.confiancaOcr ?? 0) * 100) / 100 } })),
      ...campos.alertas,
      ...alertasSequencia,
      ...validarContraCliente(campos.cpf.valor, campos.nomeCliente.valor, contexto.cliente),
    ];
    if (!parcelas.length && legiveis.length) {
      alertas.push({ codigo: "FIELD_NOT_FOUND", severidade: "ERRO", mensagem: "Nenhuma parcela foi identificada no documento." });
    }

    const confiancaDocumento = confiancaDoDocumento(parcelas.map((p) => p.confianca), alertas, contexto.totalPaginas, contexto.paginasIlegiveis.length);
    return {
      tipoDocumento: contexto.tipoDocumento,
      paginas: contexto.totalPaginas,
      paginasTexto: paginas.filter((p) => p.fonte === "PDF_TEXT").length,
      paginasOcr: paginas.filter((p) => p.fonte === "OCR").length,
      paginasIlegiveis: contexto.paginasIlegiveis,
      layout: { parser: parser.id, fingerprint, banco },
      ...campos,
      parcelas,
      resumo,
      confiancaDocumento,
      nivelDocumento: nivelDaConfianca(confiancaDocumento),
      alertas,
    };
  }
}

export function lerCarne(paginas: PaginaTexto[], contexto: ContextoLeitura): CarneLido {
  return new LeitorLocalCarne().analisar(paginas, contexto);
}
