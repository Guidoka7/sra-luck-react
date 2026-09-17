export type BuilderBreakpoint = "desktop" | "tablet" | "mobile";
export type BuilderNodeKind = "container" | "card" | "list" | "text" | "button" | "kpi" | "navigation";
export type BuilderLayoutMode = "free" | "stack" | "grid";
export type BuilderDirection = "row" | "column";
export type BuilderAlign = "start" | "center" | "end" | "stretch";
export type BuilderJustify = "start" | "center" | "end" | "between";
export type BuilderSurface = "default" | "soft" | "brand" | "brand-soft" | "success" | "warning" | "danger";
export type BuilderShadow = "none" | "soft" | "medium" | "strong";
export type BuilderBorder = "none" | "subtle" | "default" | "strong";
export type BuilderMotionPreset = "none" | "fade" | "fade-up" | "scale-soft" | "lift";

export interface BuilderFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  hidden?: boolean;
}

export interface BuilderLayoutConfig {
  mode: BuilderLayoutMode;
  direction: BuilderDirection;
  gap: number;
  columns: number;
  align: BuilderAlign;
  justify: BuilderJustify;
  paddingX: number;
  paddingY: number;
}

export interface BuilderStyleConfig {
  radius: number;
  shadow: BuilderShadow;
  surface: BuilderSurface;
  border: BuilderBorder;
  borderWidth: number;
  opacity: number;
}

export interface BuilderMotionConfig {
  enter: BuilderMotionPreset;
  hover: BuilderMotionPreset;
  durationMs: number;
  delayMs: number;
}

export interface BuilderDataBinding {
  source?: string;
  path?: string;
  transform?: string;
  fallback?: string | number | boolean | null;
}

export interface BuilderNode {
  id: string;
  name: string;
  kind: BuilderNodeKind;
  templateId: string;
  locked?: boolean;
  content: Record<string, string | number | boolean | null>;
  frames: Record<BuilderBreakpoint, BuilderFrame>;
  layout: BuilderLayoutConfig;
  style: BuilderStyleConfig;
  motion: BuilderMotionConfig;
  data?: Record<string, BuilderDataBinding>;
  children?: BuilderNode[];
}

export interface BuilderViewportPreset {
  width: number;
  height: number;
}

export interface BuilderDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  target: "client-app" | "admin";
  updatedAt: string;
  viewports: Record<BuilderBreakpoint, BuilderViewportPreset>;
  rootLayout: BuilderLayoutConfig;
  nodes: BuilderNode[];
}

export interface BuilderValidationIssue {
  level: "error" | "warning";
  code: string;
  nodeId?: string;
  message: string;
}

export interface BuilderGitStatus {
  configured: boolean;
  repository: string;
  branch: string;
  configPath: string;
  reason?: string;
}

export interface BuilderPublishResult {
  ok: boolean;
  commitSha?: string;
  commitUrl?: string;
  branch?: string;
  configPath?: string;
  error?: string;
}
