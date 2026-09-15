import { useEffect, useState } from "react";
import { toast } from "sonner";

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

function permissionAtual(): NotificationPermission | "unsupported" {
  return "Notification" in window ? Notification.permission : "unsupported";
}

export function ConfiguracoesApp({ onVoltar }: { onVoltar: () => void }) {
  const [instalado, setInstalado] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    const atualizar = () => {
      setInstalado(isStandalone());
      setPermission(permissionAtual());
    };

    atualizar();
    window.addEventListener("appinstalled", atualizar);
    window.addEventListener("sra-luck-pwa-installed", atualizar);
    window.addEventListener("sra-luck-push-updated", atualizar);
    window.addEventListener("focus", atualizar);
    document.addEventListener("visibilitychange", atualizar);

    return () => {
      window.removeEventListener("appinstalled", atualizar);
      window.removeEventListener("sra-luck-pwa-installed", atualizar);
      window.removeEventListener("sra-luck-push-updated", atualizar);
      window.removeEventListener("focus", atualizar);
      document.removeEventListener("visibilitychange", atualizar);
    };
  }, []);

  function instalarApp() {
    if (instalado) {
      toast.success("O aplicativo Sra. Luck já está instalado neste celular.");
      return;
    }
    window.dispatchEvent(new Event("sra-luck-pwa-install-request"));
  }

  function ativarNotificacoes() {
    if (!instalado) {
      toast.info("Instale o aplicativo primeiro. Depois, volte aqui para ativar as notificações.");
      window.dispatchEvent(new Event("sra-luck-pwa-install-request"));
      return;
    }

    if (permission === "granted") {
      toast.success("As notificações já estão permitidas neste celular.");
      return;
    }

    window.dispatchEvent(new Event("sra-luck-push-request"));
  }

  const notificacaoTexto =
    permission === "granted"
      ? "Ativadas"
      : permission === "denied"
        ? "Bloqueadas no celular"
        : permission === "unsupported"
          ? "Não suportadas neste navegador"
          : "Desativadas";

  return (
    <div className="sl-tab pb-6">
      <div className="px-[18px] pt-[calc(max(env(safe-area-inset-top),0px)+18px)]">
        <button type="button" onClick={onVoltar} className="flex items-center gap-[7px] text-[12px] font-normal text-[#6B1F2E]">
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.35"><path d="M9 3 5 7l4 4"/></svg>
          Mais
        </button>
        <div className="pt-[16px] font-heading text-[29px] font-semibold leading-[1.08] text-[#2E2422]">Configurações</div>
        <p className="pt-1 text-[12px] font-light leading-[1.45] text-[#8A7B77]">Instalação do aplicativo e permissões deste celular.</p>
      </div>

      <div className="grid gap-[10px] px-[18px] pt-5">
        <section className="rounded-[18px] border border-[#ECE2DF] bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[12.5px] font-medium text-[#4B3936]">Aplicativo Sra. Luck</div>
              <div className="pt-[3px] text-[10.5px] font-light text-[#8D7D79]">{instalado ? "Instalado neste celular" : "Ainda não instalado"}</div>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${instalado ? "bg-[#EAF5EE] text-[#3F7D5B]" : "bg-[#F7F0EE] text-[#8A6D67]"}`}>
              {instalado ? "Instalado" : "Pendente"}
            </span>
          </div>
          <button type="button" onClick={instalarApp} disabled={instalado} className="mt-4 w-full rounded-[11px] bg-[#6B1F2E] px-3 py-[11px] text-[10.8px] font-semibold text-white disabled:cursor-default disabled:opacity-45">
            {instalado ? "Aplicativo instalado" : "Instalar aplicativo"}
          </button>
        </section>

        <section className="rounded-[18px] border border-[#ECE2DF] bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[12.5px] font-medium text-[#4B3936]">Notificações</div>
              <div className="pt-[3px] text-[10.5px] font-light text-[#8D7D79]">{notificacaoTexto}</div>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${permission === "granted" ? "bg-[#EAF5EE] text-[#3F7D5B]" : permission === "denied" ? "bg-[#FBEBEA] text-[#8F2A25]" : "bg-[#F7F0EE] text-[#8A6D67]"}`}>
              {permission === "granted" ? "Ativas" : permission === "denied" ? "Bloqueadas" : "Pendentes"}
            </span>
          </div>
          <button type="button" onClick={ativarNotificacoes} disabled={permission === "granted" || permission === "unsupported"} className="mt-4 w-full rounded-[11px] border border-[#D9C6C1] bg-[#FFF9F8] px-3 py-[11px] text-[10.8px] font-semibold text-[#6B1F2E] disabled:cursor-default disabled:opacity-45">
            {permission === "granted" ? "Notificações ativadas" : permission === "denied" ? "Verificar permissão" : "Ativar notificações"}
          </button>
          {permission === "denied" && (
            <p className="pt-2 text-[9.8px] font-light leading-[1.45] text-[#9A7771]">A permissão foi bloqueada. Libere as notificações do Sra. Luck nas configurações do navegador/celular e toque novamente.</p>
          )}
        </section>
      </div>
    </div>
  );
}
