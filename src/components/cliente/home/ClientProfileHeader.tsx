interface ClientProfileHeaderProps {
  nomeCliente: string;
  procedimento: string | null;
  quantidadeParcelas: number | null;
  naoLidas: number;
  onAbrirNotificacoes: () => void;
}

function iniciais(nomeCompleto: string) {
  const partes = nomeCompleto.trim().split(/\s+/).filter(Boolean);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return `${primeira}${ultima}`.toUpperCase();
}

export function ClientProfileHeader({ nomeCliente, procedimento, quantidadeParcelas, naoLidas, onAbrirNotificacoes }: ClientProfileHeaderProps) {
  const planoLabel = quantidadeParcelas ? `Plano ${quantidadeParcelas}x` : "Plano";

  return (
    <>
      <header className="sl-home-header">
        <div className="sl-home-header-top">
          <div className="flex min-h-[34px] items-center">
            <img src="/brand/sra-luck-logo.png" alt="Sra. Luck" className="sl-home-logo" />
          </div>
          <button type="button" onClick={onAbrirNotificacoes} aria-label="Notificações" className="sl-home-bell">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M5.5 8.5a4.5 4.5 0 0 1 9 0v3.2l1.3 2.3H4.2l1.3-2.3z" />
              <path d="M8.4 16.2a1.8 1.8 0 0 0 3.2 0" />
            </svg>
            {naoLidas > 0 && <span className="sl-home-bell-dot" />}
          </button>
        </div>

        <div className="sl-profile-card">
          <div className="sl-profile-glow" />
          <div className="relative flex-none">
            <div className="sl-avatar">{iniciais(nomeCliente)}</div>
            <span className="sl-avatar-status" />
          </div>
          <div className="relative min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-[6px]">
              <div className="sl-profile-name">{nomeCliente}</div>
              <span className="sl-profile-badge">Minha área</span>
            </div>
            <div className="sl-profile-sub">
              {procedimento ?? "Procedimento a definir"} · {planoLabel}
            </div>
          </div>
        </div>
      </header>
      <div className="sl-header-fade" />
    </>
  );
}
