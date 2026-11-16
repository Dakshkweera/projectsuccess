/**
 * OpenRouter Speech-to-Text Service (fallback when no Deepgram key is set)
 *
 * OpenRouter's /audio/transcriptions endpoint is request/response only (no
 * streaming), so each channel runs a small energy-based VAD over the 16 kHz
 * PCM chunks, cuts an utterance at a short pause, and sends that segment to
 * deepgram/nova-3 as WAV. Results are delivered as "final" segments through the
 * same callback interface as STTStreamService, so the controller and
 * TurnDetector don't care which backend is active.
 *
 * Typical lag: pause cut (~350 ms) + request round-trip (~0.3–1 s).
 */

const OPENROUTER_STT_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';
const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';
const STT_SAMPLE_RATE = 16000;

class OpenRouterSTTService {
  // language 'multi' = Nova-3 code-switching (English + Hindi/Hinglish etc.).
  // 'en' turns Hindi into English-sounding nonsense, so it's not the default.
  constructor({ apiKey, model = 'deepgram/nova-3', language = 'multi' } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.language = language;
    this.keywords = []; // accepted for interface parity; not sent (no keyterm support here)

    this.channels = {};
    this.isRunning = false;

    // VAD tuning
    this.silenceCutMs = 350;      // pause that ends a segment
    this.minSpeechMs = 250;       // ignore blips shorter than this
    this.maxSegmentMs = 8000;     // force a cut on long monologues so text keeps flowing
    this.preRollMs = 200;         // keep a little audio before speech onset
    this.minThreshold = 0.008;    // RMS floor (loopback silence is often exactly 0)

    // Same callbacks as STTStreamService
    this.onInterviewerInterim = null;
    this.onInterviewerFinal = null;
    this.onInterviewerUtteranceEnd = null;
    this.onInterviewerSpeechStart = null; // () => void — speaker started talking (no text yet)
    this.onStudentInterim = null;
    this.onStudentFinal = null;
    this.onStudentSpeechStart = null;     // () => void — I started talking (no text yet)
    this.onError = null;
    this.onStatusChange = null;

    this.recentInterviewerUtterances = [];
    this._lastErrorAt = 0;
  }

  setConfig({ apiKey, keywords, language, model }) {
    if (apiKey !== undefined) this.apiKey = apiKey;
    if (keywords !== undefined) this.keywords = keywords;
    if (language !== undefined) this.language = language;
    if (model !== undefined) this.model = model;
  }

  async start() {
    if (!this.apiKey) {
      throw new Error('An OpenRouter API key is required for transcription.');
    }
    // Free key check: fails fast on a bad key.
    const check = await fetch(OPENROUTER_KEY_URL, { headers: { 'Authorization': `Bearer ${this.apiKey}` } })
      .catch(() => null);
    if (check && check.status === 401) {
      throw new Error('OpenRouter rejected the API key (401).');
    }
    // The first transcription is ~1.9 s vs ~0.7 s warm; send 0.5 s of silence
    // (fraction of a cent) so the first real question gets the warm path.
    this._transcribe(this._encodeWav([new Int16Array(STT_SAMPLE_RATE / 2)])).catch(() => {});
    this.isRunning = true;
    this.channels = {
      interviewer: this._newChannel('interviewer'),
      student: this._newChannel('student')
    };
    if (this.onStatusChange) {
      this.onStatusChange('interviewer', 'connected');
      this.onStatusChange('student', 'connected');
    }
  }

  _newChannel(name) {
    return {
      name,
      speaking: false,
      chunks: [],          // Int16Array chunks of the current segment
      preRoll: [],         // recent non-speech chunks
      speechMs: 0,
      segmentMs: 0,
      silenceMs: 0,
      noiseFloor: 0,
      delivery: Promise.resolve(), // keeps results in spoken order
      abort: new AbortController()
    };
  }

  sendInterviewerChunk(pcmBuffer) { this._onChunk('interviewer', pcmBuffer); }
  sendStudentChunk(pcmBuffer) { this._onChunk('student', pcmBuffer); }

