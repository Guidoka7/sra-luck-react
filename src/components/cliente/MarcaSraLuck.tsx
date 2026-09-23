/**
 * Logo da Sra. Luck integrada ao tema do app (topo das abas).
 *
 * Em vez de uma imagem com cores fixas, o símbolo e a assinatura são duas
 * máscaras em alta resolução (src/assets/brand/*-mascara.webp) pintadas com as
 * cores do tema (--marca-simbolo / --marca-assinatura em
 * src/styles/client-marca.css). Fica nítida em qualquer tela e acompanha o
 * modo claro e o escuro sem filtros. A silhueta do símbolo é vazada: mostra o
 * fundo da própria página.
 */
export function MarcaSraLuck({ className = "", alt = "Sra. Luck" }: { className?: string; alt?: string }) {
  return (
    <span role="img" aria-label={alt} className={`sl-marca ${className}`.trim()}>
      <span className="sl-marca__simbolo" aria-hidden="true" />
      <span className="sl-marca__assinatura" aria-hidden="true" />
    </span>
  );
}
