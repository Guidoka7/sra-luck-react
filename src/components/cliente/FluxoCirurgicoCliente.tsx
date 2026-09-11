"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, CheckCircle2, Clock3, CreditCard, FileSignature, LockKeyhole, Sparkles, WalletCards } from "lucide-react";
import { AgendaBloqueadaPercentual } from "@/components/cliente/AgendaBloqueadaPercentual";
import { CalendarioAgendamento, type DataDisponivel } from "@/components/cliente/CalendarioAgendamento";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type CreditStage =
  | "nova_venda"
  | "aguardando_conferencia"
  | "formacao_saldo"
  | "proxima_meta"
  | "meta_atingida"
  | "levantamento_financeiro"
  | "forma_pagamento_liberada"
  | "termos_agendados"
  | "aguardando_quitacao"
  | "quitado"
  | "agenda_cirurgica_liberada"
  | "cirurgia_agendada"
  | "concluido"
  | "cancelado";

interface Contract {
  id: string;
  codigo: string;
  modalidade: "flex" | "100_boleto";
  percentual_minimo: number | string;
  etapa: CreditStage;
  saldo_final_apurado?: number | string | null;
  formas_quitacao_disponiveis?: string[] | null;
  forma_quitacao?: string | null;
  pagar_no_dia_termos?: boolean | null;
  levantamento_prazo_ate?: string | null;
  termos_assinados_em?: string | null;
  agenda_cirurgica_liberar_em?: string | null;
  cirurgia_em?: string | null;
}

interface JourneyData {
  contrato: Contract | null;
  percent: number;
  paidInstallments: number;
  totalInstallments: number;
  requiredInstallments: number;
  remainingInstallments: number;
  remaining: number;
}

interface WindowItem {
  id: string;
  tipo: "termos" | "cirurgia";
  data: string;
  horario_inicio: string;
  vagasRestantes: number;
}

interface Props {
  fallback: ReactNode;
  datasLegadas: DataDisponivel[];
}

function brDate(value?: string | null) {
  if (!value) return "—";
  const [ano, mes, dia] = value.slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : value;
}

function moeda(value?: number | string | null) {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function labelForma(value: string) {
  const labels: Record<string, string> = {
    pix: "PIX",
    cartao: "Cartão de crédito",
    credito: "Cartão de crédito",
    cheque: "Cheque",
    cheques: "Cheque",
    boleto: "Boleto",
    boleto_100: "Boleto",
  };
  return labels[value] ?? value;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({})) as T & { erro?: string };
  if (!response.ok) throw new Error(body.erro ?? "Não foi possível concluir a operação.");
  return body;
}

function agruparJanelas(janelas: WindowItem[]): DataDisponivel[] {
  const porData = new Map<string, DataDisponivel>();
  for (const janela of janelas) {
    const atual = porData.get(janela.data) ?? {
      id: janela.data,
      data: janela.data,
      vagasRestantes: 0,
      horarios: [],
    };
    atual.vagasRestantes += Number(janela.vagasRestantes ?? 0);
    atual.horarios?.push({
      id: janela.id,
      horario: String(janela.horario_inicio).slice(0, 5),
      vagasRestantes: Number(janela.vagasRestantes ?? 0),
    });
    porData.set(janela.data, atual);
  }
  return [...porData.values()].sort((a, b) => a.data.localeCompare(b.data));
}

