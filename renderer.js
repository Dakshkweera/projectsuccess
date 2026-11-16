// ─── Constants ────────────────────────────────────────────────────────────────
const OLLAMA_BASE  = 'http://localhost:11434';
const GEMINI_BASE  = 'https://generativelanguage.googleapis.com/v1beta';
const GROQ_BASE    = 'https://api.groq.com/openai/v1';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// ─── Modes ────────────────────────────────────────────────────────────────────
// Type /0 (general), /1 (dsa), /2 (systemdesign) or /3 (project) at the start of a
// message to switch mode. The names /general /dsa /systemdesign /project also work.
// `system` is sent as a real system prompt on every request in the conversation;
// `screenshotPrompt` is the short user message used when a screenshot is sent
// with no typed text.
const DEFAULT_MODE = 'general';

const MODES = {
  dsa: {
    num: 1,
    label: 'DSA',
    screenshotPrompt: 'The problem is in the screenshot. Solve it following your instructions.',
    system: [
      "You are a DSA coach. The user knows basic DSA and C++ and can implement solutions, but is seeing each problem for the first time.",
      "",
      "Before anything else, in ONE line state which topic/technique the problem uses (e.g. stack, binary search, DP, two pointers, greedy, graph), and in 1-2 lines briefly explain the approach, so the user gets a chance to try solving it first.",
      "",
      "Teach how to discover the solution, not just the answer. Explain in this order:",
      "1. Problem understanding - briefly clarify what is actually being asked.",
      "2. Key observation - what is the main thing to notice?",
      "3. Intuition - how can one naturally arrive at the solution?",
      "4. Brute force - the simplest approach, why it works, and its time and space complexity.",
      "5. Bottleneck - what makes brute force slow and what repeated work can be avoided.",
      "6. Pattern/technique - identify it and explain why it applies.",
      "7. Optimal approach - derive it from the brute-force bottleneck, step by step.",
      "8. Dry run - use a small but meaningful example.",
      "9. Complexity - time and space of the optimal approach.",
      "10. C++17 code - clean, simple, and efficient.",
      "11. Code explanation - briefly connect the important parts of the code to the approach.",
      "12. Learning takeaway - what clue helps recognize similar problems?",
      "",
      "Rules:",
      "- Focus on WHY the solution works and HOW the user could discover it themselves.",
      "- Do not jump directly to code. Show brute force, then its bottleneck, then derive the optimal solution.",
      "- Prefer a simple optimal concept over a complicated one.",
      "- Use clear bullet points/numbered steps, NOT long paragraphs.",
      "- If there are multiple approaches, briefly say why the optimal one is better.",
      "- Use C++17, in fenced ```cpp blocks.",
      "- Do NOT use LaTeX or math notation (no $...$, \\text, etc.). Write math in plain text, e.g. O(n), k-1, <=.",
    ].join("\n"),
  },

  general: {
    num: 0,
    label: 'General',
    screenshotPrompt: 'Look at the screenshot. Answer or solve whatever it shows; if it is unclear, briefly say what you see and what you assume.',
    system: [
      "You are a concise, accurate assistant shown in a small overlay panel.",
      "- Answer directly first, then add only the detail that is needed.",
      "- If the user sends a screenshot, work out what it shows (a question, code, an error, a form, etc.) and help with that.",
      "- Prefer short bullet points over long paragraphs.",
      "- Put code in fenced code blocks.",
      "- Do NOT use LaTeX or math notation (no $...$, \\text, etc.). Write math in plain text.",
    ].join("\n"),
  },

  systemdesign: {
    num: 2,
    label: 'System Design',
    screenshotPrompt: 'The problem is in the screenshot. Solve it following your instructions.',
    system: `Role: Minimalist System Design and Coding Assistant
You help users solve software design and coding problems from a fresher's perspective, especially interview-style LLD, machine coding, and small practical applications.
Your priority is to produce the simplest correct solution that satisfies the exact requirements.
1. Strict Simplicity Rules

* Always start with a minimal, beginner-friendly implementation.
* Implement only what the problem statement explicitly requires or what is essential for correctness.
* Do not add features just because they might be useful in a production application.
* Do not anticipate future requirements.
* Do not overengineer.
* Prefer a few simple functions over a complex architecture.
* Use classes only when they naturally represent entities or are genuinely useful.
* Do not introduce unnecessary services, managers, repositories, factories, interfaces, abstract classes, inheritance hierarchies, design patterns, or dependency injection.
* Do not create extra files merely to make the project look professional.
* Do not add support for extra input formats, configurations, or use cases unless the requirements demand them.
* Do not add excessive validation or defensive programming for situations outside the stated requirements.
* Avoid unnecessary comments, abstractions, imports, and helper functions.

A small problem should receive a small solution.
2. Understand the Requirements Before Coding
Before writing code:

1. Identify the required functionality.
2. Identify the input and output formats.
3. Extract the explicit business rules.
4. Identify essential edge cases.
5. Choose the simplest suitable data structures.
6. Decide the minimum number of functions, classes, and files required.

Do not add requirements that the user never mentioned.
If a requirement is ambiguous and materially changes the result, ask one concise question. Otherwise, make the simplest reasonable assumption and state it briefly.
3. Default Programming Language

* Use the language explicitly requested by the user.
* If no language is specified, default to C++.
* Write straightforward, readable code suitable for a fresher.
* Avoid advanced language features unless they materially simplify the solution.

4. File Structure Rules
Choose the file structure according to the actual size of the problem.

* A small script or CLI utility may be implemented in one file.
* Use multiple files only when separating responsibilities provides a clear benefit or the requirements specify it.
* Do not split every function into a separate file.
* Do not create a separate class or module for every concept.
* Always show the file tree before providing code when multiple files are needed.
* Provide complete code for each file, with consistent imports and filenames.

For a small CLI tool, a reasonable starting point might be:

* \`main.py\`: CLI and orchestration.
* \`logic.py\`: reusable business logic, only if useful.
* \`sample.json\`: input data.
* \`tests/\`: tests, if required.

This is an example, not a mandatory template. Use one file if that is simpler.
5. Implement Exactly What Is Required
For every function:

* Give it one clear purpose.
* Use the simplest correct algorithm.
* Handle the essential edge cases.
* Avoid unnecessary generalization.
* Do not support additional formats or behaviors without a requirement.
* Do not introduce complicated abstractions around simple operations.

For example, if the problem specifies ISO dates, do not implement a large collection of unrelated date formats. If it requires reading a JSON file, use the appropriate JSON library rather than building a generic input framework.
Do not silently change business rules. If a case such as an in-transit shipment is unspecified, explicitly identify the ambiguity instead of inventing a rule.
6. CLI Applications
For CLI problems:

* Implement only the commands requested.
* Parse the command and input file path.
* Keep command-line handling simple.
* Reuse common input-loading logic.
* Keep the business logic separate only as much as needed.
* Match the required output format exactly.
* Handle basic expected errors with clear messages.
* Avoid complex CLI frameworks unless they are needed.

Do not introduce databases, APIs, persistent storage, or background services when the problem only requires reading a local file and printing results.
7. Code Quality and Verification
Minimal code must still be correct.

* Check that the implementation satisfies every explicit requirement.
* Ensure functions, imports, and file references are consistent.
* Include tests when requested.
* Test the main use case and important edge cases.
* Do not generate a large test suite for a tiny exercise unless requested.
* Never claim code compiles or tests pass unless they have actually been verified.
* Do not use broad exception handling merely to hide errors.
* Prefer clear, specific error handling.

8. Incremental Improvement
Treat the first implementation as the baseline.
When the user asks for a new feature or improvement:

1. Understand the requested change.
2. Modify the existing solution.
3. Preserve existing behavior unless the user asks to change it.
4. Add only the code needed for the new requirement.
5. Explain the changes briefly.
6. Do not rewrite unrelated parts of the project.
7. Do not introduce additional improvements that the user did not request.

Do not implement hypothetical future features in advance.
9. Response Format
For a coding problem, normally provide:

1. A brief understanding of the problem.
2. The minimal design.
3. The file structure, if multiple files are justified.
4. Complete code.
5. Commands to compile or run it.
6. A small example of expected output.
7. Essential tests, when appropriate.

Keep explanations concise and beginner-friendly. Skip irrelevant sections. For simple problems, do not produce a lengthy architecture document.
For a design-only question, focus on the design rather than generating code automatically unless code is requested or clearly expected.
10. Final Decision Rule
Before adding any class, function, file, library, abstraction, feature, or validation rule, ask:
"Is this necessary to satisfy the stated requirements, or does it make the solution materially clearer?"
If neither applies, do not add it.
Always choose the smallest correct fresher-level solution first. Wait for the user to request more sophisticated design or additional functionality before expanding it.`,
  },

};

// ─── Platform-aware shortcut symbols ──────────────────────────────────────────
const isMac = navigator.platform.includes('Mac');
const MOD   = isMac ? '⌘' : 'Ctrl+';
const MOD_SHIFT = isMac ? '⌘⇧' : 'Ctrl+Shift+';
const MOD_ALT   = isMac ? '⌘⌥' : 'Ctrl+Alt+';
const shortcutLabels = {
  toggle: `${MOD_SHIFT}Space`,
  screenshot: `${MOD_SHIFT}S`,
  autoAnalyze: `${MOD_SHIFT}A`,
  newChat: `${MOD_SHIFT}N`,
  nextModel: `${MOD_ALT}M`,
  prevModel: `${MOD_ALT}N`,
  moveLeft: `${MOD_SHIFT}←`,
  moveRight: `${MOD_SHIFT}→`,
  moveUp: `${MOD_SHIFT}↑`,
  moveDown: `${MOD_SHIFT}↓`,
};

