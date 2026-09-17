import type { CSSProperties } from "react";
import type {
  BuilderBreakpoint,
  BuilderDocument,
  BuilderFrame,
  BuilderLayoutConfig,
  BuilderNode,
  BuilderResizeHandle,
} from "./types";

const MIN_SIZE = 40;

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
    aspectLocked: Boolean(frame.aspectLocked),
  };
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

export function findParentNode(document: BuilderDocument, nodeId: string): BuilderNode | null {
  const visit = (nodes: BuilderNode[], parent: BuilderNode | null): BuilderNode | null => {
    for (const node of nodes) {
      if (node.id === nodeId) return parent;
      if (node.children?.length) {
        const result = visit(node.children, node);
        if (result !== null) return result;
      }
    }
    return null;
  };
  return visit(document.nodes, null);
}

function nodeBounds(document: BuilderDocument, node: BuilderNode, breakpoint: BuilderBreakpoint) {
  const parent = findParentNode(document, node.id);
  if (!parent) return document.viewports[breakpoint];
  const parentFrame = parent.frames[breakpoint];
  return {
    width: Math.max(MIN_SIZE, parentFrame?.width ?? document.viewports[breakpoint].width),
    height: Math.max(MIN_SIZE, parentFrame?.height ?? document.viewports[breakpoint].height),
  };
}

export function getNodeFrame(document: BuilderDocument, node: BuilderNode, breakpoint: BuilderBreakpoint) {
  return normalizeFrame(node.frames[breakpoint], nodeBounds(document, node, breakpoint));
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

export function removeNode(document: BuilderDocument, nodeId: string): BuilderDocument {
  const visit = (nodes: BuilderNode[]): BuilderNode[] => nodes
    .filter((node) => node.id !== nodeId)
    .map((node) => node.children?.length ? { ...node, children: visit(node.children) } : node);
  return { ...document, updatedAt: new Date().toISOString(), nodes: visit(document.nodes) };
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
    const next = normalizeFrame(
      { ...current, x: snapValue(x, snap), y: snapValue(y, snap) },
      nodeBounds(document, node, breakpoint),
    );
    return { ...node, frames: { ...node.frames, [breakpoint]: next } };
  });
}

export function moveNodes(
  document: BuilderDocument,
  nodeIds: string[],
  breakpoint: BuilderBreakpoint,
  dx: number,
  dy: number,
  snap = 1,
) {
  return nodeIds.reduce((next, id) => {
    const node = findNode(next, id);
    if (!node || node.locked) return next;
    const frame = getNodeFrame(next, node, breakpoint);
    return moveNode(next, id, breakpoint, frame.x + dx, frame.y + dy, snap);
  }, document);
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
    const bounds = nodeBounds(document, node, breakpoint);
    let nextWidth = snapValue(width, snap);
    let nextHeight = snapValue(height, snap);
    if (current.aspectLocked) {
      const ratio = Math.max(.01, current.width / current.height);
      if (Math.abs(nextWidth - current.width) >= Math.abs(nextHeight - current.height)) nextHeight = nextWidth / ratio;
      else nextWidth = nextHeight * ratio;
    }
    const next = normalizeFrame({ ...current, width: nextWidth, height: nextHeight }, bounds);
    return { ...node, frames: { ...node.frames, [breakpoint]: next } };
  });
}

export function resizeNodeFromHandle(
  document: BuilderDocument,
  nodeId: string,
  breakpoint: BuilderBreakpoint,
  handle: BuilderResizeHandle,
  dx: number,
  dy: number,
  snap = 1,
) {
  const node = findNode(document, nodeId);
  if (!node || node.locked) return document;
  const frame = getNodeFrame(document, node, breakpoint);
  const bounds = nodeBounds(document, node, breakpoint);
  let x = frame.x;
  let y = frame.y;
  let width = frame.width;
  let height = frame.height;

  if (handle.includes("e")) width += dx;
  if (handle.includes("s")) height += dy;
  if (handle.includes("w")) { x += dx; width -= dx; }
  if (handle.includes("n")) { y += dy; height -= dy; }

  width = Math.max(MIN_SIZE, snapValue(width, snap));
  height = Math.max(MIN_SIZE, snapValue(height, snap));
  if (frame.aspectLocked) {
    const ratio = Math.max(.01, frame.width / frame.height);
    if (handle === "e" || handle === "w") height = width / ratio;
    else if (handle === "n" || handle === "s") width = height * ratio;
    else if (Math.abs(dx) >= Math.abs(dy)) height = width / ratio;
    else width = height * ratio;
  }

  if (handle.includes("w")) x = frame.x + frame.width - width;
  if (handle.includes("n")) y = frame.y + frame.height - height;
  const next = normalizeFrame({ ...frame, x: snapValue(x, snap), y: snapValue(y, snap), width, height }, bounds);
  return updateNode(document, nodeId, (current) => ({ ...current, frames: { ...current.frames, [breakpoint]: next } }));
}

