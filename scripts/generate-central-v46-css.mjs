// Gera src/features/scheduling/central-v46.css a partir do HTML V46 aprovado
// (docs/design/sra-luck-central-v46.html), que é a fonte de verdade visual da
// Central de acompanhamento. Não editar o CSS gerado à mão: ajustar aqui e
// rodar `node scripts/generate-central-v46-css.mjs`.
//
// - Tema claro: cascata idêntica à do HTML (mesma ordem, mesmos !important),
//   só escopada em `.v46` para não vazar para o resto do painel.
// - Shell do protótipo (sidebar, topbar, modo demonstração) fica de fora: o
//   painel real já tem o seu (AdminZipShell).
// - Tema escuro: o HTML não define um. O painel tem modo escuro como
//   capacidade permanente (AGENTS.md), então cada declaração de cor é
//   espelhada sob `.dark .v46` com a cor convertida em OKLCH (superfícies
//   escurecem, textos clareiam, cores de destaque preservam o tom).
import { readFileSync, writeFileSync } from "node:fs";
import postcss from "postcss";

const HTML = "docs/design/sra-luck-central-v46.html";
const OUT = "src/features/scheduling/central-v46.css";

const html = readFileSync(HTML, "utf8");
const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));

// `(?![\w-])` evita que `.main` exclua também `.main-tabs`/`.main-tab`.
const B = "(?![\\w-])";
const EXCLUDED = [
  ...["app-shell", "sidebar", "brand", "brand-card", "support-card", "version", "main", "topbar", "global-search", "top-actions", "profile"].map((c) => new RegExp(`^\\.${c}${B}`)),
  /^\.side-/, /^\.demo-/, /^\.kpi/, /^\.calendar-kpis\b/, /^\.surgery-month-cap-banner\b/, /^\.cap-banner-/,
  /^html\b/, /^body\b/,
];
const IDS = { "#overviewView": ".v46-overview", "#termsCalendarPanel": ".v46-terms-calendar-panel", "#surgeryCalendarPanel": ".v46-surgery-calendar-panel" };

function scopeSelector(sel) {
  let s = sel.trim();
  for (const [id, cls] of Object.entries(IDS)) s = s.split(id).join(cls);
  if (EXCLUDED.some((re) => re.test(s))) return null;
  if (s === ":root") return ".v46";
  if (s === "*") return ".v46, .v46 *";
  return `.v46 ${s}`;
}

const root = postcss.parse(css);
root.walkAtRules("keyframes", (at) => { at.params = `v46-${at.params}`; });
root.walkDecls(/^animation/, (d) => { d.value = d.value.replace(/\btoastIn\b/g, "v46-toastIn"); });
root.walkRules((rule) => {
  if (rule.parent?.type === "atrule" && /keyframes/.test(rule.parent.name)) return;
  const scoped = rule.selectors.map(scopeSelector).filter(Boolean);
  if (!scoped.length) rule.remove();
  else rule.selectors = scoped.flatMap((s) => s.split(", "));
});
root.walkAtRules("media", (at) => { if (!at.nodes?.length) at.remove(); });

