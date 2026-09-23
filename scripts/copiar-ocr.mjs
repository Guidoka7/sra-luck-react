#!/usr/bin/env node
/**
 * Copia os arquivos do OCR local (tesseract.js + modelo de português) para
 * public/vendor/ocr, servidos pelo próprio app — o navegador não baixa nada de
 * CDN de terceiros e nenhum documento sai do aparelho para ser lido.
 * Roda no prebuild/predev; a pasta de destino não é versionada.
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const raiz = new URL("..", import.meta.url).pathname;
const destino = join(raiz, "public/vendor/ocr");
mkdirSync(destino, { recursive: true });

const core = dirname(require.resolve("tesseract.js-core/package.json"));
const tesseract = dirname(require.resolve("tesseract.js/package.json"));
const por = dirname(require.resolve("@tesseract.js-data/por/package.json"));

const arquivos = [
  [join(tesseract, "dist/worker.min.js"), "worker.min.js"],
  [join(core, "tesseract-core-lstm.wasm.js"), "tesseract-core-lstm.wasm.js"],
  [join(core, "tesseract-core-simd-lstm.wasm.js"), "tesseract-core-simd-lstm.wasm.js"],
  [join(core, "tesseract-core-relaxedsimd-lstm.wasm.js"), "tesseract-core-relaxedsimd-lstm.wasm.js"],
  // Modelo LSTM inteiro (best_int): 1,4 MB compactado, bom equilíbrio para celular.
  [join(por, "4.0.0_best_int/por.traineddata.gz"), "por.traineddata.gz"],
];
for (const [origem, nome] of arquivos) {
  if (!existsSync(origem)) throw new Error(`Arquivo do OCR não encontrado: ${origem}`);
  copyFileSync(origem, join(destino, nome));
}
console.log(`OCR local: ${arquivos.length} arquivos em public/vendor/ocr`);
