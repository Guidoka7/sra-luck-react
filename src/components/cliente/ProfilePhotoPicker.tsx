import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface ProfilePhotoPickerProps {
  fallback: string;
  outerClassName?: string;
  avatarClassName: string;
  cameraClassName: string;
  imageAlt?: string;
}

function CameraIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="10" height="7.5" rx="2" />
      <circle cx="7" cy="7.7" r="2.1" />
      <path d="M4.2 4 5.1 2.8h3.8L9.8 4" />
    </svg>
  );
}

export function ProfilePhotoPicker({
  fallback,
  outerClassName = "relative flex-none",
  avatarClassName,
  cameraClassName,
  imageAlt = "Foto de perfil",
}: ProfilePhotoPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fotoVersao, setFotoVersao] = useState(() => Date.now());
  const [fotoDisponivel, setFotoDisponivel] = useState(true);
  const [processando, setProcessando] = useState(false);

  useEffect(() => {
    const atualizarFoto = () => {
      setFotoDisponivel(true);
      setFotoVersao(Date.now());
    };
    window.addEventListener("sra-luck-profile-photo-updated", atualizarFoto);
    return () => window.removeEventListener("sra-luck-profile-photo-updated", atualizarFoto);
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

    setProcessando(true);
    try {
      const formData = new FormData();
      formData.append("foto", arquivo);
      const resposta = await fetch("/api/cliente/perfil/foto", { method: "POST", body: formData });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.erro ?? "Não foi possível atualizar sua foto.");

      window.dispatchEvent(new Event("sra-luck-profile-photo-updated"));
      toast.success("Foto de perfil atualizada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar sua foto.");
    } finally {
      setProcessando(false);
      input.value = "";
    }
  }

  return (
    <div className={outerClassName}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={processando}
        className="relative block rounded-full disabled:cursor-wait"
        aria-label={processando ? "Atualizando foto de perfil" : "Alterar foto de perfil"}
      >
        <span className={avatarClassName}>
          {fallback}
          {fotoDisponivel && (
            <img
              src={`/api/cliente/perfil/foto?v=${fotoVersao}`}
              alt={imageAlt}
              className="absolute inset-0 h-full w-full object-cover"
              onLoad={() => setFotoDisponivel(true)}
              onError={() => setFotoDisponivel(false)}
            />
          )}
        </span>
        <span className={cameraClassName} aria-hidden="true">
          {processando ? <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-current" /> : <CameraIcon />}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={processando}
        onChange={(event) => {
          const arquivo = event.currentTarget.files?.[0];
          if (arquivo) void alterarFoto(arquivo, event.currentTarget);
        }}
      />
    </div>
  );
}
