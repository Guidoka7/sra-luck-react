import { Field, fieldInput, moedaNumero, primaryBtn, secondaryBtn } from "./clienteUi";
import type { ClienteCadastro } from "./useClienteCadastro";

/** Modais do cadastro (baixa manual de parcela e exclusão de perfil). */
export function ClienteCadastroModals({ cad }: { cad: ClienteCadastro }) {
  const b = cad.baixaAlvo;
  return <>
    {cad.confirmarExclusao && <div className="zip-animate-fade-in" style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(30,12,16,.5)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }}>
      <div className="zip-animate-pop-in" style={{ width: 420, maxWidth: "100%", background: "var(--s0)", border: "1px solid var(--line)", borderRadius: 14, boxShadow: "var(--sh)", padding: 20 }}>
        <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
          <div style={{ width: 34, height: 34, flex: "none", borderRadius: 10, background: "var(--badbg)", color: "var(--bad)", display: "grid", placeItems: "center", fontSize: 15 }}>!</div>
          <div><h2 style={{ fontSize: 16 }}>Excluir perfil da Sra. Luck?</h2><p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--soft)", lineHeight: 1.55 }}>O perfil de <strong style={{ color: "var(--ink)" }}>{cad.nome}</strong> deixará de aparecer nas áreas operacionais e o acesso ao aplicativo será removido.</p></div>
        </div>
        <div style={{ marginTop: 13, border: "1px solid var(--line)", background: "var(--s1)", borderRadius: 11, padding: "11px 12px", fontSize: 11.5, color: "var(--ink)", lineHeight: 1.55 }}>Isso não remove o cadastro no RD Station. Excluir perfil é diferente de cancelar contrato.</div>
        <div style={{ marginTop: 16, display: "flex", gap: 9, justifyContent: "flex-end" }}>
          <button onClick={() => cad.setConfirmarExclusao(false)} style={secondaryBtn}>Cancelar</button>
          <button onClick={cad.excluirCliente} disabled={cad.excluindo} style={{ ...primaryBtn, width: "auto", border: "1px solid var(--bad)", background: "var(--bad)" }}>Excluir perfil</button>
        </div>
      </div>
    </div>}

    {b && <div className="zip-animate-fade-in" style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(30,12,16,.5)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }}>
      <div className="zip-animate-pop-in" style={{ width: 440, maxWidth: "100%", background: "var(--s0)", border: "1px solid var(--line)", borderRadius: 14, boxShadow: "var(--sh)", padding: 20, maxHeight: "90vh", overflowY: "auto" }}>
        <h2 style={{ fontSize: 16 }}>Baixa manual · parcela {b.numero_parcela}/{b.total_parcelas}</h2>
        <p style={{ margin: "6px 0 12px", fontSize: 11.5, color: "var(--soft)", lineHeight: 1.5 }}>Valor original R$ {moedaNumero(Number(b.valor || 0))}. O total é validado e recalculado no servidor.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Field label="Data do pagamento"><input type="date" style={fieldInput} value={cad.baixaData} onChange={(e) => cad.setBaixaData(e.target.value)} /></Field>
          <Field label="Forma de pagamento"><select style={fieldInput} value={cad.baixaForma} onChange={(e) => cad.setBaixaForma(e.target.value)}><option value="pix">PIX</option><option value="dinheiro">Dinheiro</option><option value="transferencia">Transferência</option><option value="boleto">Boleto</option><option value="cartao">Cartão</option><option value="cheque">Cheque</option><option value="outro">Outro</option></select></Field>
          <Field label="Juros"><input inputMode="decimal" style={fieldInput} value={cad.baixaJuros} onChange={(e) => cad.setBaixaJuros(e.target.value)} /></Field>
          <Field label="Multa"><input inputMode="decimal" style={fieldInput} value={cad.baixaMulta} onChange={(e) => cad.setBaixaMulta(e.target.value)} /></Field>
          <div style={{ gridColumn: "1 / -1" }}><Field label="Banco"><input style={fieldInput} value={cad.baixaBanco} onChange={(e) => cad.setBaixaBanco(e.target.value)} placeholder="Ex.: Itaú, Nubank, Caixa" /></Field></div>
          <div style={{ gridColumn: "1 / -1" }}><Field label="Observações"><textarea style={{ ...fieldInput, height: "auto", padding: 9 }} rows={2} value={cad.baixaObs} onChange={(e) => cad.setBaixaObs(e.target.value)} /></Field></div>
          <div style={{ gridColumn: "1 / -1" }}><label style={{ display: "flex", cursor: "pointer", alignItems: "center", gap: 8, borderRadius: 9, border: "1px dashed var(--rose)", background: "var(--robg)", padding: "9px 10px", fontSize: 11, fontWeight: 600, color: "var(--bg)" }}>{cad.baixaArquivo ? cad.baixaArquivo.name : "Comprovante opcional (PDF, JPG, PNG)"}<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={(e) => cad.setBaixaArquivo(e.target.files?.[0] ?? null)} /></label></div>
        </div>
        <div style={{ marginTop: 16, display: "flex", gap: 9, justifyContent: "flex-end" }}>
          <button onClick={() => cad.setBaixaAlvo(null)} style={secondaryBtn}>Cancelar</button>
          <button onClick={cad.confirmarBaixaManual} disabled={cad.salvandoBaixa} style={{ ...primaryBtn, width: "auto" }}>{cad.salvandoBaixa ? "Salvando…" : "Confirmar baixa"}</button>
        </div>
      </div>
    </div>}
  </>;
}
