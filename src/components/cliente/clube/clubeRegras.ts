import type { ClubeBeneficio, ClubeIndicacao, ClubePontosEvento, ClubeRecompensa, ClubeResgate } from "@/lib/clube";

/** Prêmio mais barato que a cliente ainda não alcança (meta visível no topo). */
export function proximoPremio(recompensas: ClubeRecompensa[], saldo: number) {
  const disponiveis = recompensas.filter((r) => r.estoque === null || r.estoque > 0).sort((a, b) => a.pontos - b.pontos);
  const alvo = disponiveis.find((r) => r.pontos > saldo) ?? null;
  if (!alvo) return { alvo: null, faltam: 0, progresso: disponiveis.length ? 100 : 0 };
  return { alvo, faltam: alvo.pontos - saldo, progresso: Math.max(0, Math.min(100, Math.round((saldo / alvo.pontos) * 100))) };
}

/** Texto do extrato a partir do motivo real registrado no crédito. */
export function descreverEvento(evento: ClubePontosEvento) {
  const motivo = String(evento.metadata?.motivo ?? "");
  if (motivo === "primeira_parcela") return "Missão: 1ª parcela paga";
  if (motivo === "parcela_em_dia") return `Parcela ${evento.metadata?.numero_parcela ?? ""} paga em dia`.replace("  ", " ");
  if (motivo === "indicacao_venda") return `Indicação: ${String(evento.metadata?.nome_indicado ?? "amiga")} fechou`;
  if (evento.tipo === "resgate") return `Resgate: ${String(evento.metadata?.titulo ?? "prêmio")}`;
  if (evento.tipo === "indicacao") return "Indicação confirmada";
  if (evento.tipo === "ajuste") return "Ajuste da equipe";
  return "Bônus";
}

export type EtapaIndicacao = { rotulo: string; detalhe: string; tom: "neutro" | "andamento" | "sucesso" | "encerrada"; passo: number };

/** Linha do tempo da indicação: 0 enviada · 1 em conversa · 2 fechou · 3 pontos creditados. */
export function etapaIndicacao(indicacao: ClubeIndicacao, pontosPorIndicacao: number): EtapaIndicacao {
  if (indicacao.status === "invalidada") return { rotulo: "Não fechou", detalhe: "Obrigada por indicar! Continue indicando.", tom: "encerrada", passo: -1 };
  if (indicacao.status === "venda" && indicacao.pontos_creditados > 0) return { rotulo: `+${indicacao.pontos_creditados} pontos`, detalhe: "Ela fechou e pagou a 1ª parcela.", tom: "sucesso", passo: 3 };
  if (indicacao.status === "venda") return { rotulo: "Fechou contrato", detalhe: `Os ${pontosPorIndicacao} pontos entram quando ela pagar a 1ª parcela.`, tom: "andamento", passo: 2 };
  if (indicacao.status === "qualificada") return { rotulo: "Em conversa", detalhe: "Nossa equipe já está conversando com ela.", tom: "andamento", passo: 1 };
  return { rotulo: "Enviada", detalhe: "Nossa equipe vai entrar em contato.", tom: "neutro", passo: 0 };
}

export type EstadoVoucher = "bloqueado" | "liberado" | "solicitado" | "pronto" | "utilizado";

export function estadoVoucher(voucher: ClubeBeneficio | null): EstadoVoucher {
  if (!voucher || voucher.status === "cancelado") return "bloqueado";
  if (voucher.status === "utilizado") return "utilizado";
  if (voucher.arquivo_disponivel) return "pronto";
  if (voucher.solicitado_em) return "solicitado";
  return "liberado";
}

export function rotuloResgate(status: ClubeResgate["status"]) {
  return { solicitado: "Solicitado", aprovado: "Aprovado", separacao: "Em separação", entregue: "Entregue", cancelado: "Cancelado" }[status] ?? status;
}

/** Máscara do WhatsApp brasileiro: (61) 99999-0000. */
export function mascaraTelefone(valor: string) {
  const d = valor.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Link do WhatsApp com convite pronto para a amiga indicada. */
export function linkConviteWhatsApp(nomeAmiga: string, telefone: string, nomeCliente?: string) {
  const d = telefone.replace(/\D/g, "");
  const numero = d.length <= 11 ? `55${d}` : d;
  const primeiro = nomeAmiga.trim().split(/\s+/)[0] ?? "";
  const quem = nomeCliente ? `, aqui é a ${nomeCliente.trim().split(/\s+/)[0]}` : "";
  const texto = `Oi, ${primeiro}${quem}! 💕 Estou realizando meu sonho com a Sra. Luck — cirurgia programada, com parcelas que cabem no bolso. Indiquei você e a equipe vai te chamar para explicar tudo, sem compromisso.`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}
