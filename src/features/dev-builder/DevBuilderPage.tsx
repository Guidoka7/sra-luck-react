import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Copy, Grid3X3, Plus, Redo2, Save, Trash2, Undo2 } from "lucide-react";
import publishedJson from "./generated/builder-config.json";
import { alignNode, findNode, getNodeFrame, moveNode, nodeCanvasStyle, reorderTopLevelNode, resizeNode, updateNode } from "./engine";
import { validateBuilderDocument } from "./validation";
import { MOTION_PRESETS, TEMPLATE_REGISTRY } from "./registry";
import type { BuilderBreakpoint, BuilderDocument, BuilderFrame, BuilderGitStatus, BuilderNode, BuilderPublishResult } from "./types";
import "./dev-builder.css";

const DRAFT_KEY = "sra-luck:dev-builder:draft:v1";
const publishedSeed = publishedJson as BuilderDocument;
const BREAKPOINTS: BuilderBreakpoint[] = ["mobile", "tablet", "desktop"];

const clone = (doc: BuilderDocument) => JSON.parse(JSON.stringify(doc)) as BuilderDocument;
const comparable = (doc: BuilderDocument) => JSON.stringify({ ...clone(doc), updatedAt: "" });

function safeDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return clone(publishedSeed);
    const parsed = JSON.parse(raw) as BuilderDocument;
    return parsed?.schemaVersion === 1 ? parsed : clone(publishedSeed);
  } catch { return clone(publishedSeed); }
}

function makeFrame(viewport: { width: number; height: number }, offset: number): BuilderFrame {
  return { x: Math.min(24 + offset, viewport.width - 280), y: Math.min(24 + offset, viewport.height - 150), width: Math.min(320, viewport.width - 40), height: 150, zIndex: 5 };
}

