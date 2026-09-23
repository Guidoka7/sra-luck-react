import type { PaginaLida } from "./carne-leitura";

/**
 * Planejamento do vínculo "folha do carnê → parcela da cliente", olhando o
 * carnê INTEIRO de uma vez (atribuição um-para-um), não folha por folha.
 *
 * Regras (BUSINESS-RULES §6 — carnês):
 * - Folha só é anexada automaticamente com evidência forte e sem ambiguidade:
 *   identificador já cadastrado na parcela, ou valor + vencimento conferindo
 *   com UMA única parcela livre, lidos de uma linha digitável com DVs válidos
 *   (ou do texto nativo do PDF, quando valor e data batem exatamente).
 * - Carnês parciais são naturais: parcelas que já têm boleto saem da disputa,
 *   então um carnê de 60x e depois outro de 12x caem nas parcelas certas pelo
 *   vencimento, mesmo que o segundo venha impresso como "1/12".
 * - Posição da folha no PDF nunca decide sozinha.
 * - CPF impresso diferente do da cliente, mais de um boleto na folha, boleto
 *   repetido no arquivo ou folha ilegível => revisão humana.
 * - Indícios mais fracos (só o mês, valor diferente, sequência do carnê,
 *   número da parcela) viram SUGESTÃO para a equipe confirmar.
 */

export interface ParcelaAlvo {
  id: string;
  numero_parcela: number;
  valor: number;
  data_vencimento: string | null;
  identificador_externo: string | null;
  temBoleto: boolean;
}

export type AcaoFolha = "anexar" | "sugerir" | "revisar";

export interface DecisaoFolha {
  pagina: number;
  boletoId: string | null;
  acao: AcaoFolha;
  nivel: "alta" | "media" | "baixa";
  pontuacao: number;
  motivos: string[];
}

