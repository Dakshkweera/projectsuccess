/**
 * End-of-Question & Turn-Taking Detector
 * 
 * Implements the 3-signal detection and Speculate-then-Confirm state machine:
 * 1. Pause: Silence timer on the interviewer channel.
 * 2. Completeness: Syntactic analysis (question marks, clause endings, trailing filler words).
 * 3. Provider end-of-turn events.
 */

class TurnDetector {
  constructor({
    onSpeculativeTrigger = null,
    onConfirmTrigger = null,
    onCancelSpeculation = null,
    onSpeechResume = null
  } = {}) {
    this.onSpeculativeTrigger = onSpeculativeTrigger; // (questionText, speechEnd) => void
    this.onConfirmTrigger = onConfirmTrigger;         // (questionText) => void
    this.onCancelSpeculation = onCancelSpeculation;   // (reason: string) => void
    this.onSpeechResume = onSpeechResume;             // () => void

    // State
    // committedText = finalized segments of the current turn; currentQuestionText =
    // committedText + the live interim segment. Deepgram re-sends a segment's words
    // as interims and then once as final, so interims must never be appended.
    this.committedText = '';
    this.currentQuestionText = '';
    this.lastSpeechEndTime = 0;
    this.silenceTimer = null;
    this.speculationTimer = null;

    this.state = 'idle'; // 'idle' | 'listening' | 'speculating' | 'confirmed'
    this.speculationHoldMs = 300; // Hold hidden for 300ms
    // false = manual mode: keep accumulating the turn's text but never fire on
    // silence; only forceTrigger() (the "Answer" button) produces an answer.
    this.autoTrigger = true;

    // Trailing filler words that indicate the speaker has not finished their thought
    this.trailingFillers = [
      'and', 'so', 'um', 'uh', 'like', 'but', 'or', 'because', 'then', 'also', 'meaning',
      'i mean', 'you know', 'well',
      // Hindi / Hinglish
      'aur', 'toh', 'to', 'ki', 'ke', 'matlab', 'jaise', 'lekin', 'par', 'phir', 'kyunki', 'yaani',
      'और', 'तो', 'कि', 'के', 'मतलब', 'जैसे', 'लेकिन', 'पर', 'फिर', 'क्योंकि', 'यानी'
    ];
  }

  /**
   * Called when interviewer speaks interim words
   */
  onInterviewerSpeech(text) {
    this._clearTimers();

    if (this.state === 'speculating') {
      // Speaker resumed speaking during the 300ms hidden speculative buffer window!
      // Cancel speculative request immediately to save tokens and prevent wrong answers.
      this.state = 'listening';
      if (this.onCancelSpeculation) this.onCancelSpeculation('speaker_resumed');
    } else if (this.state === 'confirmed') {
      this._startNewTurn();
    } else {
      this.state = 'listening';
    }

    this.currentQuestionText = this._join(this.committedText, text);
    this.lastSpeechEndTime = Date.now();
  }

  // Speaker spoke again after the answer was already confirmed: treat it as a new
  // question. Notify parent to grey out or supersede previous answer.
  _startNewTurn() {
    this.state = 'listening';
    this.committedText = '';
    if (this.onSpeechResume) this.onSpeechResume();
  }

  _join(a, b) {
    return (a + ' ' + b).trim();
  }

  /**
   * Called when an interviewer final transcript segment arrives
   */
  onInterviewerFinalSegment({ text, confidence, speechFinal, speechEnd }) {
    // A final can arrive with no preceding interim (very short utterances)
    if (this.state === 'confirmed') this._startNewTurn();
    else if (this.state === 'speculating') {
      this._clearTimers();
      this.state = 'listening';
      if (this.onCancelSpeculation) this.onCancelSpeculation('speaker_resumed');
    }

    this.lastSpeechEndTime = speechEnd || Date.now();
    this.committedText = this._join(this.committedText, text);
    this.currentQuestionText = this.committedText;

    if (!this.autoTrigger) return;

    // Check completeness
    const completeness = this.checkCompleteness(this.currentQuestionText);

    // If STT provider already flagged speech_final or end-of-turn
    if (speechFinal && completeness.isComplete) {
      this._triggerSpeculation(this.currentQuestionText, this.lastSpeechEndTime);
      return;
    }

    // Schedule adaptive silence wait
    const waitMs = completeness.isComplete ? 400 : 1400; // 400ms for complete, 1400ms for incomplete/filler
    this._scheduleSilenceTimer(waitMs);
  }

