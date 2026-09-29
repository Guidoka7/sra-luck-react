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
  recarregando = true;
  window.location.reload();
  return true;
}

let recarregando = false;

/** true depois que a recarga para a versão nova foi pedida nesta aba. */
export function recargaEmAndamento() {
  return recarregando;
}

/**
 * Quando a recarga é pedida (vite:preloadError + preventDefault), o Vite resolve o import()
 * da rota com `undefined` em vez de falhar. React.lazy lia `.default` de undefined e a tela
 * quebrava ("Cannot read properties of undefined (reading 'default')" em /admin/financeiro,
 * 28/09). Aqui a rota fica carregando até a página recarregar; sem recarga, o erro sobe.
 */
export async function moduloDaRota<M>(carregar: () => Promise<M>): Promise<M> {
  const modulo = await carregar();
  if (modulo) return modulo;
  if (recarregando) return new Promise<M>(() => undefined);
  throw new Error("Failed to fetch dynamically imported module");
}

export function instalarRecargaDeVersao() {
  window.addEventListener("vite:preloadError", (evento) => {
    if (recarregarParaVersaoNova()) evento.preventDefault();
  });
}