// Gemini models — fetched dynamically, these are fallbacks (only used if the
// live model list can't be fetched). "-latest" aliases never get deprecated.
const GEMINI_FALLBACK_MODELS = [
  { id: 'gemini-flash-latest',      name: 'Gemini Flash (latest) ⚡'      },
  { id: 'gemini-flash-lite-latest', name: 'Gemini Flash Lite (latest) ⚡' },
  { id: 'gemini-pro-latest',        name: 'Gemini Pro (latest) 👁'        },
];

// Rank a Gemini model id so the newest, stable, usable one is chosen by default.
// Higher score = preferred. Prefers flash (fast) > stable over preview/exp >
// "-latest" aliases > higher version number. This avoids defaulting to an old,
// deprecated model like gemini-2.5-flash.
function geminiModelScore(id) {
  let s = 0;
  if (/flash/i.test(id)) s += 100000;                 // flash = fast, preferred
  if (!/preview|exp|thinking/i.test(id)) s += 10000;  // stable over preview/exp
  if (/latest/i.test(id)) s += 5000;                  // never-deprecating alias
  const m = id.match(/(\d+)\.(\d+)/);                  // higher version wins
  if (m) s += parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
  return s;
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const messagesEl       = document.getElementById('messages');
const inputEl          = document.getElementById('userInput');
const sendBtn          = document.getElementById('sendBtn');
const modelSelect      = document.getElementById('modelSelect');
const statusDot        = document.getElementById('statusDot');
const modelLabel       = document.getElementById('modelLabel');
const clearBtn         = document.getElementById('clearBtn');
const hideBtn          = document.getElementById('hideBtn');
const quitBtn          = document.getElementById('quitBtn');
const tabOllama        = document.getElementById('tabOllama');
const tabGemini        = document.getElementById('tabGemini');
const tabGroq          = document.getElementById('tabGroq');
const tabOpenrouter    = document.getElementById('tabOpenrouter');
const settingsBtn      = document.getElementById('settingsBtn');
const settingsPanel    = document.getElementById('settingsPanel');
const apiKeyInput      = document.getElementById('apiKeyInput');
const saveKeyBtn       = document.getElementById('saveKeyBtn');
const groqKeyInput     = document.getElementById('groqKeyInput');
const saveGroqKeyBtn   = document.getElementById('saveGroqKeyBtn');
const openrouterKeyInput   = document.getElementById('openrouterKeyInput');
const saveOpenrouterKeyBtn = document.getElementById('saveOpenrouterKeyBtn');
const screenshotPreview= document.getElementById('screenshotPreview');
const ssThumbnails     = document.getElementById('ssThumbnails');
const ssCount          = document.getElementById('ssCount');
const ssCountLabel     = document.getElementById('ssCountLabel');
const ssRemoveAll      = document.getElementById('ssRemoveAll');
const imgLimitBadge    = document.getElementById('imgLimitBadge');
const inputWrapper     = document.querySelector('.input-wrapper');
const welcomeTitle     = document.getElementById('welcomeTitle');
const welcomeIcon      = document.getElementById('welcomeIcon');
const shortcutHints    = document.getElementById('shortcutHints');
const ssShortcutHint   = document.getElementById('ssShortcutHint');
const captureBtn       = document.getElementById('captureBtn');
const autoAnalyzeBtn   = document.getElementById('autoAnalyzeBtn');
const voiceBtn         = document.getElementById('voiceBtn');
const voiceSourceSelect= document.getElementById('voiceSourceSelect');
const modeBadge        = document.getElementById('modeBadge');
const projectInput     = document.getElementById('projectInput');
const projectNameInput = document.getElementById('projectNameInput');
const projectSelect    = document.getElementById('projectSelect');
const deleteProjectBtn = document.getElementById('deleteProjectBtn');
const projectCount     = document.getElementById('projectCount');
const saveProjectBtn   = document.getElementById('saveProjectBtn');

// ─── Populate platform-aware shortcut labels ──────────────────────────────────
function refreshShortcutLabels() {
  if (shortcutHints) {
    shortcutHints.innerHTML = `<kbd>${shortcutLabels.toggle}</kbd> hide &nbsp;·&nbsp; <kbd>${shortcutLabels.screenshot}</kbd> screenshot &nbsp;·&nbsp; <kbd>${shortcutLabels.autoAnalyze}</kbd> auto-solve &nbsp;·&nbsp; <kbd>${shortcutLabels.nextModel}</kbd>/<kbd>${shortcutLabels.prevModel}</kbd> models &nbsp;·&nbsp; <kbd>${shortcutLabels.moveLeft}/${shortcutLabels.moveRight}</kbd> move<br><kbd>/0</kbd> general &nbsp;·&nbsp; <kbd>/1</kbd> dsa &nbsp;·&nbsp; <kbd>/2</kbd> system design &nbsp;·&nbsp; <kbd>/3</kbd>… projects`;
  }
  if (ssShortcutHint) {
    ssShortcutHint.innerHTML = `<kbd>${shortcutLabels.screenshot}</kbd>`;
  }
  clearBtn.title = `New chat (${shortcutLabels.newChat}; ${MOD}N when focused)`;
  hideBtn.title = `Hide (${shortcutLabels.toggle})`;
  if (captureBtn) captureBtn.title = `Screenshot (${shortcutLabels.screenshot})`;
  if (autoAnalyzeBtn) autoAnalyzeBtn.title = `Auto-analyze screen (${shortcutLabels.autoAnalyze})`;
}
refreshShortcutLabels();

// ─── State ────────────────────────────────────────────────────────────────────
let currentProvider    = 'gemini';   // 'ollama' | 'gemini' | 'groq'
let geminiApiKey       = '';
let groqApiKey         = '';
let openrouterApiKey   = '';
let voiceSource        = 'both';   // 'both' | 'mic' | 'system'
let conversationHistory= [];
let currentMode        = DEFAULT_MODE;   // key of MODES; reset on new chat
let projects           = [{ name: '', context: '' }];   // saved projects; projects[i] is mode /(3+i)
let isStreaming        = false;
let abortController    = null;   // cancels in-flight stream
let pendingScreenshots = [];  // array of base64 data URLs
let welcomeEl          = document.getElementById('welcomeEl');
let screenPermissionNotice = null;


const hideTrayCheckbox  = document.getElementById('hideTrayCheckbox');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const config = await window.electronAPI.getConfig();
  geminiApiKey = config.geminiApiKey || '';
  if (geminiApiKey) apiKeyInput.value = geminiApiKey;
  groqApiKey = config.groqApiKey || '';
  if (groqApiKey) groqKeyInput.value = groqApiKey;
  openrouterApiKey = config.openrouterApiKey || '';
  if (openrouterApiKey) openrouterKeyInput.value = openrouterApiKey;
  projects = Array.isArray(config.projects)
    ? config.projects.map(p => ({ name: String(p.name || ''), context: String(p.context || '') }))
    : [];
  // Older versions saved a single project under projectName / projectContext.
  if (!projects.length && (config.projectName || config.projectContext)) {
    projects.push({ name: String(config.projectName || ''), context: String(config.projectContext || '') });
  }
  if (!projects.length) projects.push({ name: '', context: '' });
  renderProjectSelect();
  updateProjectCount();
  voiceSource = config.voiceSource || 'both';
  if (voiceSourceSelect) {
    voiceSourceSelect.value = voiceSource;
    voiceSourceSelect.addEventListener('change', async (e) => {
      voiceSource = e.target.value;
      const cfg = await window.electronAPI.getConfig();
      await window.electronAPI.saveConfig({ ...cfg, voiceSource });
    });
  }
  if (hideTrayCheckbox) {
    hideTrayCheckbox.checked = config.hideTray !== false;
    hideTrayCheckbox.addEventListener('change', async (e) => {
      await window.electronAPI.toggleTray(e.target.checked);
      showInfo(e.target.checked ? '🙈 Menu bar icon hidden' : '👁 Menu bar icon visible');
    });
  }

  updateModeBadge();
  await switchProvider('gemini');
  inputEl.focus();
}

// ─── Provider switching ───────────────────────────────────────────────────────
tabOllama.addEventListener('click', () => switchProvider('ollama'));
tabGemini.addEventListener('click', () => switchProvider('gemini'));
tabGroq.addEventListener('click',   () => switchProvider('groq'));
tabOpenrouter.addEventListener('click', () => switchProvider('openrouter'));

async function switchProvider(p) {
  currentProvider = p;

  // Update tab styles
  tabOllama.classList.toggle('active', p === 'ollama');
  tabGemini.classList.toggle('active', p === 'gemini');
  tabGroq.classList.toggle('active',   p === 'groq');
  tabOpenrouter.classList.toggle('active', p === 'openrouter');

  // Update send button + input wrapper color
  sendBtn.classList.toggle('gemini-send', p === 'gemini');
  sendBtn.classList.toggle('groq-send',   p === 'groq');
  sendBtn.classList.toggle('openrouter-send', p === 'openrouter');
  inputWrapper.classList.toggle('gemini-focus', p === 'gemini');
  inputWrapper.classList.toggle('groq-focus',   p === 'groq');
  inputWrapper.classList.toggle('openrouter-focus', p === 'openrouter');

  // Update welcome screen
  if (welcomeEl && welcomeEl.parentNode) {
    welcomeIcon.textContent  = p === 'gemini' ? '✦' : p === 'groq' ? '⚡' : p === 'openrouter' ? '🔀' : '🦙';
    welcomeTitle.textContent = p === 'gemini' ? 'Gemini AI Assistant' : p === 'groq' ? 'Groq AI Assistant' : p === 'openrouter' ? 'OpenRouter AI Assistant' : 'Ollama AI Assistant';
  }

  // Clear chat when switching
  clearChat(false);

  if (p === 'ollama') {
    setStatus('');
    await loadOllamaModels();
  } else if (p === 'groq') {
    setStatus('groq-active');
    if (!groqApiKey) {
      modelSelect.innerHTML = '<option value="">Groq key needed</option>';
      updateModelLabel();
      // Don't force the settings panel open — keep the chat area full.
      // User opens it via the ⚙ gear when they want to add a key.
      showInfo('Click the ⚙ icon to add your Groq API key');
    } else {
      await loadGroqModels();
    }
  } else if (p === 'openrouter') {
    setStatus('openrouter-active');
    if (!openrouterApiKey) {
      modelSelect.innerHTML = '<option value="">OpenRouter key needed</option>';
      updateModelLabel();
      showInfo('Click the ⚙ icon to add your OpenRouter API key');
    } else {
      await loadOpenrouterModels();
    }
  } else {
    setStatus('gemini-active');
    if (!geminiApiKey) {
      modelSelect.innerHTML = '<option value="">Gemini key needed</option>';
      updateModelLabel();
      // Don't force the settings panel open — keep the chat area full.
      // User opens it via the ⚙ gear when they want to add a key.
      showInfo('Click the ⚙ icon to add your Gemini API key');
    } else {
      await loadGeminiModels();
    }
  }
}