function makeNode(doc: BuilderDocument, kind: "card" | "list"): BuilderNode {
  const id = `${kind}-${Date.now().toString(36).slice(-6)}`;
  const frames = Object.fromEntries(BREAKPOINTS.map((bp, i) => [bp, makeFrame(doc.viewports[bp], (doc.nodes.length + i) * 8)])) as BuilderNode["frames"];
  if (kind === "list") return {
    id, name: "Nova lista", kind, templateId: "list-dense-01",
    content: { title: "Nova lista", items: "Item 1 · Item 2 · Item 3", cta: "Ver todos" }, frames,
    layout: { mode: "grid", direction: "row", gap: 8, columns: 3, align: "stretch", justify: "start", paddingX: 12, paddingY: 12 },
    style: { radius: 14, shadow: "none", surface: "default", border: "subtle", borderWidth: 1, opacity: 1 },
    motion: { enter: "fade", hover: "none", durationMs: 240, delayMs: 0 },
  };
  return {
    id, name: "Novo card", kind, templateId: "card-classic-01",
    content: { eyebrow: "Novo bloco", title: "Título do card", value: "Conteúdo", subtitle: "Edite livremente", status: "Ativo" }, frames,
    layout: { mode: "stack", direction: "column", gap: 7, columns: 1, align: "start", justify: "center", paddingX: 16, paddingY: 14 },
    style: { radius: 16, shadow: "soft", surface: "default", border: "subtle", borderWidth: 1, opacity: 1 },
    motion: { enter: "fade-up", hover: "lift", durationMs: 300, delayMs: 0 },
  };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="dev-builder__field"><span>{label}</span>{children}</label>;
}
function Num({ label, value, min, max, step, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void }) {
  return <Field label={label}><input className="dev-builder__input" type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value) || 0)} /></Field>;
}
function Sel({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return <Field label={label}><select className="dev-builder__select" value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>;
}

function NodePreview({ node, doc, bp, selected, begin, select }: { node: BuilderNode; doc: BuilderDocument; bp: BuilderBreakpoint; selected: boolean; begin: (event: ReactPointerEvent<HTMLDivElement>, node: BuilderNode, mode: "move" | "resize") => void; select: (id: string) => void }) {
  const style = nodeCanvasStyle(doc, node, bp);
  const items = String(node.content.items ?? "").split("·").map((x) => x.trim()).filter(Boolean);
  return <div className="dev-builder__node" data-selected={selected} data-surface={node.style.surface} data-border={node.style.border} style={style} onPointerDown={(e) => begin(e, node, "move")} onClick={() => select(node.id)} role="button" tabIndex={0} aria-label={`Selecionar ${node.name}`}>
    {node.kind === "list" || node.kind === "navigation" ? <><strong className="dev-builder__node-title">{String(node.content.title ?? node.name)}</strong><div className="dev-builder__list-grid" style={{ "--list-cols": Math.max(1, node.layout.columns), "--list-gap": `${node.layout.gap}px` } as CSSProperties}>{items.map((item) => <div className="dev-builder__list-item" key={item}>{item}</div>)}</div></> : node.kind === "text" ? <><div className="dev-builder__node-title">{String(node.content.title ?? node.name)}</div><div className="dev-builder__node-sub">{String(node.content.subtitle ?? "")}</div></> : <>
      {node.content.eyebrow ? <div className="dev-builder__node-eyebrow">{String(node.content.eyebrow)}</div> : null}
      <div className="dev-builder__node-title">{String(node.content.title ?? node.name)}</div>
      {node.content.value ? <div className="dev-builder__node-value">{String(node.content.value)}</div> : null}
      {node.content.subtitle ? <div className="dev-builder__node-sub">{String(node.content.subtitle)}</div> : null}
      {node.content.status ? <div className="dev-builder__node-badge">{String(node.content.status)}</div> : null}
    </>}
    {selected && !node.locked ? <div className="dev-builder__resize" onPointerDown={(e) => begin(e, node, "resize")} /> : null}
    {selected ? <div className="dev-builder__measure">{Math.round(style.width as number)} × {Math.round(style.height as number)}</div> : null}
  </div>;
}

export function DevBuilderPage() {
  const [doc, setDoc] = useState<BuilderDocument>(() => safeDraft());
  const [baseline, setBaseline] = useState(() => clone(publishedSeed));
  const [selectedId, setSelectedId] = useState(doc.nodes[0]?.id ?? "");
  const [bp, setBp] = useState<BuilderBreakpoint>("mobile");
  const [zoom, setZoom] = useState(.78);
  const [snap, setSnap] = useState(8);
  const [grid, setGrid] = useState(true);
  const [cargo, setCargo] = useState<string | null>(null);
  const [git, setGit] = useState<BuilderGitStatus | null>(null);
  const [message, setMessage] = useState("");
  const [publishing, setPublishing] = useState(false);
  const history = useRef<BuilderDocument[]>([clone(doc)]);
  const historyIndex = useRef(0);
  const docRef = useRef(doc);
  const drag = useRef<null | { mode: "move" | "resize"; id: string; x: number; y: number; frame: BuilderFrame; start: BuilderDocument }>(null);

  const setCurrent = (next: BuilderDocument) => { docRef.current = next; setDoc(next); };
  const commit = useCallback((next: BuilderDocument) => {
    const list = history.current.slice(0, historyIndex.current + 1); list.push(clone(next)); if (list.length > 80) list.shift();
    history.current = list; historyIndex.current = list.length - 1; docRef.current = next; setDoc(next);
  }, []);
  const patch = useCallback((fn: (node: BuilderNode) => BuilderNode) => { if (selectedId) commit(updateNode(docRef.current, selectedId, fn)); }, [commit, selectedId]);
  const undo = useCallback(() => { if (historyIndex.current > 0) setCurrent(clone(history.current[--historyIndex.current])); }, []);
  const redo = useCallback(() => { if (historyIndex.current < history.current.length - 1) setCurrent(clone(history.current[++historyIndex.current])); }, []);

  useEffect(() => { const t = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(doc)); } catch {} }, 260); return () => clearTimeout(t); }, [doc]);
  useEffect(() => { Promise.all([fetch("/api/admin/session", { cache: "no-store" }).then(r => r.json()), fetch("/api/admin/dev-builder/status", { cache: "no-store" }).then(r => r.json())]).then(([session, status]) => { setCargo(session?.cargo ?? null); setGit(status); }).catch(() => setGit({ configured: false, repository: "Guidoka7/sra-luck-react", branch: "develop", configPath: "src/features/dev-builder/generated/builder-config.json", reason: "Status indisponível" })); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest("input,textarea,select,[contenteditable='true']")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (!selectedId || !e.key.startsWith("Arrow")) return;
      const node = findNode(docRef.current, selectedId); if (!node || node.locked) return;
      const f = getNodeFrame(docRef.current, node, bp); const step = e.shiftKey ? snap : 1; let x = f.x, y = f.y;
      if (e.key === "ArrowLeft") x -= step; if (e.key === "ArrowRight") x += step; if (e.key === "ArrowUp") y -= step; if (e.key === "ArrowDown") y += step;
      e.preventDefault(); commit(moveNode(docRef.current, selectedId, bp, x, y, 1));
    };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  }, [bp, commit, redo, selectedId, snap, undo]);

  const begin = useCallback((e: ReactPointerEvent<HTMLDivElement>, node: BuilderNode, mode: "move" | "resize") => {
    if (node.locked) return; e.preventDefault(); e.stopPropagation(); setSelectedId(node.id);
    drag.current = { mode, id: node.id, x: e.clientX, y: e.clientY, frame: getNodeFrame(docRef.current, node, bp), start: clone(docRef.current) };
    const move = (p: PointerEvent) => { const d = drag.current; if (!d) return; const dx = (p.clientX - d.x) / zoom, dy = (p.clientY - d.y) / zoom; const next = d.mode === "move" ? moveNode(d.start, d.id, bp, d.frame.x + dx, d.frame.y + dy, grid ? snap : 1) : resizeNode(d.start, d.id, bp, d.frame.width + dx, d.frame.height + dy, grid ? snap : 1); setCurrent(next); };
    const up = () => { const d = drag.current; drag.current = null; removeEventListener("pointermove", move); if (d && comparable(docRef.current) !== comparable(d.start)) commit(docRef.current); };
    addEventListener("pointermove", move); addEventListener("pointerup", up, { once: true });
  }, [bp, commit, grid, snap, zoom]);

  const selected = useMemo(() => selectedId ? findNode(doc, selectedId) : null, [doc, selectedId]);
  const viewport = doc.viewports[bp];
  const issues = useMemo(() => validateBuilderDocument(doc), [doc]);
  const errorCount = issues.filter(x => x.level === "error").length;
  const dirty = comparable(doc) !== comparable(baseline);
  const templates = selected ? Object.values(TEMPLATE_REGISTRY).filter(t => t.kind === selected.kind || (selected.kind === "kpi" && t.kind === "card")) : [];

  const addNode = (kind: "card" | "list") => { const node = makeNode(docRef.current, kind); commit({ ...docRef.current, updatedAt: new Date().toISOString(), nodes: [...docRef.current.nodes, node] }); setSelectedId(node.id); };
  const duplicate = () => { if (!selected) return; const copy = clone({ ...doc, nodes: [selected] }).nodes[0]; copy.id = `${selected.id}-${Date.now().toString(36).slice(-4)}`; copy.name += " (cópia)"; BREAKPOINTS.forEach(x => copy.frames[x] = { ...copy.frames[x], x: copy.frames[x].x + 12, y: copy.frames[x].y + 12, zIndex: copy.frames[x].zIndex + 1 }); commit({ ...docRef.current, nodes: [...docRef.current.nodes, copy] }); setSelectedId(copy.id); };
  const remove = () => { if (!selected || selected.locked) return; const nodes = docRef.current.nodes.filter(n => n.id !== selected.id); commit({ ...docRef.current, nodes }); setSelectedId(nodes[0]?.id ?? ""); };
  const reset = () => { const next = clone(baseline); history.current = [clone(next)]; historyIndex.current = 0; setCurrent(next); setSelectedId(next.nodes[0]?.id ?? ""); setMessage("Rascunho restaurado."); };
  const publish = async () => {
    if (!git?.configured || errorCount || publishing || cargo !== "administrativo") return;
    setPublishing(true); setMessage("Validando e criando commit na develop…");
    try {
      const r = await fetch("/api/admin/dev-builder/publish", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ document: docRef.current }) });
      const result = await r.json() as BuilderPublishResult; if (!r.ok || !result.ok) throw new Error(result.error || "Falha ao publicar.");
      setBaseline(clone(docRef.current)); localStorage.removeItem(DRAFT_KEY); setMessage(`Commit ${result.commitSha?.slice(0, 8) ?? "criado"} enviado para ${result.branch ?? "develop"}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao publicar."); } finally { setPublishing(false); }
  };

  if (cargo && cargo !== "administrativo") return <section className="dev-builder"><div className="dev-builder__panel"><div className="dev-builder__empty">Builder visual restrito ao perfil administrativo.</div></div></section>;

  const surfaces: Array<[string, string]> = [["default", "Default"], ["soft", "Soft"], ["brand", "Brand"], ["brand-soft", "Brand soft"], ["success", "Success"], ["warning", "Warning"], ["danger", "Danger"]];
  return <section className="dev-builder">
    <header className="dev-builder__header"><div><h1 className="dev-builder__title">Builder visual · Sra. Luck</h1><p className="dev-builder__sub">Composição livre com posição, tamanho, ordem, layout interno e forma editáveis. Modelos são só pontos de partida; o draft não altera a versão publicada.</p></div><div className="dev-builder__actions">
      <span className="dev-builder__status" data-ok={git?.configured}><span className="dev-builder__status-dot" />{git?.configured ? "Git conectado" : "Git não configurado"}</span>
      <button className="dev-builder__button" onClick={undo} title="Ctrl/Cmd+Z"><Undo2 size={14} /></button><button className="dev-builder__button" onClick={redo} title="Ctrl/Cmd+Shift+Z"><Redo2 size={14} /></button>
      <button className="dev-builder__button" onClick={reset} disabled={!dirty}>Restaurar publicado</button><button className="dev-builder__button dev-builder__button--primary" onClick={publish} disabled={!dirty || !git?.configured || !!errorCount || publishing || cargo !== "administrativo"}><Save size={14} /> {publishing ? "Publicando…" : "Publicar + commit"}</button>
    </div></header>
    <div className="dev-builder__workspace">
      <aside className="dev-builder__panel"><div className="dev-builder__panel-head"><h2 className="dev-builder__panel-title">Estrutura</h2><span>{doc.nodes.length} blocos</span></div><div className="dev-builder__toolbar"><button className="dev-builder__button" onClick={() => addNode("card")}><Plus size={12} /> Card</button><button className="dev-builder__button" onClick={() => addNode("list")}><Plus size={12} /> Lista</button></div><div className="dev-builder__tree">{doc.nodes.map(node => <button key={node.id} className="dev-builder__tree-item" data-active={selectedId === node.id} onClick={() => setSelectedId(node.id)}><span className="dev-builder__tree-icon">{node.kind === "list" ? "≡" : node.kind === "text" ? "T" : "▣"}</span><span><span className="dev-builder__tree-name">{node.name}</span><span className="dev-builder__tree-kind">{node.kind} · z{node.frames[bp].zIndex}</span></span></button>)}</div><div className="dev-builder__footer-note">Arraste para mover; use a alça para redimensionar. Posição e tamanho são independentes em cada breakpoint.</div></aside>
      <main className="dev-builder__panel"><div className="dev-builder__toolbar">
        <Sel label="Breakpoint" value={bp} options={BREAKPOINTS.map(x => [x, x])} onChange={v => setBp(v as BuilderBreakpoint)} /><Num label="Largura" value={viewport.width} min={280} max={1920} onChange={width => commit({ ...docRef.current, viewports: { ...docRef.current.viewports, [bp]: { ...viewport, width: Math.max(280, width) } } })} /><Num label="Altura" value={viewport.height} min={400} max={1600} onChange={height => commit({ ...docRef.current, viewports: { ...docRef.current.viewports, [bp]: { ...viewport, height: Math.max(400, height) } } })} />
        <Sel label="Zoom" value={String(zoom)} options={[["0.5", "50%"], ["0.65", "65%"], ["0.78", "78%"], ["1", "100%"]]} onChange={v => setZoom(Number(v))} /><Sel label="Snap" value={String(snap)} options={[4,8,12,16,24].map(x => [String(x), `${x}px`])} onChange={v => setSnap(Number(v))} /><label className="dev-builder__check"><input type="checkbox" checked={grid} onChange={e => setGrid(e.target.checked)} /><Grid3X3 size={13} /> Grade</label><span style={{ marginLeft: "auto", fontSize: 10 }}>{dirty ? "● não publicado" : "✓ sincronizado"}</span>
      </div><div className="dev-builder__canvas-shell"><div className="dev-builder__canvas-stage" style={{ width: viewport.width * zoom, height: viewport.height * zoom }}><div className="dev-builder__canvas" data-grid={grid} style={{ width: viewport.width, height: viewport.height, transform: `scale(${zoom})`, transformOrigin: "top left", "--snap-size": `${snap}px` } as CSSProperties}>{doc.nodes.map(node => <NodePreview key={node.id} node={node} doc={doc} bp={bp} selected={selectedId === node.id} begin={begin} select={setSelectedId} />)}</div></div></div></main>
      <aside className="dev-builder__panel dev-builder__inspector"><div className="dev-builder__panel-head"><h2 className="dev-builder__panel-title">Propriedades</h2><span>{selected?.id}</span></div>{!selected ? <div className="dev-builder__empty">Selecione um bloco.</div> : <>
        <div className="dev-builder__section"><div className="dev-builder__section-title">Geral</div><Field label="Nome"><input className="dev-builder__input" value={selected.name} onChange={e => patch(n => ({ ...n, name: e.target.value }))} /></Field><Sel label="Modelo base" value={selected.templateId} options={templates.length ? templates.map(t => [t.id, `${t.label} · v${t.version}`]) : [[selected.templateId, selected.templateId]]} onChange={templateId => patch(n => ({ ...n, templateId }))} /><div className="dev-builder__grid2"><button className="dev-builder__button" onClick={duplicate}><Copy size={12} /> Duplicar</button><button className="dev-builder__button dev-builder__button--danger" onClick={remove} disabled={selected.locked}><Trash2 size={12} /> Remover</button></div></div>
        <div className="dev-builder__section"><div className="dev-builder__section-title">Conteúdo</div>{Object.entries(selected.content).map(([key, value]) => typeof value === "boolean" ? <label className="dev-builder__check" key={key}><input type="checkbox" checked={value} onChange={e => patch(n => ({ ...n, content: { ...n.content, [key]: e.target.checked } }))} />{key}</label> : <Field label={key} key={key}><input className="dev-builder__input" type={typeof value === "number" ? "number" : "text"} value={String(value ?? "")} onChange={e => patch(n => ({ ...n, content: { ...n.content, [key]: typeof value === "number" ? Number(e.target.value) || 0 : e.target.value } }))} /></Field>)}</div>
        <div className="dev-builder__section"><div className="dev-builder__section-title">Posição e tamanho · {bp}</div><div className="dev-builder__grid4">{(["x","y","width","height"] as const).map(key => <Num key={key} label={key} value={Math.round(getNodeFrame(doc, selected, bp)[key])} onChange={value => { const f = getNodeFrame(docRef.current, findNode(docRef.current, selected.id)!, bp); commit(key === "x" || key === "y" ? moveNode(docRef.current, selected.id, bp, key === "x" ? value : f.x, key === "y" ? value : f.y, grid ? snap : 1) : resizeNode(docRef.current, selected.id, bp, key === "width" ? value : f.width, key === "height" ? value : f.height, grid ? snap : 1)); }} />)}</div><div className="dev-builder__grid2"><Num label="Z-index" value={selected.frames[bp].zIndex} min={0} max={999} onChange={zIndex => patch(n => ({ ...n, frames: { ...n.frames, [bp]: { ...n.frames[bp], zIndex } } }))} /><label className="dev-builder__check"><input type="checkbox" checked={!!selected.frames[bp].hidden} onChange={e => patch(n => ({ ...n, frames: { ...n.frames, [bp]: { ...n.frames[bp], hidden: e.target.checked } } }))} /> Oculto</label></div><div className="dev-builder__grid4">{(["left","center-x","right","top","center-y","bottom"] as const).map(a => <button className="dev-builder__mini" key={a} onClick={() => commit(alignNode(docRef.current, selected.id, bp, a))}>{a}</button>)}<button className="dev-builder__mini" onClick={() => commit(reorderTopLevelNode(docRef.current, selected.id, -1))}>↑ ordem</button><button className="dev-builder__mini" onClick={() => commit(reorderTopLevelNode(docRef.current, selected.id, 1))}>↓ ordem</button></div></div>
        <div className="dev-builder__section"><div className="dev-builder__section-title">Layout interno</div><div className="dev-builder__grid2"><Sel label="Modo" value={selected.layout.mode} options={[["free","Livre"],["stack","Stack"],["grid","Grid"]]} onChange={mode => patch(n => ({ ...n, layout: { ...n.layout, mode: mode as BuilderNode["layout"]["mode"] } }))} /><Sel label="Direção" value={selected.layout.direction} options={[["column","Vertical"],["row","Horizontal"]]} onChange={direction => patch(n => ({ ...n, layout: { ...n.layout, direction: direction as BuilderNode["layout"]["direction"] } }))} /></div><div className="dev-builder__grid4">{(["gap","columns","paddingX","paddingY"] as const).map(k => <Num key={k} label={k} value={selected.layout[k]} min={k === "columns" ? 1 : 0} max={k === "columns" ? 12 : 64} onChange={v => patch(n => ({ ...n, layout: { ...n.layout, [k]: Math.max(k === "columns" ? 1 : 0, v) } }))} />)}</div><div className="dev-builder__grid2"><Sel label="Alinhamento" value={selected.layout.align} options={[["start","Início"],["center","Centro"],["end","Fim"],["stretch","Esticar"]]} onChange={align => patch(n => ({ ...n, layout: { ...n.layout, align: align as BuilderNode["layout"]["align"] } }))} /><Sel label="Distribuição" value={selected.layout.justify} options={[["start","Início"],["center","Centro"],["end","Fim"],["between","Espaço entre"]]} onChange={justify => patch(n => ({ ...n, layout: { ...n.layout, justify: justify as BuilderNode["layout"]["justify"] } }))} /></div></div>
        <div className="dev-builder__section"><div className="dev-builder__section-title">Forma e superfície</div><div className="dev-builder__grid2"><Num label="Radius" value={selected.style.radius} min={0} max={64} onChange={radius => patch(n => ({ ...n, style: { ...n.style, radius: Math.min(64, Math.max(0, radius)) } }))} /><Num label="Opacidade" value={selected.style.opacity} min={.1} max={1} step={.05} onChange={opacity => patch(n => ({ ...n, style: { ...n.style, opacity: Math.min(1, Math.max(.1, opacity)) } }))} /></div><div className="dev-builder__grid2"><Sel label="Surface" value={selected.style.surface} options={surfaces} onChange={surface => patch(n => ({ ...n, style: { ...n.style, surface: surface as BuilderNode["style"]["surface"] } }))} /><Sel label="Shadow" value={selected.style.shadow} options={[["none","Nenhuma"],["soft","Suave"],["medium","Média"],["strong","Forte"]]} onChange={shadow => patch(n => ({ ...n, style: { ...n.style, shadow: shadow as BuilderNode["style"]["shadow"] } }))} /></div><div className="dev-builder__grid2"><Sel label="Borda" value={selected.style.border} options={[["none","Sem borda"],["subtle","Sutil"],["default","Padrão"],["strong","Forte"]]} onChange={border => patch(n => ({ ...n, style: { ...n.style, border: border as BuilderNode["style"]["border"] } }))} /><Num label="Espessura" value={selected.style.borderWidth} min={0} max={4} onChange={borderWidth => patch(n => ({ ...n, style: { ...n.style, borderWidth: Math.min(4, Math.max(0, borderWidth)) } }))} /></div></div>
        <div className="dev-builder__section"><div className="dev-builder__section-title">Motion</div><div className="dev-builder__grid2"><Sel label="Entrada" value={selected.motion.enter} options={Object.entries(MOTION_PRESETS).map(([id,p]) => [id,p.label])} onChange={enter => patch(n => ({ ...n, motion: { ...n.motion, enter: enter as BuilderNode["motion"]["enter"] } }))} /><Sel label="Hover" value={selected.motion.hover} options={Object.entries(MOTION_PRESETS).map(([id,p]) => [id,p.label])} onChange={hover => patch(n => ({ ...n, motion: { ...n.motion, hover: hover as BuilderNode["motion"]["hover"] } }))} /></div><div className="dev-builder__grid2"><Num label="Duração ms" value={selected.motion.durationMs} min={0} max={1200} step={25} onChange={durationMs => patch(n => ({ ...n, motion: { ...n.motion, durationMs: Math.min(1200, Math.max(0, durationMs)) } }))} /><Num label="Delay ms" value={selected.motion.delayMs} min={0} max={1000} step={25} onChange={delayMs => patch(n => ({ ...n, motion: { ...n.motion, delayMs: Math.min(1000, Math.max(0, delayMs)) } }))} /></div></div>
        <div className="dev-builder__section"><div className="dev-builder__section-title">Validação</div>{issues.length ? issues.slice(0,8).map((issue,i) => <div key={`${issue.code}-${i}`} className="dev-builder__issue" data-level={issue.level}>{issue.message}</div>) : <div style={{ color: "#2f8f67", fontSize: 10 }}>✓ Documento válido.</div>}{message ? <div className="dev-builder__footer-note">{message}</div> : null}</div>
      </>}</aside>
    </div>
  </section>;
}
