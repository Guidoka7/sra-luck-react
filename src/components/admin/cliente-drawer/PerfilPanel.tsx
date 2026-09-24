import { useEffect, useState, type ReactNode } from "react";
import { useRegrasApp } from "@/lib/regrasOperacionais";
import { formatarCpf } from "@/lib/cpf";
import { dataNascimentoValida, getAppAccessRequirements } from "../../../../worker/app-access";
import { calcularPrevisaoElegibilidade } from "../../../../worker/eligibility-forecast";
import type { ClienteCadastro } from "../useClienteCadastro";
import { DrawerIcon } from "./DrawerIcons";
import { formatCurrency, formatDate, formatDateTime, descreverHistorico } from "./drawerFormat";
import styles from "./ClienteDrawer.module.css";

type Secao = "personal" | "procedure" | "sale" | "notes";

/**
 * Aba Perfil (padrão visual da referência k338). Estado e persistência vêm
 * do hook compartilhado `useClienteCadastro`; "Concluir" fecha a edição da
 * seção e "Salvar alterações" (rodapé) grava tudo em `PATCH /clientes/:id`.
 */
export function PerfilPanel({ cad, formId, onPedirExclusao }: {
  cad: ClienteCadastro;
  formId: string;
  onPedirExclusao: () => void;
}) {
  const criando = !cad.editando;
  const [editando, setEditando] = useState<Record<Secao, boolean>>({ personal: criando, procedure: criando, sale: criando, notes: criando });
  const [snapshot, setSnapshot] = useState<Record<string, string>>({});
  const [historicoAberto, setHistoricoAberto] = useState(false);
  useEffect(() => { setHistoricoAberto(false); }, [cad.cliente?.id]);

  const hojeIso = new Date().toISOString().slice(0, 10);
  const regrasApp = useRegrasApp(true);
  const requisitos = getAppAccessRequirements({ name: cad.nome, cpf: cad.cpf, birthDate: cad.nascimento, installmentCount: cad.boletos.length, procedure: cad.procedimento }, hojeIso, { requireFinancial: regrasApp.appExigeParcela, requireProcedure: regrasApp.appExigeProcedimento });
  const acessoComDadosInvalidos = cad.acessoLiberado && !requisitos.canRelease;

  function editar(s: Secao) {
    setSnapshot((a) => ({ ...a, nome: cad.nome, cpf: cad.cpf, nascimento: cad.nascimento, telefone: cad.telefone ?? "", email: cad.email ?? "", procedimento: cad.procedimento ?? "", carta: cad.carta, consultora: cad.consultora, observacoes: cad.observacoes ?? "" }));
    setEditando((e) => ({ ...e, [s]: true }));
  }
  function cancelar(s: Secao) {
    if (s === "personal") { cad.setNome(snapshot.nome ?? cad.nome); cad.setCpf(snapshot.cpf ?? cad.cpf); cad.setNascimento(snapshot.nascimento ?? cad.nascimento); cad.setTelefone(snapshot.telefone ?? ""); cad.setEmail(snapshot.email ?? ""); }
    if (s === "procedure") { cad.setProcedimento(snapshot.procedimento ?? ""); if (snapshot.carta != null) cad.atualizarCarta(snapshot.carta); }
    if (s === "sale") cad.setConsultora(snapshot.consultora ?? "");
    if (s === "notes") cad.setObservacoes(snapshot.observacoes ?? "");
    setEditando((e) => ({ ...e, [s]: false }));
  }
  const concluir = (s: Secao) => setEditando((e) => ({ ...e, [s]: false }));
  const head = (s: Secao, titulo: string, icone: "usercard" | "procedure" | "tag" | "document") => <SectionHead titulo={titulo} icone={icone} editavel={!criando} editando={editando[s]} onEditar={() => editar(s)} onCancelar={() => cancelar(s)} onConcluir={() => concluir(s)} />;

  const parcelas = cad.boletos.length || cad.quantidade || 0;
  const valorParcela = cad.boletos[0]?.valor ?? null;
  const previsaoElegibilidade = calcularPrevisaoElegibilidade(
    cad.boletos,
    cad.cliente?.data_atingiu_percentual ?? null,
  );
  const previsaoLiberacao = previsaoElegibilidade.data;

  return <form id={formId} className={styles.stack} onSubmit={cad.salvarPerfil} noValidate>
    <article className={styles.card}>
      {head("personal", "Dados principais", "usercard")}
      <div className={styles.cardBody}>
        {editando.personal ? <div className={styles.formGrid}>
          <Field label="Nome completo" id="perfil-nome"><input id="perfil-nome" className={styles.input} value={cad.nome} onChange={(e) => cad.setNome(e.target.value)} required autoComplete="off" /></Field>
          <Field label="CPF" id="perfil-cpf"><input id="perfil-cpf" className={styles.input} value={cad.cpf} maxLength={14} disabled={cad.editando} title={cad.editando ? "O CPF não pode ser alterado depois do cadastro." : undefined} onChange={(e) => cad.setCpf(formatarCpf(e.target.value))} /></Field>
          <Field label="Data de nascimento" id="perfil-nasc"><input id="perfil-nasc" className={styles.input} type="date" value={cad.nascimento} max={hojeIso} aria-invalid={Boolean(cad.nascimento) && !dataNascimentoValida(cad.nascimento, hojeIso)} onChange={(e) => cad.setNascimento(e.target.value)} required /></Field>
          <Field label="Telefone" id="perfil-tel"><input id="perfil-tel" className={styles.input} value={cad.telefone ?? ""} onChange={(e) => cad.setTelefone(e.target.value)} /></Field>
          <Field label="E-mail" id="perfil-email" wide><input id="perfil-email" className={styles.input} type="email" value={cad.email ?? ""} onChange={(e) => cad.setEmail(e.target.value)} /></Field>
        </div> : <div className={styles.infoGrid}>
          <Info label="Nome completo" value={cad.nome} />
          <Info label="CPF" value={cad.cpf} />
          <Info label="Data de nascimento" value={formatDate(cad.nascimento)} />
          <div><span className={styles.label}>Telefone</span><div className={`${styles.value} ${styles.inline}`}>{cad.telefone || "—"}{cad.telefone ? <DrawerIcon name="whatsapp" className={styles.wa} aria-hidden="true" /> : null}</div></div>
          <Info label="E-mail" value={cad.email ?? ""} />
        </div>}
      </div>
    </article>

    {!criando && <article className={styles.card}>
      <SectionHead titulo="Acesso ao aplicativo" icone="usercard" />
      <div className={styles.cardBody}>
        <div className={styles.appAccessHeader}>
          <div>
            <span className={styles.appAccessKicker}>Status</span>
            <strong className={acessoComDadosInvalidos ? styles.appAccessWaiting : cad.acessoLiberado ? styles.appAccessReleased : requisitos.canRelease ? styles.appAccessReady : styles.appAccessWaiting}>
              {acessoComDadosInvalidos ? "● Acesso liberado · revisar dados" : cad.acessoLiberado ? "● Acesso liberado" : requisitos.canRelease ? "Pronta para acesso" : "Aguardando requisitos"}
            </strong>
          </div>
          {cad.acessoLiberado ? <span className={styles.appAccessBadge}>{acessoComDadosInvalidos ? "Revisar dados" : "Liberado"}</span> : null}
        </div>
        <div className={styles.appAccessChecklist} aria-label="Requisitos para liberação do aplicativo">
          <Requisito ok={requisitos.hasName} feito="Nome cadastrado" falta="Nome ainda não cadastrado" />
          <Requisito ok={requisitos.hasCpf} feito="CPF válido" falta="CPF inválido ou não cadastrado" />
          <Requisito ok={requisitos.hasBirthDate} feito="Data de nascimento válida" falta="Informe uma data de nascimento válida" />
          <Requisito ok={requisitos.hasFinancial} feito="Financeiro criado" falta="Financeiro ainda não criado" />
        </div>
        {cad.acessoLiberado
          ? <>
              <div className={styles.appAccessReleasedInfo}><span>Data da liberação</span><strong>{cad.acessoLiberadoEm ? formatDateTime(cad.acessoLiberadoEm) : "Acesso legado — data não registrada"}</strong></div>
              {acessoComDadosInvalidos ? <p className={styles.appAccessHint}>O acesso já estava liberado, mas o cadastro atual possui requisito inválido. Corrija e salve os dados do perfil; o acesso não será revogado automaticamente.</p> : null}
            </>
          : <>
              <button className={styles.appAccessButton} type="button" disabled={!requisitos.canRelease || cad.liberandoAcesso} onClick={() => void cad.liberarAcessoApp()} aria-busy={cad.liberandoAcesso}>{cad.liberandoAcesso ? "Liberando..." : "Liberar acesso ao app"}</button>
              {!requisitos.canRelease ? <p className={styles.appAccessHint}>Conclua os requisitos acima para liberar o acesso. Procedimento não é requisito.</p> : null}
            </>}
      </div>
    </article>}

    <article className={styles.card}>
      {head("procedure", "Procedimento", "procedure")}
      <div className={styles.cardBody}>
        {editando.procedure ? <div className={styles.formGrid}>
          <Field label="Procedimento" id="perfil-proc"><input id="perfil-proc" className={styles.input} value={cad.procedimento ?? ""} onChange={(e) => cad.setProcedimento(e.target.value)} /></Field>
          <Field label="Valor da carta de crédito" id="perfil-carta"><input id="perfil-carta" className={styles.input} inputMode="decimal" value={cad.carta} onChange={(e) => cad.atualizarCarta(e.target.value)} /></Field>
          <Field label="Parcelamento"><div className={styles.modalValue}>{parcelas}x {valorParcela != null ? formatCurrency(valorParcela) : ""}</div></Field>
          <Field label="Previsão de liberação"><div className={styles.modalValue}>{formatDate(previsaoLiberacao)}</div></Field>
        </div> : <div className={styles.infoGrid}>
          <Info label="Procedimento" value={cad.procedimento ?? ""} />
          <Info label="Valor da carta de crédito" value={cad.carta ? `R$ ${cad.carta}` : ""} />
          <Info label="Parcelamento" value={parcelas ? `${parcelas}x ${valorParcela != null ? formatCurrency(valorParcela) : ""}` : ""} />
          <Info label="Previsão de liberação" value={formatDate(previsaoLiberacao)} />
        </div>}
      </div>
    </article>

    {!criando && <article className={styles.card}>
      {head("sale", "Informações da venda", "tag")}
      <div className={styles.cardBody}>
        {editando.sale ? <div className={styles.formGrid}>
          <Field label="Vendedora" id="perfil-vend"><input id="perfil-vend" className={styles.input} value={cad.consultora} onChange={(e) => cad.setConsultora(e.target.value)} /></Field>
          <Field label="Campanha / Origem"><div className={styles.modalValue}>{cad.cliente?.origem_venda || "—"}</div></Field>
          <Field label="Banco"><div className={styles.modalValue}>{cad.cliente?.banco || "—"}</div></Field>
        </div> : <div className={styles.saleGrid}>
          <Info label="Vendedora" value={cad.consultora} />
          <Info label="Campanha / Origem" value={cad.cliente?.origem_venda ?? ""} />
          <div><span className={styles.label}>Banco</span><div className={`${styles.value} ${styles.inline}`}><DrawerIcon name="bank" className={styles.bank} aria-hidden="true" />{cad.cliente?.banco || "—"}</div></div>
        </div>}
        <p className={styles.readOnlyNote}>Campanha vem da venda recebida do CRM e o banco vem do carnê registrado no Financeiro.</p>
      </div>
    </article>}

    <article className={styles.card}>
      {head("notes", "Observações internas", "document")}
      <div className={styles.cardBody}>
        {editando.notes
          ? <textarea className={styles.input} aria-label="Observações internas" value={cad.observacoes ?? ""} onChange={(e) => cad.setObservacoes(e.target.value)} />
          : <div className={styles.notes}>{cad.observacoes || "Nenhuma observação interna cadastrada."}</div>}
      </div>
    </article>

    {!criando && <article className={styles.card}>
      <div className={styles.cardHead}>
        <button type="button" className={styles.historyToggle} aria-expanded={historicoAberto} onClick={() => setHistoricoAberto((v) => !v)}>
          <h3 className={styles.cardTitle}><DrawerIcon name="history" aria-hidden="true" />Histórico operacional</h3>
          <span className={styles.linkBtn}>{historicoAberto ? "Recolher" : `Ver (${cad.historico.length})`}</span>
        </button>
      </div>
      {historicoAberto && <div className={styles.cardBody}>
        {cad.historico.length === 0 ? <div className={styles.empty}>Nenhum evento registrado ainda.</div> : <div className={styles.history}>
          {cad.historico.slice(0, 40).map((h) => { const d = descreverHistorico(h); return <div key={h.id} className={`${styles.historyRow} ${d.tipo === "payment" ? styles.payment : ""}`}><div className={styles.historyDate}>{formatDate(h.created_at)}</div><div className={styles.historyEvent}>{d.texto}</div><div className={styles.historyAuthor}>Por {d.autor}</div></div>; })}
        </div>}
      </div>}
    </article>}

    {!criando && <div className={styles.dangerZone}>
      <div><strong>Excluir perfil</strong><p>Remove a cliente das áreas operacionais e o acesso ao app. Não remove o cadastro no RD Station.</p></div>
      <button type="button" className={styles.dangerBtn} onClick={onPedirExclusao}>Excluir perfil</button>
    </div>}
  </form>;
}

