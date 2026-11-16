#!/bin/bash
# Replace the blocked Desktop AppleScript app with the working launcher
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_APP="$HOME/Desktop/AiOverlay.app"
LAUNCHER="$PROJECT_DIR/AiOverlay Launcher.app"

chmod +x "$PROJECT_DIR/launch.sh"
chmod +x "$PROJECT_DIR/Open AiOverlay.command"
chmod +x "$LAUNCHER/Contents/MacOS/launcher"

if [[ -d "$DESKTOP_APP" ]]; then
  rm -rf "$DESKTOP_APP"
fi

cp -R "$LAUNCHER" "$DESKTOP_APP"

cat > "$DESKTOP_APP/Contents/MacOS/launcher" <<EOF
#!/bin/bash
set -euo pipefail
PROJECT_DIR="$PROJECT_DIR"
ELECTRON_BIN="\$PROJECT_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [[ ! -x "\$ELECTRON_BIN" ]]; then
  osascript -e 'display alert "AiOverlay needs setup" message "Run npm install in the AiOverlay project folder first." as critical'
  exit 1
fi
pkill -f "\$PROJECT_DIR/node_modules/electron/dist/Electron.app" 2>/dev/null || true
exec "\$ELECTRON_BIN" "\$PROJECT_DIR"
EOF

chmod +x "$DESKTOP_APP/Contents/MacOS/launcher"
xattr -cr "$DESKTOP_APP" 2>/dev/null || true

echo "Installed working AiOverlay.app to Desktop."
echo "Project path: $PROJECT_DIR"
