import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Copy, Grid3X3, Plus, Redo2, Save, Trash2, Undo2 } from "lucide-react";
import publishedJson from "./generated/builder-config.json";
import {
  alignNodes,
  distributeNodes,
  findNode,
  findParentNode,
  getNodeFrame,
  groupTopLevelNodes,
  moveNodes,
  nodeCanvasStyle,
  removeNode,
  resizeNode,
  resizeNodeFromHandle,
  setNodeLayer,
  ungroupTopLevelNode,
  updateNode,
} from "./engine";
import { validateBuilderDocument } from "./validation";
import { MOTION_PRESETS, TEMPLATE_REGISTRY } from "./registry";
import type {
  BuilderBreakpoint,
  BuilderDocument,
  BuilderFrame,
  BuilderGitStatus,
  BuilderNode,
  BuilderNodeKind,
  BuilderPublishResult,
  BuilderResizeHandle,
} from "./types";
import "./dev-builder.css";
import "./dev-builder-studio.css";

const DRAFT_KEY = "sra-luck:dev-builder:draft:v1";
const publishedSeed = publishedJson as BuilderDocument;
const BREAKPOINTS: BuilderBreakpoint[] = ["mobile", "tablet", "desktop"];
const HANDLES: BuilderResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const comparable = (doc: BuilderDocument) => JSON.stringify({ ...clone(doc), updatedAt: "" });

function safeDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return clone(publishedSeed);
    const parsed = JSON.parse(raw) as BuilderDocument;
    return parsed?.schemaVersion === 1 ? parsed : clone(publishedSeed);
  } catch {
    return clone(publishedSeed);
  }
}

function defaultFrame(viewport: { width: number; height: number }, offset: number): BuilderFrame {
  return {
    x: Math.min(24 + offset, Math.max(0, viewport.width - 300)),
    y: Math.min(24 + offset, Math.max(0, viewport.height - 170)),
    width: Math.min(320, Math.max(120, viewport.width - 40)),
    height: 150,
    zIndex: 10,
  };
}

function makeNode(doc: BuilderDocument, kind: BuilderNodeKind): BuilderNode {
  const id = `${kind}-${Date.now().toString(36).slice(-7)}`;
  const frames = Object.fromEntries(
    BREAKPOINTS.map((bp, index) => [bp, defaultFrame(doc.viewports[bp], (doc.nodes.length + index) * 8)]),
  ) as BuilderNode["frames"];
  const base = {
    id,
    name: kind === "container" ? "Novo grupo" : kind === "list" ? "Nova lista" : kind === "text" ? "Novo texto" : kind === "button" ? "Novo botão" : "Novo card",
    kind,
    templateId: kind === "container" ? "container-free-01" : kind === "list" ? "list-dense-01" : "card-classic-01",
    frames,
    layout: {
      mode: kind === "container" ? "free" as const : kind === "list" ? "grid" as const : "stack" as const,
      direction: "column" as const,
      gap: kind === "list" ? 8 : 7,
      columns: kind === "list" ? 3 : 1,
      align: "start" as const,
      justify: "center" as const,
      paddingX: kind === "container" ? 0 : 16,
      paddingY: kind === "container" ? 0 : 14,
    },
    style: {
      radius: kind === "container" ? 12 : 16,
      shadow: kind === "container" ? "none" as const : "soft" as const,
      surface: kind === "container" ? "custom" as const : "default" as const,
      border: "subtle" as const,
      borderWidth: 1,
      opacity: 1,
      backgroundColor: kind === "container" ? "#fffdfc" : undefined,
      textColor: "#2d2024",
      borderColor: "#d8c9cd",
      backdropBlur: 0,
    },
    transform: { rotation: 0, scale: 1, skewX: 0, skewY: 0 },
    motion: { enter: "fade-up" as const, hover: "lift" as const, durationMs: 300, delayMs: 0 },
  };

  if (kind === "container") return { ...base, content: { title: "Grupo livre" }, children: [] };
  if (kind === "list") return { ...base, content: { title: "Nova lista", items: "Item 1 · Item 2 · Item 3", cta: "Ver todos" } };
  if (kind === "text") return { ...base, templateId: "text-basic-01", content: { title: "Texto editável", subtitle: "Você pode mover, redimensionar e girar este texto." } };
  if (kind === "button") return { ...base, templateId: "button-primary-01", content: { title: "Ação", subtitle: "Botão configurável" } };
  return { ...base, content: { eyebrow: "Novo bloco", title: "Título do card", value: "Conteúdo", subtitle: "Edite livremente", status: "Ativo" } };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="dev-builder__field"><span>{label}</span>{children}</label>;
}

function Num({ label, value, min, max, step, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void }) {
  return <Field label={label}><input className="dev-builder__input" type="number" value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value) || 0)} /></Field>;
}

