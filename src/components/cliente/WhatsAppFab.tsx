"use client";

import { motion } from "framer-motion";
import { MessageCircle } from "lucide-react";

interface WhatsAppFabProps {
  numero: string | null;
  mensagem?: string;
}

function normalizarNumero(numero: string) {
  const digitos = numero.replace(/\D/g, "");
  if (!digitos) return null;
  return digitos.length <= 11 ? `55${digitos}` : digitos;
}

/** Acesso fixo ao WhatsApp, sempre visível acima da navegação inferior. */
export function WhatsAppFab({
  numero,
  mensagem = "Olá! Estou na minha área de cliente e preciso de ajuda.",
}: WhatsAppFabProps) {
  const numeroWhatsApp = numero ? normalizarNumero(numero) : null;
  if (!numeroWhatsApp) return null;

  const href = `https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(mensagem)}`;

  return (
    <div className="pointer-events-none fixed bottom-[calc(max(env(safe-area-inset-bottom),0px)+78px)] left-1/2 z-[55] w-full max-w-[430px] -translate-x-1/2 px-4">
      <motion.a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        initial={{ opacity: 0, y: 8, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        whileTap={{ scale: 0.97 }}
        className="pointer-events-auto ml-auto flex h-11 w-fit items-center gap-2 rounded-full border border-[#A9E5B9] bg-[#25D366] px-4 text-[11px] font-semibold text-white shadow-[0_10px_28px_-12px_rgba(37,211,102,.72)]"
        aria-label="Falar com a equipe pelo WhatsApp"
      >
        <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.8} />
        <span>WhatsApp</span>
      </motion.a>
    </div>
  );
}
