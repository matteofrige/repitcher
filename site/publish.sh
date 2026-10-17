#!/usr/bin/env bash
# Pubblica site/ su GitHub Pages: copia i file pubblici nel repo REPO (branch main, radice) e fa push.
# Uso: bash site/publish.sh            (dopo aver modificato il sito)
set -euo pipefail
REPO=${REPO:-git@github.com:matteofrige/repitch-site.git}
SRC="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git clone --quiet --depth 1 "$REPO" "$WORK" 2>/dev/null || { git init --quiet -b main "$WORK"; git -C "$WORK" remote add origin "$REPO"; }
rsync -a --delete --exclude .git --exclude .claude --exclude review --exclude README.md --exclude publish.sh "$SRC/" "$WORK/"
cd "$WORK"
git add -A
if git diff --cached --quiet; then echo "Nessuna modifica da pubblicare."; exit 0; fi
git commit --quiet -m "Aggiorna sito $(date +%Y-%m-%d)"
git push --quiet -u origin main
echo "Pubblicato su $REPO"
