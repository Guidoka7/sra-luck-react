import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export type PagamentoConfig = {
  pixChave: string | null;
  pixQrCodeUrl: string | null;
  pixDescontoPercentual?: number;
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
type Progresso = {
  quantidade_parcelas: number;
  porcentagem_pagamento: number;
  pode_agendar: boolean;
  parcelas_pagas: number;
  parcelas_nao_pagas: number;
  boletos: Boleto[];
};
type FormaPagamento = "pix" | "boleto" | "cartao" | null;

function brl(valor: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

function dataBr(valor: string | null) {
  if (!valor) return "—";
  return new Date(`${valor.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR");
}

function calcularValores(boleto: Boleto, pagamento?: PagamentoConfig) {
  const vencimento = new Date(`${boleto.data_vencimento}T00:00:00`);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dias = Math.max(0, Math.floor((hoje.getTime() - vencimento.getTime()) / 86_400_000));
  const vencida = dias > 0 && boleto.status === "nao_pago";
  const juros = boleto.valor * dias * 0.002;
  const multa = boleto.valor * Math.ceil(dias / 30) * 0.02;
  const encargos = juros + multa;
  const desconto = (pagamento?.pixDescontoPercentual ?? 0) / 100;
  const valorHoje = vencida ? boleto.valor + encargos - encargos * desconto : boleto.valor;
  return { dias, vencida, valorHoje };
}

function statusVisual(boleto: Boleto) {
  if (boleto.status === "pendente_confirmacao") return { label: "Em análise", bg: "#FFF8EA", color: "#8B6A22", border: "#F0E0B7" };
  if (boleto.status === "rejeitado") return { label: "Ajustar comprovante", bg: "#FBEBEA", color: "#8F2A25", border: "#F0D3D1" };
  if (calcularValores(boleto).vencida) return { label: "Vencida", bg: "#FBEBEA", color: "#8F2A25", border: "#F0D3D1" };
  return { label: "Em aberto", bg: "#F7EFED", color: "#7D2434", border: "#E7D4D0" };
}

export function ParcelasPrototype({ pagamento }: { pagamento?: PagamentoConfig }) {
  const [dados, setDados] = useState<Progresso | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [pagasAbertas, setPagasAbertas] = useState(false);
  const [selecionada, setSelecionada] = useState<Boleto | null>(null);
  const [detalhePago, setDetalhePago] = useState(false);
  const [paySheet, setPaySheet] = useState(false);
  const [forma, setForma] = useState<FormaPagamento>(null);
  const [upload, setUpload] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pagandoCartao, setPagandoCartao] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch("/api/cliente/boletos", { cache: "no-store" });
      const corpo = await resposta.json();
      if (!resposta.ok) throw new Error(corpo.erro ?? "Não foi possível carregar as parcelas.");
      setDados(corpo);
      setErro(null);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível carregar as parcelas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
    const timer = window.setInterval(() => void carregar(), 30_000);
    return () => window.clearInterval(timer);
  }, [carregar]);

  if (loading) return <div className="px-5 py-12 text-center text-[10.5px] font-light text-[#9A8A86]">Carregando parcelas...</div>;
  if (!dados || erro) {
    return <div className="mx-5 mt-4 rounded-[17px] border border-[#F0D3D1] bg-[#FBEBEA] p-4 text-center"><div className="text-[11px] text-[#8F2A25]">{erro ?? "Não foi possível carregar as parcelas."}</div><button type="button" onClick={() => { setLoading(true); void carregar(); }} className="mt-3 rounded-[10px] bg-[#6B1F2E] px-3 py-2 text-[10px] font-semibold text-white">Tentar novamente</button></div>;
  }

  const pagas = dados.boletos.filter((boleto) => boleto.status === "pago");
  const pendentes = dados.boletos.filter((boleto) => boleto.status !== "pago");
  const total = dados.quantidade_parcelas || dados.boletos.length;

  function abrirPagamento(boleto: Boleto) {
    setSelecionada(boleto);
    setForma(null);
    setPaySheet(true);
  }

  function abrirUpload(boleto: Boleto) {
    setSelecionada(boleto);
    setPaySheet(false);
    setArquivo(null);
    setUpload(true);
  }

  async function abrirCartao() {
    if (!selecionada) return;
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
      await carregar();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar o comprovante.");
    } finally {
      setEnviando(false);
    }
  }

  return <div className="pb-3">
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

    <div className="flex items-end justify-between gap-3 px-5 pt-5"><div><div className="text-[10px] font-semibold uppercase tracking-[.13em] text-[#A99894]">Parcelas do contrato</div><div className="pt-[3px] text-[11.5px] font-light text-[#8A7B77]">Vencidas e próximas, na ordem do contrato.</div></div><div className="whitespace-nowrap text-[11px] font-medium text-[#8A7B77]">{pendentes.length} restantes</div></div>

    {pendentes.length > 0 ? <div className="flex flex-col gap-2 px-5 pt-[10px]">{pendentes.map((boleto) => {
      const status = statusVisual(boleto);
      const valores = calcularValores(boleto, pagamento);
      const emAnalise = boleto.status === "pendente_confirmacao";
      return <div key={boleto.id} className="rounded-[17px] border bg-white p-[13px] shadow-[0_4px_14px_rgba(73,42,47,.025)]" style={{ borderColor: valores.vencida ? "#EACFCD" : "#ECE2DF" }}>
        <div className="flex min-w-0 items-start gap-[11px]"><span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[12px] border font-heading text-[15px] font-semibold" style={{ background: valores.vencida ? "#FBEBEA" : "#F8F1EF", borderColor: valores.vencida ? "#EECFCD" : "#EADDD9", color: valores.vencida ? "#8F2A25" : "#7D2434" }}>{boleto.numero_parcela}</span><span className="min-w-0 flex-1 pt-px"><span className="flex flex-wrap items-center gap-[7px]"><span className="text-[13px] font-medium text-[#2E2422]">Parcela {boleto.numero_parcela}</span><span className="rounded-full border px-[7px] py-[3px] text-[8px] font-semibold uppercase" style={{ background: status.bg, color: status.color, borderColor: status.border }}>{status.label}</span></span><span className="block pt-[3px] text-[11px] font-light text-[#8A7B77]">{valores.vencida ? `Vencida há ${valores.dias} dia${valores.dias === 1 ? "" : "s"}` : `Vencimento ${dataBr(boleto.data_vencimento)}`}</span></span><span className="flex-none pt-px text-right"><span className="block text-[12.5px] font-medium text-[#2E2422]">{brl(valores.valorHoje)}</span><span className="block pt-[2px] text-[9.5px] font-light text-[#A99894]">{valores.vencida ? "para pagar hoje" : "valor da parcela"}</span></span></div>
        {emAnalise ? <div className="mt-[10px] flex items-center gap-[7px] rounded-[11px] border border-[#F0E0B7] bg-[#FFF8EA] px-[10px] py-[9px] text-[10.5px] font-medium text-[#8B6A22]"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.8v3.5l2.2 1.3"/></svg>Comprovante recebido · aguardando confirmação do financeiro</div> : <button type="button" onClick={() => abrirPagamento(boleto)} className="mt-[10px] w-full rounded-[11px] px-3 py-[9px] text-[10.5px] font-semibold" style={valores.vencida ? { background: "#8F2A25", color: "#FFF" } : { background: "#F7EFED", color: "#6B1F2E", border: "1px solid #E7D4D0" }}>{valores.vencida ? "Resolver parcela" : "Pagar parcela"}</button>}
      </div>;
    })}</div> : <div className="mx-5 mt-3 rounded-[20px] border border-[#D5E8D9] bg-[#F3F9F4] px-[22px] py-7 text-center"><span className="mx-auto flex h-[42px] w-[42px] items-center justify-center rounded-[15px] bg-[#E3F1E6]"><svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="#3F7D5B" strokeWidth="1.3"><path d="m4 10 3.4 3.5L16 5.8"/></svg></span><div className="pt-[11px] font-heading text-[20px] font-semibold text-[#315F47]">Contrato totalmente quitado</div><div className="pt-1 text-[12px] font-light leading-[1.5] text-[#698273]">Todos os pagamentos já foram confirmados.</div></div>}

    {detalhePago && selecionada && <PaidDetail boleto={selecionada} onClose={() => setDetalhePago(false)} />}
    {paySheet && selecionada && <PaymentSheet boleto={selecionada} pagamento={pagamento} forma={forma} setForma={setForma} onClose={() => setPaySheet(false)} onUpload={() => abrirUpload(selecionada)} onCard={() => void abrirCartao()} cardBusy={pagandoCartao} />}
    {upload && selecionada && <UploadSheet boleto={selecionada} arquivo={arquivo} setArquivo={setArquivo} onClose={() => setUpload(false)} onEnviar={() => void enviarComprovante()} enviando={enviando} />}
  </div>;
}

function PaidDetail({ boleto, onClose }: { boleto: Boleto; onClose: () => void }) {
  return <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[rgba(34,25,24,.42)] backdrop-blur-[3px]"><div className="w-full max-w-[430px] rounded-t-[27px] border-t border-white/80 bg-[#FBF9F8] px-5 pb-[calc(max(env(safe-area-inset-bottom),0px)+24px)] pt-[9px] shadow-[0_-24px_60px_rgba(46,36,34,.24)]"><div className="mx-auto mb-[15px] h-1 w-10 rounded-full bg-[#DCCECB]"/><div className="flex items-start justify-between gap-[14px]"><div><div className="text-[9px] font-semibold uppercase tracking-[.16em] text-[#3F7D5B]">Pagamento confirmado</div><div className="pt-[3px] font-heading text-[25px] font-semibold text-[#2E2422]">Parcela {boleto.numero_parcela}</div><div className="pt-[3px] text-[11.5px] font-light text-[#8A7B77]">Liquidação validada pelo financeiro.</div></div><button type="button" onClick={onClose} className="flex h-[31px] w-[31px] items-center justify-center rounded-full bg-[#F0E6E3]"><svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#8A7B77" strokeWidth="1.3"><path d="M2 2l8 8M10 2l-8 8"/></svg></button></div><div className="mt-4 rounded-[16px] border border-[#D7E8DA] bg-[#F3F9F4] p-[13px]"><div className="grid grid-cols-2 gap-3"><div><div className="text-[9px] text-[#799384]">Valor</div><div className="pt-1 font-heading text-[20px] font-semibold text-[#315F47]">{brl(boleto.valor)}</div></div><div><div className="text-[9px] text-[#799384]">Confirmada em</div><div className="pt-1 text-[11px] font-medium text-[#315F47]">{dataBr(boleto.data_pagamento)}</div></div></div></div></div></div>;
}

function PaymentSheet({ boleto, pagamento, forma, setForma, onClose, onUpload, onCard, cardBusy }: { boleto: Boleto; pagamento?: PagamentoConfig; forma: FormaPagamento; setForma: (forma: FormaPagamento) => void; onClose: () => void; onUpload: () => void; onCard: () => void; cardBusy: boolean }) {
  const valores = calcularValores(boleto, pagamento);
  return <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[rgba(31,24,23,.56)] backdrop-blur-[3px]"><div className="w-full max-w-[430px] rounded-t-[28px] border-t border-white/80 bg-[#FCFAF9] px-[18px] pb-[calc(max(env(safe-area-inset-bottom),0px)+22px)] pt-[9px] shadow-[0_-28px_70px_rgba(30,20,20,.3)]"><div className="mx-auto mb-[14px] h-1 w-[38px] rounded-full bg-[#D9CECB]"/><div className="flex items-start justify-between gap-[13px]"><div><div className="text-[8.5px] font-bold uppercase tracking-[.18em] text-[#B18B4B]">Pagamento</div><div className="pt-[3px] font-heading text-[24px] font-semibold leading-[1.08] text-[#6B1F2E]">{valores.vencida ? `Resolver parcela ${boleto.numero_parcela}` : `Pagar parcela ${boleto.numero_parcela}`}</div><div className="pt-1 text-[10.8px] font-light text-[#8A7B77]">{valores.vencida ? `Vencida há ${valores.dias} dias · ` : "Parcela em aberto · "}{brl(valores.valorHoje)} para pagar hoje</div></div><button type="button" onClick={onClose} className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#F1E9E6]"><svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#7E6F6B" strokeWidth="1.35"><path d="M2 2l8 8M10 2l-8 8"/></svg></button></div><div className="mt-[13px] grid grid-cols-4 gap-[7px]">{(["pix", "boleto", "cartao"] as const).map((id) => <button key={id} type="button" onClick={() => setForma(id)} className="rounded-[12px] border px-1 py-[11px] text-[9.5px] font-semibold" style={forma === id ? { borderColor: "#6B1F2E", background: "#F7EFED", color: "#6B1F2E" } : { borderColor: "#EADFDB", background: "#FFF", color: "#6E5F5B" }}>{id === "pix" ? "PIX" : id === "boleto" ? "Boleto" : "Cartão"}</button>)}<button type="button" onClick={onUpload} className="rounded-[12px] border border-[#E7D4D0] bg-[#FFF8F7] px-1 py-[11px] text-[9.5px] font-semibold text-[#6B1F2E]">Já paguei</button></div>
      {forma === "pix" && <div className="mt-[10px] rounded-[17px] border border-[#E9DAD6] bg-white p-[13px] shadow-[0_5px_18px_rgba(107,31,46,.035)]"><div className="flex items-center justify-between border-b border-[#F1E8E5] pb-[10px]"><span className="text-[11.5px] font-semibold text-[#6B1F2E]">Pague via PIX</span><span className="rounded-full bg-[#EFF7F1] px-[7px] py-[3px] text-[9px] font-semibold text-[#3F7D5B]">CONFIRMAÇÃO RÁPIDA</span></div><div className="flex items-center gap-[11px] pt-[11px]">{pagamento?.pixQrCodeUrl ? <img src={pagamento.pixQrCodeUrl} alt="QR Code PIX" className="h-[78px] w-[78px] rounded-[14px] border border-[#E9DAD6] object-contain"/> : <div className="flex h-[78px] w-[78px] items-center justify-center rounded-[14px] border border-[#E9DAD6] bg-[#FAF6F4] text-[9px] text-[#A2938F]">QR PIX</div>}<div className="min-w-0 flex-1"><div className="text-[9.5px] text-[#9A8985]">Valor para pagar hoje</div><div className="pt-px font-heading text-[19px] font-semibold text-[#8F2A25]">{brl(valores.valorHoje)}</div>{pagamento?.pixChave && <button type="button" onClick={() => void navigator.clipboard.writeText(pagamento.pixChave!)} className="mt-[7px] flex w-full items-center justify-between gap-[7px] rounded-[10px] border border-[#EEE4E1] bg-[#FBF8F7] px-[9px] py-2"><span className="truncate font-mono text-[8.5px] text-[#6D5E5B]">{pagamento.pixChave}</span><span className="text-[9px] font-semibold text-[#6B1F2E]">COPIAR</span></button>}</div></div><div className="mt-[10px] rounded-[10px] bg-[#F9F1F0] px-[9px] py-2 text-[9.5px] leading-[1.45] text-[#786764]">Depois do pagamento, toque em <b className="text-[#6B1F2E]">Já paguei</b> para enviar o comprovante.</div></div>}
      {forma === "boleto" && <div className="mt-[10px] rounded-[17px] border border-[#E9DAD6] bg-white p-[13px]"><div className="text-[11.5px] font-semibold text-[#6B1F2E]">Boleto desta parcela</div><div className="pt-[2px] text-[9.5px] text-[#9A8985]">Abra o PDF original emitido para esta parcela.</div>{boleto.boleto_url ? <a href={`/api/cliente/boletos/${boleto.id}/arquivo`} target="_blank" rel="noopener noreferrer" className="mt-[10px] block rounded-[10px] bg-[#6B1F2E] p-[10px] text-center text-[10.5px] font-medium text-white">Abrir boleto</a> : <div className="mt-[10px] rounded-[10px] bg-[#F5F1EF] p-[10px] text-center text-[9.5px] text-[#9A8A86]">Boleto ainda não disponível.</div>}</div>}
      {forma === "cartao" && <div className="mt-[10px] rounded-[17px] border border-[#E4D5D1] bg-white p-[13px]"><div className="border-b border-[#F1E8E5] pb-[10px]"><div className="text-[11.5px] font-semibold text-[#6B1F2E]">Pagar com cartão de crédito</div><div className="pt-[2px] text-[9.5px] text-[#9A8985]">O valor final e a taxa aplicável são calculados pelo financeiro no checkout seguro.</div></div><div className="flex items-center justify-between pt-[10px]"><span className="text-[10px] text-[#8A7B77]">Valor da parcela hoje</span><span className="font-heading text-[21px] font-semibold text-[#6B1F2E]">{brl(valores.valorHoje)}</span></div><div className="mt-[10px] rounded-[11px] border border-[#EEE3E0] bg-[#FBF7F6] px-[10px] py-[9px] text-[9.5px] leading-[1.48] text-[#756560]">Ao continuar, você será direcionada ao Mercado Pago com os valores oficiais calculados pelo sistema.</div><button type="button" disabled={cardBusy} onClick={onCard} className="mt-[10px] w-full rounded-[11px] bg-[#6B1F2E] p-[11px] text-[10.8px] font-semibold text-white disabled:opacity-50">{cardBusy ? "Abrindo checkout..." : "Continuar com cartão"}</button></div>}
    </div></div>;
}

function UploadSheet({ boleto, arquivo, setArquivo, onClose, onEnviar, enviando }: { boleto: Boleto; arquivo: File | null; setArquivo: (arquivo: File | null) => void; onClose: () => void; onEnviar: () => void; enviando: boolean }) {
  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[rgba(31,24,23,.56)] backdrop-blur-[3px]"><div className="w-full max-w-[430px] rounded-t-[28px] border-t border-white/80 bg-[#FCFAF9] px-[18px] pb-[calc(max(env(safe-area-inset-bottom),0px)+22px)] pt-[9px]"><div className="mx-auto mb-[14px] h-1 w-[38px] rounded-full bg-[#D9CECB]"/><div className="flex items-start justify-between gap-[13px]"><div><div className="text-[8.5px] font-bold uppercase tracking-[.18em] text-[#B18B4B]">Comprovante</div><div className="pt-[3px] font-heading text-[24px] font-semibold leading-[1.08] text-[#6B1F2E]">Já paguei a parcela {boleto.numero_parcela}</div><div className="pt-1 text-[10.8px] font-light text-[#8A7B77]">Envie o comprovante para validação do financeiro.</div></div><button type="button" onClick={onClose} className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#F1E9E6]"><svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#7E6F6B" strokeWidth="1.35"><path d="M2 2l8 8M10 2l-8 8"/></svg></button></div>
      <label className="mt-[14px] block w-full cursor-pointer rounded-[17px] border-[1.5px] border-dashed border-[#DCCECB] bg-white px-[13px] py-4 text-center"><input type="file" accept="image/*,application/pdf" className="hidden" onChange={(evento) => setArquivo(evento.target.files?.[0] ?? null)}/><span className="mx-auto flex h-[41px] w-[41px] items-center justify-center rounded-[14px] bg-[#F7EFED] text-[#6B1F2E]"><svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25"><path d="M10 13V3M6.5 6.5 10 3l3.5 3.5"/><path d="M4 10v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-5"/></svg></span><span className="block pt-2 text-[12px] font-medium text-[#4B3C39]">Escolha o comprovante do pagamento</span><span className="block pt-[3px] text-[9.8px] font-light text-[#9A8985]">Imagem ou PDF · arquivo legível e completo</span></label>
      {arquivo && <div className="mt-[9px] flex items-center gap-[9px] rounded-[12px] border border-[#DDEBE0] bg-[#F3F8F4] px-[11px] py-[10px]"><span className="flex h-[31px] w-[31px] items-center justify-center rounded-[10px] bg-[#E4F0E7] text-[#3F7D5B]"><svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M5 2.5h6l3 3v10H5z"/><path d="M11 2.5v3h3"/></svg></span><span className="min-w-0 flex-1"><span className="block truncate text-[10.8px] font-medium text-[#355F49]">{arquivo.name}</span><span className="block pt-px text-[9.2px] text-[#789080]">Pronto para enviar</span></span></div>}
      <div className="mt-[9px] rounded-[11px] border border-[#F0E0B7] bg-[#FFF8EA] px-[10px] py-[9px] text-[9.8px] leading-[1.5] text-[#7D642C]">O envio <b>não marca a parcela como paga imediatamente</b>. Ela ficará em análise e só irá para <b>Parcelas pagas</b> depois da confirmação do financeiro.</div><button type="button" disabled={!arquivo || enviando} onClick={onEnviar} className="mt-[10px] w-full rounded-[11px] bg-[#6B1F2E] p-[11px] text-[10.8px] font-semibold text-white disabled:opacity-40">{enviando ? "Enviando..." : "Enviar para análise"}</button>
    </div></div>;
}
