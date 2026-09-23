import { ajustar, arredondar, confiancaDaParcela, nivelDaConfianca } from "./confianca";
import { cpfValido, formatarCentavos, formatarData, normalizarCpf, similaridadeNomes } from "./normalizadores";
import type { Alerta, CampoExtraido, ClienteReferencia, ParcelaLida, Periodicidade, ResumoCarne } from "./tipos";

/**
 * Inteligência multipágina: o carnê é analisado como UMA sequência financeira.
 * A sequência serve para VALIDAR — nunca para criar parcelas ou preencher
 * datas/valores ausentes.
 */

function moda<T>(valores: T[]): { valor: T | null; vezes: number } {
  const contagem = new Map<T, number>();
  for (const v of valores) contagem.set(v, (contagem.get(v) ?? 0) + 1);
  let melhor: T | null = null;
  let vezes = 0;
  for (const [v, n] of contagem) if (n > vezes) { melhor = v; vezes = n; }
  return { valor: melhor, vezes };
}

/** Índice absoluto do mês (ano*12+mês) de uma data ISO. */
function indiceMes(iso: string) {
  const [a, m] = iso.split("-").map(Number);
  return a * 12 + (m - 1);
}

export interface ResultadoAnalise {
  parcelas: ParcelaLida[];
  resumo: ResumoCarne;
  alertas: Alerta[];
}

function penalizar(p: ParcelaLida, campo: "vencimento" | "valorCentavos" | "numero", motivo: string): ParcelaLida {
  const novo = { ...p, [campo]: ajustar(p[campo] as CampoExtraido<unknown>, { multiplicar: 0.85, motivo }) } as ParcelaLida;
  const confianca = confiancaDaParcela([novo.numero, novo.vencimento, novo.valorCentavos]);
  return { ...novo, confianca, nivel: nivelDaConfianca(confianca) };
}

