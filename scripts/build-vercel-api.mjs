import { build } from "esbuild";

await build({
  entryPoints: ["server/vercel-handler.ts"],
  outfile: "dist/server/vercel-handler.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "info",
});
