import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { centralApi, dataBr, moeda, rotuloFormaCusteio } from "./api";
import { sugerirPrevisaoCirurgica } from "./ProcessoTab";
import type { CartaoCliente } from "./types";
import { V46Modal } from "./V46Modal";

/**
 * Fluxos guiados da Agenda. Cada passo chama a mesma RPC de sempre, na ordem
 * que o banco exige (previsão → comparecimento → quitação); se um passo falha,
 * os anteriores continuam gravados e o modal mostra exatamente onde parou.
 */

type Passo = { id: string; rotulo: string; executar: () => Promise<unknown> };
type Resultado = { id: string; rotulo: string; ok: boolean; erro?: string };

async function executarPassos(passos: Passo[]): Promise<Resultado[]> {
  const resultados: Resultado[] = [];
  for (const passo of passos) {
    try {
      await passo.executar();
      resultados.push({ id: passo.id, rotulo: passo.rotulo, ok: true });
    } catch (e) {
      resultados.push({ id: passo.id, rotulo: passo.rotulo, ok: false, erro: e instanceof Error ? e.message : "Não foi possível concluir." });
      break;
    }
  }
  return resultados;
}

function ListaResultados({ resultados, total }: { resultados: Resultado[]; total: number }) {
  return <ul className="ag-passos-resultado" aria-live="polite">
    {resultados.map((r) => <li key={r.id} className={r.ok ? "is-ok" : "is-erro"}><b>{r.ok ? "✓" : "✕"} {r.rotulo}</b>{r.erro && <span>{r.erro}</span>}</li>)}
    {resultados.length < total && resultados.some((r) => !r.ok) && <li className="is-pendente"><b>Os passos seguintes não foram executados.</b><span>Corrija o problema e tente de novo: o que já foi gravado não se repete.</span></li>}
  </ul>;
}

function Campo({ rotulo, dica, children }: { rotulo: string; dica?: ReactNode; children: ReactNode }) {
  return <div className="field ag-campo"><label>{rotulo}</label>{children}{dica && <small>{dica}</small>}</div>;
}

function Opcoes<T extends string>({ nome, valor, opcoes, onChange }: { nome: string; valor: T | null; opcoes: { id: T; rotulo: string; detalhe?: string; perigo?: boolean }[]; onChange: (v: T) => void }) {
  return <div className="ag-opcoes" role="radiogroup" aria-label={nome}>
    {opcoes.map((o) => <button key={o.id} type="button" role="radio" aria-checked={valor === o.id} className={`ag-opcao${valor === o.id ? " is-sel" : ""}${o.perigo ? " is-perigo" : ""}`} onClick={() => onChange(o.id)}>
      <b>{o.rotulo}</b>{o.detalhe && <small>{o.detalhe}</small>}
    </button>)}
  </div>;
}