function normalizar(valor: string | null | undefined) {
  const v = String(valor ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return v || null;
}

function mes(iso: string | null) {
  return iso ? iso.slice(0, 7) : null;
}

function mesesEntre(de: string, ate: string) {
  const [a1, m1] = de.split("-").map(Number);
  const [a2, m2] = ate.split("-").map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
}

function mesmoValor(a: number | null, b: number | null) {
  return a != null && b != null && Math.abs(a - b) < 0.01;
}

type Nivel = {
  chave: string;
  combina: (f: PaginaLida, p: ParcelaAlvo) => boolean;
  /** Pode anexar sem confirmação quando a folha tem leitura confiável. */
  forte: boolean;
  pontos: number;
};

const NIVEIS: Nivel[] = [
  { chave: "valor_e_vencimento_conferem", forte: true, pontos: 95, combina: (f, p) => Boolean(f.vencimento && f.vencimento === p.data_vencimento) && mesmoValor(f.valor, p.valor) },
  { chave: "valor_e_mes_do_vencimento_conferem", forte: true, pontos: 85, combina: (f, p) => Boolean(f.vencimento && mes(f.vencimento) === mes(p.data_vencimento)) && mesmoValor(f.valor, p.valor) },
  { chave: "vencimento_confere_valor_diverge", forte: false, pontos: 60, combina: (f, p) => Boolean(f.vencimento && f.vencimento === p.data_vencimento) },
  { chave: "mes_do_vencimento_confere", forte: false, pontos: 50, combina: (f, p) => Boolean(f.vencimento && mes(f.vencimento) === mes(p.data_vencimento)) },
  { chave: "numero_da_parcela_e_valor_conferem", forte: false, pontos: 45, combina: (f, p) => f.numeroParcela != null && f.numeroParcela === p.numero_parcela && mesmoValor(f.valor, p.valor) },
];

/** Folha lida de forma confiável o bastante para anexar sem confirmação. */
function leituraConfiavel(f: PaginaLida) {
  return f.linhaValidada || f.fonte === "texto";
}

export function planejarVinculos(folhas: PaginaLida[], parcelas: ParcelaAlvo[], cpfCliente: string | null): DecisaoFolha[] {
  const cpf = String(cpfCliente ?? "").replace(/\D/g, "");
  const decisoes = new Map<number, DecisaoFolha>();
  const parcelaUsada = new Set<string>();
  const revisar = (f: PaginaLida, motivo: string) => decisoes.set(f.pagina, { pagina: f.pagina, boletoId: null, acao: "revisar", nivel: "baixa", pontuacao: 0, motivos: [motivo, ...f.observacoes] });

  // 1) Bloqueios: nada disso pode ser anexado sem um humano olhar.
  const linhasVistas = new Set<string>();
  for (const f of folhas) {
    if (f.boletosNaPagina > 1) { revisar(f, "mais_de_um_boleto_na_folha"); continue; }
    if (cpf && f.cpfs.length > 0 && !f.cpfs.includes(cpf)) { revisar(f, "cpf_da_folha_diverge_da_cliente"); continue; }
    if (!f.linhaDigitavel && f.valor == null && !f.vencimento && f.numeroParcela == null && !f.nossoNumero && !f.numeroDocumento) { revisar(f, "folha_sem_dados_legiveis"); continue; }
    if (f.codigoBarras) {
      if (linhasVistas.has(f.codigoBarras)) { revisar(f, "boleto_repetido_no_arquivo"); continue; }
      linhasVistas.add(f.codigoBarras);
    }
  }
  const pendentes = () => folhas.filter((f) => !decisoes.has(f.pagina));
  const decidir = (f: PaginaLida, p: ParcelaAlvo, motivo: string, forte: boolean, pontos: number) => {
    parcelaUsada.add(p.id);
    const motivos = [motivo, ...f.observacoes];
    if (p.temBoleto) {
      decisoes.set(f.pagina, { pagina: f.pagina, boletoId: p.id, acao: "sugerir", nivel: "media", pontuacao: pontos, motivos: [...motivos, "parcela_ja_tem_boleto_confirme_a_substituicao"] });
    } else if (forte && leituraConfiavel(f)) {
      decisoes.set(f.pagina, { pagina: f.pagina, boletoId: p.id, acao: "anexar", nivel: "alta", pontuacao: pontos, motivos });
    } else {
      decisoes.set(f.pagina, { pagina: f.pagina, boletoId: p.id, acao: "sugerir", nivel: pontos >= 60 ? "media" : "baixa", pontuacao: pontos, motivos: forte ? [...motivos, "leitura_sem_linha_digitavel_validada"] : motivos });
    }
  };

  // 2) Identificador já cadastrado na parcela (linha, código, nosso número, documento).
  for (const f of pendentes()) {
    const ids = [f.linhaDigitavel, f.codigoBarras, f.nossoNumero, f.numeroDocumento].map(normalizar).filter(Boolean);
    const alvos = parcelas.filter((p) => !parcelaUsada.has(p.id) && ids.includes(normalizar(p.identificador_externo)));
    if (alvos.length === 1) decidir(f, alvos[0], "identificador_da_parcela_confere", true, 100);
  }

  // 3) Atribuição por níveis de evidência, só quando o par é único nos dois
  //    sentidos. Parcelas livres (sem boleto) têm prioridade; depois, parcelas
  //    que já têm boleto entram apenas como sugestão de substituição.
  for (const incluirComBoleto of [false, true]) {
    for (const nivel of NIVEIS) {
      let progresso = true;
      while (progresso) {
        progresso = false;
        const livres = parcelas.filter((p) => !parcelaUsada.has(p.id) && (incluirComBoleto || !p.temBoleto));
        const abertas = pendentes();
        for (const f of abertas) {
          const candidatas = livres.filter((p) => nivel.combina(f, p));
          if (candidatas.length !== 1) continue;
          const alvo = candidatas[0];
          const concorrentes = abertas.filter((outra) => nivel.combina(outra, alvo));
          if (concorrentes.length !== 1) continue;
          decidir(f, alvo, nivel.chave, nivel.forte, nivel.pontos);
          progresso = true;
          break;
        }
      }
    }
  }

  // 4) Sequência do carnê: folhas mensais restantes, ancoradas numa folha já
  //    decidida, sugerem a parcela na mesma distância em meses.
  const ancoras = [...decisoes.values()].filter((d) => d.boletoId && (d.acao === "anexar" || d.acao === "sugerir"));
  if (ancoras.length > 0) {
    const ancora = ancoras[0];
    const folhaAncora = folhas.find((f) => f.pagina === ancora.pagina);
    const parcelaAncora = parcelas.find((p) => p.id === ancora.boletoId);
    if (folhaAncora?.vencimento && parcelaAncora) {
      for (const f of pendentes()) {
        if (!f.vencimento) continue;
        const numero = parcelaAncora.numero_parcela + mesesEntre(folhaAncora.vencimento, f.vencimento);
        const alvo = parcelas.find((p) => p.numero_parcela === numero && !parcelaUsada.has(p.id));
        if (alvo) decidir(f, alvo, "sequencia_mensal_do_carne", false, 40);
      }
    }
  }

  for (const f of pendentes()) {
    revisar(f, parcelas.every((p) => parcelaUsada.has(p.id)) ? "nenhuma_parcela_livre_para_esta_folha" : "nenhuma_parcela_confere_com_seguranca");
  }
  return folhas.map((f) => decisoes.get(f.pagina)!);
}
