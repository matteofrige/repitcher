#!/usr/bin/env bash
# Converts the simulator captures (scripts/sim-screens.sh) into the landing page webp screenshots.
# Usage: bash mobile/scripts/site-shots.sh   (after sim-screens.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
IN=.impeccable/review
OUT=../site/assets
for name in intonazione-tab libreria player; do
  for theme in light dark; do
    cwebp -quiet -q 80 -resize 1000 0 "$IN/phone-$name-$theme.png" -o "$OUT/$name-$theme.webp"
    cwebp -quiet -q 80 -resize 1000 0 "$IN/en/phone-$name-$theme.png" -o "$OUT/en-$name-$theme.webp"
  done
done
ls -la "$OUT"/*.webp
