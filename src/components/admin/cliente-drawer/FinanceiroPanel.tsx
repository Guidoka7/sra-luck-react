import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { QUANTIDADE_PARCELAS_OPCOES, type Boleto, type Carne } from "@/types/database";
import type { ClienteCadastro } from "../useClienteCadastro";
import { DrawerIcon } from "./DrawerIcons";
import { PARCELA_LABEL, descreverHistorico, ehHistoricoFinanceiro, formatCurrency, formatDate, hojeSaoPaulo, statusParcela, type ParcelaStatus } from "./drawerFormat";
import styles from "./ClienteDrawer.module.css";
import { LeitorCarneModal, type LeituraCarneConcluida } from "@/features/leitor-carne/LeitorCarneModal";

export interface FinanceiroPanelHandle { salvar: () => Promise<void>; editando: () => boolean }

type Modal =
  | { tipo: "detalhes" | "editar" | "excluir" | "rejeitar" | "confirmar" | "reabrir"; b: Boleto }
  | { tipo: "excluir-carne"; carne: Carne }
  | { tipo: "ajuste" }
  | null;

const FORMAS_BAIXA: Array<[string, string]> = [["pix", "PIX"], ["cartao", "Cartão"], ["boleto", "Boleto"], ["cheque", "Cheque"], ["dinheiro", "Dinheiro"], ["transferencia", "Transferência"], ["outro", "Outro"]];

/**
 * Aba Financeiro (padrão visual da referência k338) sobre as APIs reais da
 * main: plano (`/clientes/:id/boletos`), baixa/anexo/validação/edição
 * (`/financeiro/recebiveis/*`, `/financeiro/validacoes/*`) e carnês. Toda
 * ação espera o backend e recarrega as parcelas — nada é só estado local.
 */
