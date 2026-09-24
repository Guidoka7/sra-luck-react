import { useCallback, useEffect, useMemo, useState } from "react";
import { MarcaSraLuck } from "@/components/cliente/MarcaSraLuck";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarCheck, Check, ChevronRight, Clock3, Gift, History, Info, Lock, Receipt, Ticket, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import {
  abrirArquivoVoucher, buscarClube, resgatarPremio, solicitarVoucher, usarBeneficio, VOUCHER_CONSULTA_KEY,
  type ClubeCampanha, type ClubeData, type ClubeRecompensa,
} from "@/lib/clube";
import { Folha, ImagemPremio, Moeda } from "./ClubeUi";
import { IndicarFolha } from "./IndicarFolha";
import { caminhoAteMeta, descreverEvento, estadoVoucher, etapaIndicacao, pontosACaminho, proximoPremio, rotuloResgate } from "./clubeRegras";
import "@/styles/clube-pontos.css";

interface ClubeScreenProps { onVoltar?: () => void; onIrParcelas: () => void; nomeCliente?: string }
type Aba = "premios" | "missoes" | "indicacoes";

const PADRAO = { pontosPrimeiraParcela: 50, pontosParcelaEmDia: 10, pontosIndicacao: 200 };
const CAMPANHAS_PADRAO: ClubeCampanha[] = [
  { id: "primeira-parcela", chave: "primeira_parcela", tipo: "primeira_parcela", titulo: "Pague a 1ª parcela", descricao: "Ao confirmar o seu primeiro pagamento, você ganha pontos e libera o voucher de consulta com o Doutor.", recompensa_texto: null, ativo: true, ordem: 10, created_at: "" },
  { id: "parcela-em-dia", chave: "parcela_em_dia", tipo: "parcela_em_dia", titulo: "Pague em dia", descricao: "Toda parcela paga até o vencimento vale pontos. Quanto mais em dia, mais perto do seu prêmio.", recompensa_texto: null, ativo: true, ordem: 20, created_at: "" },
  { id: "indicacao", chave: "indicacao", tipo: "indicacao", titulo: "Indique uma amiga", descricao: "Você ganha quando a amiga indicada fechar contrato e pagar a 1ª parcela.", recompensa_texto: null, ativo: true, ordem: 30, created_at: "" },
];

