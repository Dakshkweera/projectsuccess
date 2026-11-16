/**
 * Audio Capture & Speaker Separation Module
 * 
 * Captures two independent audio streams:
 * 1. Interviewer Channel: System loopback audio (Zoom, Teams, Meet, browser)
 * 2. Student Channel: Laptop / headset microphone
 * 
 * Resamples to 16 kHz 16-bit Linear PCM in 20-40 ms chunks for live STT streaming.
 */

class AudioCaptureService {
  constructor() {
    this.audioCtx = null;
    this.interviewerStream = null;
    this.studentStream = null;
    this.interviewerProcessor = null;
    this.studentProcessor = null;
    this.isCapturing = false;

    // Callbacks
    this.onInterviewerChunk = null; // (pcmBuffer: ArrayBuffer) => void
    this.onStudentChunk = null;     // (pcmBuffer: ArrayBuffer) => void
    this.onError = null;            // (err: Error) => void
    this.onWarning = null;          // (msg: string) => void
  }

  /**
   * Check for potential Bluetooth headset hands-free profile
   */
  async checkBluetoothDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      for (const dev of audioInputs) {
        const label = (dev.label || '').toLowerCase();
        if (label.includes('bluetooth') || label.includes('hands-free') || label.includes('headset')) {
          if (this.onWarning) {
            this.onWarning(
              'Bluetooth headset microphone detected. For best audio quality and zero lag, use a wired headset or laptop mic.'
            );
          }
          break;
        }
      }
    } catch (e) {
      // Ignore device enumeration permission errors
    }
  }

  /**
   * Start capturing both Interviewer (System Audio Loopback) and Student (Microphone)
   */
  async start({ captureInterviewer = true, captureStudent = true } = {}) {
    if (this.isCapturing) return;

    await this.checkBluetoothDevices();

    // Create an AudioContext (typically 44.1k or 48k depending on hardware)
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContextClass();

    try {
      // 1. Capture Student (Microphone)
      if (captureStudent) {
        this.studentStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1
          },
          video: false
        });

        const studentSource = this.audioCtx.createMediaStreamSource(this.studentStream);
        this.studentProcessor = this._createPCMProcessor(this.audioCtx, (pcmChunk) => {
          if (this.onStudentChunk) this.onStudentChunk(pcmChunk);
        });
        studentSource.connect(this.studentProcessor);
      }

      // 2. Capture Interviewer (System Audio Loopback via getDisplayMedia)
      if (captureInterviewer) {
        // In Electron, setDisplayMediaRequestHandler supplies loopback audio track
        this.interviewerStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });

        // We don't need the video track, stop it immediately to save CPU/GPU
        const videoTracks = this.interviewerStream.getVideoTracks();
        videoTracks.forEach(track => track.stop());

        const audioTracks = this.interviewerStream.getAudioTracks();
        if (audioTracks.length === 0) {
          throw new Error('System audio loopback track not available. Ensure "Share system audio" is enabled.');
        }

        const interviewerSource = this.audioCtx.createMediaStreamSource(this.interviewerStream);
        this.interviewerProcessor = this._createPCMProcessor(this.audioCtx, (pcmChunk) => {
          if (this.onInterviewerChunk) this.onInterviewerChunk(pcmChunk);
        });
        interviewerSource.connect(this.interviewerProcessor);
      }

      this.isCapturing = true;
    } catch (err) {
      this.stop();
      if (this.onError) this.onError(err);
      throw err;
    }
  }

  /**
   * Converts Float32Array Web Audio frames to 16 kHz 16-bit Mono Linear PCM.
   * Emits chunks of ~512 to 1024 samples (~32-64ms frames).
   */
  _createPCMProcessor(audioCtx, onChunk) {
    const bufferSize = 2048; // 2048 at 48kHz is ~42ms of audio
    const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
    const sourceSampleRate = audioCtx.sampleRate;
    const targetSampleRate = 16000;

    processor.onaudioprocess = (e) => {
      if (!this.isCapturing) return;
      const inputData = e.inputBuffer.getChannelData(0); // Float32 mono

      // Resample down to 16,000 Hz
      const resampledData = this._resampleTo16k(inputData, sourceSampleRate, targetSampleRate);

      // Convert Float32 [-1.0, 1.0] to 16-bit Signed Integer PCM [-32768, 32767]
      const pcm16Buffer = new Int16Array(resampledData.length);
      for (let i = 0; i < resampledData.length; i++) {
        let s = Math.max(-1, Math.min(1, resampledData[i]));
        pcm16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      onChunk(pcm16Buffer.buffer);
    };

    // Need a dummy destination node to keep ScriptProcessor running
    processor.connect(audioCtx.destination);
    return processor;
  }

  /**
   * High-quality linear interpolation downsampler to 16 kHz
   */
  _resampleTo16k(audioBuffer, fromSampleRate, toSampleRate = 16000) {
    if (fromSampleRate === toSampleRate) {
      return audioBuffer;
    }
    const sampleRateRatio = fromSampleRate / toSampleRate;
    const newLength = Math.round(audioBuffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < audioBuffer.length; i++) {
        accum += audioBuffer[i];
        count++;
      }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  /**
   * Stop all streams and release hardware
   */
  stop() {
    this.isCapturing = false;

    if (this.interviewerProcessor) {
      try { this.interviewerProcessor.disconnect(); } catch (e) {}
      this.interviewerProcessor = null;
    }
    if (this.studentProcessor) {
      try { this.studentProcessor.disconnect(); } catch (e) {}
      this.studentProcessor = null;
    }

    if (this.interviewerStream) {
      try {
        this.interviewerStream.getTracks().forEach(track => track.stop());
      } catch (e) {}
      this.interviewerStream = null;
    }

    if (this.studentStream) {
      try {
        this.studentStream.getTracks().forEach(track => track.stop());
      } catch (e) {}
      this.studentStream = null;
    }

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try { this.audioCtx.close(); } catch (e) {}
      this.audioCtx = null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AudioCaptureService };
}
