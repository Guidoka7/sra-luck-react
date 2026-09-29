// J17 — importação do RD no QA isolado com respostas SIMULADAS do RD (dados fictícios).
// Roda o código real de importação (worker/crm-importacao.ts) contra o banco do QA.
// Nenhuma credencial ou dado real: o RD é substituído pelas "fontes" injetáveis do próprio código.
import { descartarRevisao, importarCrm, importarDoWebhook, itensDaImportacao, reprocessarNegociacao } from "../../../worker/crm-importacao";
import { descartarPendencia, reprocessarPendencia, vincularResponsavel } from "../../../worker/integracao-pendencias";
import { createServiceSupabaseClient } from "../../../worker/supabase";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const PG = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [PG, "-Atc", q], { encoding: "utf8" }).trim();
if (!/127\.0\.0\.1|localhost/.test(process.env.SUPABASE_URL ?? "")) throw new Error("RECUSADO: SUPABASE_URL não é local");
const env = { SUPABASE_URL: process.env.SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!, CLIENTE_SESSION_SECRET: "qa" } as never;
const db = createServiceSupabaseClient(env);

// ---- fixture fictícia (IDs de 24 hex como os do RD) ----
const h = (n: number) => n.toString(16).padStart(24, "0");
const PIPE_A = h(0xa1), PIPE_B = h(0xb1), PIPE_C = h(0xc1), ETAPA = h(0xe1);
const U_V = h(0x11), U_X = h(0x12);
function cpf(b: string) { const d = b.split("").map(Number); for (const n of [10, 11]) { const s = d.reduce((a, v, i) => a + v * (n - i), 0); const r = (s * 10) % 11; d.push(r === 10 ? 0 : r); } return d.join(""); }
const CPF1 = cpf("900000201"), CPF5 = cpf("900000205");
const contato = (id: number, c: string | null, fone: string) => ({ id: h(id), name: `Contato QA ${id}`, phones: [{ phone: fone }], custom_fields: c ? { cpf: c } : {} });
const CONTATOS = [contato(0xc01, CPF1, "5561910000001"), contato(0xc02, null, "5561910000002"), contato(0xc03, cpf("900000203"), "5561910000003"),
  contato(0xc04, cpf("900000204"), "5561910000004"), contato(0xc05, CPF5, "5561910000005"), contato(0xc07, CPF1, "5561910000007"), contato(0xc09, cpf("900000209"), "5561910000009"),
  contato(0xc0a, cpf("900000203"), "5561910000010")];
const deal = (id: number, o: { status: string; pipe: string; owner: string; contato: number; total: number }) => ({
  id: h(id), name: `Negociação QA ${id}`, status: o.status, pipeline_id: o.pipe, stage_id: ETAPA, owner_id: o.owner, contact_ids: [h(o.contato)],
  total_price: o.total, created_at: "2026-09-20T12:00:00Z", updated_at: "2026-09-27T12:00:00Z", custom_fields: { "quantidade-de-parcelas": "24", banco: "Banco QA" },
});
const D1 = deal(0xd1, { status: "won", pipe: PIPE_A, owner: U_V, contato: 0xc01, total: 12000 });   // completa
const D2 = deal(0xd2, { status: "won", pipe: PIPE_A, owner: U_V, contato: 0xc02, total: 0 });       // sem CPF, valor 0
const D3 = deal(0xd3, { status: "won", pipe: PIPE_A, owner: U_X, contato: 0xc03, total: 9000 });    // responsável sem vínculo
const D4 = deal(0xd4, { status: "ongoing", pipe: PIPE_B, owner: U_V, contato: 0xc04, total: 8000 }); // não ganha
const D5 = deal(0xd5, { status: "won", pipe: PIPE_C, owner: U_V, contato: 0xc05, total: 7000 });    // ganha fora do funil
const D6 = deal(0xd6, { status: "ongoing", pipe: PIPE_C, owner: U_V, contato: 0xc05, total: 1 });   // em andamento fora do funil
const D7 = deal(0xd7, { status: "won", pipe: PIPE_A, owner: U_V, contato: 0xc07, total: 5000 });    // mesmo CPF da D1
const D8 = { name: "Negociação sem id", status: "won", pipeline_id: PIPE_A };                       // sem identificador
const D9 = deal(0xd9, { status: "won", pipe: PIPE_A, owner: U_V, contato: 0xc09, total: -5 });     // valor negativo: gravação falha
const DA = deal(0xda, { status: "won", pipe: PIPE_A, owner: U_V, contato: 0xc0a, total: 4000 });    // mesmo CPF da D3 (decidida "mesma pessoa")
const TODOS = [D1, D2, D3, D4, D5, D6, D7, D8, D9, DA];
const fontesOk = { deals: async (f: string) => TODOS.filter((d) => f.includes(String(d.pipeline_id))), refs: async () => ({ contatos: CONTATOS, usuarios: [{ id: U_V, name: "Vendedora QA" }, { id: U_X, name: "Usuário RD sem vínculo" }], campanhas: [], fontes: [] }) };
const fontesSemToken = { deals: async () => { throw new Error("RD_ACCESS_TOKEN_MISSING"); }, refs: async () => ({ contatos: [], usuarios: [], campanhas: [], fontes: [] }) };
const mapa = Object.fromEntries(["cpf", "telefone", "email", "vendedora", "origem", "campanha", "valor_contrato", "quantidade_parcelas", "valor_parcela", "taxa_administrativa", "tipo_venda", "procedimento", "banco"].map((c) => [c, "auto"]));
const CONFIG = { ativo: true, frequenciaMinutos: 15, funis: [{ pipelineId: PIPE_A, etapas: [], mapeamento: mapa }, { pipelineId: PIPE_B, etapas: [], mapeamento: mapa }], pipelineId: null, etapas: [], status: "qualquer", mapeamento: mapa, deduplicarPor: { cpf: true, telefone: true, email: true } };

