import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { deriveJourneySteps } from "@/lib/journeySteps";
import { centralApi, dataBr, moeda } from "./api";
import type { CartaoCliente, EstagioDrawer } from "./types";

type Aba = "processo" | "perfil" | "financeiro" | "jornada";

const TITULO_ESTAGIO: Record<EstagioDrawer, string> = {
  preEligibility: "Elegibilidade e solicitação",
  financialReview: "Levantamento financeiro",
  termsConfirmed: "Agenda de termos",
  financialRelease: "Liberação financeira",
  surgeryConfirmed: "Cirurgia confirmada",
  concluido: "Processo concluído",
};

export function ClienteProcessDrawer({ clienteId, onClose, onChanged }: { clienteId: string; onClose: () => void; onChanged: () => void }) {
  const [aba, setAba] = useState<Aba>("processo");
  const [estagio, setEstagio] = useState<EstagioDrawer | null>(null);
  const [cartao, setCartao] = useState<CartaoCliente | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function carregar() {
    try {
      const r = await centralApi.cliente(clienteId);
      setEstagio(r.estagio);
      setCartao(r.cartao);
      setErro(null);
    } catch (e: any) {
      setErro(e.message ?? "Não foi possível carregar este processo.");
    }
  }
  useEffect(() => { setAba("processo"); void carregar(); }, [clienteId]);

  async function acao(fn: () => Promise<any>, mensagem: string) {
    setOcupado(true);
    try { await fn(); toast.success(mensagem); await carregar(); onChanged(); }
    catch (e: any) { toast.error(e.message ?? "Não foi possível concluir a ação."); }
    finally { setOcupado(false); }
  }

  return <div style={{ position: "fixed", inset: 0, zIndex: 40 }}>
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(24,18,20,.22)" }} />
    <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "min(640px,96vw)", background: "var(--panel)", boxShadow: "-24px 0 55px rgba(40,22,27,.16)", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "18px 18px 0", borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: "var(--s0)", display: "grid", placeItems: "center", fontWeight: 800, color: "var(--bg)" }}>{(cartao?.nome ?? "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>{cartao?.nome ?? "Carregando…"}</h2>
            <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--soft)" }}>{cartao?.procedimento ?? "—"} {estagio ? `· ${TITULO_ESTAGIO[estagio]}` : ""}</p>
          </div>
          <button onClick={onClose} style={{ border: 0, background: "transparent", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 14, padding: 4, border: "1px solid var(--line)", borderRadius: 11, background: "var(--s0)" }}>
          {(["processo", "perfil", "financeiro", "jornada"] as Aba[]).map((a) => <button key={a} onClick={() => setAba(a)} style={{ flex: 1, height: 32, borderRadius: 8, border: 0, background: aba === a ? "var(--bg)" : "transparent", color: aba === a ? "#FFFDFC" : "var(--soft)", fontWeight: 800, fontSize: 10.5, textTransform: "uppercase" }}>{a}</button>)}
        </div>
      </div>

      <div style={{ padding: "14px 18px 100px", overflowY: "auto", flex: 1 }}>
        {erro && <div style={{ padding: 16, borderRadius: 12, background: "#fff0f2", color: "#9c2435", fontSize: 12 }}>{erro} <button onClick={() => void carregar()} style={{ marginLeft: 8, textDecoration: "underline", background: "transparent", border: 0, color: "inherit", cursor: "pointer" }}>Tentar novamente</button></div>}
        {!erro && !cartao && <div style={{ padding: 24, textAlign: "center", color: "var(--soft)" }}>Carregando…</div>}
        {!erro && cartao && estagio && <>
          {aba === "processo" && <ProcessoTab estagio={estagio} c={cartao} ocupado={ocupado} acao={acao} />}
          {aba === "perfil" && <PerfilTab c={cartao} />}
          {aba === "financeiro" && <FinanceiroTab c={cartao} />}
          {aba === "jornada" && <JornadaTab estagio={estagio} c={cartao} />}
        </>}
      </div>
    </div>
  </div>;
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return <section style={{ border: "1px solid var(--line)", borderRadius: 12, marginBottom: 10, background: "var(--panel)" }}>
    <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", fontSize: 11.5, fontWeight: 800 }}>{titulo}</div>
    <div style={{ padding: 12 }}>{children}</div>
  </section>;
}

