#!/usr/bin/env node
// Prints a Markdown inventory of every visual asset, the theme tokens and their contrast, what the
// pages load from other origins, and the code that draws visuals itself.
// Usage, from anywhere in the repo: node .agents/skills/asset-redesign/scripts/inventory.mjs
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  FONT_EXT, IMAGE_EXT, enterRepoRoot, extOf, inlineBlocks, listFiles, matchRule, readProject, runMain,
} from "./lib.mjs";

const CODE_EXT = new Set([".html", ".css", ".js", ".mjs", ".webmanifest", ".json", ".toml"]);
const ICON_MAX_PX = 512;
const RASTER_MAX_BYTES = 200 * 1024;
// Below this a PNG is almost certainly a flat fill or a stretched placeholder.
const FLAT_BYTES_PER_PX = 0.02;

runMain("inventory", () => {
  enterRepoRoot();
  const project = readProject();
  const files = listFiles();
  const sources = loadSources(files, project);
  const assets = files.filter((f) => IMAGE_EXT.has(extOf(f)) || FONT_EXT.has(extOf(f)));

  const out = [];
  out.push("## Image and font files", "");
  out.push("| File | Bytes | Size / viewBox | Notes | Used by | Docs |", "|---|---|---|---|---|---|");
  for (const file of assets) out.push(assetRow(file, sources, project));

  out.push("", "## Missing references", "");
  const missing = missingRefs(sources);
  if (missing.length) {
    out.push("| Referenced by | Path |", "|---|---|");
    for (const m of missing) out.push(`| \`${m.from}\` | \`${m.ref}\` |`);
  } else {
    out.push("None: every local path in the pages and stylesheets exists.");
  }

  out.push("", "## Icons declared in pages", "");
  out.push("| Page | Tag | Target | Notes |", "|---|---|---|---|");
  for (const row of declaredIcons(sources)) out.push(row);

  out.push("", "## Theme tokens and contrast", "");
  out.push(...contrastSection(sources, project));

  out.push("", "## Requests to other origins", "");
  const external = externalRequests(sources);
  if (external.length) {
    out.push("| File | Kind | URL |", "|---|---|---|");
    for (const e of external) out.push(`| \`${e.file}\` | ${e.kind} | ${e.url} |`);
  } else {
    out.push("None: the pages load nothing from another origin.");
  }

  out.push("", "## Code that draws visuals", "");
  out.push("Inline `<script>` and JS files are out of scope; they are listed so the audit sees what draws there.", "");
  out.push("| File | Lines of CSS | Gradients | Shadows | Data URIs | Inline SVG | Emoji | SVG/canvas drawn from JS | Inline script lines |");
  out.push("|---|---|---|---|---|---|---|---|---|");
  for (const src of sources.filter((s) => s.kind === "code")) {
    const row = visualRow(src);
    if (row) out.push(row);
  }

  out.push("", "## Protected paths", "");
  out.push("| Path | Why |", "|---|---|");
  for (const p of project.protected || []) out.push(`| \`${p.path}\` | ${p.why} |`);

  console.log(out.join("\n"));
  return 0;
});

function loadSources(files, project) {
  const sources = [];
  for (const file of files) {
    const ext = extOf(file);
    const isDoc = ext === ".md";
    if (!isDoc && !CODE_EXT.has(ext)) continue;
    if (file === "AGENTS.md" || file === "CLAUDE.md" || file.startsWith(".agents/")) continue;
    if (matchRule(project.protected, file) || !existsSync(file)) continue;
    const raw = readFileSync(file, "utf8");
    let text = raw;
    // The page's own absolute URLs (og:image) point at deployed files; read them as local paths.
    if (project.siteUrl) text = text.split(project.siteUrl).join("./");
    const scripts = ext === ".html" ? inlineBlocks(text, "script") : [];
    const styles = ext === ".html" ? inlineBlocks(text, "style") : [];
    let jsText = "";
    if (ext === ".js" || ext === ".mjs") jsText = text;
    else if (scripts.length) jsText = scripts.map((b) => b.text).join("\n");
    const css = ext === ".css" ? text : styles.map((b) => b.text).join("\n");
    sources.push({ file, ext, kind: isDoc ? "doc" : "code", raw, text, jsText, css, scripts, styles });
  }
  return sources;
}

