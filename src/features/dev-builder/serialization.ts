import type { BuilderDocument } from "./types";

export function stableBuilderJson(document: BuilderDocument) {
  return JSON.stringify(document, null, 2) + "\n";
}
