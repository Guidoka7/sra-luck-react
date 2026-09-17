import type { CSSProperties } from "react";
import type {
  BuilderBreakpoint,
  BuilderDocument,
  BuilderFrame,
  BuilderLayoutConfig,
  BuilderNode,
} from "./types";

const MIN_SIZE = 40;
const MAX_COORD = 5000;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function snapValue(value: number, step: number) {
  if (!step || step <= 1) return Math.round(value);
  return Math.round(value / step) * step;
}

export function normalizeFrame(frame: BuilderFrame, viewport: { width: number; height: number }): BuilderFrame {
  const width = clamp(frame.width, MIN_SIZE, viewport.width);
  const height = clamp(frame.height, MIN_SIZE, viewport.height);
  return {
    x: clamp(frame.x, 0, Math.max(0, viewport.width - width)),
    y: clamp(frame.y, 0, Math.max(0, viewport.height - height)),
    width,
    height,
    zIndex: clamp(Math.round(frame.zIndex || 1), 0, 999),
    hidden: Boolean(frame.hidden),
  };
}

export function getNodeFrame(document: BuilderDocument, node: BuilderNode, breakpoint: BuilderBreakpoint) {
  return normalizeFrame(node.frames[breakpoint], document.viewports[breakpoint]);
}

export function updateNode(
  document: BuilderDocument,
  nodeId: string,
  updater: (node: BuilderNode) => BuilderNode,
): BuilderDocument {
  const visit = (nodes: BuilderNode[]): BuilderNode[] => nodes.map((node) => {
    if (node.id === nodeId) return updater(node);
    if (!node.children?.length) return node;
    return { ...node, children: visit(node.children) };
  });
  return { ...document, updatedAt: new Date().toISOString(), nodes: visit(document.nodes) };
}

export function findNode(document: BuilderDocument, nodeId: string): BuilderNode | null {
  const stack = [...document.nodes];
  while (stack.length) {
    const node = stack.shift()!;
    if (node.id === nodeId) return node;
    if (node.children?.length) stack.unshift(...node.children);
  }
  return null;
}

export function moveNode(
  document: BuilderDocument,
  nodeId: string,
  breakpoint: BuilderBreakpoint,
  x: number,
  y: number,
  snap = 1,
) {
  return updateNode(document, nodeId, (node) => {
    const current = getNodeFrame(document, node, breakpoint);
    const next = normalizeFrame({ ...current, x: snapValue(x, snap), y: snapValue(y, snap) }, document.viewports[breakpoint]);
    return { ...node, frames: { ...node.frames, [breakpoint]: next } };
  });
}

export function resizeNode(
  document: BuilderDocument,
  nodeId: string,
  breakpoint: BuilderBreakpoint,
  width: number,
  height: number,
  snap = 1,
) {
  return updateNode(document, nodeId, (node) => {
    const current = getNodeFrame(document, node, breakpoint);
    const next = normalizeFrame({ ...current, width: snapValue(width, snap), height: snapValue(height, snap) }, document.viewports[breakpoint]);
    return { ...node, frames: { ...node.frames, [breakpoint]: next } };
  });
}

export function alignNode(
  document: BuilderDocument,
  nodeId: string,
  breakpoint: BuilderBreakpoint,
  align: "left" | "center-x" | "right" | "top" | "center-y" | "bottom",
) {
  const node = findNode(document, nodeId);
  if (!node) return document;
  const viewport = document.viewports[breakpoint];
  const frame = getNodeFrame(document, node, breakpoint);
  let x = frame.x;
  let y = frame.y;
  if (align === "left") x = 0;
  if (align === "center-x") x = (viewport.width - frame.width) / 2;
  if (align === "right") x = viewport.width - frame.width;
  if (align === "top") y = 0;
  if (align === "center-y") y = (viewport.height - frame.height) / 2;
  if (align === "bottom") y = viewport.height - frame.height;
  return moveNode(document, nodeId, breakpoint, x, y, 1);
}

export function reorderTopLevelNode(document: BuilderDocument, nodeId: string, direction: -1 | 1) {
  const index = document.nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) return document;
  const nextIndex = clamp(index + direction, 0, document.nodes.length - 1);
  if (nextIndex === index) return document;
  const nodes = [...document.nodes];
  const [node] = nodes.splice(index, 1);
  nodes.splice(nextIndex, 0, node);
  return { ...document, updatedAt: new Date().toISOString(), nodes };
}

function layoutStyle(layout: BuilderLayoutConfig): CSSProperties {
  if (layout.mode === "stack") {
    return {
      display: "flex",
      flexDirection: layout.direction,
      gap: layout.gap,
      alignItems: layout.align === "start" ? "flex-start" : layout.align === "end" ? "flex-end" : layout.align,
      justifyContent: layout.justify === "start" ? "flex-start" : layout.justify === "end" ? "flex-end" : layout.justify === "between" ? "space-between" : "center",
      padding: `${layout.paddingY}px ${layout.paddingX}px`,
    };
  }
  if (layout.mode === "grid") {
    return {
      display: "grid",
      gridTemplateColumns: `repeat(${clamp(layout.columns, 1, 12)}, minmax(0, 1fr))`,
      gap: layout.gap,
      alignItems: layout.align === "start" ? "start" : layout.align === "end" ? "end" : layout.align,
      justifyContent: layout.justify === "between" ? "space-between" : layout.justify,
      padding: `${layout.paddingY}px ${layout.paddingX}px`,
    };
  }
  return { position: "relative", padding: `${layout.paddingY}px ${layout.paddingX}px` };
}

export function nodeCanvasStyle(document: BuilderDocument, node: BuilderNode, breakpoint: BuilderBreakpoint): CSSProperties {
  const frame = getNodeFrame(document, node, breakpoint);
  const shadow = node.style.shadow === "none"
    ? "none"
    : node.style.shadow === "soft"
      ? "0 8px 24px rgba(54,28,35,.08)"
      : node.style.shadow === "medium"
        ? "0 14px 34px rgba(54,28,35,.13)"
        : "0 20px 50px rgba(54,28,35,.18)";
  const borderWidth = node.style.border === "none" ? 0 : clamp(node.style.borderWidth, 1, 4);
  return {
    position: "absolute",
    left: frame.x,
    top: frame.y,
    width: frame.width,
    height: frame.height,
    zIndex: frame.zIndex,
    display: frame.hidden ? "none" : undefined,
    borderRadius: clamp(node.style.radius, 0, 64),
    borderWidth,
    borderStyle: borderWidth ? "solid" : undefined,
    opacity: clamp(node.style.opacity, 0.1, 1),
    boxShadow: shadow,
    overflow: "hidden",
    ...layoutStyle(node.layout),
  };
}
