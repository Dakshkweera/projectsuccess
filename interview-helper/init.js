/**
 * Interview Helper Bridge & UI Connector
 * Connects the Interview Helper module with the main window elements.
 */

document.addEventListener('DOMContentLoaded', async () => {
  if (!window.interviewHelper) return;

  // Initialize helper
  await window.interviewHelper.init();

  const toggleBtn = document.getElementById('interviewModeToggle');
  const deepgramInput = document.getElementById('deepgramKeyInput');
  const saveDeepgramBtn = document.getElementById('saveDeepgramKeyBtn');

  // Load saved deepgram key into main settings input if available
  if (window.electronAPI && window.electronAPI.getConfig) {
    try {
      const cfg = await window.electronAPI.getConfig();
      if (cfg && cfg.deepgramKey && deepgramInput) {
        deepgramInput.value = cfg.deepgramKey;
      }
    } catch (e) {}
  }

  // Handle mode toggle
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const isCurrentlyActive = window.interviewHelper.isActive;
      const nextState = !isCurrentlyActive;
      window.interviewHelper.setModeVisible(nextState);
      toggleBtn.classList.toggle('active', nextState);
      toggleBtn.title = nextState ? 'Exit Live Assistant' : 'Live Assistant (real-time voice helper)';
    });
  }

  // Handle saving deepgram key from main settings
  if (saveDeepgramBtn && deepgramInput) {
    saveDeepgramBtn.addEventListener('click', async () => {
      const key = deepgramInput.value.trim();
      window.interviewHelper.config.deepgramApiKey = key;
      if (window.interviewHelper.elements && window.interviewHelper.elements.deepgramInput) {
        window.interviewHelper.elements.deepgramInput.value = key;
      }
      if (window.electronAPI && window.electronAPI.saveConfig) {
        // save-config replaces the whole file, so merge with the existing config
        const cfg = (await window.electronAPI.getConfig()) || {};
        await window.electronAPI.saveConfig({ ...cfg, deepgramKey: key });
      }
      saveDeepgramBtn.textContent = 'Saved!';
      setTimeout(() => { saveDeepgramBtn.textContent = 'Save'; }, 1500);
    });
  }
});