// ─── Settings panel ───────────────────────────────────────────────────────────
settingsBtn.addEventListener('click', () => {
  settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
});

saveKeyBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) return;
  geminiApiKey = key;
  const config = await window.electronAPI.getConfig();
  await window.electronAPI.saveConfig({ ...config, geminiApiKey: key });
  settingsPanel.style.display = 'none';
  showInfo('✅ Gemini API key saved!');
  if (currentProvider === 'gemini') await loadGeminiModels();
});

saveGroqKeyBtn.addEventListener('click', async () => {
  const key = groqKeyInput.value.trim();
  if (!key) return;
  groqApiKey = key;
  const config = await window.electronAPI.getConfig();
  await window.electronAPI.saveConfig({ ...config, groqApiKey: key });
  settingsPanel.style.display = 'none';
  showInfo('✅ Groq API key saved!');
  if (currentProvider === 'groq') await loadGroqModels();
});

saveOpenrouterKeyBtn.addEventListener('click', async () => {
  const key = openrouterKeyInput.value.trim();
  if (!key) return;
  openrouterApiKey = key;
  const config = await window.electronAPI.getConfig();
  await window.electronAPI.saveConfig({ ...config, openrouterApiKey: key });
  settingsPanel.style.display = 'none';
  showInfo('✅ OpenRouter API key saved!');
  if (currentProvider === 'openrouter') await loadOpenrouterModels();
});

// ─── Known Ollama cloud models ────────────────────────────────────────────────
const OLLAMA_CLOUD_MODELS = [
  { id: 'minimax-m3:cloud',        name: 'MiniMax M3 ☁'       },
  { id: 'glm-5.2:cloud',           name: 'GLM-5.2 ☁'          },
  { id: 'kimi-k2.7-code:cloud',    name: 'Kimi K2.7 Code ☁'   },
  { id: 'nemotron-3-super:cloud',  name: 'Nemotron-3 Super ☁' },
];

// ─── Load Ollama models ───────────────────────────────────────────────────────
async function loadOllamaModels() {
  modelSelect.innerHTML = '<option value="">Loading…</option>';

  let localModels = [];
  let ollamaOnline = false;

  try {
    const res  = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    localModels  = data.models || [];
    ollamaOnline = true;
  } catch {
    // Ollama offline — still show cloud models
  }

  modelSelect.innerHTML = '';

  if (localModels.length) {
    const grpLocal = document.createElement('optgroup');
    grpLocal.label = '💾 Local';
    localModels.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.name;
      const isCloud  = /:cloud$/i.test(m.name);
      const isVision = /llava|vision|vl\b|vlm|moondream|gemma3|gemma4|qwen2-vl|minicpm|bakllava|phi3|phi4|internvl|cogvlm|idefics|paligemma|florence/i.test(m.name);
      const display  = m.name.replace(':latest', '').replace(':cloud', '');
      opt.textContent = display + (isCloud ? ' ☁' : '') + (isVision ? ' 👁' : '');
      grpLocal.appendChild(opt);
    });
    modelSelect.appendChild(grpLocal);
  }

  // Always show cloud models (skip any already returned by /api/tags)
  const localIds = new Set(localModels.map(m => m.name));
  const grpCloud = document.createElement('optgroup');
  grpCloud.label = '☁ Cloud (via Ollama)';
  OLLAMA_CLOUD_MODELS.forEach(m => {
    if (localIds.has(m.id)) return;
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    grpCloud.appendChild(opt);
  });
  if (grpCloud.children.length) modelSelect.appendChild(grpCloud);

  if (!modelSelect.options.length) {
    modelSelect.innerHTML = '<option value="">No models available</option>';
    setStatus('error');
    if (!ollamaOnline) showError('⚠️ Ollama is not running. Run: ollama serve');
    return;
  }

  setStatus(ollamaOnline ? 'online' : 'error');
  if (!ollamaOnline) showError('⚠️ Ollama offline — cloud models still selectable');
  updateModelLabel();
}

// ─── Load Gemini models ───────────────────────────────────────────────────────
async function loadGeminiModels() {
  modelSelect.innerHTML = '<option value="">Fetching Gemini models…</option>';

  let models = [];
  try {
    const res = await fetch(`${GEMINI_BASE}/models?key=${geminiApiKey}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    models = (data.models || [])
      .filter(m => {
        const methods = m.supportedGenerationMethods || [];
        return m.name && (methods.includes('generateContent') || methods.includes('streamGenerateContent'));
      })
      .map(m => {
        const id = m.name.replace(/^models\//, '');
        return { id, name: m.displayName || id };
      })
      .sort((a, b) => geminiModelScore(b.id) - geminiModelScore(a.id) || a.id.localeCompare(b.id));
  } catch {
    models = GEMINI_FALLBACK_MODELS;
  }

  if (!models.length) models = GEMINI_FALLBACK_MODELS;

  modelSelect.innerHTML = '';
  models.forEach((m, idx) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    if (idx === 0) opt.selected = true;
    modelSelect.appendChild(opt);
  });

  setStatus('gemini-active');
  updateModelLabel();
}

// ─── Load Groq models ─────────────────────────────────────────────────────────
const GROQ_FALLBACK_MODELS = [
  { id: 'llama-3.3-70b-versatile',        name: 'Llama 3.3 70B ⚡'           },
  { id: 'llama-3.1-8b-instant',           name: 'Llama 3.1 8B Instant ⚡'    },
  { id: 'llama-3.2-90b-vision-preview',   name: 'Llama 3.2 90B Vision 👁'    },
  { id: 'llama-3.2-11b-vision-preview',   name: 'Llama 3.2 11B Vision 👁'    },
  { id: 'gemma2-9b-it',                   name: 'Gemma2 9B'                  },
  { id: 'mixtral-8x7b-32768',             name: 'Mixtral 8x7B'               },
];

async function loadGroqModels() {
  if (!groqApiKey) return;
  modelSelect.innerHTML = '<option value="">Fetching Groq models…</option>';
  try {
    const res = await fetch(`${GROQ_BASE}/models`, {
      headers: { 'Authorization': `Bearer ${groqApiKey}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.data || []).filter(m => m.id && /llama|gemma|mixtral|whisper|qwen|deepseek/i.test(m.id));
    if (!models.length) throw new Error('No models');

    modelSelect.innerHTML = '';
    // Sort: vision models first, then by id
    models.sort((a, b) => {
      const av = /vision/i.test(a.id), bv = /vision/i.test(b.id);
      if (av && !bv) return -1; if (!av && bv) return 1;
      return a.id.localeCompare(b.id);
    });
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      const isVision = /vision|vl\b|vlm/i.test(m.id);
      opt.textContent = m.id + (isVision ? ' 👁' : '');
      modelSelect.appendChild(opt);
    });
    // Default to 70b versatile
    const best = [...modelSelect.options].find(o => /70b-versatile/i.test(o.value));
    if (best) best.selected = true;
    setStatus('groq-active');
    updateModelLabel();
  } catch {
    modelSelect.innerHTML = '';
    GROQ_FALLBACK_MODELS.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.name;
      modelSelect.appendChild(opt);
    });
    setStatus('groq-active');
    updateModelLabel();
  }
}

// ─── Load OpenRouter models (OpenAI-compatible) ──────────────────────────────
const OPENROUTER_FALLBACK_MODELS = [
  { id: 'google/gemma-4-31b-it:free',                       name: 'Gemma 4 31B (free) 👁' },
  { id: 'google/gemini-3.5-flash-lite',                     name: 'Gemini 3.5 Flash Lite 👁' },
  { id: 'google/gemini-3.5-flash',                          name: 'Gemini 3.5 Flash 👁' },
  { id: 'openai/gpt-4o-mini',                               name: 'GPT-4o mini 👁' },
  { id: 'anthropic/claude-sonnet-5.5',                      name: 'Claude Sonnet 5.5 👁' },
  { id: 'deepseek/deepseek-chat',                           name: 'DeepSeek Chat' },
];

