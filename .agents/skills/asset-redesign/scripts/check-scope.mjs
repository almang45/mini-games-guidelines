#!/usr/bin/env node
// Checks that a design branch only changes what AGENTS.md lets the UI/UX designer change.
// Usage: node .agents/skills/asset-redesign/scripts/check-scope.mjs [base-ref]
// Compares the working tree (committed, staged, unstaged and untracked) with base-ref, which defaults
// to the merge base of HEAD and project.json "baseRef". Exit 0: in scope. 1: blocked. 2: check failed.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FONT_EXT, IMAGE_EXT, ToolError, uncreditedCommits, enterRepoRoot, extOf, git, inlineBlocks, matchRule, readProject, runMain,
} from "./lib.mjs";

const DOC_NAMES = /^(README|CREDITS|LICEN[CS]E|OFL)(\.[a-z]+)?$/i;
// An inline handler is script even though it sits in markup.
const HANDLER_ATTR = /\son[a-z]+\s*=/i;

runMain("check-scope", () => {
  enterRepoRoot();
  const project = readProject();
  const base = process.argv[2] ? verifyRef(process.argv[2]) : mergeBase(project.baseRef);
  const results = changedFiles(base).map((change) => classify(change, base, project));
  const uncredited = uncreditedCommits(base);

  if (!results.length && !uncredited.length) {
    console.log(`No changes against ${base}.`);
    return 0;
  }
  console.log(`Scope check against ${base}\n`);
  if (results.length) {
    console.log("| Status | File | Why |\n|---|---|---|");
    for (const r of results) console.log(`| ${r.status} | \`${r.file}\` | ${r.why} |`);
  }
  if (uncredited.length) {
    console.log("\n| Status | Commit | Why |\n|---|---|---|");
    for (const c of uncredited) console.log(`| BLOCKED | \`${c.sha}\` ${c.subject} | ${c.why} |`);
  }

  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  const review = results.filter((r) => r.status === "REVIEW").length;
  console.log("");
  if (review) console.log(`${review} REVIEW file(s): allowed, but say in the PR what changed and that the listed limits hold.`);
  if (uncredited.length) {
    console.log(`${uncredited.length} commit(s) not credited as AGENTS.md asks: amend them (git commit --amend, or rebase -x for several) so each ends with "Assisted-by: Antigravity", or your own agent's trailer.`);
  }
  if (blocked) {
    console.log(`${blocked} BLOCKED file(s): revert them, or keep only an asset-path edit and justify it in the PR.`);
  }
  if (blocked || uncredited.length) return 1;
  console.log("All changes are in the designer's scope.");
  return 0;
});

function verifyRef(ref) {
  try {
    return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim();
  } catch {
    throw new ToolError(`base ref '${ref}' is not a commit`);
  }
}

function mergeBase(ref) {
  if (!ref) throw new ToolError("no base ref given and project.json has no baseRef");
  try {
    return git(["merge-base", "HEAD", ref]).trim();
  } catch (err) {
    throw new ToolError(`no base ref given and ${err.message}; run git fetch origin or pass a base ref`);
  }
}

function changedFiles(base) {
  const changes = [];
  const fields = git(["diff", "--name-status", "-z", "--find-renames", base]).split("\0").filter(Boolean);
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i][0];
    if (status === "R" || status === "C") {
      changes.push({ status: "D", file: fields[i + 1] });
      changes.push({ status: "A", file: fields[i + 2] });
      i += 2;
    } else {
      changes.push({ status, file: fields[i + 1] });
      i += 1;
    }
  }
  for (const file of git(["ls-files", "-z", "--others", "--exclude-standard"]).split("\0").filter(Boolean)) {
    changes.push({ status: "A", file });
  }
  return changes;
}