export const FinanceiroPanel = forwardRef<FinanceiroPanelHandle, { cad: ClienteCadastro; modo?: "completo" | "parcelas" }>(function FinanceiroPanel({ cad, modo = "completo" }, ref) {
  const completo = modo === "completo";
  const hoje = hojeSaoPaulo();
  const [editandoPlano, setEditandoPlano] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [menu, setMenu] = useState<{ b: Boleto; left: number; top: number } | null>(null);
  const [historicoTodo, setHistoricoTodo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [editValor, setEditValor] = useState("");
  const [editVenc, setEditVenc] = useState("");
  const [editStatus, setEditStatus] = useState<"pending" | "suspended">("pending");
  const anexoRef = useRef<HTMLInputElement>(null);
  const [anexoAlvo, setAnexoAlvo] = useState<Boleto | null>(null);
  const qtdOriginal = useRef(cad.quantidade);
  const [leitorAberto, setLeitorAberto] = useState(false);
  const [carneLidoAguardandoCadastro, setCarneLidoAguardandoCadastro] = useState(false);
  const [carneEditandoId, setCarneEditandoId] = useState<string | null>(null);

  const boletos = cad.boletos;
  const pagos = boletos.filter((b) => b.status === "pago");
  const totalPlano = boletos.length ? boletos.reduce((s, b) => s + Number(b.valor || 0), 0) : 0;
  const totalPago = pagos.reduce((s, b) => s + Number(b.valor || 0), 0);
  const saldo = Math.max(0, totalPlano - totalPago);
  const pctValor = totalPlano > 0 ? Math.min(100, (totalPago / totalPlano) * 100) : 0;
  const total = boletos.length;
  const progresso = total > 0 ? (pagos.length / total) * 100 : 0;
  const faltam = Math.max(0, cad.metaParcelas - cad.pagas);
  const financeiroHistorico = useMemo(() => cad.historico.filter(ehHistoricoFinanceiro), [cad.historico]);

  useEffect(() => {
    if (!menu) return;
    const fechar = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest("[data-parcela-menu]")) setMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setMenu(null); } };
    document.addEventListener("pointerdown", fechar);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", fechar); document.removeEventListener("keydown", esc, true); };
  }, [menu]);

  async function salvarPlano() {
    if (!editandoPlano && boletos.length) return;
    if (boletos.length && cad.quantidade !== qtdOriginal.current) { setModal({ tipo: "ajuste" }); return; }
    await cad.gerarOuAjustarParcelas();
    qtdOriginal.current = cad.quantidade;
    setEditandoPlano(false);
  }
  useImperativeHandle(ref, () => ({ salvar: salvarPlano, editando: () => editandoPlano || boletos.length === 0 }));

  function abrirMenu(e: MouseEvent<HTMLButtonElement>, b: Boleto) {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const largura = 190, altura = 286;
    const left = Math.max(8, Math.min(r.right - largura, window.innerWidth - largura - 8));
    const top = r.bottom + 4 + altura > window.innerHeight ? Math.max(8, r.top - altura - 4) : r.bottom + 4;
    setMenu({ b, left, top });
  }
  function acao(a: string, b: Boleto) {
    setMenu(null);
    const st = statusParcela(b, hoje);
    if (a === "detalhes") setModal({ tipo: "detalhes", b });
    if (a === "editar") {
      if (st === "paid" || st === "review") { toast.error("Parcelas pagas ou em conferência preservam o histórico. Use as ações financeiras específicas."); return; }
      setEditValor(String(b.valor ?? "")); setEditVenc(b.data_vencimento ?? ""); setEditStatus(st === "suspended" ? "suspended" : "pending");
      setModal({ tipo: "editar", b });
    }
    if (a === "excluir") { if (st === "paid" || st === "review") toast.error("Parcelas pagas ou em conferência não podem ser excluídas."); else setModal({ tipo: "excluir", b }); }
    if (a === "baixa") cad.abrirBaixaManual(b);
    if (a === "anexar") { setAnexoAlvo(b); requestAnimationFrame(() => anexoRef.current?.click()); }
    if (a === "confirmar") setModal({ tipo: "confirmar", b });
    if (a === "rejeitar") { setMotivo(""); setModal({ tipo: "rejeitar", b }); }
    if (a === "reabrir") {
      if (b.status === "nao_pago" && !b.suspensa) { toast.info("Esta parcela já está em aberto."); return; }
      setModal({ tipo: "reabrir", b });
    }
  }

  async function salvarEdicao(b: Boleto) {
    const valor = Number(String(editValor).replace(",", "."));
    if (!editVenc || !Number.isFinite(valor) || valor <= 0) { toast.error("Preencha vencimento e valor corretamente."); return; }
    const ok = await cad.alterarParcela(b, { acao: "editar", valor, dataVencimento: editVenc }, "Parcela atualizada com sucesso.");
    if (!ok) return;
    const estava = statusParcela(b, hoje) === "suspended";
    if (editStatus === "suspended" && !estava) await cad.alterarParcela(b, { acao: "suspender" }, "Parcela suspensa.");
    if (editStatus !== "suspended" && estava) await cad.alterarParcela(b, { acao: "reabrir" }, "Parcela reaberta.");
    setModal(null);
  }
  function limparFormularioCarne() {
    cad.setNovoCarneBanco("");
    cad.setNovoCarneIdentificador("");
    cad.setNovoCarneData("");
    cad.setNovoCarneQuantidade(cad.quantidade);
  }

  function iniciarLeituraCarne() {
    limparFormularioCarne();
    setCarneEditandoId(null);
    setCarneLidoAguardandoCadastro(false);
    setLeitorAberto(true);
  }

  function concluirLeituraCarne(dados?: LeituraCarneConcluida) {
    cad.setNovoCarneBanco(dados?.instituicao ?? "");
    cad.setNovoCarneIdentificador("");
    cad.setNovoCarneData("");
    cad.setNovoCarneQuantidade(dados?.quantidadeParcelas && dados.quantidadeParcelas > 0 ? dados.quantidadeParcelas : cad.quantidade);
    setCarneEditandoId(null);
    setCarneLidoAguardandoCadastro(true);
    void cad.carregarBoletos();
    void cad.carregarPerfilExtra();
  }

  function iniciarEdicaoCarne(carne: Carne) {
    cad.setNovoCarneBanco(carne.instituicao_financeira);
    cad.setNovoCarneIdentificador(carne.identificador_externo);
    cad.setNovoCarneData(carne.data_geracao?.slice(0, 10) ?? "");
    cad.setNovoCarneQuantidade(carne.quantidade_parcelas);
    setCarneLidoAguardandoCadastro(false);
    setCarneEditandoId(carne.id);
  }

  async function salvarCadastroCarne(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = carneEditandoId ? await cad.editarCarne(carneEditandoId) : await cad.criarCarne(e);
    if (!ok) return;
    setCarneEditandoId(null);
    setCarneLidoAguardandoCadastro(false);
    limparFormularioCarne();
  }

  function cancelarCadastroCarne() {
    setCarneEditandoId(null);
    setCarneLidoAguardandoCadastro(false);
    limparFormularioCarne();
  }


  if (cad.carregandoFin && boletos.length === 0) return <div className={styles.stack}><div className={styles.loading} aria-busy="true"><div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} /></div><div className={styles.loading}><div className={styles.skeleton} /><div className={styles.skeleton} /></div></div>;

  return <div className={`${styles.stack} ${styles.financeStack}`}>
    <input ref={anexoRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; const alvo = anexoAlvo; setAnexoAlvo(null); if (f && alvo) void cad.anexarComprovante(alvo, f); }} />

    <ComprovanteBanner cad={cad} onConfirmar={(b) => setModal({ tipo: "confirmar", b })} onRejeitar={(b) => { setMotivo(""); setModal({ tipo: "rejeitar", b }); }} />

    {completo && total > 0 && <>
      <article className={`${styles.card} ${styles.financeCard}`}>
        <div className={styles.cardHead}><div role="heading" aria-level={3} className={styles.cardTitle}><DrawerIcon name="finance" aria-hidden="true" />Resumo financeiro</div><span className={`${styles.finBadge} ${cad.vencidas > 0 ? styles.suspended : styles.active}`}>● {cad.situacao}</span></div>
        <div className={styles.cardBody}><div className={styles.summary}>
          <Kpi label="Valor total do plano" value={formatCurrency(totalPlano)} />
          <Kpi label="Total pago" value={formatCurrency(totalPago)} sub={`${Math.round(pctValor)}% do plano`} cls={styles.paid} />
          <Kpi label="Saldo em aberto" value={formatCurrency(saldo)} sub={`${Math.round(100 - pctValor)}% do plano`} cls={styles.openValue} />
          <Kpi label="Parcelas pagas" value={`${pagos.length} de ${total}`} sub={cad.vencidas > 0 ? `${cad.vencidas} vencida(s)` : `${Math.round(progresso)}% concluído`} />
        </div></div>
      </article>

      <article className={`${styles.card} ${styles.financeCard}`}>
        <div className={styles.cardHead}><div role="heading" aria-level={3} className={styles.cardTitle}><DrawerIcon name="wallet" aria-hidden="true" />Progresso por parcelas</div></div>
        <div className={styles.cardBody}><div className={styles.progressLayout}>
          <div style={{ display: "grid", placeItems: "center" }}>
            <div className={`${styles.ring} ${cad.elegivel ? styles.eligible : ""}`} role="img" aria-label={`${Math.round(progresso)}% das parcelas pagas`} style={{ "--progress": Math.max(0, Math.min(100, progresso)).toFixed(2) } as CSSProperties}><span className={styles.ringValue}>{Math.round(progresso)}%</span></div>
          </div>
          <div className={styles.progressCopy}><strong>{pagos.length} de {total} parcelas pagas</strong><p><DrawerIcon name="info" style={{ width: 13, height: 13, marginRight: 5, verticalAlign: "-2px", color: "#AD686B" }} aria-hidden="true" />A cliente se torna elegível após {cad.percentualMeta}% das parcelas pagas ({cad.metaParcelas} de {total}).</p></div>
          <div className={styles.eligibility}>
            {cad.elegivel
              ? <><div className={styles.eligibilityMain}><DrawerIcon name="check" width={15} height={15} aria-hidden="true" />Percentual mínimo atingido</div><span className={styles.eligibleBadge}>✓ Elegível</span><p>A solicitação de liberação financeira fica disponível no app.</p></>
              : <><div className={styles.eligibilityMain}><DrawerIcon name="alert" width={15} height={15} aria-hidden="true" />{faltam === 1 ? "Falta 1 parcela" : `Faltam ${faltam} parcelas`} para a liberação.</div><p>Com {cad.percentualMeta}% das parcelas pagas, a cliente pode solicitar os próximos passos no app.</p></>}
          </div>
        </div></div>
      </article>
    </>}

    {completo && <div className={styles.financePair}>
      <article className={`${styles.card} ${styles.financeCard}`}>
        <div className={styles.cardHead}>
          <div role="heading" aria-level={3} className={styles.cardTitle}><DrawerIcon name="document" aria-hidden="true" />{total ? "Plano financeiro" : "Criar financeiro"}</div>
          {total > 0 && (editandoPlano
            ? <button className={styles.cancel} type="button" onClick={() => { setEditandoPlano(false); void cad.carregarBoletos(); }}>Cancelar</button>
            : <button className={styles.edit} type="button" onClick={() => { qtdOriginal.current = cad.quantidade; setEditandoPlano(true); }}><DrawerIcon name="edit" aria-hidden="true" /> Editar</button>)}
        </div>
        <div className={styles.cardBody}>{editandoPlano || total === 0 ? <div className={styles.formGrid}>
          <Field label="Carta de crédito" id="fin-carta"><input id="fin-carta" className={styles.input} inputMode="decimal" value={cad.carta} onChange={(e) => cad.atualizarCarta(e.target.value)} /></Field>
          <Field label="Taxa administrativa (%)" id="fin-taxa"><input id="fin-taxa" className={styles.input} inputMode="decimal" value={cad.taxa} onChange={(e) => cad.atualizarTaxa(e.target.value)} /></Field>
          <Field label="Nº de parcelas" id="fin-qtd"><select id="fin-qtd" className={styles.input} value={String(cad.quantidade)} onChange={(e) => cad.atualizarQuantidade(e.target.value)}>{QUANTIDADE_PARCELAS_OPCOES.map((q) => <option key={q} value={q}>{q}x</option>)}</select></Field>
          <Field label="Valor da parcela" id="fin-parc"><input id="fin-parc" className={styles.input} inputMode="decimal" value={cad.parcela} onChange={(e) => cad.atualizarParcela(e.target.value)} /></Field>
          <Field label={total ? "Novo 1º vencimento (opcional)" : "1º vencimento"} id="fin-venc" wide><input id="fin-venc" className={styles.input} type="date" value={cad.vencimento} onChange={(e) => cad.setVencimento(e.target.value)} /></Field>
          <p className={`${styles.muted} ${styles.span2}`} style={{ margin: 0 }}>A carta de crédito e o valor da parcela são independentes. Parcelas pagas e em conferência são preservadas no ajuste.</p>
          <div className={styles.span2}><button type="button" className={`${styles.modalBtn} ${styles.primary}`} style={{ width: "100%" }} disabled={cad.salvandoFin} onClick={() => void salvarPlano()} aria-busy={cad.salvandoFin}>{cad.salvandoFin ? "Salvando..." : total ? "Salvar ajuste do plano" : "Criar financeiro"}</button></div>
        </div> : <div className={styles.finInfo}>
          <Info wide label="Procedimento" value={cad.procedimento ?? ""} />
          <Info label="Carta de crédito" value={cad.carta ? `R$ ${cad.carta}` : ""} />
          <Info label="Taxa administrativa" value={cad.taxa ? `${cad.taxa}%` : ""} />
          <Info label="Nº de parcelas" value={`${total} parcelas`} />
          <Info label="Valor da parcela" value={formatCurrency(boletos[0]?.valor)} />
          <Info label="Início do plano" value={formatDate(cad.cliente?.inicio_plano ?? boletos[0]?.data_vencimento)} />
          <Info label="Próxima parcela" value={cad.proximaLiberacao ? `${cad.proximaLiberacao.numero_parcela}/${cad.proximaLiberacao.total_parcelas} · ${formatDate(cad.proximaLiberacao.data_vencimento)}` : "Todas pagas"} />
        </div>}</div>
      </article>

      <article className={`${styles.card} ${styles.financeCard}`}>
        <div className={styles.cardHead}><div role="heading" aria-level={3} className={styles.cardTitle}><DrawerIcon name="card" aria-hidden="true" />Forma de pagamento</div></div>
        <div className={styles.cardBody}>
          <div className={styles.finInfo}>
            <Info label="Método" value={cad.cliente?.forma_pagamento_plano ?? ""} />
            <Info label="Instituição" value={cad.cliente?.instituicao_pagamento ?? cad.cliente?.banco ?? ""} />
            <Info label="Dia de cobrança" value={cad.cliente?.dia_cobranca ? `Todo dia ${cad.cliente.dia_cobranca}` : ""} />
            <div><span className={styles.label}>Status</span><div className={styles.value}><span className={`${styles.finBadge} ${cad.cliente?.status_plano === "Suspensa" ? styles.suspended : styles.active}`}>{cad.cliente?.status_plano ?? "Ativa"}</span></div></div>
          </div>
          <p className={styles.readOnlyNote}>Dados do contrato de cobrança (somente leitura). A instituição de cada carnê é registrada abaixo.</p>
        </div>
      </article>
    </div>}

    <article className={`${styles.card} ${styles.financeCard}`}>
      <div className={styles.cardHead}><div role="heading" aria-level={3} className={styles.cardTitle}><DrawerIcon name="document" aria-hidden="true" />Parcelas</div>{cad.carregandoFin ? <span className={styles.muted}>Atualizando…</span> : null}</div>
      <div className={styles.cardBody} style={{ paddingTop: 3 }}>
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Pagamento</th><th>Comprovante</th><th>Ações</th></tr></thead>
          <tbody>{boletos.length ? boletos.map((b) => {
            const st = statusParcela(b, hoje);
            return <tr key={b.id} className={styles.installmentInteractive} tabIndex={0} aria-label={`Parcela ${b.numero_parcela}: ${PARCELA_LABEL[st]}`}
              onClick={(e) => { if ((e.target as HTMLElement).closest("button,a")) return; setModal({ tipo: "detalhes", b }); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setModal({ tipo: "detalhes", b }); } }}>
              <td>{b.numero_parcela}/{b.total_parcelas || total}</td><td>{formatDate(b.data_vencimento)}</td><td>{formatCurrency(b.valor)}</td>
              <td><span className={`${styles.pill} ${pillClass(st)}`}>{PARCELA_LABEL[st]}</span></td><td>{formatDate(b.data_pagamento)}</td>
              <td>{b.comprovante_url ? <a className={styles.rowBtn} href={cad.comprovanteHref(b)} target="_blank" rel="noreferrer" aria-label={`Ver comprovante da parcela ${b.numero_parcela}`}><DrawerIcon name="document" /></a> : <button className={styles.rowBtn} type="button" disabled aria-label="Sem comprovante"><DrawerIcon name="document" /></button>}</td>
              <td><button className={styles.rowBtn} data-parcela-menu type="button" aria-haspopup="menu" aria-label={`Ações da parcela ${b.numero_parcela}`} onClick={(e) => abrirMenu(e, b)}><DrawerIcon name="dots" /></button></td>
            </tr>;
          }) : <tr><td colSpan={7}><div className={styles.empty}>Nenhuma parcela cadastrada. Crie o financeiro acima.</div></td></tr>}</tbody>
        </table></div>
      </div>
    </article>

    {completo && <article className={`${styles.card} ${styles.financeCard}`}>
      <div className={styles.cardHead}>
        <div role="heading" aria-level={3} className={styles.cardTitle}><DrawerIcon name="bank" aria-hidden="true" />Carnês e importações</div>
      </div>
      <div className={`${styles.cardBody} ${styles.carneCardBody}`}>
        {carneEditandoId || carneLidoAguardandoCadastro ? <div className={styles.carneFormWrap}>
          <div className={styles.carneStep}>
            <span className={styles.carneStepIcon}><DrawerIcon name={carneEditandoId ? "edit" : "check"} aria-hidden="true" /></span>
            <div>
              <strong>{carneEditandoId ? "Editar identificação do carnê" : "Leitura concluída"}</strong>
              <span>{carneEditandoId ? "Atualize os dados de identificação sem alterar as parcelas já importadas." : `${cad.novoCarneQuantidade || cad.quantidade} parcelas identificadas. Complete os dados para salvar este carnê.`}</span>
            </div>
          </div>
          <form className={styles.carneForm} onSubmit={(e) => void salvarCadastroCarne(e)}>
            <Field label="Instituição" id="carne-inst"><input id="carne-inst" className={styles.input} placeholder="Ex.: BRB" value={cad.novoCarneBanco} onChange={(e) => cad.setNovoCarneBanco(e.target.value)} autoFocus /></Field>
            <Field label="Identificador" id="carne-id"><input id="carne-id" className={styles.input} placeholder="Número ou referência do carnê" value={cad.novoCarneIdentificador} onChange={(e) => cad.setNovoCarneIdentificador(e.target.value)} /></Field>
            <Field label="Data de geração" id="carne-data" wide><input id="carne-data" className={styles.input} type="date" value={cad.novoCarneData} onChange={(e) => cad.setNovoCarneData(e.target.value)} /></Field>
            <div className={styles.carneFormActions}>
              <button type="button" className={`${styles.modalBtn} ${styles.secondary}`} onClick={cancelarCadastroCarne} disabled={cad.criandoCarne}>Cancelar</button>
              <button type="submit" className={`${styles.modalBtn} ${styles.primary}`} disabled={cad.criandoCarne}>{cad.criandoCarne ? "Salvando..." : carneEditandoId ? "Salvar alterações" : "Registrar carnê"}</button>
            </div>
          </form>
        </div> : cad.carnes.length === 0 ? <button type="button" className={`${styles.dropzone} ${styles.carnePrimaryAction}`} onClick={iniciarLeituraCarne} disabled={!cad.cliente?.id}>
          <DrawerIcon name="upload" width={17} height={17} aria-hidden="true" />Ler carnê (PDF ou foto)
        </button> : <div className={styles.carneSavedArea}>
          <div className={styles.carneList}>
            {cad.carnes.map((carne) => <div key={carne.id} className={styles.carneSaved}>
              <div className={styles.carneSavedIcon}><DrawerIcon name="document" aria-hidden="true" /></div>
              <div className={styles.carneSavedMain}>
                <strong>Carnê de {carne.quantidade_parcelas} parcelas anexado</strong>
                <span>{carne.instituicao_financeira} · {carne.identificador_externo}</span>
                <small>Gerado em {formatDate(carne.data_geracao)}</small>
              </div>
              <div className={styles.carneSavedActions}>
                <button type="button" className={styles.edit} onClick={() => iniciarEdicaoCarne(carne)}><DrawerIcon name="edit" aria-hidden="true" />Editar</button>
                <button type="button" className={styles.cancel} onClick={() => setModal({ tipo: "excluir-carne", carne })}>Excluir</button>
              </div>
            </div>)}
          </div>
          <button type="button" className={styles.carneAdd} onClick={iniciarLeituraCarne} disabled={!cad.cliente?.id}>
            <DrawerIcon name="upload" width={15} height={15} aria-hidden="true" />Adicionar outro carnê
          </button>
        </div>}
      </div>
    </article>}

    {leitorAberto && cad.cliente?.id && <LeitorCarneModal clienteId={cad.cliente.id} onClose={() => setLeitorAberto(false)} onImportado={concluirLeituraCarne} />}

    {completo && <article className={`${styles.card} ${styles.financeCard}`}>
      <div className={styles.cardHead}><div role="heading" aria-level={3} className={styles.cardTitle}><DrawerIcon name="history" aria-hidden="true" />Histórico financeiro</div>{financeiroHistorico.length > 4 ? <button className={styles.linkBtn} type="button" onClick={() => setHistoricoTodo((v) => !v)}>{historicoTodo ? "Mostrar menos" : "Ver todos"}</button> : null}</div>
      <div className={styles.cardBody}>{financeiroHistorico.length ? <div className={styles.history}>
        {(historicoTodo ? financeiroHistorico : financeiroHistorico.slice(0, 4)).map((h) => { const d = descreverHistorico(h); return <div key={h.id} className={`${styles.historyRow} ${d.tipo === "payment" ? styles.payment : ""}`}><div className={styles.historyDate}>{formatDate(h.created_at)}</div><div className={styles.historyEvent}>{d.texto}</div><div className={styles.historyAuthor}>Por {d.autor}</div></div>; })}
      </div> : <div className={styles.empty}>Nenhum evento financeiro registrado.</div>}</div>
    </article>}

    {/* Portal no body: o menu usa position:fixed com coordenadas da tela, e
        qualquer ancestral com transform/animação (ex.: .financeStack) o
        deslocaria para fora da área visível. */}
    {menu && typeof document !== "undefined" && createPortal(<div className={styles.root}><div className={styles.menu} data-parcela-menu role="menu" style={{ left: menu.left, top: menu.top }}>
      <button type="button" role="menuitem" onClick={() => acao("detalhes", menu.b)}>Ver detalhes</button>
      <button type="button" role="menuitem" onClick={() => acao("editar", menu.b)}>Editar parcela</button>
      {menu.b.status === "pendente_confirmacao" ? <>
        {menu.b.comprovante_url && <a role="menuitem" className={styles.menuLink} href={cad.comprovanteHref(menu.b)} target="_blank" rel="noreferrer" onClick={() => setMenu(null)}>Ver comprovante</a>}
        <button type="button" role="menuitem" onClick={() => acao("confirmar", menu.b)}>Confirmar comprovante</button>
        <button type="button" role="menuitem" onClick={() => acao("rejeitar", menu.b)}>Rejeitar comprovante</button>
      </> : menu.b.status === "pago" ? (menu.b.comprovante_url ? <a role="menuitem" className={styles.menuLink} href={cad.comprovanteHref(menu.b)} target="_blank" rel="noreferrer" onClick={() => setMenu(null)}>Ver comprovante</a> : null) : <>
        <button type="button" role="menuitem" onClick={() => acao("baixa", menu.b)}>Registrar pagamento</button>
        {menu.b.comprovante_url ? <a role="menuitem" className={styles.menuLink} href={cad.comprovanteHref(menu.b)} target="_blank" rel="noreferrer" onClick={() => setMenu(null)}>Ver comprovante</a> : <button type="button" role="menuitem" onClick={() => acao("anexar", menu.b)}>Anexar comprovante</button>}
      </>}
      {(menu.b.status !== "nao_pago" || menu.b.suspensa) && <button type="button" role="menuitem" onClick={() => acao("reabrir", menu.b)}>Voltar para em aberto</button>}
      <div className={styles.separator} /><button className={styles.danger} type="button" role="menuitem" onClick={() => acao("excluir", menu.b)}>Excluir parcela</button>
    </div></div>, document.body)}

    {modal?.tipo === "detalhes" && <Shell titulo="Detalhes da parcela" onClose={() => setModal(null)}>
      <div className={styles.modalGrid}>
        <Box label="Parcela" value={`${modal.b.numero_parcela} de ${modal.b.total_parcelas || total}`} />
        <Box label="Vencimento" value={formatDate(modal.b.data_vencimento)} />
        <Box label="Valor" value={formatCurrency(modal.b.valor)} />
        <Box label="Status" value={PARCELA_LABEL[statusParcela(modal.b, hoje)]} />
        <Box label="Pagamento" value={formatDate(modal.b.data_pagamento)} />
        <Box label="Comprovante" value={modal.b.comprovante_url ? "Disponível" : "—"} />
        {modal.b.observacoes ? <div className={`${styles.modalValue} ${styles.span2}`}><b>Observações</b>{modal.b.observacoes}</div> : null}
      </div>
    </Shell>}

    {modal?.tipo === "editar" && <Shell titulo={`Editar parcela ${modal.b.numero_parcela}`} onClose={() => !cad.alterandoParcela && setModal(null)}>
      <form onSubmit={(e) => { e.preventDefault(); void salvarEdicao(modal.b); }}>
        <div className={styles.modalGrid}>
          <Box label="Parcela" value={`${modal.b.numero_parcela} de ${modal.b.total_parcelas || total}`} />
          <Field label="Vencimento" id="ed-venc"><input id="ed-venc" className={styles.input} type="date" value={editVenc} onChange={(e) => setEditVenc(e.target.value)} /></Field>
          <Field label="Valor" id="ed-valor"><input id="ed-valor" className={styles.input} inputMode="decimal" value={editValor} onChange={(e) => setEditValor(e.target.value)} /></Field>
          <Field label="Status" id="ed-status"><select id="ed-status" className={styles.input} value={editStatus} onChange={(e) => setEditStatus(e.target.value === "suspended" ? "suspended" : "pending")}><option value="pending">Em aberto</option><option value="suspended">Suspensa</option></select></Field>
          <div className={`${styles.modalValue} ${styles.span2}`}><b>Pagamento e comprovante</b>Use "Registrar pagamento" ou "Anexar comprovante" para manter a trilha financeira.</div>
        </div>
        <Acoes busy={cad.alterandoParcela} rotulo="Salvar parcela" onCancel={() => setModal(null)} />
      </form>
    </Shell>}

    {modal?.tipo === "reabrir" && <Shell titulo="Voltar parcela para em aberto" onClose={() => !cad.alterandoParcela && setModal(null)}>
      <div className={styles.warning}>
        <strong>Parcela {modal.b.numero_parcela}/{modal.b.total_parcelas || total} voltará para em aberto.</strong><br />
        {modal.b.status === "pago"
          ? "O pagamento será estornado no controle interno, sairá do total pago e o progresso/elegibilidade será recalculado. O histórico financeiro será preservado para auditoria."
          : modal.b.status === "pendente_confirmacao"
            ? "A conferência atual será cancelada e a parcela ficará novamente disponível para pagamento."
            : "A suspensão ou estado atual será removido e a parcela voltará ao fluxo normal de cobrança."}
      </div>
      <div className={styles.modalActions}>
        <button className={`${styles.modalBtn} ${styles.secondary}`} type="button" onClick={() => setModal(null)}>Cancelar</button>
        <button className={`${styles.modalBtn} ${styles.primary}`} type="button" disabled={cad.alterandoParcela} onClick={async () => { if (await cad.alterarParcela(modal.b, { acao: "reabrir" }, "Parcela voltou para em aberto.")) setModal(null); }}>{cad.alterandoParcela ? "Atualizando..." : "Voltar para em aberto"}</button>
      </div>
    </Shell>}

    {modal?.tipo === "excluir-carne" && <Shell titulo="Excluir carnê" onClose={() => !cad.criandoCarne && setModal(null)}>
      <div className={styles.warning}><strong>Excluir o registro deste carnê?</strong><br />As parcelas e boletos já importados serão preservados. Apenas a identificação do carnê será removida.</div>
      <div className={styles.modalGrid} style={{ marginTop: 10 }}>
        <Box label="Carnê" value={`${modal.carne.quantidade_parcelas} parcelas`} />
        <Box label="Instituição" value={modal.carne.instituicao_financeira} />
      </div>
      <div className={styles.modalActions}>
        <button className={`${styles.modalBtn} ${styles.secondary}`} type="button" onClick={() => setModal(null)}>Cancelar</button>
        <button className={`${styles.modalBtn} ${styles.deleteBtn}`} type="button" disabled={cad.criandoCarne} onClick={async () => { if (await cad.excluirCarne(modal.carne.id)) setModal(null); }}>{cad.criandoCarne ? "Excluindo..." : "Excluir carnê"}</button>
      </div>
    </Shell>}

    {modal?.tipo === "excluir" && <Shell titulo="Excluir parcela" onClose={() => !cad.alterandoParcela && setModal(null)}>
      <div className={styles.warning}><strong>Esta ação remove a parcela {modal.b.numero_parcela}/{modal.b.total_parcelas || total}.</strong><br />O servidor recalcula o plano com base nas parcelas restantes.</div>
      <div className={styles.modalGrid} style={{ marginTop: 10 }}><Box label="Vencimento" value={formatDate(modal.b.data_vencimento)} /><Box label="Valor" value={formatCurrency(modal.b.valor)} /></div>
      <div className={styles.modalActions}><button className={`${styles.modalBtn} ${styles.secondary}`} type="button" onClick={() => setModal(null)}>Cancelar</button><button className={`${styles.modalBtn} ${styles.deleteBtn}`} type="button" disabled={cad.alterandoParcela} onClick={async () => { if (await cad.alterarParcela(modal.b, { acao: "excluir" }, "Parcela excluída com sucesso.")) setModal(null); }}>{cad.alterandoParcela ? "Excluindo..." : "Excluir parcela"}</button></div>
    </Shell>}


    {modal?.tipo === "confirmar" && <Shell titulo="Confirmar comprovante" onClose={() => !cad.validando && setModal(null)}>
      <div className={styles.warning}>Confirme o comprovante da parcela {modal.b.numero_parcela}/{modal.b.total_parcelas || total}. A confirmação dá baixa na parcela pelo fluxo financeiro auditado.</div>
      <div className={styles.modalActions}><button className={`${styles.modalBtn} ${styles.secondary}`} type="button" onClick={() => setModal(null)}>Cancelar</button><button className={`${styles.modalBtn} ${styles.primary}`} type="button" disabled={cad.validando} onClick={async () => { if (await cad.confirmarPagamento(modal.b)) setModal(null); }}>{cad.validando ? "Confirmando..." : "Confirmar comprovante"}</button></div>
    </Shell>}

    {modal?.tipo === "rejeitar" && <Shell titulo="Rejeitar comprovante" onClose={() => !cad.validando && setModal(null)}>
      <form onSubmit={async (e) => { e.preventDefault(); if (await cad.rejeitarComprovante(motivo, modal.b)) setModal(null); }}>
        <div className={styles.warning}>Informe o motivo da rejeição do comprovante da parcela {modal.b.numero_parcela}. A parcela volta para aberto e a cliente é avisada.</div>
        <div className={styles.field} style={{ marginTop: 10 }}><label htmlFor="rej-motivo">Motivo</label><textarea id="rej-motivo" className={styles.input} value={motivo} onChange={(e) => setMotivo(e.target.value)} required /></div>
        <Acoes busy={cad.validando} rotulo="Rejeitar comprovante" onCancel={() => setModal(null)} />
      </form>
    </Shell>}

    {modal?.tipo === "ajuste" && <Shell titulo="Ajustar quantidade de parcelas" onClose={() => !cad.salvandoFin && setModal(null)}>
      <div className={styles.warning}>A quantidade de parcelas foi alterada de {qtdOriginal.current} para {cad.quantidade}. O ajuste mantém as parcelas pagas e em conferência intactas e recalcula as abertas.</div>
      <div className={styles.modalActions}><button className={`${styles.modalBtn} ${styles.secondary}`} type="button" onClick={() => setModal(null)}>Cancelar</button><button className={`${styles.modalBtn} ${styles.primary}`} type="button" disabled={cad.salvandoFin} onClick={async () => { await cad.gerarOuAjustarParcelas(); qtdOriginal.current = cad.quantidade; setModal(null); setEditandoPlano(false); }}>{cad.salvandoFin ? "Salvando..." : "Ajustar plano"}</button></div>
    </Shell>}
  </div>;
});