function dataCurta(iso?: string | null) {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}` : "";
}

function pts(n: number) { return `${n.toLocaleString("pt-BR")} pts`; }

export function ClubeScreen({ onVoltar, onIrParcelas, nomeCliente }: ClubeScreenProps) {
  const [dados, setDados] = useState<ClubeData | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [falhou, setFalhou] = useState(false);
  const [aba, setAba] = useState<Aba>("premios");
  const [folha, setFolha] = useState<"extrato" | "como" | null>(null);
  const [indicarAberta, setIndicarAberta] = useState(false);
  const [resgateAlvo, setResgateAlvo] = useState<ClubeRecompensa | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setDados(await buscarClube());
      setFalhou(false);
    } catch (e) {
      setFalhou(true);
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir o Clube de Vantagens.");
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const config = dados?.config ?? PADRAO;
  const saldo = dados?.saldo ?? 0;
  const recompensas = dados?.recompensas ?? [];
  const meta = useMemo(() => proximoPremio(recompensas, saldo), [recompensas, saldo]);
  const voucher = dados?.beneficios.find((b) => b.beneficio_key === VOUCHER_CONSULTA_KEY) ?? null;
  const indicacoes = dados?.indicacoes.itens ?? [];
  const campanhas = (dados?.campanhas?.length ? dados.campanhas : CAMPANHAS_PADRAO).filter((c) => c.ativo).sort((a,b) => a.ordem-b.ordem);
  const pontosIndicacoes = indicacoes.reduce((t, i) => t + (i.pontos_creditados || 0), 0);
  const aCaminho = pontosACaminho(indicacoes, config.pontosIndicacao);
  const caminho = meta.alvo ? caminhoAteMeta({
    faltam: meta.faltam, aCaminho, primeiraParcelaConcluida: dados?.missoes?.primeiraParcela.concluida ?? true,
    pontosPrimeiraParcela: config.pontosPrimeiraParcela, pontosParcelaEmDia: config.pontosParcelaEmDia, pontosIndicacao: config.pontosIndicacao,
  }) : null;
  const dica = aCaminho > 0 ? `+${pts(aCaminho)} a caminho de indicações que já fecharam.` : caminho;

  async function confirmarResgate() {
    if (!resgateAlvo) return;
    setOcupado(true);
    try {
      await resgatarPremio(resgateAlvo.id, crypto.randomUUID());
      toast.success("Resgate solicitado! A equipe vai confirmar com você.");
      setResgateAlvo(null);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir o resgate.");
    } finally {
      setOcupado(false);
    }
  }

  async function acaoVoucher(tipo: "solicitar" | "abrir" | "usar") {
    if (!voucher) return;
    setOcupado(true);
    try {
      if (tipo === "solicitar") { await solicitarVoucher(voucher.id); toast.success("Pedido enviado! A equipe vai preparar seu voucher."); }
      if (tipo === "usar") { await usarBeneficio(voucher.id); toast.success("Voucher marcado como utilizado."); }
      if (tipo === "abrir") { const { url } = await abrirArquivoVoucher(voucher.id); window.open(url, "_blank", "noopener"); }
      if (tipo !== "abrir") await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir agora.");
    } finally {
      setOcupado(false);
    }
  }

  const abas: { id: Aba; rotulo: string; aviso?: number }[] = [
    { id: "premios", rotulo: "Prêmios" },
    { id: "missoes", rotulo: "Missões" },
    { id: "indicacoes", rotulo: "Indicações", aviso: dados?.indicacoes.emAnalise || undefined },
  ];

  return (
    <div className="sl-tab pb-8">
      <div className="px-5 pt-[calc(max(env(safe-area-inset-top),0px)+18px)]">
        <div className="flex min-h-[34px] items-center pr-[86px]">
          {onVoltar
            ? <button type="button" onClick={onVoltar} className="flex items-center gap-[7px] text-[12px] text-[#6B1F2E]"><ChevronRight className="h-4 w-4 rotate-180" />Mais</button>
            : <MarcaSraLuck className="sl-marca--aba" />}
        </div>
        <h1 className="m-0 pt-[14px] font-heading text-[29px] font-semibold leading-[1.08] text-[#2E2422]">Clube de Vantagens</h1>
        <p className="m-0 pt-1 text-[13px] font-light text-[#8A7B77]">Pague em dia, indique amigas e troque seus pontos por prêmios.</p>
      </div>

      {/* Saldo + meta */}
      <section className="sl-pontos" aria-label="Seus pontos">
        <div className="sl-pontos-topo">
          <span className="sl-pontos-rotulo">Seus pontos</span>
          <button type="button" onClick={() => setFolha("extrato")} className="sl-pontos-extrato">
            <History className="h-[13px] w-[13px]" aria-hidden="true" /> Extrato
          </button>
        </div>
        <div className="sl-pontos-saldo">
          <span className="sl-pontos-numero">{carregando ? "—" : saldo.toLocaleString("pt-BR")}</span>
          <span className="sl-pontos-unidade">pontos</span>
        </div>

        {!carregando && meta.alvo && (
          <div className="sl-pontos-meta">
            <div className="sl-pontos-meta-linha">
              <span>Faltam <strong>{pts(meta.faltam)}</strong> para {meta.alvo.titulo}</span>
              <span>{meta.progresso}%</span>
            </div>
            <div className="sl-pontos-barra" role="progressbar" aria-valuenow={meta.progresso} aria-valuemin={0} aria-valuemax={100} aria-label={`Progresso até ${meta.alvo.titulo}`}>
              <motion.div className="sl-pontos-barra-cheia" initial={{ width: 0 }} animate={{ width: `${meta.progresso}%` }} transition={{ duration: 0.7, ease: "easeOut" }} />
            </div>
            {dica && <p className="sl-pontos-dica">{dica}</p>}
          </div>
        )}
        {!carregando && !meta.alvo && recompensas.length > 0 && (
          <p className="sl-pontos-dica">Seus pontos já alcançam todos os prêmios. Escolha o seu abaixo.</p>
        )}

        <button type="button" onClick={() => setIndicarAberta(true)} className="sl-pontos-cta">
          <UserPlus className="h-[17px] w-[17px]" aria-hidden="true" /> Indicar amiga e ganhar {config.pontosIndicacao} pts
        </button>
      </section>

      {/* Abas internas */}
      <div className="mx-5 mt-5 grid grid-cols-3 gap-1 rounded-[14px] bg-[#F3EBE8] p-1" role="tablist" aria-label="Seções do Clube">
        {abas.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)}
            className={`relative flex items-center justify-center gap-1 whitespace-nowrap rounded-[11px] px-1 py-[9px] text-[13px] font-semibold transition ${aba === a.id ? "bg-white text-[#6B1F2E] shadow-[0_2px_8px_rgba(46,36,34,.08)]" : "text-[#8A7B77]"}`}>
            {a.rotulo}
            {a.aviso ? <span className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#6B1F2E] px-1 text-[10px] font-bold text-white">{a.aviso}</span> : null}
          </button>
        ))}
      </div>

      {carregando ? (
        <div className="mx-5 mt-4 grid grid-cols-2 gap-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-[210px] animate-pulse rounded-[18px] bg-[#F1E8E5]" />)}
        </div>
      ) : falhou && !dados ? (
        <div className="mx-5 mt-4 rounded-[18px] border border-[#ECE2DF] bg-white p-6 text-center">
          <p className="m-0 text-[13px] text-[#7F6E6A]">Não foi possível carregar o Clube agora.</p>
          <button type="button" onClick={() => { setCarregando(true); void carregar(); }} className="mt-3 rounded-[12px] bg-[#6B1F2E] px-5 py-[10px] text-[13px] font-semibold text-white">Tentar novamente</button>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div key={aba} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }} className="px-5 pt-4">
            {aba === "premios" && (
              <>
                <CartaoVoucher estado={estadoVoucher(voucher)} solicitadoEm={voucher?.solicitado_em} ocupado={ocupado} pontosMissao={config.pontosPrimeiraParcela}
                  onIrParcelas={onIrParcelas} onSolicitar={() => void acaoVoucher("solicitar")} onAbrir={() => void acaoVoucher("abrir")} onUsar={() => void acaoVoucher("usar")} />

                <div className="flex items-end justify-between pb-3 pt-5">
                  <h2 className="m-0 font-heading text-[22px] font-semibold text-[#2E2422]">Prêmios</h2>
                  <span className="text-[12px] text-[#9A8C88]">{recompensas.length} disponíveis</span>
                </div>
                {recompensas.length === 0 ? (
                  <div className="rounded-[18px] border border-[#ECE2DF] bg-white p-6 text-center text-[13px] font-light text-[#9A8A86]">Nenhum prêmio disponível no momento.</div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {recompensas.map((r) => <CartaoPremio key={r.id} recompensa={r} saldo={saldo} onResgatar={() => setResgateAlvo(r)} />)}
                  </div>
                )}

                {(dados?.resgates?.length ?? 0) > 0 && (
                  <>
                    <h3 className="m-0 pb-2 pt-6 text-[12px] font-semibold uppercase tracking-[.12em] text-[#A9837C]">Meus resgates</h3>
                    <ul className="m-0 list-none overflow-hidden rounded-[18px] border border-[#ECE2DF] bg-white p-0">
                      {dados!.resgates!.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-3 border-b border-[#F4ECEA] px-4 py-3 last:border-b-0">
                          <span className="min-w-0"><span className="block truncate text-[13.5px] font-medium text-[#43322F]">{r.titulo}</span><span className="block pt-[2px] text-[11.5px] text-[#9A8C88]">{dataCurta(r.created_at)} · {pts(r.pontos)}</span></span>
                          <span className={`flex-none rounded-full px-[10px] py-1 text-[11px] font-semibold ${r.status === "entregue" ? "bg-[#EEF6F0] text-[#3F7D5B]" : r.status === "cancelado" ? "bg-[#F5F1EF] text-[#988985]" : "bg-[#FFF7E8] text-[#8A6720]"}`}>{rotuloResgate(r.status)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}

            {aba === "missoes" && (
              <div className="flex flex-col gap-3">
                {campanhas.map((campanha) => {
                  if (campanha.tipo === "primeira_parcela") return <Missao key={campanha.id} Icone={Gift} titulo={campanha.titulo} recompensa={`+${config.pontosPrimeiraParcela} pts + voucher`} descricao={campanha.descricao || "Pague a primeira parcela para concluir esta missão."} concluida={Boolean(dados?.missoes?.primeiraParcela.concluida)} status={dados?.missoes?.primeiraParcela.concluida ? "Missão concluída" : undefined} acao={dados?.missoes?.primeiraParcela.concluida ? undefined : { rotulo: "Ver minhas parcelas", onClick: onIrParcelas }} />;
                  if (campanha.tipo === "parcela_em_dia") return <Missao key={campanha.id} Icone={CalendarCheck} titulo={campanha.titulo} recompensa={`+${config.pontosParcelaEmDia} pts por parcela`} descricao={campanha.descricao || "Mantenha suas parcelas em dia para ganhar pontos."} status={dados?.missoes?.parcelaEmDia.vezes ? `Você já ganhou ${dados.missoes.parcelaEmDia.vezes}× · ${pts(dados.missoes.parcelaEmDia.pontosGanhos)}` : undefined} destaque={dados?.missoes?.parcelaEmDia.proxima?.vencimento ? `Próxima: parcela ${dados.missoes.parcelaEmDia.proxima.numero} vence em ${dataCurta(dados.missoes.parcelaEmDia.proxima.vencimento)}` : undefined} acao={{ rotulo: "Ver parcelas", onClick: onIrParcelas }} />;
                  if (campanha.tipo === "indicacao") return <Missao key={campanha.id} Icone={Users} titulo={campanha.titulo} recompensa={`+${config.pontosIndicacao} pts`} descricao={campanha.descricao || "Indique uma amiga e acompanhe o andamento pelo Clube."} status={dados?.missoes?.indicacao.creditadas ? `${dados.missoes.indicacao.creditadas} ${dados.missoes.indicacao.creditadas === 1 ? "indicação premiada" : "indicações premiadas"} · ${pts(dados.missoes.indicacao.pontosGanhos)}` : undefined} acao={{ rotulo: "Indicar agora", onClick: () => setIndicarAberta(true) }} />;
                  if (campanha.tipo === "resgate") {
                    const feitos = dados?.resgates?.filter((r) => r.status !== "cancelado").length ?? 0;
                    return <Missao key={campanha.id} Icone={Gift} titulo={campanha.titulo} recompensa="Use seus pontos" descricao={campanha.descricao || "Troque seus pontos por um benefício disponível."} status={feitos ? `${feitos} ${feitos === 1 ? "resgate realizado" : "resgates realizados"}` : undefined} acao={{ rotulo: "Ver prêmios", onClick: () => setAba("premios") }} />;
                  }
                  return <Missao key={campanha.id} Icone={Info} titulo={campanha.titulo} recompensa={campanha.recompensa_texto || "Novidade"} descricao={campanha.descricao || "Confira esta novidade do Clube Sra. Luck."} />;
                })}
                <button type="button" onClick={() => setFolha("como")} className="mt-1 flex items-center justify-center gap-2 py-2 text-[13px] font-semibold text-[#7D2434]"><Info className="h-4 w-4" /> Como funciona o Clube</button>
              </div>
            )}

            {aba === "indicacoes" && (
              <>
                <div className="rounded-[20px] border border-[#EAD7D2] bg-gradient-to-br from-white to-[#FBEFEC] p-4">
                  <div className="font-heading text-[21px] font-semibold leading-[1.15] text-[#6B1F2E]">Indique e ganhe {config.pontosIndicacao} pontos</div>
                  <ol className="m-0 mt-3 grid list-none grid-cols-3 gap-2 p-0 text-center">
                    {["Você indica", "Ela fecha contrato", "Paga a 1ª parcela"].map((t, i) => (
                      <li key={t} className="rounded-[12px] bg-white/80 px-2 py-[10px]">
                        <span className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-[#6B1F2E] text-[11px] font-bold text-white">{i + 1}</span>
                        <span className="block pt-[6px] text-[11.5px] leading-tight text-[#5E4A46]">{t}</span>
                      </li>
                    ))}
                  </ol>
                  <button type="button" onClick={() => setIndicarAberta(true)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#6B1F2E] px-4 py-[13px] text-[14px] font-semibold text-white"><UserPlus className="h-4 w-4" /> Indicar uma amiga</button>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[
                    ["Em andamento", String(dados?.indicacoes.emAnalise ?? 0)],
                    ["Fecharam", String(dados?.indicacoes.confirmadas ?? 0)],
                    ["Pontos ganhos", pontosIndicacoes.toLocaleString("pt-BR")],
                  ].map(([r, v]) => (
                    <div key={r} className="rounded-[14px] border border-[#ECE2DF] bg-white px-2 py-3">
                      <div className="font-heading text-[22px] font-semibold leading-none text-[#2E2422]">{v}</div>
                      <div className="pt-1 text-[11px] text-[#9A8C88]">{r}</div>
                    </div>
                  ))}
                </div>

                <h3 className="m-0 pb-2 pt-5 text-[12px] font-semibold uppercase tracking-[.12em] text-[#A9837C]">Suas indicações</h3>
                {indicacoes.length === 0 ? (
                  <div className="rounded-[18px] border border-dashed border-[#E3D4D0] bg-white p-6 text-center text-[13px] font-light leading-[1.5] text-[#9A8A86]">Você ainda não indicou ninguém. Indique uma amiga e acompanhe cada etapa por aqui.</div>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {indicacoes.map((i) => {
                      const etapa = etapaIndicacao(i, config.pontosIndicacao);
                      const cor = etapa.tom === "sucesso" ? "#3F7D5B" : etapa.tom === "andamento" ? "#8A6720" : etapa.tom === "encerrada" ? "#988985" : "#7D2434";
                      const fundo = etapa.tom === "sucesso" ? "#EEF6F0" : etapa.tom === "andamento" ? "#FFF7E8" : etapa.tom === "encerrada" ? "#F5F1EF" : "#F7EFED";
                      return (
                        <li key={i.id} className="rounded-[16px] border border-[#ECE2DF] bg-white px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate text-[14.5px] font-semibold text-[#43322F]">{i.nome_indicado}</span>
                            <span className="flex-none rounded-full px-[10px] py-1 text-[11px] font-semibold" style={{ background: fundo, color: cor }}>{etapa.rotulo}</span>
                          </div>
                          {etapa.passo >= 0 && (
                            <div className="mt-[10px] grid grid-cols-4 gap-1" aria-hidden="true">
                              {[0, 1, 2, 3].map((p) => <span key={p} className="h-[4px] rounded-full" style={{ background: p <= etapa.passo ? cor : "#EFE6E3" }} />)}
                            </div>
                          )}
                          <div className="pt-2 text-[12px] leading-[1.45] text-[#8D7D79]">{etapa.detalhe} <span className="text-[#B3A6A2]">· indicada em {dataCurta(i.created_at)}</span></div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      <IndicarFolha aberta={indicarAberta} onFechar={() => setIndicarAberta(false)} onEnviada={() => { void carregar(); setAba("indicacoes"); }} pontosPorIndicacao={config.pontosIndicacao} nomeCliente={nomeCliente} />

      <Folha aberta={Boolean(resgateAlvo)} onFechar={() => !ocupado && setResgateAlvo(null)} titulo="Confirmar resgate">
        {resgateAlvo && (
          <>
            <div className="flex items-center gap-3">
              <div className="h-[72px] w-[72px] flex-none overflow-hidden rounded-[16px]"><ImagemPremio recompensa={resgateAlvo} /></div>
              <div className="min-w-0"><div className="text-[15px] font-semibold text-[#2E2422]">{resgateAlvo.titulo}</div><div className="pt-1 text-[12.5px] leading-[1.4] text-[#8D7D79]">{resgateAlvo.descricao}</div></div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-[16px] bg-[#FBF7F5] p-3 text-center">
              {[["Saldo", saldo], ["Resgate", -resgateAlvo.pontos], ["Depois", Math.max(0, saldo - resgateAlvo.pontos)]].map(([r, v]) => (
                <div key={String(r)}><div className="text-[11px] text-[#9A8C88]">{r}</div><div className={`font-heading text-[20px] font-semibold ${Number(v) < 0 ? "text-[#B86575]" : "text-[#6B1F2E]"}`}>{Number(v).toLocaleString("pt-BR")}</div></div>
              ))}
            </div>
            <p className="m-0 pt-3 text-[12.5px] leading-[1.5] text-[#8D7D79]">{resgateAlvo.instrucoes_pos_resgate || "Depois de solicitar, a equipe Sra. Luck confirma a entrega com você."}</p>
            <button type="button" disabled={ocupado} onClick={() => void confirmarResgate()} className="mt-4 w-full rounded-[14px] bg-[#6B1F2E] px-4 py-[15px] text-[14.5px] font-semibold text-white disabled:opacity-50">{ocupado ? "Solicitando…" : `Resgatar por ${pts(resgateAlvo.pontos)}`}</button>
          </>
        )}
      </Folha>

      <Folha aberta={folha === "extrato"} onFechar={() => setFolha(null)} titulo="Extrato de pontos">
        {(dados?.historico ?? []).length === 0 ? (
          <p className="m-0 py-6 text-center text-[13px] text-[#9A8C88]">Seus pontos aparecem aqui assim que você ganhar os primeiros.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {dados!.historico.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 border-b border-[#F4ECEA] py-3 last:border-b-0">
                <span className="min-w-0"><span className="block truncate text-[13.5px] font-medium text-[#43322F]">{descreverEvento(e)}</span><span className="block pt-[2px] text-[11.5px] text-[#A2938F]">{new Date(e.created_at).toLocaleDateString("pt-BR")}</span></span>
                <span className={`flex-none font-heading text-[18px] font-semibold ${e.pontos >= 0 ? "text-[#3F7D5B]" : "text-[#B86575]"}`}>{e.pontos >= 0 ? "+" : ""}{e.pontos}</span>
              </li>
            ))}
          </ul>
        )}
      </Folha>

      <Folha aberta={folha === "como"} onFechar={() => setFolha(null)} titulo="Como funciona">
        <ol className="m-0 flex list-none flex-col gap-4 p-0">
          {[
            ["Ganhe pontos", `1ª parcela paga: +${config.pontosPrimeiraParcela} e voucher. Cada parcela paga em dia: +${config.pontosParcelaEmDia}. Amiga indicada que fechar e pagar a 1ª parcela: +${config.pontosIndicacao}.`],
            ["Acompanhe", "Seu saldo, o extrato e cada indicação ficam aqui, atualizados pela equipe."],
            ["Resgate", "Escolha um prêmio com seus pontos. A equipe confirma e combina a entrega com você."],
          ].map(([t, d], i) => (
            <li key={t} className="flex items-start gap-3">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#F7EFED] text-[13px] font-bold text-[#7D2434]">{i + 1}</span>
              <span><span className="block text-[14.5px] font-semibold text-[#2E2422]">{t}</span><span className="block pt-1 text-[13px] leading-[1.5] text-[#7F6F6B]">{d}</span></span>
            </li>
          ))}
        </ol>
      </Folha>
    </div>
  );
}

function CartaoPremio({ recompensa, saldo, onResgatar }: { recompensa: ClubeRecompensa; saldo: number; onResgatar: () => void }) {
  const esgotado = recompensa.estoque !== null && recompensa.estoque <= 0;
  const pode = !esgotado && saldo >= recompensa.pontos;
  const progresso = Math.min(100, Math.round((saldo / recompensa.pontos) * 100));
  return (
    <article className="flex flex-col overflow-hidden rounded-[18px] border border-[#ECE2DF] bg-white shadow-[0_6px_18px_rgba(73,42,47,.06)]">
      <div className="relative aspect-square overflow-hidden bg-[#F7EEEC]">
        <ImagemPremio recompensa={recompensa} />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[rgba(38,20,24,.55)] to-transparent" aria-hidden="true" />
        {recompensa.categoria && <span className="absolute left-2 top-2 rounded-full bg-[rgba(255,255,255,.9)] px-2 py-[3px] text-[10px] font-semibold text-[#7D2434] backdrop-blur">{recompensa.categoria}</span>}
        <span className="absolute bottom-2 left-2 flex items-center gap-[5px] rounded-full bg-[rgba(255,255,255,.94)] py-[3px] pl-[3px] pr-[9px] shadow-[0_4px_12px_rgba(0,0,0,.12)]">
          <Moeda tamanho={11} /><span className="text-[12px] font-bold text-[#8A671E]">{recompensa.pontos.toLocaleString("pt-BR")} pts</span>
        </span>
        {!esgotado && recompensa.estoque !== null && recompensa.estoque <= 3 && <span className="absolute bottom-2 right-2 rounded-full bg-[#A84759] px-2 py-[3px] text-[10px] font-semibold text-white">Últimas</span>}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <div className="line-clamp-2 text-[13.5px] font-semibold leading-[1.3] text-[#2E2422]">{recompensa.titulo}</div>
        {recompensa.descricao && <div className="line-clamp-2 pt-1 text-[11.5px] leading-[1.4] text-[#8D7D79]">{recompensa.descricao}</div>}
        <div className="mt-auto pt-3">
          {esgotado ? (
            <div className="rounded-[10px] bg-[#F5F1EF] py-2 text-center text-[12px] font-semibold text-[#988985]">Esgotado</div>
          ) : pode ? (
            <button type="button" onClick={onResgatar} className="w-full rounded-[10px] bg-[#6B1F2E] py-[9px] text-[12.5px] font-semibold text-white">Resgatar</button>
          ) : (
            <div>
              <div className="h-[5px] overflow-hidden rounded-full bg-[#F1E7E4]"><div className="h-full rounded-full bg-[#C99A5B]" style={{ width: `${progresso}%` }} /></div>
              <div className="pt-[6px] text-[11.5px] text-[#9A8C88]">Faltam {(recompensa.pontos - saldo).toLocaleString("pt-BR")} pts</div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function CartaoVoucher({ estado, solicitadoEm, ocupado, pontosMissao, onIrParcelas, onSolicitar, onAbrir, onUsar }: {
  estado: ReturnType<typeof estadoVoucher>; solicitadoEm?: string | null; ocupado: boolean; pontosMissao: number;
  onIrParcelas: () => void; onSolicitar: () => void; onAbrir: () => void; onUsar: () => void;
}) {
  const textos = {
    bloqueado: { selo: "Bloqueado", cor: "#988985", fundo: "#F5F1EF", texto: `Pague a 1ª parcela para liberar a consulta com o Doutor e ganhar +${pontosMissao} pts.` },
    liberado: { selo: "Liberado", cor: "#3F7D5B", fundo: "#EEF6F0", texto: "Seu voucher de consulta está liberado. Solicite e a equipe prepara para você." },
    solicitado: { selo: "Em preparo", cor: "#8A6720", fundo: "#FFF7E8", texto: `Pedido feito${solicitadoEm ? ` em ${dataCurta(solicitadoEm)}` : ""}. Avisaremos quando o voucher estiver pronto.` },
    pronto: { selo: "Pronto", cor: "#3F7D5B", fundo: "#EEF6F0", texto: "Seu voucher está disponível. Abra para apresentar na consulta." },
    utilizado: { selo: "Utilizado", cor: "#988985", fundo: "#F5F1EF", texto: "Voucher já utilizado. Aproveite os outros prêmios do Clube." },
  }[estado];
  return (
    <section className="rounded-[20px] border border-[#E6D5D0] bg-gradient-to-br from-white to-[#FFF6F4] p-4 shadow-[0_8px_22px_rgba(73,42,47,.05)]" aria-label="Voucher de consulta">
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 flex-none items-center justify-center rounded-[15px] bg-[#F9ECEF] text-[#A84759]">{estado === "bloqueado" ? <Lock className="h-5 w-5" /> : <Ticket className="h-5 w-5" />}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[.12em] text-[#B86575]">Boas-vindas</div>
            <span className="flex-none rounded-full px-[9px] py-[3px] text-[10.5px] font-bold" style={{ background: textos.fundo, color: textos.cor }}>{textos.selo}</span>
          </div>
          <div className="pt-1 font-heading text-[20px] font-semibold leading-[1.15] text-[#2E2422]">Consulta com o Doutor</div>
          <p className="m-0 pt-1 text-[12.5px] leading-[1.45] text-[#7F6F6B]">{textos.texto}</p>
        </div>
      </div>
      {estado === "bloqueado" && <button type="button" onClick={onIrParcelas} className="mt-3 w-full rounded-[12px] border border-[#E6D3CF] bg-white py-[11px] text-[13px] font-semibold text-[#7D2434]">Ver minha 1ª parcela</button>}
      {estado === "liberado" && <button type="button" disabled={ocupado} onClick={onSolicitar} className="mt-3 w-full rounded-[12px] bg-[#6B1F2E] py-[11px] text-[13px] font-semibold text-white disabled:opacity-50">Solicitar meu voucher</button>}
      {estado === "solicitado" && <div className="mt-3 flex items-center justify-center gap-2 rounded-[12px] bg-[#FFF7E8] py-[10px] text-[12.5px] font-medium text-[#8A6720]"><Clock3 className="h-4 w-4" /> A equipe está preparando</div>}
      {estado === "pronto" && (
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <button type="button" disabled={ocupado} onClick={onAbrir} className="flex items-center justify-center gap-2 rounded-[12px] bg-[#6B1F2E] py-[11px] text-[13px] font-semibold text-white disabled:opacity-50"><Receipt className="h-4 w-4" /> Ver voucher</button>
          <button type="button" disabled={ocupado} onClick={onUsar} className="flex items-center gap-1 rounded-[12px] border border-[#E6D3CF] px-3 text-[12px] font-semibold text-[#7D2434]"><Check className="h-4 w-4" /> Já usei</button>
        </div>
      )}
    </section>
  );
}

function Missao({ Icone, titulo, recompensa, descricao, status, destaque, acao, concluida = false }: {
  Icone: typeof Gift; titulo: string; recompensa: string; descricao: string; status?: string; destaque?: string;
  acao?: { rotulo: string; onClick: () => void }; concluida?: boolean;
}) {
  return (
    <article className={`rounded-[18px] border p-4 ${concluida ? "border-[#D3E6D8] bg-[#F6FBF7]" : "border-[#ECE2DF] bg-white"}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-11 w-11 flex-none items-center justify-center rounded-[14px] ${concluida ? "bg-[#3F7D5B] text-white" : "bg-[#F9ECEF] text-[#A84759]"}`}>{concluida ? <Check className="h-5 w-5" /> : <Icone className="h-5 w-5" />}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[15px] font-semibold text-[#2E2422]">{titulo}</div>
            <span className="rounded-full bg-[#FBF4E7] px-2 py-[2px] text-[11px] font-bold text-[#8A671E]">{recompensa}</span>
          </div>
          <p className="m-0 pt-1 text-[12.5px] leading-[1.45] text-[#7F6F6B]">{descricao}</p>
          {status && <div className={`pt-2 text-[12.5px] font-semibold ${concluida ? "text-[#3F7D5B]" : "text-[#6B1F2E]"}`}>{status}</div>}
          {destaque && <div className="mt-2 rounded-[10px] bg-[#FBF7F5] px-3 py-2 text-[12px] text-[#6F605C]">{destaque}</div>}
        </div>
      </div>
      {acao && <button type="button" onClick={acao.onClick} className="mt-3 flex w-full items-center justify-center gap-1 rounded-[12px] border border-[#E6D3CF] py-[10px] text-[13px] font-semibold text-[#7D2434]">{acao.rotulo} <ChevronRight className="h-4 w-4" /></button>}
    </article>
  );
}