// ---------------------------------------------------------------------------
// Tema escuro derivado.
// ---------------------------------------------------------------------------
const COLOR_PROPS = /^(color|background|background-color|background-image|border|border-(top|right|bottom|left)(-color)?|border-color|outline(-color)?|box-shadow|fill|stroke|caret-color|scrollbar-color|text-decoration-color|-webkit-tap-highlight-color|--[\w-]+)$/;
const TEXT_PROPS = /^(color|fill|caret-color|-webkit-text-fill-color|text-decoration-color)$/;

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function toOklch([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map((v) => srgbToLin(v / 255));
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), H: Math.atan2(B, A) };
}
function fromOklch({ L, C, H }) {
  const A = C * Math.cos(H), B = C * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgb.map((v) => Math.round(Math.min(1, Math.max(0, linToSrgb(v))) * 255));
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function transform(rgb, role) {
  const c = toOklch(rgb);
  const accent = c.C > 0.055 && c.L > 0.3 && c.L < 0.82;
  if (role === "shadow") return rgb;
  if (role === "text") {
    if (c.L > 0.92 && c.C < 0.03) return rgb; // texto branco sobre destaque
    return fromOklch({ L: clamp(0.36 + (1 - c.L) * 0.72, 0.64, 0.95), C: c.C * (accent ? 0.9 : 0.45), H: c.H });
  }
  if (role === "accent") return fromOklch({ L: clamp(Math.max(c.L, 0.62), 0.62, 0.8), C: c.C, H: c.H });
  if (c.L < 0.3) return rgb; // sombras e backdrops continuam escuros
  if (accent) return fromOklch({ L: clamp(c.L + 0.06, 0.42, 0.68), C: c.C, H: c.H });
  return fromOklch({ L: 0.2 + (1 - c.L) * 1.1, C: Math.min(c.C * 1.4, 0.045), H: c.H });
}

const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
function parseHex(h) {
  let x = h.slice(1);
  if (x.length === 3) x = [...x].map((ch) => ch + ch).join("");
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
}
function darkValue(value, role) {
  return value
    .replace(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, (m) => hex(transform(parseHex(m), role)))
    .replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/g, (_m, r, g, b, a) => {
      const [nr, ng, nb] = transform([+r, +g, +b], role);
      return a === undefined ? `rgb(${nr},${ng},${nb})` : `rgba(${nr},${ng},${nb},${a})`;
    })
    .replace(/(?<![-\w])white(?![-\w])/g, () => hex(transform([255, 255, 255], role)));
}
function roleOf(prop) {
  if (prop === "box-shadow" || prop === "--shadow") return "shadow";
  if (TEXT_PROPS.test(prop)) return "text";
  if (prop.startsWith("--")) {
    if (/(^--(text|muted|ink)$)|accent|^--(wine|wine-2|rose|gold|green|green-2|yellow|danger|lane|positive)$/.test(prop)) return /^--(text|muted)$/.test(prop) ? "text" : "accent";
    return "surface";
  }
  return "surface";
}

const dark = postcss.root();
function mirror(container, target) {
  container.each((node) => {
    if (node.type === "rule") {
      if (node.parent?.type === "atrule" && /keyframes/.test(node.parent.name)) return;
      const decls = node.nodes.filter((d) => d.type === "decl" && COLOR_PROPS.test(d.prop));
      if (!decls.length) return;
      const rule = postcss.rule({ selectors: node.selectors.map((s) => (s.startsWith(".v46") ? `.dark ${s}` : s)) });
      for (const d of decls) rule.append(postcss.decl({ prop: d.prop, value: darkValue(d.value, roleOf(d.prop)), important: d.important }));
      target.append(rule);
    } else if (node.type === "atrule" && node.name === "media") {
      const media = postcss.atRule({ name: "media", params: node.params });
      mirror(node, media);
      if (media.nodes?.length) target.append(media);
    }
  });
}
mirror(root, dark);

const BASELINE = `/* Base: restaura o que o HTML herdava do navegador e o preflight/admin-zip removem. */
.v46{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);font-size:16px;line-height:normal}
.zip-admin .v46 h1,.zip-admin .v46 h2,.zip-admin .v46 h3,.zip-admin .v46 h4,.v46 h1,.v46 h2,.v46 h3,.v46 h4{font-family:inherit;font-weight:700;letter-spacing:normal}
.v46 h1{font-size:2em}.v46 h2{font-size:1.5em}.v46 h3{font-size:1.17em}
.v46 b,.v46 strong{font-weight:bolder}
.v46 small{font-size:80%}
.v46 details>summary{list-style:none}
`;

const header = `/*
 * GERADO por scripts/generate-central-v46-css.mjs a partir de
 * docs/design/sra-luck-central-v46.html (fonte de verdade visual V46).
 * Não editar à mão.
 */
`;
writeFileSync(OUT, `${header}${BASELINE}\n${root.toString()}\n\n/* ---------- Tema escuro derivado ---------- */\n${dark.toString()}\n`);
console.log(`ok: ${OUT}`);