/** Comprovante enviado pela cliente aguardando análise (confirmar/rejeitar). */
export function ComprovanteBanner({ cad, onConfirmar, onRejeitar }: { cad: ClienteCadastro; onConfirmar: (b: Boleto) => void; onRejeitar: (b: Boleto) => void }) {
  const aguardando = cad.aguardandoConferencia;
  if (!aguardando) return null;
  return <div className={styles.banner} role="region" aria-label="Comprovante aguardando análise">
      <span className={styles.kicker}>Comprovante aguardando análise</span>
      <div className={styles.bannerRow}><span>Parcela</span><b>{aguardando.numero_parcela} de {aguardando.total_parcelas}</b></div>
      <div className={styles.bannerRow}><span>Vencimento</span><b>{formatDate(aguardando.data_vencimento)}</b></div>
      <div className={styles.bannerRow}><span>Valor</span><b>{formatCurrency(aguardando.valor)}</b></div>
      <div className={styles.bannerActions}>
        {aguardando.comprovante_url && <a className={`${styles.modalBtn} ${styles.secondary} ${styles.linkLike}`} href={cad.comprovanteHref(aguardando)} target="_blank" rel="noreferrer"><DrawerIcon name="document" width={14} height={14} aria-hidden="true" />Ver comprovante</a>}
        <button type="button" className={`${styles.modalBtn} ${styles.secondary}`} disabled={cad.validando} onClick={() => onRejeitar(aguardando)}>Rejeitar</button>
        <button type="button" className={`${styles.modalBtn} ${styles.primary}`} disabled={cad.validando} onClick={() => onConfirmar(aguardando)}>Confirmar pagamento</button>
      </div>
    </div>;
}