export function FluxoCirurgicoCliente({ fallback, datasLegadas }: Props) {
  const [journey, setJourney] = useState<JourneyData | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);
  const [janelas, setJanelas] = useState<WindowItem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [modalPagamento, setModalPagamento] = useState(false);
  const [forma, setForma] = useState("");
  const [quando, setQuando] = useState<"agora" | "dia_termos">("agora");

  const carregar = useCallback(async () => {
    try {
      const response = await fetch("/api/cliente/journey", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 404) {
        setIndisponivel(true);
        return;
      }
      const body = await response.json().catch(() => ({})) as JourneyData & { erro?: string };
      if (!response.ok || !body.contrato) {
        if (response.status >= 500) setIndisponivel(true);
        else setErro(body.erro ?? "Não foi possível carregar esta etapa.");
        return;
      }
      setJourney(body);
      setIndisponivel(false);
      setErro(null);
    } catch {
      setIndisponivel(true);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const contrato = journey?.contrato ?? null;
  const tipoAgenda = contrato?.etapa === "agenda_cirurgica_liberada" || contrato?.etapa === "cirurgia_agendada" ? "cirurgia" : "termos";
  const precisaJanelas = Boolean(
    contrato && (
      (contrato.etapa === "forma_pagamento_liberada" && contrato.forma_quitacao)
      || contrato.etapa === "agenda_cirurgica_liberada"
    )
  );

  useEffect(() => {
    if (!precisaJanelas) {
      setJanelas([]);
      return;
    }
    let cancelado = false;
    requestJson<{ janelas: WindowItem[] }>(`/api/cliente/journey/windows?tipo=${tipoAgenda}`)
      .then((body) => { if (!cancelado) setJanelas(body.janelas ?? []); })
      .catch((error: unknown) => { if (!cancelado) setErro(error instanceof Error ? error.message : "Não foi possível carregar a agenda."); });
    return () => { cancelado = true; };
  }, [precisaJanelas, tipoAgenda]);

  const datasJornada = useMemo(() => agruparJanelas(janelas), [janelas]);

  if (carregando) return fallback;
  if (indisponivel || !journey || !contrato) return fallback;

  const percentualMinimo = Number(contrato.percentual_minimo ?? 60);
  const parcelasNecessarias = journey.requiredInstallments || Math.ceil((journey.totalInstallments * percentualMinimo) / 100);

  async function solicitarTermos() {
    setBusy(true);
    setErro(null);
    try {
      await requestJson("/api/cliente/journey/request-terms", { method: "POST", body: "{}" });
      await carregar();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível solicitar os termos.");
    } finally {
      setBusy(false);
    }
  }

  async function salvarPagamento() {
    if (!forma) return;
    setBusy(true);
    setErro(null);
    try {
      await requestJson("/api/cliente/journey/payment-choice", {
        method: "POST",
        body: JSON.stringify({ forma, quando }),
      });
      setModalPagamento(false);
      await carregar();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível salvar a forma de pagamento.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmarJanela(janelaId: string) {
    setBusy(true);
    setErro(null);
    try {
      await requestJson("/api/cliente/journey/schedule", {
        method: "POST",
        body: JSON.stringify({ tipo: tipoAgenda, janelaId }),
      });
      await carregar();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível confirmar o agendamento.");
    } finally {
      setBusy(false);
    }
  }

  const mensagemErro = erro ? <div role="alert" className="rounded-2xl border border-alert/20 bg-alert/5 px-4 py-3 text-sm text-alert">{erro}</div> : null;

  if (["nova_venda", "aguardando_conferencia", "formacao_saldo", "proxima_meta"].includes(contrato.etapa)) {
    return <div className="flex flex-col gap-4"><AgendaBloqueadaPercentual percentual={percentualMinimo} parcelasNecessarias={parcelasNecessarias || null} datas={datasLegadas} etapa="percentual" />{mensagemErro}</div>;
  }

  if (contrato.etapa === "meta_atingida") {
    return (
      <div className="flex flex-col gap-4 animate-fadeUp">
        <Card className="overflow-hidden border border-gold/25 bg-white/85 p-0">
          <div className="border-b border-rose/10 bg-blush/25 px-4 py-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold"><FileSignature className="h-5 w-5" /></span>
              <div><p className="text-[0.58rem] font-bold uppercase tracking-label text-gold">Próxima etapa liberada</p><h2 className="mt-1 font-heading text-lg font-semibold text-burgundy">Você já pode solicitar seus termos cirúrgicos</h2></div>
            </div>
          </div>
          <div className="p-4">
            <p className="text-sm leading-relaxed text-clay/65">Você quitou <strong className="text-burgundy">{journey.paidInstallments} de {journey.totalInstallments} parcelas</strong> e atingiu o percentual necessário. Ao solicitar, o financeiro fará seu levantamento em até 5 dias úteis.</p>
            <Button className="mt-4 w-full" loading={busy} onClick={() => void solicitarTermos()}><Sparkles className="h-4 w-4" /> Solicitar agendamento dos termos cirúrgicos</Button>
          </div>
        </Card>
        {mensagemErro}
      </div>
    );
  }

  if (contrato.etapa === "levantamento_financeiro") {
    return (
      <div className="flex flex-col gap-4">
        <AgendaBloqueadaPercentual percentual={percentualMinimo} parcelasNecessarias={parcelasNecessarias || null} datas={datasLegadas} etapa="levantamento" />
        {contrato.levantamento_prazo_ate && <Card className="border border-gold/15 bg-gold/[0.04] p-4"><div className="flex items-center gap-2 text-gold"><Clock3 className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-label">Prazo do levantamento</span></div><p className="mt-2 text-sm text-clay/65">Previsão de conclusão: <strong className="text-burgundy">{brDate(contrato.levantamento_prazo_ate)}</strong>.</p></Card>}
        {mensagemErro}
      </div>
    );
  }

  if (contrato.etapa === "forma_pagamento_liberada") {
    const formas = contrato.formas_quitacao_disponiveis ?? [];
    const escolhaRealizada = Boolean(contrato.forma_quitacao);
    return (
      <div className="flex flex-col gap-4 animate-fadeUp">
        <Card className="border border-success/15 bg-success/[0.035] p-4">
          <div className="flex items-center gap-2 text-success"><CheckCircle2 className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-label">Levantamento aprovado</span></div>
          <h2 className="mt-2 font-heading text-lg font-semibold text-burgundy">Escolha como pagar o valor restante</h2>
          <p className="mt-1 text-sm leading-relaxed text-clay/65">Saldo apurado pelo financeiro: <strong className="text-burgundy">{moeda(contrato.saldo_final_apurado)}</strong>. As opções abaixo foram liberadas especificamente para o seu contrato.</p>
          <Button className="mt-4 w-full" onClick={() => { setForma(contrato.forma_quitacao ?? formas[0] ?? ""); setQuando(contrato.pagar_no_dia_termos ? "dia_termos" : "agora"); setModalPagamento(true); }}><CreditCard className="h-4 w-4" /> {escolhaRealizada ? "Alterar forma de pagamento" : "Escolher forma de pagamento"}</Button>
        </Card>

        {escolhaRealizada && (
          <Card className="p-3.5 sm:p-4">
            <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-gold/20 bg-gold/[0.06] px-3 py-2.5">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
              <div><p className="text-[0.72rem] font-semibold text-burgundy">Escolha a data da assinatura dos termos cirúrgicos</p><p className="mt-0.5 text-[0.6rem] leading-relaxed text-clay/55">Aparecem somente datas e horários liberados pela equipe.</p></div>
            </div>
            {datasJornada.length ? <CalendarioAgendamento datas={datasJornada} onConfirmar={(id) => void confirmarJanela(id)} confirmando={busy} contexto="termos" /> : <p className="p-6 text-center text-sm text-clay/50">Ainda não há datas disponíveis no momento.</p>}
          </Card>
        )}
        {mensagemErro}

        {modalPagamento && (
          <div className="fixed inset-0 z-[80] flex items-end justify-center bg-burgundy-dark/55 p-3 backdrop-blur-sm sm:items-center">
            <section className="w-full max-w-md rounded-[28px] border border-rose/20 bg-bloom p-5 shadow-[0_28px_90px_rgba(35,15,22,.35)] sm:p-6">
              <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-burgundy/8 text-burgundy"><WalletCards className="h-5 w-5" /></span><div><p className="text-[0.58rem] font-bold uppercase tracking-label text-rose">Valor restante</p><h2 className="font-heading text-xl font-semibold text-burgundy">{moeda(contrato.saldo_final_apurado)}</h2></div></div>
              <div className="mt-5 space-y-2"><p className="text-[0.62rem] font-bold uppercase tracking-label text-clay/55">Forma de pagamento</p>{formas.map((item) => <label key={item} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm ${forma === item ? "border-burgundy bg-burgundy/[0.04] text-burgundy" : "border-rose/15 bg-white/70 text-clay/70"}`}><input type="radio" name="forma-quitacao" checked={forma === item} onChange={() => setForma(item)} /><span>{labelForma(item)}</span></label>)}</div>
              <div className="mt-5 space-y-2"><p className="text-[0.62rem] font-bold uppercase tracking-label text-clay/55">Quando deseja pagar?</p><label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm ${quando === "agora" ? "border-burgundy bg-burgundy/[0.04] text-burgundy" : "border-rose/15 bg-white/70 text-clay/70"}`}><input type="radio" name="quando" checked={quando === "agora"} onChange={() => setQuando("agora")} /> Pagar agora</label><label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm ${quando === "dia_termos" ? "border-burgundy bg-burgundy/[0.04] text-burgundy" : "border-rose/15 bg-white/70 text-clay/70"}`}><input type="radio" name="quando" checked={quando === "dia_termos"} onChange={() => setQuando("dia_termos")} /> Pagar no dia da assinatura dos termos</label></div>
              <div className="mt-6 grid grid-cols-2 gap-2"><button type="button" onClick={() => setModalPagamento(false)} className="rounded-full border border-rose/20 bg-white px-4 py-3 text-xs font-bold uppercase tracking-label text-burgundy">Cancelar</button><Button disabled={!forma} loading={busy} onClick={() => void salvarPagamento()}>Confirmar</Button></div>
            </section>
          </div>
        )}
      </div>
    );
  }

  if (contrato.etapa === "termos_agendados") {
    return <div className="flex flex-col gap-4 animate-fadeUp"><Card className="border border-success/15 bg-success/[0.04] p-4"><div className="flex items-center gap-2 text-success"><CheckCircle2 className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-label">Assinatura agendada</span></div><h2 className="mt-2 font-heading text-lg font-semibold text-burgundy">Sua data dos termos está confirmada</h2><p className="mt-1 text-sm leading-relaxed text-clay/65">No dia da assinatura, o saldo restante precisa estar quitado. Se não conseguir concluir a quitação, fale com a equipe para reagendar sem perder o acompanhamento do processo.</p></Card>{mensagemErro}</div>;
  }

  if (contrato.etapa === "aguardando_quitacao") {
    return <div className="flex flex-col gap-4 animate-fadeUp"><Card className="border border-gold/20 bg-gold/[0.04] p-4"><div className="flex items-center gap-2 text-gold"><LockKeyhole className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-label">Quitação final</span></div><h2 className="mt-2 font-heading text-lg font-semibold text-burgundy">Aguardando confirmação do saldo restante</h2><p className="mt-1 text-sm leading-relaxed text-clay/65">A agenda cirúrgica será liberada somente após os termos assinados e a quitação final confirmada.</p></Card>{mensagemErro}</div>;
  }

  if (contrato.etapa === "quitado") {
    return <div className="flex flex-col gap-4 animate-fadeUp"><Card className="border border-success/15 bg-success/[0.04] p-4"><div className="flex items-center gap-2 text-success"><CheckCircle2 className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-label">Saldo quitado</span></div><h2 className="mt-2 font-heading text-lg font-semibold text-burgundy">Agora é só aguardar a liberação da agenda cirúrgica</h2><p className="mt-1 text-sm leading-relaxed text-clay/65">Com os termos assinados e o saldo quitado, a agenda será liberada após 5 dias úteis{contrato.agenda_cirurgica_liberar_em ? `, em ${brDate(contrato.agenda_cirurgica_liberar_em)}` : ""}.</p></Card>{mensagemErro}</div>;
  }

  if (contrato.etapa === "agenda_cirurgica_liberada") {
    return <div className="flex flex-col gap-4 animate-fadeUp"><Card className="p-3.5 sm:p-4"><div className="mb-3 flex items-start gap-2.5 rounded-xl border border-success/20 bg-success/[0.05] px-3 py-2.5"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-success" /><div><p className="text-[0.72rem] font-semibold text-burgundy">Sua agenda cirúrgica está liberada</p><p className="mt-0.5 text-[0.6rem] leading-relaxed text-clay/55">Escolha uma das datas e horários disponibilizados pela equipe.</p></div></div>{datasJornada.length ? <CalendarioAgendamento datas={datasJornada} onConfirmar={(id) => void confirmarJanela(id)} confirmando={busy} contexto="cirurgia" /> : <p className="p-6 text-center text-sm text-clay/50">Ainda não há datas cirúrgicas disponíveis no momento.</p>}</Card>{mensagemErro}</div>;
  }

  if (contrato.etapa === "cirurgia_agendada") {
    return <div className="flex flex-col gap-4 animate-fadeUp"><Card className="border border-success/15 bg-success/[0.04] p-4"><div className="flex items-center gap-2 text-success"><CheckCircle2 className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-label">Cirurgia agendada</span></div><h2 className="mt-2 font-heading text-lg font-semibold text-burgundy">Sua cirurgia está confirmada</h2><p className="mt-1 text-sm leading-relaxed text-clay/65">Data registrada: <strong className="text-burgundy">{brDate(contrato.cirurgia_em)}</strong>. Continue acompanhando as orientações da equipe pelo aplicativo.</p></Card>{mensagemErro}</div>;
  }

  if (contrato.etapa === "concluido") {
    return <Card className="border border-success/15 bg-success/[0.04] p-5 text-center"><CheckCircle2 className="mx-auto h-6 w-6 text-success" /><h2 className="mt-2 font-heading text-xl font-semibold text-burgundy">Processo concluído</h2><p className="mt-2 text-sm text-clay/65">Sua jornada foi concluída. O histórico permanece disponível no aplicativo.</p></Card>;
  }

  if (contrato.etapa === "cancelado") {
    return <Card className="border border-alert/20 bg-alert/[0.04] p-5 text-center"><h2 className="font-heading text-lg font-semibold text-burgundy">Contrato encerrado</h2><p className="mt-2 text-sm text-clay/65">Entre em contato com a equipe Sra. Luck para mais informações.</p></Card>;
  }

  return fallback;
}