async function loadOpenrouterModels() {
  if (!openrouterApiKey) return;
  modelSelect.innerHTML = '<option value="">Fetching OpenRouter models…</option>';
  try {
    const res = await fetch(`${OPENROUTER_BASE}/models`, {
      headers: { 'Authorization': `Bearer ${openrouterApiKey}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    let models = (data.data || []).filter(m => m && m.id).map(m => {
      const mods = (m.architecture && (m.architecture.input_modalities || m.architecture.modality)) || '';
      const modsStr = Array.isArray(mods) ? mods.join(',') : String(mods);
      const isVision = /image/i.test(modsStr) || /vision|-vl\b|llava|gpt-4o|gemini|claude-3|claude-sonnet|pixtral|qwen.*vl/i.test(m.id);
      const isFree = /:free$/i.test(m.id) || (m.pricing && String(m.pricing.prompt) === '0');
      return { id: m.id, name: m.name || m.id, isVision, isFree };
    });
    if (!models.length) throw new Error('No models');

    // Sort: free vision first, then free, then vision, then the rest — alpha within each.
    models.sort((a, b) => {
      const rank = m => (m.isFree ? 0 : 2) + (m.isVision ? -1 : 0);
      const r = rank(a) - rank(b);
      return r !== 0 ? r : a.id.localeCompare(b.id);
    });

    modelSelect.innerHTML = '';
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name + (m.isVision ? ' 👁' : '') + (m.isFree ? ' 🆓' : '');
      modelSelect.appendChild(opt);
    });
    // Default to a good free vision model if present, else first option.
    const pref = [...modelSelect.options].find(o => /gemini.*flash.*:free/i.test(o.value))
      || [...modelSelect.options].find(o => /vision.*:free/i.test(o.value))
      || [...modelSelect.options].find(o => /:free$/i.test(o.value));
    if (pref) pref.selected = true;
    setStatus('openrouter-active');
    updateModelLabel();
  } catch {
    modelSelect.innerHTML = '';
    OPENROUTER_FALLBACK_MODELS.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.name;
      modelSelect.appendChild(opt);
    });
    setStatus('openrouter-active');
    updateModelLabel();
  }
}

function setStatus(state) {
  statusDot.className = 'status-dot' + (state ? ' ' + state : '');
}

function updateModelLabel() {
  const val = modelSelect.value;
  if (!val) {
    modelLabel.textContent = 'No model selected';
    updateImgLimitBadge();
    return;
  }
  const name = val.replace(':latest', '');
  if (currentProvider === 'gemini') {
    modelLabel.textContent = '✦ ' + name;
  } else if (currentProvider === 'groq') {
    const isVision = /vision|vl\b|vlm/i.test(val);
    modelLabel.textContent = '⚡ ' + name + (isVision ? ' · vision ✓' : '');
  } else if (currentProvider === 'openrouter') {
    const isVision = /vision|-vl\b|llava|gpt-4o|gemini|claude-3|claude-sonnet|pixtral|qwen.*vl/i.test(val);
    modelLabel.textContent = '🔀 ' + name + (isVision ? ' · vision ✓' : '');
  } else {
    const isCloud  = /:cloud$/i.test(val);
    const isVision = /llava|vision|vl\b|vlm|moondream|gemma3|gemma4|qwen2-vl|minicpm|bakllava|phi3|phi4|internvl|cogvlm|idefics|paligemma|florence/i.test(val);
    const cleanName = name.replace(':cloud', '');
    modelLabel.textContent = cleanName + (isCloud ? ' · ☁ cloud' : '') + (isVision ? ' · vision ✓' : '');
  }
  updateImgLimitBadge();
}

modelSelect.addEventListener('change', updateModelLabel);

// ─── Auto-resize textarea ──────────────────────────────────────────────────────
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
});

inputEl.addEventListener('keydown', (e) => {
  // Enter sends; Shift+Enter makes a new line.
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!isStreaming) sendMessage();
  }
});

sendBtn.addEventListener('click', () => {
  if (isStreaming) {
    // Stop the current stream
    if (abortController) abortController.abort();
  } else {
    sendMessage();
  }
});

// ─── Toolbar buttons ──────────────────────────────────────────────────────────
hideBtn.addEventListener('click', () => window.electronAPI.hideWindow());
quitBtn.addEventListener('click', () => window.electronAPI.quitApp());
// clearBtn wired below alongside onNewChat

// ─── Model image limits ────────────────────────────────────────────────
function getModelImageLimit(provider, modelId) {
  const id = (modelId || '').toLowerCase();
  if (provider === 'gemini') {
    return id.startsWith('gemini-') ? 16 : 0;
  }
  if (provider === 'groq') {
    const visionModels = ['llama-3.2', 'llama-4', 'llava', 'vision'];
    return visionModels.some(m => id.includes(m)) ? 1 : 0;
  }
  if (provider === 'ollama') {
    const visionKeywords = ['llava', 'vision', 'moondream', 'bakllava', 'minicpm', 'gemma3', 'qwen2-vl', 'qvq', 'cogvlm'];
    return visionKeywords.some(k => id.includes(k)) ? 1 : 0;
  }
  return 0;
}

function updateImgLimitBadge() {
  const limit = getModelImageLimit(currentProvider, modelSelect.value);
  if (limit > 0) {
    imgLimitBadge.textContent = `🖼 max ${limit} image${limit > 1 ? 's' : ''}`;
    imgLimitBadge.style.display = 'inline';
  } else {
    imgLimitBadge.style.display = 'none';
  }
}

modelSelect.addEventListener('change', updateImgLimitBadge);

// ─── Multi-thumbnail rendering ──────────────────────────────────────────
function renderScreenshotThumbnails() {
  ssThumbnails.innerHTML = '';
  pendingScreenshots.forEach((dataUrl, idx) => {
    const item = document.createElement('div');
    item.className = 'ss-thumb-item';
    item.innerHTML = `
      <img src="${dataUrl}" alt="image ${idx+1}" />
      <button class="ss-thumb-remove" title="Remove" data-idx="${idx}">×</button>
    `;
    item.querySelector('.ss-thumb-remove').addEventListener('click', () => {
      pendingScreenshots.splice(idx, 1);
      if (pendingScreenshots.length === 0) {
        screenshotPreview.style.display = 'none';
        inputEl.placeholder = 'Ask anything… (Enter to send, Shift+Enter for newline)';
      } else {
        renderScreenshotThumbnails();
      }
      inputEl.focus();
    });
    ssThumbnails.appendChild(item);
  });
  ssCount.textContent = pendingScreenshots.length;
  const s = pendingScreenshots.length === 1 ? '' : 's';
  if (ssCountLabel) ssCountLabel.textContent = ` image${s} attached`;
}

ssRemoveAll.addEventListener('click', () => {
  pendingScreenshots = [];
  screenshotPreview.style.display = 'none';
  ssThumbnails.innerHTML = '';
  inputEl.placeholder = 'Ask anything… (Enter to send, Shift+Enter for newline)';
  inputEl.focus();
});

if (captureBtn) {
  captureBtn.addEventListener('click', () => window.electronAPI.captureScreenshot());
}

if (autoAnalyzeBtn) {
  autoAnalyzeBtn.addEventListener('click', () => window.electronAPI.autoAnalyzeScreen());
}

// ─── Screenshot IPC ─────────────────────────────────────────────
window.electronAPI.onScreenshot((dataUrl) => {
  if (screenPermissionNotice?.isConnected) {
    screenPermissionNotice.remove();
    screenPermissionNotice = null;
  }
  const limit = getModelImageLimit(currentProvider, modelSelect.value);
  if (limit > 0 && pendingScreenshots.length >= limit) {
    showError(`⚠️ ${modelSelect.value} supports max ${limit} image${limit > 1 ? 's' : ''}. Remove one first.`);
    return;
  }
  pendingScreenshots.push(dataUrl);
  renderScreenshotThumbnails();
  screenshotPreview.style.display = 'block';
  if (welcomeEl && welcomeEl.parentNode) { welcomeEl.remove(); welcomeEl = null; }
  inputEl.placeholder = 'Ask about the image… or press Enter to auto-solve';
  inputEl.focus();
  scrollToBottom();
});

window.electronAPI.onScreenshotError((err) => {
  const isPermissionErr = err && (err.includes('denied') || err.includes('permission') || err.includes('Permission'));
  if (!isPermissionErr) {
    showError('Screenshot failed: ' + err);
    return;
  }

  const detail = screenPermissionNotice?.isConnected
    ? screenPermissionNotice.querySelector('[data-permission-detail]')
    : null;
  if (detail) {
    detail.textContent = err;
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return;
  }

  const errDiv = document.createElement('div');
  errDiv.className = 'msg assistant';
  errDiv.innerHTML = `
    <div class="bubble error-bubble" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);padding:12px 14px;border-radius:10px;">
      <div style="color:#f87171;font-weight:600;margin-bottom:6px;">📵 Screen Recording Permission Required</div>
      <div data-permission-detail style="color:#fca5a5;font-size:12px;margin-bottom:10px;"></div>
      <button type="button" data-open-privacy style="background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">
        Open System Settings → Screen Recording
      </button>
    </div>`;
  errDiv.querySelector('[data-permission-detail]').textContent = err;
  errDiv.querySelector('[data-open-privacy]').addEventListener('click', () => {
    window.electronAPI.openScreenRecordingSettings();
  });
  screenPermissionNotice = errDiv;
  messagesEl.appendChild(errDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

// Automated screen capture & auto-solve shortcut (Cmd+Shift+A)
window.electronAPI.onAutoAnalyzeScreen((dataUrl) => {
  // Append the auto-captured screenshot to any existing ones (e.g. from Cmd+Shift+S)
  // so screenshots already in the prompt are preserved and sent together.
  const limit = getModelImageLimit(currentProvider, modelSelect.value);
  if (limit > 0 && pendingScreenshots.length >= limit) {
    showError(`⚠️ ${modelSelect.value} supports max ${limit} image${limit > 1 ? 's' : ''}. Remove one first.`);
    return;
  }
  pendingScreenshots.push(dataUrl);
  renderScreenshotThumbnails();
  screenshotPreview.style.display = 'block';
  if (welcomeEl && welcomeEl.parentNode) { welcomeEl.remove(); welcomeEl = null; }

  // An empty input is fine: sendMessage() falls back to the current mode's
  // screenshot prompt, and a leading /mode command in the input is applied first.
  sendMessage();
});

// Cycle models passively via Cmd+Option+M (Next) and Cmd+Shift+N (Prev)
window.electronAPI.onCycleModel(() => {
  if (!modelSelect.options.length) return;
  const nextIdx = (modelSelect.selectedIndex + 1) % modelSelect.options.length;
  modelSelect.selectedIndex = nextIdx;
  updateModelLabel();
  const selectedName = modelSelect.options[nextIdx].textContent || modelSelect.value;
  showInfo(`🔄 Switched model to ${selectedName}`);
});

window.electronAPI.onPrevModel(() => {
  if (!modelSelect.options.length) return;
  const count = modelSelect.options.length;
  const prevIdx = (modelSelect.selectedIndex - 1 + count) % count;
  modelSelect.selectedIndex = prevIdx;
  updateModelLabel();
  const selectedName = modelSelect.options[prevIdx].textContent || modelSelect.value;
  showInfo(`🔄 Switched model to ${selectedName}`);
});

// See-through level changed via Ctrl/Cmd+Shift+Plus / Minus
window.electronAPI.onOpacityChanged((percent) => {
  showInfo(`${percent >= 100 ? '🔲' : '🫥'} Opacity ${percent}%`);
});

// When shown via the global hotkey, put the cursor in the input so the user
// can type immediately without clicking (keeps the mouse cursor out of sight).
window.electronAPI.onFocusInput(() => {
  inputEl.focus();
  // place caret at the end of any existing text
  const len = inputEl.value.length;
  try { inputEl.setSelectionRange(len, len); } catch {}
});

// ─── Voice input (mic + system audio → transcribe → send) ─────────────────────
let voiceRecording = false;
let mediaRecorder  = null;
let voiceChunks    = [];
let voiceStreams   = [];
let voiceAudioCtx  = null;

function setVoiceUI(on) {
  if (voiceBtn) voiceBtn.classList.toggle('recording', on);
  statusDot.classList.toggle('recording', on);
}

async function getVoiceStream() {
  const wantMic = voiceSource === 'mic' || voiceSource === 'both';
  const wantSys = voiceSource === 'system' || voiceSource === 'both';
  voiceStreams = [];
  const audioStreams = [];

  if (wantMic) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreams.push(mic);
      if (mic.getAudioTracks().length) audioStreams.push(mic);
    } catch (e) { if (voiceSource === 'mic') throw new Error('Microphone unavailable'); }
  }

  if (wantSys) {
    try {
      const sys = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      sys.getVideoTracks().forEach(t => t.stop()); // keep audio only
      voiceStreams.push(sys);
      if (sys.getAudioTracks().length) audioStreams.push(sys);
    } catch (e) { if (voiceSource === 'system') throw new Error('System audio unavailable'); }
  }

  if (!audioStreams.length) throw new Error('No audio captured — check mic/system audio');
  if (audioStreams.length === 1) return audioStreams[0];

  // Mix multiple audio sources into one stream.
  voiceAudioCtx = new AudioContext();
  const dest = voiceAudioCtx.createMediaStreamDestination();
  audioStreams.forEach(s => { try { voiceAudioCtx.createMediaStreamSource(s).connect(dest); } catch {} });
  return dest.stream;
}

async function startVoice() {
  if (voiceRecording) return;
  if (!groqApiKey && !geminiApiKey && !openrouterApiKey) {
    settingsPanel.style.display = 'block';
    showError('🎤 Add an OpenRouter, Groq, or Gemini API key to use voice'); return;
  }
  let stream;
  try { stream = await getVoiceStream(); }
  catch (e) { showError('🎤 ' + (e.message || 'Audio unavailable')); return; }

  voiceChunks = [];
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  try { mediaRecorder = new MediaRecorder(stream, { mimeType: mime }); }
  catch { mediaRecorder = new MediaRecorder(stream); }
  mediaRecorder.ondataavailable = e => { if (e.data && e.data.size) voiceChunks.push(e.data); };
  mediaRecorder.onstop = onVoiceStop;
  mediaRecorder.start();
  voiceRecording = true;
  setVoiceUI(true);
  showInfo('🎙️ Listening… press ' + (shortcutLabels.voice || 'Ctrl+Shift+L') + ' again to stop');
}

function stopVoice() {
  if (!voiceRecording) return;
  voiceRecording = false;
  setVoiceUI(false);
  try { mediaRecorder && mediaRecorder.stop(); } catch {}
  voiceStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
  voiceStreams = [];
  if (voiceAudioCtx) { try { voiceAudioCtx.close(); } catch {} voiceAudioCtx = null; }
}

async function onVoiceStop() {
  const blob = new Blob(voiceChunks, { type: 'audio/webm' });
  voiceChunks = [];
  if (!blob.size) { showError('No audio captured — try again'); return; }
  showInfo('📝 Transcribing…');
  let text = '';
  try { text = (await transcribeAudio(blob) || '').trim(); }
  catch (e) { showError('Transcription failed: ' + (e.message || '')); return; }
  if (!text) { showError('Didn’t catch that — try again'); return; }
  inputEl.value = inputEl.value.trim() ? (inputEl.value.trim() + ' ' + text) : text;
  sendMessage();
}

// A good, fast audio-capable model on OpenRouter for transcription.
const OPENROUTER_AUDIO_MODEL = 'google/gemini-2.5-flash';

async function transcribeViaOpenRouter(blob) {
  const wav = await webmToWav(blob);              // OpenRouter audio input wants wav/mp3
  const b64 = await blobToBase64(wav);
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openrouterApiKey}`,
      'HTTP-Referer': 'https://localhost/ai-overlay',
      'X-Title': 'AI Overlay',
    },
    body: JSON.stringify({
      model: OPENROUTER_AUDIO_MODEL,
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Transcribe this audio verbatim. Output only the transcription text, nothing else.' },
        { type: 'input_audio', input_audio: { data: b64, format: 'wav' } },
      ] }],
    }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
  const j = await res.json();
  const c = j.choices?.[0]?.message?.content;
  return Array.isArray(c) ? c.map(p => p.text || '').join('') : (c || '');
}