/** Baixa manual (registrar pagamento) — renderizado no nível do drawer. */
export function BaixaManualModal({ cad }: { cad: ClienteCadastro }) {
  if (!cad.baixaAlvo) return null;
  return <Shell titulo={`Registrar pagamento · parcela ${cad.baixaAlvo.numero_parcela}/${cad.baixaAlvo.total_parcelas || cad.boletos.length}`} onClose={() => { if (!cad.salvandoBaixa) cad.setBaixaAlvo(null); }}>
      <form onSubmit={async (e) => { e.preventDefault(); await cad.confirmarBaixaManual(); }}>
        <div className={styles.modalGrid}>
          <Box label="Valor original" value={formatCurrency(cad.baixaAlvo.valor)} />
          <Field label="Data do pagamento" id="bx-data"><input id="bx-data" className={styles.input} type="date" value={cad.baixaData} onChange={(e) => cad.setBaixaData(e.target.value)} /></Field>
          <Field label="Forma de pagamento" id="bx-forma"><select id="bx-forma" className={styles.input} value={cad.baixaForma} onChange={(e) => cad.setBaixaForma(e.target.value)}>{FORMAS_BAIXA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Instituição / banco" id="bx-banco"><input id="bx-banco" className={styles.input} value={cad.baixaBanco} onChange={(e) => cad.setBaixaBanco(e.target.value)} placeholder="Ex.: Santander" /></Field>
          <Field label="Juros" id="bx-juros"><input id="bx-juros" className={styles.input} inputMode="decimal" value={cad.baixaJuros} onChange={(e) => cad.setBaixaJuros(e.target.value)} /></Field>
          <Field label="Multa" id="bx-multa"><input id="bx-multa" className={styles.input} inputMode="decimal" value={cad.baixaMulta} onChange={(e) => cad.setBaixaMulta(e.target.value)} /></Field>
          <Field label="Observação" id="bx-obs" wide><textarea id="bx-obs" className={styles.input} rows={2} value={cad.baixaObs} onChange={(e) => cad.setBaixaObs(e.target.value)} /></Field>
          <Field label="Comprovante (opcional)" id="bx-arq" wide><input id="bx-arq" className={styles.input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => cad.setBaixaArquivo(e.target.files?.[0] ?? null)} /></Field>
        </div>
        <p className={styles.muted}>O total é validado e recalculado no servidor.</p>
        <Acoes busy={cad.salvandoBaixa} rotulo="Confirmar pagamento" onCancel={() => cad.setBaixaAlvo(null)} />
      </form>
    </Shell>;
}

function pillClass(s: ParcelaStatus) { return s === "paid" ? styles.pPaid : s === "pending" ? styles.pPending : s === "overdue" ? styles.pOverdue : s === "review" ? styles.pReview : s === "rejected" ? styles.pRejected : styles.pSuspended; }

/** Modal interno do drawer (camada absoluta sobre o drawer, ESC em captura). */
export function Shell({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", esc, true);
    return () => document.removeEventListener("keydown", esc, true);
  }, [onClose]);
  return <div className={styles.modalLayer} role="dialog" aria-modal="true" aria-label={titulo} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={styles.modal}>
      <div className={styles.modalHead}><div role="heading" aria-level={4} className={styles.modalTitle}>{titulo}</div><button className={styles.iconBtn} type="button" onClick={onClose} aria-label="Fechar"><DrawerIcon name="close" /></button></div>
      <div className={styles.modalBody}>{children}</div>
    </div>
  </div>;
}
function Kpi({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) { return <div className={styles.kpi}><span className={styles.kpiLabel}>{label}</span><strong className={`${styles.kpiValue} ${cls ?? ""}`}>{value}</strong>{sub ? <span className={styles.kpiSub}>{sub}</span> : null}</div>; }
function Info({ label, value, wide }: { label: string; value: string; wide?: boolean }) { return <div className={wide ? styles.span2 : undefined}><span className={styles.label}>{label}</span><div className={styles.value}>{value || "—"}</div></div>; }
function Box({ label, value }: { label: string; value: string }) { return <div className={styles.modalValue}><b>{label}</b>{value}</div>; }
function Field({ label, id, wide, children }: { label: string; id?: string; wide?: boolean; children: ReactNode }) { return <div className={`${styles.field} ${wide ? styles.span2 : ""}`}><label htmlFor={id}>{label}</label>{children}</div>; }
function Acoes({ busy, rotulo, onCancel }: { busy: boolean; rotulo: string; onCancel: () => void }) { return <div className={styles.modalActions}><button className={`${styles.modalBtn} ${styles.secondary}`} type="button" onClick={onCancel}>Cancelar</button><button className={`${styles.modalBtn} ${styles.primary}`} type="submit" disabled={busy} aria-busy={busy}>{busy ? "Salvando..." : rotulo}</button></div>; }
