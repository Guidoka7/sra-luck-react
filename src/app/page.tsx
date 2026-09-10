import Link from "next/link";
import { LogoMark, Wordmark } from "@/components/ui/Logo";

export default function HomePage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-bloom px-6">
      <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-rose/10 blur-3xl animate-drift will-change-transform" />
      <div
        className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-burgundy/8 blur-3xl animate-drift will-change-transform"
        style={{ animationDelay: "2s" }}
      />

      <div className="relative z-10 flex flex-col items-center text-center animate-fadeUp">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[28px] border border-white/70 bg-white/85 shadow-card">
          <LogoMark className="h-10 w-10" />
        </div>
        <Wordmark />

        <p className="mt-8 max-w-xl text-balance text-lg leading-8 text-clay/72 sm:text-xl">
          Uma experiência elegante, acolhedora e intuitiva para conduzir cada etapa
          do agendamento com a sofisticação da identidade Sra. Luck.
        </p>

        <Link
          href="/login"
          className="mt-10 inline-flex items-center justify-center rounded-full bg-burgundy px-8 py-3.5 text-sm font-medium tracking-[0.18em] uppercase text-pearl shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:bg-burgundy-light"
        >
          Acessar minha agenda
        </Link>
      </div>

      <Link
        href="/admin/login"
        className="absolute bottom-6 text-xs tracking-label uppercase text-clay/35 transition-colors hover:text-burgundy/65"
      >
        Acesso administrativo
      </Link>
    </main>
  );
}
