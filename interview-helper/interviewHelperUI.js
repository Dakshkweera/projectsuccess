/**
 * Interview Helper UI Orchestrator
 * 
 * Ties together:
 * - AudioCaptureService (Windows Loopback + Microphone)
 * - STTStreamService (Dual WebSockets to Deepgram Nova-2)
 * - TurnDetector (Pause, syntax completeness, speculation)
 * - AnswerEngine (Two-tier OpenRouter streaming + caching)
 */

class InterviewHelperController {
  constructor() {
    this.audioCapture = new AudioCaptureService();
    // Backend is chosen per session in startSession(): Deepgram streaming when a
    // Deepgram key is set, otherwise OpenRouter (deepgram/nova-3) segments.
    this.deepgramStt = new STTStreamService();
    this.openrouterStt = new OpenRouterSTTService();
    this.sttStream = this.deepgramStt;
    this.turnDetector = null;
    this.answerEngine = null;

    this.isActive = false;
    this.isSessionRunning = false;
    this.lastSpeechEndTime = 0;

    // Config
    this.config = {
      openrouterApiKey: '',
      deepgramApiKey: '',
      tier1Model: 'google/gemini-3.5-flash-lite',
      tier2Model: 'anthropic/claude-sonnet-5.5',
      sttModel: 'deepgram/nova-3', // used via OpenRouter when no Deepgram key
      answerMyVoice: true,         // questions spoken into the mic also get answers (turn off in interviews)
      answerMode: 'auto',          // 'auto' = answer questions on pause; 'manual' = only on ⚡ Answer
      sttLanguage: 'multi',        // 'multi' = English + Hindi/Hinglish mixed; or 'en' / 'hi'
      answerLanguage: 'English',   // 'English' | 'Hinglish' | 'Hindi' | 'same'
      modeKey: 'general',          // app mode used as context: built-in id or 'project:<name>'
      candidateProfile: {
        targetRole: '',
        jobDescription: '',
        resume: ''
      }
    };

    // UI elements
    this.containerEl = null;
    this.elements = {};
  }

  async init() {
    // 1. Load saved config
    if (window.electronAPI && window.electronAPI.getConfig) {
      try {
        const saved = await window.electronAPI.getConfig();
        if (saved) {
          // Fall back to the main app's OpenRouter key so it doesn't need entering twice
          const orKey = saved.openrouterKey || saved.openrouterApiKey;
          if (orKey) this.config.openrouterApiKey = orKey;
          if (saved.deepgramKey) this.config.deepgramApiKey = saved.deepgramKey;
          if (saved.interviewTier1Model) this.config.tier1Model = saved.interviewTier1Model;
          if (saved.interviewTier2Model) this.config.tier2Model = saved.interviewTier2Model;
          if (saved.interviewSttModel) this.config.sttModel = saved.interviewSttModel;
          if (saved.interviewProfile) this.config.candidateProfile = saved.interviewProfile;
          if (typeof saved.interviewAnswerMyVoice === 'boolean') this.config.answerMyVoice = saved.interviewAnswerMyVoice;
          if (saved.interviewAnswerMode === 'manual' || saved.interviewAnswerMode === 'auto') this.config.answerMode = saved.interviewAnswerMode;
          if (saved.interviewSttLanguage) this.config.sttLanguage = saved.interviewSttLanguage;
          if (saved.interviewAnswerLanguage) this.config.answerLanguage = saved.interviewAnswerLanguage;
          if (saved.interviewModeKey) this.config.modeKey = saved.interviewModeKey;
        }
      } catch (e) {
        console.warn('Failed to load interview config:', e);
      }
    }

    // 2. Setup Turn Detector
    this.turnDetector = new TurnDetector({
      onSpeculativeTrigger: (qText, speechEnd) => this._onAutoTrigger(this.turnDetector, qText, speechEnd),
      onConfirmTrigger: (qText) => this._onConfirmTrigger(qText),
      onCancelSpeculation: (reason) => this._onCancelSpeculation(reason),
      onSpeechResume: () => this._onSpeechResume()
    });

    // Separate detector for the user's own mic so the two speakers' words never merge
    this.micTurnDetector = new TurnDetector({
      onSpeculativeTrigger: (qText, speechEnd) => this._onAutoTrigger(this.micTurnDetector, qText, speechEnd),
      onConfirmTrigger: (qText) => this._onConfirmTrigger(qText),
      onCancelSpeculation: (reason) => this._onCancelSpeculation(reason),
      onSpeechResume: () => this._onSpeechResume()
    });
    this._applyAnswerMode();

    // 3. Setup Answer Engine
    this.answerEngine = new AnswerEngine({
      openrouterApiKey: this.config.openrouterApiKey,
      tier1Model: this.config.tier1Model,
      tier2Model: this.config.tier2Model,
      candidateProfile: this.config.candidateProfile,
      onTier1Start: () => this._uiTier1Start(),
      onTier1Token: (token, fullText) => this._uiTier1Token(token, fullText),
      onTier1Complete: (fullText, lagMs) => this._uiTier1Complete(fullText, lagMs),
      onTier2Start: () => this._uiTier2Start(),
      onTier2Token: (token, fullText) => this._uiTier2Token(token, fullText),
      onTier2Complete: (fullText) => this._uiTier2Complete(fullText),
      onDeadlineAlert: (status) => this._uiDeadlineAlert(status),
      onError: (err) => this._uiShowError(err.message)
    });

    // 4. Setup STT Callbacks (on both backends)
    this._setupSTTCallbacks(this.deepgramStt);
    this._setupSTTCallbacks(this.openrouterStt);

    // 5. Setup Audio Capture Callbacks (this.sttStream is read per chunk, so swapping backends works)
    this.audioCapture.onInterviewerChunk = (chunk) => this.sttStream.sendInterviewerChunk(chunk);
    this.audioCapture.onStudentChunk = (chunk) => this.sttStream.sendStudentChunk(chunk);
    this.audioCapture.onWarning = (msg) => this._uiShowWarning(msg);
    this.audioCapture.onError = (err) => this._uiShowError('Audio capture error: ' + err.message);

    // 6. Build DOM
    this._buildUI();
  }

