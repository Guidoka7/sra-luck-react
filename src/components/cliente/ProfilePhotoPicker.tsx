import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface ProfilePhotoPickerProps {
  fallback: string;
  outerClassName?: string;
  avatarClassName: string;
  cameraClassName: string;
  imageAlt?: string;
}

type FotoCache = { preview: string; versao: string };
type FotoAtualizada = { preview: string; versao: string };

const FOTO_URL = "/api/cliente/perfil/foto";
const EVENTO_FOTO = "sra-luck-profile-photo-updated";
const TAMANHO_MAXIMO_LADO = 1280;
const ALVO_BYTES = 900 * 1024;
const CACHE_PREFIX = "sra-luck-profile-photo-preview-v1";

function CameraIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="10" height="7.5" rx="2" />
      <circle cx="7" cy="7.7" r="2.1" />
      <path d="M4.2 4 5.1 2.8h3.8L9.8 4" />
    </svg>
  );
}

function hash(valor: string) {
  let resultado = 2166136261;
  for (let i = 0; i < valor.length; i += 1) {
    resultado ^= valor.charCodeAt(i);
    resultado = Math.imul(resultado, 16777619);
  }
  return (resultado >>> 0).toString(36);
}

function chaveCache(fallback: string) {
  return `${CACHE_PREFIX}:${hash(fallback.trim().toUpperCase() || "CLIENTE")}`;
}

function lerCache(chave: string): FotoCache | null {
  try {
    const valor = localStorage.getItem(chave);
    if (!valor) return null;
    const cache = JSON.parse(valor) as Partial<FotoCache>;
    if (!cache.preview || !cache.versao) return null;
    return { preview: cache.preview, versao: cache.versao };
  } catch {
    return null;
  }
}

function salvarCache(chave: string, cache: FotoCache) {
  try {
    localStorage.setItem(chave, JSON.stringify(cache));
  } catch {
    // O cache local é só uma otimização visual. A foto oficial continua no Supabase.
  }
}

function canvasParaBlob(canvas: HTMLCanvasElement, tipo: string, qualidade: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Não foi possível preparar esta imagem."));
    }, tipo, qualidade);
  });
}

function arquivoParaDataUrl(arquivo: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Não foi possível preparar a prévia da foto."));
    reader.readAsDataURL(arquivo);
  });
}

