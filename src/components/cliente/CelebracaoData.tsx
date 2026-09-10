"use client";

import { motion, AnimatePresence } from "framer-motion";
import { formatarDataLonga } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

export function CelebracaoData({
  data,
  nome,
  onFechar,
}: {
  data: string;
  nome: string;
  onFechar: () => void;
}) {
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-burgundy-dark px-4 py-6 sm:px-6 sm:py-10 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Elementos decorativos discretos, sem interferir na leitura. */}
        {Array.from({ length: 8 }).map((_, i) => (
          <motion.span
            key={i}
            aria-hidden="true"
            className="pointer-events-none absolute h-2 w-2 rounded-full bg-gold/55"
            style={{ left: `${(i * 37) % 100}%`, top: `${(i * 19) % 90}%` }}
            animate={{ y: [0, 18, 0], opacity: [0.15, 0.55, 0.15] }}
            transition={{
              duration: 4 + (i % 3),
              repeat: Infinity,
              delay: i * 0.35,
              ease: "easeInOut",
            }}
          />
        ))}

        <motion.div
          className="relative z-10 w-full max-w-xl overflow-hidden rounded-[30px] border border-rose/20 bg-burgundy px-6 py-8 text-center shadow-2xl sm:px-10 sm:py-10"
          initial={{ scale: 0.96, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mx-auto mb-6 h-px w-16 bg-gold/50" />

          <span className="block text-[0.68rem] font-medium uppercase tracking-[0.28em] text-gold sm:text-xs">
            {nome}, sua assinatura tem uma data
          </span>

          <h2 className="mx-auto mt-5 max-w-md font-heading text-[2.45rem] font-semibold leading-[1.05] text-cream sm:text-6xl">
            {formatarDataLonga(data)}
          </h2>

          <p className="mx-auto mt-6 max-w-md text-pretty text-[0.98rem] leading-7 text-cream/75 sm:text-lg sm:leading-8">
            Nesse encontro você assinará os termos cirúrgicos e sua data de
            cirurgia será definida e informada a você. A partir de hoje, cada
            dia te aproxima da sua melhor versão. Estamos com você até lá.
          </p>

          <Button variant="secondary" className="mt-8 w-full max-w-xs sm:mt-10" onClick={onFechar}>
            Ver minha agenda
          </Button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
