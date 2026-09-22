import { formatarMoeda } from "@/lib/utils";
import { QUANTIDADE_PARCELAS_OPCOES, STATUS_BOLETO_LABEL } from "@/types/database";
import { zipChip } from "../zipUi";
import { Field, Row, Section, dataBrCurta, fieldInput, moedaNumero, primaryBtn, rowLabel, secondaryBtn } from "./clienteUi";
import type { ClienteCadastro } from "./useClienteCadastro";

/** Comprovante enviado pela cliente aguardando análise (confirmar/rejeitar). */
export function ClienteComprovanteAguardando({ cad }: { cad: ClienteCadastro }) {
  const b = cad.aguardandoConferencia;
  if (!b) return null;
  return <div style={{ border: "1px solid var(--gobg)", background: "var(--gobg)", borderRadius: 12, padding: "12px 13px", marginBottom: 12 }}>
    <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--gold)" }}>Comprovante aguardando análise</div>
    <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 7 }}>
      <Row label="Parcela" value={`${b.numero_parcela} de ${b.total_parcelas}`} />
      <Row label="Enviado em" value={dataBrCurta(b.data_pagamento)} />
      <Row label="Valor informado" value={formatarMoeda(Number(b.valor ?? 0))} />
    </div>
    <div style={{ marginTop: 10, display: "flex", gap: 7 }}>
      {b.comprovante_url && <a href={b.comprovante_url} target="_blank" rel="noreferrer" style={{ flex: 1, height: 33, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--ink)", fontSize: 11.5, fontWeight: 600 }}>Ver comprovante</a>}
      <button type="button" disabled={cad.validando} onClick={cad.rejeitarComprovante} style={{ flex: 1, height: 33, borderRadius: 9, border: "1px solid var(--bad)", background: "var(--s0)", color: "var(--bad)", fontSize: 11.5, fontWeight: 600 }}>Rejeitar</button>
      <button type="button" disabled={cad.validando} onClick={cad.confirmarPagamento} style={{ flex: 1, height: 33, borderRadius: 9, border: "1px solid var(--bg)", background: "var(--bg)", color: "#FFFDFC", fontSize: 11.5, fontWeight: 600 }}>Confirmar pagamento</button>
    </div>
  </div>;
}

/** Lista real de parcelas e comprovantes (ver comprovante, baixa manual). */
export function ClienteInstallmentsSection({ cad }: { cad: ClienteCadastro }) {
  if (cad.boletos.length === 0) return null;
  return <Section title="Parcelas e comprovantes">
    {cad.visiveis.map((b) => <div key={b.id} style={{ display: "grid", gridTemplateColumns: "24px 1fr auto auto", gap: 8, alignItems: "center", padding: "7px 0", borderBottom: "1px solid var(--line2)", fontSize: 11.5 }} className="zip-mono">
      <span style={{ color: "var(--soft)", fontWeight: 600 }}>{b.numero_parcela}</span>
      <div><div style={{ fontWeight: 600 }}>{dataBrCurta(b.data_vencimento)}</div><div style={{ fontSize: 10, color: "var(--soft)" }}>R$ {moedaNumero(Number(b.valor || 0))}</div></div>
      <span style={zipChip(b.status === "pago" ? "ok" : b.status === "pendente_confirmacao" ? "warn" : "neutral")}>{STATUS_BOLETO_LABEL[b.status] ?? b.status}</span>
      <span style={{ display: "flex", gap: 5 }}>
        {b.comprovante_url && <a href={b.comprovante_url} target="_blank" rel="noreferrer" style={{ ...secondaryBtn, height: 24, padding: "0 8px" }}>Ver</a>}
        {b.status === "nao_pago" && <button type="button" onClick={() => cad.abrirBaixaManual(b)} style={{ ...secondaryBtn, height: 24, padding: "0 8px" }}>Baixa manual</button>}
      </span>
    </div>)}
    {cad.boletos.length > 8 && <button type="button" onClick={() => cad.setMostrarTodas((v) => !v)} style={{ ...secondaryBtn, width: "100%", marginTop: 8 }}>{cad.mostrarTodas ? "Mostrar menos" : `Mostrar todas as ${cad.boletos.length} parcelas`}</button>}
  </Section>;
}

/** Financeiro real da cliente: plano (carta, taxa, parcelas), situação, parcelas, carnês. */
export function ClienteFinancePanel({ cad }: { cad: ClienteCadastro }) {
  if (cad.carregandoFin) return <div style={{ padding: "14px 0" }}><p style={{ padding: "40px 0", textAlign: "center", fontSize: 12, color: "var(--soft)" }}>Carregando financeiro…</p></div>;
  const { boletos } = cad;
  return <div style={{ padding: "14px 0", display: "flex", flexDirection: "column", gap: 0 }}>
    <ClienteComprovanteAguardando cad={cad} />
    <div style={{ borderRadius: 11, border: "1px solid var(--line)", background: "var(--s1)", padding: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Row label="Carta de crédito" value={<input style={{ ...fieldInput, height: 26, textAlign: "right", width: 110 }} value={cad.carta} onChange={(e) => cad.atualizarCarta(e.target.value)} />} />
        <Row label="Taxa administrativa" value={<input style={{ ...fieldInput, height: 26, textAlign: "right", width: 70 }} value={cad.taxa} onChange={(e) => cad.atualizarTaxa(e.target.value)} />} />
        <Row label="Parcelas" value={<select style={{ ...fieldInput, height: 26, width: 70 }} value={String(cad.quantidade)} onChange={(e) => cad.atualizarQuantidade(e.target.value)}>{QUANTIDADE_PARCELAS_OPCOES.map((q) => <option key={q} value={q}>{q}x</option>)}</select>} />
        <Row label="Valor da parcela" value={<input style={{ ...fieldInput, height: 26, textAlign: "right", width: 90 }} value={cad.parcela} onChange={(e) => cad.atualizarParcela(e.target.value)} />} />
        <Row label="Pagas" value={`${cad.pagas} / ${boletos.length || 0}`} />
        {boletos.length === 0 && <Field label="1º vencimento"><input type="date" style={fieldInput} value={cad.vencimento} onChange={(e) => cad.setVencimento(e.target.value)} /></Field>}
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: "var(--soft)", lineHeight: 1.45 }}>A carta de crédito e o valor da parcela são independentes. Ao editar manualmente a parcela, o valor da carta não é alterado.</div>
      {cad.proximaLiberacao && <div style={{ marginTop: 11, paddingTop: 10, borderTop: "1px solid var(--line)", display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ color: "var(--gold)", fontSize: 12 }}>★</span>
        <div><div style={{ fontSize: 11.5, fontWeight: 600 }}>Próxima parcela em aberto: {cad.proximaLiberacao.numero_parcela}/{cad.proximaLiberacao.total_parcelas}</div><div style={{ fontSize: 11, color: "var(--soft)" }}>Vencimento {dataBrCurta(cad.proximaLiberacao.data_vencimento)}</div></div>
      </div>}
      <button type="button" disabled={cad.salvandoFin} onClick={cad.gerarOuAjustarParcelas} style={{ ...primaryBtn, marginTop: 11 }}>{boletos.length === 0 ? "Criar financeiro" : "Salvar ajuste de parcelas"}</button>
    </div>

    {boletos.length > 0 && <>
      <Section title="Situação financeira">
        <div style={{ ...rowLabel, alignItems: "center" }}>
          <span style={zipChip(cad.situacaoKind)}>● {cad.situacao}</span>
          <span style={{ fontSize: 11.5, color: "var(--soft)" }}>{cad.vencidas > 0 ? `${cad.vencidas} parcela(s) vencida(s)` : "Nenhuma parcela vencida"}</span>
        </div>
      </Section>
      <Section title="Previsão de liberação da agenda">
        <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
          <span style={{ fontSize: 17, fontFamily: "Fraunces,Georgia,serif" }}>{cad.elegivel ? "Disponível agora" : `${Math.max(cad.metaParcelas - cad.pagas, 0)} parcela(s) restantes`}</span>
          {cad.elegivel && <span style={zipChip("ok")}>Pode solicitar</span>}
        </div>
        <div style={{ fontSize: 11, color: "var(--soft)", lineHeight: 1.5 }}>Para {cad.totalParcelasReal}x, a cliente pode solicitar os próximos passos após a {cad.metaParcelas}ª parcela ({cad.percentualMeta}%).</div>
        <div style={{ height: 6, borderRadius: 999, background: "var(--line2)", overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(Math.round((cad.pagas / (cad.metaParcelas || 1)) * 100), 100)}%`, borderRadius: 999, background: cad.elegivel ? "var(--ok)" : "var(--bg)" }} /></div>
      </Section>
    </>}

    <ClienteInstallmentsSection cad={cad} />

    <Section title="Carnês">
      {cad.carnes.length === 0 ? <p style={{ fontSize: 11.5, color: "var(--soft)" }}>Nenhum carnê registrado ainda.</p> : cad.carnes.map((c) => <Row key={c.id} label={`${c.instituicao_financeira} · ${c.identificador_externo}`} value={`${c.quantidade_parcelas}x · R$ ${moedaNumero(c.valor_total)}`} />)}
      <form onSubmit={cad.criarCarne} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
        <input placeholder="Instituição (ex.: BRB)" style={fieldInput} value={cad.novoCarneBanco} onChange={(e) => cad.setNovoCarneBanco(e.target.value)} />
        <input placeholder="Identificador" style={fieldInput} value={cad.novoCarneIdentificador} onChange={(e) => cad.setNovoCarneIdentificador(e.target.value)} />
        <input type="date" style={fieldInput} value={cad.novoCarneData} onChange={(e) => cad.setNovoCarneData(e.target.value)} />
        <button type="submit" disabled={cad.criandoCarne} style={secondaryBtn}>Registrar carnê</button>
      </form>
      <label style={{ marginTop: 8, display: "flex", cursor: "pointer", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 10, border: "1px dashed var(--rose)", background: "var(--robg)", padding: "10px 12px", fontSize: 11.5, fontWeight: 600, color: "var(--bg)" }}>
        {cad.importando ? "Importando…" : "↥ Importar carnê em PDF"}
        <input type="file" accept="application/pdf" className="hidden" style={{ display: "none" }} disabled={cad.importando || !cad.novoCarneBanco} onChange={(e) => { const arquivo = e.target.files?.[0]; if (arquivo) void cad.importarCarne(arquivo, cad.novoCarneBanco || cad.carnes[0]?.instituicao_financeira || "Não informado"); e.target.value = ""; }} />
      </label>
      {cad.pendentesRevisao.length > 0 && <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        <p style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--gold)" }}>Páginas para confirmar/revisar</p>
        {cad.pendentesRevisao.map((i) => <div key={i.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderRadius: 9, border: "1px solid var(--gobg)", background: "var(--gobg)", padding: "8px 10px", fontSize: 11 }}>
          <span>{i.numero_parcela ? `Parcela ${i.numero_parcela}` : "Não identificada"} · {i.status_vinculacao === "revisar" ? "revisar manualmente" : `confiança ${i.nivel_confianca ?? "—"}`}</span>
          <span style={{ display: "flex", gap: 5 }}>
            {i.boleto_sugerido_id && <button type="button" onClick={() => cad.vincularImportacao(i)} style={{ ...secondaryBtn, height: 24, padding: "0 8px", color: "var(--ok)", borderColor: "var(--okbg)" }}>Vincular</button>}
            <button type="button" onClick={() => cad.ignorarImportacao(i.id)} style={{ ...secondaryBtn, height: 24, padding: "0 8px" }}>Ignorar</button>
          </span>
        </div>)}
      </div>}
    </Section>
  </div>;
}
