"use client";
import { fetchInstant, refreshInstant, getInstantCache } from "@/lib/instantCache";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarClock,
  ReceiptText,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { PageHeader, Panel, SectionHeading, StatusPill } from "@/components/admin/ExecutiveUI";
import { SkeletonCards } from "@/components/ui/Skeleton";
import { formatarMoeda } from "@/lib/utils";

interface ComprovantePendente {
  boletoId: string;
  clienteId: string;
  nome: string;
  numeroParcela: number;
  totalParcelas: number;
  valor: number;
  dataPagamento: string | null;
}

interface AgendamentoTermo {
  agendamentoId: string;
  clienteId: string;
  nome: string;
  data: string | null;
  valorContrato: number;
  temPrevisaoLiberacao: boolean;
}

interface ClienteAguardandoLiberacao {
  clienteId: string;
  nome: string;
  valorContrato: number;
  quantidadeParcelas: number | null;
  porcentagemPagamento: number;
  dataAtingiuPercentual: string | null;
}

interface LiberacaoFinanceira {
  agendamentoId: string;
  clienteId: string;
  nome: string;
  valorContrato: number;
  dataPrevisao: string | null;
}

interface VisaoGeralData {
  comprovantesPendentes: ComprovantePendente[];
  proximosAgendamentos: AgendamentoTermo[];
  clientesAguardandoLiberacao: ClienteAguardandoLiberacao[];
  proximasLiberacoesFinanceiras: LiberacaoFinanceira[];
}

function formatarDataCurta(iso: string | null): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function VerTudo({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.2em] text-burgundy/60 transition-colors hover:text-burgundy"
    >
      Ver tudo <ArrowUpRight className="h-3.5 w-3.5" />
    </Link>
  );
}

function VazioBloco({ texto }: { texto: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-rose/20 bg-blush/25 px-5 py-8 text-center text-sm text-clay/50">
      {texto}
    </div>
  );
}

export default function VisaoGeralPage() {
  const [dados, setDados] = useState<VisaoGeralData | null>(null);
  const [carregando, setCarregando] = useState(true);

  async function carregar(force = false) {
    const url = "/api/admin/visao-geral";
    if (!force) {
      const cached = getInstantCache<VisaoGeralData>(url);
      if (cached) { setDados(cached); setCarregando(false); }
    }
    try {
      const data = force ? await refreshInstant<VisaoGeralData>(url) : await fetchInstant<VisaoGeralData>(url);
      setDados(data);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    const intervalo = setInterval(() => carregar(true), 60_000);
    return () => clearInterval(intervalo);
  }, []);

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        eyebrow="Painel"
        title="Visão Geral"
        description="O que está pendente agora, reunido a partir de Pagamentos, Agenda e Revisão financeira. Cada item leva direto para onde a ação acontece."
      />

      {carregando || !dados ? (
        <SkeletonCards count={5} />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* 1. Parcelas aguardando validação do comprovante */}
          <Panel className="p-6">
            <SectionHeading
              title="Comprovantes aguardando validação"
              description="Parcelas com comprovante enviado, aguardando confirmação."
              aside={<VerTudo href="/admin/pagamentos?status=pendente_confirmacao" />}
            />
            {dados.comprovantesPendentes.length === 0 ? (
              <VazioBloco texto="Nenhum comprovante aguardando validação no momento." />
            ) : (
              <div className="space-y-2.5">
                {dados.comprovantesPendentes.map((c) => (
                  <Link
                    key={c.boletoId}
                    href={`/admin/pagamentos?cliente_id=${c.clienteId}`}
                    className="flex items-center justify-between gap-3 rounded-[22px] border border-rose/10 bg-blush/25 px-4 py-3 transition-colors hover:bg-blush/45"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/25 text-burgundy">
                        <ReceiptText className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-burgundy">{c.nome}</p>
                        <p className="text-xs text-clay/45">
                          Parcela {c.numeroParcela}/{c.totalParcelas} · enviado em {formatarDataCurta(c.dataPagamento)}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-medium text-burgundy">{formatarMoeda(c.valor)}</span>
                      <StatusPill tone="gold">Aguardando</StatusPill>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          {/* 2. Próximos agendamentos */}
          <Panel className="p-6">
            <SectionHeading
              title="Próximos agendamentos"
              description="Assinaturas de termos cirúrgicos já confirmadas na agenda."
              aside={<VerTudo href="/admin/agenda" />}
            />
            {dados.proximosAgendamentos.length === 0 ? (
              <VazioBloco texto="Nenhum agendamento confirmado nos próximos dias." />
            ) : (
              <div className="space-y-2.5">
                {dados.proximosAgendamentos.map((a) => (
                  <Link
                    key={a.agendamentoId}
                    href="/admin/agenda"
                    className="flex items-center justify-between gap-3 rounded-[22px] border border-rose/10 bg-blush/25 px-4 py-3 transition-colors hover:bg-blush/45"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-burgundy/10 text-burgundy">
                        <CalendarClock className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-burgundy">{a.nome}</p>
                        <p className="text-xs text-clay/45">{formatarDataCurta(a.data)}</p>
                      </div>
                    </div>
                    <StatusPill tone="success">Confirmado</StatusPill>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          {/* 3. Clientes aguardando liberação da agenda */}
          <Panel className="p-6">
            <SectionHeading
              title="Aguardando liberação da agenda"
              description="Já atingiram o percentual mínimo de pagamento e aguardam confirmação do levantamento financeiro."
              aside={<VerTudo href="/admin/agenda" />}
            />
            {dados.clientesAguardandoLiberacao.length === 0 ? (
              <VazioBloco texto="Nenhuma cliente aguardando liberação da agenda no momento." />
            ) : (
              <div className="space-y-2.5">
                {dados.clientesAguardandoLiberacao.map((c) => (
                  <Link
                    key={c.clienteId}
                    href="/admin/agenda"
                    className="flex items-center justify-between gap-3 rounded-[22px] border border-rose/10 bg-blush/25 px-4 py-3 transition-colors hover:bg-blush/45"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose/15 text-burgundy">
                        <ShieldCheck className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-burgundy">{c.nome}</p>
                        <p className="text-xs text-clay/45">
                          {formatarMoeda(c.valorContrato)} · {c.quantidadeParcelas ?? "—"}x
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-medium text-burgundy">{c.porcentagemPagamento}%</span>
                      <StatusPill tone="rose">Pendente</StatusPill>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          {/* 4. Próximas liberações financeiras */}
          <Panel className="p-6">
            <SectionHeading
              title="Próximas liberações financeiras"
              description="Clientes com data de previsão de liberação já definida, da mais próxima para a mais distante."
              aside={<VerTudo href="/admin/agenda?aba=liberacao" />}
            />
            {dados.proximasLiberacoesFinanceiras.length === 0 ? (
              <VazioBloco texto="Nenhuma liberação financeira prevista no momento." />
            ) : (
              <div className="space-y-2.5">
                {dados.proximasLiberacoesFinanceiras.map((l) => (
                  <Link
                    key={l.agendamentoId}
                    href="/admin/agenda?aba=liberacao"
                    className="flex items-center justify-between gap-3 rounded-[22px] border border-rose/10 bg-blush/25 px-4 py-3 transition-colors hover:bg-blush/45"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-burgundy/10 text-burgundy">
                        <Wallet className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-burgundy">{l.nome}</p>
                        <p className="text-xs text-clay/45">{formatarDataCurta(l.dataPrevisao)}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-medium text-burgundy">{formatarMoeda(l.valorContrato)}</span>
                      <StatusPill tone="indigo">Prevista</StatusPill>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
