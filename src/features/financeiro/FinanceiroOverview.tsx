import { AlertTriangle, BadgeDollarSign, CalendarClock, CircleDollarSign, FileCheck2, Landmark, ReceiptText } from "lucide-react";
import { DualBarChart, EmptyPanel, Panel, SectionHeading } from "@/components/admin/ExecutiveUI";
import { formatarMoeda } from "@/lib/utils";
import type { AbaFinanceiro, ResumoFinanceiro } from "./types";

interface Props {
  resumo: ResumoFinanceiro | null;
  carregando: boolean;
  onNavegar: (aba: AbaFinanceiro, status?: string) => void;
}

const KPI_ICONS = [CircleDollarSign, BadgeDollarSign, AlertTriangle, FileCheck2, Landmark, ReceiptText];

export function FinanceiroOverview({ resumo, carregando, onNavegar }: Props) {
  if (carregando && !resumo) return <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl bg-white/65 dark:bg-white/[0.04]" />)}</div>;
  if (!resumo) return <EmptyPanel title="Resumo indisponível" description="Atualize a visão para tentar carregar os dados financeiros novamente." />;

  const kpis = [
    { label: "A receber no período", value: formatarMoeda(resumo.kpis.aReceber), helper: "Vencimentos selecionados", aba: "recebiveis" as const, status: "todos" },
    { label: "Recebido", value: formatarMoeda(resumo.kpis.recebido), helper: "Baixas confirmadas", aba: "recebiveis" as const, status: "pago" },
    { label: "Em atraso", value: formatarMoeda(resumo.kpis.vencido), helper: "Exige acompanhamento", aba: "recebiveis" as const, status: "vencido" },
    { label: "Aguardando validação", value: String(resumo.kpis.aguardandoValidacao), helper: "Comprovantes pendentes", aba: "validacao" as const },
    { label: "Receita adm. realizada", value: formatarMoeda(resumo.kpis.receitaAdministrativaRealizada), helper: "Proporção das baixas", aba: "visao-geral" as const },
    { label: "Receita adm. futura", value: formatarMoeda(resumo.kpis.receitaAdministrativaFutura), helper: "Proporção em aberto", aba: "recebiveis" as const, status: "nao_pago" },
  ];

  return <div className="space-y-4">
    <section aria-label="Indicadores financeiros" className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      {kpis.map((item, index) => {
        const Icon = KPI_ICONS[index];
        return <button key={item.label} type="button" onClick={() => onNavegar(item.aba, item.status)} className="group rounded-2xl border border-white/70 bg-white/82 p-3.5 text-left shadow-[0_16px_42px_-32px_rgba(122,38,50,.4)] transition hover:-translate-y-0.5 hover:border-rose/25 dark:border-white/8 dark:bg-[#171519]/92">
          <div className="flex items-start justify-between"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blush text-burgundy dark:bg-white/7 dark:text-rose"><Icon className="h-4 w-4" /></span><span className="text-[9px] font-semibold uppercase tracking-[.16em] text-clay/35 group-hover:text-burgundy/60 dark:text-white/30">Abrir</span></div>
          <p className="mt-3 text-[9px] font-bold uppercase tracking-[.14em] text-clay/48 dark:text-white/45">{item.label}</p>
          <p className="mt-1 truncate text-lg font-semibold text-burgundy dark:text-cream">{item.value}</p>
          <p className="mt-0.5 truncate text-[10px] text-clay/45 dark:text-white/38">{item.helper}</p>
        </button>;
      })}
    </section>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,.7fr)]">
      <Panel className="p-5 dark:border-white/8 dark:bg-[#171519]/92">
        <SectionHeading title="Evolução financeira" description="Previsto versus realizado, usando apenas vencimentos e baixas existentes." />
        {resumo.evolucao.length ? <DualBarChart data={resumo.evolucao.map((item) => ({ label: item.label, value: item.previsto, secondaryValue: item.realizado }))} primaryLabel="Previsto" secondaryLabel="Realizado" primaryColorClassName="bg-burgundy" secondaryColorClassName="bg-success/70" /> : <EmptyPanel title="Sem movimento no período" description="Não há vencimentos ou recebimentos reais para compor o evolutivo selecionado." />}
      </Panel>

      <Panel className="p-5 dark:border-white/8 dark:bg-[#171519]/92">
        <SectionHeading title="Previsão de recebimento" description="Parcelas abertas e não suspensas a partir de hoje." aside={<CalendarClock className="h-4 w-4 text-rose" />} />
        <div className="space-y-2.5">
          {[{ label: "Próximos 30 dias", value: resumo.previsao.dias30 }, { label: "Próximos 60 dias", value: resumo.previsao.dias60 }, { label: "Próximos 90 dias", value: resumo.previsao.dias90 }].map((item, index) => <div key={item.label} className="rounded-xl border border-rose/10 bg-blush/30 px-3.5 py-3 dark:border-white/7 dark:bg-white/[0.035]">
            <div className="flex items-center justify-between gap-3"><span className="text-xs font-medium text-clay/65 dark:text-white/62">{item.label}</span><span className="text-sm font-semibold text-burgundy dark:text-cream">{formatarMoeda(item.value)}</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white dark:bg-white/8"><div className="h-full rounded-full bg-gradient-to-r from-burgundy to-rose" style={{ width: `${Math.max(4, Math.min(100, resumo.previsao.dias90 ? (item.value / resumo.previsao.dias90) * 100 : 4))}%` }} /></div>
            {index === 2 ? <p className="mt-2 text-[10px] text-clay/42 dark:text-white/35">Projeção baseada na agenda real de vencimentos.</p> : null}
          </div>)}
        </div>
        <div className="mt-3 rounded-xl border border-dashed border-gold/30 bg-gold/[0.05] p-3 text-[10px] leading-4 text-clay/58 dark:text-white/48">
          Divergências de conciliação não são exibidas nesta fase porque nenhum provedor externo está conectado.
        </div>
      </Panel>
    </div>
  </div>;
}