export function analisarSequencia(parcelasEntrada: ParcelaLida[]): ResultadoAnalise {
  let parcelas = [...parcelasEntrada];
  const alertas: Alerta[] = [];
  const add = (a: Alerta, idItem?: string) => {
    alertas.push(a);
    if (idItem) parcelas = parcelas.map((p) => (p.id === idItem ? { ...p, alertas: [...p.alertas, a] } : p));
  };

  // Total de parcelas informado pelo documento
  const totais = parcelas.map((p) => p.total.valor).filter((t): t is number => t != null);
  const { valor: totalInformado } = moda(totais);
  const totaisDistintos = [...new Set(totais)];
  if (totaisDistintos.length > 1) {
    add({ codigo: "TOTAL_INSTALLMENTS_CONFLICT", severidade: "ALERTA", mensagem: `O documento indica totais diferentes de parcelas (${totaisDistintos.join(", ")}).`, detalhes: { totais: totaisDistintos.join(",") } });
  }

  // Repetidas e ausentes (só DENTRO do intervalo encontrado)
  const numeros = parcelas.map((p) => p.numero.valor).filter((n): n is number => n != null);
  const vistos = new Map<number, string>();
  const duplicadas: number[] = [];
  for (const p of parcelas) {
    const n = p.numero.valor;
    if (n == null) continue;
    if (vistos.has(n)) {
      duplicadas.push(n);
      add({ codigo: "DUPLICATE_INSTALLMENT", severidade: "ALERTA", parcela: n, item: p.id, pagina: p.pagina, mensagem: `A parcela ${n}${totalInformado ? `/${totalInformado}` : ""} aparece mais de uma vez no documento (página ${p.pagina}).` }, p.id);
    } else vistos.set(n, p.id);
  }
  const unicos = [...new Set(numeros)].sort((a, b) => a - b);
  const ausentes: number[] = [];
  for (let i = 1; i < unicos.length; i += 1) for (let n = unicos[i - 1] + 1; n < unicos[i]; n += 1) ausentes.push(n);
  for (const n of ausentes) add({ codigo: "MISSING_INSTALLMENT", severidade: "ALERTA", parcela: n, mensagem: `Não foi possível localizar a parcela ${n}${totalInformado ? `/${totalInformado}` : ""} no documento.` });
  if (totalInformado && unicos.length && (unicos[0] > 1 || unicos[unicos.length - 1] < totalInformado)) {
    add({ codigo: "PARTIAL_DOCUMENT", severidade: "INFO", mensagem: `O documento cobre as parcelas ${unicos[0]} a ${unicos[unicos.length - 1]} de ${totalInformado}.`, detalhes: { primeira: unicos[0], ultima: unicos[unicos.length - 1], total: totalInformado } });
  }

  // Datas: cada parcela deveria estar no mês (número + deslocamento predominante)
  const comData = parcelas.filter((p) => p.numero.valor != null && p.vencimento.valor);
  const deslocamentos = comData.map((p) => indiceMes(p.vencimento.valor!) - p.numero.valor!);
  const { valor: deslocamento, vezes } = moda(deslocamentos);
  let periodicidade: Periodicidade = "INDETERMINADA";
  if (comData.length >= 2 && deslocamento != null) {
    const dias = comData.map((p) => Number(p.vencimento.valor!.slice(8, 10)));
    const { valor: diaPredominante } = moda(dias);
    let anomalias = 0;
    for (const p of comData) {
      const esperadoMes = p.numero.valor! + deslocamento;
      const mesOk = indiceMes(p.vencimento.valor!) === esperadoMes;
      const diaOk = diaPredominante == null || Math.abs(Number(p.vencimento.valor!.slice(8, 10)) - diaPredominante) <= 4;
      if (mesOk && diaOk) continue;
      anomalias += 1;
      const ano = Math.floor(esperadoMes / 12);
      const mes = (esperadoMes % 12) + 1;
      const esperado = `${String(diaPredominante ?? 1).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${ano}`;
      const a: Alerta = { codigo: "DATE_SEQUENCE_ANOMALY", severidade: "ALERTA", parcela: p.numero.valor, item: p.id, pagina: p.pagina, campo: "vencimento", mensagem: `Vencimento da parcela ${p.numero.valor} (${formatarData(p.vencimento.valor)}) fora da sequência mensal (esperado perto de ${esperado}). Pode ser renegociação ou erro de leitura.`, detalhes: { lido: p.vencimento.valor, esperadoAproximado: esperado } };
      add(a, p.id);
      parcelas = parcelas.map((x) => (x.id === p.id ? penalizar(x, "vencimento", "fora_da_sequencia_de_datas") : x));
    }
    periodicidade = vezes / comData.length >= 0.8 && anomalias === 0 ? "MENSAL" : "IRREGULAR";

    // Validação cruzada: numa sequência mensal coerente (≥ 3 parcelas, sem
    // anomalias), o número de cada parcela é confirmado pelo seu vencimento
    // (já confiável) e pelo total. Isso reforça a confiança do número LIDO —
    // nunca cria um número que não foi lido.
    if (periodicidade === "MENSAL" && comData.length >= 3 && vezes === comData.length) {
      const repetidas = new Set(duplicadas);
      parcelas = parcelas.map((p) => {
        if (p.numero.valor == null || repetidas.has(p.numero.valor) || p.vencimento.confianca < 0.9 || (totalInformado != null && p.total.valor !== totalInformado)) return p;
        const piso = arredondar(1 - (1 - p.numero.confianca) * 0.4);
        if (piso <= p.numero.confianca) return p;
        const numero = ajustar(p.numero, { piso, motivo: "coerente_com_sequencia_mensal" });
        const confianca = confiancaDaParcela([numero, p.vencimento, p.valorCentavos]);
        return { ...p, numero, confianca, nivel: nivelDaConfianca(confianca) };
      });
    }
  }

  // Valores: predominante e destoantes (nunca "corrigidos")
  const valores = parcelas.map((p) => p.valorCentavos.valor).filter((v): v is number => v != null);
  const { valor: predominante, vezes: vezesValor } = moda(valores);
  const temPredominante = predominante != null && vezesValor >= 2 && vezesValor / valores.length >= 0.5;
  if (temPredominante) {
    for (const p of parcelas) {
      const v = p.valorCentavos.valor;
      if (v == null || v === predominante) continue;
      const razao = v / predominante!;
      const escala = [10, 100, 0.1, 0.01].some((r) => Math.abs(razao - r) / r < 0.001);
      add({ codigo: "VALUE_OUTLIER", severidade: "ALERTA", parcela: p.numero.valor, item: p.id, pagina: p.pagina, campo: "valorCentavos", mensagem: `Parcela ${p.numero.valor ?? "?"}: valor ${formatarCentavos(v)} diferente do predominante ${formatarCentavos(predominante)}${escala ? " — possível erro de leitura da vírgula" : ""}.`, detalhes: { lidoCentavos: v, predominanteCentavos: predominante, possivelErroDeEscala: escala } }, p.id);
      parcelas = parcelas.map((x) => (x.id === p.id ? penalizar(x, "valorCentavos", "valor_destoante") : x));
    }
  }

  const ordenadas = [...comData].sort((a, b) => a.numero.valor! - b.numero.valor!);
  const resumo: ResumoCarne = {
    totalInformado: totalInformado ?? null,
    encontradas: parcelas.length,
    faixa: { primeira: unicos[0] ?? null, ultima: unicos[unicos.length - 1] ?? null },
    primeiroVencimento: ordenadas[0]?.vencimento.valor ?? null,
    ultimoVencimento: ordenadas[ordenadas.length - 1]?.vencimento.valor ?? null,
    valorPredominanteCentavos: temPredominante ? predominante : null,
    valorTotalCentavos: valores.reduce((s, v) => s + v, 0),
    periodicidade,
    ausentes,
    duplicadas: [...new Set(duplicadas)],
  };
  return { parcelas, resumo, alertas };
}

/** Documento × cliente selecionada (CPF bloqueia; nome alerta). */
export function validarContraCliente(cpfDocumento: string | null, nomeDocumento: string | null, cliente: ClienteReferencia | null | undefined): Alerta[] {
  if (!cliente) return [];
  const alertas: Alerta[] = [];
  const cpfCliente = normalizarCpf(cliente.cpf);
  const cpfDoc = normalizarCpf(cpfDocumento);
  if (cpfDoc && cpfCliente && cpfValido(cpfDoc) && cpfDoc !== cpfCliente) {
    alertas.push({ codigo: "CLIENT_CPF_MISMATCH", severidade: "ERRO", campo: "cpf", mensagem: "CPF do documento não corresponde à cliente selecionada." });
  }
  if (nomeDocumento && cliente.nome) {
    const s = similaridadeNomes(nomeDocumento, cliente.nome);
    if (s < 0.85) alertas.push({ codigo: "CLIENT_NAME_MISMATCH", severidade: "ALERTA", campo: "nomeCliente", mensagem: "O nome no documento não confere com o cadastro da cliente.", detalhes: { similaridade: Math.round(s * 100) / 100 } });
  }
  return alertas;
}