function BotaoPrimario({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button disabled={disabled} onClick={onClick} style={{ height: 34, padding: "0 14px", borderRadius: 9, border: "1px solid var(--bg)", background: "var(--bg)", color: "#FFFDFC", fontWeight: 700, fontSize: 11.5, opacity: disabled ? 0.6 : 1 }}>{children}</button>;
}
function BotaoSecundario({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button disabled={disabled} onClick={onClick} style={{ height: 34, padding: "0 14px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink)", fontWeight: 700, fontSize: 11.5, opacity: disabled ? 0.6 : 1 }}>{children}</button>;
}

function ProcessoTab({ estagio, c, ocupado, acao }: { estagio: EstagioDrawer; c: CartaoCliente; ocupado: boolean; acao: (fn: () => Promise<any>, msg: string) => void }) {
  // Hooks sempre no topo, incondicionais: este componente tem vários
  // `return` antecipados por estágio, então um useState dentro de um ramo
  // condicional violaria as Rules of Hooks ao trocar de estágio sem
  // remontar o componente.
  const [previsaoInput, setPrevisaoInput] = useState(c.previsaoCirurgia ?? "");

  if (estagio === "preEligibility") {
    return <Secao titulo="Elegibilidade e solicitação">
      <p style={{ fontSize: 11.5, color: "var(--soft)" }}>{c.parcelasPagas} de {c.totalParcelas} parcelas pagas.</p>
      {c.parcelasFaltantes === 0
        ? <p style={{ fontSize: 11.5 }}>Cliente elegível. O botão <b>Solicitar liberação financeira</b> está disponível no app dela — a solicitação real precisa partir da cliente.</p>
        : <p style={{ fontSize: 11.5 }}>Falta{c.parcelasFaltantes === 1 ? "" : "m"} {c.parcelasFaltantes} parcela{c.parcelasFaltantes === 1 ? "" : "s"} para atingir o percentual mínimo.</p>}
    </Secao>;
  }
  if (estagio === "financialReview") {
    return <Secao titulo="Levantamento financeiro">
      <p style={{ fontSize: 11.5, color: "var(--soft)" }}>Solicitação recebida. Conclua o levantamento (carta de crédito, saldo restante, formas de custeio) na aba "Levantamentos" da Visão geral — o formulário completo continua no painel de Revisão financeira existente.</p>
    </Secao>;
  }
  if (estagio === "termsConfirmed") {
    return <Secao titulo="Agenda de termos">
      <p style={{ fontSize: 11.5 }}>Assinatura marcada para <b>{dataBr(c.dataTermos)} {c.horarioTermos}</b>{c.termosResponsavel ? ` · responsável: ${c.termosResponsavel}` : ""}.</p>
      <p style={{ fontSize: 10.5, color: "var(--soft)" }}>No dia agendado, confirme comparecimento e quitação na aba "Liberação financeira" da Visão geral (fila desta cliente após a data chegar).</p>
    </Secao>;
  }
  if (estagio === "financialRelease") {
    const previsaoConfirmada = Boolean(c.previsaoConfirmadaEm);
    const compareceu = c.comparecimentoStatus === "compareceu";
    const naoCompareceu = c.comparecimentoStatus === "nao_compareceu";
    const quitada = c.quitacaoStatus === "paga";
    const naoQuitada = c.quitacaoStatus === "nao_realizada";
    const ambosConfirmados = compareceu && quitada;

    if (!previsaoConfirmada) {
      return <Secao titulo="Previsão cirúrgica">
        <p style={{ fontSize: 11.5, color: "var(--soft)" }}>Confirme a previsão da agenda cirúrgica (data-alvo, respeita o teto mensal de R$ 100.000,00 em carta de crédito). Comparecimento e quitação só ficam disponíveis depois disso.</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <input type="date" value={previsaoInput} onChange={(e) => setPrevisaoInput(e.target.value)} style={{ height: 34, borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink)", padding: "0 10px" }} />
          <BotaoPrimario disabled={ocupado || !previsaoInput} onClick={() => acao(() => centralApi.confirmarPrevisao(c.agendamentoId!, previsaoInput), "Previsão cirúrgica confirmada.")}>Confirmar previsão</BotaoPrimario>
        </div>
      </Secao>;
    }

    return <Secao titulo="Liberação cirúrgica">
      <p style={{ fontSize: 10.5, color: "var(--soft)", marginBottom: 8 }}>Previsão confirmada: {dataBr(c.previsaoCirurgia)}</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <span style={{ flex: 1, borderRadius: 10, padding: 8, textAlign: "center", background: compareceu ? "#e5f5ec" : naoCompareceu ? "#fde8ec" : "#f5f1f2", color: compareceu ? "#0d754a" : naoCompareceu ? "#ad2d40" : "var(--soft)", fontSize: 10.5, fontWeight: 700 }}>{compareceu ? "✓ Comparecimento" : naoCompareceu ? "✕ Não compareceu" : "Comparecimento pendente"}</span>
        <span style={{ flex: 1, borderRadius: 10, padding: 8, textAlign: "center", background: quitada ? "#e5f5ec" : naoQuitada ? "#fde8ec" : "#f5f1f2", color: quitada ? "#0d754a" : naoQuitada ? "#ad2d40" : "var(--soft)", fontSize: 10.5, fontWeight: 700 }}>{quitada ? "✓ Quitação" : naoQuitada ? "✕ Não quitado" : "Quitação pendente"}</span>
      </div>

      {c.comparecimentoStatus === "pendente" && <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <BotaoPrimario disabled={ocupado} onClick={() => acao(() => centralApi.registrarComparecimento(c.agendamentoId!, true), "Comparecimento confirmado.")}>Confirmar comparecimento</BotaoPrimario>
        <BotaoSecundario disabled={ocupado} onClick={() => acao(() => centralApi.registrarComparecimento(c.agendamentoId!, false), "Ausência registrada. Termos reabertos para nova escolha.")}>Não compareceu</BotaoSecundario>
      </div>}
      {c.quitacaoStatus === "pendente" && <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <BotaoPrimario disabled={ocupado} onClick={() => acao(() => centralApi.registrarQuitacao(c.agendamentoId!, true), "Quitação confirmada.")}>Confirmar quitação</BotaoPrimario>
        <BotaoSecundario disabled={ocupado} onClick={() => acao(() => centralApi.registrarQuitacao(c.agendamentoId!, false), "Pendência de pagamento registrada. Termos reabertos para nova escolha.")}>Não quitado</BotaoSecundario>
      </div>}

      {ambosConfirmados && !c.agendaCirurgicaLiberadaEm && c.agendamentoId && <div style={{ marginTop: 14, border: "1px solid #ead7b2", borderRadius: 12, padding: 12, background: "#fffaf0" }}>
        <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", color: "#9b7b43" }}>Prazo automático</div>
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3 }}>Liberação prevista para {dataBr(c.prazoCirurgico)}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          <BotaoSecundario disabled={ocupado} onClick={() => acao(() => centralApi.ajustarPrazo(c.agendamentoId!, 1), "Prazo ajustado (+1 dia útil).")}>+1 dia útil</BotaoSecundario>
          <BotaoSecundario disabled={ocupado} onClick={() => acao(() => centralApi.ajustarPrazo(c.agendamentoId!, 3), "Prazo ajustado (+3 dias úteis).")}>+3 dias úteis</BotaoSecundario>
          <BotaoSecundario disabled={ocupado} onClick={() => acao(() => centralApi.ajustarPrazo(c.agendamentoId!, 5), "Prazo ajustado (+5 dias úteis).")}>+5 dias úteis</BotaoSecundario>
          <BotaoPrimario disabled={ocupado} onClick={() => acao(() => centralApi.liberarAgendaCirurgicaAgora(c.agendamentoId!), "Agenda cirúrgica liberada no app da cliente.")}>Liberar agenda cirúrgica agora</BotaoPrimario>
        </div>
      </div>}
      {ambosConfirmados && c.agendaCirurgicaLiberadaEm && <p style={{ marginTop: 12, fontSize: 11.5, color: "var(--ok)", fontWeight: 700 }}>✓ Agenda cirúrgica liberada — disponível no app da cliente.</p>}
    </Secao>;
  }
  if (estagio === "surgeryConfirmed" || estagio === "concluido") {
    return <Secao titulo={estagio === "concluido" ? "Cirurgia confirmada / processo concluído" : "Cirurgia confirmada"}>
      <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, background: c.pagamentoCirurgiaConfirmadoEm ? "#f5fbf7" : "var(--s0)" }}>
        <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", color: "var(--soft)" }}>{c.pagamentoCirurgiaConfirmadoEm ? "Cirurgia confirmada · processo concluído" : "Cirurgia confirmada"}</div>
        <div style={{ fontSize: 15, fontWeight: 800, marginTop: 3 }}>{dataBr(c.dataCirurgia)}</div>
        <div style={{ fontSize: 11, color: "var(--soft)", marginTop: 3 }}>Carta de crédito: {moeda(c.cartaDeCredito)}</div>
      </div>
      {!c.pagamentoCirurgiaConfirmadoEm && c.agendamentoId && <div style={{ marginTop: 10 }}>
        <BotaoPrimario disabled={ocupado} onClick={() => acao(() => centralApi.confirmarPagamentoCirurgia(c.agendamentoId!), "Pagamento confirmado. Processo concluído.")}>Confirmar pagamento da cirurgia</BotaoPrimario>
      </div>}
      {c.pagamentoCirurgiaConfirmadoEm && <p style={{ marginTop: 10, fontSize: 11.5, color: "var(--ok)", fontWeight: 700 }}>✓ Pagamento confirmado em {dataBr(c.pagamentoCirurgiaConfirmadoEm)}. Processo arquivado na Agenda Cirúrgica.</p>}
    </Secao>;
  }
  return null;
}

