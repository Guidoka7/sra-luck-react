import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatarCpf } from "@/lib/cpf";
import { DrawerIcon } from "./DrawerIcons";
import { formatCurrency, formatDate } from "./drawerFormat";
import styles from "./ClienteDrawer.module.css";

/**
 * Conta Azul dentro do drawer da cliente (aba Perfil e aba Financeiro).
 *
 * A parcela é UM compromisso com dois IDs: aqui a equipe (1) vincula a cliente à pessoa da Conta
 * Azul pelo CPF, com confirmação; (2) monta o financeiro a partir da Conta Azul quando a cliente
 * ainda não tem parcelas; ou (3) confere e confirma o vínculo parcela a parcela, aceitando
 * vencimento diferente sem alterar nenhum dos lados. Toda chamada vai ao backend do Sra Luck;
 * nenhum token da Conta Azul chega ao navegador.
 */

type Json = Record<string, any>;
type Pessoa = { id: string; nome: string; documento: string; email: string | null; tipo: string | null; vinculadaA: { clienteId: string; nome: string | null } | null };
type Lanc = { id: string; descricao: string; vencimento: string | null; valor: number; status: string; quitado: boolean };
type Boleto = { id: string; numero: number; total: number; valor: number; vencimento: string | null; status: string };
type Dif = { valor: boolean; vencimento: boolean; diasVencimento: number | null; status: boolean };
type Conciliacao = {
  lancamentos: Lanc[];
  vinculadas: { boleto: Boleto; caParcelaId: string | null; estado: string; lancamento: Lanc | null; diferencas: Dif | null }[];
  correspondencias: { boleto: Boleto; lancamento: Lanc; diferencas: Dif }[];
  divergencias: { boleto: Boleto; candidatos: { lancamento: Lanc; diferencas: Dif }[] }[];
  somenteSra: Boleto[];
  somenteContaAzul: Lanc[];
};
type Previa = {
  parcelas: { caParcelaId: string; valor: number; vencimento: string; descricao: string; pago: boolean; dataPagamento: string | null; juros: number; multa: number; desconto: number; parcial: boolean }[];
  naoImportadas: { caParcelaId: string; descricao: string; vencimento: string | null; valor: number; motivo: string }[];
  totais: { parcelas: number; pagas: number; abertas: number; vencidas: number; valorTotal: number; recebido: number; parciais: number };
};

const BASE = "/api/admin/integrations/conta-azul/clientes";

async function api<T = Json>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro ?? "Não foi possível falar com a Conta Azul agora.");
  return d as T;
}

const STATUS_CA: Record<string, [string, string]> = {
  RECEBIDO: ["Recebida", "pPaid"], QUITADO: ["Recebida", "pPaid"], EM_ABERTO: ["Em aberto", "pPending"], PENDENTE: ["Em aberto", "pPending"],
  ATRASADO: ["Vencida", "pOverdue"], RECEBIDO_PARCIAL: ["Parcial", "pReview"], RENEGOCIADO: ["Renegociada", "pSuspended"], PERDIDO: ["Perdida", "pRejected"], CANCELADO: ["Cancelada", "pRejected"],
};
const StatusCa = ({ s }: { s: string }) => { const [t, c] = STATUS_CA[s] ?? [s || "—", "pSuspended"]; return <span className={`${styles.pill} ${styles[c]}`}>{t}</span>; };
const StatusSra = ({ s }: { s: string }) => <span className={`${styles.pill} ${s === "pago" ? styles.pPaid : s === "pendente_confirmacao" ? styles.pReview : styles.pPending}`}>{s === "pago" ? "Paga" : s === "pendente_confirmacao" ? "Em conferência" : "Em aberto"}</span>;
const dif = (d: Dif | null) => d ? [d.vencimento && `vencimento ${d.diasVencimento != null && d.diasVencimento !== 0 ? `${d.diasVencimento > 0 ? "+" : ""}${d.diasVencimento} dia(s)` : "diferente"}`, d.valor && "valor diferente", d.status && "status diferente"].filter(Boolean) as string[] : [];

