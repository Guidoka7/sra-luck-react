import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Coins, Gift, HelpCircle, Sparkles, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import {
  buscarClube, indicarAmiga, resgatarPremio, usarBeneficio, VOUCHER_CONSULTA_KEY,
  type ClubeData, type ClubeRecompensa,
} from "@/lib/clube";

interface ClubeScreenProps {
  onVoltar: () => void;
  onIrParcelas: () => void;
}

function BottomSheet({ aberto, onFechar, titulo, children }: { aberto: boolean; onFechar: () => void; titulo: string; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {aberto && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-10 backdrop-blur-[2px] sm:items-center sm:px-4 sm:py-6">
          <motion.div
            initial={{ y: "100%", opacity: 0.96 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-[24px] border border-rose/12 bg-white p-5 shadow-2xl sm:rounded-[24px]"
          >
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-clay/15 sm:hidden" />
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-lg font-semibold text-burgundy">{titulo}</h3>
              <button type="button" onClick={onFechar} aria-label="Fechar" className="rounded-full p-1.5 text-clay/45 hover:bg-clay/5">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function PremioCard({ recompensa, saldo, onResgatar }: { recompensa: ClubeRecompensa; saldo: number; onResgatar: (r: ClubeRecompensa) => void }) {
  const elegivel = saldo >= recompensa.pontos && (recompensa.estoque === null || recompensa.estoque > 0);
  return (
    <article className="rounded-[18px] border border-rose/12 bg-white/90 p-3.5 shadow-card">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-blush text-burgundy">
          <Gift className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="font-heading text-sm font-semibold text-burgundy">{recompensa.titulo}</h4>
          <p className="mt-0.5 text-[0.72rem] leading-relaxed text-clay/60">{recompensa.descricao ?? "Benefício exclusivo Sra. Luck."}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[0.7rem] font-bold text-gold">{recompensa.pontos} moedas</span>
            <button
              type="button"
              disabled={!elegivel}
              onClick={() => onResgatar(recompensa)}
              className="rounded-full bg-burgundy px-3 py-1.5 text-[0.62rem] font-bold uppercase tracking-label text-pearl disabled:cursor-not-allowed disabled:bg-clay/15 disabled:text-clay/40"
            >
              {elegivel ? "Resgatar" : `Faltam ${Math.max(0, recompensa.pontos - saldo)} pts`}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function ClubeScreen({ onVoltar, onIrParcelas }: ClubeScreenProps) {
  const [dados, setDados] = useState<ClubeData | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [sheet, setSheet] = useState<"carteira" | "indicacoes" | "como" | null>(null);
  const [indicarAberto, setIndicarAberto] = useState(false);
  const [resgateAlvo, setResgateAlvo] = useState<ClubeRecompensa | null>(null);
  const [busy, setBusy] = useState(false);

  async function carregar() {
    try {
      setDados(await buscarClube());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir o Clube de Vantagens.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  const voucher = dados?.beneficios.find((item) => item.beneficio_key === VOUCHER_CONSULTA_KEY) ?? null;

  async function confirmarResgate() {
    if (!resgateAlvo) return;
    setBusy(true);
    try {
      await resgatarPremio(resgateAlvo.id, crypto.randomUUID());
      toast.success("Resgate solicitado! A equipe vai confirmar em breve.");
      setResgateAlvo(null);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir o resgate.");
    } finally {
      setBusy(false);
    }
  }

  async function usarVoucher() {
    if (!voucher) return;
    setBusy(true);
    try {
      await usarBeneficio(voucher.id);
      toast.success("Voucher marcado como utilizado. Combine o horário com a equipe.");
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível usar o voucher.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-[max(env(safe-area-inset-top),0.75rem)]">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={onVoltar} className="flex items-center gap-1.5 text-[0.72rem] font-semibold text-burgundy">
          <ArrowLeft className="h-4 w-4" /> Mais
        </button>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setSheet("carteira")} className="flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/8 px-2.5 py-1.5 text-[0.68rem] font-bold text-gold">
            <Coins className="h-3.5 w-3.5" /> {dados?.saldo ?? 0}
          </button>
          <button type="button" onClick={() => setSheet("indicacoes")} className="relative flex h-8 w-8 items-center justify-center rounded-full border border-rose/20 bg-white/85">
            <Users className="h-3.5 w-3.5 text-burgundy" />
            {Boolean(dados?.indicacoes.emAnalise) && (
              <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-alert px-1 text-[0.5rem] font-bold text-pearl">
                {dados?.indicacoes.emAnalise}
              </span>
            )}
          </button>
          <button type="button" onClick={() => setSheet("como")} className="flex h-8 w-8 items-center justify-center rounded-full border border-rose/20 bg-white/85">
            <HelpCircle className="h-3.5 w-3.5 text-burgundy" />
          </button>
        </div>
      </div>

      <p className="text-[0.58rem] font-bold uppercase tracking-label text-rose">Benefícios Sra. Luck</p>
      <h1 className="mt-0.5 font-heading text-xl font-semibold text-burgundy">Clube de vantagens</h1>
      <p className="mt-1 text-[0.75rem] text-clay/55">Indique, acumule pontos e escolha benefícios exclusivos.</p>

      {carregando ? (
        <p className="mt-8 text-center text-sm text-clay/45">Carregando...</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {!voucher && (
            <div className="rounded-[20px] border border-gold/25 bg-gradient-to-br from-burgundy to-burgundy-dark p-4 text-cream shadow-card">
              <p className="flex items-center gap-1.5 text-[0.58rem] font-bold uppercase tracking-label text-gold/85">
                <Sparkles className="h-3 w-3" /> Missão de boas-vindas
              </p>
              <h3 className="mt-1 font-heading text-base font-semibold">Pague sua primeira parcela</h3>
              <p className="mt-1 text-[0.75rem] leading-relaxed text-cream/75">
                Ao confirmar sua 1ª parcela, você ganha +50 moedas e um Voucher de Consulta com o Doutor.
              </p>
              <button type="button" onClick={onIrParcelas} className="mt-3 rounded-full bg-cream px-4 py-2 text-[0.65rem] font-bold uppercase tracking-label text-burgundy">
                Ver primeira parcela
              </button>
            </div>
          )}

          {voucher && (
            <article className="rounded-[18px] border border-success/20 bg-success/[0.05] p-3.5">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-success/10 text-success">
                  <Sparkles className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-heading text-sm font-semibold text-burgundy">Voucher de Consulta com o Doutor</h4>
                    <span className={`rounded-full px-1.5 py-0.5 text-[0.55rem] font-bold uppercase ${voucher.status === "disponivel" ? "bg-success/15 text-success" : "bg-clay/10 text-clay/45"}`}>
                      {voucher.status === "disponivel" ? "Disponível" : "Utilizado"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[0.72rem] leading-relaxed text-clay/60">
                    1 consulta com o Doutor, liberada após a confirmação da sua 1ª parcela.
                  </p>
                  {voucher.status === "disponivel" && (
                    <button type="button" disabled={busy} onClick={() => void usarVoucher()} className="mt-2 rounded-full bg-burgundy px-3 py-1.5 text-[0.62rem] font-bold uppercase tracking-label text-pearl">
                      Usar voucher
                    </button>
                  )}
                </div>
              </div>
            </article>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between px-0.5">
              <p className="text-[0.6rem] font-bold uppercase tracking-label text-rose">Prêmios disponíveis</p>
              <button type="button" onClick={() => setSheet("carteira")} className="text-[0.65rem] font-semibold text-burgundy hover:underline">
                Ver moedas
              </button>
            </div>
            <div className="flex flex-col gap-2.5">
              {(dados?.recompensas ?? []).map((recompensa) => (
                <PremioCard key={recompensa.id} recompensa={recompensa} saldo={dados?.saldo ?? 0} onResgatar={setResgateAlvo} />
              ))}
              {(dados?.recompensas ?? []).length === 0 && (
                <p className="py-4 text-center text-sm text-clay/45">Nenhum prêmio cadastrado no momento.</p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSheet("como")}
            className="rounded-[18px] border border-rose/12 bg-blush/40 px-4 py-3 text-left text-[0.75rem] font-semibold text-burgundy"
          >
            Quer entender o Clube? <span className="underline">Como funciona</span>
          </button>
        </div>
      )}

      <BottomSheet aberto={sheet === "carteira"} onFechar={() => setSheet(null)} titulo="Suas moedas">
        <p className="font-heading text-3xl font-bold text-gold">{dados?.saldo ?? 0}</p>
        <p className="mt-3 text-[0.62rem] font-bold uppercase tracking-label text-clay/45">Histórico de moedas</p>
        <ul className="mt-2 space-y-2">
          {(dados?.historico ?? []).map((evento) => (
            <li key={evento.id} className="flex items-center justify-between rounded-xl border border-rose/10 bg-white/70 px-3 py-2.5">
              <div>
                <p className="text-[0.78rem] font-semibold text-clay">
                  {evento.tipo === "indicacao" ? "Indicação confirmada" : evento.tipo === "bonus" ? "Bônus" : evento.tipo === "resgate" ? "Resgate" : "Ajuste"}
                </p>
                <p className="text-[0.65rem] text-clay/45">{new Date(evento.created_at).toLocaleDateString("pt-BR")}</p>
              </div>
              <span className={`font-heading text-sm font-bold ${evento.pontos >= 0 ? "text-success" : "text-rose"}`}>
                {evento.pontos >= 0 ? "+" : ""}{evento.pontos}
              </span>
            </li>
          ))}
          {(dados?.historico ?? []).length === 0 && <p className="py-3 text-center text-sm text-clay/45">Sem movimentações ainda.</p>}
        </ul>
      </BottomSheet>

      <BottomSheet aberto={sheet === "indicacoes"} onFechar={() => setSheet(null)} titulo="Suas indicações">
        <p className="text-[0.75rem] leading-relaxed text-clay/60">As moedas entram quando a indicação é confirmada pela equipe.</p>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <div className="rounded-xl border border-success/15 bg-success/[0.05] p-3 text-center">
            <p className="font-heading text-2xl font-bold text-success">{dados?.indicacoes.confirmadas ?? 0}</p>
            <p className="text-[0.62rem] uppercase tracking-label text-clay/45">Confirmadas</p>
          </div>
          <div className="rounded-xl border border-gold/20 bg-gold/[0.06] p-3 text-center">
            <p className="font-heading text-2xl font-bold text-gold">{dados?.indicacoes.emAnalise ?? 0}</p>
            <p className="text-[0.62rem] uppercase tracking-label text-clay/45">Em análise</p>
          </div>
        </div>
        <Button className="mt-4 w-full" onClick={() => setIndicarAberto(true)}>Indicar uma amiga</Button>
      </BottomSheet>

      <BottomSheet aberto={sheet === "como"} onFechar={() => setSheet(null)} titulo="Como funciona">
        <ol className="space-y-3">
          {[
            { n: 1, t: "Você indica", d: "Compartilhe o nome e telefone de uma amiga com a equipe Sra. Luck." },
            { n: 2, t: "A equipe confirma", d: "Assim que a indicação avança, suas moedas são creditadas automaticamente." },
            { n: 3, t: "Você escolhe", d: "Troque suas moedas por um dos benefícios do catálogo." },
          ].map((passo) => (
            <li key={passo.n} className="flex items-start gap-3">
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-burgundy/8 font-heading text-xs font-bold text-burgundy">{passo.n}</span>
              <div>
                <p className="text-[0.8rem] font-semibold text-burgundy">{passo.t}</p>
                <p className="mt-0.5 text-[0.72rem] leading-relaxed text-clay/60">{passo.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </BottomSheet>

      <IndicarModal aberto={indicarAberto} onFechar={() => setIndicarAberto(false)} onEnviado={() => { setIndicarAberto(false); void carregar(); }} />

      {resgateAlvo && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-[22px] border border-rose/15 bg-white p-5 shadow-2xl">
            <h3 className="font-heading text-lg font-semibold text-burgundy">Confirmar resgate</h3>
            <p className="mt-1 text-sm text-clay/60">{resgateAlvo.titulo}</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[0.68rem]">
              <div><p className="text-clay/45">Saldo atual</p><p className="font-heading text-base font-bold text-burgundy">{dados?.saldo ?? 0}</p></div>
              <div><p className="text-clay/45">Resgate</p><p className="font-heading text-base font-bold text-rose">-{resgateAlvo.pontos}</p></div>
              <div><p className="text-clay/45">Depois</p><p className="font-heading text-base font-bold text-burgundy">{Math.max(0, (dados?.saldo ?? 0) - resgateAlvo.pontos)}</p></div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setResgateAlvo(null)} className="rounded-full border border-rose/20 bg-white px-4 py-3 text-xs font-bold uppercase tracking-label text-burgundy">Agora não</button>
              <Button loading={busy} onClick={() => void confirmarResgate()}>Solicitar resgate</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IndicarModal({ aberto, onFechar, onEnviado }: { aberto: boolean; onFechar: () => void; onEnviado: () => void }) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (aberto) {
      setNome("");
      setTelefone("");
    }
  }, [aberto]);

  if (!aberto) return null;

  async function enviar() {
    if (!nome.trim()) return;
    setBusy(true);
    try {
      await indicarAmiga(nome.trim(), telefone.trim());
      toast.success("Indicação enviada! A equipe vai acompanhar.");
      onEnviado();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar a indicação.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-[22px] border border-rose/15 bg-white p-5 shadow-2xl">
        <h3 className="font-heading text-lg font-semibold text-burgundy">Indicar uma amiga</h3>
        <p className="mt-1 text-sm text-clay/55">Compartilhe os dados dela para nossa equipe entrar em contato.</p>
        <label className="mt-4 block text-[0.65rem] font-semibold uppercase tracking-label text-clay/50">
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1 w-full rounded-xl border border-rose/15 px-3 py-2.5 text-sm text-clay outline-none focus:border-burgundy" />
        </label>
        <label className="mt-3 block text-[0.65rem] font-semibold uppercase tracking-label text-clay/50">
          Telefone
          <input value={telefone} onChange={(e) => setTelefone(e.target.value)} className="mt-1 w-full rounded-xl border border-rose/15 px-3 py-2.5 text-sm text-clay outline-none focus:border-burgundy" />
        </label>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onFechar} className="rounded-full border border-rose/20 bg-white px-4 py-3 text-xs font-bold uppercase tracking-label text-burgundy">Cancelar</button>
          <Button disabled={!nome.trim()} loading={busy} onClick={() => void enviar()}>Enviar</Button>
        </div>
      </div>
    </div>
  );
}
