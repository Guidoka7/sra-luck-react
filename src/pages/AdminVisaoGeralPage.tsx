import { useEffect, useState } from "react";
import { CalendarClock, ReceiptText, ShieldCheck, Wallet } from "lucide-react";
import { apiJson } from "../lib/api";

type Item = {
  boletoId?: string; clienteId: string; agendamentoId?: string; nome: string;
  numeroParcela?: number; totalParcelas?: number; valor: number; dataPagamento?: string | null;
  data?: string | null; quantidadeParcelas?: number | null; porcentagemPagamento?: number;
  dataPrevisao?: string | null;
};
type Data = { comprovantesPendentes: Item[]; proximosAgendamentos: Item[]; clientesAguardandoLiberacao: Item[]; proximasLiberacoesFinanceiras: Item[] };

const moeda = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const data = (value: string | null | undefined) => value ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}T12:00:00`)) : "—";

async function carregar(): Promise<Data> {
  return apiJson<Data>("/api/admin/visao-geral", { method: "GET", cache: "no-store" });
}

function Bloco({ title, description, items, icon: Icon, empty }: { title: string; description: string; items: Item[]; icon: typeof ReceiptText; empty: string }) {
  return <section className="surface-glass rounded-3xl p-6 luxury-ring">
    <div className="mb-5 flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blush text-burgundy"><Icon className="h-5 w-5" /></span><div><h2 className="text-base font-semibold text-burgundy">{title}</h2><p className="mt-1 text-xs text-clay/55">{description}</p></div></div>
    {items.length === 0 ? <div className="rounded-2xl border border-dashed border-rose/20 px-4 py-7 text-center text-sm text-clay/50">{empty}</div> : <div className="space-y-2">{items.map((item) => <div key={item.boletoId || item.agendamentoId || item.clienteId} className="flex items-center justify-between gap-3 rounded-2xl border border-rose/10 bg-blush/20 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-burgundy">{item.nome}</p><p className="text-xs text-clay/50">{item.numeroParcela ? `Parcela ${item.numeroParcela}/${item.totalParcelas} · ` : ""}{data(item.dataPagamento || item.data || item.dataPrevisao)}</p></div><div className="shrink-0 text-right"><p className="text-sm font-semibold text-burgundy">{moeda(item.valor)}</p><p className="text-[10px] uppercase tracking-wider text-clay/45">{item.porcentagemPagamento != null ? `${item.porcentagemPagamento}% pago` : "Acompanhar"}</p></div></div>)}</div>}
  </section>;
}

export function AdminVisaoGeralPage() {
  const [dados, setDados] = useState<Data | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => { carregar().then(setDados).catch((e) => setErro(e instanceof Error ? e.message : "Falha ao carregar.")).finally(() => setCarregando(false)); }, []);

  if (carregando) return <main className="min-h-screen bg-bloom p-6"><div className="mx-auto max-w-6xl animate-pulse space-y-4"><div className="h-10 w-72 rounded-xl bg-white/60" /><div className="grid gap-5 lg:grid-cols-2">{[1,2,3,4].map((n) => <div key={n} className="h-56 rounded-3xl bg-white/60" />)}</div></div></main>;
  if (erro) return <main className="min-h-screen bg-bloom p-6"><section className="mx-auto max-w-xl rounded-3xl bg-white/80 p-8 text-center shadow-sm"><h1 className="text-xl font-semibold text-burgundy">Acesso administrativo</h1><p className="mt-2 text-sm text-clay/60">{erro}</p><a className="mt-5 inline-flex rounded-full bg-burgundy px-5 py-2.5 text-xs uppercase tracking-label text-pearl" href="/admin/login">Voltar ao login</a></section></main>;
  return <main className="min-h-screen bg-bloom px-4 py-8 sm:px-6"><div className="mx-auto max-w-6xl"><header className="mb-7"><p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-burgundy/45">Painel</p><h1 className="mt-1 text-3xl font-semibold text-burgundy">Visão Geral</h1><p className="mt-2 max-w-2xl text-sm text-clay/55">Pendências e próximos eventos, agora servidos diretamente pelo Cloudflare Worker.</p></header><div className="grid gap-5 lg:grid-cols-2"><Bloco title="Comprovantes aguardando validação" description="Parcelas com comprovante enviado." items={dados!.comprovantesPendentes} icon={ReceiptText} empty="Nenhum comprovante aguardando validação." /><Bloco title="Próximos agendamentos" description="Termos cirúrgicos confirmados." items={dados!.proximosAgendamentos} icon={CalendarClock} empty="Nenhum agendamento confirmado nos próximos dias." /><Bloco title="Aguardando liberação da agenda" description="Clientes em revisão financeira." items={dados!.clientesAguardandoLiberacao} icon={ShieldCheck} empty="Nenhuma cliente aguardando liberação." /><Bloco title="Próximas liberações financeiras" description="Previsões já definidas." items={dados!.proximasLiberacoesFinanceiras} icon={Wallet} empty="Nenhuma liberação prevista." /></div></div></main>;
}