function Sel({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return <Field label={label}><select className="dev-builder__select" value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></Field>;
}

function ColorField({ label, value, onChange }: { label: string; value?: string; onChange: (value: string) => void }) {
  const safe = /^#[0-9a-f]{6}$/i.test(value ?? "") ? value! : "#ffffff";
  return <Field label={label}><div className="dev-builder-studio__color"><input type="color" value={safe} onChange={(e) => onChange(e.target.value)} /><input className="dev-builder__input" value={value ?? ""} placeholder="#ffffff" onChange={(e) => onChange(e.target.value)} /></div></Field>;
}

function flattenTree(nodes: BuilderNode[], depth = 0): Array<{ node: BuilderNode; depth: number }> {
  return nodes.flatMap((node) => [{ node, depth }, ...(node.children?.length ? flattenTree(node.children, depth + 1) : [])]);
}

function NodeBody({ node }: { node: BuilderNode }) {
  const items = String(node.content.items ?? "").split("·").map((item) => item.trim()).filter(Boolean);
  if (node.kind === "container") return <div className="dev-builder-studio__container-label">{String(node.content.title ?? node.name)}</div>;
  if (node.kind === "list" || node.kind === "navigation") return <><strong className="dev-builder__node-title">{String(node.content.title ?? node.name)}</strong><div className="dev-builder__list-grid" style={{ "--list-cols": Math.max(1, node.layout.columns), "--list-gap": `${node.layout.gap}px` } as CSSProperties}>{items.map((item, index) => <div className="dev-builder__list-item" key={`${item}-${index}`}>{item}</div>)}</div></>;
  if (node.kind === "text") return <><div className="dev-builder__node-title">{String(node.content.title ?? node.name)}</div><div className="dev-builder__node-sub">{String(node.content.subtitle ?? "")}</div></>;
  if (node.kind === "button") return <div className="dev-builder-studio__button-preview">{String(node.content.title ?? node.name)}</div>;
  return <>
    {node.content.eyebrow ? <div className="dev-builder__node-eyebrow">{String(node.content.eyebrow)}</div> : null}
    <div className="dev-builder__node-title">{String(node.content.title ?? node.name)}</div>
    {node.content.value ? <div className="dev-builder__node-value">{String(node.content.value)}</div> : null}
    {node.content.subtitle ? <div className="dev-builder__node-sub">{String(node.content.subtitle)}</div> : null}
    {node.content.status ? <div className="dev-builder__node-badge">{String(node.content.status)}</div> : null}
  </>;
}

interface CanvasNodeProps {
  node: BuilderNode;
  doc: BuilderDocument;
  bp: BuilderBreakpoint;
  selectedIds: string[];
  primaryId: string;
  onSelect: (event: ReactPointerEvent<HTMLDivElement>, id: string) => void;
  onMoveStart: (event: ReactPointerEvent<HTMLDivElement>, node: BuilderNode) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>, node: BuilderNode, handle: BuilderResizeHandle) => void;
}

function CanvasNode({ node, doc, bp, selectedIds, primaryId, onSelect, onMoveStart, onResizeStart }: CanvasNodeProps) {
  const selected = selectedIds.includes(node.id);
  const primary = primaryId === node.id;
  const style = nodeCanvasStyle(doc, node, bp);
  return <div
    className="dev-builder__node dev-builder-studio__node"
    data-selected={selected}
    data-multi={selected && selectedIds.length > 1}
    data-kind={node.kind}
    data-surface={node.style.surface}
    data-border={node.style.border}
    style={style}
    onPointerDown={(event) => onMoveStart(event, node)}
    onClick={(event) => { event.stopPropagation(); onSelect(event, node.id); }}
    role="button"
    tabIndex={0}
    aria-label={`Selecionar ${node.name}`}
  >
    <NodeBody node={node} />
    {node.children?.map((child) => <CanvasNode key={child.id} node={child} doc={doc} bp={bp} selectedIds={selectedIds} primaryId={primaryId} onSelect={onSelect} onMoveStart={onMoveStart} onResizeStart={onResizeStart} />)}
    {primary && !node.locked ? HANDLES.map((handle) => <span key={handle} className="dev-builder-studio__handle" data-handle={handle} onPointerDown={(event) => onResizeStart(event, node, handle)} />) : null}
    {selected ? <div className="dev-builder__measure">{Math.round(style.width as number)} × {Math.round(style.height as number)}</div> : null}
  </div>;
}

