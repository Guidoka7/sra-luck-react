/**
 * Depois de um deploy, quem estava com o app aberto (ou com a versão anterior em
 * cache) pode pedir arquivos de build que já não existem. Em vez de mostrar a
 * tela de falha, recarrega uma única vez para buscar a versão nova.
 */
const CHAVE = "sra-luck-recarga-versao";
let recarregouSemStorage = false;

function versaoDoDocumento(): string {
  // O script de entrada recebe um hash novo a cada build do Vite. Uma aba que
  // continua presa no mesmo build não deve entrar em um ciclo de recargas.
  return document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? "sem-script";
}

const PADROES = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
  /Loading (CSS )?chunk .* failed/i,
  /is not a valid JavaScript MIME type/i,
  /Expected a JavaScript(-or-Wasm)? module script/i,
];

export function ehFalhaDeVersao(erro: unknown) {
  const texto = erro instanceof Error ? `${erro.name} ${erro.message}` : String(erro ?? "");
  return PADROES.some((re) => re.test(texto));
}

/** Tenta recuperar apenas uma vez por versão de build nesta aba. */
export function recarregarParaVersaoNova(): boolean {
  try {
    const versao = versaoDoDocumento();
    if (sessionStorage.getItem(CHAVE) === versao) return false;
    sessionStorage.setItem(CHAVE, versao);
  } catch {
    if (recarregouSemStorage) return false;
    recarregouSemStorage = true;
  }
  window.location.reload();
  return true;
}

export function instalarRecargaDeVersao() {
  window.addEventListener("vite:preloadError", (evento) => {
    if (recarregarParaVersaoNova()) evento.preventDefault();
  });
}
