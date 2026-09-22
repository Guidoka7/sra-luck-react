import { MoreHorizontal } from "lucide-react";

/** Botão fixo ao lado do sininho que abre a tela "Mais" (fora da barra inferior). */
export function MenuButton({ ativo, onClick }: { ativo: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Mais opções" aria-current={ativo ? "page" : undefined} className={`sl-menu-fixed ${ativo ? "active" : ""}`}>
      <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={1.8} />
    </button>
  );
}
