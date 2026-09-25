import { Fragment, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, ChevronRight, Copy, CreditCard, Download, FileText, Loader2, Paperclip, QrCode, ShieldCheck, X } from "lucide-react";
import "@/styles/pagamento-folha.css";
import "@/styles/parcelas-lista.css";
import { MarcaSraLuck } from "@/components/cliente/MarcaSraLuck";
import { toast } from "sonner";
import { calcularEncargosAtraso } from "@/lib/financeiro/encargos";
import type { BoletosData } from "@/lib/clienteAgenda";

export type PagamentoConfig = {
  pixChave: string | null;
  pixQrCodeUrl: string | null;
  pixDescontoPercentual?: number;
  cartaoDisponivel?: boolean;
};

type StatusBoleto = "nao_pago" | "pago" | "pendente_confirmacao" | "rejeitado";
type Boleto = {
  id: string;
  numero_parcela: number;
  total_parcelas: number;
  valor: number;
  data_vencimento: string;
  status: StatusBoleto;
  data_pagamento: string | null;
  comprovante_url: string | null;
  boleto_url: string | null;
};

function quandoVence(dias: number) {
  return dias <= 0 ? "Vence hoje" : dias === 1 ? "Vence amanhã" : `Vence em ${dias} dias`;
}

/** A partir de quantos dias antes do vencimento a próxima parcela ganha o aviso "Vence em N dias". */
const DIAS_DESTAQUE = 2;
/** Quantas parcelas futuras aparecem antes do "Ver todas" (contratos de 36 a 72 parcelas). */
const LISTA_INICIAL = 6;

/** Dias de calendário (Brasília) até o vencimento; negativo se já passou. */
function diasParaVencer(dataVencimento: string) {
  const emDias = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split("-").map(Number); return Date.UTC(a, m - 1, d) / 86_400_000; };
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  return Math.round(emDias(dataVencimento) - emDias(hoje));
}