export function alignNode(
  document: BuilderDocument,
  nodeId: string,
  breakpoint: BuilderBreakpoint,
  align: "left" | "center-x" | "right" | "top" | "center-y" | "bottom",
) {
  const node = findNode(document, nodeId);
  if (!node) return document;
  const viewport = nodeBounds(document, node, breakpoint);
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

export function alignNodes(
  document: BuilderDocument,
  nodeIds: string[],
  breakpoint: BuilderBreakpoint,
  align: "left" | "center-x" | "right" | "top" | "center-y" | "bottom",
) {
  const nodes = nodeIds.map((id) => findNode(document, id)).filter(Boolean) as BuilderNode[];
  if (nodes.length < 2) return document;
  const parentIds = new Set(nodes.map((node) => findParentNode(document, node.id)?.id ?? "root"));
  if (parentIds.size !== 1) return document;
  const frames = nodes.map((node) => getNodeFrame(document, node, breakpoint));
  const left = Math.min(...frames.map((f) => f.x));
  const right = Math.max(...frames.map((f) => f.x + f.width));
  const top = Math.min(...frames.map((f) => f.y));
  const bottom = Math.max(...frames.map((f) => f.y + f.height));
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  return nodes.reduce((next, node) => {
    const frame = getNodeFrame(next, node, breakpoint);
    let x = frame.x;
    let y = frame.y;
    if (align === "left") x = left;
    if (align === "center-x") x = centerX - frame.width / 2;
    if (align === "right") x = right - frame.width;
    if (align === "top") y = top;
    if (align === "center-y") y = centerY - frame.height / 2;
    if (align === "bottom") y = bottom - frame.height;
    return moveNode(next, node.id, breakpoint, x, y, 1);
  }, document);
}

export function distributeNodes(
  document: BuilderDocument,
  nodeIds: string[],
  breakpoint: BuilderBreakpoint,
  axis: "horizontal" | "vertical",
) {
  const nodes = nodeIds.map((id) => findNode(document, id)).filter(Boolean) as BuilderNode[];
  if (nodes.length < 3) return document;
  const parentIds = new Set(nodes.map((node) => findParentNode(document, node.id)?.id ?? "root"));
  if (parentIds.size !== 1) return document;
  const sorted = [...nodes].sort((a, b) => {
    const fa = getNodeFrame(document, a, breakpoint);
    const fb = getNodeFrame(document, b, breakpoint);
    return axis === "horizontal" ? fa.x - fb.x : fa.y - fb.y;
  });
  const first = getNodeFrame(document, sorted[0], breakpoint);
  const last = getNodeFrame(document, sorted[sorted.length - 1], breakpoint);
  const occupied = sorted.reduce((sum, node) => {
    const frame = getNodeFrame(document, node, breakpoint);
    return sum + (axis === "horizontal" ? frame.width : frame.height);
  }, 0);
  const span = axis === "horizontal"
    ? (last.x + last.width - first.x)
    : (last.y + last.height - first.y);
  const gap = Math.max(0, (span - occupied) / (sorted.length - 1));
  let cursor = axis === "horizontal" ? first.x : first.y;
  return sorted.reduce((next, node, index) => {
    const frame = getNodeFrame(next, node, breakpoint);
    if (index === 0) {
      cursor += axis === "horizontal" ? frame.width + gap : frame.height + gap;
      return next;
    }
    if (index === sorted.length - 1) return next;
    const moved = axis === "horizontal"
      ? moveNode(next, node.id, breakpoint, cursor, frame.y, 1)
      : moveNode(next, node.id, breakpoint, frame.x, cursor, 1);
    cursor += (axis === "horizontal" ? frame.width : frame.height) + gap;
    return moved;
  }, document);
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

export function setNodeLayer(document: BuilderDocument, nodeId: string, action: "front" | "back" | "forward" | "backward") {
  const node = findNode(document, nodeId);
  if (!node) return document;
  const siblings = findParentNode(document, nodeId)?.children ?? document.nodes;
  const zValues = siblings.map((item) => item.frames.desktop?.zIndex ?? 0);
  const min = Math.min(...zValues, 0);
  const max = Math.max(...zValues, 0);
  return updateNode(document, nodeId, (current) => {
    const frames = { ...current.frames };
    (Object.keys(frames) as BuilderBreakpoint[]).forEach((bp) => {
      const frame = frames[bp];
      const zIndex = action === "front" ? max + 1 : action === "back" ? Math.max(0, min - 1) : action === "forward" ? frame.zIndex + 1 : Math.max(0, frame.zIndex - 1);
      frames[bp] = { ...frame, zIndex: clamp(zIndex, 0, 999) };
    });
    return { ...current, frames };
  });
}

export function groupTopLevelNodes(document: BuilderDocument, nodeIds: string[], name = "Grupo") {
  const unique = [...new Set(nodeIds)];
  const selected = document.nodes.filter((node) => unique.includes(node.id) && !node.locked);
  if (selected.length < 2) return { document, groupId: null as string | null };
  const groupId = `group-${Date.now().toString(36)}`;
  const frames = {} as BuilderNode["frames"];
  const children = selected.map((node) => ({ ...node, frames: { ...node.frames } }));
  (["desktop", "tablet", "mobile"] as BuilderBreakpoint[]).forEach((bp) => {
    const current = selected.map((node) => getNodeFrame(document, node, bp));
    const left = Math.min(...current.map((f) => f.x));
    const top = Math.min(...current.map((f) => f.y));
    const right = Math.max(...current.map((f) => f.x + f.width));
    const bottom = Math.max(...current.map((f) => f.y + f.height));
    frames[bp] = { x: left, y: top, width: Math.max(MIN_SIZE, right - left), height: Math.max(MIN_SIZE, bottom - top), zIndex: Math.max(...current.map((f) => f.zIndex), 1) };
    children.forEach((child) => {
      const frame = child.frames[bp];
      child.frames[bp] = { ...frame, x: frame.x - left, y: frame.y - top };
    });
  });
  const group: BuilderNode = {
    id: groupId,
    name,
    kind: "container",
    templateId: "container-free-01",
    content: { title: name },
    frames,
    layout: { mode: "free", direction: "column", gap: 0, columns: 1, align: "stretch", justify: "start", paddingX: 0, paddingY: 0 },
    style: { radius: 12, shadow: "none", surface: "custom", border: "subtle", borderWidth: 1, opacity: 1, backgroundColor: "rgba(255,255,255,0.18)", borderColor: "#d8c9cd" },
    transform: { rotation: 0, scale: 1, skewX: 0, skewY: 0 },
    motion: { enter: "none", hover: "none", durationMs: 0, delayMs: 0 },
    children,
  };
  const remaining = document.nodes.filter((node) => !unique.includes(node.id));
  return { document: { ...document, updatedAt: new Date().toISOString(), nodes: [...remaining, group] }, groupId };
}

export function ungroupTopLevelNode(document: BuilderDocument, groupId: string) {
  const group = document.nodes.find((node) => node.id === groupId && node.kind === "container");
  if (!group?.children?.length) return { document, childIds: [] as string[] };
  const children = group.children.map((child) => ({ ...child, frames: { ...child.frames } }));
  (["desktop", "tablet", "mobile"] as BuilderBreakpoint[]).forEach((bp) => {
    const parentFrame = getNodeFrame(document, group, bp);
    children.forEach((child) => {
      const frame = child.frames[bp];
      child.frames[bp] = { ...frame, x: parentFrame.x + frame.x, y: parentFrame.y + frame.y, zIndex: Math.max(parentFrame.zIndex, frame.zIndex) };
    });
  });
  return {
    document: { ...document, updatedAt: new Date().toISOString(), nodes: [...document.nodes.filter((node) => node.id !== groupId), ...children] },
    childIds: children.map((child) => child.id),
  };
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
  const transform = node.transform ?? { rotation: 0, scale: 1, skewX: 0, skewY: 0 };
  const backgroundColor = node.style.surface === "custom" ? node.style.backgroundColor : undefined;
  const borderColor = node.style.border === "custom" ? node.style.borderColor : undefined;
  return {
    position: "absolute",
    left: frame.x,
    top: frame.y,
    width: frame.width,
    height: frame.height,
    zIndex: frame.zIndex,
    display: frame.hidden ? "none" : undefined,
    borderRadius: clamp(node.style.radius, 0, 999),
    borderWidth,
    borderStyle: borderWidth ? "solid" : undefined,
    borderColor,
    color: node.style.textColor,
    backgroundColor,
    opacity: clamp(node.style.opacity, 0.05, 1),
    boxShadow: shadow,
    backdropFilter: node.style.backdropBlur ? `blur(${clamp(node.style.backdropBlur, 0, 40)}px)` : undefined,
    transform: `rotate(${clamp(transform.rotation, -180, 180)}deg) scale(${clamp(transform.scale, .25, 3)}) skew(${clamp(transform.skewX, -30, 30)}deg, ${clamp(transform.skewY, -30, 30)}deg)`,
    transformOrigin: "center",
    overflow: node.kind === "container" ? "visible" : "hidden",
    ...layoutStyle(node.layout),
  };
}
