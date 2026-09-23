import { ProfilePhotoPicker } from "@/components/cliente/ProfilePhotoPicker";
import { LOGO_SRC } from "@/assets/brand";

interface ClientProfileHeaderProps {
  nomeCliente: string;
  procedimento: string | null;
  quantidadeParcelas: number | null;
  percentualPago: number;
}

function iniciais(nomeCompleto: string) {
  const partes = nomeCompleto.trim().split(/\s+/).filter(Boolean);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return `${primeira}${ultima}`.toUpperCase();
}

export function ClientProfileHeader({
  nomeCliente,
  procedimento,
  quantidadeParcelas,
  percentualPago,
}: ClientProfileHeaderProps) {
  const planoLabel = quantidadeParcelas ? `Plano ${quantidadeParcelas}x` : "Plano";
  const percentual = Math.max(0, Math.min(100, Math.round(percentualPago)));

  return (
    <>
      <header className="sl-home-header">
        <div className="sl-home-header-top">
          <div className="flex min-h-[34px] items-center">
            <img src={LOGO_SRC} alt="Sra. Luck" className="sl-home-logo" />
          </div>
{/* Espaço do menu e do sininho fixos (MenuButton + NotificationBell), que ficam sobre este ponto. */}
          <span className="h-[34px] w-[76px] flex-none" aria-hidden="true" />
        </div>

        <div className="sl-profile-card">
          <div className="sl-profile-glow" />
          <ProfilePhotoPicker
            fallback={iniciais(nomeCliente)}
            avatarClassName="sl-avatar relative flex !h-[54px] !w-[54px] items-center justify-center overflow-hidden !text-[20px]"
            cameraClassName="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-[#6B1F2E] text-[#FBF7F5] shadow-sm"
            imageAlt="Foto de perfil"
          />

          <div className="relative min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-[6px]">
              <div className="sl-profile-name">{nomeCliente}</div>
              <span className="sl-profile-badge">Minha área</span>
            </div>

            <div className="mt-[4px] flex min-w-0 items-center gap-[6px]">
              <span className="min-w-0 truncate text-[10.8px] font-semibold uppercase tracking-[.055em] text-[#7D2434]">
                {procedimento ?? "Procedimento a definir"}
              </span>
              <span className="h-[3px] w-[3px] flex-none rounded-full bg-[#D8BFBA]" aria-hidden="true" />
              <span className="flex-none rounded-full border border-[#E8D6D1] bg-[#FBF3F1] px-[7px] py-[2px] text-[8.6px] font-semibold text-[#8E4C59]">
                {planoLabel}
              </span>
            </div>

            <div className="mt-[7px] flex items-center gap-[8px]" aria-label={`${percentual}% do plano concluído`}>
              <div className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-[#EFE2DE]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#6B1F2E] to-[#9A5361] transition-[width] duration-500 ease-out"
                  style={{ width: `${percentual}%` }}
                />
              </div>
              <span className="flex-none text-[8.8px] font-semibold tabular-nums text-[#8E6D67]">{percentual}%</span>
            </div>
          </div>
        </div>
      </header>
      <div className="sl-header-fade" />
    </>
  );
}
