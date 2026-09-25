import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { formatarCentavos, formatarData, mascararCpf, somenteDigitos } from "@/lib/leitor-carne/normalizadores";
import { definirAcao, editarCampo, linhaValida, montarRevisao, pendenciasItem, podeConfirmar, resumoDecisoes, type AcaoItem, type CampoEditavel, type ItemRevisao } from "@/lib/leitor-carne/revisao";
import type { Alerta, CampoExtraido, Caixa, ClienteReferencia, NivelConfianca, ParcelaExistente, ParcelaLida } from "@/lib/leitor-carne/tipos";
import { ErroArquivo, receberArquivo, type ArquivoRecebido } from "./intake";
import { lerDocumento, type ProgressoLeitura, type ResultadoLeitura } from "./processador";
import { ErroImportacao, importarCarne, type ResultadoImportacao } from "./importacao";
import styles from "./LeitorCarne.module.css";

/**
 * Leitor de carnês — fluxo completo no admin:
 * escolher arquivo → ler no aparelho (texto nativo + OCR local) → REVISAR
 * (cada parcela com evidência, confiança, alertas e decisão) → confirmar →
 * importar (transacional e idempotente). Nada é gravado antes da confirmação.
 */

type Etapa =
  | { tipo: "escolher"; erro?: string }
  | { tipo: "lendo"; progresso: ProgressoLeitura }
  | { tipo: "revisar" }
  | { tipo: "confirmar" }
  | { tipo: "importando"; mensagem: string; percentual: number }
  | { tipo: "concluido"; resultado: ResultadoImportacao };

interface Contexto {
  cliente: ClienteReferencia;
  parcelas: ParcelaExistente[];
  documentoJaImportado: { em: string } | null;
}

export interface LeituraCarneConcluida {
  quantidadeParcelas: number;
  instituicao: string;
}

const ROTULO_ACAO: Record<AcaoItem, string> = { criar: "Criar nova parcela", anexar: "Anexar à parcela do cadastro", substituir: "Substituir o boleto da parcela", ignorar: "Não importar" };
const ROTULO_NIVEL: Record<NivelConfianca, string> = { ALTA: "Confiança alta", MEDIA: "Confiança média", BAIXA: "Confiança baixa" };
const TIPO_DOC: Record<string, string> = { PDF_TEXT: "PDF com texto", PDF_SCANNED: "PDF escaneado", MIXED_PDF: "PDF misto", IMAGE: "Imagem" };

function novaChave() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Valor digitado pela equipe ("1.234,56", "1234,5", "1234") → centavos. */
function lerValorDigitado(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.]/g, "");
  if (!limpo) return null;
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normal);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function Ponto({ nivel }: { nivel?: NivelConfianca }) {
  if (!nivel) return null;
  return <i className={nivel === "ALTA" ? styles.dotA : nivel === "MEDIA" ? styles.dotM : styles.dotB} title={ROTULO_NIVEL[nivel]} aria-label={ROTULO_NIVEL[nivel]} />;
}

function estiloCaixa(c: Caixa) {
  return { left: `${c.x0 * 100}%`, top: `${c.y0 * 100}%`, width: `${Math.max(0.5, (c.x1 - c.x0) * 100)}%`, height: `${Math.max(0.5, (c.y1 - c.y0) * 100)}%` };
}