function PerfilTab({ c }: { c: CartaoCliente }) {
  return <Secao titulo="Perfil">
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <div><label style={{ display: "block", fontSize: 9, color: "var(--soft)" }}>Nome</label><strong style={{ fontSize: 11.5 }}>{c.nome}</strong></div>
      <div><label style={{ display: "block", fontSize: 9, color: "var(--soft)" }}>CPF</label><strong style={{ fontSize: 11.5 }}>{c.cpf ?? "—"}</strong></div>
      <div><label style={{ display: "block", fontSize: 9, color: "var(--soft)" }}>Procedimento</label><strong style={{ fontSize: 11.5 }}>{c.procedimento ?? "—"}</strong></div>
      <div><label style={{ display: "block", fontSize: 9, color: "var(--soft)" }}>Carta de crédito</label><strong style={{ fontSize: 11.5 }}>{moeda(c.cartaDeCredito)}</strong></div>
    </div>
  </Secao>;
}

function FinanceiroTab({ c }: { c: CartaoCliente }) {
  const quitacaoLabel = c.quitacaoStatus === "paga" ? "Confirmada" : c.quitacaoStatus === "nao_realizada" ? "Não realizada" : "Pendente";
  return <Secao titulo="Financeiro">
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
      <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 9, background: "var(--s0)" }}><label style={{ display: "block", fontSize: 8, color: "var(--soft)" }}>Parcelas pagas</label><strong style={{ fontSize: 12 }}>{c.parcelasPagas} de {c.totalParcelas}</strong></div>
      <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 9, background: "var(--s0)" }}><label style={{ display: "block", fontSize: 8, color: "var(--soft)" }}>Carta de crédito</label><strong style={{ fontSize: 12 }}>{moeda(c.cartaDeCredito)}</strong></div>
    </div>
    <div style={{ fontSize: 11.5 }}>Quitação: <span style={{ color: c.quitacaoStatus === "paga" ? "var(--ok)" : "var(--soft)", fontWeight: 700 }}>{quitacaoLabel}</span></div>
    <p style={{ marginTop: 8, fontSize: 10, color: "var(--soft)" }}>A lista completa de parcelas (envio de comprovantes, aprovação/rejeição) continua na área Financeiro do painel administrativo.</p>
  </Secao>;
}

