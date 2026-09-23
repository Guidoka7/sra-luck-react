#!/usr/bin/env node
/**
 * Gera o modo escuro premium do app da cliente: src/styles/client-dark.generated.css
 *
 * O app claro usa cores fixas da marca (classes Tailwind com hex, estilos
 * inline e CSS próprio). Em vez de reescrever cada tela, este script lê essas
 * cores e produz, para cada uma, a versão escura segundo o PAPEL da cor
 * (fundo, texto, borda). Tudo fica escopado em html[data-tema-cliente="escuro"]:
 * o modo claro continua exatamente como está.
 *
 * Para ajustar o visual escuro, edite a PALETA / as funções de papel abaixo e
 * rode:  node scripts/tema-escuro-cliente.mjs
 * (também roda no build: ver "prebuild" no package.json).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import postcss from "postcss";

const RAIZ = new URL("..", import.meta.url).pathname;
const ESCOPO = 'html[data-tema-cliente="escuro"]';
const SAIDA = "src/styles/client-dark.generated.css";

/**
 * Superfícies no estilo iOS escuro: grafite neutro (sem o "vinho quase preto"),
 * com hierarquia fundo → cartão → cartão elevado e separadores finos.
 * O rosé da marca aparece nos destaques (texto, ícones, botões, seleção);
 * o dourado só onde o modo claro já usa dourado.
 */
const PALETA = {
  fundoApp: "#111013",
  cartao: "#1C1B1E",
  cartaoSuave: "#18171A",
  cartaoElevado: "#262428",
  borda: "#2F2D31",
  // Botões e blocos sólidos da marca: rosé profundo, legível com texto branco.
  roseSolido: "#B0526A",
};

const FONTES = ["src/pages/AgendaPage.tsx", "src/pages/client", "src/components/cliente", "src/components/cliente/ProfilePhotoPicker.tsx"];
const CSS_FONTES = ["src/styles/client-prototype.css", "src/styles/client-prototype-overrides.css"];

// ── cor ────────────────────────────────────────────────────────────────────
function hexParaRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
}
function rgbParaHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}
function hslParaHex({ h, s, l }) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}
const limitar = (v, min, max) => Math.max(min, Math.min(max, v));

/** Tons quentes (pêssego, areia, vinho) assumem o matiz rosé da marca. */
function matizRose(h) {
  return h <= 45 || h >= 320 ? 346 : h;
}
const ehMarca = (hsl) => (hsl.h <= 20 || hsl.h >= 320) && hsl.s >= 0.3;
/**
 * Fundo: claros viram superfícies grafite (tons pastel ganham só um véu da
 * cor original); cores fortes da marca viram rosé sólido; demais cores fortes
 * (verde, dourado) mantêm o matiz com um pouco mais de luz.
 */
function fundo(hex) {
  const hsl = rgbParaHsl(hexParaRgb(hex));
  if (hsl.l >= 0.8) {
    // Brancos e tons "papel" (quase brancos) são superfícies neutras; só os
    // pastéis de verdade (blush, verde-claro...) levam um véu da cor.
    if (hsl.s < 0.25 || hsl.l >= 0.95) {
      if (hsl.l >= 0.985) return PALETA.cartao;
      if (hsl.l >= 0.95) return PALETA.cartaoSuave;
      return PALETA.cartaoElevado;
    }
    // Véu "tinted" do iOS: rosé discreto (sem puxar para o marrom).
    const h = matizRose(hsl.h);
    return h === 346 ? hslParaHex({ h: 342, s: 0.2, l: 0.18 }) : hslParaHex({ h, s: limitar(hsl.s * 0.3, 0.1, 0.2), l: 0.16 });
  }
  if (hsl.l >= 0.55) return hslParaHex({ h: matizRose(hsl.h), s: limitar(hsl.s * 0.4, 0.12, 0.3), l: 0.25 });
  if (ehMarca(hsl)) return hsl.l < 0.2 ? hslParaHex({ h: 346, s: 0.32, l: 0.24 }) : PALETA.roseSolido;
  if (hsl.s < 0.15) return hslParaHex({ h: 270, s: 0.03, l: limitar(hsl.l * 1.1, 0.14, 0.32) });
  return hslParaHex({ h: hsl.h, s: hsl.s * 0.85, l: limitar(hsl.l * 1.15, 0.2, 0.42) });
}
/**
 * Texto/ícone: neutros viram cinzas claros quase sem cor (como no iOS);
 * a cor da marca vira rosé claro; verde e dourado mantêm o matiz, mais claros.
 * Brancos continuam brancos.
 */