function brl(valor: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

function dataBr(valor: string | null) {
  if (!valor) return "—";
  return new Date(`${valor.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR");
}

function calcularValores(boleto: Boleto, pagamento?: PagamentoConfig) {
  const { diasEmAtraso: dias, juros, multa, encargos, valorAtualizado } = calcularEncargosAtraso(boleto.valor, boleto.data_vencimento);
  const vencida = dias > 0 && boleto.status === "nao_pago";
  const percentualDescontoPix = pagamento?.pixDescontoPercentual ?? 0;
  const temDescontoPix = vencida && percentualDescontoPix > 0;
  const economiaPix = encargos * (percentualDescontoPix / 100);
  const valorHoje = temDescontoPix ? valorAtualizado - economiaPix : vencida ? valorAtualizado : boleto.valor;
  return { dias, vencida, juros, multa, encargos, percentualDescontoPix, temDescontoPix, economiaPix, valorAtualizado, valorHoje };
}

/** Frase do cabeçalho da aba Financeiro conforme a situação das parcelas. */
export function resumoParcelas(boletos: Boleto[]): string {
  const pendentes = boletos.filter((b) => b.status !== "pago");
  if (boletos.length > 0 && pendentes.length === 0) return "Contrato quitado. Obrigada por confiar o seu sonho à Sra. Luck.";
  const vencidas = pendentes.filter((b) => b.status !== "pendente_confirmacao" && calcularValores(b).vencida).length;
  if (vencidas > 0) return vencidas === 1 ? "Você tem 1 parcela em atraso. Regularize para manter o seu plano em dia." : `Você tem ${vencidas} parcelas em atraso. Regularize para manter o seu plano em dia.`;
  const proxima = pendentes.find((b) => b.status !== "pendente_confirmacao");
  if (!proxima) return "Seus comprovantes estão em análise pelo financeiro.";
  const dias = diasParaVencer(proxima.data_vencimento);
  if (dias <= DIAS_DESTAQUE) return `Sua parcela ${proxima.numero_parcela} ${quandoVence(dias).toLowerCase()}.`;
  return `Tudo em dia. Próximo vencimento em ${dataBr(proxima.data_vencimento)}.`;
}

export function ParcelasPrototype({ pagamento, onResumo, dados, onAtualizar }: { pagamento?: PagamentoConfig; onResumo?: (texto: string) => void; dados: BoletosData; onAtualizar: () => Promise<void> }) {
  const [pagasAbertas, setPagasAbertas] = useState(false);
  const [listaCompleta, setListaCompleta] = useState(false);
  const [selecionada, setSelecionada] = useState<Boleto | null>(null);
  const [detalhePago, setDetalhePago] = useState(false);
  const [paySheet, setPaySheet] = useState(false);
  const [upload, setUpload] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pagandoCartao, setPagandoCartao] = useState(false);
  const [boletoPreview, setBoletoPreview] = useState<Boleto | null>(null);

  useEffect(() => {
    onResumo?.(resumoParcelas(dados.boletos));
  }, [dados, onResumo]);

  const pagas = dados.boletos.filter((boleto) => boleto.status === "pago");
  const pendentes = dados.boletos.filter((boleto) => boleto.status !== "pago");
  const total = dados.quantidade_parcelas || dados.boletos.length;

  function abrirPagamento(boleto: Boleto) {
    setSelecionada(boleto);
    setPagandoCartao(false);
    setPaySheet(true);
  }

  function abrirUpload(boleto: Boleto) {
    setSelecionada(boleto);
    setPaySheet(false);
    setArquivo(null);
    setUpload(true);
  }

  async function abrirCartao() {
    if (!selecionada || pagamento?.cartaoDisponivel !== true) return;
    setPagandoCartao(true);
    try {
      const resposta = await fetch("/api/cliente/payments/mercado-pago/preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boletoId: selecionada.id }),
      });
      const corpo = await resposta.json();
      if (!resposta.ok || !corpo.checkoutUrl) throw new Error(corpo.erro ?? "Não foi possível abrir o pagamento por cartão.");
      window.location.href = corpo.checkoutUrl;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível abrir o cartão.");
      setPagandoCartao(false);
    }
  }

  async function enviarComprovante() {
    if (!selecionada || !arquivo) return;
    if (arquivo.size > 5 * 1024 * 1024) {
      toast.error("O arquivo deve ter no máximo 5 MB.");
      return;
    }
    setEnviando(true);
    try {
      const formData = new FormData();
      formData.append("arquivo", arquivo);
      const resposta = await fetch(`/api/cliente/boletos/${encodeURIComponent(selecionada.id)}/anexar`, { method: "POST", body: formData });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.erro ?? "Não foi possível enviar o comprovante.");
      toast.success("Comprovante enviado para análise.");
      setUpload(false);
      await onAtualizar();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar o comprovante.");
    } finally {
      setEnviando(false);
    }
  }

  // Hierarquia da tela:
  // - sem atraso: destaca a próxima parcela;
  // - com 1 vencida: destaca a vencida e, abaixo, a próxima;
  // - com 2+ vencidas: destaca TODAS as vencidas e não exibe card de próxima parcela.
  const pagavel = (boleto: Boleto) => boleto.status !== "pendente_confirmacao";
  const vencidas = pendentes.filter((boleto) => pagavel(boleto) && calcularValores(boleto, pagamento).vencida);
  const multiplasVencidas = vencidas.length >= 2;
  const destaquesAtraso = vencidas;
  const proxima = multiplasVencidas
    ? null
    : pendentes.find((boleto) => pagavel(boleto) && !calcularValores(boleto, pagamento).vencida) ?? null;
  const idsDestaque = new Set(destaquesAtraso.map((boleto) => boleto.id));
  const demais = pendentes.filter((boleto) => !idsDestaque.has(boleto.id) && boleto !== proxima);
  const listaVisivel = listaCompleta ? demais : demais.slice(0, LISTA_INICIAL);

  return <div className="sl-parc pb-3">
    <div className="px-5 pt-[18px]">
      <button type="button" onClick={() => setPagasAbertas((aberto) => !aberto)} className="relative w-full overflow-hidden rounded-[19px] border border-[#D5E8D9] bg-gradient-to-br from-[#F3F9F4] to-[#EDF6EF] px-[15px] pb-[14px] pt-[15px] text-left shadow-[0_5px_18px_rgba(63,125,91,.055)]">
        <div className="absolute -right-[26px] -top-[38px] h-[94px] w-[94px] rounded-full bg-[rgba(63,125,91,.045)]" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[14px] border border-[#D4E7D8] bg-[#E3F1E6] text-[#3F7D5B]"><svg width="20" height="20" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.35"><rect x="3" y="5.5" width="16" height="12.5" rx="3"/><path d="M3 9h16"/><path d="M6.5 13h4"/><path d="m14.2 13 1.3 1.3 2.5-3"/></svg></span>
          <span className="min-w-0 flex-1"><span className="flex items-center gap-[7px]"><span className="text-[13.5px] font-semibold text-[#315F47]">Parcelas pagas</span><span className="rounded-full bg-[#DDEDE1] px-[7px] py-[2px] text-[9px] font-semibold text-[#3F7D5B]">CONFIRMADAS</span></span><span className="block pt-[3px] text-[11.5px] font-light text-[#698273]">{pagas.length} pagamentos já validados pelo financeiro</span></span>
          <span className="flex-none text-right"><span className="block font-heading text-[21px] font-semibold leading-none text-[#315F47]">{pagas.length}<span className="text-[13px] text-[#799384]">/{total}</span></span><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#6F8A78" strokeWidth="1.25" className={`ml-auto mt-[5px] transition-transform ${pagasAbertas ? "rotate-180" : ""}`}><path d="m4 6 4 4 4-4"/></svg></span>
        </div>
        {pagasAbertas && <div className="relative mt-[13px] border-t border-[#D7E8DA] pt-3">
          <div className="flex items-center justify-between px-px pb-2"><span className="text-[9.5px] font-semibold uppercase tracking-[.12em] text-[#6F8A78]">Carteira confirmada</span><span className="text-[10.5px] text-[#7E9887]">Toque para ver os detalhes</span></div>
          <div className="flex max-h-[305px] flex-col gap-[6px] overflow-y-auto pr-[2px]">{pagas.map((boleto) => <button type="button" key={boleto.id} onClick={(evento) => { evento.stopPropagation(); setSelecionada(boleto); setDetalhePago(true); }} className="flex items-center gap-[10px] rounded-[13px] border border-[rgba(63,125,91,.12)] bg-white/70 px-[11px] py-[10px] text-left"><span className="flex h-8 w-8 flex-none items-center justify-center rounded-[10px] bg-[#EAF4EC] font-heading text-[14px] font-semibold text-[#3F7D5B]">{boleto.numero_parcela}</span><span className="min-w-0 flex-1"><span className="block text-[12px] font-medium text-[#2E3D34]">Parcela {boleto.numero_parcela}</span><span className="block pt-[2px] text-[10.5px] font-light text-[#718579]">Confirmada em {dataBr(boleto.data_pagamento)}</span></span><span className="flex-none text-right"><span className="block text-[11.5px] font-medium text-[#355F49]">{brl(Number(boleto.valor))}</span><span className="block pt-[2px] text-[9.5px] text-[#799384]">liquidada</span></span><svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="#7E9887" strokeWidth="1.2"><path d="M5 3l4 4-4 4"/></svg></button>)}</div>
        </div>}
      </button>
    </div>

    {destaquesAtraso.length > 0 && <>
      <div className="sl-parc-etapa sl-parc-etapa--alerta">Em atraso</div>
      {destaquesAtraso.map((destaque) => {
        const valores = calcularValores(destaque, pagamento);
        const rejeitado = destaque.status === "rejeitado";
        return <div key={destaque.id} className="sl-parc-proxima sl-parc-proxima--vencida">
          <div className="sl-parc-proxima-linha">
            <button type="button" onClick={() => abrirPagamento(destaque)} className="sl-parc-proxima-info" aria-label={`Ver parcela ${destaque.numero_parcela}, vencida`}>
              <span className="sl-parc-numero sl-parc-numero--alerta">{destaque.numero_parcela}</span>
              <span className="sl-parc-linha-texto">
                <span className="sl-parc-badge-vencida">{rejeitado ? "Ajustar comprovante" : `Vencida há ${valores.dias} dia${valores.dias === 1 ? "" : "s"}`}</span>
                <b>{brl(valores.valorHoje)}</b>
              </span>
            </button>
            <button type="button" onClick={() => abrirPagamento(destaque)} className="sl-parc-proxima-pagar">Resolver agora</button>
          </div>
          <small className="sl-parc-proxima-rodape">Valor atualizado para pagar hoje</small>
        </div>;
      })}
    </>}

    {proxima && (() => {
      const dias = diasParaVencer(proxima.data_vencimento);
      const rejeitado = proxima.status === "rejeitado";
      const temUmaVencida = vencidas.length === 1;
      return <>{temUmaVencida && <div className="sl-parc-etapa">Próxima parcela</div>}<div className={`sl-parc-proxima ${temUmaVencida ? "sl-parc-proxima--depois" : ""} ${dias <= DIAS_DESTAQUE && !rejeitado ? "sl-parc-proxima--breve" : ""}`}>
        <div className="sl-parc-proxima-linha">
          <button type="button" onClick={() => abrirPagamento(proxima)} className="sl-parc-proxima-info" aria-label={`Ver parcela ${proxima.numero_parcela}`}>
            <span className="sl-parc-numero">{proxima.numero_parcela}</span>
            <span className="sl-parc-linha-texto">
              <span className="sl-parc-proxima-rotulo">{temUmaVencida ? `Parcela ${proxima.numero_parcela} de ${total}` : "Próxima parcela"}</span>
              <b>{brl(calcularValores(proxima, pagamento).valorHoje)}</b>
            </span>
          </button>
          <button type="button" onClick={() => abrirPagamento(proxima)} className="sl-parc-proxima-pagar">Pagar</button>
        </div>
        <small className={`sl-parc-proxima-rodape ${dias <= DIAS_DESTAQUE || rejeitado ? "sl-parc-aviso" : ""}`}>{rejeitado ? "Comprovante recusado · reenviar" : dias <= DIAS_DESTAQUE ? quandoVence(dias) : `Vence ${dataBr(proxima.data_vencimento)}`}</small>
      </div></>;
    })()}

    {pendentes.length === 0 ? <div className="sl-parc-quitado"><span className="sl-parc-pagas-icone"><Check className="h-[18px] w-[18px]" /></span><strong>Contrato totalmente quitado</strong><span>Todos os pagamentos já foram confirmados.</span></div> : demais.length > 0 && <>
      <div className="sl-parc-cabecalho"><span className="sl-parc-rotulo sl-parc-rotulo--suave">Próximas parcelas</span><span className="sl-parc-restantes">{pendentes.length} {pendentes.length === 1 ? "restante" : "restantes"} de {total}</span></div>
      <div className="sl-parc-lista sl-parc-lista--compacta mx-5">{listaVisivel.map((boleto, indice) => {
        const valores = calcularValores(boleto, pagamento);
        const emAnalise = boleto.status === "pendente_confirmacao";
        const rejeitado = boleto.status === "rejeitado";
        const ano = boleto.data_vencimento.slice(0, 4);
        const referenciaAnterior = proxima ?? destaquesAtraso[destaquesAtraso.length - 1];
        const anoAnterior = indice > 0 ? listaVisivel[indice - 1].data_vencimento.slice(0, 4) : referenciaAnterior?.data_vencimento.slice(0, 4);
        const status = emAnalise ? { texto: "Em análise", tom: "analise" } : rejeitado ? { texto: "Reenviar", tom: "alerta" } : valores.vencida ? { texto: "Vencida", tom: "alerta" } : { texto: "A vencer", tom: "neutro" };
        return <Fragment key={boleto.id}>
          {listaCompleta && ano !== anoAnterior && <div className="sl-parc-ano">{ano}</div>}
          <button type="button" onClick={() => abrirPagamento(boleto)} className="sl-parc-linha" aria-label={`Ver parcela ${boleto.numero_parcela}`}>
            <span className={`sl-parc-numero ${valores.vencida ? "sl-parc-numero--alerta" : ""}`}>{boleto.numero_parcela}</span>
            <span className="sl-parc-linha-texto"><b>Parcela {boleto.numero_parcela}</b><small>{dataBr(boleto.data_vencimento)}</small></span>
            <span className="sl-parc-linha-lado"><span className="sl-parc-linha-valor">{brl(valores.valorHoje)}</span><span className={`sl-parc-status sl-parc-status--${status.tom}`}>{status.texto}</span></span>
            <ChevronRight className="sl-parc-seta" aria-hidden="true" />
          </button>
        </Fragment>;
      })}</div>
      {demais.length > LISTA_INICIAL && <button type="button" onClick={() => setListaCompleta((v) => !v)} className="sl-parc-ver-todas">
        {listaCompleta ? "Mostrar menos" : `Ver todas as parcelas (${demais.length})`}
        <ChevronDown className={`h-4 w-4 transition-transform ${listaCompleta ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>}
    </>}

    {detalhePago && selecionada && <PaidDetail boleto={selecionada} onClose={() => setDetalhePago(false)} />}
    {paySheet && selecionada && <PaymentSheet boleto={selecionada} pagamento={pagamento} onClose={() => setPaySheet(false)} onUpload={() => abrirUpload(selecionada)} onCard={() => void abrirCartao()} onBoleto={() => setBoletoPreview(selecionada)} cardBusy={pagandoCartao} />}
    {boletoPreview && <BoletoViewer boleto={boletoPreview} onClose={() => setBoletoPreview(null)} />}
    {upload && selecionada && <UploadSheet boleto={selecionada} arquivo={arquivo} setArquivo={setArquivo} onClose={() => setUpload(false)} onEnviar={() => void enviarComprovante()} enviando={enviando} />}
  </div>;
}

function PaidDetail({ boleto, onClose }: { boleto: Boleto; onClose: () => void }) {
  return <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[rgba(34,25,24,.42)] backdrop-blur-[3px]"><div className="w-full max-w-[430px] rounded-t-[27px] border-t border-white/80 bg-[#FBF9F8] px-5 pb-[calc(max(env(safe-area-inset-bottom),0px)+24px)] pt-[9px] shadow-[0_-24px_60px_rgba(46,36,34,.24)]"><div className="mx-auto mb-[15px] h-1 w-10 rounded-full bg-[#DCCECB]"/><div className="flex items-start justify-between gap-[14px]"><div><div className="text-[9px] font-semibold uppercase tracking-[.16em] text-[#3F7D5B]">Pagamento confirmado</div><div className="pt-[3px] font-heading text-[25px] font-semibold text-[#2E2422]">Parcela {boleto.numero_parcela}</div><div className="pt-[3px] text-[11.5px] font-light text-[#8A7B77]">Liquidação validada pelo financeiro.</div></div><button type="button" onClick={onClose} className="flex h-[31px] w-[31px] items-center justify-center rounded-full bg-[#F0E6E3]"><svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#8A7B77" strokeWidth="1.3"><path d="M2 2l8 8M10 2l-8 8"/></svg></button></div><div className="mt-4 rounded-[16px] border border-[#D7E8DA] bg-[#F3F9F4] p-[13px]"><div className="grid grid-cols-2 gap-3"><div><div className="text-[9px] text-[#799384]">Valor</div><div className="pt-1 font-heading text-[20px] font-semibold text-[#315F47]">{brl(boleto.valor)}</div></div><div><div className="text-[9px] text-[#799384]">Confirmada em</div><div className="pt-1 text-[11px] font-medium text-[#315F47]">{dataBr(boleto.data_pagamento)}</div></div></div></div></div></div>;
}

function PixChave({ chave }: { chave: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(chave);
      setCopiado(true);
      toast.success("Chave PIX copiada!");
      window.setTimeout(() => setCopiado(false), 1800);
    } catch {
      toast.error("Não foi possível copiar a chave PIX.");
    }
  }

  return <button type="button" onClick={copiar} className="sl-pag-chave"><span className="truncate">{chave}</span><span className="sl-pag-chave-acao">{copiado ? <><Check className="h-3.5 w-3.5" /> Copiada</> : <><Copy className="h-3.5 w-3.5" /> Copiar</>}</span></button>;
}

function PaymentSheet({ boleto, pagamento, onClose, onUpload, onCard, onBoleto, cardBusy }: { boleto: Boleto; pagamento?: PagamentoConfig; onClose: () => void; onUpload: () => void; onCard: () => void; onBoleto: () => void; cardBusy: boolean }) {
  const [pixAberto, setPixAberto] = useState(false);
  const valores = calcularValores(boleto, pagamento);
  const pixDisponivel = Boolean(pagamento?.pixChave || pagamento?.pixQrCodeUrl);

  useEffect(() => {
    setPixAberto(false);
  }, [boleto.id]);

  useEffect(() => {
    function aoPressionarTecla(evento: KeyboardEvent) {
      if (evento.key === "Escape") onClose();
    }
    document.addEventListener("keydown", aoPressionarTecla);
    return () => document.removeEventListener("keydown", aoPressionarTecla);
  }, [onClose]);

  const vencimento = boleto.data_vencimento ? boleto.data_vencimento.slice(0, 10).split("-").reverse().slice(0, 2).join("/") : "";
  const status = valores.vencida
    ? { texto: `Vencida há ${valores.dias} dia${valores.dias === 1 ? "" : "s"}`, tom: "vencida" }
    : { texto: vencimento ? `Vence em ${vencimento}` : "Em aberto", tom: "aberta" };
  const cartaoDisponivel = pagamento?.cartaoDisponivel === true;

  return <div className="sl-pag-fundo" onClick={(evento) => { if (evento.target === evento.currentTarget) onClose(); }}>
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`Pagar parcela ${boleto.numero_parcela}`}
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 40 }}
      className="sl-pag"
    >
      <div className="sl-pag-alca" aria-hidden="true" />
      <div className="sl-pag-topo">
        <div className="min-w-0">
          <MarcaSraLuck className="sl-pag-marca" />
          <h3 className="sl-pag-titulo">Pagar parcela {boleto.numero_parcela}</h3>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar" className="sl-pag-fechar"><X className="h-4 w-4" /></button>
      </div>

      <div className="sl-pag-rolagem">
        <div className="sl-pag-valor">
          <div className="sl-pag-valor-topo">
            <span className="sl-pag-rotulo">Valor para hoje</span>
            <span className={`sl-pag-status sl-pag-status--${status.tom}`}>{status.texto}</span>
          </div>
          <strong className="sl-pag-quantia">{brl(valores.valorHoje)}</strong>
          <span className="sl-pag-detalhe">
            {valores.vencida
              ? <>Valor atualizado para pagar hoje{valores.temDescontoPix ? `, já com ${valores.percentualDescontoPix}% de desconto via PIX` : ""}.</>
              : "Valor da parcela."}
          </span>
        </div>

        <span className="sl-pag-secao">Como deseja pagar</span>
        <div className="sl-pag-lista">
          <button type="button" onClick={() => setPixAberto((aberto) => !aberto)} className="sl-pag-opcao" aria-expanded={pixAberto}>
            <span className="sl-pag-icone"><QrCode className="h-[18px] w-[18px]" /></span>
            <span className="sl-pag-opcao-texto"><b>PIX</b><small>{pixDisponivel ? "QR Code ou chave, na hora" : "Ainda não configurado"}</small></span>
            {valores.temDescontoPix && <span className="sl-pag-selo">{valores.percentualDescontoPix}% off</span>}
            <ChevronDown className={`sl-pag-seta ${pixAberto ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>

          <AnimatePresence initial={false}>
            {pixAberto && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.14 }} className="overflow-hidden">
              {pixDisponivel ? <div className="sl-pag-pix">
                {pagamento?.pixQrCodeUrl && <img src={pagamento.pixQrCodeUrl} alt="QR Code para pagamento via PIX" className="sl-pag-qr" />}
                <div className="min-w-0 flex-1">
                  <span className="sl-pag-pix-rotulo">Valor via PIX</span>
                  <strong className="sl-pag-pix-valor">{brl(valores.valorHoje)}</strong>
                  {valores.temDescontoPix && valores.economiaPix > 0 && <span className="sl-pag-pix-economia">Economia de {brl(valores.economiaPix)} nos encargos</span>}
                  {pagamento?.pixChave && <PixChave chave={pagamento.pixChave} />}
                </div>
              </div> : <p className="sl-pag-pix-vazio">O PIX ainda não foi configurado para este contrato. Use outra forma ou fale com a equipe.</p>}
            </motion.div>}
          </AnimatePresence>

          {cartaoDisponivel ? <button type="button" onClick={onCard} disabled={cardBusy} className="sl-pag-opcao">
            <span className="sl-pag-icone"><CreditCard className="h-[18px] w-[18px]" /></span>
            <span className="sl-pag-opcao-texto"><b>{cardBusy ? "Abrindo checkout…" : "Cartão de crédito"}</b><small>Checkout seguro</small></span>
            <ChevronRight className="sl-pag-seta" aria-hidden="true" />
          </button> : <div className="sl-pag-opcao sl-pag-opcao--off" aria-disabled="true">
            <span className="sl-pag-icone"><CreditCard className="h-[18px] w-[18px]" /></span>
            <span className="sl-pag-opcao-texto"><b>Cartão de crédito</b><small>Indisponível no momento</small></span>
          </div>}

          {boleto.boleto_url ? <button type="button" onClick={onBoleto} className="sl-pag-opcao">
            <span className="sl-pag-icone"><FileText className="h-[18px] w-[18px]" /></span>
            <span className="sl-pag-opcao-texto"><b>Boleto</b><small>Visualizar boleto completo</small></span>
            <ChevronRight className="sl-pag-seta" aria-hidden="true" />
          </button> : <div className="sl-pag-opcao sl-pag-opcao--off" aria-disabled="true">
            <span className="sl-pag-icone"><FileText className="h-[18px] w-[18px]" /></span>
            <span className="sl-pag-opcao-texto"><b>Boleto</b><small>Indisponível para esta parcela</small></span>
          </div>}
        </div>

        <button type="button" onClick={onUpload} className="sl-pag-ja-paguei">
          <Paperclip className="h-4 w-4" aria-hidden="true" /> Já paguei · enviar comprovante
        </button>
        <p className="sl-pag-nota"><ShieldCheck className="h-3.5 w-3.5 flex-none" aria-hidden="true" /> Depois de pagar, envie o comprovante para o financeiro confirmar.</p>
      </div>
    </motion.div>
  </div>;
}

function BoletoViewer({ boleto, onClose }: { boleto: Boleto; onClose: () => void }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [paginas, setPaginas] = useState<string[]>([]);
  const [arquivoUrl, setArquivoUrl] = useState<string | null>(null);
  const [extensao, setExtensao] = useState("pdf");

  useEffect(() => {
    let cancelado = false;
    let urlTemporaria: string | null = null;

    async function carregarBoleto() {
      setCarregando(true);
      setErro(null);
      setPaginas([]);
      try {
        const resposta = await fetch(`/api/cliente/boletos/${encodeURIComponent(boleto.id)}/arquivo`, { cache: "no-store" });
        if (!resposta.ok) {
          const corpo = await resposta.json().catch(() => ({}));
          throw new Error(corpo.erro ?? "Não foi possível carregar o boleto.");
        }

        const blob = await resposta.blob();
        urlTemporaria = URL.createObjectURL(blob);
        if (cancelado) {
          URL.revokeObjectURL(urlTemporaria);
          return;
        }
        setArquivoUrl(urlTemporaria);

        const tipo = (blob.type || "").toLowerCase();
        const caminho = (boleto.boleto_url || "").toLowerCase();
        const ehPdf = tipo.includes("pdf") || caminho.endsWith(".pdf");

        if (ehPdf) {
          setExtensao("pdf");
          const { abrirPdf, fecharPdf, renderizarPagina } = await import("@/features/leitor-carne/pdf");
          const documento = await abrirPdf(new Uint8Array(await blob.arrayBuffer()));
          try {
            const imagens: string[] = [];
            const largura = Math.min(1200, Math.max(760, window.innerWidth * 2));
            for (let numero = 1; numero <= documento.numPages; numero += 1) {
              if (cancelado) break;
              const pagina = await documento.getPage(numero);
              const canvas = await renderizarPagina(pagina, largura);
              imagens.push(canvas.toDataURL("image/png"));
            }
            if (!cancelado) setPaginas(imagens);
          } finally {
            await fecharPdf(documento);
          }
        } else if (tipo.startsWith("image/")) {
          setExtensao(tipo.includes("png") ? "png" : "jpg");
          setPaginas([urlTemporaria]);
        } else {
          const extensaoCaminho = caminho.split(".").pop();
          setExtensao(extensaoCaminho && extensaoCaminho.length <= 5 ? extensaoCaminho : "pdf");
        }
      } catch (error) {
        if (!cancelado) setErro(error instanceof Error ? error.message : "Não foi possível carregar o boleto.");
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }

    void carregarBoleto();
    return () => {
      cancelado = true;
      if (urlTemporaria) URL.revokeObjectURL(urlTemporaria);
    };
  }, [boleto.id, boleto.boleto_url]);

  useEffect(() => {
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function aoPressionarTecla(evento: KeyboardEvent) {
      if (evento.key === "Escape") onClose();
    }
    document.addEventListener("keydown", aoPressionarTecla);
    return () => {
      document.body.style.overflow = overflowAnterior;
      document.removeEventListener("keydown", aoPressionarTecla);
    };
  }, [onClose]);

  function baixarBoleto() {
    if (!arquivoUrl) return;
    const link = document.createElement("a");
    link.href = arquivoUrl;
    link.download = `boleto-parcela-${boleto.numero_parcela}.${extensao}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return <div className="sl-boleto-modal" role="dialog" aria-modal="true" aria-label={`Boleto da parcela ${boleto.numero_parcela}`}>
    <div className="sl-boleto-painel">
      <header className="sl-boleto-topo">
        <div className="min-w-0">
          <span className="sl-boleto-kicker">Boleto</span>
          <strong>Parcela {boleto.numero_parcela} de {boleto.total_parcelas}</strong>
          <small>Visualização completa do documento</small>
        </div>
        <div className="sl-boleto-acoes">
          <button type="button" onClick={baixarBoleto} disabled={!arquivoUrl || carregando} className="sl-boleto-baixar">
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>Baixar boleto</span>
          </button>
          <button type="button" onClick={onClose} className="sl-boleto-fechar" aria-label="Fechar boleto"><X className="h-5 w-5" /></button>
        </div>
      </header>

      <div className="sl-boleto-corpo">
        {carregando && <div className="sl-boleto-estado"><Loader2 className="h-6 w-6 animate-spin" /><span>Carregando boleto completo...</span></div>}
        {!carregando && erro && <div className="sl-boleto-estado sl-boleto-estado--erro"><FileText className="h-7 w-7" /><strong>Não foi possível visualizar o boleto.</strong><span>{erro}</span>{arquivoUrl && <button type="button" onClick={baixarBoleto}>Baixar boleto</button>}</div>}
        {!carregando && !erro && paginas.length > 0 && <div className="sl-boleto-paginas">
          {paginas.map((pagina, indice) => <img key={`${boleto.id}-${indice}`} src={pagina} alt={`Página ${indice + 1} do boleto da parcela ${boleto.numero_parcela}`} className="sl-boleto-pagina" />)}
        </div>}
        {!carregando && !erro && paginas.length === 0 && arquivoUrl && <iframe title={`Boleto da parcela ${boleto.numero_parcela}`} src={arquivoUrl} className="sl-boleto-iframe" />}
      </div>
    </div>
  </div>;
}

