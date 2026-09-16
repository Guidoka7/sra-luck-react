"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AgendaEtapasInterativas } from "@/components/cliente/AgendaEtapasInterativas";
import { CalendarioAgendamento, type DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

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
};

function moeda(valor: number) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function label(forma: FormaCusteio) {
  if (forma === "cartao") return "Cartão de crédito";
  if (forma === "pix") return "PIX";
  if (forma === "cheques") return "Cheques";
  return "100% boleto";
}

function extra(forma: FormaCusteio, taxaCartao: number | null) {
  if (forma === "cartao") return taxaCartao ? `taxa de ${taxaCartao}%` : "taxa conforme contrato";
  if (forma === "pix") return "sem taxa adicional";
  if (forma === "cheques") return "conforme autorização do financeiro";
  return "conforme condições liberadas";
}

export function EscolherFormaPagamento({ datas, onSelecionada }: Props) {
  const [financeiro, setFinanceiro] = useState<Financeiro>({ saldoRestante: null, taxaCartao: null, totalComTaxa: null, formasCusteio: [] });
  const [solicitacao, setSolicitacao] = useState<Solicitacao | null>(null);
  const [parcelasRestantes, setParcelasRestantes] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(true);
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
    void carregar();
  }, []);

  const formas = useMemo(
    () => (["cartao", "pix", "cheques", "boleto_100"] as FormaCusteio[]).filter((item) => financeiro.formasCusteio.includes(item)),
    [financeiro.formasCusteio],
  );

  const status = String(solicitacao?.status ?? "").toLowerCase();
  const recusada = status.includes("recus");
  const jaEscolheu = Boolean(solicitacao) && !recusada;

  useEffect(() => {
    if (jaEscolheu) void onSelecionada?.();
  }, [jaEscolheu, onSelecionada]);

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
  const parcelasTexto = parcelasRestantes == null
    ? "Este é o saldo que ainda resta no seu contrato."
    : parcelasRestantes === 1
      ? "Este saldo corresponde à 1 parcela restante do seu contrato."
      : `Este saldo corresponde às ${parcelasRestantes} parcelas restantes do seu contrato.`;
  const totalCartao = financeiro.totalComTaxa ?? (financeiro.taxaCartao ? saldo * (1 + financeiro.taxaCartao / 100) : saldo);

  return (
    <>
      <section className="relative min-h-[395px] overflow-hidden rounded-[18px] border border-[#EFE4E1] bg-white shadow-[0_10px_26px_rgba(70,42,44,.07)]">
        <div className="pointer-events-none select-none p-[14px] opacity-[.55] blur-[1.6px]">
          <CalendarioAgendamento datas={datas} onConfirmar={() => {}} confirmando={false} bloqueado />
        </div>

        <div className="absolute inset-[14px] flex items-center justify-center">
          <div className="w-full max-w-[355px] rounded-[18px] border border-[#E7D4AE] bg-white/92 px-[14px] pb-[14px] pt-[13px] shadow-[0_18px_42px_rgba(95,54,58,.13)] backdrop-blur-[2px]">
            <AgendaEtapasInterativas atual="pagamento" onPagamentoClick={abrirModal} />

            <div className="mt-[10px] flex items-end justify-between gap-3 rounded-[13px] border border-[#EAD7AE] bg-[#FFF9EF] px-[11px] py-[10px]">
              <div>
                <div className="text-[7.8px] font-semibold uppercase tracking-[.11em] text-[#A77A24]">Saldo restante</div>
                <div className="pt-[2px] font-heading text-[21px] font-semibold text-[#7D2434]">{moeda(saldo)}</div>
              </div>
              {parcelasRestantes != null && (
                <div className="pb-[2px] text-right text-[9px] font-medium text-[#806F6A]">
                  {parcelasRestantes} {parcelasRestantes === 1 ? "parcela restante" : "parcelas restantes"}
                </div>
              )}
            </div>

            <motion.button
              type="button"
              onClick={abrirModal}
              animate={{ scale: [1, 1.018, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              className="mt-[10px] w-full rounded-[11px] bg-[#6B1F2E] px-3 py-[11px] text-[10.8px] font-semibold text-white shadow-[0_6px_16px_rgba(107,31,46,.14)]"
            >
              Escolher forma de pagamento
            </motion.button>
          </div>
        </div>
      </section>

      <AnimatePresence>
        {modal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !enviando && setModal(false)}
              className="fixed inset-0 z-[80] bg-[rgba(38,23,25,.34)] backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ duration: 0.2 }}
              className="fixed bottom-0 left-1/2 z-[81] w-full max-w-[430px] -translate-x-1/2 px-[10px] pb-[max(12px,env(safe-area-inset-bottom))]"
            >
              <div className="max-h-[88dvh] overflow-y-auto rounded-[24px_24px_18px_18px] border border-[#EADFDB] bg-white px-[14px] pb-[15px] pt-[9px] shadow-[0_-16px_45px_rgba(48,26,30,.18)]">
                <div className="mx-auto mb-3 h-1 w-[38px] rounded-full bg-[#E7DCD8]" />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[8.5px] font-bold uppercase tracking-[.14em] text-[#B65B67]">Etapa 3 de 4</div>
                    <div className="pt-[3px] font-heading text-[21px] font-semibold text-[#7D2434]">Pagamento do saldo restante</div>
                    <p className="pt-1 text-[10px] font-light leading-[1.5] text-[#7A6B67]">
                      {parcelasTexto} Esse valor deverá ser quitado <strong className="font-semibold text-[#6D5530]">no ato da assinatura dos termos</strong>.
                    </p>
                  </div>
                  <button type="button" aria-label="Fechar" onClick={() => !enviando && setModal(false)} className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#F7EFED] text-[#7D2434]">×</button>
                </div>

                <div className="mt-3 rounded-[14px] border border-[#EAD7AE] bg-[#FFF9EF] px-3 py-[11px]">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[8px] font-semibold uppercase tracking-[.11em] text-[#A77A24]">Valor restante</div>
                      <div className="pt-[2px] font-heading text-[24px] font-semibold text-[#7D2434]">{moeda(saldo)}</div>
                    </div>
                    {parcelasRestantes != null && (
                      <div className="pb-1 text-right text-[9.5px] font-medium text-[#806F6A]">
                        referente a<br/><strong>{parcelasRestantes} {parcelasRestantes === 1 ? "parcela" : "parcelas"}</strong>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-[7px] text-[8px] font-bold uppercase tracking-[.12em] text-[#9A7771]">Formas liberadas pelo financeiro</div>
                  <div className="flex flex-col gap-[7px]">
                    {formas.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setForma(item)}
                        className="flex items-center justify-between gap-3 rounded-[12px] border px-3 py-[11px] text-left"
                        style={forma === item ? { borderColor: "#7D2434", background: "#F7EFED", color: "#6B1F2E" } : { borderColor: "#EADFDB", background: "#FFF", color: "#5E4A46" }}
                      >
                        <span className="text-[11px] font-semibold">{label(item)}</span>
                        <span className="text-right text-[9px] text-[#9A7771]">{extra(item, financeiro.taxaCartao)}</span>
                      </button>
                    ))}
                    {formas.length === 0 && (
                      <div className="rounded-[12px] border border-[#F0D3D1] bg-[#FBEBEA] p-3 text-[10px] text-[#8F2A25]">
                        Nenhuma forma de pagamento foi liberada pelo financeiro para este contrato.
                      </div>
                    )}
                  </div>
                </div>

                {forma === "cartao" && saldo > 0 && (
                  <div className="mt-[9px] rounded-[11px] border border-[#E8DDD9] bg-[#FCF9F8] px-3 py-[9px] text-[9.5px] leading-[1.45] text-[#7A6B67]">
                    No cartão, o total estimado é <strong className="font-semibold text-[#6B1F2E]">{moeda(totalCartao)}</strong>{financeiro.taxaCartao ? `, considerando a taxa de ${financeiro.taxaCartao}%.` : "."}
                  </div>
                )}

                <div className="mt-[10px] rounded-[11px] border border-[#E2D6D2] bg-[#FAF7F6] px-3 py-[9px] text-[9.5px] font-light leading-[1.5] text-[#796965]">
                  Ao confirmar, você registra a forma escolhida para quitar o saldo na assinatura dos termos e libera a próxima etapa: <strong className="font-semibold text-[#6B1F2E]">escolha da data</strong>.
                </div>

                {erro && <div className="mt-2 rounded-[11px] border border-[#F0D3D1] bg-[#FBEBEA] p-[9px] text-[9.8px] text-[#8F2A25]">{erro}</div>}
                <button type="button" disabled={!forma || enviando || formas.length === 0} onClick={() => void enviar()} className="mt-[11px] w-full rounded-[12px] bg-[#6B1F2E] p-3 text-[11.5px] font-semibold text-white disabled:opacity-40">
                  {enviando ? "Confirmando..." : "Confirmar e liberar escolha da data"}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