export function LeitorCarneModal({ clienteId, onClose, onImportado }: { clienteId: string; onClose: () => void; onImportado: (dados?: LeituraCarneConcluida) => void }) {
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "escolher" });
  const [arrastando, setArrastando] = useState(false);
  const [arquivo, setArquivo] = useState<ArquivoRecebido | null>(null);
  const [leitura, setLeitura] = useState<ResultadoLeitura | null>(null);
  const [contexto, setContexto] = useState<Contexto | null>(null);
  const [itens, setItens] = useState<ItemRevisao[]>([]);
  const [ativo, setAtivo] = useState<string | null>(null);
  const [campoAtivo, setCampoAtivo] = useState<CampoEditavel | null>(null);
  const [filtro, setFiltro] = useState<"atencao" | "todas">("atencao");
  const [cpfConfirmado, setCpfConfirmado] = useState(false);
  const [reimportar, setReimportar] = useState(false);
  const [erroImportacao, setErroImportacao] = useState<string | null>(null);
  const controle = useRef<AbortController | null>(null);
  const chave = useRef<string>(novaChave());
  const inputRef = useRef<HTMLInputElement>(null);

  const ocupado = etapa.tipo === "lendo" || etapa.tipo === "importando";

  // As parcelas do drawer são recarregadas ao fechar: recarregar antes
  // desmontaria o painel e esconderia o resultado da importação.
  const importou = useRef(false);
  const dadosImportados = useRef<LeituraCarneConcluida | null>(null);
  const fechar = useCallback(() => {
    if (etapa.tipo === "importando") return;
    controle.current?.abort();
    if (importou.current) onImportado(dadosImportados.current ?? undefined);
    onClose();
  }, [etapa.tipo, onClose, onImportado]);

  useEffect(() => () => { controle.current?.abort(); }, []);
  useEffect(() => () => { leitura?.liberar(); }, [leitura]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !ocupado) { e.stopPropagation(); fechar(); } };
    document.addEventListener("keydown", esc, true);
    return () => document.removeEventListener("keydown", esc, true);
  }, [fechar, ocupado]);

  async function iniciar(file: File) {
    setErroImportacao(null);
    const ac = new AbortController();
    controle.current = ac;
    try {
      const recebido = await receberArquivo(file);
      setEtapa({ tipo: "lendo", progresso: { etapa: "abrindo", mensagem: "Abrindo o documento…", percentual: 3 } });
      const r = await fetch(`/api/admin/clientes/${encodeURIComponent(clienteId)}/leitor-carne?sha=${recebido.sha256}`, { cache: "no-store", signal: ac.signal });
      const ctx = await r.json().catch(() => ({})) as Contexto & { erro?: string };
      if (!r.ok) throw new Error(ctx.erro ?? "Não foi possível carregar as parcelas da cliente.");
      const resultado = await lerDocumento(recebido, { cliente: ctx.cliente, sinal: ac.signal, aoProgredir: (progresso) => setEtapa({ tipo: "lendo", progresso }) });
      const revisao = montarRevisao(resultado.carne, ctx.parcelas);
      leitura?.liberar();
      setArquivo(recebido);
      setContexto(ctx);
      setLeitura(resultado);
      setItens(revisao.itens);
      setAtivo(revisao.itens[0]?.id ?? null);
      setCpfConfirmado(false);
      setReimportar(false);
      chave.current = novaChave();
      setEtapa({ tipo: "revisar" });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") { setEtapa({ tipo: "escolher", erro: "Leitura cancelada." }); return; }
      setEtapa({ tipo: "escolher", erro: e instanceof ErroArquivo || e instanceof Error ? e.message : "Não foi possível ler o documento." });
    }
  }

  function aoEscolher(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) void iniciar(f);
  }
  function aoSoltar(e: DragEvent) {
    e.preventDefault();
    setArrastando(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void iniciar(f);
  }

  const carne = leitura?.carne ?? null;
  const existentes = contexto?.parcelas ?? [];
  const lidas = useMemo(() => new Map<string, ParcelaLida>((carne?.parcelas ?? []).map((p) => [p.id, p])), [carne]);
  const cpfDivergente = Boolean(carne?.alertas.some((a) => a.codigo === "CLIENT_CPF_MISMATCH"));
  const duplicado = Boolean(contexto?.documentoJaImportado);
  const resumo = resumoDecisoes(itens, existentes);
  const pronto = podeConfirmar(itens, existentes, cpfDivergente, cpfConfirmado) && (!duplicado || reimportar);
  const precisaAtencao = (it: ItemRevisao) => it.acao === null || it.nivel !== "ALTA" || it.alertas.some((a) => a.severidade !== "INFO") || pendenciasItem(it, itens, existentes).length > 0;
  const visiveis = filtro === "todas" ? itens : itens.filter(precisaAtencao);
  const itemAtivo = itens.find((i) => i.id === ativo) ?? null;
  const miniatura = itemAtivo ? leitura?.miniaturas.find((m) => m.pagina === itemAtivo.pagina) : null;

  const atualizar = (id: string, f: (i: ItemRevisao) => ItemRevisao) => setItens((lista) => lista.map((i) => (i.id === id ? f(i) : i)));

  const alertasDocumento = (carne?.alertas ?? []).filter((a) => !a.item);

  async function confirmar() {
    if (!arquivo || !leitura || !carne) return;
    setErroImportacao(null);
    const ac = new AbortController();
    controle.current = ac;
    setEtapa({ tipo: "importando", mensagem: "Preparando…", percentual: 2 });
    try {
      const resultado = await importarCarne({
        clienteId,
        chave: chave.current,
        arquivo: leitura.arquivo,
        bytes: arquivo.bytes,
        carne,
        metricas: leitura.metricas,
        rotacoes: leitura.rotacoes,
        itens,
        permitirReimportacao: duplicado && reimportar,
        cpfDivergenteConfirmado: cpfDivergente && cpfConfirmado,
      }, (p) => setEtapa({ tipo: "importando", ...p }), ac.signal);
      importou.current = true;
      dadosImportados.current = {
        quantidadeParcelas: carne.resumo.totalInformado ?? carne.resumo.encontradas,
        instituicao: carne.banco.valor ?? "",
      };
      setEtapa({ tipo: "concluido", resultado });
    } catch (e) {
      setErroImportacao(e instanceof DOMException && e.name === "AbortError" ? "Importação cancelada. Nada foi gravado nas parcelas." : e instanceof ErroImportacao || e instanceof Error ? e.message : "Não foi possível concluir a importação.");
      setEtapa({ tipo: "revisar" });
    }
  }

  const compacto = etapa.tipo !== "revisar";

  return createPortal(<div className={styles.layer} role="dialog" aria-modal="true" aria-label="Ler carnê" onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado && etapa.tipo !== "revisar") fechar(); }}>
    <div className={`${styles.dialog} ${compacto ? styles.compact : ""}`}>
      <div className={styles.head}>
        <div>
          <h3 className={styles.title}>{etapa.tipo === "confirmar" ? "Confirmar importação" : "Ler carnê"}</h3>
          <p className={styles.subtitle}>
            {etapa.tipo === "revisar" && carne ? `${arquivo?.nome ?? ""} · ${TIPO_DOC[carne.tipoDocumento]} · ${carne.paginas} página${carne.paginas > 1 ? "s" : ""}` : "PDF (com texto ou escaneado), JPG ou PNG"}
          </p>
        </div>
        {!ocupado && <button type="button" className={styles.close} onClick={fechar} aria-label="Fechar">×</button>}
      </div>

      {etapa.tipo === "escolher" && <div className={styles.body}>
        <label className={`${styles.drop} ${arrastando ? styles.over : ""}`} onDragOver={(e) => { e.preventDefault(); setArrastando(true); }} onDragLeave={() => setArrastando(false)} onDrop={aoSoltar}>
          <strong>Escolha ou arraste o carnê</strong>
          <span>Uma parcela por página ou várias na mesma folha. Pode ser o PDF do banco, um PDF escaneado ou a foto do carnê.</span>
          <span className={styles.btn} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}>Selecionar arquivo</span>
          <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" hidden onChange={aoEscolher} />
        </label>
        {etapa.erro && <div className={styles.errorBox} role="alert">{etapa.erro}</div>}
        <p className={styles.privacy}>A leitura acontece neste computador, sem enviar o documento a serviços externos. Você confere cada parcela antes de qualquer gravação.</p>
      </div>}

      {etapa.tipo === "lendo" && <div className={styles.body}>
        <div className={styles.progress} aria-live="polite">
          <strong>{etapa.progresso.mensagem}</strong>
          <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={etapa.progresso.percentual}><i style={{ width: `${etapa.progresso.percentual}%` }} /></div>
          <p>Páginas escaneadas ou fotos levam alguns segundos cada.</p>
          <div><button type="button" className={styles.btn} onClick={() => controle.current?.abort()}>Cancelar leitura</button></div>
        </div>
      </div>}

      {etapa.tipo === "importando" && <div className={styles.body}>
        <div className={styles.progress} aria-live="polite">
          <strong>{etapa.mensagem}</strong>
          <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={etapa.percentual}><i style={{ width: `${etapa.percentual}%` }} /></div>
          <p>Não feche esta janela.</p>
        </div>
      </div>}

      {etapa.tipo === "concluido" && <div className={styles.body}>
        <div className={styles.done}>
          <strong>{etapa.resultado.repetida ? "Esta importação já tinha sido concluída" : "Importação concluída"}</strong>
          <ul className={styles.confirmList}>
            {etapa.resultado.criadas > 0 && <li><span>Parcelas criadas</span><b>{etapa.resultado.criadas}</b></li>}
            {etapa.resultado.anexadas > 0 && <li><span>Boletos anexados</span><b>{etapa.resultado.anexadas}</b></li>}
            {etapa.resultado.substituidas > 0 && <li><span>Boletos substituídos</span><b>{etapa.resultado.substituidas}</b></li>}
            {etapa.resultado.ignoradas > 0 && <li><span>Folhas não importadas</span><b>{etapa.resultado.ignoradas}</b></li>}
          </ul>
          <p className={styles.hint}>Os boletos já aparecem no app da cliente.</p>
          <div><button type="button" className={`${styles.btn} ${styles.primary}`} onClick={fechar}>Fechar</button></div>
        </div>
      </div>}

      {etapa.tipo === "confirmar" && <div className={styles.body}>
        <p className={styles.hint} style={{ marginTop: 0 }}>Confira o que será gravado. Parcelas existentes não têm valor, vencimento ou status alterados.</p>
        <ul className={styles.confirmList}>
          {resumo.criar > 0 && <li><span>Criar parcelas novas</span><b>{resumo.criar}</b></li>}
          {resumo.anexar > 0 && <li><span>Anexar boleto a parcelas existentes</span><b>{resumo.anexar}</b></li>}
          {resumo.substituir > 0 && <li><span>Substituir boletos</span><b>{resumo.substituir}</b></li>}
          {resumo.ignorar > 0 && <li><span>Não importar</span><b>{resumo.ignorar}</b></li>}
          {resumo.corrigidos > 0 && <li><span>Parcelas com dados corrigidos por você</span><b>{resumo.corrigidos}</b></li>}
        </ul>
        {cpfDivergente && <div className={styles.errorBox}>Você confirmou importar um documento com CPF diferente do cadastro.</div>}
      </div>}
      {etapa.tipo === "confirmar" && <div className={styles.foot}>
        <div className={styles.footActions}>
          <button type="button" className={styles.btn} onClick={() => setEtapa({ tipo: "revisar" })}>Voltar à revisão</button>
          <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => void confirmar()}>Confirmar importação</button>
        </div>
      </div>}

      {etapa.tipo === "revisar" && carne && <>
        <div className={styles.body}>
          <div className={styles.summary}>
            <div className={styles.kpi}><span>Parcelas encontradas</span><strong>{carne.resumo.encontradas}{carne.resumo.totalInformado ? ` de ${carne.resumo.totalInformado}` : ""}</strong><small>{carne.resumo.faixa.primeira != null ? `Da ${carne.resumo.faixa.primeira}ª à ${carne.resumo.faixa.ultima}ª` : "Números não identificados"}</small></div>
            <div className={styles.kpi}><span>Vencimentos</span><strong>{carne.resumo.primeiroVencimento ? formatarData(carne.resumo.primeiroVencimento) : "—"}</strong><small>{carne.resumo.ultimoVencimento ? `até ${formatarData(carne.resumo.ultimoVencimento)}` : "—"}{carne.resumo.periodicidade === "MENSAL" ? " · mensal" : carne.resumo.periodicidade === "IRREGULAR" ? " · irregular" : ""}</small></div>
            <div className={styles.kpi}><span>Valor da parcela</span><strong>{carne.resumo.valorPredominanteCentavos != null ? formatarCentavos(carne.resumo.valorPredominanteCentavos) : "Variável"}</strong><small>Total lido {formatarCentavos(carne.resumo.valorTotalCentavos)}</small></div>
            <div className={styles.kpi}><span>Leitura</span><strong><Ponto nivel={carne.nivelDocumento} /> {ROTULO_NIVEL[carne.nivelDocumento]}</strong><small>{carne.banco.valor ? `${carne.banco.valor} · ` : ""}{carne.paginasOcr ? `${carne.paginasOcr} pág. por OCR` : "texto do PDF"}</small></div>
          </div>

          <div className={styles.notices}>
            <div className={`${styles.notice} ${styles.INFO}`}>
              <div>Pagador no documento: <b>{carne.nomeCliente.valor ?? "não identificado"}</b>{carne.cpf.valor ? <> · CPF <b>{mascararCpf(carne.cpf.valor)}</b></> : " · CPF não identificado"}{contexto?.cliente.nome ? <> — cadastro: <b>{contexto.cliente.nome}</b></> : null}</div>
            </div>
            {duplicado && <div className={`${styles.notice} ${styles.ALERTA}`}><div>Este mesmo arquivo já foi importado para esta cliente em {formatarData(contexto!.documentoJaImportado!.em.slice(0, 10))}.
              <label><input type="checkbox" checked={reimportar} onChange={(e) => setReimportar(e.target.checked)} /> Quero importar de novo mesmo assim</label></div></div>}
            {cpfDivergente && <div className={`${styles.notice} ${styles.ERRO}`}><div><b>O CPF do documento não é o da cliente selecionada.</b> Confira se o carnê é mesmo desta cliente.
              <label><input type="checkbox" checked={cpfConfirmado} onChange={(e) => setCpfConfirmado(e.target.checked)} /> Conferi e o carnê é desta cliente</label></div></div>}
            {alertasDocumento.filter((a) => a.codigo !== "CLIENT_CPF_MISMATCH").map((a, i) => <div key={`${a.codigo}-${i}`} className={`${styles.notice} ${styles[a.severidade]}`}>{a.mensagem}</div>)}
          </div>

          <div className={styles.toolbar}>
            <div className={styles.filters} role="group" aria-label="Filtrar parcelas">
              <button type="button" aria-pressed={filtro === "atencao"} onClick={() => setFiltro("atencao")}>Precisam de atenção ({itens.filter(precisaAtencao).length})</button>
              <button type="button" aria-pressed={filtro === "todas"} onClick={() => setFiltro("todas")}>Todas ({itens.length})</button>
            </div>
            <span className={styles.hint}>Campos em azul foram corrigidos por você.</span>
          </div>

          <div className={styles.split}>
            <div className={styles.list}>
              {visiveis.length === 0 && <div className={styles.hint} style={{ padding: 16, textAlign: "center" }}>{itens.length ? "Nenhuma parcela precisa de atenção. Confira em \"Todas\" se quiser." : "Nenhuma parcela foi identificada neste documento."}</div>}
              {visiveis.map((it) => <ItemCartao key={it.id} item={it} lida={lidas.get(it.id)} ativo={it.id === ativo} existentes={existentes} pendencias={pendenciasItem(it, itens, existentes)} onFocar={() => setAtivo(it.id)} onCampo={setCampoAtivo} onAlterar={(f) => atualizar(it.id, f)} />)}
            </div>
            <aside className={styles.evidence} aria-label="Evidência no documento">
              <h4>{itemAtivo ? `Página ${itemAtivo.pagina}` : "Documento"}</h4>
              {miniatura ? <div className={styles.page}>
                <img src={miniatura.url} alt={`Página ${miniatura.pagina} do documento`} />
                {itemAtivo?.regiao && <span className={styles.box} style={estiloCaixa(itemAtivo.regiao)} />}
                {itemAtivo && campoAtivo && itemAtivo.caixas[campoAtivo] && <span className={`${styles.box} ${styles.field}`} style={estiloCaixa(itemAtivo.caixas[campoAtivo]!)} />}
              </div> : <p className={styles.hint}>Selecione uma parcela para ver onde ela está na página.</p>}
              <p className={styles.hint}>Contorno vinho: área da parcela. Ao clicar num campo, o contorno azul mostra onde ele foi lido.</p>
            </aside>
          </div>
        </div>
        <div className={styles.foot}>
          <div className={styles.footInfo} aria-live="polite">
            {erroImportacao && <div className={styles.errorBox} role="alert" style={{ marginTop: 0, marginBottom: 6 }}>{erroImportacao}</div>}
            <b>{resumo.criar}</b> criar · <b>{resumo.anexar}</b> anexar · <b>{resumo.substituir}</b> substituir · <b>{resumo.ignorar}</b> não importar
            {resumo.semDecisao > 0 && <> · <b>{resumo.semDecisao}</b> sem decisão</>}
            {resumo.comPendencia > 0 && <> · <b>{resumo.comPendencia}</b> com pendência</>}
          </div>
          <div className={styles.footActions}>
            <button type="button" className={styles.btn} onClick={() => { leitura?.liberar(); setLeitura(null); setItens([]); setEtapa({ tipo: "escolher" }); }}>Ler outro arquivo</button>
            <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={!pronto} title={pronto ? undefined : "Decida e resolva as pendências de todas as parcelas"} onClick={() => setEtapa({ tipo: "confirmar" })}>Revisar e importar</button>
          </div>
        </div>
      </>}
    </div>
  </div>, document.body);
}

