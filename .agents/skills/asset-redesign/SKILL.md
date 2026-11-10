---
name: asset-redesign
description: >-
  Audits and re-creates the visual assets of this static site: favicon and
  touch icons, the social preview image, per-section icons, illustrations,
  inline SVG, emoji used as icons, fonts and the CSS custom properties
  (colors, contrast, shadows) that style them. Use this skill when the user
  asks to review, audit, improve, restyle, re-create or replace any icon,
  image, illustration, color or other visual in this repo, or asks for the
  UI/UX designer.
---

# Asset redesign

You are this site's UI/UX designer. The binding rules (scope, medium, visual
system, originality, verification, delivery) are in the root `AGENTS.md`. This
skill is the workflow. Work in phases and stop at each gate. Do not skip ahead
to drawing.

Scripts (Node built-ins only, no install step, run from anywhere in the repo):

- [inventory.mjs](./scripts/inventory.mjs): every image and font file with its
  size, notes and what references it ("**none found**" means nothing does);
  local paths the pages ask for that do not exist; the icons and preview tags
  each page declares; the contrast of every token pair listed in
  [project.json](./resources/project.json), per theme, measuring translucent
  surfaces over every stop of the gradient beneath them; every request to
  another origin; and what CSS, inline SVG, emoji and script draw.
- [check-scope.mjs](./scripts/check-scope.mjs): classifies every change
  against the base branch as OK, REVIEW or BLOCKED per the `AGENTS.md` scope
  table. Edits inside an inline `<script>` (including JSON-LD) or to an inline
  event handler are BLOCKED; other markup edits are REVIEW. Exit 1 on BLOCKED,
  2 when it cannot run.
- [render-png.sh](./scripts/render-png.sh): square SVG to exact-size PNG.
  Needs `rsvg-convert` (`brew install librsvg`), `resvg` or ImageMagick.
- [pack-ico.mjs](./scripts/pack-ico.mjs): packs rendered PNGs (16, 32, 48)
  into `favicon.ico`.

Keep screenshots, concepts and before/after captures in your artifacts
directory, never in the repo.

## Phase 0: Preflight

1. The working tree must be clean and the base branch `AGENTS.md` names must
   be current (`git fetch origin`).
2. Serve the site as `AGENTS.md` describes, open every page, and save the
   browser console output to `<artifacts>/baseline.txt`. Phase 5 compares
   against it: a redesign adds no console error and no failed request.

## Phase 1: Inventory

1. Run `node .agents/skills/asset-redesign/scripts/inventory.mjs` and keep its
   output for the audit.
2. Screenshot every page and every state `AGENTS.md` lists (tabs, sections,
   overlays) at desktop (1440x900), tablet (834x1194) and phone (390x844)
   widths, in each theme the site has, plus the browser tab (favicon and title)
   on a light and a dark browser theme.
3. Render the social preview the way a chat app would: the image file at its
   real size, and cropped to the center square.

## Phase 2: Audit

Score every asset, every token pair and every captured screen against:

- **Fit:** does it say what the site is and who it is for? Is it a
  placeholder, a stock emoji standing in for an icon, a default font?
- **Consistency:** one icon family, one stroke weight, one corner radius, one
  palette; do siblings (the per-section icons, the favicon) look like a set?
- **Legibility:** do icons read at 16, 32, 180 and their on-page size? Does
  dense content (tables, rule lists, code) read at phone width?
- **Accessibility:** text contrast at least 4.5:1 (3:1 for text 24 px and up,
  icons and control borders); state never shown by color alone; decorative
  images `alt=""` or `aria-hidden`, meaningful ones labelled.
- **Craft:** blurry raster where SVG belongs, live `<text>` in an SVG mark,
  oversized files, a raster icon shipped at several times its display size.
- **Originality and licensing:** anything close to another product's mark or
  trade dress, unknown provenance, a license notice that no longer matches the
  file (see `AGENTS.md`).
- **Reachability:** can the fix be done in scope? Anything that needs a script,
  copy or content change goes under "Needs a logic change", not in the plan.

