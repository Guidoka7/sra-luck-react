/**
 * Depois de um deploy, quem estava com o app aberto (ou com a versão anterior em
 * cache) pode pedir arquivos de build que já não existem. Em vez de mostrar a
 * tela de falha, recarrega uma única vez para buscar a versão nova.
 */
const CHAVE = "sra-luck-recarga-versao";
const INTERVALO_MS = 60_000;

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

/** Recarrega a página no máximo uma vez por minuto. Devolve true se recarregou. */
export function recarregarParaVersaoNova(): boolean {
  try {
    const ultima = Number(sessionStorage.getItem(CHAVE) || 0);
    if (Date.now() - ultima < INTERVALO_MS) return false;
    sessionStorage.setItem(CHAVE, String(Date.now()));
  } catch {
    // Sem sessionStorage: recarrega mesmo assim (o navegador já traz a versão nova).
  }
  window.location.reload();
  return true;
}

export function instalarRecargaDeVersao() {
  window.addEventListener("vite:preloadError", (evento) => {
    if (recarregarParaVersaoNova()) evento.preventDefault();
  });
}