function classify({ status, file }, base, project) {
  const result = (s, why) => ({ status: s, file, why });
  const ext = extOf(file);

  const prot = matchRule(project.protected, file);
  if (prot) return result("BLOCKED", `protected: ${prot.why}`);
  const blocked = matchRule(project.blocked, file);
  if (blocked) return result("BLOCKED", blocked.why);
  const review = matchRule(project.review, file);
  if (review) return result("REVIEW", review.why);

  if (IMAGE_EXT.has(ext) || FONT_EXT.has(ext)) return result("OK", status === "D" ? "removed asset" : "visual asset");
  if (ext === ".css") return result("OK", "stylesheet");
  if (ext === ".md" || DOC_NAMES.test(path.posix.basename(file))) {
    if (file.startsWith("docs/design/")) return result("OK", "design doc");
    const dir = path.posix.dirname(file);
    const inAssetDir = (project.assetDirs || []).some((d) => dir === d || dir.startsWith(`${d}/`));
    if (inAssetDir && DOC_NAMES.test(path.posix.basename(file))) return result("OK", "credits or license beside assets");
    return result("BLOCKED", "content or docs outside docs/design");
  }
  if ((project.pages || []).includes(file)) return classifyPage(status, file, base);
  return result("BLOCKED", "outside the designer's scope");
}

function classifyPage(status, file, base) {
  const result = (s, why) => ({ status: s, file, why });
  if (status !== "M") return result("BLOCKED", status === "D" ? "page removed" : "page added");

  const now = readFileSync(file, "utf8");
  const before = git(["show", `${base}:${file}`]);
  const newScripts = inlineBlocks(now, "script");
  const oldScripts = inlineBlocks(before, "script");
  const newStyles = inlineBlocks(now, "style");
  const headEnd = lineOf(now, /<\/head>/i);

  const scriptHits = [];
  const handlerHits = [];
  const outside = [];
  for (const hunk of hunks(base, file)) {
    const newRange = hunk.newCount ? [hunk.newStart, hunk.newStart + hunk.newCount - 1] : null;
    const oldRange = hunk.oldCount ? [hunk.oldStart, hunk.oldStart + hunk.oldCount - 1] : null;
    const label = newRange ? `${newRange[0]}-${newRange[1]}` : `old ${oldRange[0]}-${oldRange[1]}`;
    if ((newRange && overlaps(newScripts, ...newRange)) || (oldRange && overlaps(oldScripts, ...oldRange))) {
      scriptHits.push(label);
    } else if (hunk.lines.some((l) => HANDLER_ATTR.test(l))) {
      handlerHits.push(label);
    } else if (!(newRange && inside(newStyles, ...newRange))) {
      outside.push(newRange && headEnd && newRange[1] < headEnd ? `${label} (head)` : label);
    }
  }
  if (scriptHits.length || handlerHits.length) {
    const parts = [];
    if (scriptHits.length) parts.push(`inline <script> changed at lines ${scriptHits.join(", ")}`);
    if (handlerHits.length) parts.push(`inline event handler changed at lines ${handlerHits.join(", ")}`);
    return result("BLOCKED", parts.join("; "));
  }
  if (outside.length) {
    return result("REVIEW", `markup changed at lines ${outside.join(", ")}: asset paths, classes, icon markup and allowed <head> tags only; no copy`);
  }
  return result("OK", "inline <style> only");
}

function hunks(base, file) {
  const out = [];
  const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
  let current = null;
  for (const line of git(["diff", "-U0", base, "--", file]).split("\n")) {
    const m = header.exec(line);
    if (m) {
      current = {
        oldStart: Number(m[1]), oldCount: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]), newCount: m[4] === undefined ? 1 : Number(m[4]), lines: [],
      };
      out.push(current);
    } else if (current && /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line)) {
      current.lines.push(line.slice(1));
    }
  }
  return out;
}

function overlaps(blocks, first, last) {
  return blocks.some((b) => first <= b.lastLine && last >= b.firstLine);
}

// Strictly inside a block's body, so editing the <style> tag itself still counts as markup.
function inside(blocks, first, last) {
  return blocks.some((b) => first > b.firstLine && last < b.lastLine);
}

function lineOf(text, re) {
  const m = re.exec(text);
  return m ? text.slice(0, m.index).split("\n").length : 0;
}