export function ContaAzulVinculo({ clienteId, cpf, temFinanceiro, modo, onAlterado }: { clienteId: string; cpf: string; temFinanceiro: boolean; modo: "perfil" | "financeiro"; onAlterado?: () => void }) {
  const [pessoa, setPessoa] = useState<Json | null | undefined>(undefined);
  const [ativa, setAtiva] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [busca, setBusca] = useState<{ situacao: string; pessoas: Pessoa[] } | null>(null);
  const [escolhida, setEscolhida] = useState<string>("");
  const [confirmo, setConfirmo] = useState(false);
  const [conc, setConc] = useState<Conciliacao | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [escolhaDiv, setEscolhaDiv] = useState<Record<string, string>>({});
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [importarIds, setImportarIds] = useState<Set<string>>(new Set());
  const cpfValido = cpf.replace(/\D/g, "").length === 11;

  async function carregar() {
    try { const r = await api<{ ativa?: boolean; pessoa?: Json | null }>(`${BASE}/${clienteId}/conta-azul`); setAtiva(r.ativa !== false); setPessoa(r.pessoa ?? null); setErro(null); }
    catch (e) { setPessoa(null); setErro((e as Error).message); }
  }
  useEffect(() => { void carregar(); }, [clienteId]);

  async function executar<T>(chave: string, f: () => Promise<T>) {
    setOcupado(chave);
    try { return await f(); } catch (e) { toast.error((e as Error).message); return null; } finally { setOcupado(null); }
  }

  const buscar = () => executar("buscar", async () => {
    const r = await api<{ situacao: string; pessoas: Pessoa[] }>(`${BASE}/${clienteId}/pessoas`);
    setBusca(r); setConfirmo(false);
    const livres = r.pessoas.filter((p) => !p.vinculadaA);
    setEscolhida(livres.length === 1 && r.pessoas.length === 1 ? livres[0].id : "");
  });
  const vincular = () => executar("vincular", async () => {
    await api(`${BASE}/${clienteId}/pessoa`, { caPessoaId: escolhida });
    toast.success("Cliente vinculada à Conta Azul.");
    setBusca(null); await carregar(); await conferir();
  });
  const conferir = () => executar("conferir", async () => {
    const r = await api<Conciliacao>(`${BASE}/${clienteId}/conciliacao`);
    setConc(r); setMarcadas(new Set(r.correspondencias.map((c) => c.boleto.id))); setEscolhaDiv({});
  });
  const verPrevia = () => executar("previa", async () => {
    const r = await api<Previa>(`${BASE}/${clienteId}/importacao`);
    setPrevia(r); setImportarIds(new Set(r.parcelas.map((p) => p.caParcelaId)));
  });
  const importar = () => executar("importar", async () => {
    if (!previa) return;
    const r = await api<Json>(`${BASE}/${clienteId}/importar`, { caParcelaIds: previa.parcelas.filter((p) => importarIds.has(p.caParcelaId)).map((p) => p.caParcelaId) });
    toast.success(`Financeiro montado: ${r.resultado?.parcelas ?? 0} parcela(s), ${r.resultado?.pagas ?? 0} já paga(s).`);
    setPrevia(null); onAlterado?.(); await conferir();
  });
  const confirmarPares = (pares: { boletoId: string; caParcelaId: string; aceitarDivergencias?: boolean }[]) => executar("pares", async () => {
    const r = await api<{ vinculadas: number; falhas: number; resultados: { ok: boolean; erro?: string; conflito?: string; baixaSincronizada?: boolean }[] }>(`${BASE}/${clienteId}/vinculos`, { pares });
    const conflitos = r.resultados.filter((x) => x.conflito).length, pagas = r.resultados.filter((x) => x.baixaSincronizada).length;
    if (r.vinculadas) toast.success(`${r.vinculadas} parcela(s) vinculada(s).${pagas ? ` ${pagas} já paga(s) na Conta Azul: pagamento sincronizado.` : ""}${conflitos ? ` ${conflitos} em revisão.` : ""}`);
    r.resultados.filter((x) => !x.ok).forEach((x) => toast.error(x.erro ?? "Vínculo não gravado."));
    onAlterado?.(); await conferir();
  });

  const lancamentos = useMemo(() => conc?.lancamentos ?? [], [conc]);
  const marcadasPrevia = useMemo(() => {
    const lista = (previa?.parcelas ?? []).filter((p) => importarIds.has(p.caParcelaId));
    const hoje = new Date().toISOString().slice(0, 10);
    return {
      total: lista.length, pagas: lista.filter((p) => p.pago).length, abertas: lista.filter((p) => !p.pago).length,
      vencidas: lista.filter((p) => !p.pago && p.vencimento < hoje).length,
      valor: lista.reduce((t, p) => t + p.valor, 0), recebido: lista.filter((p) => p.pago).reduce((t, p) => t + p.valor + p.juros + p.multa - p.desconto, 0),
    };
  }, [previa, importarIds]);

  // Conta Azul desligada neste ambiente (ex.: Production sem autorização) ou sem estrutura: nada a mostrar.
  if (!ativa) return null;
  if (pessoa === undefined) return <article className={`${styles.card} ${styles.financeCard}`}><div className={styles.cardBody}><span className={styles.muted}>Consultando vínculo com a Conta Azul…</span></div></article>;

  return <article className={`${styles.card} ${styles.financeCard}`} aria-label="Conta Azul">
    <div className={styles.cardHead}>
      <div role="heading" aria-level={3} className={styles.cardTitle}><DrawerIcon name="bank" aria-hidden="true" />Conta Azul</div>
      <span className={`${styles.finBadge} ${pessoa ? styles.active : styles.suspended}`}>● {pessoa ? "Vinculada" : "Não vinculada"}</span>
    </div>
    <div className={styles.cardBody} style={{ display: "grid", gap: 10 }}>
      {erro && !pessoa ? <div className={styles.warning}>{erro}</div> : null}

      {pessoa ? <div className={styles.summary}>
        <div className={styles.kpi}><span className={styles.kpiLabel}>Pessoa na Conta Azul</span><strong className={styles.kpiValue} style={{ fontSize: 13 }}>{pessoa.nome_externo}</strong><span className={styles.kpiSub}>CPF {formatarCpf(String(pessoa.documento ?? ""))}</span></div>
        <div className={styles.kpi}><span className={styles.kpiLabel}>Vinculada em</span><strong className={styles.kpiValue} style={{ fontSize: 13 }}>{formatDate(pessoa.confirmado_em)}</strong><span className={styles.kpiSub}>confirmado pela equipe</span></div>
      </div> : <>
        <p className={styles.muted} style={{ margin: 0 }}>O vínculo é feito pelo <b>CPF</b> (nunca só pelo nome) e sempre com a sua confirmação.</p>
        <div><button type="button" className={`${styles.modalBtn} ${styles.primary}`} disabled={!cpfValido || ocupado === "buscar"} title={cpfValido ? undefined : "Informe um CPF válido na cliente."} onClick={() => void buscar()}>{ocupado === "buscar" ? "Buscando…" : "Buscar na Conta Azul pelo CPF"}</button></div>
      </>}

      {!pessoa && busca && <div className={styles.banner}>
        <div className={styles.kicker}>{busca.situacao === "nao_encontrada" ? "Nenhuma pessoa com este CPF" : busca.situacao === "mais_de_uma" ? "Mais de uma pessoa com este CPF: escolha" : "Pessoa encontrada"}</div>
        {busca.situacao === "nao_encontrada" ? <span className={styles.muted}>Cadastre a cliente na Conta Azul com o CPF {formatarCpf(cpf)} e busque de novo.</span> : <>
          {busca.pessoas.map((p) => <label key={p.id} className={styles.miniRow} style={{ display: "flex", gap: 8, alignItems: "flex-start", justifyContent: "flex-start", textAlign: "left", cursor: p.vinculadaA ? "not-allowed" : "pointer", opacity: p.vinculadaA ? 0.6 : 1 }}>
            <input type="radio" name={`ca-pessoa-${clienteId}`} checked={escolhida === p.id} disabled={Boolean(p.vinculadaA)} onChange={() => { setEscolhida(p.id); setConfirmo(false); }} />
            <span><b>{p.nome}</b> · CPF {formatarCpf(p.documento)}{p.email ? ` · ${p.email}` : ""}{p.tipo ? ` · ${p.tipo}` : ""}
              {p.vinculadaA ? <><br /><small className={styles.muted}>Já vinculada a {p.vinculadaA.nome ?? "outra cliente"}.</small></> : null}</span>
          </label>)}
          <label className={styles.muted} style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={confirmo} disabled={!escolhida} onChange={(e) => setConfirmo(e.target.checked)} />Confirmo que é a mesma cliente (nome e CPF conferidos).</label>
          <div className={styles.bannerActions}><button type="button" className={`${styles.modalBtn} ${styles.primary}`} disabled={!escolhida || !confirmo || ocupado === "vincular"} onClick={() => void vincular()}>{ocupado === "vincular" ? "Vinculando…" : "Vincular à Conta Azul"}</button></div>
        </>}
      </div>}

      {pessoa && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className={styles.modalBtn} disabled={ocupado === "conferir"} onClick={() => void conferir()}>{ocupado === "conferir" ? "Consultando…" : conc ? "Atualizar lançamentos" : temFinanceiro ? "Vincular Conta Azul: conferir parcelas" : "Ver lançamentos na Conta Azul"}</button>
        {!temFinanceiro && <button type="button" className={`${styles.modalBtn} ${styles.primary}`} disabled={ocupado === "previa"} onClick={() => void verPrevia()}>{ocupado === "previa" ? "Lendo a Conta Azul…" : "Montar financeiro a partir da Conta Azul"}</button>}
      </div>}

      {previa && <div className={styles.banner}>
        <div className={styles.kicker}>Prévia — nada foi gravado ainda</div>
        <div className={styles.summary}>
          <div className={styles.kpi}><span className={styles.kpiLabel}>Parcelas marcadas</span><strong className={styles.kpiValue}>{marcadasPrevia.total} de {previa.totais.parcelas}</strong><span className={styles.kpiSub}>{marcadasPrevia.pagas} paga(s) · {marcadasPrevia.abertas} em aberto · {marcadasPrevia.vencidas} vencida(s)</span></div>
          <div className={styles.kpi}><span className={styles.kpiLabel}>Valor do plano</span><strong className={styles.kpiValue}>{formatCurrency(marcadasPrevia.valor)}</strong><span className={styles.kpiSub}>recebido {formatCurrency(marcadasPrevia.recebido)} (com juros e multa)</span></div>
        </div>
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>Importar</th><th>Vencimento</th><th>Descrição</th><th>Valor</th><th>Status</th><th>Pagamento (composição)</th></tr></thead>
          <tbody>{previa.parcelas.map((p) => <tr key={p.caParcelaId} style={importarIds.has(p.caParcelaId) ? undefined : { opacity: 0.45 }}>
            <td><input type="checkbox" aria-label={`Importar lançamento de ${formatDate(p.vencimento)}`} checked={importarIds.has(p.caParcelaId)} onChange={(e) => setImportarIds((m) => { const n = new Set(m); if (e.target.checked) n.add(p.caParcelaId); else n.delete(p.caParcelaId); return n; })} /></td>
            <td>{formatDate(p.vencimento)}</td><td>{p.descricao || "—"}</td><td>{formatCurrency(p.valor)}</td>
            <td>{p.pago ? <StatusCa s="QUITADO" /> : p.parcial ? <StatusCa s="RECEBIDO_PARCIAL" /> : <StatusCa s="PENDENTE" />}</td>
            <td style={{ whiteSpace: "normal" }}>{p.pago ? `${formatDate(p.dataPagamento)} · ${formatCurrency(p.valor)}${p.juros ? ` + juros ${formatCurrency(p.juros)}` : ""}${p.multa ? ` + multa ${formatCurrency(p.multa)}` : ""}${p.desconto ? ` − desc. ${formatCurrency(p.desconto)}` : ""}` : p.parcial ? "Recebimento parcial: vai para revisão" : "—"}</td>
          </tr>)}</tbody>
        </table></div>
        <span className={styles.muted}>Desmarque lançamentos que não são parcelas do plano (ex.: uma taxa avulsa). As marcadas viram as parcelas 1 a {importarIds.size}, pela ordem de vencimento.</span>
        {previa.naoImportadas.length ? <div className={styles.warning}><b>Não entram ({previa.naoImportadas.length}):</b> {previa.naoImportadas.map((n) => `${formatDate(n.vencimento)} ${formatCurrency(n.valor)} — ${n.motivo}`).join(" · ")}</div> : null}
        <div className={styles.bannerActions}>
          <button type="button" className={styles.modalBtn} onClick={() => setPrevia(null)}>Cancelar</button>
          <button type="button" className={`${styles.modalBtn} ${styles.primary}`} disabled={!importarIds.size || ocupado === "importar"} onClick={() => { if (window.confirm(`Criar ${importarIds.size} parcela(s) no Financeiro desta cliente a partir da Conta Azul?`)) void importar(); }}>{ocupado === "importar" ? "Importando…" : `Importar ${importarIds.size} parcela(s)`}</button>
        </div>
      </div>}

      {conc && <>
        {modo === "perfil" || !temFinanceiro ? <div>
          <span className={styles.label}>Lançamentos da cliente na Conta Azul ({lancamentos.length})</span>
          <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Vencimento</th><th>Descrição</th><th>Valor</th><th>Status</th></tr></thead>
            <tbody>{lancamentos.length ? lancamentos.map((l) => <tr key={l.id}><td>{formatDate(l.vencimento)}</td><td>{l.descricao || "—"}</td><td>{formatCurrency(l.valor)}</td><td><StatusCa s={l.status} /></td></tr>) : <tr><td colSpan={4}><div className={styles.empty}>Não existem lançamentos na Conta Azul disponíveis para vínculo. Nada é criado lá pelo Sra. Luck.</div></td></tr>}</tbody>
          </table></div>
        </div> : null}

        {temFinanceiro && <>
          <div className={styles.summary}>
            <div className={styles.kpi}><span className={styles.kpiLabel}>Já vinculadas</span><strong className={styles.kpiValue}>{conc.vinculadas.length}</strong></div>
            <div className={styles.kpi}><span className={styles.kpiLabel}>Correspondências</span><strong className={styles.kpiValue}>{conc.correspondencias.length}</strong></div>
            <div className={styles.kpi}><span className={styles.kpiLabel}>Divergências</span><strong className={styles.kpiValue}>{conc.divergencias.length}</strong></div>
            <div className={styles.kpi}><span className={styles.kpiLabel}>Só Sra. Luck / só Conta Azul</span><strong className={styles.kpiValue}>{conc.somenteSra.length} / {conc.somenteContaAzul.length}</strong></div>
          </div>

          {conc.correspondencias.length > 0 && <div>
            <span className={styles.label}>Correspondências encontradas (mesmo valor e vencimento)</span>
            <div className={styles.tableWrap}><table className={styles.table}>
              <thead><tr><th /><th>Parcela Sra. Luck</th><th>Conta Azul</th><th>Status</th></tr></thead>
              <tbody>{conc.correspondencias.map((c) => <tr key={c.boleto.id}>
                <td><input type="checkbox" aria-label={`Vincular parcela ${c.boleto.numero}`} checked={marcadas.has(c.boleto.id)} onChange={(e) => setMarcadas((m) => { const n = new Set(m); if (e.target.checked) n.add(c.boleto.id); else n.delete(c.boleto.id); return n; })} /></td>
                <td>{c.boleto.numero}/{c.boleto.total} · {formatDate(c.boleto.vencimento)} · {formatCurrency(c.boleto.valor)}</td>
                <td>{formatDate(c.lancamento.vencimento)} · {formatCurrency(c.lancamento.valor)}</td>
                <td><StatusSra s={c.boleto.status} /> <StatusCa s={c.lancamento.status} />{c.diferencas.status ? <><br /><small className={styles.muted}>{c.lancamento.quitado ? "Paga na Conta Azul: o pagamento será sincronizado ao vincular." : "Paga só no Sra. Luck: vai para revisão (nada é enviado à Conta Azul)."}</small></> : null}</td>
              </tr>)}</tbody>
            </table></div>
            <button type="button" className={`${styles.modalBtn} ${styles.primary}`} disabled={!marcadas.size || ocupado === "pares"} onClick={() => void confirmarPares(conc.correspondencias.filter((c) => marcadas.has(c.boleto.id)).map((c) => ({ boletoId: c.boleto.id, caParcelaId: c.lancamento.id })))}>Vincular {marcadas.size} selecionada(s)</button>
          </div>}

          {conc.divergencias.length > 0 && <div style={{ display: "grid", gap: 8 }}>
            <span className={styles.label}>Divergências — escolha a correspondência de cada parcela</span>
            {conc.divergencias.map((dv) => <div key={dv.boleto.id} className={styles.banner}>
              <div className={styles.kicker}>Parcela {String(dv.boleto.numero).padStart(2, "0")} Sra. Luck — {formatDate(dv.boleto.vencimento)} — {formatCurrency(dv.boleto.valor)} · <StatusSra s={dv.boleto.status} /></div>
              {dv.candidatos.map((c) => <label key={c.lancamento.id} className={styles.miniRow} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-start", textAlign: "left", cursor: "pointer" }}>
                <input type="radio" name={`div-${dv.boleto.id}`} checked={escolhaDiv[dv.boleto.id] === c.lancamento.id} onChange={() => setEscolhaDiv((m) => ({ ...m, [dv.boleto.id]: c.lancamento.id }))} />
                <span>Conta Azul — {formatCurrency(c.lancamento.valor)} — {formatDate(c.lancamento.vencimento)} <StatusCa s={c.lancamento.status} />{c.lancamento.descricao ? <small className={styles.muted}> · {c.lancamento.descricao}</small> : null}
                  <br /><small style={{ color: "#9A6A13", fontWeight: 700 }}>⚠ {dif(c.diferencas).join(" · ")}</small></span>
              </label>)}
              <div className={styles.bannerActions}><button type="button" className={`${styles.modalBtn} ${styles.primary}`} disabled={!escolhaDiv[dv.boleto.id] || ocupado === "pares"} onClick={() => {
                const alvo = dv.candidatos.find((c) => c.lancamento.id === escolhaDiv[dv.boleto.id]);
                if (!alvo || !window.confirm(`Vincular a parcela ${dv.boleto.numero} ao lançamento de ${formatDate(alvo.lancamento.vencimento)} (${formatCurrency(alvo.lancamento.valor)}) mesmo com ${dif(alvo.diferencas).join(" e ")}? Nenhum vencimento será alterado.`)) return;
                void confirmarPares([{ boletoId: dv.boleto.id, caParcelaId: alvo.lancamento.id, aceitarDivergencias: true }]);
              }}>Vincular com divergência</button></div>
            </div>)}
          </div>}

          {(conc.somenteSra.length > 0 || conc.somenteContaAzul.length > 0) && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><span className={styles.label}>Somente no Sra. Luck ({conc.somenteSra.length})</span>{conc.somenteSra.map((b) => <div key={b.id} className={styles.miniRow}>{b.numero}/{b.total} · {formatDate(b.vencimento)} · {formatCurrency(b.valor)}</div>)}</div>
            <div><span className={styles.label}>Somente na Conta Azul ({conc.somenteContaAzul.length})</span>{conc.somenteContaAzul.map((l) => <div key={l.id} className={styles.miniRow}>{formatDate(l.vencimento)} · {formatCurrency(l.valor)} <StatusCa s={l.status} /></div>)}</div>
          </div>}

          {conc.vinculadas.length > 0 && <details><summary className={styles.label} style={{ cursor: "pointer" }}>Parcelas já vinculadas ({conc.vinculadas.length})</summary>
            {conc.vinculadas.map((v) => <div key={v.boleto.id} className={styles.miniRow}>{v.boleto.numero}/{v.boleto.total} · {formatDate(v.boleto.vencimento)} · {formatCurrency(v.boleto.valor)} ↔ {v.lancamento ? `${formatDate(v.lancamento.vencimento)} · ${formatCurrency(v.lancamento.valor)}` : "lançamento fora da lista"} · {v.estado === "conflito" ? "em revisão" : "vinculada"}{dif(v.diferencas).length ? ` · ${dif(v.diferencas).join(" · ")}` : ""}</div>)}
          </details>}
        </>}
      </>}

      {pessoa && <p className={styles.readOnlyNote} style={{ margin: 0 }}>O pagamento das parcelas vinculadas é confirmado na Conta Azul e sincronizado para cá (principal, juros, multa e desconto). O Sra. Luck não envia nada para a Conta Azul. Comprovantes continuam no Sra. Luck: a API da Conta Azul não permite anexar arquivos.</p>}
    </div>
  </article>;
}