  _onChunk(name, pcmBuffer) {
    const ch = this.channels[name];
    if (!this.isRunning || !ch) return;

    const samples = new Int16Array(pcmBuffer);
    const ms = (samples.length / STT_SAMPLE_RATE) * 1000;
    const rms = this._rms(samples);
    const threshold = Math.max(this.minThreshold, ch.noiseFloor * 3);
    const isSpeech = rms > threshold;

    if (!ch.speaking) {
      // Track background level only while nobody is talking
      ch.noiseFloor = ch.noiseFloor ? ch.noiseFloor * 0.95 + rms * 0.05 : rms;
      ch.preRoll.push(samples);
      let preMs = ch.preRoll.reduce((t, c) => t + (c.length / STT_SAMPLE_RATE) * 1000, 0);
      while (preMs > this.preRollMs && ch.preRoll.length > 1) {
        preMs -= (ch.preRoll.shift().length / STT_SAMPLE_RATE) * 1000;
      }
      if (!isSpeech) return;

      ch.speaking = true;
      ch.chunks = ch.preRoll;
      ch.preRoll = [];
      ch.speechMs = ms;
      ch.segmentMs = ms;
      ch.silenceMs = 0;
      this._emitSpeechStart(name);
      return;
    }

    ch.chunks.push(samples);
    ch.segmentMs += ms;
    if (isSpeech) {
      ch.speechMs += ms;
      ch.silenceMs = 0;
    } else {
      ch.silenceMs += ms;
    }

    if (ch.silenceMs >= this.silenceCutMs) {
      this._cutSegment(ch, true);
    } else if (ch.segmentMs >= this.maxSegmentMs) {
      this._cutSegment(ch, false);
      // Still mid-speech: keep listening as a continuation of the same utterance
      ch.speaking = true;
    }
  }

  _cutSegment(ch, endedBySilence) {
    const chunks = ch.chunks;
    const speechMs = ch.speechMs;
    const speechEnd = Date.now() - (endedBySilence ? ch.silenceMs : 0);

    ch.speaking = false;
    ch.chunks = [];
    ch.speechMs = 0;
    ch.segmentMs = 0;
    ch.silenceMs = 0;

    if (speechMs < this.minSpeechMs) return;

    const wav = this._encodeWav(chunks);
    const request = this._transcribe(wav, ch.abort.signal);

    ch.delivery = ch.delivery.then(async () => {
      let text = '';
      try {
        text = (await request).trim();
      } catch (err) {
        if (err.name !== 'AbortError') this._reportError(err);
        return;
      }
      if (!text || !this.isRunning) return;
      this._deliver(ch.name, { text, confidence: null, speechFinal: endedBySilence, speechEnd });
    });
  }

  _emitSpeechStart(name) {
    const cb = name === 'interviewer' ? this.onInterviewerSpeechStart : this.onStudentSpeechStart;
    if (cb) cb();
  }

  _deliver(name, res) {
    if (name === 'interviewer') this._recordInterviewerUtterance(res.text);
    else if (this._isEcho(res.text)) return;

    // Result arrived while that person is already talking again: it's a
    // continuation, not the end of the question.
    const stillTalking = !!this.channels[name]?.speaking;
    if (stillTalking) res.speechFinal = false;
    const onFinal = name === 'interviewer' ? this.onInterviewerFinal : this.onStudentFinal;
    if (onFinal) onFinal(res);
    if (stillTalking) this._emitSpeechStart(name);
  }

  async _transcribe(wavBuffer, signal) {
    const res = await fetch(OPENROUTER_STT_URL, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://localhost/ai-overlay',
        'X-Title': 'AI Overlay'
      },
      body: JSON.stringify({
        model: this.model,
        input_audio: { data: this._toBase64(wavBuffer), format: 'wav' },
        language: this.language || 'multi'
      })
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e?.error?.message || `Transcription HTTP ${res.status}`);
    }
    const j = await res.json();
    return j.text || '';
  }

  _reportError(err) {
    // One toast per 10 s so a bad key doesn't spam on every segment
    const now = Date.now();
    if (now - this._lastErrorAt < 10000) return;
    this._lastErrorAt = now;
    console.error('[STT OpenRouter]', err);
    if (this.onError) this.onError(new Error('OpenRouter transcription failed: ' + err.message));
  }

  _rms(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i] / 32768;
      sum += v * v;
    }
    return Math.sqrt(sum / (samples.length || 1));
  }

  _encodeWav(chunks) {
    const total = chunks.reduce((t, c) => t + c.length, 0);
    const buf = new ArrayBuffer(44 + total * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, STT_SAMPLE_RATE, true); v.setUint32(28, STT_SAMPLE_RATE * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, total * 2, true);
    let off = 44;
    for (const c of chunks) {
      new Int16Array(buf, off, c.length).set(c);
      off += c.length * 2;
    }
    return buf;
  }

  _toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  _recordInterviewerUtterance(text) {
    const now = Date.now();
    this.recentInterviewerUtterances.push({ text: text.toLowerCase(), timestamp: now });
    this.recentInterviewerUtterances = this.recentInterviewerUtterances.filter(u => now - u.timestamp < 10000);
  }

  _isEcho(studentText) {
    const s = studentText.toLowerCase().trim();
    if (!s) return false;
    return this.recentInterviewerUtterances.some(u => u.text.includes(s) || s.includes(u.text));
  }

  stop() {
    this.isRunning = false;
    for (const ch of Object.values(this.channels)) ch.abort.abort();
    this.channels = {};
    if (this.onStatusChange) {
      this.onStatusChange('interviewer', 'idle');
      this.onStatusChange('student', 'idle');
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OpenRouterSTTService };
}