/** Etapa 3: preparar o atendimento antes do dia (responsável + previsão cirúrgica). */
export function PrepararAtendimentoModal({ c, sugestoes, hoje, onClose, onDone }: {
  c: CartaoCliente; sugestoes: string[]; hoje: string; onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const [responsavel, setResponsavel] = useState(c.termosResponsavel ?? "");
  const previsaoInicial = sugerirPrevisaoCirurgica(c);
  const [previsao, setPrevisao] = useState(previsaoInicial);
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const minimo = c.dataTermos && c.dataTermos > hoje ? c.dataTermos : hoje;

  async function salvar() {
    if (!c.agendamentoId || enviando) return;
    const passos: Passo[] = [];
    const nome = responsavel.trim();
    if (nome && nome !== (c.termosResponsavel ?? "")) passos.push({ id: "responsavel", rotulo: `Responsável: ${nome}`, executar: () => centralApi.definirResponsavelTermos(c.agendamentoId!, nome) });
    if (previsao && (!c.previsaoConfirmadaEm || previsao !== c.previsaoCirurgia?.slice(0, 10))) passos.push({ id: "previsao", rotulo: `Previsão cirúrgica: ${dataBr(previsao)}`, executar: () => centralApi.confirmarPrevisao(c.agendamentoId!, previsao) });
    if (!passos.length) { toast.info("Nada para alterar."); return; }
    setEnviando(true);
    const r = await executarPassos(passos);
    setResultados(r);
    setEnviando(false);
    await onDone();
    if (r.every((x) => x.ok)) { toast.success("Atendimento preparado."); onClose(); }
  }

  return <V46Modal titulo="Preparar atendimento dos termos" subtitulo={`${c.nome} · ${dataBr(c.dataTermos)}${c.horarioTermos ? ` às ${c.horarioTermos}` : ""}`} onClose={onClose} bloqueado={enviando} footer={<>
    <button type="button" className="secondary-btn" onClick={onClose} disabled={enviando}>Cancelar</button>
    <button type="button" className="primary-btn" onClick={() => void salvar()} disabled={enviando} aria-busy={enviando}>{enviando ? "Salvando…" : "Salvar preparação"}</button>
  </>}>
    <div className="drawer-form">
      <Campo rotulo="Responsável pela assinatura" dica="Quem da equipe conduz o atendimento no dia.">
        <input list="ag-responsaveis" value={responsavel} onChange={(e) => setResponsavel(e.target.value)} placeholder="Nome do responsável" maxLength={120} autoComplete="off" />
        <datalist id="ag-responsaveis">{sugestoes.map((n) => <option key={n} value={n} />)}</datalist>
      </Campo>
      <Campo rotulo="Previsão cirúrgica" dica={<>Data mínima para a cirurgia (sugestão: data dos termos + intervalo mínimo). Ao confirmar, o sistema já reserva o valor da carta ({moeda(c.cartaDeCredito)}) no teto do mês. {c.previsaoConfirmadaEm ? `Confirmada para ${dataBr(c.previsaoCirurgia)}.` : "Precisa estar confirmada antes de registrar o comparecimento."}</>}>
        <input type="date" value={previsao} min={minimo} onChange={(e) => setPrevisao(e.target.value)} />
      </Campo>
    </div>
    {resultados && <ListaResultados resultados={resultados} total={resultados.length} />}
  </V46Modal>;
}

type Comparecimento = "compareceu" | "faltou";
type Quitacao = "recebida" | "nao_recebida" | "depois";

/** Etapa 4: registrar o atendimento dos termos em um único passo guiado. */
export function RegistrarAtendimentoModal({ c, hoje, onClose, onDone }: {
  c: CartaoCliente; hoje: string; onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const precisaPrevisao = !c.previsaoConfirmadaEm;
  const jaCompareceu = c.comparecimentoStatus === "compareceu";
  const jaQuitou = c.quitacaoStatus === "paga";
  const [previsao, setPrevisao] = useState(sugerirPrevisaoCirurgica(c));
  const [comparecimento, setComparecimento] = useState<Comparecimento | null>(jaCompareceu ? "compareceu" : null);
  const [quitacao, setQuitacao] = useState<Quitacao | null>(jaQuitou ? "recebida" : null);
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [totalPassos, setTotalPassos] = useState(0);
  const faltou = comparecimento === "faltou";
  const minimo = c.dataTermos && c.dataTermos > hoje ? c.dataTermos : hoje;

  const podeSalvar = !enviando && (jaCompareceu || comparecimento) && (faltou || jaQuitou || quitacao) && (!precisaPrevisao || faltou || Boolean(previsao));

  async function salvar() {
    if (!c.agendamentoId || !podeSalvar) return;
    const id = c.agendamentoId;
    const passos: Passo[] = [];
    if (faltou) {
      passos.push({ id: "ausencia", rotulo: "Ausência registrada", executar: () => centralApi.registrarComparecimento(id, false) });
    } else {
      if (precisaPrevisao) passos.push({ id: "previsao", rotulo: `Previsão cirúrgica ${dataBr(previsao)}`, executar: () => centralApi.confirmarPrevisao(id, previsao) });
      if (!jaCompareceu) passos.push({ id: "comparecimento", rotulo: "Comparecimento e assinatura dos termos", executar: () => centralApi.registrarComparecimento(id, true) });
      if (!jaQuitou && quitacao === "recebida") passos.push({ id: "quitacao", rotulo: "Quitação do saldo", executar: () => centralApi.registrarQuitacao(id, true) });
      if (!jaQuitou && quitacao === "nao_recebida") passos.push({ id: "sem-quitacao", rotulo: "Saldo não quitado", executar: () => centralApi.registrarQuitacao(id, false) });
    }
    if (!passos.length) { toast.info("Nada para registrar."); return; }
    setEnviando(true);
    setTotalPassos(passos.length);
    const r = await executarPassos(passos);
    setResultados(r);
    setEnviando(false);
    await onDone();
    if (r.every((x) => x.ok)) {
      toast.success(faltou ? "Ausência registrada. A cliente volta a escolher uma data no app."
        : quitacao === "nao_recebida" ? "Saldo não quitado registrado. A cliente volta a escolher uma data no app."
          : quitacao === "depois" ? "Atendimento registrado. Falta confirmar a quitação."
            : "Atendimento registrado. O prazo de liberação da agenda cirúrgica começou.");
      onClose();
    }
  }

  const cancela = faltou || quitacao === "nao_recebida";

  return <V46Modal titulo="Registrar atendimento dos termos" subtitulo={`${c.nome} · termos em ${dataBr(c.dataTermos)}${c.horarioTermos ? ` às ${c.horarioTermos}` : ""}`} onClose={onClose} bloqueado={enviando} className="ag-modal-atendimento" footer={<>
    <button type="button" className="secondary-btn" onClick={onClose} disabled={enviando}>Cancelar</button>
    <button type="button" className={cancela ? "danger-btn" : "primary-btn"} onClick={() => void salvar()} disabled={!podeSalvar} aria-busy={enviando}>{enviando ? "Registrando…" : cancela ? "Registrar e cancelar agendamento" : "Registrar atendimento"}</button>
  </>}>
    <ol className="ag-etapas-modal">
      <li>
        <span className="ag-etapas-num">1</span>
        <div>
          <b>A cliente compareceu e assinou os termos?</b>
          {jaCompareceu
            ? <p className="ag-feito">✓ Comparecimento já registrado.</p>
            : <Opcoes nome="Comparecimento" valor={comparecimento} onChange={setComparecimento} opcoes={[
              { id: "compareceu", rotulo: "Sim, compareceu", detalhe: "Registra a assinatura dos termos" },
              { id: "faltou", rotulo: "Não compareceu", detalhe: "Cancela este agendamento", perigo: true },
            ]} />}
        </div>
      </li>
      {!faltou && precisaPrevisao && <li>
        <span className="ag-etapas-num">2</span>
        <div>
          <b>Previsão cirúrgica</b>
          <p>Data mínima da cirurgia. Obrigatória antes do comparecimento; reserva {moeda(c.cartaDeCredito)} no teto do mês.</p>
          <input type="date" className="ag-input" value={previsao} min={minimo} onChange={(e) => setPrevisao(e.target.value)} aria-label="Previsão cirúrgica" />
        </div>
      </li>}
      {!faltou && <li>
        <span className="ag-etapas-num">{precisaPrevisao ? 3 : 2}</span>
        <div>
          <b>Quitação do saldo{c.custeioSaldo != null ? ` · ${moeda(c.custeioSaldo)}` : ""}{c.custeioForma ? ` via ${rotuloFormaCusteio(c.custeioForma)}` : ""}</b>
          {jaQuitou
            ? <p className="ag-feito">✓ Quitação já confirmada.</p>
            : <Opcoes nome="Quitação" valor={quitacao} onChange={setQuitacao} opcoes={[
              { id: "recebida", rotulo: "Recebida", detalhe: "Baixa as parcelas em aberto" },
              { id: "depois", rotulo: "Registrar depois", detalhe: "O prazo só começa com a quitação" },
              { id: "nao_recebida", rotulo: "Não recebida", detalhe: "Cancela este agendamento", perigo: true },
            ]} />}
        </div>
      </li>}
    </ol>
    {cancela && <div className="callout danger">O agendamento dos termos será cancelado e a vaga devolvida. A cliente volta a escolher uma nova data no app (o levantamento e a forma de pagamento continuam valendo).</div>}
    {!cancela && (jaCompareceu || comparecimento === "compareceu") && (jaQuitou || quitacao === "recebida") && <div className="callout success">Com comparecimento e quitação registrados, a Agenda Cirúrgica é liberada automaticamente ao fim do prazo em dias úteis.</div>}
    {resultados && <ListaResultados resultados={resultados} total={totalPassos} />}
  </V46Modal>;
}
