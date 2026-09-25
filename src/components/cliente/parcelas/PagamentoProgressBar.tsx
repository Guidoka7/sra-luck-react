import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronUp, Heart } from "lucide-react";
import { percentualNecessario } from "@/lib/utils";

export type ProgressoPagamento = {
  quantidade_parcelas: number | null;
  porcentagem_pagamento: number;
  parcelas_pagas: number;
};

function getProgressoCorClass(porcentagem: number, necessario: number) {
  if (porcentagem >= 100) return "bg-success";
  if (porcentagem >= necessario) return "bg-success/70";
  if (porcentagem >= necessario * 0.65) return "bg-gold";
  if (porcentagem >= necessario * 0.4) return "bg-gold/60";
  return "bg-clay/40";
}

function getMensagem(porcentagem: number, pagas: number, total: number, necessario: number) {
  if (porcentagem >= 100) return "🎉 Parabéns! Você desbloqueou sua agenda cirúrgica!";
  if (porcentagem >= necessario) return `✨ Sua agenda já está liberada (${porcentagem}%)! Faltam apenas ${total - pagas} parcelas para quitar o contrato.`;
  if (porcentagem >= necessario * 0.65) return `🎯 Você está em ${porcentagem}%. São necessários ${necessario}% para desbloquear sua agenda.`;
  return `Vamos lá! Você está em ${porcentagem}%. São necessários ${necessario}% para desbloquear sua agenda — envie seus comprovantes para acelerar.`;
}

export function PagamentoProgressBar({ procedimento, progresso }: { procedimento?: string | null; progresso: ProgressoPagamento }) {
  const [aberto, setAberto] = useState(false);

  const total = progresso.quantidade_parcelas || 0;
  const pagas = progresso.parcelas_pagas || 0;
  const porcentagem = Math.max(0, Math.min(100, Math.round(progresso.porcentagem_pagamento || 0)));
  const necessario = percentualNecessario(total);

  return (
    <div className="px-5 pt-[12px]">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="space-y-2.5">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-rose/10">
              <Heart className="h-3.5 w-3.5 fill-rose text-rose" />
            </span>
            <p className="min-w-0 text-[12.5px] font-semibold leading-[1.35] text-burgundy">
              {procedimento ? `Cada parcela aproxima você do seu grande sonho: ${procedimento}.` : "Cada parcela aproxima você do seu tão sonhado procedimento."}
            </p>
          </div>
          <span className="flex-none text-[18px] font-bold leading-none text-gold">{porcentagem}%</span>
        </div>

        <button type="button" onClick={() => setAberto((valor) => !valor)} className="w-full rounded-xl text-left">
          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-clay/20">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${porcentagem}%` }}
              transition={{ duration: 0.65 }}
              className={`h-full ${getProgressoCorClass(porcentagem, necessario)}`}
            />
          </div>
          <p className="mt-1.5 flex items-center justify-center gap-1 text-[10px] text-clay/50">
            {aberto ? "Ocultar acompanhamento" : "Ver acompanhamento"}
            {aberto ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </p>
        </button>

        <AnimatePresence initial={false}>
          {aberto && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="space-y-2 border-t border-clay/10 pt-2.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-clay/60"><strong className="text-burgundy">{pagas}</strong> de <strong>{total}</strong> parcelas pagas</span>
                  {porcentagem >= necessario && <span className="text-success">✓ Agenda liberada</span>}
                </div>
                <div className="rounded-lg bg-bloom/50 px-3 py-2 text-center text-[11px] leading-relaxed text-burgundy">
                  {getMensagem(porcentagem, pagas, total, necessario)}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