function assetRow(file, sources, project) {
  if (!existsSync(file)) return `| \`${file}\` | MISSING | | tracked but deleted from the working tree | | |`;
  const buf = readFileSync(file);
  const bytes = statSync(file).size;
  const ext = extOf(file);
  const notes = [];
  let size = "";
  if (matchRule(project.protected, file)) notes.push("protected");
  if (ext === ".svg") {
    const info = svgInfo(buf.toString("utf8"));
    size = info.size;
    notes.push(...info.notes);
  } else if (IMAGE_EXT.has(ext)) {
    const dims = rasterSize(buf, ext);
    size = dims ? `${dims.w} x ${dims.h}` : "unknown";
    if (dims && dims.w !== dims.h) notes.push("non-square");
    if (dims && Math.max(dims.w, dims.h) > ICON_MAX_PX) notes.push(`over ${ICON_MAX_PX} px`);
    if (dims && ext === ".png" && bytes / (dims.w * dims.h) < FLAT_BYTES_PER_PX) notes.push("likely flat placeholder");
    if (ext === ".ico" && bytes < 512) notes.push("likely flat placeholder");
    if (bytes > RASTER_MAX_BYTES) notes.push("over 200 KB");
  }
  const refs = references(file, sources);
  const builds = project.sourceFiles && project.sourceFiles[file];
  if (builds) refs.code.push(`source of \`${builds}\``);
  return `| \`${file}\` | ${bytes} | ${size} | ${notes.join(", ")} | ${refs.code.join("<br>") || "**none found**"} | ${refs.docs.join(", ")} |`;
}