export function DevBuilderStudioPage() {
  const [doc, setDoc] = useState<BuilderDocument>(() => safeDraft());
  const [baseline, setBaseline] = useState(() => clone(publishedSeed));
  const [selectedIds, setSelectedIds] = useState<string[]>(() => doc.nodes[0]?.id ? [doc.nodes[0].id] : []);
  const [bp, setBp] = useState<BuilderBreakpoint>("mobile");
  const [zoom, setZoom] = useState(.78);
  const [snap, setSnap] = useState(8);
  const [grid, setGrid] = useState(true);
  const [cargo, setCargo] = useState<string | null>(null);
  const [git, setGit] = useState<BuilderGitStatus | null>(null);
  const [message, setMessage] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [lastCommitUrl, setLastCommitUrl] = useState("");
  const history = useRef<BuilderDocument[]>([clone(doc)]);
  const historyIndex = useRef(0);
  const docRef = useRef(doc);
  const interaction = useRef<null | {
    type: "move" | "resize";
    x: number;
    y: number;
    nodeId: string;
    handle?: BuilderResizeHandle;
    start: BuilderDocument;
    selection: string[];
  }>(null);

  const primaryId = selectedIds[selectedIds.length - 1] ?? "";
  const primary = useMemo(() => primaryId ? findNode(doc, primaryId) : null, [doc, primaryId]);
  const selectedNodes = useMemo(() => selectedIds.map((id) => findNode(doc, id)).filter(Boolean) as BuilderNode[], [doc, selectedIds]);
  const flatTree = useMemo(() => flattenTree(doc.nodes), [doc.nodes]);
  const viewport = doc.viewports[bp];
  const issues = useMemo(() => validateBuilderDocument(doc), [doc]);
  const errorCount = issues.filter((issue) => issue.level === "error").length;
  const dirty = comparable(doc) !== comparable(baseline);
  const templates = primary ? Object.values(TEMPLATE_REGISTRY).filter((template) => template.kind === primary.kind || (primary.kind === "kpi" && template.kind === "card")) : [];

  const setCurrent = (next: BuilderDocument) => { docRef.current = next; setDoc(next); };
  const commit = useCallback((next: BuilderDocument) => {
    const list = history.current.slice(0, historyIndex.current + 1);
    list.push(clone(next));
    if (list.length > 120) list.shift();
    history.current = list;
    historyIndex.current = list.length - 1;
    docRef.current = next;
    setDoc(next);
  }, []);
  const patchPrimary = useCallback((updater: (node: BuilderNode) => BuilderNode) => {
    if (!primaryId) return;
    commit(updateNode(docRef.current, primaryId, updater));
  }, [commit, primaryId]);
  const undo = useCallback(() => {
    if (historyIndex.current <= 0) return;
    setCurrent(clone(history.current[--historyIndex.current]));
  }, []);
  const redo = useCallback(() => {
    if (historyIndex.current >= history.current.length - 1) return;
    setCurrent(clone(history.current[++historyIndex.current]));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(doc)); } catch { /* storage can be blocked */ }
    }, 240);
    return () => window.clearTimeout(timer);
  }, [doc]);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/session", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/admin/dev-builder/status", { cache: "no-store" }).then((response) => response.json()),
    ]).then(([session, status]) => {
      setCargo(session?.cargo ?? null);
      setGit(status);
    }).catch(() => setGit({ configured: false, repository: "Guidoka7/sra-luck-react", branch: "develop", configPath: "src/features/dev-builder/generated/builder-config.json", reason: "Status indisponível" }));
  }, []);

  const removeSelection = useCallback(() => {
    if (!selectedIds.length) return;
    let next = docRef.current;
    selectedIds.forEach((id) => {
      const node = findNode(next, id);
      if (node && !node.locked) next = removeNode(next, id);
    });
    commit(next);
    setSelectedIds([]);
  }, [commit, selectedIds]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest("input,textarea,select,[contenteditable='true']")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length) {
        event.preventDefault();
        removeSelection();
        return;
      }
      if (!selectedIds.length || !event.key.startsWith("Arrow")) return;
      let dx = 0;
      let dy = 0;
      const step = event.shiftKey ? snap : 1;
      if (event.key === "ArrowLeft") dx = -step;
      if (event.key === "ArrowRight") dx = step;
      if (event.key === "ArrowUp") dy = -step;
      if (event.key === "ArrowDown") dy = step;
      event.preventDefault();
      commit(moveNodes(docRef.current, selectedIds, bp, dx, dy, 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bp, commit, redo, removeSelection, selectedIds, snap, undo]);

  const selectNode = useCallback((event: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
      return;
    }
    setSelectedIds([id]);
  }, []);

  const beginMove = useCallback((event: ReactPointerEvent<HTMLDivElement>, node: BuilderNode) => {
    if (node.locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const selection = selectedIds.includes(node.id) ? selectedIds : [node.id];
    if (!selectedIds.includes(node.id)) setSelectedIds([node.id]);
    interaction.current = { type: "move", x: event.clientX, y: event.clientY, nodeId: node.id, start: clone(docRef.current), selection };
    const move = (pointer: PointerEvent) => {
      const active = interaction.current;
      if (!active) return;
      const dx = (pointer.clientX - active.x) / zoom;
      const dy = (pointer.clientY - active.y) / zoom;
      setCurrent(moveNodes(active.start, active.selection, bp, dx, dy, grid ? snap : 1));
    };
    const up = () => {
      const active = interaction.current;
      interaction.current = null;
      window.removeEventListener("pointermove", move);
      if (active && comparable(docRef.current) !== comparable(active.start)) commit(docRef.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }, [bp, commit, grid, selectedIds, snap, zoom]);

  const beginResize = useCallback((event: ReactPointerEvent<HTMLDivElement>, node: BuilderNode, handle: BuilderResizeHandle) => {
    if (node.locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedIds([node.id]);
    interaction.current = { type: "resize", x: event.clientX, y: event.clientY, nodeId: node.id, handle, start: clone(docRef.current), selection: [node.id] };
    const move = (pointer: PointerEvent) => {
      const active = interaction.current;
      if (!active?.handle) return;
      const dx = (pointer.clientX - active.x) / zoom;
      const dy = (pointer.clientY - active.y) / zoom;
      setCurrent(resizeNodeFromHandle(active.start, active.nodeId, bp, active.handle, dx, dy, grid ? snap : 1));
    };
    const up = () => {
      const active = interaction.current;
      interaction.current = null;
      window.removeEventListener("pointermove", move);
      if (active && comparable(docRef.current) !== comparable(active.start)) commit(docRef.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }, [bp, commit, grid, snap, zoom]);

  const addNode = (kind: BuilderNodeKind) => {
    const node = makeNode(docRef.current, kind);
    commit({ ...docRef.current, updatedAt: new Date().toISOString(), nodes: [...docRef.current.nodes, node] });
    setSelectedIds([node.id]);
  };

  const duplicatePrimary = () => {
    if (!primary) return;
    const copy = clone(primary);
    copy.id = `${primary.id}-${Date.now().toString(36).slice(-4)}`;
    copy.name = `${primary.name} (cópia)`;
    BREAKPOINTS.forEach((breakpoint) => {
      copy.frames[breakpoint] = { ...copy.frames[breakpoint], x: copy.frames[breakpoint].x + 12, y: copy.frames[breakpoint].y + 12, zIndex: copy.frames[breakpoint].zIndex + 1 };
    });
    commit({ ...docRef.current, updatedAt: new Date().toISOString(), nodes: [...docRef.current.nodes, copy] });
    setSelectedIds([copy.id]);
  };

  const groupSelection = () => {
    const topLevelIds = selectedIds.filter((id) => !findParentNode(docRef.current, id));
    const result = groupTopLevelNodes(docRef.current, topLevelIds, "Grupo livre");
    if (!result.groupId) {
      setMessage("Selecione pelo menos dois elementos do mesmo nível para agrupar.");
      return;
    }
    commit(result.document);
    setSelectedIds([result.groupId]);
    setMessage("Elementos agrupados. Agora o grupo pode ser movido e redimensionado como um bloco, mantendo os filhos editáveis.");
  };

  const ungroupSelection = () => {
    if (!primary || primary.kind !== "container" || findParentNode(docRef.current, primary.id)) {
      setMessage("Selecione um grupo de primeiro nível para desagrupar.");
      return;
    }
    const result = ungroupTopLevelNode(docRef.current, primary.id);
    if (!result.childIds.length) return;
    commit(result.document);
    setSelectedIds(result.childIds);
    setMessage("Grupo desfeito sem perder a posição visual dos elementos.");
  };

  const reset = () => {
    const next = clone(baseline);
    history.current = [clone(next)];
    historyIndex.current = 0;
    setCurrent(next);
    setSelectedIds(next.nodes[0]?.id ? [next.nodes[0].id] : []);
    setMessage("Rascunho restaurado para a versão publicada.");
  };

  const publish = async () => {
    if (!git?.configured || errorCount || publishing || cargo !== "administrativo") return;
    setPublishing(true);
    setMessage("Validando configuração e criando commit na develop…");
    try {
      const response = await fetch("/api/admin/dev-builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ document: docRef.current }),
      });
      const result = await response.json() as BuilderPublishResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "Falha ao publicar.");
      setBaseline(clone(docRef.current));
      localStorage.removeItem(DRAFT_KEY);
      setLastCommitUrl(result.commitUrl ?? "");
      setMessage(`Commit ${result.commitSha?.slice(0, 8) ?? "criado"} enviado automaticamente para ${result.branch ?? "develop"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao publicar.");
    } finally {
      setPublishing(false);
    }
  };

  if (cargo && cargo !== "administrativo") return <section className="dev-builder"><div className="dev-builder__panel"><div className="dev-builder__empty">Builder visual restrito ao perfil administrativo.</div></div></section>;

  const surfaces: Array<[string, string]> = [["default", "Default"], ["soft", "Soft"], ["brand", "Brand"], ["brand-soft", "Brand soft"], ["success", "Success"], ["warning", "Warning"], ["danger", "Danger"], ["custom", "Personalizada"]];
  const primaryFrame = primary ? getNodeFrame(doc, primary, bp) : null;
  const sameParentSelection = selectedNodes.length > 1 && new Set(selectedNodes.map((node) => findParentNode(doc, node.id)?.id ?? "root")).size === 1;

  return <section className="dev-builder dev-builder-studio">
    <header className="dev-builder__header">
      <div>
        <h1 className="dev-builder__title">Builder visual · modo livre</h1>
        <p className="dev-builder__sub">Cards, listas, textos e grupos não ficam presos a layouts pré-salvos. Mova, redimensione, gire, agrupe, alinhe e componha livremente; modelos continuam apenas como pontos de partida.</p>
      </div>
      <div className="dev-builder__actions">
        <span className="dev-builder__status" data-ok={git?.configured}><span className="dev-builder__status-dot" />{git?.configured ? `Git conectado · ${git.branch}` : "Git não configurado"}</span>
        <button className="dev-builder__button" onClick={undo} title="Ctrl/Cmd+Z"><Undo2 size={14} /></button>
        <button className="dev-builder__button" onClick={redo} title="Ctrl/Cmd+Shift+Z"><Redo2 size={14} /></button>
        <button className="dev-builder__button" onClick={reset} disabled={!dirty}>Restaurar publicado</button>
        <button className="dev-builder__button dev-builder__button--primary" onClick={publish} disabled={!dirty || !git?.configured || !!errorCount || publishing || cargo !== "administrativo"}><Save size={14} /> {publishing ? "Publicando…" : `Publicar + commit${dirty ? " •" : ""}`}</button>
      </div>
    </header>

    <div className="dev-builder-studio__selectionbar">
      <strong>{selectedIds.length ? `${selectedIds.length} selecionado${selectedIds.length > 1 ? "s" : ""}` : "Nada selecionado"}</strong>
      <button disabled={selectedIds.length < 2} onClick={groupSelection}>Agrupar</button>
      <button disabled={primary?.kind !== "container"} onClick={ungroupSelection}>Desagrupar</button>
      <span />
      {(["left", "center-x", "right", "top", "center-y", "bottom"] as const).map((alignment) => <button key={alignment} disabled={!sameParentSelection} onClick={() => commit(alignNodes(docRef.current, selectedIds, bp, alignment))}>{alignment}</button>)}
      <button disabled={!sameParentSelection || selectedIds.length < 3} onClick={() => commit(distributeNodes(docRef.current, selectedIds, bp, "horizontal"))}>Distribuir H</button>
      <button disabled={!sameParentSelection || selectedIds.length < 3} onClick={() => commit(distributeNodes(docRef.current, selectedIds, bp, "vertical"))}>Distribuir V</button>
    </div>

    <div className="dev-builder__workspace dev-builder-studio__workspace">
      <aside className="dev-builder__panel">
        <div className="dev-builder__panel-head"><h2 className="dev-builder__panel-title">Estrutura</h2><span>{flatTree.length} elementos</span></div>
        <div className="dev-builder__toolbar dev-builder-studio__addbar">
          {(["card", "list", "container", "text", "button"] as BuilderNodeKind[]).map((kind) => <button key={kind} className="dev-builder__button" onClick={() => addNode(kind)}><Plus size={11} /> {kind}</button>)}
        </div>
        <div className="dev-builder__tree">
          {flatTree.map(({ node, depth }) => <button key={node.id} className="dev-builder__tree-item" data-active={selectedIds.includes(node.id)} style={{ paddingLeft: 9 + depth * 16 }} onClick={(event) => {
            if (event.shiftKey || event.metaKey || event.ctrlKey) setSelectedIds((current) => current.includes(node.id) ? current.filter((id) => id !== node.id) : [...current, node.id]);
            else setSelectedIds([node.id]);
          }}>
            <span className="dev-builder__tree-icon">{node.kind === "container" ? "▢" : node.kind === "list" ? "≡" : node.kind === "text" ? "T" : node.kind === "button" ? "↗" : "▣"}</span>
            <span><span className="dev-builder__tree-name">{node.name}</span><span className="dev-builder__tree-kind">{node.kind} · z{node.frames[bp]?.zIndex ?? 0}{node.locked ? " · bloqueado" : ""}</span></span>
          </button>)}
        </div>
        <div className="dev-builder__footer-note">Shift/Ctrl/Cmd + clique seleciona vários. Delete remove. Setas movem 1px; Shift + seta usa o snap atual.</div>
      </aside>

      <main className="dev-builder__panel">
        <div className="dev-builder__toolbar">
          <Sel label="Breakpoint" value={bp} options={BREAKPOINTS.map((item) => [item, item])} onChange={(value) => setBp(value as BuilderBreakpoint)} />
          <Num label="Largura" value={viewport.width} min={280} max={1920} onChange={(width) => commit({ ...docRef.current, viewports: { ...docRef.current.viewports, [bp]: { ...viewport, width: Math.max(280, width) } } })} />
          <Num label="Altura" value={viewport.height} min={400} max={1600} onChange={(height) => commit({ ...docRef.current, viewports: { ...docRef.current.viewports, [bp]: { ...viewport, height: Math.max(400, height) } } })} />
          <Sel label="Zoom" value={String(zoom)} options={[["0.5", "50%"], ["0.65", "65%"], ["0.78", "78%"], ["1", "100%"], ["1.25", "125%"]]} onChange={(value) => setZoom(Number(value))} />
          <Sel label="Snap" value={String(snap)} options={[1, 4, 8, 12, 16, 24].map((value) => [String(value), `${value}px`])} onChange={(value) => setSnap(Number(value))} />
          <label className="dev-builder__check"><input type="checkbox" checked={grid} onChange={(event) => setGrid(event.target.checked)} /><Grid3X3 size={13} /> Grade</label>
          <span className="dev-builder-studio__dirty" data-dirty={dirty}>{dirty ? "● alterações não publicadas" : "✓ sincronizado"}</span>
        </div>
        <div className="dev-builder__canvas-shell" onClick={() => setSelectedIds([])}>
          <div className="dev-builder__canvas-stage" style={{ width: viewport.width * zoom, height: viewport.height * zoom }}>
            <div className="dev-builder__canvas" data-grid={grid} style={{ width: viewport.width, height: viewport.height, transform: `scale(${zoom})`, transformOrigin: "top left", "--snap-size": `${snap}px` } as CSSProperties}>
              {doc.nodes.map((node) => <CanvasNode key={node.id} node={node} doc={doc} bp={bp} selectedIds={selectedIds} primaryId={primaryId} onSelect={selectNode} onMoveStart={beginMove} onResizeStart={beginResize} />)}
            </div>
          </div>
        </div>
      </main>

      <aside className="dev-builder__panel dev-builder__inspector">
        <div className="dev-builder__panel-head"><h2 className="dev-builder__panel-title">Propriedades</h2><span>{selectedIds.length > 1 ? `${selectedIds.length} itens` : primary?.id}</span></div>
        {!primary || !primaryFrame ? <div className="dev-builder__empty">Selecione um elemento para editar.</div> : <>
          <div className="dev-builder__section">
            <div className="dev-builder__section-title">Geral</div>
            <Field label="Nome"><input className="dev-builder__input" value={primary.name} onChange={(event) => patchPrimary((node) => ({ ...node, name: event.target.value }))} /></Field>
            <Sel label="Modelo base" value={primary.templateId} options={templates.length ? templates.map((template) => [template.id, `${template.label} · v${template.version}`]) : [[primary.templateId, primary.templateId]]} onChange={(templateId) => patchPrimary((node) => ({ ...node, templateId }))} />
            <div className="dev-builder__grid2"><button className="dev-builder__button" onClick={duplicatePrimary}><Copy size={12} /> Duplicar</button><button className="dev-builder__button dev-builder__button--danger" onClick={removeSelection} disabled={selectedNodes.every((node) => node.locked)}><Trash2 size={12} /> Remover</button></div>
            <div className="dev-builder-studio__layers"><button onClick={() => commit(setNodeLayer(docRef.current, primary.id, "front"))}>Frente</button><button onClick={() => commit(setNodeLayer(docRef.current, primary.id, "forward"))}>+1</button><button onClick={() => commit(setNodeLayer(docRef.current, primary.id, "backward"))}>-1</button><button onClick={() => commit(setNodeLayer(docRef.current, primary.id, "back"))}>Fundo</button></div>
          </div>

          <div className="dev-builder__section">
            <div className="dev-builder__section-title">Conteúdo</div>
            {Object.entries(primary.content).map(([key, value]) => typeof value === "boolean" ? <label className="dev-builder__check" key={key}><input type="checkbox" checked={value} onChange={(event) => patchPrimary((node) => ({ ...node, content: { ...node.content, [key]: event.target.checked } }))} />{key}</label> : <Field label={key} key={key}><input className="dev-builder__input" type={typeof value === "number" ? "number" : "text"} value={String(value ?? "")} onChange={(event) => patchPrimary((node) => ({ ...node, content: { ...node.content, [key]: typeof value === "number" ? Number(event.target.value) || 0 : event.target.value } }))} /></Field>)}
          </div>

          <div className="dev-builder__section">
            <div className="dev-builder__section-title">Geometria livre · {bp}</div>
            <div className="dev-builder__grid4">
              <Num label="x" value={Math.round(primaryFrame.x)} onChange={(x) => commit(moveNodes(docRef.current, [primary.id], bp, x - primaryFrame.x, 0, grid ? snap : 1))} />
              <Num label="y" value={Math.round(primaryFrame.y)} onChange={(y) => commit(moveNodes(docRef.current, [primary.id], bp, 0, y - primaryFrame.y, grid ? snap : 1))} />
              <Num label="width" value={Math.round(primaryFrame.width)} min={40} onChange={(width) => commit(resizeNode(docRef.current, primary.id, bp, width, primaryFrame.height, grid ? snap : 1))} />
              <Num label="height" value={Math.round(primaryFrame.height)} min={40} onChange={(height) => commit(resizeNode(docRef.current, primary.id, bp, primaryFrame.width, height, grid ? snap : 1))} />
            </div>
            <label className="dev-builder__check"><input type="checkbox" checked={!!primary.frames[bp].aspectLocked} onChange={(event) => patchPrimary((node) => ({ ...node, frames: { ...node.frames, [bp]: { ...node.frames[bp], aspectLocked: event.target.checked } } }))} /> Travar proporção</label>
            <label className="dev-builder__check"><input type="checkbox" checked={!!primary.frames[bp].hidden} onChange={(event) => patchPrimary((node) => ({ ...node, frames: { ...node.frames, [bp]: { ...node.frames[bp], hidden: event.target.checked } } }))} /> Ocultar neste breakpoint</label>
            <div className="dev-builder__grid4">
              <Num label="Rotação" value={primary.transform?.rotation ?? 0} min={-180} max={180} onChange={(rotation) => patchPrimary((node) => ({ ...node, transform: { rotation, scale: node.transform?.scale ?? 1, skewX: node.transform?.skewX ?? 0, skewY: node.transform?.skewY ?? 0 } }))} />
              <Num label="Escala" value={primary.transform?.scale ?? 1} min={.25} max={3} step={.05} onChange={(scale) => patchPrimary((node) => ({ ...node, transform: { rotation: node.transform?.rotation ?? 0, scale, skewX: node.transform?.skewX ?? 0, skewY: node.transform?.skewY ?? 0 } }))} />
              <Num label="Skew X" value={primary.transform?.skewX ?? 0} min={-30} max={30} onChange={(skewX) => patchPrimary((node) => ({ ...node, transform: { rotation: node.transform?.rotation ?? 0, scale: node.transform?.scale ?? 1, skewX, skewY: node.transform?.skewY ?? 0 } }))} />
              <Num label="Skew Y" value={primary.transform?.skewY ?? 0} min={-30} max={30} onChange={(skewY) => patchPrimary((node) => ({ ...node, transform: { rotation: node.transform?.rotation ?? 0, scale: node.transform?.scale ?? 1, skewX: node.transform?.skewX ?? 0, skewY } }))} />
            </div>
          </div>

          <div className="dev-builder__section">
            <div className="dev-builder__section-title">Layout interno</div>
            <div className="dev-builder__grid2"><Sel label="Modo" value={primary.layout.mode} options={[["free", "Livre"], ["stack", "Stack"], ["grid", "Grid"]]} onChange={(mode) => patchPrimary((node) => ({ ...node, layout: { ...node.layout, mode: mode as BuilderNode["layout"]["mode"] } }))} /><Sel label="Direção" value={primary.layout.direction} options={[["column", "Vertical"], ["row", "Horizontal"]]} onChange={(direction) => patchPrimary((node) => ({ ...node, layout: { ...node.layout, direction: direction as BuilderNode["layout"]["direction"] } }))} /></div>
            <div className="dev-builder__grid4">{(["gap", "columns", "paddingX", "paddingY"] as const).map((key) => <Num key={key} label={key} value={primary.layout[key]} min={key === "columns" ? 1 : 0} max={key === "columns" ? 12 : 128} onChange={(value) => patchPrimary((node) => ({ ...node, layout: { ...node.layout, [key]: Math.max(key === "columns" ? 1 : 0, value) } }))} />)}</div>
            <div className="dev-builder__grid2"><Sel label="Alinhamento" value={primary.layout.align} options={[["start", "Início"], ["center", "Centro"], ["end", "Fim"], ["stretch", "Esticar"]]} onChange={(align) => patchPrimary((node) => ({ ...node, layout: { ...node.layout, align: align as BuilderNode["layout"]["align"] } }))} /><Sel label="Distribuição" value={primary.layout.justify} options={[["start", "Início"], ["center", "Centro"], ["end", "Fim"], ["between", "Espaço entre"]]} onChange={(justify) => patchPrimary((node) => ({ ...node, layout: { ...node.layout, justify: justify as BuilderNode["layout"]["justify"] } }))} /></div>
          </div>

          <div className="dev-builder__section">
            <div className="dev-builder__section-title">Forma e estilo livre</div>
            <div className="dev-builder__grid2"><Num label="Radius" value={primary.style.radius} min={0} max={999} onChange={(radius) => patchPrimary((node) => ({ ...node, style: { ...node.style, radius: Math.max(0, radius) } }))} /><Num label="Opacidade" value={primary.style.opacity} min={.05} max={1} step={.05} onChange={(opacity) => patchPrimary((node) => ({ ...node, style: { ...node.style, opacity: Math.min(1, Math.max(.05, opacity)) } }))} /></div>
            <div className="dev-builder__grid2"><Sel label="Surface" value={primary.style.surface} options={surfaces} onChange={(surface) => patchPrimary((node) => ({ ...node, style: { ...node.style, surface: surface as BuilderNode["style"]["surface"] } }))} /><Sel label="Shadow" value={primary.style.shadow} options={[["none", "Nenhuma"], ["soft", "Suave"], ["medium", "Média"], ["strong", "Forte"]]} onChange={(shadow) => patchPrimary((node) => ({ ...node, style: { ...node.style, shadow: shadow as BuilderNode["style"]["shadow"] } }))} /></div>
            <div className="dev-builder__grid2"><Sel label="Borda" value={primary.style.border} options={[["none", "Sem borda"], ["subtle", "Sutil"], ["default", "Padrão"], ["strong", "Forte"], ["custom", "Personalizada"]]} onChange={(border) => patchPrimary((node) => ({ ...node, style: { ...node.style, border: border as BuilderNode["style"]["border"] } }))} /><Num label="Espessura" value={primary.style.borderWidth} min={0} max={12} onChange={(borderWidth) => patchPrimary((node) => ({ ...node, style: { ...node.style, borderWidth: Math.min(12, Math.max(0, borderWidth)) } }))} /></div>
            <div className="dev-builder__grid2"><ColorField label="Fundo personalizado" value={primary.style.backgroundColor} onChange={(backgroundColor) => patchPrimary((node) => ({ ...node, style: { ...node.style, backgroundColor, surface: "custom" } }))} /><ColorField label="Texto" value={primary.style.textColor} onChange={(textColor) => patchPrimary((node) => ({ ...node, style: { ...node.style, textColor } }))} /></div>
            <div className="dev-builder__grid2"><ColorField label="Borda personalizada" value={primary.style.borderColor} onChange={(borderColor) => patchPrimary((node) => ({ ...node, style: { ...node.style, borderColor, border: "custom" } }))} /><Num label="Blur" value={primary.style.backdropBlur ?? 0} min={0} max={40} onChange={(backdropBlur) => patchPrimary((node) => ({ ...node, style: { ...node.style, backdropBlur } }))} /></div>
          </div>

          <div className="dev-builder__section">
            <div className="dev-builder__section-title">Motion</div>
            <div className="dev-builder__grid2"><Sel label="Entrada" value={primary.motion.enter} options={Object.entries(MOTION_PRESETS).map(([id, preset]) => [id, preset.label])} onChange={(enter) => patchPrimary((node) => ({ ...node, motion: { ...node.motion, enter: enter as BuilderNode["motion"]["enter"] } }))} /><Sel label="Hover" value={primary.motion.hover} options={Object.entries(MOTION_PRESETS).map(([id, preset]) => [id, preset.label])} onChange={(hover) => patchPrimary((node) => ({ ...node, motion: { ...node.motion, hover: hover as BuilderNode["motion"]["hover"] } }))} /></div>
            <div className="dev-builder__grid2"><Num label="Duração ms" value={primary.motion.durationMs} min={0} max={1200} step={25} onChange={(durationMs) => patchPrimary((node) => ({ ...node, motion: { ...node.motion, durationMs: Math.min(1200, Math.max(0, durationMs)) } }))} /><Num label="Delay ms" value={primary.motion.delayMs} min={0} max={1000} step={25} onChange={(delayMs) => patchPrimary((node) => ({ ...node, motion: { ...node.motion, delayMs: Math.min(1000, Math.max(0, delayMs)) } }))} /></div>
          </div>

          <div className="dev-builder__section">
            <div className="dev-builder__section-title">Validação e publicação</div>
            {issues.length ? issues.slice(0, 10).map((issue, index) => <div key={`${issue.code}-${index}`} className="dev-builder__issue" data-level={issue.level}>{issue.message}</div>) : <div className="dev-builder-studio__ok">✓ Documento válido.</div>}
            {message ? <div className="dev-builder__footer-note">{message}</div> : null}
            {lastCommitUrl ? <a className="dev-builder-studio__commit" href={lastCommitUrl} target="_blank" rel="noreferrer">Abrir último commit no GitHub</a> : null}
          </div>
        </>}
      </aside>
    </div>
  </section>;
}