async function transcribeAudio(blob) {
  // Prefer OpenRouter when its key is present (uses a good audio model).
  if (openrouterApiKey) return transcribeViaOpenRouter(blob);
  // Groq Whisper is fastest; use it when a Groq key is present.
  if (groqApiKey) {
    const fd = new FormData();
    fd.append('file', blob, 'audio.webm');
    fd.append('model', 'whisper-large-v3-turbo');
    fd.append('response_format', 'json');
    const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqApiKey}` },
      body: fd,
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
    const j = await res.json();
    return j.text || '';
  }
  // Fallback: Gemini (convert to WAV, which Gemini accepts).
  const wav = await webmToWav(blob);
  const b64 = await blobToBase64(wav);
  const url = `${GEMINI_BASE}/models/gemini-flash-latest:generateContent?key=${geminiApiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [
      { text: 'Transcribe this audio verbatim. Output only the transcription, nothing else.' },
      { inline_data: { mime_type: 'audio/wav', data: b64 } },
    ] }] }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
  const j = await res.json();
  return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// Decode compressed audio and re-encode as 16-bit PCM WAV (for the Gemini path).
async function webmToWav(blob) {
  const ctx = new (window.OfflineAudioContext || window.AudioContext)(1, 1, 16000);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const ch = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate;
  const data = new Float32Array(len);
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) data[i] += d[i] / ch; }
  const out = new DataView(new ArrayBuffer(44 + len * 2));
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); out.setUint32(4, 36 + len * 2, true); wr(8, 'WAVE'); wr(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true);
  out.setUint16(34, 16, true); wr(36, 'data'); out.setUint32(40, len * 2, true);
  let o = 44; for (let i = 0; i < len; i++) { const s = Math.max(-1, Math.min(1, data[i])); out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2; }
  return new Blob([out], { type: 'audio/wav' });
}

function toggleVoice() { voiceRecording ? stopVoice() : startVoice(); }
if (voiceBtn) voiceBtn.addEventListener('click', toggleVoice);
window.electronAPI.onToggleVoice(() => toggleVoice());

// New Chat via ⌘N shortcut or button
window.electronAPI.onNewChat(() => clearChat(true));
clearBtn.addEventListener('click', () => clearChat(true));

window.electronAPI.onShortcutsUpdated(({ shortcuts = {}, failures = [] } = {}) => {
  Object.entries(shortcuts).forEach(([id, value]) => {
    if (value?.label) shortcutLabels[id] = value.label;
  });
  refreshShortcutLabels();

  if (failures.length) {
    const failed = failures.map(f => f.id).join(', ');
    showInfo(`Some global shortcuts are already in use: ${failed}. Button controls still work.`);
  }
});

// Keyboard scrolling of the chat area (so no mouse/cursor is needed).
// Alt+Up / Alt+Down scroll; Alt+Home / Alt+End jump to top/bottom.
document.addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const step = Math.max(120, Math.round(messagesEl.clientHeight * 0.6));
  autoPin = false;
  if (e.key === 'ArrowDown')      { e.preventDefault(); messagesEl.scrollTop += step; }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); messagesEl.scrollTop -= step; }
  else if (e.key === 'End')       { e.preventDefault(); messagesEl.scrollTop = messagesEl.scrollHeight; }
  else if (e.key === 'Home')      { e.preventDefault(); messagesEl.scrollTop = 0; }
});

document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  const hasMod = e.ctrlKey || e.metaKey;
  if (!hasMod) return;

  if (!e.altKey && !e.shiftKey && key === 'n') {
    e.preventDefault();
    clearChat(true);
  } else if (!e.altKey && e.shiftKey && key === 's') {
    e.preventDefault();
    window.electronAPI.captureScreenshot();
  } else if (!e.altKey && e.shiftKey && key === 'a') {
    e.preventDefault();
    window.electronAPI.autoAnalyzeScreen();
  }
});

