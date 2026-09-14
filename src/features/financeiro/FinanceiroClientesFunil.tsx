import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/admin/ExecutiveUI";
import { cn, formatarMoeda } from "@/lib/utils";
import { ModalClienteCompactoV3 } from "@/components/admin/ModalClienteCompactoV3";
import type { Cliente } from "@/types/database";
import { financeiroApi } from "./financeiroApi";
import type { ClienteFunilItem, FunilClienteBucket } from "./types";
import { FUNIL_CLIENTE_LABEL } from "./types";

const ORDEM: FunilClienteBucket[] = ["aguardando_conferencia", "ativos", "quitados", "suspensos", "negativados", "cancelados"];

export function FinanceiroClientesFunil() {
  const [itens, setItens] = useState<ClienteFunilItem[]>([]);
  const [clientesCompletos, setClientesCompletos] = useState<Cliente[]>([]);
  const [funis, setFunis] = useState<Array<{ bucket: FunilClienteBucket; total: number }>>([]);
  const [bucket, setBucket] = useState<FunilClienteBucket>("aguardando_conferencia");
  const [carregando, setCarregando] = useState(true);
  const [modal, setModal] = useState<Cliente | null>(null);

  async function carregar() {
    setCarregando(true);
    try {
      const [funil, lista] = await Promise.all([financeiroApi.funilClientes(), financeiroApi.clientes()]);
      setItens(funil.itens);
      setFunis(funil.funis);
      setClientesCompletos(lista as Cliente[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar o funil de clientes.");
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => { void carregar(); }, []);

  const visiveis = useMemo(() => itens.filter((item) => item.bucket === bucket), [itens, bucket]);

  function abrir(item: ClienteFunilItem) {
    const cliente = clientesCompletos.find((c) => c.id === item.clienteId);
    if (!cliente) { toast.error("Não foi possível abrir o perfil completo desta cliente agora."); return; }
    setModal(cliente);
  }

  return <>
    <Panel className="overflow-hidden p-3 dark:border-white/8 dark:bg-[#171519]/92">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {ORDEM.map((b) => {
          const total = funis.find((f) => f.bucket === b)?.total ?? 0;
          return <button key={b} type="button" onClick={() => setBucket(b)} className={cn("flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-semibold transition", bucket === b ? "bg-burgundy text-cream shadow-sm dark:bg-[#7f3546]" : "text-clay/55 hover:bg-blush/50 dark:text-white/45 dark:hover:bg-white/6")}>
            {FUNIL_CLIENTE_LABEL[b]}<span className={cn("rounded-full px-1.5 py-0.5 text-[9px]", bucket === b ? "bg-white/20" : "bg-rose/10 text-rose")}>{total}</span>
          </button>;
        })}
      </div>

      {carregando ? <div className="py-16 text-center text-xs text-clay/50 dark:text-white/45">Carregando clientes…</div>
        : visiveis.length === 0 ? <div className="py-16 text-center text-xs text-clay/50 dark:text-white/45">Nenhuma cliente neste estágio agora.</div>
        : <div className="divide-y divide-rose/8 dark:divide-white/6">{visiveis.map((item) => <button key={item.clienteId} type="button" onClick={() => abrir(item)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition hover:bg-blush/25 dark:hover:bg-white/[0.03]">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blush text-burgundy dark:bg-white/8 dark:text-rose"><UserRound className="h-3.5 w-3.5" /></span>
              <span className="min-w-0"><span className="block truncate text-sm font-semibold text-burgundy dark:text-cream">{item.nome}</span><span className="block text-[11px] text-clay/50 dark:text-white/42">{item.parcelasTotal > 0 ? `${item.parcelasPagas}/${item.parcelasTotal} parcelas pagas` : "Sem parcelas geradas"}</span></span>
            </div>
            <div className="flex items-center gap-3 text-right">
              {item.vencidas > 0 && <span className="flex items-center gap-1 rounded-full bg-alert/10 px-2 py-0.5 text-[10px] font-semibold text-alert"><AlertTriangle className="h-3 w-3" />{item.vencidas} vencida(s)</span>}
              <span className="text-xs font-semibold text-burgundy dark:text-cream">{formatarMoeda(item.saldoAReceber)}</span>
              <span className="hidden text-[10px] text-clay/45 dark:text-white/40 sm:block">{item.proximaAcao}</span>
              <ArrowRight className="h-3.5 w-3.5 text-clay/30" />
            </div>
          </button>)}</div>}
    </Panel>
    {modal ? <ModalClienteCompactoV3 cliente={modal} abaInicial="boletos" onClose={() => setModal(null)} onSalvo={() => { setModal(null); void carregar(); }} /> : null}
  </>;
}
