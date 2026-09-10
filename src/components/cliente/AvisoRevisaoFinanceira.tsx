"use client";

import { Clock3, ShieldCheck } from "lucide-react";

interface Props {
  status: "pendente" | "recusada" | null;
  observacao?: string | null;
}

export function AvisoRevisaoFinanceira({ status, observacao }: Props) {
  const recusada = status === "recusada";

  return (
    <section className="overflow-hidden rounded-2xl border border-gold/20 bg-gold/[0.055] shadow-[0_14px_40px_-28px_rgba(0,0,0,.25)]">
      <div className="flex items-start gap-3 p-3.5 sm:p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold">
          {recusada ? <ShieldCheck className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[0.58rem] font-bold uppercase tracking-[0.16em] text-gold">
            {recusada ? "Atenção ao levantamento financeiro" : "Levantamento financeiro em andamento"}
          </p>

          <h2 className="mt-1 font-heading text-sm font-semibold leading-tight text-burgundy">
            {recusada
              ? "Precisamos regularizar uma divergência antes da liberação"
              : "Estamos realizando seu levantamento financeiro"}
          </h2>

          <p className="mt-1.5 text-[0.72rem] leading-relaxed text-clay/65">
            {recusada
              ? "Identificamos uma divergência em uma ou mais parcelas. Confira as parcelas indicadas abaixo, faça o pagamento ou envie novamente o comprovante correto. Depois da regularização, realizaremos um novo levantamento financeiro."
              : "Você já atingiu o percentual necessário de parcelas. Nossa equipe está conferindo os pagamentos e comprovantes enviados. A agenda continua visível para a senhora, porém bloqueada até a conclusão da conferência."}
          </p>

          <div className="mt-3 flex items-center gap-2 rounded-xl border border-gold/15 bg-white/55 px-3 py-2.5 dark:bg-white/[0.035]">
            <Clock3 className="h-3.5 w-3.5 shrink-0 text-gold" />
            <p className="text-[0.67rem] font-semibold leading-relaxed text-burgundy">
              Prazo para o levantamento: <strong>até 5 dias úteis</strong>.
            </p>
          </div>

          {observacao && recusada && (
            <div className="mt-2 rounded-lg border border-alert/10 bg-alert/8 px-2.5 py-2">
              <p className="text-[0.62rem] font-semibold leading-relaxed text-alert">
                {observacao}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