  _setupSTTCallbacks(stt) {
    // Interviewer stream
    stt.onInterviewerInterim = (text) => {
      this.turnDetector.onInterviewerSpeech(text);
      this._uiShowHeard('speaker', true);
    };

    // OpenRouter backend has no interim text; it only signals voice onset so the
    // turn detector can cancel a speculative answer / start a new turn.
    stt.onInterviewerSpeechStart = () => {
      this.turnDetector.onInterviewerSpeech('');
      this._uiShowHeard('speaker', true, null, 'Hearing speaker…');
    };

    stt.onInterviewerFinal = (res) => {
      this.lastSpeechEndTime = res.speechEnd;
      this.lastQuestionSource = 'speaker';
      // Everything the other person says is context, answered or not
      this.answerEngine.addTurn('Them', res.text);
      // Capture before the detector runs: a non-question resets it to ''
      const heard = (this.turnDetector.committedText + ' ' + res.text).trim();
      this.turnDetector.onInterviewerFinalSegment(res);
      this._uiShowHeard('speaker', false, res.confidence, heard);
    };

    stt.onInterviewerUtteranceEnd = () => {
      this.turnDetector.onProviderUtteranceEnd();
    };

    // Student (my mic) stream: always kept as conversation context; also
    // answered when "Answer my voice" is on.
    stt.onStudentInterim = (text) => {
      if (!this.config.answerMyVoice) return;
      this.micTurnDetector.onInterviewerSpeech(text);
      this._uiShowHeard('mic', true);
    };

    stt.onStudentSpeechStart = () => {
      if (!this.config.answerMyVoice) return;
      this.micTurnDetector.onInterviewerSpeech('');
      this._uiShowHeard('mic', true, null, 'Listening…');
    };

    stt.onStudentFinal = (res) => {
      if (!res.text || !res.text.trim()) return;
      this.answerEngine.addTurn('Me', res.text);
      if (!this.config.answerMyVoice) return;
      this.lastSpeechEndTime = res.speechEnd;
      this.lastQuestionSource = 'mic';
      // Capture before the detector runs: an ignored "okay" resets it to ''
      const heard = (this.micTurnDetector.committedText + ' ' + res.text).trim();
      this.micTurnDetector.onInterviewerFinalSegment(res);
      this._uiShowHeard('mic', false, res.confidence, heard);
    };

    stt.onStatusChange = (channel, status) => {
      this._uiUpdateStatusBadge(channel, status);
    };

    stt.onError = (err) => {
      this._uiShowError(err.message);
    };
  }

  /* ── Turn Detector Event Handlers ── */
  _onSpeculativeTrigger(questionText, speechEnd) {
    this.pendingQuestion = questionText;
    this._uiUpdateStateMarker('thinking', 'Thinking… (speculating)');
    this.answerEngine.startGeneration(questionText, speechEnd, { isSpeculative: true });
  }

  // Auto mode only answers speech that looks like a question or request, so
  // statements and replies ("okay", "that makes sense") don't replace the
  // answer on screen. forceTrigger() arrives with state 'confirmed' and skips the gate.
  _onAutoTrigger(detector, questionText, speechEnd) {
    if (detector.state !== 'confirmed' && !this._looksLikeQuestion(questionText)) {
      detector.reset(); // also stops the pending confirm timer
      this._uiUpdateStateMarker('listening', 'Not a question — keeping current answer');
      return;
    }
    this._onSpeculativeTrigger(questionText, speechEnd);
  }

