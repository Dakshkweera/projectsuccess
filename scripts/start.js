// Dev launcher for `npm start` / `npm run dev`.
// Terminals hosted inside Electron apps (VS Code, Claude desktop, etc.) often
// export ELECTRON_RUN_AS_NODE=1. Electron then runs main.js as plain Node, so
// require('electron').app is undefined and the app quits instantly with code 0.
// Strip it (and its legacy alias) before spawning Electron.

const { spawn } = require('child_process');
const path = require('path');
const electronPath = require('electron'); // resolves to the electron binary path under Node

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ATOM_SHELL_INTERNAL_RUN_AS_NODE;

const child = spawn(electronPath, [path.join(__dirname, '..'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  windowsHide: false,
});

child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { if (!child.killed) child.kill(sig); });
}
