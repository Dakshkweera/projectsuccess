#!/bin/bash
# AiOverlay launcher — runs the dev Electron binary (avoids blocked Desktop .app)
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

ELECTRON_BIN="$DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "Electron is not installed."
  echo "Run: npm install"
  exit 1
fi

# Kill stale instance so relaunch works cleanly
pkill -f "$DIR/node_modules/electron/dist/Electron.app" 2>/dev/null || true

exec "$ELECTRON_BIN" "$DIR"
