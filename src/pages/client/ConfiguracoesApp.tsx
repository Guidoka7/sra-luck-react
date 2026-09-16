import { useEffect, useState } from "react";
import { toast } from "sonner";
import { isPwaInstalada } from "@/lib/pwaInstall";

function permissionAtual(): NotificationPermission | "unsupported" {
  return "Notification" in window ? Notification.permission : "unsupported";
}

export function ConfiguracoesApp({ onVoltar }: { onVoltar: () => void }) {
  const [instalado, setInstalado] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [pushAtivo, setPushAtivo] = useState(false);
  const [checando, setChecando] = useState(true);
  const [fotoVersao, setFotoVersao] = useState(() => Date.now());
  const [fotoDisponivel, setFotoDisponivel] = useState(true);
  const [fotoProcessando, setFotoProcessando] = useState(false);

  useEffect(() => {
    let ativo = true;

    const atualizar = async () => {
      const instaladoAgora = isPwaInstalada();
      const permissaoAgora = permissionAtual();
      let assinaturaAtiva = false;

      if (
        permissaoAgora === "granted" &&
        "serviceWorker" in navigator &&
        "PushManager" in window
      ) {
        try {
          const registration = await navigator.serviceWorker.ready;
          assinaturaAtiva = Boolean(await registration.pushManager.getSubscription());
        } catch {
          assinaturaAtiva = false;
        }
      }

      if (!ativo) return;
      setInstalado(instaladoAgora);
      setPermission(permissaoAgora);
      setPushAtivo(assinaturaAtiva);
      setChecando(false);
    };

    void atualizar();
    const aoAtualizar = () => void atualizar();

    window.addEventListener("appinstalled", aoAtualizar);
    window.addEventListener("sra-luck-pwa-installed", aoAtualizar);
    window.addEventListener("sra-luck-push-updated", aoAtualizar);
    window.addEventListener("focus", aoAtualizar);
    document.addEventListener("visibilitychange", aoAtualizar);

    return () => {
      ativo = false;
      window.removeEventListener("appinstalled", aoAtualizar);
      window.removeEventListener("sra-luck-pwa-installed", aoAtualizar);
      window.removeEventListener("sra-luck-push-updated", aoAtualizar);
      window.removeEventListener("focus", aoAtualizar);
      document.removeEventListener("visibilitychange", aoAtualizar);
    };
  }, []);

  async function alterarFoto(arquivo: File, input: HTMLInputElement) {
    const tipos = ["image/jpeg", "image/png", "image/webp"];
    if (!tipos.includes(arquivo.type)) {
      toast.error("Escolha uma imagem JPG, PNG ou WEBP.");
      input.value = "";
      return;
    }
    if (arquivo.size > 5 * 1024 * 1024) {
      toast.error("A foto deve ter no máximo 5 MB.");
      input.value = "";
      return;
    }

    setFotoProcessando(true);
    try {
      const formData = new FormData();
      formData.append("foto", arquivo);
      const resposta = await fetch("/api/cliente/perfil/foto", { method: "POST", body: formData });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.erro ?? "Não foi possível atualizar sua foto.");

      setFotoDisponivel(true);
      setFotoVersao(Date.now());
      window.dispatchEvent(new Event("sra-luck-profile-photo-updated"));
      toast.success("Foto de perfil atualizada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar sua foto.");
    } finally {
      setFotoProcessando(false);
      input.value = "";
    }
  }

  async function removerFoto() {
    if (fotoProcessando) return;
    setFotoProcessando(true);
    try {
      const resposta = await fetch("/api/cliente/perfil/foto", { method: "DELETE" });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.erro ?? "Não foi possível remover sua foto.");

      setFotoDisponivel(false);
      setFotoVersao(Date.now());
      window.dispatchEvent(new Event("sra-luck-profile-photo-updated"));
      toast.success("Foto de perfil removida.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível remover sua foto.");
    } finally {
      setFotoProcessando(false);
    }
  }

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

    if (pushAtivo) {
      toast.success("As notificações já estão ativas neste celular.");
      return;
    }

    window.dispatchEvent(new Event("sra-luck-push-request"));
  }

  const notificacaoTexto = pushAtivo
    ? "Ativas e registradas"
    : permission === "granted"
      ? "Permissão concedida; falta concluir a ativação"
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
        <p className="pt-1 text-[12px] font-light leading-[1.45] text-[#8A7B77]">Perfil, aplicativo e permissões deste celular.</p>
      </div>

      <div className="grid gap-[10px] px-[18px] pt-5">
        <section className="rounded-[18px] border border-[#E8D9D5] bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="relative flex h-[62px] w-[62px] flex-none items-center justify-center overflow-hidden rounded-full border-2 border-white bg-[#F2E4E1] text-[#8A5C64] shadow-[0_0_0_1px_#DFC8C3,0_4px_12px_rgba(76,39,43,.08)]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h3l1.4-2h7.2L17 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/></svg>
              {fotoDisponivel && (
                <img
                  src={`/api/cliente/perfil/foto?v=${fotoVersao}`}
                  alt="Sua foto de perfil"
                  className="absolute inset-0 h-full w-full object-cover"
                  onLoad={() => setFotoDisponivel(true)}
                  onError={() => setFotoDisponivel(false)}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold text-[#4B3936]">Foto de perfil</div>
              <div className="pt-[3px] text-[10.5px] font-light leading-[1.45] text-[#8D7D79]">Personalize sua área com uma foto. JPG, PNG ou WEBP de até 5 MB.</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <label className={`inline-flex cursor-pointer items-center rounded-[10px] bg-[#6B1F2E] px-3 py-[8px] text-[10px] font-semibold text-white ${fotoProcessando ? "pointer-events-none opacity-50" : ""}`}>
                  {fotoProcessando ? "Atualizando..." : fotoDisponivel ? "Alterar foto" : "Adicionar foto"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    disabled={fotoProcessando}
                    onChange={(event) => {
                      const arquivo = event.currentTarget.files?.[0];
                      if (arquivo) void alterarFoto(arquivo, event.currentTarget);
                    }}
                  />
                </label>
                {fotoDisponivel && (
                  <button type="button" onClick={() => void removerFoto()} disabled={fotoProcessando} className="rounded-[10px] border border-[#E2D1CD] bg-[#FFF9F8] px-3 py-[8px] text-[10px] font-semibold text-[#7D2434] disabled:opacity-45">
                    Remover
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[18px] border border-[#ECE2DF] bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[12.5px] font-medium text-[#4B3936]">Aplicativo Sra. Luck</div>
              <div className="pt-[3px] text-[10.5px] font-light text-[#8D7D79]">{checando ? "Verificando..." : instalado ? "Instalado neste celular" : "Ainda não instalado"}</div>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${instalado ? "bg-[#EAF5EE] text-[#3F7D5B]" : "bg-[#F7F0EE] text-[#8A6D67]"}`}>
              {instalado ? "Instalado" : "Pendente"}
            </span>
          </div>
          <button type="button" onClick={instalarApp} disabled={instalado || checando} className="mt-4 w-full rounded-[11px] bg-[#6B1F2E] px-3 py-[11px] text-[10.8px] font-semibold text-white disabled:cursor-default disabled:opacity-45">
            {instalado ? "Aplicativo instalado" : "Instalar aplicativo"}
          </button>
        </section>

        <section className="rounded-[18px] border border-[#ECE2DF] bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[12.5px] font-medium text-[#4B3936]">Notificações</div>
              <div className="pt-[3px] text-[10.5px] font-light text-[#8D7D79]">{checando ? "Verificando..." : notificacaoTexto}</div>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${pushAtivo ? "bg-[#EAF5EE] text-[#3F7D5B]" : permission === "denied" ? "bg-[#FBEBEA] text-[#8F2A25]" : "bg-[#F7F0EE] text-[#8A6D67]"}`}>
              {pushAtivo ? "Ativas" : permission === "denied" ? "Bloqueadas" : "Pendentes"}
            </span>
          </div>
          <button type="button" onClick={ativarNotificacoes} disabled={pushAtivo || permission === "unsupported" || checando} className="mt-4 w-full rounded-[11px] border border-[#D9C6C1] bg-[#FFF9F8] px-3 py-[11px] text-[10.8px] font-semibold text-[#6B1F2E] disabled:cursor-default disabled:opacity-45">
            {pushAtivo ? "Notificações ativadas" : permission === "denied" ? "Verificar permissão" : permission === "granted" ? "Concluir ativação" : "Ativar notificações"}
          </button>
          {permission === "denied" && (
            <p className="pt-2 text-[9.8px] font-light leading-[1.45] text-[#9A7771]">A permissão foi bloqueada. Libere as notificações do Sra. Luck nas configurações do navegador/celular e toque novamente.</p>
          )}
        </section>
      </div>
    </div>
  );
}