const pend = () => JSON.parse(sql(`select coalesce(json_agg(json_build_object('tipo',tipo,'id',right(external_id,4),'estado',estado,'oc',ocorrencias,'campos',campos_faltantes,'resolucao',resolucao) order by tipo, external_id),'[]') from integracao_pendencias`));
const contar = () => ({ vendas: Number(sql("select count(*) from novas_vendas where rd_station_id is not null")), pendencias: Number(sql("select count(*) from integracao_pendencias")), abertas: Number(sql("select count(*) from integracao_pendencias where estado='aberta'")), validasBi: Number(sql("select count(*) from vw_vendas_validas_bi")) });
const r: Record<string, unknown> = {};
const provas: Record<string, boolean> = {};

// Estado limpo do cenário (só dados do RD simulado no QA)
sql("delete from integracao_pendencias; delete from colaborador_vinculos_externos; delete from integracao_importacao_itens; delete from novas_vendas where rd_station_id is not null; delete from integracao_importacoes; delete from crm_vendas_entrada; delete from integracao_travas;");
sql(`insert into integracoes_config (provedor, funcao, config, versao, atualizado_por) values ('rd_station','importacao','${JSON.stringify(CONFIG)}'::jsonb, 1, 'qa') on conflict (provedor, funcao) do update set config = excluded.config`);

// 1) Falha da EXECUÇÃO inteira, 3 vezes → UMA pendência com 3 ocorrências
for (let i = 0; i < 3; i++) await importarCrm(env, { origem: "agendada", ator: "qa:agendador" }, { db, fontes: fontesSemToken, config: CONFIG as never });
r.execucaoFalhou = pend();
provas.falhaDeExecucaoAgrupada = (r.execucaoFalhou as any[]).filter((p) => p.tipo === "execucao_falhou").length === 1 && (r.execucaoFalhou as any[])[0].oc === 3;

// 2) Execução que morreu no meio (em_andamento há 20 min, com 1 venda criada nela)
const zumbi = sql(`insert into integracao_importacoes (provedor, origem, status, iniciado_por, iniciado_em) values ('rd_station','manual','em_andamento','qa', now() - interval '20 minutes') returning id`).split("\n")[0];
sql(`insert into novas_vendas (rd_station_id, nome_completo, valor_contrato, status, rd_status, rd_owner_id, importacao_id) values ('${h(0xdead)}','Venda QA da execução interrompida',100,'aguardando_cadastro','won','${U_V}','${zumbi}')`);