// ─── Modes ────────────────────────────────────────────────────────────────────
// /0 /1 /2 come from MODES. Projects saved in settings follow as /3, /4, … in the
// order they were added. A mode id is 'general' | 'dsa' | 'systemdesign' | 'p0' |
// 'p1' | … where pN is projects[N].
function allModes() {
  const list = Object.keys(MODES).map(id => ({
    id, num: MODES[id].num, label: MODES[id].label, screenshotPrompt: MODES[id].screenshotPrompt,
  }));
  projects.forEach((p, i) => list.push({
    id: 'p' + i,
    num: 3 + i,
    label: p.name.trim() || `Project ${i + 1}`,
    project: p,
    screenshotPrompt: 'The screenshot is from my project. Help me with it, using the project context.',
  }));
  return list.sort((a, b) => a.num - b.num);
}

function getMode(id) {
  const modes = allModes();
  return modes.find(m => m.id === id) || modes[0];
}

// "/1 DSA", "/3 Nova"
function modeTag(m) {
  return `/${m.num} ${m.label}`;
}

// "/0 General · /1 DSA · /2 System Design · /3 Nova · /4 Dhanalysis"
function modeHelp() {
  return allModes().map(modeTag).join(' · ');
}

function updateModeBadge() {
  if (!modeBadge) return;
  modeBadge.textContent = modeTag(getMode(currentMode));
  modeBadge.title = modeHelp();
}

// The system prompt for the current mode. Built per request, so editing a project
// description applies to the next message. A project's text is only ever sent in
// that project's own mode.
function getSystemPrompt() {
  const mode = getMode(currentMode);
  if (!mode.project) return MODES[mode.id].system;

  const context = mode.project.context.trim();
  const name = mode.project.name.trim();
  let prompt = `You are an assistant for one specific software project${name ? ` called "${name}"` : ''} that the user is working on. ` +
    'Answer using the project description below as ground truth: use its names, tech stack, architecture, constraints and conventions, ' +
    'and do not ask for details it already gives. Be concise and practical; put code in fenced code blocks. ' +
    'If something you need is missing from the description, say what is missing instead of guessing.';
  prompt += context
    ? '\n\n<project>\n' + context + '\n</project>'
    : '\n\n(The user has not saved a project description yet.)';
  // Last, so it wins over any style advice inside the project text ("add detail", etc.).
  prompt += '\n\n# Output rules (these override any style instructions in the project description)\n' +
    '- Keep the answer short and in simple language.\n' +
    '- Tell only what is asked. No extra background, no long explanations.\n' +
    '- Use bullet points whenever possible.\n' +
    '- Give more detail only if the user asks for it.';
  return prompt;
}

// ─── Projects (settings form) ─────────────────────────────────────────────────
let editingProject = 0;   // index of the project shown in the settings form

function updateProjectCount() {
  projectCount.textContent = `${projectInput.value.length} / 60000`;
}
projectInput.addEventListener('input', updateProjectCount);

function isBlankProject(p) {
  return !p.name.trim() && !p.context.trim();
}

// Remove unsaved empty slots at the end (keeps at least one slot).
function dropBlankTrailing() {
  while (projects.length > 1 && isBlankProject(projects[projects.length - 1])) projects.pop();
}

function renderProjectSelect() {
  projectSelect.innerHTML = '';
  projects.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `/${3 + i} ${p.name.trim() || 'Project ' + (i + 1)}`;
    projectSelect.appendChild(opt);
  });
  const add = document.createElement('option');
  add.value = 'new';
  add.textContent = '➕ Add project';
  projectSelect.appendChild(add);

  projectSelect.value = String(editingProject);
  projectNameInput.value = projects[editingProject].name;
  projectInput.value = projects[editingProject].context;
  updateProjectCount();
  updateModeBadge();
}

projectSelect.addEventListener('change', () => {
  const target = projectSelect.value;
  dropBlankTrailing();
  if (target === 'new') {
    projects.push({ name: '', context: '' });
    editingProject = projects.length - 1;
  } else {
    editingProject = Math.min(Number(target), projects.length - 1);
  }
  renderProjectSelect();
});

async function persistProjects() {
  const config = await window.electronAPI.getConfig();
  const { projectName: _oldName, projectContext: _oldContext, ...rest } = config;   // drop the old single-project keys
  await window.electronAPI.saveConfig({ ...rest, projects: projects.filter(p => !isBlankProject(p)) });
}

async function deleteProject() {
  const removed = projects.splice(editingProject, 1)[0];
  if (!projects.length) projects.push({ name: '', context: '' });
  editingProject = 0;
  if (currentMode.startsWith('p')) currentMode = DEFAULT_MODE;
  await persistProjects();
  renderProjectSelect();
  showInfo(`📁 ${removed.name.trim() || 'Project'} deleted. Project numbers were re-assigned`);
}

saveProjectBtn.addEventListener('click', async () => {
  const entry = { name: projectNameInput.value.trim(), context: projectInput.value.trim() };
  if (isBlankProject(entry)) return deleteProject();
  projects[editingProject] = entry;
  await persistProjects();
  renderProjectSelect();
  settingsPanel.style.display = 'none';
  showInfo(`📁 ${entry.name || 'Project'} saved. Use /${3 + editingProject} to chat with it`);
});

deleteProjectBtn.addEventListener('click', deleteProject);

function setMode(key) {
  currentMode = key;
  updateModeBadge();
}

// If `text` starts with /<number> or /<name>, return { mode, rest }; an unknown
// /word returns { unknown } so it can be reported; otherwise null (a normal message).
// "/project" is kept as an alias for the first project.
function parseModeCommand(text) {
  const m = text.match(/^\/([a-z0-9_-]+)(?=\s|$)\s*([\s\S]*)$/i);
  if (!m) return null;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = norm(m[1]);
  const found = allModes().find(md => md.id === key || String(md.num) === key || norm(md.label) === key)
    || (key === 'project' ? allModes().find(md => md.project) : undefined);
  if (found) return { mode: found.id, rest: m[2].trim() };
  return { unknown: m[1] };
}

// ─── Clear chat ────────────────────────────────────────────────
function clearChat(showWelcome = true) {
  conversationHistory = [];
  pendingScreenshots  = [];
  screenPermissionNotice = null;
  setMode(DEFAULT_MODE);
  screenshotPreview.style.display = 'none';
  ssThumbnails.innerHTML = '';
  inputEl.placeholder = 'Ask anything… (Enter to send, Shift+Enter for newline)';
  messagesEl.innerHTML = '';

  if (showWelcome) {
    const el = document.createElement('div');
    el.id = 'welcomeEl';
    el.className = 'welcome';
    const icon  = currentProvider === 'gemini' ? '✦' : currentProvider === 'groq' ? '⚡' : currentProvider === 'openrouter' ? '🔀' : '🦙';
    const title = currentProvider === 'gemini' ? 'Gemini AI Assistant' : currentProvider === 'groq' ? 'Groq AI Assistant' : currentProvider === 'openrouter' ? 'OpenRouter AI Assistant' : 'Ollama AI Assistant';
    const sub   = currentProvider === 'groq' ? 'Ultra-fast inference · Invisible to screen share' : currentProvider === 'gemini' ? 'via Google API · Invisible to screen share' : currentProvider === 'openrouter' ? 'Any model via OpenRouter · Invisible to screen share' : '100% locally · Invisible to screen share';
    el.innerHTML = `
      <div class="welcome-icon">${icon}</div>
      <div class="welcome-title">${title}</div>
      <div class="welcome-sub">Running ${sub}</div>
      <div class="shortcut-hint"><kbd>${shortcutLabels.toggle}</kbd> hide &nbsp;·&nbsp; <kbd>${shortcutLabels.screenshot}</kbd> screenshot</div>
    `;
    messagesEl.appendChild(el);
    welcomeEl = el;
  }
}

// ─── SEND MESSAGE ────────────────────────────────────────────────
async function sendMessage() {
  let text = inputEl.value.trim();
  const hasImages = pendingScreenshots.length > 0;

  // "/0".."/9" or "/<name>" [optional message] switches the mode (see allModes()).
  const cmd = parseModeCommand(text);
  if (cmd) {
    if (cmd.unknown) {
      showError(`Unknown mode /${cmd.unknown}. Use: ${modeHelp()}`);
      return;
    }
    setMode(cmd.mode);
    text = cmd.rest;
    inputEl.value = text;
    const picked = getMode(cmd.mode);
    if (picked.project && !picked.project.context.trim()) {
      showError('📁 No project saved in this slot yet. Add it in ⚙ settings → Projects.');
    }
    if (!text && !hasImages) {
      inputEl.style.height = 'auto';
      showInfo(`Mode: ${modeTag(picked)}`);
      return;
    }
  }

  if (!text && !hasImages) return;

  const model = modelSelect.value;
  if (!model) { showError('Please select a model first.'); return; }
  if (currentProvider === 'gemini' && !geminiApiKey) {
    settingsPanel.style.display = 'block';
    showError('⚠️ Enter your Gemini API key first.'); return;
  }
  if (currentProvider === 'groq' && !groqApiKey) {
    settingsPanel.style.display = 'block';
    showError('⚠️ Enter your Groq API key first.'); return;
  }
  if (currentProvider === 'openrouter' && !openrouterApiKey) {
    settingsPanel.style.display = 'block';
    showError('⚠️ Enter your OpenRouter API key first.'); return;
  }

  const userText = text || getMode(currentMode).screenshotPrompt;

  if (welcomeEl && welcomeEl.parentNode) { welcomeEl.remove(); welcomeEl = null; }

  // Build history entry with all images
  const userMsg = { role: 'user', content: userText };
  if (hasImages) userMsg.images = pendingScreenshots.map(d => d.replace(/^data:image\/\w+;base64,/, ''));
  conversationHistory.push(userMsg);

  appendUserMessage(userText, hasImages ? [...pendingScreenshots] : []);

  // Reset input
  inputEl.value = '';
  inputEl.style.height = 'auto';
  inputEl.placeholder = 'Ask anything… (Enter to send, Shift+Enter for newline)';
  pendingScreenshots = [];
  screenshotPreview.style.display = 'none';
  ssThumbnails.innerHTML = '';

  autoPin = true;
  setStreaming(true);
  const typingEl = appendTyping();

  try {
    let fullResponse = '';

    abortController = new AbortController();
    const signal = abortController.signal;

    if (currentProvider === 'ollama') {
      fullResponse = await streamOllama(model, typingEl, signal);
    } else if (currentProvider === 'groq') {
      fullResponse = await streamGroq(model, typingEl, signal);
    } else if (currentProvider === 'openrouter') {
      fullResponse = await streamOpenrouter(model, typingEl, signal);
    } else {
      fullResponse = await streamGemini(model, typingEl, signal);
    }

    conversationHistory.push({ role: 'assistant', content: fullResponse });

  } catch (err) {
    if (err.name === 'AbortError') {
      // User stopped the stream — not an error, just clean up
      if (typingEl.parentNode) typingEl.remove();
    } else {
      if (typingEl.parentNode) typingEl.remove();
      const msg = err.message || 'Unknown error';
      const isVisionErr = /does not support|multimodal|image/i.test(msg);
      showError(isVisionErr
        ? '⚠️ This model doesn\'t support images. Use a vision model for screenshots.'
        : '❌ ' + msg
      );
    }
  } finally {
    abortController = null;
    setStreaming(false);
  }
}

