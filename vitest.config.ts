import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mesmo alias `@` do vite.config.ts, para testar componentes que importam por ele.
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["worker/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