function SectionHead({ titulo, icone, editavel = false, editando = false, onEditar, onCancelar, onConcluir }: {
  titulo: string; icone: "usercard" | "procedure" | "tag" | "document"; editavel?: boolean; editando?: boolean;
  onEditar?: () => void; onCancelar?: () => void; onConcluir?: () => void;
}) {
  return <div className={styles.cardHead}>
    <h3 className={styles.cardTitle}><DrawerIcon name={icone} aria-hidden="true" />{titulo}</h3>
    {editavel ? editando
      ? <span><button className={styles.cancel} type="button" onClick={onCancelar}>Cancelar</button><button className={styles.done} type="button" onClick={onConcluir}>Concluir</button></span>
      : <button className={styles.edit} type="button" onClick={onEditar} aria-label={`Editar ${titulo}`}><DrawerIcon name="edit" aria-hidden="true" /> Editar</button>
      : null}
  </div>;
}

function Requisito({ ok, feito, falta }: { ok: boolean; feito: string; falta: string }) {
  return <div className={`${styles.appAccessRequirement} ${ok ? styles.appAccessRequirementDone : ""}`}>
    <span className={styles.appAccessRequirementIcon} aria-hidden="true">{ok ? <DrawerIcon name="check" /> : "○"}</span>
    <span>{ok ? feito : falta}</span>
  </div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><span className={styles.label}>{label}</span><div className={styles.value}>{value || "—"}</div></div>;
}

function Field({ label, id, wide, children }: { label: string; id?: string; wide?: boolean; children: ReactNode }) {
  return <div className={`${styles.field} ${wide ? styles.span2 : ""}`}><label htmlFor={id}>{label}</label>{children}</div>;
}