Write the result to `docs/design/audit.md` using
[audit-template.md](./resources/audit-template.md): one row per finding with a
stable number, the evidence you saw (screenshot name or inventory line), a
priority (P1 broken, missing or off-brand; P2 inconsistent; P3 polish), a
one-line plan with the medium from `AGENTS.md`, and status `open`. Record only
problems you observed.

**Gate 1.** On branch `design/audit` from the base branch, commit only
`docs/design/audit.md` (`docs(design): add visual asset audit`), push and open
a pull request. Stop and ask which rows to do. Redesign work starts only after
the audit is merged.

## Phase 3: Direction

For each approved asset family:

1. Generate 2-3 concept directions with `generate_image`: a moodboard, or a
   mockup of the real page with the new assets in place. Prompts describe the
   site, its readers and the current tokens from `AGENTS.md`. Never name
   another company, product, game, brand or artist in a prompt.
2. Present the concepts with the trade-offs of each, including what a token
   change would do to contrast in every theme.

**Gate 2.** Wait for the user to pick a direction. Concepts are never committed.

## Phase 4: Produce

Branch `design/<topic>` from the base branch that contains the audit.

- **Marks and icons.** Hand-written SVG on a square grid, as paths (no live
  `<text>`), colored with `currentColor` or token values. A set of icons shares
  one grid, stroke width and corner radius.
- **Raster files.** Render every PNG from its SVG source with
  `render-png.sh <svg> <png> <size>`, never by hand-exporting, and pack
  `favicon.ico` with `pack-ico.mjs` from the 16, 32 and 48 px renders.
- **Tokens.** Change colors in the CSS custom properties, in every theme block,
  never as new literals in rules. Re-run the inventory after each token change
  and keep every pair passing.
- **Illustrations from `generate_image`.** Crop, resize and convert to WebP
  under 200 KB in the asset folder `AGENTS.md` names, and add a provenance row
  to `docs/design/provenance.md` (file, "AI-generated (Antigravity
  generate_image)", date, prompt).
- **Wiring.** If a file name changes, update every reference the inventory
  listed for it. In HTML change only `src`/`href`, `class`, `alt` on decorative
  images, icon markup and the `<head>` tags `AGENTS.md` allows; never the text
  a reader sees.

## Phase 5: Verify

1. Run `node .agents/skills/asset-redesign/scripts/check-scope.mjs`. Revert
   every BLOCKED line unless it is an asset path you will justify in the PR.
   For each REVIEW line, re-read the diff and confirm no copy changed.
2. Re-run `inventory.mjs`: no MISSING path, no new "**none found**" row, no
   token pair newly failing, and no new request to another origin.
3. Serve the site again and compare the console with `<artifacts>/baseline.txt`.
4. Re-screenshot the Phase 1 screens at all three widths and themes, each icon
   at 16, 32, 180 and on-page size, and the tab on light and dark browser
   themes. Compare before and after side by side and fix regressions.

## Phase 6: Deliver

Every commit on the branch ends with the trailer
`Co-Authored-By: Antigravity <noreply@antigravity.google>` (see `AGENTS.md`;
`sh .agents/hooks/install.sh` adds a hook that appends it), and
`check-scope.mjs` blocks a commit that has no `Co-Authored-By` trailer.

In the same branch, set each closed row of `docs/design/audit.md` to
`done in #<PR>` (or `partly done` with a note). Commit with `feat(design): ...`
or `fix(design): ...`, push and open a pull request against the base branch
(draft if anything is unresolved). The PR body has:

- the audit rows it closes, by number,
- a table of changed assets with their medium (SVG / CSS / token / generated
  raster / font),
- before/after screenshots at the three widths and every theme, or their
  artifact paths for the user to attach,
- any provenance, credit or license change,
- the `check-scope.mjs` output with a justification for every BLOCKED or
  REVIEW line, and the console comparison from Phase 5.

Then report the link and any open questions to the user.
