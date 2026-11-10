# Agent guide: Interactive Board Games Guidelines

A single static page of rules, scoring and scenarios for 11 tabletop and card
games (Unstable Unicorns, Monopoly Deal, Exploding Kittens, two Mahjong
variants and six classic card games). No build step, no dependencies, no
tests: `index.html`, `css/styles.css` and `js/app.js` (tabs, search, filters,
collapsible sections, the light/dark toggle).

## Repo rules (every agent, every task)

- The default branch is `master`. Never commit to or push it; work on a branch,
  one pull request per change.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
  `test:`). Commits are signed by the user's git config; never pass
  `--no-gpg-sign` or override the author.
- **Every commit Antigravity makes ends with the trailer
  `Co-Authored-By: Antigravity <noreply@antigravity.google>`**, including the
  amends, fixups and merge commits it creates; another agent adds its own
  trailer instead. Write it in the message yourself. As a backstop,
  `.agents/hooks/commit-msg` appends it when the commit comes from Antigravity
  (install once per clone with `sh .agents/hooks/install.sh`), and
  `check-scope.mjs` blocks a branch with any commit that has no
  `Co-Authored-By` trailer.
- Never commit screenshots, mockups, concept images, `.DS_Store` or local
  config.
- Rules content (`index.html` body text, `md/`) is the user's: correct a rule
  only when asked, and cite the source rulebook in the PR.

### Verification

There is no toolchain. Serve the folder and check the page works:

```bash
python3 -m http.server 8000   # from the repo root, then open http://localhost:8000/
```

Every tab opens, search and filters work, sections collapse, the theme toggle
switches and survives a reload, and the console shows no errors and no 404s.

## Role: UI/UX designer (visual asset work)

When the task is about how the page looks (favicon, the per-game icons,
illustrations, emoji used as icons, fonts, colors and contrast), you act as
the site's UI/UX designer. Follow the `asset-redesign` skill in
`.agents/skills/asset-redesign/` for the workflow. The rules below are binding
even when the skill is not loaded.

Today the 11 game icons in `img/icons/` are 128 px PNGs shown at 28 px (64
px in the game titles), `favicon.png` is a 128 px PNG, the theme toggle is an emoji set by
`js/app.js`, the light theme's header text sits on a gold-to-brown gradient at
about 2:1, and there is no apple-touch-icon or social preview image.
`inventory.mjs` lists the current state; trust it over this paragraph.

### Scope

| You may change | Limits |
|---|---|
| Image and font files in `img/` and the root (`favicon.*`, `apple-touch-icon.png`) | Not `img/mahjong/` (see below) |
| `css/styles.css` | Both themes (`:root` and `[data-theme="dark"]`), every token pair passing contrast |
| `index.html` markup | `src`/`href` of images and icons, `class`, `alt=""` on decorative images, icon markup, and in `<head>` the icon, `theme-color` and `og:image` tags. Never the text a reader sees, `id`s, `data-*` or `aria-controls` that `js/app.js` relies on, or an `on*` attribute |
| `docs/design/**`, and README / CREDITS / license files inside `img/` | |

- **Protected:** `img/mahjong/` is Wikimedia Commons artwork under CC BY-SA
  4.0, credited in the footer. Never redraw, replace or re-export a tile; a
  change there means a new license notice, which is the user's decision.
- Everything else is out of scope: `js/`, `md/`, the rules text,
  `.gitignore`, `.agents/`, `AGENTS.md`, `CLAUDE.md`. The theme toggle's emoji
  lives in `js/app.js`, so replacing it with an SVG icon is a logic change:
  record it under "Needs a logic change" in the audit.
- `node .agents/skills/asset-redesign/scripts/check-scope.mjs` enforces this
  table (it compares against `origin/master`). Run it before every commit; any
  BLOCKED line must be reverted, and every REVIEW line needs a sentence in the
  PR confirming no copy changed.

### Choosing the medium

| Asset | Medium |
|---|---|
| Favicon, touch icon, per-game icons | Hand-written SVG; PNG and ICO only where a file must be raster, rendered from that SVG with the skill's scripts |
| Decorative backgrounds, dividers, card chips | CSS or inline SVG, colored by tokens |
| Illustrations (a table-setup diagram, an empty state) | Hand-drawn SVG preferred; `generate_image` allowed, exported as WebP under 200 KB with a row in `docs/design/provenance.md` |
| Moodboards, concepts, mockups | `generate_image`, kept outside the repo, never committed |

`generate_image` output is raster: never ship it as an icon or favicon.

### Visual system

- Tokens are CSS custom properties at the top of `css/styles.css`: a light
  theme of parchment and gold on a `#d4a843` → `#8b5e34` gradient, and a dark
  "card table" theme of felt green (`#0f3d2e` → `#0a2e22`) with `#ffd166`
  accents. Playing-card surfaces (`--card-face`, `--card-border`,
  `--card-accent`) stay cream in both themes on purpose, like real cardstock.
- In the light theme `--text-accent` (`#b8860b`) is 1.8-3.2:1 on the panels
  and overlays it is used on, and `--text-white` header text is about 2:1 on the gradient.
  The dark theme passes. Text pairs reach 4.5:1 (3:1 at 24 px and up, and for
  icons and control borders); `inventory.mjs` reports every pair in
  `project.json`, translucent panels measured over each gradient stop.
- Fonts are the system stack. A web font is a new request on every load:
  propose it in the audit, self-hosted with its license, rather than adding a
  third-party link.
- The 11 game icons are one set: one grid, one stroke weight, one palette,
  readable at 28 px (`.game-icon`) and 64 px (`.game-title .game-icon`), and distinct from each
  other without color.
- SVG: a square `viewBox`, no fixed `width`/`height` in files, no embedded
  raster, no editor metadata, no external references, text converted to paths.

### Originality and licensing

- Unstable Unicorns, Monopoly Deal and Exploding Kittens are commercial games.
  An icon may hint at the game (a unicorn, a property card, a fuse), but never
  copy or imitate its logo, box art, card art, character designs or trade
  dress, and never put a game's name or logo in a prompt to `generate_image`.
- `img/icons/*.png` look AI-generated and `img/unstable-unicorns-tablesetup.png`
  has no recorded source. Record both as provenance findings in the audit; ask
  the user where the table-setup image came from before keeping, replacing or
  removing it.
- Every committed `generate_image` file has a provenance row, and every
  third-party file keeps its credit (the footer for the Mahjong tiles).

### Delivery

- The audit lands first, alone, on `design/audit`. Redesign branches start
  from a `master` that already contains it.
- Branch `design/<topic>`, one asset family per PR (favicon and touch icons,
  game icons, tokens and contrast, illustrations). Commit `feat(design): ...`
  or `fix(design): ...`.
- In the PR: the audit rows it closes with their status updated in
  `docs/design/audit.md`, every changed asset with its medium, before/after
  screenshots at desktop, tablet and phone widths in both themes, provenance
  and credit changes, and the `check-scope.mjs` output with a justification
  for each BLOCKED or REVIEW line.
