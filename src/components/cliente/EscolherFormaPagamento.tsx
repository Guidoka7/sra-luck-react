"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarCheck2, Clock3, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";

type FormaCusteio = "cartao" | "pix" | "cheques" | "boleto_100";
interface Financeiro { saldoRestante: number | null; formasCusteio: string[]; }
interface Solicitacao { id: string; forma_custeio: FormaCusteio; status: string; observacao: string | null; }

function formatarMoeda(valor: number) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function EscolherFormaPagamento() {
  const [financeiro, setFinanceiro] = useState<Financeiro>({ saldoRestante: null, formasCusteio: [] });
  const [solicitacao, setSolicitacao] = useState<Solicitacao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [modalAberto, setModalAberto] = useState(false);
  const [formaCusteio, setFormaCusteio] = useState<FormaCusteio | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    try {
      const res = await fetch("/api/cliente/agenda", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setFinanceiro(data.financeiro ?? { saldoRestante: null, formasCusteio: [] });
      setSolicitacao(data.solicitacaoLiberacaoFinanceira ?? null);
    } catch { /* mantém o último estado conhecido */ }
    finally { setCarregando(false); }
  }

  useEffect(() => {
    void carregar();
    const intervalo = setInterval(() => void carregar(), 5000);
    return () => clearInterval(intervalo);
  }, []);

  const formasDisponiveis = useMemo(
    () => (["cartao", "pix", "cheques", "boleto_100"] as FormaCusteio[]).filter((f) => financeiro.formasCusteio.includes(f)),
    [financeiro.formasCusteio],
  );
  const status = String(solicitacao?.status ?? "").toLowerCase();
  const recusada = status.includes("recus");
  const emAnalise = Boolean(solicitacao) && !recusada;

  function abrirModal() {
    setErro(null);
    setFormaCusteio(solicitacao?.forma_custeio ?? null);
    setModalAberto(true);
  }

  async function enviarCusteio() {
    if (!formaCusteio) return;
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cliente/solicitacao-liberacao-financeira", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formaCusteio }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? "Não foi possível enviar sua solicitação.");
      setSolicitacao(data.solicitacao ?? null);
      setModalAberto(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar sua solicitação.");
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) return null;

  if (emAnalise) {
    return (
      <section className="overflow-hidden rounded-2xl border border-gold/20 bg-gold/[0.055] shadow-[0_14px_40px_-28px_rgba(0,0,0,.25)]">
        <div className="flex items-start gap-3 p-3.5 sm:p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold">
            <Clock3 className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.58rem] font-bold uppercase tracking-[0.16em] text-gold">Forma de pagamento em análise</p>
            <h2 className="mt-1 font-heading text-sm font-semibold leading-tight text-burgundy">Recebemos sua escolha de pagamento</h2>
            <p className="mt-1.5 text-[0.72rem] leading-relaxed text-clay/65">
              {solicitacao?.observacao ?? "Nossa equipe está confirmando a forma de pagamento escolhida por você."} Assim que confirmarmos, sua agenda será liberada para você escolher o dia e o horário da assinatura dos termos.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-rose/15 bg-white/80 text-clay shadow-[0_14px_40px_-28px_rgba(0,0,0,.35)] dark:border-white/10 dark:bg-[#151719] dark:text-[#EBE8E9]">
        <div className="border-b border-rose/10 bg-blush/25 px-3 py-3 sm:px-4 dark:border-white/8 dark:bg-white/[0.025]">
          <div className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose/10 text-rose">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.55rem] font-bold uppercase tracking-[0.14em] text-rose">Minha agenda</p>
              <h3 className="mt-0.5 font-heading text-sm font-semibold leading-tight text-burgundy dark:!text-[#F7F3F4]">Levantamento financeiro concluído</h3>
              <p className="mt-0.5 text-[0.62rem] leading-[1.4] text-clay/75 dark:!text-[#D9D5D6]">
                {recusada
                  ? "Sua forma de pagamento anterior precisou de ajuste. Escolha novamente como deseja quitar o saldo restante."
                  : "Para liberar a escolha do dia da assinatura, informe como você vai pagar o saldo restante do seu contrato."}
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {recusada && (
            <div className="mb-3 rounded-xl border border-alert/15 bg-alert/8 px-3 py-2.5 text-[0.68rem] leading-relaxed text-alert">
              Sua escolha anterior não pôde ser confirmada. Selecione novamente uma forma de pagamento.
            </div>
          )}
          <div className="rounded-xl border border-gold/20 bg-gold/[0.06] p-4 text-center dark:border-gold/25 dark:bg-gold/[0.05]">
            <p className="text-[0.55rem] font-bold uppercase tracking-label text-gold">Saldo restante do contrato</p>
            <p className="mt-1 text-2xl font-bold text-burgundy dark:text-cream">{formatarMoeda(Number(financeiro.saldoRestante ?? 0))}</p>
            <p className="mt-1 text-[0.62rem] leading-relaxed text-clay/60 dark:text-white/60">Valor a ser quitado no dia da assinatura dos termos cirúrgicos.</p>
          </div>
          <button
            type="button"
            onClick={abrirModal}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-burgundy px-4 py-3 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-cream transition hover:bg-burgundy-dark"
          >
            <CalendarCheck2 className="h-4 w-4" /> Solicitar liberação da agenda dos termos cirúrgicos
          </button>
        </div>
      </section>

      <AnimatePresence>
        {modalAberto && (
          <motion.div
            className="fixed inset-0 z-[80] grid h-[100dvh] w-full grid-rows-[minmax(0,1fr)] overflow-hidden bg-black/55 p-3 backdrop-blur-sm sm:p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onMouseDown={(event) => { if (event.target === event.currentTarget && !enviando) setModalAberto(false); }}
          >
            <motion.div
              role="dialog" aria-modal="true"
              initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
              className="mx-auto my-auto w-full max-w-md max-h-full overflow-y-auto overscroll-contain rounded-2xl border border-rose/15 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-clay shadow-2xl [-webkit-overflow-scrolling:touch] dark:border-white/10 dark:bg-[#171618] dark:text-white sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.6rem] font-semibold uppercase tracking-label text-rose">Custeio do valor restante</p>
                  <h2 className="mt-1 font-heading text-base font-semibold text-burgundy dark:text-cream">Informe como será realizado o pagamento</h2>
                </div>
                <button type="button" onClick={() => !enviando && setModalAberto(false)} className="rounded-full p-1.5 text-clay/50 hover:bg-blush dark:text-white/50 dark:hover:bg-white/10">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 rounded-xl border border-gold/20 bg-gold/[0.06] p-3 dark:border-gold/25 dark:bg-gold/[0.05]">
                <p className="text-[0.55rem] font-semibold uppercase tracking-label text-gold">Valor a pagar no dia da assinatura dos termos</p>
                <p className="mt-1 text-lg font-bold text-burgundy dark:text-cream">{formatarMoeda(Number(financeiro.saldoRestante ?? 0))}</p>
              </div>

              <div className="mt-3 grid gap-2">
                {formasDisponiveis.map((forma) => {
                  const titulo = forma === "cartao" ? "Cartão de crédito" : forma === "pix" ? "PIX" : forma === "cheques" ? "Cheques" : "100% boleto";
                  const descricao = forma === "cartao" ? "taxa configurada no contrato" : forma === "pix" ? "sem taxa adicional" : "análise de até 5 dias úteis";
                  return (
                    <button
                      key={forma} type="button" onClick={() => setFormaCusteio(forma)}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                        formaCusteio === forma ? "border-burgundy bg-burgundy text-cream" : "border-rose/15 bg-white text-clay/70 hover:border-rose dark:border-white/10 dark:bg-white/[0.035] dark:text-white/75",
                      )}
                    >
                      <span><span className="block text-[0.72rem] font-semibold">{titulo}</span><span className="block text-[0.6rem] opacity-60">{descricao}</span></span>
                      <span className={cn("h-3.5 w-3.5 rounded-full border", formaCusteio === forma ? "border-cream bg-cream" : "border-clay/25 dark:border-white/30")} />
                    </button>
                  );
                })}
              </div>
              {formasDisponiveis.length === 0 && <p className="mt-3 rounded-xl bg-alert/10 p-3 text-xs text-alert">Nenhuma forma de custeio está disponível para este contrato no momento.</p>}
              {erro && <p className="mt-3 rounded-xl bg-alert/10 p-3 text-xs text-alert">{erro}</p>}
              <button
                type="button" onClick={() => void enviarCusteio()} disabled={!formaCusteio || enviando || formasDisponiveis.length === 0}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-burgundy px-4 py-3 text-[0.66rem] font-bold uppercase tracking-[0.12em] text-cream transition hover:bg-burgundy-dark disabled:cursor-not-allowed disabled:opacity-45"
              >
                {enviando ? "Enviando..." : "Confirmar forma de pagamento"}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
