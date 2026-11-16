# AiOverlay

A floating, always-on-top AI overlay for **macOS** and **Windows**. Toggle it with a global shortcut, take screenshots, and get instant AI responses — all invisible to screen share.

Supports **Ollama** (local), **Google Gemini**, and **Groq** as AI providers.

## Features

- 🎯 **Always-on-top overlay** — stays above all windows, invisible to screen share
- ⌨️ **Global shortcuts** — toggle, screenshot, auto-solve, switch models without touching the mouse
- 📸 **Screenshot capture** — grab your screen and ask AI about it (supports multi-image)
- 🦙 **Ollama** — run models 100% locally
- ✦ **Gemini** — Google's API with streaming
- ⚡ **Groq** — ultra-fast cloud inference
- 🔄 **Model switching** — cycle through models with keyboard shortcuts
- 🔒 **Content protection** — overlay is hidden from screen recordings

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [npm](https://www.npmjs.com/)

### Setup

```bash
git clone https://github.com/VividhDesign/ai-overlay.git
cd ai-overlay
npm install
```

### Run (Development)

```bash
npm start
```

### macOS — Desktop Launcher

```bash
chmod +x install-desktop-app.sh
./install-desktop-app.sh
```

Or double-click `Open AiOverlay.command`.

### Windows — Quick Launch

Double-click `launch.bat`.

The launcher will:

- use `dist\win-unpacked\AiOverlay.exe` when the Windows build exists
- install dependencies automatically if `node_modules` is missing
- avoid killing unrelated `electron.exe` processes

## Keyboard Shortcuts

| Action | macOS | Windows |
|---|---|---|
| Toggle overlay | `⌘⇧Space` | `Ctrl+Shift+Space` |
| Screenshot | `⌘⇧S` | `Ctrl+Shift+S` |
| Auto-solve screen | `⌘⇧A` | `Ctrl+Shift+A` |
| New chat | `⌘⇧N` globally, `⌘N` when focused | `Ctrl+Shift+N` globally, `Ctrl+N` when focused |
| Next model | `⌘⌥M` | `Ctrl+Alt+M` |
| Previous model | `⌘⌥N` | `Ctrl+Alt+N` |
| Move overlay left/right | `⌘⇧←/→` | `Ctrl+Shift+←/→` |
| Move overlay up/down | `⌘⇧↑/↓` | `Ctrl+Shift+↑/↓` |

## Modes

Start a message with a mode command to switch how the AI behaves for the rest of the chat:

| Command | Also works | Mode |
|---|---|---|
| `/0` | `/general` | Concise general assistant (default) |
| `/1` | `/dsa` | DSA coach: topic, brute force, bottleneck, optimal approach, C++17 code |
| `/2` | `/systemdesign` | Minimalist system design / LLD / machine-coding assistant |
| `/3`, `/4`, … | the project's name, e.g. `/nova` | Answers using one of your saved projects (see below) |

- `/1` on its own just sets the mode. `/1 two sum` sets it and sends "two sum".
- The mode's prompt is sent as a real **system prompt** on every request in the chat. The current mode shows as a badge (for example `/1 DSA`) next to the model name.
- A screenshot sent with no typed text uses a short mode-specific message ("solve what's in the screenshot").
- New chat (or switching provider) resets the mode to `/0`.
- Edit or add modes in the `MODES` table at the top of `renderer.js`.

## Projects (`/3`, `/4`, …)

Open ⚙ settings → **Projects**. Pick a project from the list or choose **➕ Add project**, give it a name (for example `Nova`) and describe it (what it does, stack, architecture, key modules, constraints, conventions; up to 60,000 characters). Press **Save**. Projects are saved locally.

Projects are numbered in the order they were added: the first is `/3`, the second `/4`, and so on. Type the number or the project's name (`/3`, `/nova`) in the chat; the badge shows `/3 Nova`. A project's text is sent only in its own mode, never in the others.

- **Delete** removes a project. The numbers after it move up by one.
- The whole description is sent with every message in that mode, so a very long one uses more tokens each time.

## Configuration

On first run, enter your API keys in the settings panel (gear icon):

- **Gemini API Key** — get one at [Google AI Studio](https://aistudio.google.com/)
- **Groq API Key** — get one at [Groq Console](https://console.groq.com/)
- **Ollama** — install from [ollama.ai](https://ollama.ai/) and run `ollama serve`

Keys are stored locally in Electron's app data config file and never sent anywhere except their respective APIs.

## Build

### macOS

```bash
npm run build
```

### Windows

```bash
npm run build:win
```

For a local unpacked build that `launch.bat` can run directly:

```bash
npm run build:win:dir
```

This project disables Windows executable signing/resource editing for the unpacked build so it works on normal Windows accounts that do not have symlink creation privileges.

## Verify on Windows

```bash
npm run verify:windows
```

This writes verification screenshots to `verification\`:

- `verification-overlay.png`
- `verification-screen.png`
- `verification-overlay-with-screenshot.png`

## Windows Portable Zip

A pre-packaged `AiOverlay-Windows.zip` is available in [Releases](../../releases). Extract, run `npm install`, then double-click `launch.bat`.

## License

MIT

## Author

[VividhDesign](https://github.com/VividhDesign)
