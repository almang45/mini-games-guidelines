// Helpers shared by inventory.mjs, check-scope.mjs and pack-ico.mjs. Node built-ins only: the site
// has no package.json, so the scripts must run on a bare checkout.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const IMAGE_EXT = new Set([".svg", ".png", ".webp", ".jpg", ".jpeg", ".gif", ".ico", ".avif"]);
export const FONT_EXT = new Set([".woff2", ".woff", ".ttf", ".otf"]);
export const SKILL_DIR = ".agents/skills/asset-redesign";
const PROJECT_FILE = `${SKILL_DIR}/resources/project.json`;

export class ToolError extends Error {}

// The skill sits at <root>/.agents/skills/asset-redesign/scripts, so the root is known without git.
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export function enterRepoRoot() {
  process.chdir(REPO_ROOT);
}

export function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr).trim() : err.message;
    throw new ToolError(`git ${args.join(" ")} failed: ${stderr}`);
  }
}

// Tracked files plus untracked ones that are not ignored, so new assets show up before they are committed.
export function listFiles() {
  return git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .split("\0")
    .filter(Boolean)
    .sort();
}

export const extOf = (file) => path.posix.extname(file).toLowerCase();

export function readProject() {
  try {
    return JSON.parse(readFileSync(PROJECT_FILE, "utf8"));
  } catch (err) {
    throw new ToolError(`cannot read ${PROJECT_FILE}: ${err.message}`);
  }
}

// A rule path matches itself and everything below it.
export function matchRule(rules, file) {
  return (rules || []).find((r) => file === r.path || file.startsWith(`${r.path.replace(/\/$/, "")}/`)) || null;
}

const SCRIPT_OPEN = /<script\b(?![^>]*\bsrc\s*=)[^>]*>/gi;
const STYLE_OPEN = /<style\b[^>]*>/gi;

// Inline <script> or <style> blocks of an HTML document, with 1-based inclusive line ranges and their text.
// JSON-LD and other data blocks count as script: they are content, not styling.
export function inlineBlocks(html, kind) {
  const open = new RegExp((kind === "script" ? SCRIPT_OPEN : STYLE_OPEN).source, "gi");
  const close = kind === "script" ? "</script>" : "</style>";
  const lower = html.toLowerCase();
  const blocks = [];
  let match;
  while ((match = open.exec(html)) !== null) {
    const start = match.index + match[0].length;
    const end = lower.indexOf(close, start);
    const stop = end === -1 ? html.length : end;
    blocks.push({ text: html.slice(start, stop), firstLine: lineAt(html, match.index), lastLine: lineAt(html, stop) });
    open.lastIndex = stop;
  }
  return blocks;
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

// Commits after base that name no co-author: every agent commit credits its agent (AGENTS.md).
export function commitsWithoutCoauthor(base) {
  return git(["log", "--no-merges", "--format=%h%x1f%s%x1f%B%x1e", `${base}..HEAD`])
    .split("\x1e")
    .map((rec) => rec.replace(/^\n/, ""))
    .filter(Boolean)
    .map((rec) => {
      const [sha, subject, body] = rec.split("\x1f");
      return { sha, subject, body: body || "" };
    })
    .filter((c) => !/^co-authored-by:\s*\S/im.test(c.body));
}

export function runMain(name, main) {
  try {
    const code = main();
    process.exitCode = typeof code === "number" ? code : 0;
  } catch (err) {
    console.error(`${name}: ${err instanceof ToolError ? err.message : err.stack}`);
    process.exitCode = 2;
  }
}
