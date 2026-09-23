"use client";

import { motion } from "framer-motion";

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
        className="pointer-events-auto ml-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_10px_26px_-10px_rgba(37,211,102,.75)] ring-1 ring-white/40"
        aria-label="Falar com a equipe pelo WhatsApp"
        title="Falar com a equipe pelo WhatsApp"
      >
        <svg viewBox="0 0 24 24" className="h-[26px] w-[26px]" fill="currentColor" aria-hidden="true">
          <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35Z" />
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91A9.85 9.85 0 0 0 12.04 2Zm0 18.15h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.23 8.24c0 4.54-3.7 8.23-8.23 8.23Z" />
        </svg>
      </motion.a>
    </div>
  );
}
