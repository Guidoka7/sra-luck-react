const OWNER_KEY = "sra-luck-profile-photo-owner-v1";
const CACHE_PREFIX = "sra-luck-profile-photo-cache-v1";

export type ProfilePhotoCache = {
  preview: string;
  versao: string;
};

function hash(valor: string) {
  let resultado = 2166136261;
  for (let i = 0; i < valor.length; i += 1) {
    resultado ^= valor.charCodeAt(i);
    resultado = Math.imul(resultado, 16777619);
  }
  return (resultado >>> 0).toString(36);
}

function ownerAtual() {
  try {
    return localStorage.getItem(OWNER_KEY) || "sessao-atual";
  } catch {
    return "sessao-atual";
  }
}

function chaveCache() {
  return `${CACHE_PREFIX}:${ownerAtual()}`;
}

export function definirDonoCacheFotoPerfil(cpf: string) {
  const digitos = cpf.replace(/\D/g, "");
  if (!digitos) return;
  try {
    localStorage.setItem(OWNER_KEY, hash(digitos));
  } catch {}
}

export function lerCacheFotoPerfil(): ProfilePhotoCache | null {
  try {
    const valor = localStorage.getItem(chaveCache());
    if (!valor) return null;
    const cache = JSON.parse(valor) as Partial<ProfilePhotoCache>;
    if (!cache.preview || !cache.versao) return null;
    return { preview: cache.preview, versao: cache.versao };
  } catch {
    return null;
  }
}

export function salvarCacheFotoPerfil(cache: ProfilePhotoCache) {
  try {
    localStorage.setItem(chaveCache(), JSON.stringify(cache));
  } catch {
    // Cache local indisponível não impede o uso da foto oficial do Supabase.
  }
}

export function removerCacheFotoPerfil() {
  try {
    localStorage.removeItem(chaveCache());
  } catch {}
}
