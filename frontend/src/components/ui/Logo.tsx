import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-block h-10 w-10", className)}>
      <img
        src="/brand/sra-luck-mark.png"
        alt="Sra. Luck"
        className="h-full w-full object-contain drop-shadow-[0_4px_10px_rgba(122,38,50,0.22)]"
      />
    </span>
  );
}

interface WordmarkProps {
  className?: string;
  maxWidth?: number;
}

export function Wordmark({ className, maxWidth = 340 }: WordmarkProps) {
  return (
    <img
      src="/brand/sra-luck-logo.png"
      alt="Sra. Luck — Cirurgia Programada"
      width={1800}
      height={569}
      style={{ maxWidth }}
      className={cn(
        "h-auto w-full object-contain drop-shadow-[0_6px_18px_rgba(122,38,50,0.16)]",
        className
      )}
    />
  );
}
