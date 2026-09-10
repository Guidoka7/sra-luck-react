import { Heart, Sparkles } from "lucide-react";

interface CardMotivacionalProps {
  procedimento?: string | null;
}

export function CardMotivacional({ procedimento }: CardMotivacionalProps) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-gold/25 bg-gradient-to-br from-white via-blush/40 to-white p-6 shadow-card sm:p-8">
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gold/10 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-12 -left-8 h-32 w-32 rounded-full bg-rose/10 blur-2xl" />

      <div className="relative flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-gold/15">
          <Sparkles className="h-4 w-4 text-gold" />
        </span>
        <div>
          <p className="text-sm leading-relaxed text-clay/80 sm:text-[0.95rem]">
            Você está cada vez mais perto de realizar o seu sonho. Sua próxima
            etapa é a{" "}
            <span className="font-heading font-semibold text-burgundy">
              Assinatura dos Termos Cirúrgicos
            </span>
            , um dos momentos mais importantes do seu processo.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-clay/80 sm:text-[0.95rem]">
            Escolha abaixo a melhor data para esse encontro. É nele que sua{" "}
            <span className="font-heading font-semibold text-burgundy">
              data de cirurgia
            </span>{" "}
            será definida e informada a você.
          </p>
          {procedimento && (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-rose/10 bg-white/65 px-3 py-2.5 text-sm text-clay/70">
              <Heart className="h-4 w-4 flex-none text-rose" />
              <p>
                Cada parcela aproxima você do seu procedimento: {" "}
                <span className="font-semibold text-burgundy">{procedimento}</span>.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
