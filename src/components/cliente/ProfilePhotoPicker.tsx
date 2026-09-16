import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface ProfilePhotoPickerProps {
  fallback: string;
  outerClassName?: string;
  avatarClassName: string;
  cameraClassName: string;
  imageAlt?: string;
}

const FOTO_URL = "/api/cliente/perfil/foto";
const EVENTO_FOTO = "sra-luck-profile-photo-updated";
const TAMANHO_MAXIMO_LADO = 1280;
const ALVO_BYTES = 900 * 1024;

function CameraIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="10" height="7.5" rx="2" />
      <circle cx="7" cy="7.7" r="2.1" />
      <path d="M4.2 4 5.1 2.8h3.8L9.8 4" />
    </svg>
  );
}

function canvasParaBlob(canvas: HTMLCanvasElement, tipo: string, qualidade: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Não foi possível preparar esta imagem."));
    }, tipo, qualidade);
  });
}

async function otimizarFoto(arquivo: File) {
  if (!arquivo.type.startsWith("image/")) throw new Error("Escolha uma imagem válida.");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(arquivo);
  } catch {
    throw new Error("Não foi possível abrir esta foto. Escolha outra imagem da galeria.");
  }

  try {
    const maiorLado = Math.max(bitmap.width, bitmap.height);
    const escala = maiorLado > TAMANHO_MAXIMO_LADO ? TAMANHO_MAXIMO_LADO / maiorLado : 1;
    const largura = Math.max(1, Math.round(bitmap.width * escala));
    const altura = Math.max(1, Math.round(bitmap.height * escala));
    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const contexto = canvas.getContext("2d");
    if (!contexto) throw new Error("Não foi possível preparar esta foto.");

    contexto.drawImage(bitmap, 0, 0, largura, altura);

    let qualidade = 0.9;
    let blob = await canvasParaBlob(canvas, "image/webp", qualidade);
    while (blob.size > ALVO_BYTES && qualidade > 0.56) {
      qualidade -= 0.07;
      blob = await canvasParaBlob(canvas, "image/webp", qualidade);
    }

    const tipoSaida = blob.type === "image/png" || blob.type === "image/jpeg" || blob.type === "image/webp" ? blob.type : "image/webp";
    const extensao = tipoSaida === "image/png" ? "png" : tipoSaida === "image/jpeg" ? "jpg" : "webp";
    return new File([blob], `foto-perfil.${extensao}`, { type: tipoSaida, lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

export function ProfilePhotoPicker({
  fallback,
  outerClassName = "relative flex-none",
  avatarClassName,
  cameraClassName,
  imageAlt = "Foto de perfil",
}: ProfilePhotoPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);
  const [fotoSrc, setFotoSrc] = useState(FOTO_URL);
  const [fotoDisponivel, setFotoDisponivel] = useState(true);
  const [processando, setProcessando] = useState(false);

  useEffect(() => {
    const atualizarFoto = (evento: Event) => {
      const versao = (evento as CustomEvent<{ versao?: number }>).detail?.versao ?? Date.now();
      setFotoDisponivel(true);
      setFotoSrc(`${FOTO_URL}?v=${versao}`);
    };
    window.addEventListener(EVENTO_FOTO, atualizarFoto);
    return () => {
      window.removeEventListener(EVENTO_FOTO, atualizarFoto);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  async function alterarFoto(arquivo: File, input: HTMLInputElement) {
    setProcessando(true);
    const fotoAnterior = fotoSrc;
    const disponivelAnterior = fotoDisponivel;

    try {
      const otimizada = await otimizarFoto(arquivo);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = URL.createObjectURL(otimizada);
      setFotoDisponivel(true);
      setFotoSrc(previewRef.current);

      const formData = new FormData();
      formData.append("foto", otimizada);
      const resposta = await fetch(FOTO_URL, { method: "POST", body: formData });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.erro ?? "Não foi possível atualizar sua foto.");

      const versao = typeof corpo.versao === "number" ? corpo.versao : Date.now();
      window.dispatchEvent(new CustomEvent(EVENTO_FOTO, { detail: { versao } }));

      // Aquece a URL estável no cache privado do navegador. Assim, no próximo
      // reload o avatar pode ser desenhado imediatamente enquanto o servidor revalida.
      void fetch(FOTO_URL, { cache: "reload", credentials: "same-origin" }).catch(() => {});
      toast.success("Foto de perfil atualizada.");
    } catch (error) {
      setFotoSrc(fotoAnterior);
      setFotoDisponivel(disponivelAnterior);
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
              src={fotoSrc}
              alt={imageAlt}
              loading="eager"
              decoding="sync"
              fetchPriority="high"
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
        accept="image/*"
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