function JornadaTab({ estagio, c }: { estagio: EstagioDrawer; c: CartaoCliente }) {
  const percentual = c.totalParcelas > 0 ? Math.round((c.parcelasPagas / c.totalParcelas) * 100) : 0;
  const passos = deriveJourneySteps({
    percentualPagamento: percentual,
    percentualAtingido: c.parcelasFaltantes === 0,
    statusRevisao: estagio === "preEligibility" ? null : "aprovada",
    custeioStatus: c.quitacaoStatus === "paga" ? "aprovada" : estagio === "financialReview" || estagio === "preEligibility" ? null : "pendente",
    agendada: Boolean(c.dataTermos),
    termosAssinados: c.comparecimentoStatus === "compareceu",
    agendaCirurgicaLiberada: Boolean(c.agendaCirurgicaLiberadaEm),
    cirurgiaAgendada: Boolean(c.dataCirurgia),
    cirurgiaRealizada: Boolean(c.pagamentoCirurgiaConfirmadoEm),
    previsaoLiberacaoFinanceira: c.dataCirurgia,
    agendaCirurgicaLiberarEm: c.prazoCirurgico,
  });
  return <Secao titulo="Jornada">
    <div style={{ display: "grid", gap: 8 }}>
      {passos.map((p) => <div key={p.id} style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: 8 }}>
        <div style={{ width: 22, height: 22, borderRadius: "50%", display: "grid", placeItems: "center", background: p.status === "done" ? "#e5f5ec" : p.status === "current" ? "var(--bg)" : "#f2ecee", color: p.status === "done" ? "#0d754a" : p.status === "current" ? "#fff" : "var(--soft)", fontSize: 10, fontWeight: 800 }}>{p.status === "done" ? "✓" : ""}</div>
        <div>
          <b style={{ fontSize: 11 }}>{p.title}</b>
          <p style={{ margin: "2px 0 0", fontSize: 9.5, color: "var(--soft)" }}>{p.description}</p>
        </div>
      </div>)}
    </div>
  </Secao>;
}