function nivelCampo(c?: CampoExtraido<unknown>): NivelConfianca | undefined {
  return c && c.valor != null ? c.nivel : c ? "BAIXA" : undefined;
}

function ItemCartao({ item, lida, ativo, existentes, pendencias, onFocar, onCampo, onAlterar }: {
  item: ItemRevisao;
  lida?: ParcelaLida;
  ativo: boolean;
  existentes: ParcelaExistente[];
  pendencias: string[];
  onFocar: () => void;
  onCampo: (campo: CampoEditavel | null) => void;
  onAlterar: (f: (i: ItemRevisao) => ItemRevisao) => void;
}) {
  const [valorTexto, setValorTexto] = useState(item.valorCentavos != null ? formatarCentavos(item.valorCentavos).replace(/^R\$\s?/, "") : "");
  const corrigido = (c: CampoEditavel) => item.corrigidos.includes(c);
  const cls = (c: CampoEditavel, invalido = false) => `${styles.input} ${invalido ? styles.invalid : corrigido(c) ? styles.corrected : ""}`;
  const alvoOpcoes = item.acao === "anexar" ? existentes.filter((e) => !e.temBoleto) : item.acao === "substituir" ? existentes.filter((e) => e.temBoleto && e.status !== "pago" && e.status !== "pendente_confirmacao") : [];
  const status = item.acao === null ? { cls: styles.muted, txt: "Sem decisão" } : pendencias.length ? { cls: styles.err, txt: "Pendente" } : item.acao === "ignorar" ? { cls: styles.muted, txt: "Não importar" } : item.nivel === "ALTA" && !item.alertas.some((a: Alerta) => a.severidade !== "INFO") ? { cls: styles.ok, txt: "✓ Conferida" } : { cls: styles.warn, txt: "⚠ Confira" };
  const titulo = item.numero != null ? `Parcela ${item.numero}${item.total ? `/${item.total}` : ""}` : "Parcela sem número";
  const alertasVisiveis = item.alertas.filter((a) => a.severidade !== "INFO");
  const numero = (s: string) => { const d = somenteDigitos(s); return d ? Number(d) : null; };

  function mudarAcao(valor: string) {
    const acao = (valor || null) as AcaoItem | null;
    const alvoPadrao = acao === "anexar" ? (item.existente && !item.existente.temBoleto ? item.existente.id : item.sugestaoAnexo?.boletoId ?? null) : acao === "substituir" ? (item.existente?.temBoleto ? item.existente.id : null) : null;
    onAlterar((i) => definirAcao(i, acao, alvoPadrao));
  }

  return <article className={`${styles.item} ${ativo ? styles.active : ""}`} onFocusCapture={onFocar} onMouseDown={onFocar} aria-label={titulo}>
    <div className={styles.itemHead}>
      <div className={styles.itemTitle}>{titulo}<span className={`${styles.chip} ${status.cls}`}>{status.txt}</span><span className={`${styles.chip} ${styles.muted}`}><Ponto nivel={item.nivel} /> {Math.round(item.confianca * 100)}%</span></div>
      <span className={styles.hint}>Página {item.pagina}{item.existente ? ` · no cadastro: ${formatarCentavos(item.existente.valorCentavos)} em ${formatarData(item.existente.vencimento)}${item.existente.temBoleto ? " · já tem boleto" : ""}` : " · não existe no cadastro"}</span>
    </div>

    <div className={styles.fields}>
      <div className={styles.field}>
        <label><Ponto nivel={corrigido("numero") ? undefined : nivelCampo(lida?.numero)} />Parcela{corrigido("numero") || corrigido("total") ? <span className={styles.userTag}>editado</span> : null}</label>
        <div className={styles.pair}>
          <input className={cls("numero", item.numero == null)} inputMode="numeric" aria-label="Número da parcela" onFocus={() => onCampo("numero")} value={item.numero ?? ""} onChange={(e) => onAlterar((i) => editarCampo(i, "numero", numero(e.target.value)))} />
          <span>/</span>
          <input className={cls("total", item.total == null)} inputMode="numeric" aria-label="Total de parcelas" onFocus={() => onCampo("total")} value={item.total ?? ""} onChange={(e) => onAlterar((i) => editarCampo(i, "total", numero(e.target.value)))} />
        </div>
      </div>
      <div className={styles.field}>
        <label><Ponto nivel={corrigido("vencimento") ? undefined : nivelCampo(lida?.vencimento)} />Vencimento{corrigido("vencimento") ? <span className={styles.userTag}>editado</span> : null}</label>
        <input type="date" className={cls("vencimento", !item.vencimento)} aria-label="Vencimento" onFocus={() => onCampo("vencimento")} value={item.vencimento ?? ""} onChange={(e) => onAlterar((i) => editarCampo(i, "vencimento", e.target.value || null))} />
      </div>
      <div className={styles.field}>
        <label><Ponto nivel={corrigido("valorCentavos") ? undefined : nivelCampo(lida?.valorCentavos)} />Valor (R$){corrigido("valorCentavos") ? <span className={styles.userTag}>editado</span> : null}</label>
        <input className={cls("valorCentavos", item.valorCentavos == null)} inputMode="decimal" aria-label="Valor" onFocus={() => onCampo("valorCentavos")} value={valorTexto} onChange={(e) => { setValorTexto(e.target.value); const v = lerValorDigitado(e.target.value); onAlterar((i) => editarCampo(i, "valorCentavos", v)); }} />
      </div>
      <div className={styles.field}>
        <label><Ponto nivel={corrigido("linhaDigitavel") ? undefined : nivelCampo(lida?.linhaDigitavel)} />Linha digitável{corrigido("linhaDigitavel") ? <span className={styles.userTag}>editado</span> : null}</label>
        <input className={cls("linhaDigitavel", !linhaValida(item.linhaDigitavel))} inputMode="numeric" aria-label="Linha digitável" onFocus={() => onCampo("linhaDigitavel")} value={item.linhaDigitavel ?? ""} placeholder="Não encontrada" onChange={(e) => onAlterar((i) => editarCampo(i, "linhaDigitavel", somenteDigitos(e.target.value) || null))} />
      </div>
    </div>

    {item.sugestaoLinha && item.sugestaoLinha !== item.linhaDigitavel && <div className={styles.suggest}>
      A linha digitável parece ter letras lidas no lugar de números. Sugestão que passa na conferência dos dígitos: <b>{item.sugestaoLinha}</b>
      <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => onAlterar((i) => editarCampo(i, "linhaDigitavel", item.sugestaoLinha))}>Usar sugestão</button>
    </div>}
    {item.sugestaoAnexo && !(item.acao === "anexar" && item.boletoId === item.sugestaoAnexo.boletoId) && <div className={styles.suggest}>
      {item.sugestaoAnexo.motivo} Esta folha pode ser o boleto da parcela {item.sugestaoAnexo.numero}.
      <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => onAlterar((i) => definirAcao(i, "anexar", item.sugestaoAnexo!.boletoId))}>Anexar à parcela {item.sugestaoAnexo.numero}</button>
    </div>}

    {alertasVisiveis.length > 0 && <ul className={styles.issues}>{alertasVisiveis.map((a, i) => <li key={`${a.codigo}-${i}`}>{a.mensagem}</li>)}</ul>}

    <div className={styles.actionRow}>
      <select aria-label="O que fazer com esta parcela" value={item.acao ?? ""} onChange={(e) => mudarAcao(e.target.value)}>
        <option value="">Escolha o que fazer…</option>
        {(Object.keys(ROTULO_ACAO) as AcaoItem[]).map((a) => <option key={a} value={a}>{ROTULO_ACAO[a]}</option>)}
      </select>
      {(item.acao === "anexar" || item.acao === "substituir") && <select aria-label="Parcela do cadastro" value={item.boletoId ?? ""} onChange={(e) => onAlterar((i) => definirAcao(i, i.acao, e.target.value || null))}>
        <option value="">Parcela do cadastro…</option>
        {alvoOpcoes.map((e) => <option key={e.id} value={e.id}>{`${e.numero}/${e.total} · ${formatarData(e.vencimento)} · ${formatarCentavos(e.valorCentavos)}`}</option>)}
      </select>}
    </div>
    {pendencias.length > 0 && item.acao !== null && <ul className={`${styles.issues} ${styles.block}`}>{pendencias.map((p) => <li key={p}>{p}</li>)}</ul>}
  </article>;
}
