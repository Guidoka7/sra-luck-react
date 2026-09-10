import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";

export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    port: 5173,
    strictPort: true,
    hmr: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "next/navigation": path.resolve(__dirname, "src/shims/next-navigation.ts"),
      "next/link": path.resolve(__dirname, "src/shims/next-link.tsx"),
      "next/image": path.resolve(__dirname, "src/shims/next-image.tsx"),
    },
  },
});
