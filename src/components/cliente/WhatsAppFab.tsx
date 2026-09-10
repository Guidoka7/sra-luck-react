"use client";

import { motion } from "framer-motion";
import { MessageCircle } from "lucide-react";

interface WhatsAppFabProps {
  numero: string | null;
  mensagem?: string;
}

/** Botão flutuante que abre uma conversa de WhatsApp com o número configurado pelo admin. */
export function WhatsAppFab({
  numero,
  mensagem = "Olá! Estou na minha área de cliente e preciso de ajuda.",
}: WhatsAppFabProps) {
  if (!numero) return null;

  const href = `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;

  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, scale: 0.8, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ scale: 1.06, y: -2 }}
      whileTap={{ scale: 0.95 }}
      className="fixed z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_16px_36px_-14px_rgba(37,211,102,0.7)] bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] right-[calc(env(safe-area-inset-right)+1.25rem)] sm:bottom-[calc(env(safe-area-inset-bottom)+1.75rem)] sm:right-[calc(env(safe-area-inset-right)+1.75rem)]"
      aria-label="Falar no WhatsApp"
    >
      <MessageCircle className="h-6 w-6" />
      <span className="absolute -left-2 -top-2 h-3.5 w-3.5 animate-ping rounded-full bg-[#25D366]/70" />
    </motion.a>
  );
}