  _looksLikeQuestion(text) {
    const q = text.trim().toLowerCase();
    if (/\?["')\s]*$/.test(q) || /\?\s/.test(q)) return true;
    if (/^(what|what's|whats|why|how|how's|when|where|who|whom|whose|which|can|could|would|will|should|shall|is|are|was|were|do|does|did|have|has|tell|explain|describe|walk|give|show|share|talk|define|compare|list|help)\b/.test(q)) return true;
    if (/\b(tell me|walk me through|explain|describe|how would you|what would you|how do you|what do you|what is|what are|can you|could you|would you|give me|an example|talk about|thoughts on|difference between)\b/.test(q)) return true;
    // Hindi / Hinglish: question words usually come mid- or end-sentence
    // ("aapne scalability kaise handle ki"), so match anywhere.
    if (/\b(kya|kyaa|kaise|kaisa|kaisi|kyun|kyon|kyu|kab|kahan|kahaan|kaun|kaunsa|konsa|kitna|kitne|kitni|batao|bataiye|bataye|batayein|samjhao|samjhaiye|bolo|boliye)\b/.test(q)) return true;
    return /(क्या|कैसे|कैसा|कैसी|क्यों|कब|कहाँ|कहां|कौन|कौनसा|कितना|कितने|कितनी|बताओ|बताइए|बताइये|बताएं|बताएँ|समझाओ|समझाइए|बोलिए)/.test(q);
  }

  /* ── Auto / Manual answering ── */
  _applyAnswerMode() {
    const auto = this.config.answerMode !== 'manual';
    if (this.turnDetector) this.turnDetector.autoTrigger = auto;
    if (this.micTurnDetector) this.micTurnDetector.autoTrigger = auto;
  }

  // "⚡ Answer" button. Manual: answer everything heard since the last answer
  // (both people, labelled). Auto: re-answer whoever spoke last.
  _answerNow() {
    const them = this.turnDetector.currentQuestionText.trim();
    const me = this.config.answerMyVoice ? this.micTurnDetector.currentQuestionText.trim() : '';
    let q;
    if (this.config.answerMode === 'manual') {
      q = them && me ? `Them: ${them}\nMe: ${me}` : (them || me);
    } else {
      q = this.lastQuestionSource === 'mic' ? (me || them) : (them || me);
    }
    if (!q) {
      this._uiUpdateStateMarker('listening', 'Nothing heard yet');
      return;
    }
    this.turnDetector.reset();
    this.micTurnDetector.reset();
    this.pendingQuestion = q;
    this._uiUpdateQuestion('⚡ ' + q, false);
    this._uiUpdateStateMarker('confirmed', 'Generating assistance…');
    this.answerEngine.startGeneration(q, Date.now(), { isSpeculative: false });
  }

  _onConfirmTrigger(questionText) {
    this._uiUpdateStateMarker('confirmed', 'Generating assistance…');
    this.answerEngine.confirmSpeculation();
  }

  _onCancelSpeculation(reason) {
    this.answerEngine.cancelCurrent(reason);
    this._uiUpdateStateMarker('listening', 'Speaker continued talking…');
  }

  _onSpeechResume() {
    if (this.elements.tier1Content) {
      this.elements.tier1Content.style.opacity = '0.5';
    }
    this._uiUpdateStateMarker('listening', 'Speaker added follow-up…');
  }

  /* ── Session Start / Stop ── */
  async startSession() {
    if (this.isSessionRunning) return;

    if (!this.config.openrouterApiKey) {
      this._toggleSetupDrawer(true);
      this._uiShowError('Please enter an OpenRouter API key (used for answers, and for transcription when no Deepgram key is set).');
      return;
    }

    const useDeepgram = !!this.config.deepgramApiKey;
    const sttLabel = useDeepgram ? 'Deepgram streaming' : `OpenRouter ${this.config.sttModel}`;

    try {
      this._uiUpdateStateMarker('starting', 'Initializing audio & sockets…');
      await this._loadModes(); // latest mode text, in case it was edited since

      // Extract keywords from profile
      const keywords = this._extractKeywords();

      this.sttStream = useDeepgram ? this.deepgramStt : this.openrouterStt;
      const language = this.config.sttLanguage;
      this.sttStream.setConfig(useDeepgram
        ? { apiKey: this.config.deepgramApiKey, keywords, language }
        : { apiKey: this.config.openrouterApiKey, model: this.config.sttModel, keywords, language });

      this.answerEngine.setConfig({
        apiKey: this.config.openrouterApiKey,
        tier1Model: this.config.tier1Model,
        tier2Model: this.config.tier2Model,
        candidateProfile: this.config.candidateProfile,
        answerLanguage: this.config.answerLanguage
      });

      // Start STT WebSockets
      await this.sttStream.start();

      // Start Audio Capture (System Loopback + Mic)
      await this.audioCapture.start({ captureInterviewer: true, captureStudent: true });

      this.isSessionRunning = true;
      this.elements.sessionBtn.textContent = '⏹ Stop Assistant';
      this.elements.sessionBtn.className = 'ih-btn ih-btn-danger';
      this._uiUpdateStateMarker('listening', `Listening (${sttLabel})…`);
    } catch (err) {
      this.stopSession();
      this._uiShowError('Failed to start session: ' + err.message);
    }
  }

  stopSession() {
    this.isSessionRunning = false;
    this.audioCapture.stop();
    this.sttStream.stop();
    this.turnDetector.reset();
    this.micTurnDetector.reset();
    this.answerEngine.cancelCurrent('session_stopped');

    if (this.elements.sessionBtn) {
      this.elements.sessionBtn.textContent = '▶ Start Assistant';
      this.elements.sessionBtn.className = 'ih-btn ih-btn-primary';
    }
    this._uiUpdateStateMarker('idle', 'Assistant idle');
    this._uiUpdateStatusBadge('interviewer', 'idle');
    this._uiUpdateStatusBadge('student', 'idle');
  }

  _extractKeywords() {
    const text = `${this.config.candidateProfile.targetRole} ${this.config.candidateProfile.jobDescription} ${this.config.candidateProfile.resume}`;
    const words = text.match(/\b[A-Za-z0-9#+.-]{3,}\b/g) || [];
    // Deduplicate and pick top 50 technical terms
    const unique = [...new Set(words)];
    return unique.slice(0, 50);
  }

  /* ── UI Building & DOM Injection ── */
  _buildUI() {
    const root = document.createElement('div');
    root.id = 'interviewHelperRoot';
    root.className = 'interview-helper-container';
    root.style.display = 'none'; // Initially hidden

    root.innerHTML = `
      <!-- Header -->
      <div class="ih-header">
        <div class="ih-status-group">
          <span class="ih-badge" id="ihLoopbackBadge">
            <span class="ih-pulse-dot"></span> Speaker Audio
          </span>
          <span class="ih-badge" id="ihMicBadge">
            <span class="ih-pulse-dot"></span> My Microphone
          </span>
        </div>
        <div class="ih-header-actions">
          <button class="ih-btn" id="ihProfileBtn" title="Context, Notes & Keys">⚙ Setup & Context</button>
          <button class="ih-btn ih-btn-primary" id="ihSessionBtn">▶ Start Assistant</button>
        </div>
      </div>

      <!-- Main Content -->
      <div class="ih-content">
        <!-- Settings Drawer (Collapsible) -->
        <div class="ih-drawer" id="ihSetupDrawer" style="display:none;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:12px; color:var(--text);">Personal Assistant Setup & Context</strong>
            <button class="ih-btn" id="ihCloseDrawerBtn" style="padding:2px 6px;">✕</button>
          </div>
          <div class="ih-input-group">
            <label class="ih-label">Deepgram API Key (optional — fastest live transcription)</label>
            <input type="password" id="ihDeepgramKeyInput" class="ih-input" placeholder="Leave empty to transcribe via OpenRouter (Nova-3)" />
          </div>
          <div class="ih-input-group">
            <label class="ih-label">OpenRouter API Key (Answer Generation)</label>
            <input type="password" id="ihOpenRouterKeyInput" class="ih-input" placeholder="Paste OpenRouter API Key..." />
          </div>
          <div class="ih-input-group">
            <label class="ih-label">Your Role / Profile</label>
            <input type="text" id="ihTargetRoleInput" class="ih-input" placeholder="e.g. Senior Full-Stack Engineer, Founder, Product Lead..." />
          </div>
          <div class="ih-input-group">
            <label class="ih-label">Topic / Discussion Context (boosts technical keyword accuracy)</label>
            <textarea id="ihJobDescInput" class="ih-input ih-textarea" rows="2" placeholder="Paste meeting notes, job description, or key topics..."></textarea>
          </div>
          <div class="ih-input-group">
            <label class="ih-label">Personal Background / Resume / Skills</label>
            <textarea id="ihResumeInput" class="ih-input ih-textarea" rows="2" placeholder="Paste key skills, projects, background info..."></textarea>
          </div>
          <div class="ih-input-group">
            <label class="ih-label">Spoken language (what people speak)</label>
            <select id="ihSttLanguageSelect" class="ih-input">
              <option value="multi">Auto: English + Hindi / Hinglish mixed</option>
              <option value="en">English only</option>
              <option value="hi">Hindi only</option>
            </select>
          </div>
          <div class="ih-input-group">
            <label class="ih-label">Answer language</label>
            <select id="ihAnswerLanguageSelect" class="ih-input">
              <option value="English">English</option>
              <option value="Hinglish">Hinglish (Hindi in English letters)</option>
              <option value="Hindi">Hindi (देवनागरी)</option>
              <option value="same">Same as the question</option>
            </select>
          </div>
          <button class="ih-btn ih-btn-primary" id="ihSaveProfileBtn" style="align-self:flex-end;">Save Setup</button>
        </div>

        <!-- Shown until the first answer arrives -->
        <div class="ih-answers-empty" id="ihAnswersEmpty">Answers will appear here.</div>

        <!-- Tier 1 Quick Guidance Box -->
        <div class="ih-tier1-card" id="ihTier1Card" style="display:none;">
          <div class="ih-tier1-title">
            <span>⚡ Instant Guidance (Tier 1)</span>
            <span id="ihTier1Timer" style="font-size:10px; font-weight:normal; color:#c4b5fd;">--</span>
          </div>
          <div class="ih-tier1-content" id="ihTier1Content"></div>
        </div>

        <!-- Tier 2 Detailed Guidance Box -->
        <div class="ih-tier2-card" id="ihTier2Card" style="display:none;">
          <div class="ih-tier2-header" id="ihTier2Toggle">
            <span class="ih-tier2-title">📖 In-Depth Breakdown (Tier 2)</span>
            <span id="ihTier2Chevron" style="font-size:11px; color:var(--text-muted);">▼</span>
          </div>
          <div class="ih-tier2-content" id="ihTier2Content"></div>
        </div>

        <!-- Earlier answers: a new answer pushes the previous one here instead of losing it -->
        <div class="ih-history" id="ihHistory" style="display:none;">
          <div class="ih-history-title">🕘 Earlier answers</div>
          <div id="ihHistoryList"></div>
        </div>
      </div>

      <!-- Listening footer: pinned under the answers so it never scrolls away -->
      <div class="ih-listen-footer">
        <div class="ih-telemetry-row">
          <span class="ih-state-marker" id="ihStateMarker">Ready</span>
          <span id="ihLatencySpan" style="color:var(--text-dim);">Latency: -- ms</span>
        </div>
        <div class="ih-controls-row">
          <div class="ih-seg" id="ihModeSeg" title="Auto: answers questions when the speaker pauses. Manual: only answers when you press ⚡ Answer.">
            <button data-mode="auto">Auto</button>
            <button data-mode="manual">Manual</button>
          </div>
          <button class="ih-btn ih-mic-answer-toggle" id="ihMicAnswerToggle" title="Also answer questions I ask into my microphone. Turn off in interviews so your own replies aren't answered."></button>
          <select class="ih-mode-select" id="ihModeSelect" title="Mode used as context for answers (same modes as the chat: /0, /1, /2 and your projects)"></select>
          <button class="ih-btn" id="ihManualAnswerBtn">⚡ Answer</button>
        </div>
        <div class="ih-question-card">
          <div class="ih-card-label">
            <span>Live Question / Discussion</span>
            <span id="ihConfidenceBadge" style="font-size:10px; color:var(--text-muted);">Waiting for audio...</span>
          </div>
          <div class="ih-question-text" id="ihQuestionText">Listening for questions or discussion. Click "Start Assistant" to begin.</div>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    this.containerEl = root;
    // Eye button on the key fields (helper lives in renderer.js)
    if (typeof addPasswordToggles === 'function') addPasswordToggles(root);

    // Cache elements
    this.elements = {
      loopbackBadge: root.querySelector('#ihLoopbackBadge'),
      micBadge: root.querySelector('#ihMicBadge'),
      sessionBtn: root.querySelector('#ihSessionBtn'),
      profileBtn: root.querySelector('#ihProfileBtn'),
      closeDrawerBtn: root.querySelector('#ihCloseDrawerBtn'),
      setupDrawer: root.querySelector('#ihSetupDrawer'),
      saveProfileBtn: root.querySelector('#ihSaveProfileBtn'),
      deepgramInput: root.querySelector('#ihDeepgramKeyInput'),
      openrouterInput: root.querySelector('#ihOpenRouterKeyInput'),
      targetRoleInput: root.querySelector('#ihTargetRoleInput'),
      jobDescInput: root.querySelector('#ihJobDescInput'),
      resumeInput: root.querySelector('#ihResumeInput'),
      questionText: root.querySelector('#ihQuestionText'),
      confidenceBadge: root.querySelector('#ihConfidenceBadge'),
      stateMarker: root.querySelector('#ihStateMarker'),
      latencySpan: root.querySelector('#ihLatencySpan'),
      manualAnswerBtn: root.querySelector('#ihManualAnswerBtn'),
      tier1Card: root.querySelector('#ihTier1Card'),
      tier1Timer: root.querySelector('#ihTier1Timer'),
      tier1Content: root.querySelector('#ihTier1Content'),
      tier2Card: root.querySelector('#ihTier2Card'),
      tier2Toggle: root.querySelector('#ihTier2Toggle'),
      tier2Content: root.querySelector('#ihTier2Content')
    };

    // Populate inputs from loaded config
    if (this.config.deepgramApiKey) this.elements.deepgramInput.value = this.config.deepgramApiKey;
    if (this.config.openrouterApiKey) this.elements.openrouterInput.value = this.config.openrouterApiKey;
    if (this.config.candidateProfile.targetRole) this.elements.targetRoleInput.value = this.config.candidateProfile.targetRole;
    if (this.config.candidateProfile.jobDescription) this.elements.jobDescInput.value = this.config.candidateProfile.jobDescription;
    if (this.config.candidateProfile.resume) this.elements.resumeInput.value = this.config.candidateProfile.resume;
    this.elements.sttLanguageSelect = root.querySelector('#ihSttLanguageSelect');
    this.elements.answerLanguageSelect = root.querySelector('#ihAnswerLanguageSelect');
    this.elements.sttLanguageSelect.value = this.config.sttLanguage;
    this.elements.answerLanguageSelect.value = this.config.answerLanguage;

    this._bindEvents();
  }

  _bindEvents() {
    this.elements.sessionBtn.addEventListener('click', () => {
      if (this.isSessionRunning) this.stopSession();
      else this.startSession();
    });

    this.elements.profileBtn.addEventListener('click', () => {
      const show = this.elements.setupDrawer.style.display === 'none';
      this._toggleSetupDrawer(show);
    });

    this.elements.closeDrawerBtn.addEventListener('click', () => {
      this._toggleSetupDrawer(false);
    });

    this.elements.saveProfileBtn.addEventListener('click', () => {
      this.config.deepgramApiKey = this.elements.deepgramInput.value.trim();
      this.config.openrouterApiKey = this.elements.openrouterInput.value.trim();
      this.config.candidateProfile.targetRole = this.elements.targetRoleInput.value.trim();
      this.config.candidateProfile.jobDescription = this.elements.jobDescInput.value.trim();
      this.config.candidateProfile.resume = this.elements.resumeInput.value.trim();
      this.config.sttLanguage = this.elements.sttLanguageSelect.value;
      this.config.answerLanguage = this.elements.answerLanguageSelect.value;

      // Apply now: OpenRouter STT and answers pick it up on the next request;
      // Deepgram streaming uses it from the next Start.
      this.openrouterStt.setConfig({ language: this.config.sttLanguage });
      this.answerEngine.setConfig({ answerLanguage: this.config.answerLanguage });

      // Persist to Electron config (save-config replaces the whole file, so merge)
      this._saveConfigPatch({
        deepgramKey: this.config.deepgramApiKey,
        openrouterKey: this.config.openrouterApiKey,
        interviewProfile: this.config.candidateProfile,
        interviewSttLanguage: this.config.sttLanguage,
        interviewAnswerLanguage: this.config.answerLanguage
      });

      this._toggleSetupDrawer(false);
      this._uiShowSuccess('Setup saved successfully!');
    });

    this.elements.manualAnswerBtn.addEventListener('click', () => this._answerNow());

    // Global hotkey (registered in main.js): open the Live panel if needed, then answer
    if (window.electronAPI && window.electronAPI.onLiveAnswer) {
      window.electronAPI.onLiveAnswer(() => {
        if (!this.isActive) document.getElementById('interviewModeToggle')?.click();
        this._answerNow();
      });
    }
    // Show the actual key (it may have fallen back to the backup combo)
    const showHotkey = (label) => {
      this.elements.manualAnswerBtn.title = `Answer now (${label}, works from any app)`;
      const empty = this.containerEl.querySelector('#ihAnswersEmpty');
      if (empty) empty.textContent = `Answers will appear here. Press ${label} to answer from any app.`;
    };
    showHotkey(navigator.platform.startsWith('Mac') ? 'Cmd+Shift+Enter' : 'Ctrl+Shift+Enter');
    if (window.electronAPI && window.electronAPI.onShortcutsUpdated) {
      window.electronAPI.onShortcutsUpdated(({ shortcuts = {} } = {}) => {
        if (shortcuts.liveAnswer) showHotkey(shortcuts.liveAnswer.label);
      });
    }

    const micToggle = this.containerEl.querySelector('#ihMicAnswerToggle');
    const renderMicToggle = () => {
      micToggle.textContent = this.config.answerMyVoice ? '🎤 My voice: ON' : '🎤 My voice: OFF';
      micToggle.classList.toggle('on', this.config.answerMyVoice);
    };
    renderMicToggle();
    micToggle.addEventListener('click', () => {
      this.config.answerMyVoice = !this.config.answerMyVoice;
      if (!this.config.answerMyVoice) this.micTurnDetector.reset();
      renderMicToggle();
      this._saveConfigPatch({ interviewAnswerMyVoice: this.config.answerMyVoice });
    });

    // App mode picker (context for answers)
    const modeSelect = this.containerEl.querySelector('#ihModeSelect');
    this.elements.modeSelect = modeSelect;
    modeSelect.addEventListener('pointerenter', () => this._loadModes());
    modeSelect.addEventListener('focus', () => this._loadModes());
    modeSelect.addEventListener('change', () => {
      this.config.modeKey = modeSelect.value;
      const mode = this._applyModeContext();
      if (mode) this._uiUpdateStateMarker('listening', `Mode: /${mode.num} ${mode.label}`);
      this._saveConfigPatch({ interviewModeKey: this.config.modeKey });
    });
    // Pick up modes created/edited/deleted in the main Settings panel
    for (const id of ['saveProjectBtn', 'deleteProjectBtn']) {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', () => setTimeout(() => this._loadModes(), 400));
    }
    this._loadModes();

    const modeSeg = this.containerEl.querySelector('#ihModeSeg');
    const renderMode = () => {
      const manual = this.config.answerMode === 'manual';
      modeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === this.config.answerMode));
      // In manual mode the Answer button is the main action
      this.elements.manualAnswerBtn.classList.toggle('ih-btn-primary', manual);
    };
    renderMode();
    modeSeg.addEventListener('click', (e) => {
      const mode = e.target.closest('button')?.dataset.mode;
      if (!mode || mode === this.config.answerMode) return;
      this.config.answerMode = mode;
      this._applyAnswerMode();
      renderMode();
      this._uiUpdateStateMarker('listening', mode === 'manual' ? 'Manual: press ⚡ Answer when ready' : 'Auto: answering questions on pause');
      this._saveConfigPatch({ interviewAnswerMode: mode });
    });

    this.elements.tier2Toggle.addEventListener('click', () => {
      const isHidden = this.elements.tier2Content.style.display === 'none';
      this.elements.tier2Content.style.display = isHidden ? 'block' : 'none';
      const chevron = this.containerEl.querySelector('#ihTier2Chevron');
      if (chevron) chevron.textContent = isHidden ? '▲' : '▼';
    });
  }

  _toggleSetupDrawer(show) {
    this.elements.setupDrawer.style.display = show ? 'flex' : 'none';
  }

  /* ── Mode Switching ── */
  setModeVisible(visible) {
    this.isActive = visible;
    if (visible) this._loadModes();
    if (this.containerEl) {
      this.containerEl.style.display = visible ? 'flex' : 'none';
    }

    // Toggle default chat views
    const messagesEl = document.getElementById('messages');
    const inputAreaEl = document.querySelector('.input-area');
    const screenshotPreviewEl = document.getElementById('screenshotPreview');

    if (messagesEl) messagesEl.style.display = visible ? 'none' : '';
    if (inputAreaEl) inputAreaEl.style.display = visible ? 'none' : '';
    if (screenshotPreviewEl && visible) screenshotPreviewEl.style.display = 'none';
  }

  /* ── UI Updaters ── */
  _uiUpdateQuestion(text, isSpeaking, confidence = null) {
    this.elements.questionText.textContent = text || 'Listening...';
    this.elements.questionText.className = isSpeaking ? 'ih-question-text speaking' : 'ih-question-text';

    if (confidence != null) { // OpenRouter backend reports no confidence
      const pct = Math.round(confidence * 100);
      if (confidence < 0.6) {
        this.elements.confidenceBadge.textContent = `Confidence: ${pct}% (Low - ask to repeat)`;
        this.elements.confidenceBadge.style.color = 'var(--red)';
      } else {
        this.elements.confidenceBadge.textContent = `Confidence: ${pct}%`;
        this.elements.confidenceBadge.style.color = 'var(--green)';
      }
    }
  }

  _uiUpdateStatusBadge(channel, status) {
    const badge = channel === 'interviewer' ? this.elements.loopbackBadge : this.elements.micBadge;
    if (!badge) return;

    if (status === 'connected') {
      badge.className = 'ih-badge active';
    } else if (status === 'disconnected') {
      badge.className = 'ih-badge danger';
    } else {
      badge.className = 'ih-badge';
    }
  }

  _uiUpdateStateMarker(type, text) {
    this.elements.stateMarker.className = `ih-state-marker ${type}`;
    this.elements.stateMarker.textContent = text;
  }

  /* ── App modes as context ── */
  // Same modes as the chat: built-in MODES from renderer.js (/0 General, /1 DSA,
  // /2 System Design) plus the user's projects saved in config (/3, /4, …, same
  // numbering as the chat). Re-read often so newly created/edited modes appear.
  async _loadModes() {
    const modes = [];
    if (typeof MODES !== 'undefined') {
      for (const [id, m] of Object.entries(MODES)) {
        // General is the plain assistant: no extra context to add
        modes.push({ key: id, num: m.num, label: m.label, text: id === 'general' ? '' : (m.system || '') });
      }
    } else {
      modes.push({ key: 'general', num: 0, label: 'General', text: '' });
    }
    try {
      const cfg = (window.electronAPI && await window.electronAPI.getConfig()) || {};
      (cfg.projects || [])
        .filter(p => String(p.name || '').trim() || String(p.context || '').trim())
        .forEach((p, i) => {
          const label = String(p.name || '').trim() || `Project ${i + 1}`;
          modes.push({ key: 'project:' + label, num: 3 + i, label, text: String(p.context || '') });
        });
    } catch (e) {}
    this.modes = modes.sort((a, b) => a.num - b.num);
    this._renderModeSelect();
    this._applyModeContext();
  }

  _renderModeSelect() {
    const sel = this.elements.modeSelect;
    if (!sel || !this.modes) return;
    if (!this.modes.some(m => m.key === this.config.modeKey)) this.config.modeKey = 'general'; // mode was deleted
    const html = this.modes.map(m =>
      `<option value="${this._escape(m.key)}">/${m.num} ${this._escape(m.label)}</option>`).join('');
    // Don't rebuild an unchanged list (it would close an open dropdown)
    if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html; }
    sel.value = this.config.modeKey;
  }

  // Hand the selected mode's prompt/context to the answer engine; returns the mode
  _applyModeContext() {
    const mode = (this.modes || []).find(m => m.key === this.config.modeKey);
    if (this.answerEngine) {
      this.answerEngine.setConfig({
        modeContext: mode && mode.text.trim() ? { label: `/${mode.num} ${mode.label}`, text: mode.text } : null
      });
    }
    return mode;
  }

  // save-config replaces the whole file, so merge with what's there
  _saveConfigPatch(patch) {
    if (!window.electronAPI || !window.electronAPI.saveConfig) return;
    window.electronAPI.getConfig()
      .then((cfg) => window.electronAPI.saveConfig({ ...(cfg || {}), ...patch }))
      .catch(() => {});
  }

  // Footer "what was heard". Manual shows both people's pending text (what
  // ⚡ Answer will send); auto shows whoever is talking.
  _uiShowHeard(source, isSpeaking, confidence = null, fallback = '') {
    const SPK = '🔊 ', ME = '🎤 You: ';
    const them = this.turnDetector.currentQuestionText.trim();
    const me = this.config.answerMyVoice ? this.micTurnDetector.currentQuestionText.trim() : '';
    let text;
    if (this.config.answerMode === 'manual' && (them || me)) {
      text = [them && SPK + them, me && ME + me].filter(Boolean).join('\n');
    } else {
      const cur = source === 'mic' ? me : them;
      text = (source === 'mic' ? ME : SPK) + (cur || fallback);
    }
    this._uiUpdateQuestion(text, isSpeaking, confidence);
  }

  /* ── Answer history ── */
  _archiveCurrentAnswer() {
    const prev = this.currentAnswer;
    // Skip speculative answers that were cancelled before Tier 1 finished,
    // and re-answers of the same question (they replace it).
    if (prev && prev.tier1Done && prev.question !== this.pendingQuestion) {
      this.history = [prev, ...(this.history || [])].slice(0, 10);
      this._renderHistory();
    }
    this.currentAnswer = { question: this.pendingQuestion || '', tier1: '', tier2: '', tier1Done: false, at: new Date() };
  }

  _renderHistory() {
    const wrap = this.containerEl.querySelector('#ihHistory');
    const list = this.containerEl.querySelector('#ihHistoryList');
    if (!wrap || !list) return;
    wrap.style.display = this.history.length ? 'block' : 'none';
    list.innerHTML = this.history.map(h => {
      const time = h.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `<details class="ih-history-item">
        <summary><span class="ih-history-time">${time}</span>${this._escape(h.question || '(question)')}</summary>
        <div class="ih-history-body">
          <div class="ih-md ih-tier1-md">${this._md(h.tier1)}</div>
          ${h.tier2 ? `<div class="ih-tier2-content">${this._renderTier2(h.tier2)}</div>` : ''}
        </div>
      </details>`;
    }).join('');
  }

  _uiTier1Start() {
    this._archiveCurrentAnswer();
    const empty = this.containerEl.querySelector('#ihAnswersEmpty');
    if (empty) empty.style.display = 'none';
    // New answer: jump back to the top so it's read from its first line
    const scroller = this.containerEl.querySelector('.ih-content');
    if (scroller) scroller.scrollTop = 0;
    this.elements.tier1Card.style.display = 'block';
    this.elements.tier1Content.textContent = 'Generating guidance...';
    this.elements.tier1Content.style.opacity = '1';
    this.elements.tier1Timer.textContent = 'Streaming...';
  }

  _uiTier1Token(token, fullText) {
    if (this.currentAnswer) this.currentAnswer.tier1 = fullText;
    this.elements.tier1Content.innerHTML = `<div class="ih-md ih-tier1-md">${this._md(fullText)}</div>`;
  }

  _uiTier1Complete(fullText, lagMs) {
    if (this.currentAnswer) Object.assign(this.currentAnswer, { tier1: fullText, tier1Done: true });
    this.elements.tier1Content.innerHTML = `<div class="ih-md ih-tier1-md">${this._md(fullText)}</div>`;
    const sec = (lagMs / 1000).toFixed(2);
    this.elements.tier1Timer.textContent = `${sec}s latency`;
    this.elements.latencySpan.textContent = `Lag: ${sec}s ${lagMs <= 1500 ? '⚡ (Fast)' : '⚠'}`;
  }

  _uiTier2Start() {
    this.elements.tier2Card.style.display = 'block';
    this.elements.tier2Content.style.display = 'block';
    this.elements.tier2Content.textContent = 'Deep breakdown loading...';
  }

  _uiTier2Token(token, fullText) {
    if (this.currentAnswer) this.currentAnswer.tier2 = fullText;
    this.elements.tier2Content.innerHTML = this._renderTier2(fullText);
  }

  _uiTier2Complete(fullText) {
    if (this.currentAnswer) this.currentAnswer.tier2 = fullText;
    this.elements.tier2Content.innerHTML = this._renderTier2(fullText);
    this._uiUpdateStateMarker('confirmed', 'Guidance complete');
  }

  /* ── Answer formatting ── */
  // Reuses the main chat's formatMarkdown (renderer.js) when present; it escapes HTML first.
  _md(text) {
    // The fast model occasionally doubles a bullet's key term ("**X**: **X**: …")
    text = String(text || '').replace(/\*\*([^*\n]+)\*\*:\s*\*\*\1\*\*:\s*/g, '**$1**: ');
    if (typeof formatMarkdown === 'function') return formatMarkdown(text);
    return this._escape(text || '').replace(/\n/g, '<br>');
  }

  _escape(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Split Tier 2 on its "## " headings and give each section a colour by role,
  // so the line to say and the key points stand out at a glance.
  _renderTier2(text) {
    const sections = [];
    let current = { title: '', body: [] };
    for (const line of (text || '').split('\n')) {
      const h = line.match(/^\s*#{1,3}\s+(.*)$/);
      if (h) {
        if (current.title || current.body.join('').trim()) sections.push(current);
        current = { title: h[1].replace(/\*\*/g, '').trim(), body: [] };
      } else {
        current.body.push(line);
      }
    }
    if (current.title || current.body.join('').trim()) sections.push(current);

    const kindOf = (t) => {
      if (/say|answer|pitch|opening/i.test(t)) return 'say';
      if (/key|point|core|principle/i.test(t)) return 'key';
      if (/avoid|trap|gotcha|pitfall|don'?t/i.test(t)) return 'avoid';
      if (/follow/i.test(t)) return 'follow';
      return 'detail';
    };

    return sections.map(({ title, body }) => {
      const kind = title ? kindOf(title) : 'detail';
      const head = title ? `<div class="ih-sec-title">${this._escape(title)}</div>` : '';
      return `<section class="ih-sec ih-sec-${kind}">${head}<div class="ih-md">${this._md(body.join('\n'))}</div></section>`;
    }).join('');
  }

  _uiDeadlineAlert(status) {
    if (status === 'thinking') {
      this._uiUpdateStateMarker('thinking', 'Thinking… (under 1.5s)');
    } else if (status === 'still_working') {
      this._uiUpdateStateMarker('still-working', 'Still working… (holding)');
    } else if (status === 'ask_repeat') {
      this._uiUpdateStateMarker('ask-repeat', 'Didn\'t catch that — Ask them to repeat the question');
      this.elements.tier1Content.textContent = 'Could not catch the question clearly within 3 seconds.\n\nTip: Say politely: "Would you mind repeating that last part?"';
      this.elements.tier1Card.style.display = 'block';
    }
  }

  _uiShowError(msg) {
    this.elements.stateMarker.className = 'ih-state-marker ask-repeat';
    this.elements.stateMarker.textContent = `Error: ${msg}`;
  }

  _uiShowWarning(msg) {
    console.warn('[InterviewHelper]', msg);
  }

  _uiShowSuccess(msg) {
    this.elements.stateMarker.className = 'ih-state-marker';
    this.elements.stateMarker.textContent = msg;
    setTimeout(() => {
      this.elements.stateMarker.textContent = this.isSessionRunning ? 'Listening...' : 'Ready';
    }, 2500);
  }
}

// Global instance
window.interviewHelper = new InterviewHelperController();