// Local paths in src/href attributes and CSS url() that do not exist on disk.
function missingRefs(sources) {
  const out = [];
  const seen = new Set();
  for (const src of sources.filter((s) => s.ext === ".html" || s.ext === ".css")) {
    const markup = src.ext === ".html" ? stripBlocks(src.text) : "";
    const refs = [
      ...[...markup.matchAll(/\b(?:src|href|content)\s*=\s*["']([^"'#?]+)/gi)].map((m) => m[1]),
      ...[...src.css.matchAll(/url\(\s*["']?([^"')#?]+)/gi)].map((m) => m[1]),
    ];
    for (const ref of refs) {
      if (/^(?:[a-z]+:|\/\/|#|mailto:)/i.test(ref) || !/\.[a-z0-9]{2,5}$/i.test(ref)) continue;
      const resolved = resolveLocal(src.file, ref);
      const key = `${src.file}|${resolved}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!existsSync(resolved)) out.push({ from: src.file, ref });
    }
  }
  return out;
}

// A root-relative path resolves against the folder the page is served from (the page's own folder).
function resolveLocal(fromFile, ref) {
  const dir = path.posix.dirname(fromFile);
  return ref.startsWith("/") ? path.posix.join(dir, ref) : path.posix.normalize(path.posix.join(dir, ref));
}

function declaredIcons(sources) {
  const rows = [];
  for (const src of sources.filter((s) => s.ext === ".html")) {
    const head = src.raw.split(/<\/head>/i)[0];
    for (const tag of head.match(/<link\b[^>]*rel\s*=\s*["'][^"']*(icon|manifest|mask)[^"']*["'][^>]*>/gi) || []) {
      const href = (tag.match(/\bhref\s*=\s*(["'])(.*?)\1/i) || [])[2] || "";
      const notes = [];
      let target = href;
      if (href.startsWith("data:")) {
        target = `data URI (${href.length} chars)`;
        const svg = decodeURIComponent(href.replace(/^data:image\/svg\+xml(;utf8)?,/i, ""));
        if (/<text\b/i.test(svg)) notes.push("live text: renders in whatever font the viewer has");
      }
      rows.push(`| \`${src.file}\` | \`${tag.replace(/\s+href\s*=\s*(["']).*?\1/i, "").replace(/\|/g, "\\|")}\` | ${target.replace(/\|/g, "\\|")} | ${notes.join(", ")} |`);
    }
    for (const tag of head.match(/<meta\b[^>]*(theme-color|og:image|twitter:image)[^>]*>/gi) || []) {
      rows.push(`| \`${src.file}\` | \`${tag.replace(/\|/g, "\\|")}\` | | |`);
    }
    if (!/rel\s*=\s*["']apple-touch-icon/i.test(head)) rows.push(`| \`${src.file}\` | (none) | apple-touch-icon | not declared |`);
  }
  return rows;
}

// ---- contrast ----

function contrastSection(sources, project) {
  const themes = collectTokens(sources);
  const out = [];
  if (!themes.size) return ["No CSS custom properties found."];
  out.push("Tokens per theme selector:", "");
  for (const [selector, tokens] of themes) {
    out.push(`- \`${selector}\`: ${[...tokens].map(([k, v]) => `\`${k}: ${v}\``).join(", ")}`);
  }
  const pairs = project.contrastPairs || [];
  if (!pairs.length) return out;
  out.push("", "| Theme | Text | On | Ratio | Needs | Result |", "|---|---|---|---|---|---|");
  const base = themes.get(":root") || new Map();
  for (const [selector, tokens] of themes) {
    for (const pair of pairs) {
      const merged = new Map([...base, ...tokens]);
      const fg = resolveColor(merged, pair.fg);
      const bgSpec = merged.get(pair.bg);
      if (!fg || bgSpec === undefined) continue;
      // A translucent surface is measured over each color of what sits under it (every gradient stop).
      const unders = pair.over ? backgroundColors(merged, merged.get(pair.over) || "", []) : [];
      const bgs = backgroundColors(merged, bgSpec, unders);
      const needs = pair.min || 4.5;
      if (!bgs.length || fg.a < 1) {
        out.push(`| \`${selector}\` | \`${pair.fg}\` | \`${pair.bg}\` | n/a | ${needs} | translucent: check in a screenshot |`);
        continue;
      }
      const ratio = Math.min(...bgs.map((bg) => contrast(fg, bg)));
      const label = bgs.length > 1 ? `${ratio.toFixed(2)} (worst gradient stop)` : ratio.toFixed(2);
      out.push(`| \`${selector}\` | \`${pair.fg}\` | \`${pair.bg}\` | ${label} | ${needs} | ${ratio >= needs ? "pass" : "**FAIL**"} |`);
    }
  }
  return out;
}

function collectTokens(sources) {
  const themes = new Map();
  for (const src of sources) {
    if (!src.css) continue;
    const css = src.css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim().replace(/\s+/g, " ");
      const decls = [...m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)];
      if (!decls.length) continue;
      const tokens = themes.get(selector) || new Map();
      for (const d of decls) {
        const value = d[2].trim();
        if (parseColor(value) || /gradient\(/.test(value) || /^var\(/.test(value)) tokens.set(d[1], value);
      }
      if (tokens.size) themes.set(selector, tokens);
    }
  }
  return themes;
}

function resolveColor(tokens, name, depth = 0) {
  const value = tokens.get(name);
  if (value === undefined || depth > 5) return null;
  const ref = value.match(/^var\(\s*(--[\w-]+)/);
  return ref ? resolveColor(tokens, ref[1], depth + 1) : parseColor(value);
}

function backgroundColors(tokens, spec, unders) {
  const ref = spec.match(/^var\(\s*(--[\w-]+)/);
  if (ref) return backgroundColors(tokens, tokens.get(ref[1]) || "", unders);
  const stops = /gradient\(/.test(spec) ? colorLiterals(spec) : [parseColor(spec)].filter(Boolean);
  return stops.flatMap((c) => (c.a < 1 ? unders.map((u) => blend(c, u)) : [c]));
}

function colorLiterals(text) {
  return (text.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) || []).map(parseColor).filter(Boolean);
}

function parseColor(value) {
  const v = value.trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
    if (hex.length !== 6 && hex.length !== 8) return null;
    const n = (i) => parseInt(hex.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
  }
  m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  if (v === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (v === "black") return { r: 0, g: 0, b: 0, a: 1 };
  return null;
}

function blend(top, under) {
  const mix = (k) => Math.round(top[k] * top.a + under[k] * (1 - top.a));
  return { r: mix("r"), g: mix("g"), b: mix("b"), a: 1 };
}

function luminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---- other origins ----

function externalRequests(sources) {
  const out = [];
  const add = (file, kind, url) => out.push({ file, kind, url });
  for (const src of sources.filter((s) => s.kind === "code")) {
    if (src.ext === ".html") {
      const markup = stripBlocks(src.text);
      for (const m of markup.matchAll(/<link\b[^>]*>/gi)) {
        const href = (m[0].match(/\bhref\s*=\s*["'](https?:[^"']+)/i) || [])[1];
        const rel = (m[0].match(/\brel\s*=\s*["']([^"']+)/i) || [])[1] || "";
        if (href && !/canonical|me|author|alternate/i.test(rel)) add(src.file, `link rel=${rel}`, href);
      }
      for (const m of markup.matchAll(/<(script|img|iframe|source|video|audio)\b[^>]*\bsrc\s*=\s*["'](https?:[^"']+)/gi)) {
        add(src.file, m[1].toLowerCase(), m[2]);
      }
    }
    for (const m of src.css.matchAll(/(@import\s+(?:url\()?|url\()\s*["']?(https?:[^"')\s]+)/gi)) add(src.file, "css", m[2]);
    for (const m of src.jsText.matchAll(/\bfetch\(\s*["'`](https?:[^"'`]+)/gi)) add(src.file, "fetch", m[1]);
  }
  return out;
}

function visualRow(src) {
  const markup = src.ext === ".html" ? stripBlocks(src.text) : "";
  const cssLines = src.css ? src.css.split("\n").length : 0;
  const count = (text, re) => (text.match(re) || []).length;
  const gradients = count(src.css, /gradient\(/g);
  const shadows = count(src.css, /box-shadow|text-shadow|drop-shadow\(/g);
  const dataUris = count(src.css, /url\(\s*["']?data:/g) + count(markup, /["']data:image\//g);
  const inlineSvg = count(markup, /<svg\b/gi);
  const emoji = count(markup + src.jsText, /\p{Extended_Pictographic}/gu);
  const drawn = count(src.jsText, /createElementNS\([^)]*svg|<svg\b|getContext\(\s*["']2d/gi);
  const scriptLines = src.scripts.reduce((n, b) => n + b.lastLine - b.firstLine + 1, 0);
  if (!cssLines && !inlineSvg && !drawn && !dataUris && !emoji) return null;
  return `| \`${src.file}\` | ${cssLines} | ${gradients} | ${shadows} | ${dataUris} | ${inlineSvg} | ${emoji} | ${drawn} | ${scriptLines} |`;
}

function stripBlocks(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}

function svgInfo(svg) {
  const notes = [];
  const root = (svg.match(/<svg\b[^>]*>/i) || [""])[0];
  const viewBox = root.match(/\bviewBox\s*=\s*["']([^"']+)["']/i);
  let size = "no viewBox";
  if (viewBox) {
    size = viewBox[1].trim();
    const [, , w, h] = size.split(/[\s,]+/).map(Number);
    if (w !== h) notes.push("non-square");
  } else {
    notes.push("no viewBox");
  }
  if (/\b(width|height)\s*=/.test(root)) notes.push("fixed width/height");
  if (/<image\b/i.test(svg)) notes.push("embedded raster");
  if (/<text\b/i.test(svg)) notes.push("live text");
  if (/sodipodi|inkscape:|<metadata\b|<!--\s*Generator/i.test(svg)) notes.push("editor metadata");
  if (/href\s*=\s*["']https?:/i.test(svg) || /@import|url\(\s*["']?https?:/i.test(svg)) notes.push("external reference");
  return { size, notes };
}

// Reads dimensions from the file header so the result does not depend on how file(1) formats them.
function rasterSize(buf, ext) {
  if (ext === ".png" && buf.length >= 24 && buf.toString("ascii", 1, 4) === "PNG") {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (ext === ".gif" && buf.length >= 10 && buf.toString("ascii", 0, 3) === "GIF") {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }
  if (ext === ".webp" && buf.length >= 30 && buf.toString("ascii", 8, 12) === "WEBP") return webpSize(buf);
  if (ext === ".jpg" || ext === ".jpeg") return jpegSize(buf);
  if (ext === ".ico" && buf.length >= 8) return { w: buf[6] || 256, h: buf[7] || 256 };
  return null;
}

function webpSize(buf) {
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
  return null;
}

function jpegSize(buf) {
  const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (SOF.has(marker)) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A path only counts when it is not the tail of a longer name: "icon.svg" must not match "favicon.svg".
function pathRe(p) {
  return new RegExp(`(?<![\\w./-])(?:\\./)?${escapeRe(p)}(?![\\w-])`);
}

// Paths a file may use for `target`. JS resolves URLs against the page that loads it, which lives in
// the game folder, so JS files also get candidates relative to their top-level folder.
function candidates(fromFile, target) {
  const dirs = new Set([path.posix.dirname(fromFile)]);
  if (fromFile.endsWith(".js") || fromFile.endsWith(".mjs")) {
    const top = fromFile.includes("/") ? fromFile.split("/")[0] : ".";
    dirs.add(top);
  }
  const out = new Set([target]);
  for (const dir of dirs) out.add(dir === "." ? target : path.posix.relative(dir, target));
  // A file inside the target folder yields an empty relative path, which would match anything.
  return [...out].filter((c) => c !== "" && c !== ".");
}

function references(asset, sources) {
  const code = [];
  const docs = [];
  const dir = path.posix.dirname(asset);
  const base = path.posix.basename(asset);
  const baseRe = pathRe(base);
  for (const src of sources) {
    if (src.kind === "doc") {
      // A bare file name in a doc only means this asset when the doc sits in the asset's own folder.
      const sameDir = path.posix.dirname(src.file) === dir;
      if (candidates(src.file, asset).some((c) => pathRe(c).test(src.text)) || (sameDir && baseRe.test(src.text))) docs.push(src.file);
      continue;
    }
    if (candidates(src.file, asset).some((c) => pathRe(c).test(src.text))) {
      code.push(src.file);
      continue;
    }
    if (!src.jsText) continue;
    // Runtime-built names (tile faces) only show up as a base folder string in script.
    const folderHit = dir !== "." && candidates(src.file, dir).some((c) =>
      new RegExp(`(?<![\\w./-])(?:\\./)?${escapeRe(c)}/["'\`]`).test(src.jsText));
    if (folderHit) code.push(`${src.file} (folder)`);
    else if (baseRe.test(src.jsText)) code.push(`${src.file} (by name)`);
  }
  return { code, docs };
}