// 3) Execução completa
r.execucao1 = await importarCrm(env, { origem: "agendada", ator: "qa:agendador" }, { db, fontes: fontesOk, config: CONFIG as never });
r.depoisExecucao1 = { ...contar(), pendencias: pend() };
r.zumbi = sql(`select status||' / '||coalesce(erro,'') from integracao_importacoes where id='${zumbi}'`);
r.itensGravados = sql(`select json_agg(json_build_object('resultado',resultado,'n',n)) from (select resultado, count(*) n from integracao_importacao_itens group by 1) x`);
const P1 = pend() as any[];
const tem = (tipo: string, id: string, estado = "aberta") => P1.some((p) => p.tipo === tipo && p.id === id && p.estado === estado);
provas.execucaoInterrompidaMarcada = r.zumbi === "erro / EXECUCAO_INTERROMPIDA";
provas.falhasDeExecucaoResolvidasPelaOrigem = P1.filter((p) => p.tipo.startsWith("execucao_")).every((p) => p.estado === "resolvida");
provas.camposAusentesD2 = P1.some((p) => p.tipo === "campos_ausentes" && p.id === "00d2" && p.estado === "aberta" && p.campos.includes("cpf") && p.campos.includes("valor_contrato"));
// migration_116: vínculo com a equipe é opcional; responsável sem vínculo não abre pendência.
provas.semVinculoNaoAbrePendencia = !P1.some((p) => p.tipo === "vendedora_nao_vinculada" && p.estado === "aberta");
provas.statusNaoGanhaD4 = tem("status_nao_ganha", "00d4");
// A importação agendada só lê os funis configurados (filtro RDQL): D5 não pode aparecer aqui;
// negociação de funil não configurado só chega pelo webhook (passo 5).
provas.agendadaNaoLeFunilNaoConfigurado = !P1.some((p) => p.id === "00d5");
provas.emAndamentoForaDoFunilSemPendencia = !P1.some((p) => p.id === "00d6");
provas.duplicidadeD7 = tem("duplicidade_possivel", "00d7");
provas.semIdNaoSomeEmSilencio = P1.some((p) => p.tipo === "negociacao_com_erro" && p.estado === "aberta" && p.id.length === 4 && sql("select count(*) from integracao_pendencias where external_id like 'sem-id-%'") === "1");
provas.erroDeGravacaoD9 = tem("negociacao_com_erro", "00d9");
provas.parcelasLidasDoObjetoCustomFields = sql(`select quantidade_parcelas from novas_vendas where rd_station_id='${h(0xd1)}'`) === "24";
provas.cpfLidoDoContato = sql(`select cpf from novas_vendas where rd_station_id='${h(0xd1)}'`) === CPF1;
provas.d1ValidaSemVinculo = sql(`select count(*) from vw_vendas_validas_bi where rd_station_id='${h(0xd1)}'`) === "1";
provas.d2IncompletaForaDoBi = sql(`select count(*) from vw_vendas_validas_bi where rd_station_id='${h(0xd2)}'`) === "0";

// 4) Repetição da mesma execução: nada duplica
r.pendenciasAposExecucao1 = pend();
const antes = contar();
r.execucao2 = await importarCrm(env, { origem: "agendada", ator: "qa:agendador" }, { db, fontes: fontesOk, config: CONFIG as never });
const depois = contar();
r.repeticao = { antes, depois };
provas.repeticaoNaoDuplicaVendasNemPendencias = antes.vendas === depois.vendas && antes.pendencias === depois.pendencias;

// 5) Webhook repetido 5x da mesma negociação ganha fora do funil: 1 linha, ocorrências somam
for (let i = 0; i < 5; i++) await importarDoWebhook(env, db, D5, `qa-tx-${i}`);
r.webhookD5 = (pend() as any[]).filter((p) => p.id === "00d5");
provas.webhookGanhaForaDoFunilUmaLinha = (r.webhookD5 as any[]).length === 1 && (r.webhookD5 as any[])[0].tipo === "ganha_fora_do_funil" && (r.webhookD5 as any[])[0].oc === 5;