// Ollama takes the system prompt as the first chat message.
function withSystem(history) {
  return [{ role: 'system', content: getSystemPrompt() }, ...history];
}

// ─── Ollama streaming ─────────────────────────────────────────────────────────
async function streamOllama(model, typingEl, signal) {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: withSystem(conversationHistory), stream: true }),
    signal,
  });

  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);

  const reader  = res.body.getReader();
  signal?.addEventListener('abort', () => reader.cancel());
  const decoder = new TextDecoder();

  typingEl.remove();
  const msgEl  = appendMessage('assistant', '');
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json.message?.content) {
          fullText += json.message.content;
          msgEl.querySelector('.bubble').innerHTML = formatMarkdown(fullText);
          pinMessageTop(msgEl);
        }
      } catch {}
    }
  }

  return fullText;
}

// ─── Gemini streaming (SSE) ───────────────────────────────────────────────────
async function streamGemini(model, typingEl, signal) {
  const url = `${GEMINI_BASE}/models/${model}:streamGenerateContent?alt=sse&key=${geminiApiKey}`;

  // Convert conversation to Gemini format
  const contents = conversationHistory.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: buildGeminiParts(msg),
  }));

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: getSystemPrompt() }] },
    }),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `HTTP ${res.status}`);
  }

  const reader  = res.body.getReader();
  signal?.addEventListener('abort', () => reader.cancel());
  const decoder = new TextDecoder();

  typingEl.remove();
  const msgEl  = appendMessage('assistant', '');
  let fullText = '';
  let buffer   = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const json = JSON.parse(raw);
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          fullText += text;
          msgEl.querySelector('.bubble').innerHTML = formatMarkdown(fullText);
          pinMessageTop(msgEl);
        }
      } catch {}
    }
  }

  return fullText;
}

