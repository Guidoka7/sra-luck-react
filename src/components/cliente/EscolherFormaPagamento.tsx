"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarCheck, Check, CreditCard, FileSignature, QrCode, Receipt, X, type LucideIcon } from "lucide-react";
import { AgendaBloqueadaShell } from "@/components/cliente/AgendaBloqueadaShell";
import { AgendaEtapasInterativas } from "@/components/cliente/AgendaEtapasInterativas";
import { type DataDisponivel } from "@/components/cliente/CalendarioAgendamento";
import type { AgendaData } from "@/lib/clienteAgenda";

type FormaCusteio = "cartao" | "pix" | "cheques" | "boleto_100";

type Financeiro = {
  saldoRestante: number | null;
  taxaCartao: number | null;
  totalComTaxa: number | null;
  formasCusteio: string[];
};

type Solicitacao = {
  id: string;
  forma_custeio: FormaCusteio;
  status: string;
  observacao: string | null;
};

type Props = {
  datas: DataDisponivel[];
  onSelecionada?: () => void | Promise<void>;
  /** Dados já carregados pela página: renderiza na hora, sem nova consulta. */
  snapshot?: AgendaData | null;
  parcelasNaoPagas?: number | null;
  /** Incrementado por fora (ex.: CTA da aba Agenda) para abrir a escolha. */
  abrirSinal?: number;
};

function financeiroDe(dados: { financeiro?: { saldoRestante?: number | null; taxaCartao?: number | null; totalComTaxa?: number | null; formasCusteio?: string[] } | null } | null | undefined): Financeiro {
  const f = dados?.financeiro;
  return { saldoRestante: f?.saldoRestante ?? null, taxaCartao: f?.taxaCartao ?? null, totalComTaxa: f?.totalComTaxa ?? null, formasCusteio: f?.formasCusteio ?? [] };
}

function moeda(valor: number) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const OPCOES: Record<FormaCusteio, { titulo: string; detalhe: string; Icone: LucideIcon }> = {
  pix: { titulo: "PIX", detalhe: "Sem taxa adicional", Icone: QrCode },
  cartao: { titulo: "Cartão de crédito", detalhe: "Com taxa da maquininha", Icone: CreditCard },
  cheques: { titulo: "Cheques", detalhe: "Conforme autorização do financeiro", Icone: FileSignature },
  boleto_100: { titulo: "100% boleto", detalhe: "Conforme condições liberadas", Icone: Receipt },
};

