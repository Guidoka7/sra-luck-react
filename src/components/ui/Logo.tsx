import { cn } from "@/lib/utils";
import Image from "next/image";

/**
 * Marca oficial da Sra. Luck: a silhueta em círculo (duas "pétalas" + corpo
 * em negativo) extraída da arte oficial da marca — mesmo arquivo usado no
 * wordmark completo, isolado e com fundo transparente. Servida como PNG em
 * alta resolução (640px) via next/image, então fica nítida em qualquer
 * tamanho de uso no app (nunca aparenta ser um jpeg colado por cima).
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-block h-10 w-10", className)}>
      <Image
        src="/brand/sra-luck-mark.png"
        alt="Sra. Luck"
        fill
        sizes="160px"
        priority
        className="object-contain drop-shadow-[0_4px_10px_rgba(122,38,50,0.22)]"
      />
    </span>
  );
}

interface WordmarkProps {
  className?: string;
  /** Largura máxima do wordmark. Usa style inline (não classe Tailwind) de
   * propósito: esse projeto não tem tailwind-merge, então uma classe
   * max-w-[...] vinda de fora entraria em conflito com a classe padrão em
   * vez de substituí-la. */
  maxWidth?: number;
}

export function Wordmark({ className, maxWidth = 340 }: WordmarkProps) {
  return (
    <Image
      src="/brand/sra-luck-logo.png"
      alt="Sra. Luck — Cirurgia Programada"
      width={1800}
      height={569}
      priority
      style={{ maxWidth }}
      // Fundo transparente: a marca fica sobre o gradiente do app em vez de
      // dentro de uma caixa branca, que é o que fazia parecer uma foto/jpeg
      // colada em cima do design. O drop-shadow é o que dá o destaque, no
      // lugar do cartão — sutil o bastante pra não pesar, mas separa a marca
      // do fundo claro por trás dela.
      className={cn(
        "h-auto w-full object-contain drop-shadow-[0_6px_18px_rgba(122,38,50,0.16)]",
        className
      )}
    />
  );
}