async function otimizarFoto(arquivo: Blob) {
  if (arquivo.type && !arquivo.type.startsWith("image/")) throw new Error("Escolha uma imagem válida.");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Não foi possível abrir esta foto. Escolha outra imagem da galeria.");
  }

  try {
    const maiorLado = Math.max(bitmap.width, bitmap.height);
    let escala = maiorLado > TAMANHO_MAXIMO_LADO ? TAMANHO_MAXIMO_LADO / maiorLado : 1;
    let qualidade = 0.9;
    let blob: Blob | null = null;

    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      const largura = Math.max(1, Math.round(bitmap.width * escala));
      const altura = Math.max(1, Math.round(bitmap.height * escala));
      const canvas = document.createElement("canvas");
      canvas.width = largura;
      canvas.height = altura;
      const contexto = canvas.getContext("2d", { alpha: false });
      if (!contexto) throw new Error("Não foi possível preparar esta foto.");
      contexto.drawImage(bitmap, 0, 0, largura, altura);
      blob = await canvasParaBlob(canvas, "image/webp", qualidade);
      if (blob.size <= ALVO_BYTES || Math.max(largura, altura) <= 900) break;
      qualidade = Math.max(0.68, qualidade - 0.06);
      escala *= 0.86;
    }

    if (!blob) throw new Error("Não foi possível preparar esta foto.");
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
  const chave = useMemo(() => chaveCache(fallback), [fallback]);
  const cacheInicial = useMemo(() => lerCache(chave), [chave]);
  const [preview, setPreview] = useState<string | null>(() => cacheInicial?.preview ?? null);
  const [fotoSrc, setFotoSrc] = useState(() => cacheInicial?.versao ? `${FOTO_URL}?v=${encodeURIComponent(cacheInicial.versao)}` : FOTO_URL);
  const [fotoDisponivel, setFotoDisponivel] = useState(true);
  const [fotoServidorPronta, setFotoServidorPronta] = useState(false);
  const [processando, setProcessando] = useState(false);

  useEffect(() => {
    const cache = lerCache(chave);
    setPreview(cache?.preview ?? null);
    setFotoSrc(cache?.versao ? `${FOTO_URL}?v=${encodeURIComponent(cache.versao)}` : FOTO_URL);
    setFotoDisponivel(true);
    setFotoServidorPronta(false);
  }, [chave]);

  useEffect(() => {
    const atualizarFoto = (evento: Event) => {
      const detalhe = (evento as CustomEvent<FotoAtualizada>).detail;
      if (!detalhe?.preview || !detalhe.versao) return;
      setPreview(detalhe.preview);
      setFotoDisponivel(true);
      setFotoServidorPronta(false);
      setFotoSrc(`${FOTO_URL}?v=${encodeURIComponent(detalhe.versao)}`);
    };
    window.addEventListener(EVENTO_FOTO, atualizarFoto);
    return () => window.removeEventListener(EVENTO_FOTO, atualizarFoto);
  }, []);

  useEffect(() => {
    if (preview) return;
    let ativo = true;

    // Clientes que já tinham foto ganham o preview persistente automaticamente.
    fetch(FOTO_URL, { cache: "no-cache", credentials: "same-origin" })
      .then((resposta) => (resposta.ok ? resposta.blob() : null))
      .then(async (blob) => {
        if (!ativo || !blob || !blob.type.startsWith("image/")) return;
        const otimizada = await otimizarFoto(blob);
        const previewLocal = await arquivoParaDataUrl(otimizada);
        if (!ativo) return;
        const versao = String(Date.now());
        salvarCache(chave, { preview: previewLocal, versao });
        setPreview(previewLocal);
      })
      .catch(() => {});

    return () => {
      ativo = false;
    };
  }, [chave, preview]);

  async function alterarFoto(arquivo: File, input: HTMLInputElement) {
    setProcessando(true);
    try {
      const otimizada = await otimizarFoto(arquivo);
      const previewLocal = await arquivoParaDataUrl(otimizada);

      const formData = new FormData();
      formData.append("foto", otimizada);
      const resposta = await fetch(FOTO_URL, { method: "POST", body: formData });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.erro ?? "Não foi possível atualizar sua foto.");

      const versao = String(corpo.versao ?? Date.now());
      salvarCache(chave, { preview: previewLocal, versao });
      setPreview(previewLocal);
      setFotoDisponivel(true);
      setFotoServidorPronta(false);
      setFotoSrc(`${FOTO_URL}?v=${encodeURIComponent(versao)}`);
      window.dispatchEvent(new CustomEvent<FotoAtualizada>(EVENTO_FOTO, { detail: { preview: previewLocal, versao } }));
      void fetch(FOTO_URL, { cache: "reload", credentials: "same-origin" }).catch(() => {});
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
        aria-label={processando ? "Preparando foto de perfil" : "Alterar foto de perfil"}
      >
        <span className={avatarClassName}>
          {fallback}
          {preview && <img src={preview} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />}
          {fotoDisponivel && (
            <img
              src={fotoSrc}
              alt={imageAlt}
              loading="eager"
              decoding="async"
              fetchPriority="high"
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ${fotoServidorPronta ? "opacity-100" : "opacity-0"}`}
              onLoad={() => {
                setFotoDisponivel(true);
                setFotoServidorPronta(true);
              }}
              onError={() => {
                setFotoDisponivel(false);
                setFotoServidorPronta(false);
              }}
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
