#!/bin/sh
# Installs the commit-msg hook that adds the Antigravity co-author trailer. Hooks live in the
# repository's common git dir, so one install covers the main checkout and every worktree,
# including the ones Antigravity creates under ~/.gemini/antigravity/worktrees/.
# Usage, from anywhere in the repo: sh .agents/hooks/install.sh
set -eu

src_dir=$(cd "$(dirname "$0")" && pwd)
# --git-path honours core.hooksPath, so a repo that redirects its hooks gets them there.
hooks_dir=$(cd "$(git rev-parse --git-path hooks)" 2>/dev/null && pwd) || {
  mkdir -p "$(git rev-parse --git-path hooks)"
  hooks_dir=$(cd "$(git rev-parse --git-path hooks)" && pwd)
}
target="$hooks_dir/commit-msg"
marker='Antigravity co-author trailer'

if [ -f "$target" ] && ! grep -q "$marker" "$target"; then
  if [ -e "$hooks_dir/commit-msg.local" ]; then
    echo "install.sh: $target and commit-msg.local both exist; merge them by hand" >&2
    exit 1
  fi
  mv "$target" "$hooks_dir/commit-msg.local"
  echo "kept the existing hook as $hooks_dir/commit-msg.local (it still runs first)"
fi

cp "$src_dir/commit-msg" "$target"
chmod +x "$target"
echo "installed $target"