// 6) Vincular o responsável do RD à vendedora da equipe (identificador estável, nunca por nome)
const vendedora = sql("select id from colaboradores where cargo='vendedora' limit 1");
r.vinculo = await vincularResponsavel(db, U_V, vendedora, "staff:qa");
const P2 = pend() as any[];
provas.vinculoPreencheVendedora = sql(`select vendedora_id from novas_vendas where rd_station_id='${h(0xd1)}'`) === vendedora
  && sql(`select coalesce(vendedora_id::text,'') from novas_vendas where rd_station_id='${h(0xd3)}'`) === ""
  && !P2.some((p) => p.tipo === "vendedora_nao_vinculada" && p.estado === "aberta");
provas.d1ValidaNoBi = sql(`select count(*) from vw_vendas_validas_bi where rd_station_id='${h(0xd1)}'`) === "1";

// 7) Correção local da D2 (como o cadastro faria) + reprocessar a pendência → fecha
sql(`update novas_vendas set cpf='${cpf("900000202")}', valor_contrato=6000, quantidade_parcelas=12 where rd_station_id='${h(0xd2)}'`);
const idCampos = sql(`select id from integracao_pendencias where tipo='campos_ausentes' and external_id='${h(0xd2)}' and estado='aberta'`);
const naoUsado = { negociacao: async () => ({ ok: false, erro: "não usado" }), execucao: async () => ({ ok: false, erro: "não usado" }) };
r.reprocessarD2 = await reprocessarPendencia(env, db, idCampos, "staff:qa", naoUsado);
provas.reprocessarAposCorrecaoFecha = sql(`select estado from integracao_pendencias where id='${idCampos}'`) === "resolvida";

// 8) Reprocessar negociação: D5 passou para um funil configurado no RD → venda criada UMA vez
const d5Movida = { ...D5, pipeline_id: PIPE_A };
const fonteD5 = async () => ({ deal: d5Movida, contato: CONTATOS[4] });
const vendasAntes = contar().vendas;
r.reprocessarD5 = await reprocessarNegociacao(env, db, h(0xd5), "staff:qa", fonteD5);
r.reprocessarD5DeNovo = await reprocessarNegociacao(env, db, h(0xd5), "staff:qa", fonteD5);
provas.reprocessarNegociacaoCriaUmaVez = contar().vendas === vendasAntes + 1 && sql(`select count(*) from novas_vendas where rd_station_id='${h(0xd5)}'`) === "1";
provas.foraDoFunilFechadaAoReprocessar = sql(`select estado||'/'||resolucao from integracao_pendencias where tipo='ganha_fora_do_funil' and external_id='${h(0xd5)}'`) === "resolvida/reprocessada";

// 9) Falha da API ao reprocessar: pendência continua aberta
const idD9 = sql(`select id from integracao_pendencias where tipo='negociacao_com_erro' and external_id='${h(0xd9)}' and estado='aberta'`);
r.reprocessarComApiFora = await reprocessarPendencia(env, db, idD9, "staff:qa", { negociacao: async () => ({ ok: false, erro: "RD_HTTP_503" }), execucao: naoUsado.execucao });
provas.falhaDaApiNaoFechaPendencia = (r.reprocessarComApiFora as any).status === 502 && sql(`select estado from integracao_pendencias where id='${idD9}'`) === "aberta";

// 10) Descartar exige motivo; descartada não reabre na próxima execução; não vira venda válida
const idD4 = sql(`select id from integracao_pendencias where tipo='status_nao_ganha' and external_id='${h(0xd4)}' and estado='aberta'`);
r.descartarSemMotivo = await descartarPendencia(db, idD4, "staff:qa", "");
r.descartarComMotivo = await descartarPendencia(db, idD4, "staff:qa", "Negociação em andamento: não é venda ainda.");
await importarCrm(env, { origem: "agendada", ator: "qa:agendador" }, { db, fontes: fontesOk, config: CONFIG as never });
provas.descarteExigeMotivo = (r.descartarSemMotivo as any).status === 400 && (r.descartarComMotivo as any).status === 200;
provas.descartadaNaoReabre = sql(`select count(*) from integracao_pendencias where tipo='status_nao_ganha' and external_id='${h(0xd4)}' and estado='aberta'`) === "0";
provas.d4ContinuaForaDoBi = sql(`select count(*) from vw_vendas_validas_bi where rd_station_id='${h(0xd4)}'`) === "0";