function UploadSheet({ boleto, arquivo, setArquivo, onClose, onEnviar, enviando }: { boleto: Boleto; arquivo: File | null; setArquivo: (arquivo: File | null) => void; onClose: () => void; onEnviar: () => void; enviando: boolean }) {
  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[rgba(31,24,23,.56)] backdrop-blur-[3px]"><div className="w-full max-w-[430px] rounded-t-[28px] border-t border-white/80 bg-[#FCFAF9] px-[18px] pb-[calc(max(env(safe-area-inset-bottom),0px)+22px)] pt-[9px]"><div className="mx-auto mb-[14px] h-1 w-[38px] rounded-full bg-[#D9CECB]"/><div className="flex items-start justify-between gap-[13px]"><div><div className="text-[8.5px] font-bold uppercase tracking-[.18em] text-[#B18B4B]">Comprovante</div><div className="pt-[3px] font-heading text-[24px] font-semibold leading-[1.08] text-[#6B1F2E]">Já paguei a parcela {boleto.numero_parcela}</div><div className="pt-1 text-[10.8px] font-light text-[#8A7B77]">Envie o comprovante para validação do financeiro.</div></div><button type="button" onClick={onClose} className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#F1E9E6]"><svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#7E6F6B" strokeWidth="1.35"><path d="M2 2l8 8M10 2l-8 8"/></svg></button></div>
      <label className="mt-[14px] block w-full cursor-pointer rounded-[17px] border-[1.5px] border-dashed border-[#DCCECB] bg-white px-[13px] py-4 text-center"><input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={(evento) => setArquivo(evento.target.files?.[0] ?? null)}/><span className="mx-auto flex h-[41px] w-[41px] items-center justify-center rounded-[14px] bg-[#F7EFED] text-[#6B1F2E]"><svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25"><path d="M10 13V3M6.5 6.5 10 3l3.5 3.5"/><path d="M4 10v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-5"/></svg></span><span className="block pt-2 text-[12px] font-medium text-[#4B3C39]">Escolha o comprovante do pagamento</span><span className="block pt-[3px] text-[9.8px] font-light text-[#9A8985]">JPG, PNG ou PDF · arquivo legível e completo</span></label>
      {arquivo && <div className="mt-[9px] flex items-center gap-[9px] rounded-[12px] border border-[#DDEBE0] bg-[#F3F8F4] px-[11px] py-[10px]"><span className="flex h-[31px] w-[31px] items-center justify-center rounded-[10px] bg-[#E4F0E7] text-[#3F7D5B]"><svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M5 2.5h6l3 3v10H5z"/><path d="M11 2.5v3h3"/></svg></span><span className="min-w-0 flex-1"><span className="block truncate text-[10.8px] font-medium text-[#355F49]">{arquivo.name}</span><span className="block pt-px text-[9.2px] text-[#789080]">Pronto para enviar</span></span></div>}
      <div className="mt-[9px] rounded-[11px] border border-[#F0E0B7] bg-[#FFF8EA] px-[10px] py-[9px] text-[9.8px] leading-[1.5] text-[#7D642C]">O envio <b>não marca a parcela como paga imediatamente</b>. Ela ficará em análise e só irá para <b>Parcelas pagas</b> depois da confirmação do financeiro.</div><button type="button" disabled={!arquivo || enviando} onClick={onEnviar} className="mt-[10px] w-full rounded-[11px] bg-[#6B1F2E] p-[11px] text-[10.8px] font-semibold text-white disabled:opacity-40">{enviando ? "Enviando..." : "Enviar para análise"}</button>
    </div></div>;
}
