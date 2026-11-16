/**
 * Streaming Speech-to-Text (STT) Service
 * 
 * Manages dual real-time streaming sessions (one for Interviewer, one for Student).
 * Uses Deepgram Nova-3 streaming WebSocket API for ~200-300ms transcription lag.
 */

class STTStreamService {
  // language 'multi' = Nova-3 code-switching (English + Hindi/Hinglish etc.)
  constructor({ apiKey, keywords = [], language = 'multi' } = {}) {
    this.apiKey = apiKey;
    this.keywords = keywords; // Array of technical terms / companies
    this.language = language;

    this.interviewerSocket = null;
    this.studentSocket = null;

    this.interviewerKeepAliveTimer = null;
    this.studentKeepAliveTimer = null;

    // Callbacks for Interviewer Channel
    this.onInterviewerInterim = null; // (text: string) => void
    this.onInterviewerFinal = null;   // (result: { text: string, confidence: number, speechEnd: number }) => void
    this.onInterviewerUtteranceEnd = null; // () => void

    // Callbacks for Student Channel
    this.onStudentInterim = null;
    this.onStudentFinal = null;

    // Status Callbacks
    this.onError = null;
    this.onStatusChange = null;

    // Safety net: Recent interviewer sentences to filter out acoustic echo on student mic
    this.recentInterviewerUtterances = [];
  }

  /**
   * Update configuration (API key, keywords, etc.)
   */
  setConfig({ apiKey, keywords, language }) {
    if (apiKey !== undefined) this.apiKey = apiKey;
    if (keywords !== undefined) this.keywords = keywords;
    if (language !== undefined) this.language = language;
  }

  /**
   * Build Deepgram streaming WebSocket URL
   */
  _buildWsUrl() {
    const language = this.language || 'multi';
    const params = new URLSearchParams({
      // nova-2 has no Hindi/English code-switching; nova-3 does via language=multi
      model: 'nova-3',
      language,
      smart_format: 'true',
      interim_results: 'true',
      endpointing: '300', // 300ms silence detection from STT engine
      vad_events: 'true',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1'
    });

    // Nova-3 replaced `keywords` with `keyterm` (sending `keywords` is rejected).
    // Only send them for English, where keyterm prompting is certain to be supported.
    if (language === 'en' && this.keywords && this.keywords.length > 0) {
      // Boost tool names, company names, tech stack
      for (const kw of this.keywords.slice(0, 50)) {
        if (kw.trim()) params.append('keyterm', kw.trim());
      }
    }

    return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  }

  /**
   * Start both streaming channels
   */
  async start() {
    if (!this.apiKey) {
      throw new Error('STT API key (Deepgram) is required for live interview transcription.');
    }

    const url = this._buildWsUrl();

    // 1. Open Interviewer Channel
    this.interviewerSocket = this._createSocket(url, 'interviewer', {
      onInterim: (text) => {
        if (this.onInterviewerInterim) this.onInterviewerInterim(text);
      },
      onFinal: (res) => {
        this._recordInterviewerUtterance(res.text);
        if (this.onInterviewerFinal) this.onInterviewerFinal(res);
      },
      onUtteranceEnd: () => {
        if (this.onInterviewerUtteranceEnd) this.onInterviewerUtteranceEnd();
      }
    });

    // 2. Open Student Channel
    this.studentSocket = this._createSocket(url, 'student', {
      onInterim: (text) => {
        if (this.onStudentInterim) this.onStudentInterim(text);
      },
      onFinal: (res) => {
        // Echo cancellation safety net: check if text closely matches what the interviewer just said
        if (this._isEcho(res.text)) {
          return;
        }
        if (this.onStudentFinal) this.onStudentFinal(res);
      },
      onUtteranceEnd: () => {}
    });
  }

  _createSocket(url, channelName, { onInterim, onFinal, onUtteranceEnd }) {
    const ws = new WebSocket(url, ['token', this.apiKey]);

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      if (this.onStatusChange) this.onStatusChange(channelName, 'connected');
      // Keep alive heartbeat every 8 seconds of silence
      const timer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, 8000);
      if (channelName === 'interviewer') this.interviewerKeepAliveTimer = timer;
      else this.studentKeepAliveTimer = timer;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'UtteranceEnd') {
          onUtteranceEnd();
          return;
        }

        const channel = data.channel;
        const alternative = channel?.alternatives?.[0];
        if (!alternative) return;

        const transcript = alternative.transcript?.trim() || '';
        const confidence = alternative.confidence || 0;
        const isFinal = data.is_final;
        const speechFinal = data.speech_final;

        if (transcript) {
          if (isFinal) {
            onFinal({
              text: transcript,
              confidence,
              speechFinal: !!speechFinal,
              speechEnd: Date.now()
            });
          } else {
            onInterim(transcript);
          }
        }
      } catch (err) {
        console.error(`[STT ${channelName}] Message parse error:`, err);
      }
    };

    ws.onerror = (err) => {
      console.error(`[STT ${channelName}] WebSocket error:`, err);
      if (this.onError) this.onError(new Error(`STT ${channelName} connection error`));
    };

    ws.onclose = () => {
      if (this.onStatusChange) this.onStatusChange(channelName, 'disconnected');
    };

    return ws;
  }

  /**
   * Send 16 kHz PCM chunk to interviewer channel
   */
  sendInterviewerChunk(pcmBuffer) {
    if (this.interviewerSocket && this.interviewerSocket.readyState === WebSocket.OPEN) {
      this.interviewerSocket.send(pcmBuffer);
    }
  }

  /**
   * Send 16 kHz PCM chunk to student channel
   */
  sendStudentChunk(pcmBuffer) {
    if (this.studentSocket && this.studentSocket.readyState === WebSocket.OPEN) {
      this.studentSocket.send(pcmBuffer);
    }
  }

  /**
   * Record interviewer line with timestamp for echo detection
   */
  _recordInterviewerUtterance(text) {
    const now = Date.now();
    this.recentInterviewerUtterances.push({ text: text.toLowerCase(), timestamp: now });
    // Keep only last 10 seconds of utterances
    this.recentInterviewerUtterances = this.recentInterviewerUtterances.filter(u => now - u.timestamp < 10000);
  }

  /**
   * Duplicate-text safety filter: checks if student mic text is echoing interviewer
   */
  _isEcho(studentText) {
    const s = studentText.toLowerCase().trim();
    if (!s) return false;
    for (const item of this.recentInterviewerUtterances) {
      if (item.text.includes(s) || s.includes(item.text)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Close sockets and clear timers
   */
  stop() {
    if (this.interviewerKeepAliveTimer) {
      clearInterval(this.interviewerKeepAliveTimer);
      this.interviewerKeepAliveTimer = null;
    }
    if (this.studentKeepAliveTimer) {
      clearInterval(this.studentKeepAliveTimer);
      this.studentKeepAliveTimer = null;
    }

    if (this.interviewerSocket) {
      try {
        if (this.interviewerSocket.readyState === WebSocket.OPEN) {
          this.interviewerSocket.send(JSON.stringify({ type: 'CloseStream' }));
        }
        this.interviewerSocket.close();
      } catch (e) {}
      this.interviewerSocket = null;
    }

    if (this.studentSocket) {
      try {
        if (this.studentSocket.readyState === WebSocket.OPEN) {
          this.studentSocket.send(JSON.stringify({ type: 'CloseStream' }));
        }
        this.studentSocket.close();
      } catch (e) {}
      this.studentSocket = null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { STTStreamService };
}
