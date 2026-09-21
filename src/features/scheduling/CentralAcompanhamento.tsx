import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { OverviewBoard } from "./OverviewBoard";
import { TermsAgendaTab } from "./TermsAgendaTab";
import { SurgeryAgendaTab } from "./SurgeryAgendaTab";
import { ClienteProcessDrawer } from "./ClienteProcessDrawer";

type Aba = "overview" | "terms" | "surgery";

/**
 * Central de acompanhamento (handoff V46). Três áreas: Visão geral (5 filas
 * operacionais), Termos e Cirurgia. Cada card/linha abre o mesmo drawer de
 * cliente (Processo/Perfil/Financeiro/Jornada). Dados reais via
 * `/api/admin/central/*` (worker/admin-agenda-central.ts) — nada aqui é
 * mock; regra de prazo/teto vive no backend (worker/surgery-release.ts +
 * migration_052_agenda_cirurgica_v46.sql).
 */
export function CentralAcompanhamento() {
  const searchParams = useSearchParams();
  const abaParam = searchParams.get("aba");
  const abaInicial: Aba = abaParam === "cirurgia" ? "surgery" : abaParam === "termos" ? "terms" : "overview";
  const [aba, setAba] = useState<Aba>(abaInicial);
  const [clienteAberto, setClienteAberto] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const tabs: { id: Aba; label: string }[] = [
    { id: "overview", label: "Visão geral" },
    { id: "terms", label: "Termos" },
    { id: "surgery", label: "Cirurgia" },
  ];

  return <div className="zip-admin">
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: "2px 2px 14px" }}>
      <div>
        <h1 style={{ fontSize: 27 }}>Central de acompanhamento</h1>
        <p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--soft)", maxWidth: "62ch" }}>
          Acompanhe todo o fluxo das clientes: elegibilidade, levantamento, termos, liberação financeira e cirurgia.
        </p>
      </div>
    </div>

    <div style={{ display: "flex", gap: 5, padding: 3, borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel)", width: "fit-content", maxWidth: "100%", overflow: "auto", marginBottom: 16 }}>
      {tabs.map((t) => {
        const on = aba === t.id;
        return <button key={t.id} onClick={() => setAba(t.id)} style={{ display: "flex", alignItems: "center", gap: 7, height: 31, padding: "0 15px", borderRadius: 9, border: on ? "1px solid var(--line)" : "1px solid transparent", background: on ? "var(--s0)" : "transparent", color: on ? "var(--ink)" : "var(--soft)", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>{t.label}</button>;
      })}
    </div>

    {aba === "overview" && <OverviewBoard key={`overview-${refreshKey}`} onAbrirCliente={(id) => setClienteAberto(id)} />}
    {aba === "terms" && <TermsAgendaTab key={`terms-${refreshKey}`} onAbrirCliente={(id) => setClienteAberto(id)} />}
    {aba === "surgery" && <SurgeryAgendaTab key={`surgery-${refreshKey}`} onAbrirCliente={(id) => setClienteAberto(id)} onConsultarProcesso={(id) => setClienteAberto(id)} />}

    {clienteAberto && <ClienteProcessDrawer clienteId={clienteAberto} onClose={() => setClienteAberto(null)} onChanged={() => setRefreshKey((k) => k + 1)} />}
  </div>;
}
