"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, Building2, CheckCircle2, Clock3, CreditCard, Database, KeyRound, Landmark, Network, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/admin/ExecutiveUI";
import { cn } from "@/lib/utils";

type EstadoIntegracao = "pronto_para_configurar" | "credenciais_presentes" | "planejado" | "base_incompleta";
type GrupoIntegracao = "comunicacao" | "pagamentos" | "crm" | "bancos";

type Integracao = {
  id: string;
  nome: string;
  grupo: GrupoIntegracao;
  estado: EstadoIntegracao;
  credenciaisConfiguradas: boolean;
  persistenciaPronta: boolean;
  conexaoLiveVerificada: false;
  detalhes: string;
  eventosRegistrados?: number;
};

type Payload = {
  integracoes: Integracao[];
  resumo: {
    total: number;
    prontosParaConfigurar: number;
    credenciaisPresentes: number;
    planejados: number;
    baseIncompleta: number;
    conexoesLiveVerificadas: number;
  };
  observacao: string;
};

const GRUPOS: Array<{ id: GrupoIntegracao; titulo: string; descricao: string }> = [
  { id: "comunicacao", titulo: "Comunicação", descricao: "Canais de comunicação com clientes e dispositivos." },
  { id: "pagamentos", titulo: "Pagamentos e financeiro", descricao: "Meios de pagamento e sincronização financeira externa." },
  { id: "crm", titulo: "CRM", descricao: "Entrada de vendas e origem comercial." },
  { id: "bancos", titulo: "Bancos", descricao: "Provedores bancários previstos para homologação futura." },
];

function iconFor(integracao: Integracao) {
  if (integracao.id === "web_push") return Bell;
  if (integracao.id === "mercado_pago") return CreditCard;
  if (integracao.id === "conta_azul") return Building2;
  if (integracao.id === "rd_station") return Network;
  return Landmark;
}

function statusMeta(estado: EstadoIntegracao) {
  if (estado === "credenciais_presentes") return {
    label: "Credenciais presentes",
    icon: KeyRound,
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  };
  if (estado === "pronto_para_configurar") return {
    label: "Pronto para configurar",
    icon: CheckCircle2,
    badge: "bg-success/10 text-success",
  };
  if (estado === "planejado") return {
    label: "Planejado",
    icon: Clock3,
    badge: "bg-clay/8 text-clay/55 dark:text-pearl/50",
  };
  return {
    label: "Base incompleta",
    icon: ShieldCheck,
    badge: "bg-alert/10 text-alert",
  };
}

async function carregarStatus(): Promise<Payload> {
  const response = await fetch("/api/admin/integrations/status", {
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = await response.json().catch(() => ({})) as Payload & { erro?: string };
  if (!response.ok) throw new Error(body.erro ?? "Não foi possível carregar o status das integrações.");
  return body;
}

export default function IntegracoesAdminPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  async function atualizar() {
    setLoading(true);
    setErro(null);
    try {
      setData(await carregarStatus());
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível carregar o status das integrações.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void atualizar(); }, []);

  const grupos = useMemo(() => GRUPOS.map((grupo) => ({
    ...grupo,
    itens: data?.integracoes.filter((item) => item.grupo === grupo.id) ?? [],
  })), [data]);

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        eyebrow="Infraestrutura"
        title="Integrações"
        description="Visão real da preparação técnica. Nenhum provedor externo é testado ou ativado por esta tela."
      />

      {erro && <div className="rounded-xl border border-alert/20 bg-alert/5 px-4 py-3 text-sm text-alert">{erro}</div>}

      <div className="grid gap-3 md:grid-cols-4">
        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-label text-clay/45">Mapeadas</p>
          <p className="mt-1 font-heading text-2xl text-burgundy dark:text-pearl">{data?.resumo.total ?? "—"}</p>
          <p className="mt-1 text-xs text-clay/50">Provedores previstos na arquitetura.</p>
        </Card>
        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-label text-clay/45">Prontas</p>
          <p className="mt-1 font-heading text-2xl text-burgundy dark:text-pearl">{data?.resumo.prontosParaConfigurar ?? "—"}</p>
          <p className="mt-1 text-xs text-clay/50">Base pronta, sem credencial live.</p>
        </Card>
        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-label text-clay/45">Credenciais</p>
          <p className="mt-1 font-heading text-2xl text-burgundy dark:text-pearl">{data?.resumo.credenciaisPresentes ?? "—"}</p>
          <p className="mt-1 text-xs text-clay/50">Presentes no backend, sem homologação.</p>
        </Card>
        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-label text-clay/45">Live verificada</p>
          <p className="mt-1 font-heading text-2xl text-burgundy dark:text-pearl">{data?.resumo.conexoesLiveVerificadas ?? 0}</p>
          <p className="mt-1 text-xs text-clay/50">Mantida em zero até homologação real.</p>
        </Card>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-burgundy/8 text-burgundy dark:bg-white/8 dark:text-pearl">
            <ShieldCheck className="h-4.5 w-4.5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-burgundy dark:text-pearl">Sem conexão automática nesta fase</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-clay/55 dark:text-pearl/45">
              O painel apenas lê configuração do backend e persistência interna. Não envia requisição de teste para Mercado Pago, Conta Azul, RD Station ou bancos.
            </p>
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void atualizar()} loading={loading}>
          <RefreshCw className="h-3.5 w-3.5" /> Atualizar status
        </Button>
      </Card>

      {loading && !data ? (
        <Card className="p-10 text-center text-sm text-clay/45">Carregando diagnóstico das integrações...</Card>
      ) : (
        grupos.map((grupo) => (
          <section key={grupo.id} className="space-y-2">
            <div>
              <h2 className="font-heading text-lg text-burgundy dark:text-pearl">{grupo.titulo}</h2>
              <p className="text-xs text-clay/50 dark:text-pearl/40">{grupo.descricao}</p>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {grupo.itens.map((integracao) => {
                const Icon = iconFor(integracao);
                const status = statusMeta(integracao.estado);
                const StatusIcon = status.icon;
                return (
                  <Card key={integracao.id} className="p-4">
                    <div className="flex items-start gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blush/70 text-burgundy dark:bg-white/7 dark:text-pearl">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-burgundy dark:text-pearl">{integracao.nome}</h3>
                          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-label", status.badge)}>
                            <StatusIcon className="h-3 w-3" /> {status.label}
                          </span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-clay/55 dark:text-pearl/45">{integracao.detalhes}</p>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                          <div className="rounded-xl bg-bloom/70 px-3 py-2 dark:bg-white/[0.035]">
                            <span className="flex items-center gap-1.5 text-clay/45 dark:text-pearl/40"><Database className="h-3 w-3" /> Persistência</span>
                            <strong className={cn("mt-1 block", integracao.persistenciaPronta ? "text-success" : "text-alert")}>{integracao.persistenciaPronta ? "Pronta" : "Incompleta"}</strong>
                          </div>
                          <div className="rounded-xl bg-bloom/70 px-3 py-2 dark:bg-white/[0.035]">
                            <span className="flex items-center gap-1.5 text-clay/45 dark:text-pearl/40"><KeyRound className="h-3 w-3" /> Credenciais</span>
                            <strong className="mt-1 block text-burgundy dark:text-pearl">{integracao.credenciaisConfiguradas ? "Presentes" : "Não configuradas"}</strong>
                          </div>
                        </div>
                        {typeof integracao.eventosRegistrados === "number" && (
                          <p className="mt-2 text-[10px] text-clay/40 dark:text-pearl/35">Registros internos existentes: {integracao.eventosRegistrados}</p>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
