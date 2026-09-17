import type { BuilderDocument, BuilderNode, BuilderValidationIssue } from "./types";

const MIN_SIZE = 40;
const MAX_COORD = 5000;
const MAX_NODES = 250;
const FORBIDDEN_KEYS = new Set(["script", "javascript", "dangerouslysetinnerhtml", "rawcss", "cssText".toLowerCase()]);

function walkObject(value: unknown, path = "root", issues: BuilderValidationIssue[] = []) {
  if (!value || typeof value !== "object") return issues;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkObject(item, `${path}[${index}]`, issues));
    return issues;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      issues.push({ level: "error", code: "FORBIDDEN_CONFIG_KEY", message: `Configuração proibida em ${path}.${key}.` });
    }
    walkObject(item, `${path}.${key}`, issues);
  }
  return issues;
}

export function validateBuilderDocument(document: BuilderDocument): BuilderValidationIssue[] {
  const issues: BuilderValidationIssue[] = [];
  if (!document || document.schemaVersion !== 1) return [{ level: "error", code: "INVALID_SCHEMA", message: "Schema do Builder inválido." }];
  if (!/^[a-z0-9][a-z0-9-_]{1,79}$/i.test(document.id)) issues.push({ level: "error", code: "INVALID_DOCUMENT_ID", message: "ID do documento inválido." });
  const ids = new Set<string>();
  let nodeCount = 0;
  const visit = (nodes: BuilderNode[]) => {
    for (const node of nodes) {
      nodeCount += 1;
      if (!/^[a-z0-9][a-z0-9-_]{1,79}$/i.test(node.id)) issues.push({ level: "error", code: "INVALID_NODE_ID", nodeId: node.id, message: `ID inválido: ${node.id}` });
      if (ids.has(node.id)) issues.push({ level: "error", code: "DUPLICATE_NODE_ID", nodeId: node.id, message: `ID duplicado: ${node.id}` });
      ids.add(node.id);
      if (!node.name?.trim()) issues.push({ level: "error", code: "EMPTY_NODE_NAME", nodeId: node.id, message: "Componente sem nome." });
      for (const breakpoint of ["desktop", "tablet", "mobile"] as const) {
        const frame = node.frames?.[breakpoint];
        if (!frame) {
          issues.push({ level: "error", code: "MISSING_FRAME", nodeId: node.id, message: `Sem frame para ${breakpoint}.` });
          continue;
        }
        if (!Number.isFinite(frame.x) || !Number.isFinite(frame.y) || !Number.isFinite(frame.width) || !Number.isFinite(frame.height)) {
          issues.push({ level: "error", code: "INVALID_FRAME_NUMBER", nodeId: node.id, message: `Frame inválido em ${breakpoint}.` });
          continue;
        }
        if (frame.width < MIN_SIZE || frame.height < MIN_SIZE) issues.push({ level: "error", code: "FRAME_TOO_SMALL", nodeId: node.id, message: `Componente menor que ${MIN_SIZE}px em ${breakpoint}.` });
        if (Math.abs(frame.x) > MAX_COORD || Math.abs(frame.y) > MAX_COORD || frame.width > MAX_COORD || frame.height > MAX_COORD) issues.push({ level: "error", code: "FRAME_OUT_OF_RANGE", nodeId: node.id, message: `Geometria fora do limite em ${breakpoint}.` });
      }
      if (node.style?.radius > 64) issues.push({ level: "warning", code: "RADIUS_CLAMPED", nodeId: node.id, message: "Radius acima do limite será normalizado." });
      if (node.motion?.durationMs > 1200) issues.push({ level: "warning", code: "MOTION_LONG", nodeId: node.id, message: "Animação longa pode prejudicar a UX." });
      if (node.children?.length) visit(node.children);
    }
  };
  visit(document.nodes ?? []);
  if (nodeCount > MAX_NODES) issues.push({ level: "error", code: "TOO_MANY_NODES", message: `Máximo de ${MAX_NODES} componentes por documento.` });
  if (!nodeCount) issues.push({ level: "error", code: "EMPTY_DOCUMENT", message: "O documento não possui componentes." });
  return walkObject(document, "document", issues);
}

export function assertPublishableBuilderDocument(value: unknown): { document?: BuilderDocument; issues: BuilderValidationIssue[] } {
  if (!value || typeof value !== "object") return { issues: [{ level: "error", code: "INVALID_BODY", message: "Documento ausente." }] };
  const document = value as BuilderDocument;
  const issues = validateBuilderDocument(document);
  return { document, issues };
}