function texto(hex) {
  const hsl = rgbParaHsl(hexParaRgb(hex));
  if (hsl.l >= 0.9) return hex.toUpperCase();
  const l = limitar(0.96 - hsl.l * 0.55, 0.55, 0.94);
  if (ehMarca(hsl)) return hslParaHex({ h: 346, s: 0.62, l: limitar(l, 0.72, 0.84) });
  if (hsl.s < 0.3) return hslParaHex({ h: hsl.h, s: Math.min(hsl.s, 0.06), l });
  return hslParaHex({ h: hsl.h, s: limitar(hsl.s * 0.8, 0.3, 0.65), l });
}
/** Borda: claras viram separadores finos; bordas da marca (seleção) ficam em rosé. */
function borda(hex) {
  const hsl = rgbParaHsl(hexParaRgb(hex));
  if (hsl.l >= 0.75) return hsl.s < 0.3 ? PALETA.borda : hslParaHex({ h: matizRose(hsl.h), s: limitar(hsl.s * 0.25, 0.1, 0.22), l: 0.26 });
  if (ehMarca(hsl)) return hslParaHex({ h: 346, s: 0.5, l: 0.62 });
  return hslParaHex({ h: hsl.h, s: limitar(hsl.s * 0.8, 0.2, 0.6), l: limitar(hsl.l * 1.6, 0.45, 0.66) });
}
const PAPEIS = { bg: fundo, text: texto, border: borda, from: fundo, via: fundo, to: fundo, fill: texto, stroke: texto, ring: borda, outline: borda, divide: borda, placeholder: texto, decoration: texto, caret: texto, accent: texto };

