import { useCallback, useEffect, useState } from "react";
import { CalendarClock, LogOut, ReceiptText, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { apiJson } from "../lib/api";

type Item = {
  boletoId?: string;
  clienteId: string;
  agendamentoId?: string;
  nome: string;
  numeroParcela?: number;
  totalParcelas?: number;
  valor: number;
  dataPagamento?: string | null;
  data?: string | null;
  porcentagemPagamento?: number | null;
  dataPrevisao?: string | null;
};

type Data = {
  comprovantesPendentes: Item[];
  proximosAgendamentos: Item[];
  clientesAguardandoLiberacao: Item[];
  proximasLiberacoesFinanceiras: Item[];
};

const moeda = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const data = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}T12:00:00`))
    : "—";

async function carregar(): Promise<Data> {
  const result = await apiJson<Partial<Data>>("/api/admin/visao-geral", {
    method: "GET",
    cache: "no-store",
  });

  return {
    comprovantesPendentes: Array.isArray(result.comprovantesPendentes) ? result.comprovantesPendentes : [],
    proximosAgendamentos: Array.isArray(result.proximosAgendamentos) ? result.proximosAgendamentos : [],
    clientesAguardandoLiberacao: Array.isArray(result.clientesAguardandoLiberacao) ? result.clientesAguardandoLiberacao : [],
    proximasLiberacoesFinanceiras: Array.isArray(result.proximasLiberacoesFinanceiras) ? result.proximasLiberacoesFinanceiras : [],
  };
}

function Bloco({
  title,
  description,
  items,
  icon: Icon,
  empty,
}: {
  title: string;
  description: string;
  items: Item[];
  icon: typeof ReceiptText;
  empty: string;
}) {
  return (
    <section className="surface-glass rounded-3xl p-6 luxury-ring">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blush text-burgundy">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-burgundy">{title}</h2>
          <p className="mt-1 text-xs text-clay/55">{description}</p>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-rose/20 px-4 py-7 text-center text-sm text-clay/50">
          {empty}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.boletoId || item.agendamentoId || item.clienteId}
              className="flex items-center justify-between gap-3 rounded-2xl border border-rose/10 bg-blush/20 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-burgundy">{item.nome}</p>
                <p className="text-xs text-clay/50">
                  {item.numeroParcela ? `Parcela ${item.numeroParcela}/${item.totalParcelas} · ` : ""}
                  {data(item.dataPagamento || item.data || item.dataPrevisao)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-burgundy">{moeda(Number(item.valor) || 0)}</p>
                <p className="text-[10px] uppercase tracking-wider text-clay/45">
                  {item.porcentagemPagamento != null ? `${item.porcentagemPagamento}% pago` : "Acompanhar"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function AdminVisaoGeralPage() {
  const [dados, setDados] = useState<Data | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);

  const atualizar = useCallback(async (silencioso = false) => {
    if (silencioso) setAtualizando(true);
    else setCarregando(true);
    setErro("");
    try {
      setDados(await carregar());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar o painel administrativo.");
    } finally {
      setCarregando(false);
      setAtualizando(false);
    }
  }, []);

  useEffect(() => {
    void atualizar();
    const timer = window.setInterval(() => void atualizar(true), 15000);
    return () => window.clearInterval(timer);
  }, [atualizar]);

  async function sair() {
    try {
      await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
    } finally {
      window.location.replace("/admin/login");
    }
  }

  if (carregando && !dados) {
    return (
      <main className="min-h-screen bg-bloom p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <div className="surface-glass rounded-3xl p-6 luxury-ring">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-burgundy/45">Painel administrativo</p>
            <h1 className="mt-1 text-3xl font-semibold text-burgundy">Carregando visão geral…</h1>
            <p className="mt-2 text-sm text-clay/55">Validando sua sessão e buscando os dados mais recentes.</p>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            {[1, 2, 3, 4].map((n) => <div key={n} className="h-56 animate-pulse rounded-3xl bg-white/60" />)}
          </div>
        </div>
      </main>
    );
  }

  if (erro && !dados) {
    return (
      <main className="min-h-screen bg-bloom px-4 py-8 sm:px-6">
        <section className="surface-glass mx-auto max-w-xl rounded-3xl p-8 text-center shadow-sm luxury-ring">
          <ShieldCheck className="mx-auto h-10 w-10 text-burgundy" />
          <h1 className="mt-4 text-xl font-semibold text-burgundy">Não foi possível carregar o painel</h1>
          <p className="mt-2 text-sm leading-6 text-clay/60">{erro}</p>
          <div className="mt-6 flex justify-center gap-3">
            <button onClick={() => void atualizar()} className="inline-flex items-center gap-2 rounded-full bg-burgundy px-5 py-2.5 text-xs font-semibold uppercase tracking-label text-pearl">
              <RefreshCw className="h-4 w-4" /> Tentar novamente
            </button>
            <button onClick={() => void sair()} className="rounded-full border border-burgundy/15 px-5 py-2.5 text-xs font-semibold uppercase tracking-label text-burgundy">
              Sair
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bloom px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-burgundy/45">Painel administrativo</p>
            <h1 className="mt-1 text-3xl font-semibold text-burgundy">Visão Geral</h1>
            <p className="mt-2 max-w-2xl text-sm text-clay/55">Pendências e próximos eventos, servidos diretamente pelo Cloudflare Worker.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void atualizar(true)}
              disabled={atualizando}
              className="inline-flex items-center gap-2 rounded-full border border-burgundy/15 bg-white/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-label text-burgundy disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${atualizando ? "animate-spin" : ""}`} />
              {atualizando ? "Atualizando…" : "Atualizar"}
            </button>
            <button onClick={() => void sair()} className="inline-flex items-center gap-2 rounded-full bg-burgundy px-4 py-2.5 text-xs font-semibold uppercase tracking-label text-pearl">
              <LogOut className="h-4 w-4" /> Sair
            </button>
          </div>
        </header>

        {erro && (
          <div className="mb-5 rounded-2xl border border-rose/20 bg-white/70 px-4 py-3 text-sm text-burgundy">
            A última atualização falhou: {erro}. Os dados exibidos são da última atualização válida.
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <Bloco title="Comprovantes aguardando validação" description="Parcelas com comprovante enviado." items={dados?.comprovantesPendentes ?? []} icon={ReceiptText} empty="Nenhum comprovante aguardando validação." />
          <Bloco title="Próximos agendamentos" description="Termos cirúrgicos confirmados." items={dados?.proximosAgendamentos ?? []} icon={CalendarClock} empty="Nenhum agendamento confirmado nos próximos dias." />
          <Bloco title="Aguardando liberação da agenda" description="Clientes em revisão financeira." items={dados?.clientesAguardandoLiberacao ?? []} icon={ShieldCheck} empty="Nenhuma cliente aguardando liberação." />
          <Bloco title="Próximas liberações financeiras" description="Previsões já definidas." items={dados?.proximasLiberacoesFinanceiras ?? []} icon={Wallet} empty="Nenhuma liberação prevista." />
        </div>

        <p className="mt-5 text-center text-[11px] text-clay/40">Atualização automática a cada 15 segundos.</p>
      </div>
    </main>
  );
}