export function EscolherFormaPagamento({ datas, onSelecionada, snapshot = null, parcelasNaoPagas = null, abrirSinal = 0 }: Props) {
  const [financeiro, setFinanceiro] = useState<Financeiro>(() => financeiroDe(snapshot));
  const [solicitacao, setSolicitacao] = useState<Solicitacao | null>(() => (snapshot?.solicitacaoLiberacaoFinanceira as Solicitacao | null) ?? null);
  const [parcelasRestantes, setParcelasRestantes] = useState<number | null>(parcelasNaoPagas);
  const [carregando, setCarregando] = useState(!snapshot);
  const [modal, setModal] = useState(false);
  const [forma, setForma] = useState<FormaCusteio | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    try {
      const [agendaRes, boletosRes] = await Promise.all([
        fetch("/api/cliente/agenda", { cache: "no-store" }),
        fetch("/api/cliente/boletos", { cache: "no-store" }),
      ]);
      if (agendaRes.ok) {
        const dados = await agendaRes.json();
        setFinanceiro(dados.financeiro ?? { saldoRestante: null, taxaCartao: null, totalComTaxa: null, formasCusteio: [] });
        setSolicitacao(dados.solicitacaoLiberacaoFinanceira ?? null);
      }
      if (boletosRes.ok) {
        const dados = await boletosRes.json();
        setParcelasRestantes(typeof dados.parcelas_nao_pagas === "number" ? dados.parcelas_nao_pagas : null);
      }
    } catch {
      // O polling principal da área da cliente continua responsável pela recuperação da tela.
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    if (snapshot) {
      setFinanceiro(financeiroDe(snapshot));
      setSolicitacao((snapshot.solicitacaoLiberacaoFinanceira as Solicitacao | null) ?? null);
      setParcelasRestantes(parcelasNaoPagas);
      setCarregando(false);
      return;
    }
    void carregar();
  }, [snapshot, parcelasNaoPagas]);

  const formas = useMemo(
    () => (["pix", "cartao", "cheques", "boleto_100"] as FormaCusteio[]).filter((item) => financeiro.formasCusteio.includes(item)),
    [financeiro.formasCusteio],
  );

  const status = String(solicitacao?.status ?? "").toLowerCase();
  const recusada = status.includes("recus");
  const jaEscolheu = Boolean(solicitacao) && !recusada;

  useEffect(() => {
    if (jaEscolheu) void onSelecionada?.();
  }, [jaEscolheu, onSelecionada]);

  useEffect(() => {
    if (abrirSinal > 0) abrirModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirSinal]);

  function abrirModal() {
    setErro(null);
    setForma(solicitacao?.forma_custeio ?? null);
    setModal(true);
  }

  async function enviar() {
    if (!forma) return;
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await fetch("/api/cliente/solicitacao-liberacao-financeira", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formaCusteio: forma }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.erro ?? "Não foi possível registrar sua escolha.");
      setSolicitacao(dados.solicitacao ?? null);
      setModal(false);
      await onSelecionada?.();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível registrar sua escolha.");
    } finally {
      setEnviando(false);
    }
  }

  if (carregando || jaEscolheu) return null;

  const saldo = Number(financeiro.saldoRestante ?? 0);
  const totalCartao = financeiro.totalComTaxa ?? (financeiro.taxaCartao ? saldo * (1 + financeiro.taxaCartao / 100) : saldo);

  return (
    <>
      <AgendaBloqueadaShell
        datas={datas}
        etapa={3}
        resumo="Escolha a forma de pagamento do saldo restante para liberar a próxima etapa."
      >
        <AgendaEtapasInterativas atual="pagamento" onPagamentoClick={abrirModal} />
      </AgendaBloqueadaShell>

      {typeof document !== "undefined" ? createPortal(
        <AnimatePresence>
          {modal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={(event) => {
                if (event.target === event.currentTarget && !enviando) setModal(false);
              }}
              className="fixed inset-0 z-[100] flex items-end justify-center bg-[rgba(38,23,25,.42)] sm:items-center sm:p-4"
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label="Forma de pagamento do saldo restante"
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", stiffness: 420, damping: 40 }}
                className="max-h-[92dvh] w-full max-w-[430px] overflow-y-auto overscroll-contain rounded-t-[26px] bg-white px-5 pb-[calc(max(env(safe-area-inset-bottom),0px)+18px)] pt-3 shadow-[0_-18px_50px_rgba(46,36,34,.18)] sm:rounded-[26px]"
              >
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#E3D7D3]" />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[#B65B67]">Etapa 3 de 4</div>
                    <h2 className="m-0 pt-1 font-heading text-[25px] font-semibold leading-[1.1] text-[#2E2422]">Como vai quitar o saldo?</h2>
                  </div>
                  <button type="button" aria-label="Fechar" onClick={() => !enviando && setModal(false)} className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[#F6EFED] text-[#7D2434]"><X className="h-4 w-4" /></button>
                </div>

                <div className="relative mt-4 overflow-hidden rounded-[20px] bg-[linear-gradient(135deg,#7D2434_0%,#5A1825_100%)] px-5 py-[18px] text-white shadow-[0_14px_30px_rgba(107,31,46,.28)]">
                  <span className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/[.07]" aria-hidden="true" />
                  <span className="pointer-events-none absolute -bottom-14 right-10 h-28 w-28 rounded-full bg-[#E8D39E]/[.12]" aria-hidden="true" />
                  <div className="relative text-[11px] font-medium uppercase tracking-[.14em] text-white/70">Saldo a quitar</div>
                  <div className="relative pt-1 font-heading text-[34px] font-semibold leading-none">{moeda(saldo)}</div>
                  <div className="relative mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-white/85">
                    {parcelasRestantes != null && <span className="rounded-full bg-white/[.14] px-[10px] py-[3px]">{parcelasRestantes} {parcelasRestantes === 1 ? "parcela restante" : "parcelas restantes"}</span>}
                    <span className="inline-flex items-center gap-1"><CalendarCheck className="h-[14px] w-[14px]" /> quitação na assinatura dos termos</span>
                  </div>
                </div>

                <div className="mt-5 text-[11px] font-semibold uppercase tracking-[.12em] text-[#9A8C88]">Formas liberadas para você</div>
                <div role="radiogroup" aria-label="Formas de pagamento" className="mt-2 grid grid-cols-2 gap-[10px]">
                  {formas.map((item) => {
                    const { Icone, titulo, detalhe } = OPCOES[item];
                    const ativa = forma === item;
                    return (
                      <button
                        key={item}
                        type="button"
                        role="radio"
                        aria-checked={ativa}
                        onClick={() => setForma(item)}
                        className={`relative flex flex-col items-start gap-[10px] rounded-[18px] border p-[13px] text-left transition-[border-color,background-color,box-shadow] duration-150 ${ativa ? "border-[#7D2434] bg-[#FBF3F1] shadow-[0_0_0_1px_#7D2434]" : "border-[#EADFDB] bg-white"}`}
                      >
                        <span className={`flex h-9 w-9 items-center justify-center rounded-[11px] ${ativa ? "bg-[#7D2434] text-white" : "bg-[#F6EFED] text-[#7D2434]"}`}>
                          <Icone className="h-5 w-5" strokeWidth={1.7} />
                        </span>
                        <span className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border ${ativa ? "border-[#7D2434] bg-[#7D2434] text-white" : "border-[#DCCDC9] bg-white"}`} aria-hidden="true">
                          {ativa && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                        <span>
                          <span className="block text-[14px] font-semibold leading-[1.25] text-[#2E2422]">{titulo}</span>
                          <span className="block pt-[2px] text-[12px] leading-[1.35] text-[#8A7B77]">{detalhe}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {formas.length === 0 && (
                  <div className="mt-2 rounded-[14px] border border-[#F0D3D1] bg-[#FBEBEA] px-4 py-3 text-[13px] text-[#8F2A25]">
                    Nenhuma forma de pagamento foi liberada pelo financeiro para este contrato. Fale com a nossa equipe.
                  </div>
                )}

                <AnimatePresence initial={false}>
                  {forma === "cartao" && saldo > 0 && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <div className="mt-3 flex items-center justify-between gap-3 rounded-[14px] bg-[#FBF4E7] px-4 py-3 text-[12.5px] text-[#6D5530]">
                        <span>Total estimado no cartão</span>
                        <strong className="font-semibold text-[#6B1F2E]">{moeda(totalCartao)}</strong>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {erro && <div role="alert" className="mt-3 rounded-[12px] border border-[#F0D3D1] bg-[#FBEBEA] px-4 py-3 text-[12.5px] text-[#8F2A25]">{erro}</div>}
                <button type="button" disabled={!forma || enviando || formas.length === 0} onClick={() => void enviar()} className="mt-5 w-full rounded-[14px] bg-[#6B1F2E] px-4 py-[15px] text-[14.5px] font-semibold text-white shadow-[0_10px_22px_rgba(107,31,46,.22)] disabled:opacity-40 disabled:shadow-none">
                  {enviando ? "Confirmando…" : forma ? `Confirmar ${forma === "pix" ? "PIX" : OPCOES[forma].titulo.toLowerCase()}` : "Escolha uma forma"}
                </button>
                <p className="m-0 pt-3 text-center text-[12px] leading-[1.45] text-[#9A8C88]">Depois disso, você já escolhe a data da assinatura dos termos.</p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      ) : null}
    </>
  );
}
