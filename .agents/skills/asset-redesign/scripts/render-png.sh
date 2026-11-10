#!/usr/bin/env bash
# Renders a square SVG icon to an exact size x size PNG, so raster icons always come from their SVG
# source and look the same whichever rasterizer this machine has. Transparency is kept: a maskable
# icon needs its own full-bleed background in the SVG.
# Usage: render-png.sh <input.svg> <output.png> <size-px>
set -euo pipefail

die() { echo "render-png.sh: $1" >&2; exit "${2:-1}"; }

[ "$#" -eq 3 ] || die "usage: render-png.sh <input.svg> <output.png> <size-px>" 2
in="$1" out="$2" size="$3"

[ -f "$in" ] || die "input not found: $in"
case "$size" in
  ''|0|*[!0-9]*) die "size must be a positive integer, got '$size'" 2 ;;
esac

if ! root_tag=$(tr '\n' ' ' < "$in" | grep -o '<svg[^>]*>' | head -n 1); then
  die "no <svg> element in $in"
fi
if ! view_box=$(printf '%s' "$root_tag" | grep -o 'viewBox="[^"]*"' | sed 's/viewBox="//; s/"$//'); then
  die "$in has no viewBox; AGENTS.md requires one"
fi
# Backends disagree on non-square input (rsvg stretches, resvg and magick letterbox), so refuse it.
if ! vb_width=$(printf '%s' "$view_box" | tr ',' ' ' | awk 'NF == 4 && $3 > 0 && $3 == $4 { print $3; ok = 1 } END { exit ok ? 0 : 1 }'); then
  die "$in viewBox '$view_box' is not square; icons must be square"
fi

if command -v rsvg-convert >/dev/null 2>&1; then
  rsvg-convert -w "$size" -h "$size" -o "$out" "$in"
elif command -v resvg >/dev/null 2>&1; then
  resvg -w "$size" -h "$size" "$in" "$out"
elif command -v magick >/dev/null 2>&1; then
  # One SVG unit is one pixel at 72 or 96 dpi depending on the delegate; twice the 72 dpi figure always rasterizes above the target, so it only scales down.
  density=$(awk -v s="$size" -v w="$vb_width" 'BEGIN { d = 2 * 72 * s / w; printf "%d", (d == int(d)) ? d : int(d) + 1 }')
  magick -background none -density "$density" "$in" -resize "${size}x${size}!" "$out"
else
  die "no SVG rasterizer found; install librsvg (brew install librsvg) or resvg"
fi

[ -s "$out" ] || die "rasterizer exited without writing $out"
echo "rendered $in -> $out (${size}x${size})"
