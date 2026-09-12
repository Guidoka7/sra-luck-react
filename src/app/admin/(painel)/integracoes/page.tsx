"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, Building2, CheckCircle2, ChevronDown, Clock3, CreditCard, Database, Eye, EyeOff, KeyRound, Landmark, Network, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
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

type OrigemCampo = "painel" | "variavel_de_ambiente" | "nao_configurado";

type CampoCredencial = {
  chave: string;
  label: string;
  obrigatorio: boolean;
  origem: OrigemCampo;
  mascara: string | null;
  atualizadoEm: string | null;
};

type ProvedorCredenciais = { id: string; nome: string; grupo: GrupoIntegracao; campos: CampoCredencial[] };

type CredenciaisPayload = { provedores: ProvedorCredenciais[]; persistenciaPronta: boolean };

async function carregarCredenciais(): Promise<CredenciaisPayload> {
  const response = await fetch("/api/admin/integrations/credenciais", { cache: "no-store", credentials: "same-origin" });
  const body = await response.json().catch(() => ({})) as CredenciaisPayload & { erro?: string };
  if (!response.ok) throw new Error((body as { erro?: string }).erro ?? "Não foi possível carregar as credenciais.");
  return body;
}

function origemMeta(origem: OrigemCampo) {
  if (origem === "painel") return { label: "Configurado pelo painel", classe: "bg-success/10 text-success" };
  if (origem === "variavel_de_ambiente") return { label: "Configurado por variável de ambiente", classe: "bg-amber-500/10 text-amber-700 dark:text-amber-300" };
  return { label: "Não configurado", classe: "bg-clay/8 text-clay/55 dark:text-pearl/50" };
}

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

function FormularioCredenciais({ provedor, onSalvo }: { provedor: ProvedorCredenciais; onSalvo: () => void }) {
  const [valores, setValores] = useState<Record<string, string>>({});
  const [visiveis, setVisiveis] = useState<Record<string, boolean>>({});
  const [salvandoCampo, setSalvandoCampo] = useState<string | null>(null);
  const [erroCampo, setErroCampo] = useState<Record<string, string>>({});

  async function salvar(chave: string) {
    const valor = (valores[chave] || "").trim();
    if (!valor) return;
    setSalvandoCampo(chave);
    setErroCampo((atual) => ({ ...atual, [chave]: "" }));
    try {
      const response = await fetch("/api/admin/integrations/credenciais", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provedor: provedor.id, chave, valor }),
      });
      const body = await response.json().catch(() => ({})) as { erro?: string };
      if (!response.ok) throw new Error(body.erro ?? "Não foi possível salvar a credencial.");
      setValores((atual) => ({ ...atual, [chave]: "" }));
      onSalvo();
    } catch (error) {
      setErroCampo((atual) => ({ ...atual, [chave]: error instanceof Error ? error.message : "Não foi possível salvar a credencial." }));
    } finally {
      setSalvandoCampo(null);
    }
  }

  async function remover(chave: string) {
    setSalvandoCampo(chave);
    try {
      const response = await fetch("/api/admin/integrations/credenciais", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provedor: provedor.id, chave, remover: true }),
      });
      const body = await response.json().catch(() => ({})) as { erro?: string };
      if (!response.ok) throw new Error(body.erro ?? "Não foi possível remover a credencial.");
      onSalvo();
    } catch (error) {
      setErroCampo((atual) => ({ ...atual, [chave]: error instanceof Error ? error.message : "Não foi possível remover a credencial." }));
    } finally {
      setSalvandoCampo(null);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-rose/15 bg-bloom/40 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      {provedor.campos.map((campo) => {
        const origem = origemMeta(campo.origem);
        return (
          <div key={campo.chave} className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-[11px] font-semibold text-burgundy dark:text-pearl">
                {campo.label} {campo.obrigatorio && <span className="text-alert">*</span>}
              </label>
              <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-label", origem.classe)}>{origem.label}</span>
            </div>
            {campo.mascara && <p className="text-[11px] text-clay/45 dark:text-pearl/40">Valor salvo: {campo.mascara}</p>}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  type={visiveis[campo.chave] ? "text" : "password"}
                  value={valores[campo.chave] || ""}
                  onChange={(event) => setValores((atual) => ({ ...atual, [campo.chave]: event.target.value }))}
                  placeholder={campo.mascara ? "Substituir valor salvo..." : "Colar valor da credencial..."}
                  className="pr-10 text-sm"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setVisiveis((atual) => ({ ...atual, [campo.chave]: !atual[campo.chave] }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-clay/40 hover:text-clay/70"
                  aria-label="Mostrar valor"
                >
                  {visiveis[campo.chave] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button size="sm" variant="secondary" onClick={() => void salvar(campo.chave)} loading={salvandoCampo === campo.chave} disabled={!(valores[campo.chave] || "").trim()}>
                <Save className="h-3.5 w-3.5" /> Salvar
              </Button>
              {campo.origem === "painel" && (
                <Button size="sm" variant="ghost" onClick={() => void remover(campo.chave)} loading={salvandoCampo === campo.chave}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {erroCampo[campo.chave] && <p className="text-[11px] text-alert">{erroCampo[campo.chave]}</p>}
          </div>
        );
      })}
    </div>
  );
}

export default function IntegracoesAdminPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [credenciais, setCredenciais] = useState<CredenciaisPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<Record<string, boolean>>({});

  async function atualizarCredenciais() {
    try {
      setCredenciais(await carregarCredenciais());
    } catch {
      // Painel de status continua funcional mesmo se a leitura de credenciais falhar.
    }
  }

  async function atualizar() {
    setLoading(true);
    setErro(null);
    try {
      setData(await carregarStatus());
      await atualizarCredenciais();
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
              As credenciais podem ser configuradas em cada card abaixo — elas ficam cifradas no banco e passam a valer assim que salvas, sem precisar mexer em código.
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
                const provedorCredenciais = credenciais?.provedores.find((item) => item.id === integracao.id);
                const aberto = Boolean(expandido[integracao.id]);
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
                        {provedorCredenciais && (
                          <>
                            <button
                              type="button"
                              onClick={() => setExpandido((atual) => ({ ...atual, [integracao.id]: !atual[integracao.id] }))}
                              className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-burgundy hover:opacity-80 dark:text-pearl"
                            >
                              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", aberto && "rotate-180")} />
                              {aberto ? "Ocultar credenciais" : "Configurar credenciais"}
                            </button>
                            {aberto && (
                              credenciais?.persistenciaPronta ? (
                                <FormularioCredenciais provedor={provedorCredenciais} onSalvo={() => void atualizar()} />
                              ) : (
                                <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                                  A estrutura para salvar credenciais pelo painel ainda não foi aplicada neste ambiente (migration_035_credenciais_integracoes.sql).
                                </p>
                              )
                            )}
                          </>
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