// 11) Exclusão no RD via webhook → pendência excluida_no_rd e sai do BI
await importarDoWebhook(env, db, D1, "qa-tx-antes-exclusao");
sql(`update novas_vendas set rd_status='deleted', rd_excluido_em=now() where rd_station_id='${h(0xd1)}'`);
await db.rpc("rd_recalcular_pendencias_venda", { p_venda_id: sql(`select id from novas_vendas where rd_station_id='${h(0xd1)}'`), p_origem: "webhook", p_importacao_id: null, p_ator: "qa" });
provas.exclusaoNoRdSaiDoBi = sql(`select count(*) from vw_vendas_validas_bi where rd_station_id='${h(0xd1)}'`) === "0" && sql(`select count(*) from integracao_pendencias where tipo='excluida_no_rd' and external_id='${h(0xd1)}' and estado='aberta'`) === "1";

// 12) BI: contagem independente (gabarito) × view
const gabarito = [D2, D5].map((d) => d.id); // D2 corrigida e D5 reprocessada (ambas ganhas, com vendedora vinculada, CPF e valor); D1 excluída no RD
r.bi = { view: sql("select coalesce(json_agg(right(rd_station_id,4) order by rd_station_id),'[]') from vw_vendas_validas_bi"), gabarito: gabarito.map((x) => x.slice(-4)) };
provas.biIgualAoGabarito = JSON.stringify(JSON.parse((r.bi as any).view)) === JSON.stringify((r.bi as any).gabarito);

// 12b) Revisão de duplicidade: UMA linha por negociação; "mesma pessoa" não volta na próxima execução
const revisao = await itensDaImportacao(db, null, true) as any[];
r.revisaoAgrupada = revisao.map((it) => ({ id: String(it.externalId).slice(-4), repeticoes: it.repeticoes }));
provas.revisaoUmaLinhaPorNegociacao = revisao.length === new Set(revisao.map((it) => it.externalId)).size
  && revisao.some((it) => it.externalId === DA.id && it.repeticoes >= 2) && revisao.some((it) => it.externalId === D7.id);
const itemDA = revisao.find((it) => it.externalId === DA.id);
r.decisaoMesmaPessoa = await descartarRevisao(db, itemDA.id, "qa:admin");
await importarCrm(env, { origem: "agendada", ator: "qa:agendador" }, { db, fontes: fontesOk, config: CONFIG as never });
const revisaoDepois = await itensDaImportacao(db, null, true) as any[];
r.daAposDecisao = { naRevisao: revisaoDepois.some((it) => it.externalId === DA.id), pendencia: sql(`select estado||'/'||resolucao from integracao_pendencias where tipo='duplicidade_possivel' and external_id='${DA.id}'`), ultimoItem: sql(`select resultado from integracao_importacao_itens where external_id='${DA.id}' order by created_at desc limit 1`), vendas: sql(`select count(*) from novas_vendas where rd_station_id='${DA.id}'`) };
provas.mesmaPessoaNaoVoltaParaRevisao = !(r.daAposDecisao as any).naRevisao && (r.daAposDecisao as any).pendencia === "descartada/decidida_na_revisao" && (r.daAposDecisao as any).ultimoItem === "ignorada" && (r.daAposDecisao as any).vendas === "0";
provas.d7ContinuaNaRevisao = revisaoDepois.some((it) => it.externalId === D7.id);

// 13) Histórico: execuções de webhook fora da lista padrão
r.historicoPadrao = sql("select count(*) from integracao_importacoes where origem<>'webhook'") + " execuções (sem webhook); webhook: " + sql("select count(*) from integracao_importacoes where origem='webhook'");
r.crmEntradaStatus = sql("select json_agg(json_build_object('status',status,'n',n)) from (select status, count(*) n from crm_vendas_entrada group by 1) x");
r.pendenciasFinais = pend();
r.provas = provas;
const falhas = Object.entries(provas).filter(([, v]) => !v).map(([k]) => k);
mkdirSync(`${process.env.EVDIR}/J17-rd-pendencias`, { recursive: true });
writeFileSync(`${process.env.EVDIR}/J17-rd-pendencias/result.json`, JSON.stringify(r, null, 1));
console.log(JSON.stringify(provas, null, 1));
console.log(falhas.length ? `FALHAS: ${falhas.join(", ")}` : `TODAS AS ${Object.keys(provas).length} PROVAS OK`);
process.exit(falhas.length ? 1 : 0);