// ─── Groq streaming (OpenAI-compatible SSE) ──────────────────────────────────────
async function streamGroq(model, typingEl, signal) {
  // Build messages in OpenAI format (no images for non-vision models)
  const messages = conversationHistory.map(msg => {
    if (msg.images && msg.images.length > 0) {
      // Vision message format
      return {
        role: msg.role,
        content: [
          { type: 'text', text: msg.content },
          ...msg.images.map(b64 => ({
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${b64}` },
          })),
        ],
      };
    }
    return { role: msg.role, content: msg.content };
  });
  messages.unshift({ role: 'system', content: getSystemPrompt() });

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${groqApiKey}`,
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `HTTP ${res.status}`);
  }

  const reader  = res.body.getReader();
  signal?.addEventListener('abort', () => reader.cancel());
  const decoder = new TextDecoder();

  typingEl.remove();
  const msgEl  = appendMessage('assistant', '');
  let fullText = '';
  let buffer   = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const json = JSON.parse(raw);
        const text = json.choices?.[0]?.delta?.content;
        if (text) {
          fullText += text;
          msgEl.querySelector('.bubble').innerHTML = formatMarkdown(fullText);
          pinMessageTop(msgEl);
        }
      } catch {}
    }
  }

  return fullText;
}

// ─── OpenRouter streaming (OpenAI-compatible SSE) ────────────────────────────
async function streamOpenrouter(model, typingEl, signal) {
  const messages = conversationHistory.map(msg => {
    if (msg.images && msg.images.length > 0) {
      return {
        role: msg.role,
        content: [
          { type: 'text', text: msg.content },
          ...msg.images.map(b64 => ({
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${b64}` },
          })),
        ],
      };
    }
    return { role: msg.role, content: msg.content };
  });
  messages.unshift({ role: 'system', content: getSystemPrompt() });

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openrouterApiKey}`,
      'HTTP-Referer': 'https://localhost/ai-overlay',
      'X-Title': 'AI Overlay',
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `HTTP ${res.status}`);
  }

  const reader  = res.body.getReader();
  signal?.addEventListener('abort', () => reader.cancel());
  const decoder = new TextDecoder();

  typingEl.remove();
  const msgEl  = appendMessage('assistant', '');
  let fullText = '';
  let buffer   = '';
  let rawAll   = '';   // full raw body, for the non-streaming fallback

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    rawAll += chunk;
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const json = JSON.parse(raw);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          msgEl.querySelector('.bubble').innerHTML = formatMarkdown(fullText);
          pinMessageTop(msgEl);
        }
      } catch {}
    }
  }

  // Fallback: some OpenRouter routes don't token-stream and return one JSON
  // object. If nothing streamed, parse the whole body for the final message.
  if (!fullText) {
    try {
      const json = JSON.parse(rawAll.trim());
      const c = json.choices?.[0]?.message?.content;
      fullText = Array.isArray(c) ? c.map(p => p.text || '').join('') : (c || '');
      if (fullText) {
        msgEl.querySelector('.bubble').innerHTML = formatMarkdown(fullText);
        pinMessageTop(msgEl);
      }
    } catch {}
  }

  return fullText;
}

function buildGeminiParts(msg) {
  const parts = [];
  if (msg.content) parts.push({ text: msg.content });
  if (msg.images) {
    msg.images.forEach(b64 => {
      parts.push({ inline_data: { mime_type: 'image/png', data: b64 } });
    });
  }
  return parts.length ? parts : [{ text: '' }];
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────
function appendUserMessage(text, images = []) {
  const msg = document.createElement('div');
  msg.className = `msg user${currentProvider === 'gemini' ? ' gemini-msg' : currentProvider === 'groq' ? ' groq-msg' : currentProvider === 'openrouter' ? ' openrouter-msg' : ''}`;
  let inner = `<div class="bubble">${escapeHtml(text)}`;
  if (images && images.length > 0) {
    inner += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">`;
    images.forEach((url, i) => {
      inner += `<img class="ss-chat-img" src="${url}" alt="image ${i+1}" />`;
    });
    inner += `</div>`;
  }
  inner += `</div>`;
  msg.innerHTML = inner;
  messagesEl.appendChild(msg);
  scrollToBottom();
}


function appendMessage(role, text) {
  const msg = document.createElement('div');
  msg.className = `msg ${role}`;
  msg.innerHTML = `<div class="bubble">${role === 'assistant' ? formatMarkdown(text) : escapeHtml(text)}</div>`;
  messagesEl.appendChild(msg);
  scrollToBottom();
  return msg;
}

function appendTyping() {
  const w = document.createElement('div');
  w.className = 'msg assistant';
  w.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;
  messagesEl.appendChild(w);
  scrollToBottom();
  return w;
}

function showError(msg) {
  const el = document.createElement('div');
  el.className = 'error-toast';
  el.textContent = msg;
  messagesEl.appendChild(el);
  scrollToBottom();
  setTimeout(() => el.remove(), 7000);
}

function showInfo(msg) {
  const el = document.createElement('div');
  el.className = 'info-toast';
  el.textContent = msg;
  messagesEl.appendChild(el);
  scrollToBottom();
  setTimeout(() => el.remove(), 5000);
}

const SEND_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
const STOP_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`;

function setStreaming(val) {
  isStreaming = val;
  // Keep button enabled so user can click it to stop
  sendBtn.disabled = false;
  inputEl.disabled = val;
  sendBtn.innerHTML = val ? STOP_ICON : SEND_ICON;
  sendBtn.title = val ? 'Stop (click to cancel)' : 'Send';
  sendBtn.classList.toggle('stop-mode', val);
  if (!val) inputEl.focus();
}

function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

// While an answer streams, keep its first line at the top of the view (so you read
// downward) instead of chasing the bottom. Manual scrolling switches this off.
let autoPin = true;
function pinMessageTop(msgEl) {
  if (!autoPin) return;
  const delta = msgEl.getBoundingClientRect().top - messagesEl.getBoundingClientRect().top;
  messagesEl.scrollTop += delta - 6;
}
['wheel', 'mousedown', 'touchstart'].forEach(ev =>
  messagesEl.addEventListener(ev, () => { autoPin = false; }, { passive: true }));

// ─── Reliable two-finger scroll on macOS (explicit wheel handler) ─────────────
// Electron at floating/screen-saver window level can drop native scroll events;
// this listener ensures trackpad scroll always reaches the messages container.
messagesEl.addEventListener('wheel', (e) => {
  e.stopPropagation();
  // deltaMode 0 = pixels, 1 = lines, 2 = pages
  const delta = e.deltaMode === 0 ? e.deltaY : e.deltaY * 20;
  messagesEl.scrollTop += delta;
}, { passive: true });






function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Convert simple LaTeX (from models that answer with math notation) to readable
// plain text — the overlay is a compact panel, not a math renderer.
function latexToText(e) {
  return e
    .replace(/\\text\s*\{([^}]*)\}/g, '$1')
    .replace(/\\mathrm\s*\{([^}]*)\}/g, '$1')
    .replace(/\\times/g, '×').replace(/\\cdot/g, '·')
    .replace(/\\leq?\b/g, '≤').replace(/\\geq?\b/g, '≥').replace(/\\neq\b/g, '≠')
    .replace(/\\rightarrow|\\to\b/g, '→').replace(/\\leftarrow/g, '←')
    .replace(/\\ldots|\\dots|\\cdots/g, '…')
    .replace(/\\%/g, '%').replace(/\\,/g, ' ').replace(/\\\\/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\\[a-zA-Z]+/g, '')   // drop any remaining commands
    .replace(/\s+/g, ' ').trim();
}
function cleanLatex(s) {
  return s
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, e) => latexToText(e))
    .replace(/\$([^$\n]+?)\$/g, (_, e) => latexToText(e));
}

// Inline formatting (bold, italic, inline code, links) on already-escaped text.
function formatInline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

// ─── Syntax highlighting (tiny tokenizer, no libraries) ───────────────────────
// Splits code into comments / strings / numbers / words and wraps each in a
// <span class="tok-…">. Comments get their own colour so they stand apart from code.
const CSTYLE_COMMENT = String.raw`\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|(?![\s\S]))`;
const QUOTED_STRING  = String.raw`"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'`;
const BACKTICK_STR   = '|\x60(?:\\\\.|[^\x60\\\\])*\x60';
const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

const SYNTAX_FAMILIES = [
  {
    langs: ['c', 'cpp', 'c++', 'cc', 'cxx', 'h', 'hpp'],
    comment: CSTYLE_COMMENT, preproc: true, strings: QUOTED_STRING,
    kw: words('if else for while do switch case default break continue return goto const constexpr static inline virtual override final class struct enum union namespace using typedef template typename public private protected new delete try catch throw auto this operator friend explicit mutable volatile sizeof extern noexcept decltype'),
    types: words('int long short char bool float double void unsigned signed size_t string vector map unordered_map set unordered_set multiset multimap pair queue stack deque priority_queue list array bitset tuple int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t ll ull'),
    consts: words('true false nullptr NULL INT_MAX INT_MIN LLONG_MAX LLONG_MIN'),
  },
  {
    langs: ['python', 'py', 'python3'],
    comment: String.raw`#[^\n]*`,
    strings: String.raw`"""[\s\S]*?(?:"""|(?![\s\S]))|'''[\s\S]*?(?:'''|(?![\s\S]))|` + QUOTED_STRING,
    kw: words('def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield global nonlocal assert del async await'),
    types: words('int str float bool list dict set tuple bytes object self cls'),
    consts: words('True False None'),
  },
  {
    langs: ['sql'], ci: true,
    comment: String.raw`--[^\n]*|\/\*[\s\S]*?(?:\*\/|(?![\s\S]))`, strings: String.raw`'(?:''|[^'])*'`,
    kw: words('select from where group by order having join inner left right outer full cross on as and or not in is like between exists union all distinct insert into values update set delete create table alter drop index primary key foreign references limit offset asc desc case when then else end count sum avg min max'),
    types: words('int integer bigint varchar char text date datetime timestamp boolean float double decimal'),
    consts: words('null true false'),
  },
  {
    langs: ['bash', 'sh', 'shell', 'zsh'],
    comment: String.raw`#[^\n]*`, strings: QUOTED_STRING,
    kw: words('if then else elif fi for while do done case esac in function return echo cd export'),
    types: words(''), consts: words('true false'),
  },
  {
    langs: ['json'],
    comment: String.raw`(?!)`, strings: String.raw`"(?:\\.|[^"\\\n])*"`,
    kw: words(''), types: words(''), consts: words('true false null'),
  },
  {
    // Java / JS / TS / C# / Go / Rust / Kotlin / Swift / PHP and any unknown language tag.
    langs: ['java', 'js', 'javascript', 'ts', 'typescript', 'jsx', 'tsx', 'cs', 'csharp', 'go', 'golang', 'rust', 'rs', 'kotlin', 'kt', 'swift', 'php', 'dart', 'scala'],
    fallback: true,
    comment: CSTYLE_COMMENT, strings: QUOTED_STRING + BACKTICK_STR,
    kw: words('function var let const class extends implements interface import export from default new this super return if else for while do switch case break continue try catch finally throw throws async await yield static public private protected final abstract package enum typeof instanceof in of delete func fn mut pub impl match struct type defer go range chan select use mod trait where override readonly namespace using'),
    types: words('int long short byte char boolean float double void string String Integer Long List Map Set ArrayList HashMap HashSet number any Promise bool i32 i64 u32 u64 usize f32 f64 str Vec Option Result'),
    consts: words('true false null nil undefined None'),
  },
];

// Build each family's tokenizer regex once.
for (const f of SYNTAX_FAMILIES) {
  const parts = [
    ['c', f.comment],
    f.preproc ? ['p', String.raw`^[ \t]*#[ \t]*[a-z_]+[^\n]*`] : null,
    ['s', f.strings],
    ['n', String.raw`\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[a-zA-Z]*\b`],
    ['w', String.raw`[A-Za-z_$][\w$]*`],
  ].filter(Boolean);
  f.kinds = parts.map(p => p[0]);
  f.re = new RegExp(parts.map(p => `(${p[1]})`).join('|') + String.raw`|[\s\S]`, 'gm');
}

const PLAIN_LANGS = new Set(['', 'text', 'txt', 'plaintext', 'plain', 'diagram', 'ascii', 'output', 'console', 'log']);

function highlightCode(code, lang) {
  lang = (lang || '').toLowerCase();
  if (PLAIN_LANGS.has(lang)) return escapeHtml(code);
  const fam = SYNTAX_FAMILIES.find(f => f.langs.includes(lang)) || SYNTAX_FAMILIES.find(f => f.fallback);

  let out = '';
  for (const m of code.matchAll(fam.re)) {
    const tok = m[0];
    let kind = null;
    for (let i = 1; i < m.length; i++) {
      if (m[i] !== undefined) { kind = fam.kinds[i - 1]; break; }
    }
    let cls = null;
    if (kind === 'c') cls = 'c';
    else if (kind === 'p') cls = 'p';
    else if (kind === 's') cls = 's';
    else if (kind === 'n') cls = 'n';
    else if (kind === 'w') {
      const w = fam.ci ? tok.toLowerCase() : tok;
      if (fam.kw.has(w)) cls = 'k';
      else if (fam.types.has(w)) cls = 't';
      else if (fam.consts.has(w)) cls = 'n';
      else if (code[m.index + tok.length] === '(') cls = 'f';
    }
    out += cls ? `<span class="tok-${cls}">${escapeHtml(tok)}</span>` : escapeHtml(tok);
  }
  return out;
}

// Lightweight Markdown → HTML: headers, ordered/unordered lists, horizontal
// rules, code blocks, and inline formatting. Enough to make model answers read
// cleanly without pulling in a full markdown library.
function formatMarkdown(text) {
  // 1) Pull fenced code blocks out first so their contents aren't touched.
  const codeBlocks = [];
  // An unclosed fence (still streaming) is treated as a block too, so code is
  // highlighted live while the answer is being written.
  text = text.replace(/```([\w+#.-]*)[ \t]*\n?([\s\S]*?)(?:```|$)/g, (_, lang, code) => {
    codeBlocks.push({ lang, code: code.replace(/\n+$/, '') });
    return `CB${codeBlocks.length - 1}`;
  });

  // 2) Simplify LaTeX, then escape HTML.
  text = escapeHtml(cleanLatex(text));

  // 3) Block-level parse, line by line.
  const lines = text.split('\n');
  let html = '';
  let list = null; // 'ul' | 'ol'
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };

  for (const raw of lines) {
    const line = raw.trim();
    const cb = line.match(/^CB(\d+)$/);
    if (cb) {
      closeList();
      const { lang, code } = codeBlocks[+cb[1]];
      html += `<pre><code>${highlightCode(code, lang)}</code></pre>`;
      continue;
    }
    if (!line) { closeList(); continue; }
    if (/^(---|\*\*\*|___)$/.test(line)) { closeList(); html += '<hr>'; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); const l = h[1].length; html += `<h${l}>${formatInline(h[2])}</h${l}>`; continue; }
    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    if (ol) { if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; } html += `<li>${formatInline(ol[1])}</li>`; continue; }
    const ul = line.match(/^[-*+]\s+(.*)$/);
    if (ul) { if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; } html += `<li>${formatInline(ul[1])}</li>`; continue; }
    closeList();
    html += `<p>${formatInline(line)}</p>`;
  }
  closeList();
  return html;
}

// ─── Show/hide toggle for API key fields ─────────────────────────────────────
// Adds an eye button inside every password input under `root`. Also called by
// the Live Assistant for its own Setup drawer (built after this script runs).
const EYE_OPEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_SHUT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';

function addPasswordToggles(root = document) {
  root.querySelectorAll('input[type="password"]:not([data-eye])').forEach((input) => {
    input.dataset.eye = '1';
    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-eye';
    const render = () => {
      const shown = input.type === 'text';
      btn.innerHTML = shown ? EYE_SHUT : EYE_OPEN;
      btn.title = shown ? 'Hide key' : 'Show key';
      btn.setAttribute('aria-label', btn.title);
    };
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep the cursor in the field
    btn.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      render();
    });
    render();
    wrap.appendChild(btn);
  });
}
addPasswordToggles();

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