  /**
   * Called when provider UtteranceEnd event arrives
   */
  onProviderUtteranceEnd() {
    if (this.autoTrigger && this.state === 'listening' && this.currentQuestionText.trim().length > 3) {
      this._triggerSpeculation(this.currentQuestionText, this.lastSpeechEndTime || Date.now());
    }
  }

  /**
   * Analyzes text syntax to see if question appears complete
   */
  checkCompleteness(text) {
    const trimmed = text.trim().toLowerCase();
    if (!trimmed) return { isComplete: false };

    // 1. Explicit question mark
    if (text.trim().endsWith('?')) {
      return { isComplete: true, confidence: 0.95 };
    }

    // 2. Trailing filler word check
    for (const filler of this.trailingFillers) {
      if (trimmed.endsWith(' ' + filler) || trimmed === filler) {
        return { isComplete: false, reason: `trailing_filler_${filler}` };
      }
    }

    // 3. Question starter word patterns (how, what, why, can, could, would, tell me, etc.)
    const questionStarters = ['what', 'why', 'how', 'when', 'where', 'who', 'which', 'can you', 'could you', 'would you', 'tell me', 'explain', 'describe'];
    const startsAsQuestion = questionStarters.some(starter => trimmed.startsWith(starter));

    // If it starts with question words and has at least 5 words and doesn't end in conjunctions
    const wordCount = trimmed.split(/\s+/).length;
    if (startsAsQuestion && wordCount >= 5) {
      return { isComplete: true, confidence: 0.85 };
    }

    // 4. Ends in a standard sentence terminator
    if (/[.!।]$/.test(text.trim())) { // । = Hindi full stop (danda)
      return { isComplete: true, confidence: 0.8 };
    }

    return { isComplete: false, reason: 'clause_open' };
  }

  _scheduleSilenceTimer(delayMs) {
    this._clearTimers();
    this.silenceTimer = setTimeout(() => {
      if (this.currentQuestionText.trim().length > 3) {
        this._triggerSpeculation(this.currentQuestionText, this.lastSpeechEndTime || Date.now());
      }
    }, delayMs);
  }

  _triggerSpeculation(questionText, speechEndTime) {
    this._clearTimers();
    this.state = 'speculating';

    if (this.onSpeculativeTrigger) {
      this.onSpeculativeTrigger(questionText, speechEndTime);
    }

    // Hold in hidden buffer for 300 ms to confirm silence
    this.speculationTimer = setTimeout(() => {
      if (this.state === 'speculating') {
        this.state = 'confirmed';
        if (this.onConfirmTrigger) {
          this.onConfirmTrigger(this.currentQuestionText);
        }
      }
    }, this.speculationHoldMs);
  }

  /**
   * Manually trigger answer (e.g. from UI "Answer Now" button)
   */
  forceTrigger(manualQuestionText = null) {
    this._clearTimers();
    const q = manualQuestionText || this.currentQuestionText;
    if (!q || !q.trim()) return;

    this.state = 'confirmed';
    if (this.onSpeculativeTrigger) {
      this.onSpeculativeTrigger(q, Date.now());
    }
    if (this.onConfirmTrigger) {
      this.onConfirmTrigger(q);
    }
  }

  reset() {
    this._clearTimers();
    this.state = 'idle';
    this.committedText = '';
    this.currentQuestionText = '';
    this.lastSpeechEndTime = 0;
  }

  _clearTimers() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.speculationTimer) {
      clearTimeout(this.speculationTimer);
      this.speculationTimer = null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TurnDetector };
}