function comAlfa(hex, alfa) {
  const { r, g, b } = hexParaRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alfa})`;
}

// ── classes Tailwind com hex ────────────────────────────────────────────────
function arquivos(caminho) {
  const abs = join(RAIZ, caminho);
  if (!statSync(abs).isDirectory()) return [abs];
  return readdirSync(abs).flatMap((nome) => arquivos(join(caminho, nome))).filter((f) => /\.(tsx?|ts)$/.test(f) && !/\.test\./.test(f));
}
// O carrossel de campanhas é arte fotográfica com cores próprias: fica igual nos dois temas.
const IGNORAR = /home[\\/](HomeCampaign|homeCampaigns)/;
const fontes = FONTES.flatMap(arquivos).filter((f) => !IGNORAR.test(f));
const RE_CLASSE = /(?<![\w-])((?:[a-z-]+:)*)(bg|text|border(?:-[trblxy])?|from|via|to|fill|stroke|ring|outline|divide|placeholder|decoration|caret|accent)-\[(#[0-9A-Fa-f]{3,8})\](?:\/(\d{1,3}))?/g;
const RE_ESTILO = /\b(background|backgroundColor|color|borderColor|fill|stroke)\s*:\s*["'](#[0-9A-Fa-f]{6})["']/g;
const RE_OBJ_COR = /\b(fundo|bg|iconeFundo|cor|color|icone|destaque|texto|borda|border)\s*:\s*["'](#[0-9A-Fa-f]{6})["']/g;
const RE_ATRIBUTO = /\b(fill|stroke)=["'](#[0-9A-Fa-f]{3,6})["']/g;

const escapar = (s) => s.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
const PSEUDOS = { hover: ":hover", focus: ":focus", "focus-visible": ":focus-visible", active: ":active", disabled: ":disabled", "group-hover": null, placeholder: "::placeholder" };

const regras = new Map();
function regra(seletor, decl) {
  regras.set(seletor, decl);
}

for (const arquivo of fontes) {
  const codigo = readFileSync(arquivo, "utf8");
  for (const m of codigo.matchAll(RE_CLASSE)) {
    const [classe, variantes, prop, hex, alfa] = m;
    if (variantes.includes("dark:")) continue;
    const papel = prop.startsWith("border") ? "border" : prop;
    const nova = PAPEIS[papel](hex);
    const valor = alfa ? comAlfa(nova, Number(alfa) / 100) : nova;
    let pseudo = "";
    let ok = true;
    for (const v of variantes.split(":").filter(Boolean)) {
      if (!(v in PSEUDOS)) { if (!/^(sm|md|lg|xl)$/.test(v)) ok = false; continue; }
      if (PSEUDOS[v] === null) { ok = false; break; }
      pseudo += PSEUDOS[v];
    }
    if (!ok) continue;
    const seletor = `${ESCOPO} .${escapar(classe)}${prop === "placeholder" ? "::placeholder" : pseudo}`;
    const decl = {
      bg: `background-color: ${valor}`,
      text: `color: ${valor}`,
      border: `border-color: ${valor}`,
      from: `--tw-gradient-from: ${valor} var(--tw-gradient-from-position); --tw-gradient-to: transparent var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to)`,
      via: `--tw-gradient-to: transparent var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), ${valor} var(--tw-gradient-via-position), var(--tw-gradient-to)`,
      to: `--tw-gradient-to: ${valor} var(--tw-gradient-to-position)`,
      fill: `fill: ${valor}`,
      stroke: `stroke: ${valor}`,
      ring: `--tw-ring-color: ${valor}`,
      outline: `outline-color: ${valor}`,
      divide: `border-color: ${valor}`,
      placeholder: `color: ${valor}`,
      decoration: `text-decoration-color: ${valor}`,
      caret: `caret-color: ${valor}`,
      accent: `accent-color: ${valor}`,
    }[papel];
    regra(seletor, decl);
  }
  // Degradê com branco nomeado (from-white / via-white / to-white).
  for (const m of codigo.matchAll(/(?<![\w-])(from|via|to)-white(?![\w/-])/g)) {
    const [classe, prop] = m;
    const valor = fundo("#FFFFFF");
    const decl = { from: `--tw-gradient-from: ${valor} var(--tw-gradient-from-position); --tw-gradient-to: transparent var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to)`, via: `--tw-gradient-to: transparent var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), ${valor} var(--tw-gradient-via-position), var(--tw-gradient-to)`, to: `--tw-gradient-to: ${valor} var(--tw-gradient-to-position)` }[prop];
    regra(`${ESCOPO} .${escapar(classe)}`, decl);
  }
  // Branco nomeado de superfície (bg-white, bg-white/85, border-white...).
  for (const m of codigo.matchAll(/(?<![\w-])((?:hover:|active:)?)(bg|border)-white(?:\/(\d{1,3}))?(?![\w-])/g)) {
    const [classe, variante, prop, alfa] = m;
    if (alfa && Number(alfa) < 60) continue; // brilhos decorativos ficam como estão
    const cor = prop === "bg" ? fundo("#FFFFFF") : PALETA.cartao;
    const valor = alfa ? comAlfa(cor, Number(alfa) / 100) : cor;
    regra(`${ESCOPO} .${escapar(classe)}${variante ? ":" + variante.slice(0, -1) : ""}`, `${prop === "bg" ? "background-color" : "border-color"}: ${valor}`);
  }
  // Classes bg-[linear-gradient(...)] / bg-[radial-gradient(...)].
  // Classes bg-[linear-gradient(...)] / bg-[radial-gradient(...)].
  for (const m of codigo.matchAll(/(?<![\w-])bg-\[((?:linear|radial)-gradient\([^\]\s"'`]+\))\]/g)) {
    const [classe, gradiente] = m;
    const css = gradiente.replace(/_/g, " ");
    regra(`${ESCOPO} .${escapar(classe)}`, `background-image: ${css.replace(/#[0-9A-Fa-f]{3,8}\b/g, (hex) => fundo(hex))}`);
  }
  // Degradês em estilo inline (strings "linear-gradient(...)"): o navegador serializa
  // o atributo style com rgb(r, g, b) e ", " entre os argumentos.
  for (const m of codigo.matchAll(/["'`]((?:linear|radial)-gradient\((?:[^"'`$]|\$(?!\{))*\))["'`]/g)) {
    const gradiente = m[1];
    if (!/#[0-9A-Fa-f]{3,8}/.test(gradiente)) continue;
    const serializado = gradiente
      .replace(/#[0-9A-Fa-f]{3,8}\b/g, (hex) => { const { r, g, b } = hexParaRgb(hex); return `rgb(${r}, ${g}, ${b})`; })
      .replace(/\s*,\s*/g, ", ");
    const escuro = gradiente.replace(/#[0-9A-Fa-f]{3,8}\b/g, (hex) => fundo(hex));
    regra(`${ESCOPO} [style*="background: ${serializado}"]`, `background: ${escuro} !important`);
  }
  // Estilos inline (React serializa como rgb(r, g, b)); precisam de !important.
  // Qualquer string "#RRGGBB" do arquivo pode estar num style (inclusive em
  // ternários e objetos de tema), então cada uma gera as três versões — o
  // seletor só casa com a propriedade em que a cor realmente foi usada.
  for (const [, hex] of codigo.matchAll(/["'`](#[0-9A-Fa-f]{6})["'`]/g)) {
    const { r, g, b } = hexParaRgb(hex);
    const rgb = `rgb(${r}, ${g}, ${b})`;
    regra(`${ESCOPO} [style*="background: ${rgb}"], ${ESCOPO} [style*="background-color: ${rgb}"]`, `background: ${fundo(hex)} !important`);
    regra(`${ESCOPO} [style*="border-color: ${rgb}"]`, `border-color: ${borda(hex)} !important`);
    regra(`${ESCOPO} [style^="color: ${rgb}"], ${ESCOPO} [style*="; color: ${rgb}"]`, `color: ${texto(hex)} !important`);
  }
  for (const [, largura, hex] of codigo.matchAll(/["'`](\d+px) solid (#[0-9A-Fa-f]{6})["'`]/g)) {
    const { r, g, b } = hexParaRgb(hex);
    regra(`${ESCOPO} [style*="border: ${largura} solid rgb(${r}, ${g}, ${b})"]`, `border-color: ${borda(hex)} !important`);
  }
  // Classes com rgba(): border-[rgba(63,125,91,.12)], bg-[rgba(...)]...
  for (const m of codigo.matchAll(/(?<![\w-])(bg|text|border)-\[(rgba?\([^\]\s]+\))\]/g)) {
    const [classe, prop, cor] = m;
    const papel = prop === "border" ? "border" : prop;
    const token = corDeToken(cor);
    const novo = PAPEIS[papel](paraHex(token));
    const valor = token.a < 1 ? comAlfa(novo, token.a) : novo;
    regra(`${ESCOPO} .${escapar(classe)}`, `${{ bg: "background-color", text: "color", border: "border-color" }[papel]}: ${valor}`);
  }
  for (const [, attr, hex] of codigo.matchAll(RE_ATRIBUTO)) {
    const cores = [hex, hex.toLowerCase(), hex.toUpperCase()];
    regra([...new Set(cores)].map((c) => `${ESCOPO} [${attr}="${c}"]`).join(", "), `${attr}: ${texto(hex)}`);
  }
}

// ── CSS próprio do app (tab, menu, navegação, carrossel...) ────────────────
const RE_COR = /#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\)/g;
function corDeToken(token) {
  if (token.startsWith("#")) return hexParaRgb(token);
  const [r, g, b, a = "1"] = token.replace(/rgba?\(|\)/g, "").split(",").map((v) => v.trim());
  return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
}
function paraHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}
function transformarValor(valor, papel) {
  return valor.replace(RE_COR, (token) => {
    const cor = corDeToken(token);
    if (papel === "sombra") return `rgba(0, 0, 0, ${limitar(cor.a * 3, 0.18, 0.6).toFixed(2)})`;
    const novo = PAPEIS[papel](paraHex(cor));
    return cor.a < 1 ? comAlfa(novo, cor.a) : novo;
  });
}
function papelDaPropriedade(prop) {
  if (/^(background|background-color|background-image)$/.test(prop)) return "bg";
  if (/shadow/.test(prop)) return "sombra";
  if (/^border|outline/.test(prop)) return "border";
  if (/^(color|fill|stroke|caret-color|-webkit-text-fill-color)$/.test(prop)) return "text";
  return null;
}
function prefixar(seletor) {
  return seletor.split(",").map((s) => {
    const t = s.trim();
    if (t.startsWith("html")) return t.replace(/^html/, ESCOPO.replace(/^html/, "html"));
    if (t.startsWith(".dark")) return null;
    return `${ESCOPO} ${t}`;
  }).filter(Boolean).join(", ");
}

let cssGerado = "";
for (const caminho of CSS_FONTES) {
  const raiz = postcss.parse(readFileSync(join(RAIZ, caminho), "utf8"));
  const saida = postcss.root();
  raiz.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes/.test(rule.parent.name)) return;
    const decls = [];
    rule.walkDecls((decl) => {
      const papel = papelDaPropriedade(decl.prop);
      if (!papel || !RE_COR.test(decl.value)) { RE_COR.lastIndex = 0; return; }
      RE_COR.lastIndex = 0;
      decls.push(postcss.decl({ prop: decl.prop, value: transformarValor(decl.value, papel), important: decl.important }));
    });
    if (!decls.length) return;
    const seletor = prefixar(rule.selector);
    if (!seletor) return;
    const nova = postcss.rule({ selector: seletor });
    decls.forEach((d) => nova.append(d));
    if (rule.parent?.type === "atrule") {
      saida.append(postcss.atRule({ name: rule.parent.name, params: rule.parent.params }).append(nova));
    } else saida.append(nova);
  });
  cssGerado += `\n/* ${caminho} */\n${saida.toString()}\n`;
}

const cabecalho = `/* Gerado por scripts/tema-escuro-cliente.mjs — não editar à mão.
 * Modo escuro premium do app da cliente (${regras.size} regras de classes/estilos).
 * Ajustes finos que não saem da regra geral ficam em src/styles/client-dark.css. */
`;
const corpo = [...regras.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([s, d]) => `${s} { ${d}; }`).join("\n");
writeFileSync(join(RAIZ, SAIDA), `${cabecalho}\n${corpo}\n${cssGerado}`);
console.log(`${relative(RAIZ, join(RAIZ, SAIDA))}: ${regras.size} regras + CSS do app (${fontes.length} arquivos lidos)`);
