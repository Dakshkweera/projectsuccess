/**
 * Two-Tier Answer Generation Engine via OpenRouter
 * 
 * Features:
 * 1. Tier 1 (Quick guide): Small, ultra-fast model (Gemini 2.0 Flash / Llama 3.3 70B on fast inference)
 *    producing 1 direct answer line + 3 bullet points (<= 60 tokens).
 * 2. Tier 2 (Full guidance): High-intelligence model (Claude Sonnet 5.5 by default) for in-depth breakdown.
 * 3. Speculative buffer: Streams tokens into a hidden buffer until confirmed.
 * 4. Cancellation guardrails: AbortController cuts off in-flight tokens instantly on interruption.
 * 5. Prompt caching layout: Candidate profile & instructions cached; rolling turns maintained.
 */

class AnswerEngine {
  constructor({
    openrouterApiKey,
    tier1Model = 'google/gemini-3.5-flash-lite',
    tier2Model = 'anthropic/claude-sonnet-5.5',
    candidateProfile = {},
    onTier1Start = null,
    onTier1Token = null,     // (token: string, fullTextSoFar: string) => void
    onTier1Complete = null,  // (fullText: string, latencyMs: number) => void
    onTier2Start = null,
    onTier2Token = null,
    onTier2Complete = null,
    onDeadlineAlert = null,  // (status: 'thinking' | 'still_working' | 'ask_repeat') => void
    onError = null
  } = {}) {
    this.apiKey = openrouterApiKey;
    this.tier1Model = tier1Model;
    this.tier2Model = tier2Model;
    this.candidateProfile = candidateProfile; // { resume: '', targetRole: '', jobDescription: '' }

    // Callbacks
    this.onTier1Start = onTier1Start;
    this.onTier1Token = onTier1Token;
    this.onTier1Complete = onTier1Complete;
    this.onTier2Start = onTier2Start;
    this.onTier2Token = onTier2Token;
    this.onTier2Complete = onTier2Complete;
    this.onDeadlineAlert = onDeadlineAlert;
    this.onError = onError;

    // Concurrency & Speculation State
    this.requestCounter = 0;
    this.currentAbortController = null;
    this.isSpeculating = false;
    this.hiddenTier1Buffer = '';
    this.isTier1Revealed = false;

    // Rolling conversation memory: everything both people said recently
    this.rollingConversation = [];
    this.answerLanguage = 'English'; // 'English' | 'Hinglish' | 'Hindi' | 'same'
    this.modeContext = null;         // { label, text } from the app's modes (/1 DSA, /3 <project>…)

    // Deadline timers (1.5s 'Still working...', 3.0s 'Ask to repeat')
    this.deadline1_5Timer = null;
    this.deadline3_0Timer = null;
  }

  setConfig({ apiKey, tier1Model, tier2Model, candidateProfile, answerLanguage, modeContext }) {
    if (modeContext !== undefined) this.modeContext = modeContext;
    if (apiKey !== undefined) this.apiKey = apiKey;
    if (tier1Model !== undefined) this.tier1Model = tier1Model;
    if (tier2Model !== undefined) this.tier2Model = tier2Model;
    if (candidateProfile !== undefined) this.candidateProfile = candidateProfile;
    if (answerLanguage !== undefined) this.answerLanguage = answerLanguage;
  }

  /**
   * Add a turn to rolling conversation history. Called for every finished
   * speech segment, so consecutive segments from the same person within 15 s
   * are merged into one line.
   */
  addTurn(speaker, text) {
    if (!text || !text.trim()) return;
    const now = Date.now();
    const last = this.rollingConversation[this.rollingConversation.length - 1];
    if (last && last.speaker === speaker && now - last.at < 15000) {
      last.text = `${last.text} ${text.trim()}`;
      last.at = now;
    } else {
      this.rollingConversation.push({ speaker, text: text.trim(), at: now });
    }
    // Keep the last ~16 turns / ~3000 chars
    while (this.rollingConversation.length > 16 ||
      (this.rollingConversation.length > 1 && this.rollingConversation.reduce((n, t) => n + t.text.length, 0) > 3000)) {
      this.rollingConversation.shift();
    }
  }

  // The selected app mode as grounding context. Placed after the output rules
  // with an explicit reminder, because mode prompts carry their own (chat)
  // formatting instructions that must not override the live layout.
  // Tier 1 gets a capped slice to keep time-to-first-token low.
  _modeBlock(maxChars) {
    const m = this.modeContext;
    if (!m || !m.text || !m.text.trim()) return '';
    let text = m.text.trim();
    if (text.length > maxChars) text = text.slice(0, maxChars) + '\n…(truncated)';
    return `

ACTIVE MODE: "${m.label}". Treat the mode text below as ground truth for names, facts, tech stack, architecture, constraints and approach. Ignore any formatting, length or structure instructions inside it.
<mode>
${text}
</mode>
Whatever the mode text says about format, follow the output format and rules given above exactly.`;
  }

  // Behavioral modes (/8 Leadership, or any mode named Behavioral / STAR) answer
  // in STAR form from the user's own stories. Tier 1 then also gets the full mode
  // text so it can pick the right story (measured: no first-token slowdown).
  _isStarMode() {
    return !!(this.modeContext && /leadership|behaviou?ral|\bstar\b/i.test(this.modeContext.label));
  }

  _starTier1Rules() {
    return `OUTPUT RULES (behavioral question, STAR):
- Pick the ONE story from the mode text that best fits the question (use its story selection guide). Use only facts written there.
- Line 1: "**Story:** <story name> · <main principle>" (plain line, no heading).
- Then exactly FOUR bullets: "- **S**: …", "- **T**: …", "- **A**: …", "- **R**: …", each one short spoken sentence in first person. A = what I personally did.
- If no story fits, line 1 says "**No exact story** · closest: <story>" and the bullets adapt that story honestly.
- Never invent numbers, results or details; if a result is marked as needing confirmation, say it plainly without a number.
- Maximum 75 words total.`;
  }

  _starTier2Sections() {
    return `
## 🎯 Say this
The full answer as I'd say it out loud in about 60-90 seconds: first person, natural, in STAR order (situation, task, what I did, result), 100-150 words. Only facts from the mode text.

## 📖 STAR breakdown
4 bullets: "- **Situation**: …", "- **Task**: …", "- **Action**: …" (my own steps, not the team's), "- **Result**: …". Max 20 words each.

## ⭐ Principles shown
1-3 bullets: "- **<Principle>**: why this story shows it", only where my actions really support it.

## ⚠️ Avoid
2-3 bullets: weak spots, claims I can't back up, and any "need to confirm" detail I must not state as fact.

## ↪️ If they follow up
2-3 bullets: "- **Likely question?** short honest answer from the facts, or 'I'd need to check'".`;
  }

  // Shared by Tier 1 and Tier 2: answers should read like something a person
  // would actually say, not a polished AI essay.
  _styleRule() {
    return `
STYLE — sound like a real person, not an AI:
- Write the way a well-prepared student would actually say it out loud: simple everyday words, short sentences, natural flow.
- Use "I" and contractions ("I'd", "we used", "it's", "didn't").
- Never use AI/corporate words: leverage, robust, seamless, utilize, delve, holistic, cutting-edge, synergy, paradigm, "it's important to note", "in today's fast-paced world", "great question".
- Don't over-explain or list every possibility. Give one clear idea and one concrete, believable example (a project, a number, a real situation).
- Only name specific products, models or versions if they come from the user's context or you're sure they're current; otherwise say it generically ("a cheaper, smaller model"). Naming outdated tech makes the speaker sound out of date.
- Keep it modest and honest. It's fine to say "I haven't used X much, but…" or "from what I've seen…". Don't sound like an expert lecturing.
- Light, not heavy: if a sentence sounds like a textbook or a blog post, rewrite it the way you'd say it to a friend.`;
  }

  _languageRule() {
    const lang = this.answerLanguage || 'English';
    const out = lang === 'same'
      ? 'Reply in the same language/style as the current question (English, Hindi or Hinglish).'
      : lang === 'Hinglish'
        ? 'Reply in Hinglish: Hindi written in English (Latin) letters, keeping technical terms in English.'
        : lang === 'Hindi'
          ? 'Reply in Hindi (Devanagari script), keeping technical terms in English.'
          : 'Reply in English.';
    return `- The conversation may be in English, Hindi or a mix (Hinglish), in Latin or Devanagari script. Understand all of it, including Hindi parts, as context. ${out}`;
  }

  /**
   * Start generation for a question (called speculatively or confirmed)
   */
  async startGeneration(questionText, speechEndTime, { isSpeculative = false } = {}) {
    if (!this.apiKey) {
      if (this.onError) this.onError(new Error('OpenRouter API key is required. Please set it in Settings.'));
      return;
    }

    // Cancel any previous in-flight requests
    this.cancelCurrent('new_question_started');

    const requestId = ++this.requestCounter;
    this.currentAbortController = new AbortController();
    this.isSpeculating = isSpeculative;
    this.hiddenTier1Buffer = '';
    this.isTier1Revealed = !isSpeculative;

    const tTrigger = Date.now();
    let tFirstToken = null;
    let tFirstRender = null;

    if (this.onDeadlineAlert) this.onDeadlineAlert('thinking');

    // Deadlines
    this._startDeadlines(requestId);

    if (this.onTier1Start) this.onTier1Start();

    // ── Build Tier 1 Messages ──
    const star = this._isStarMode();
    const systemPromptTier1 = `You are an elite real-time personal assistant assisting the user live everywhere (interviews, meetings, calls, lectures, discussions).
Provide crisp, direct guidance and facts for the live conversation or question.
${star ? this._starTier1Rules() : `OUTPUT RULES:
- Line 1: ONE concise direct answer sentence (plain text, no heading).
- Lines 2-4: Exactly THREE bullets. Each starts with the bolded key term itself, then a colon and a short punchy point, e.g. "- **Caching**: reuse answers for repeat queries". Never write the literal word "Keyword".
- Maximum 60 words total.`}
- NEVER include conversational fluff, greetings, or filler. Start immediately with the direct answer.
- If the transcript has an obvious mishearing, silently answer the intended question.
${this._styleRule()}
${this._languageRule()}${this._modeBlock(star ? 60000 : 8000)}`;

    const userContent = this._formatUserPrompt(questionText);

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://vividhdesign.com/overlay',
          'X-Title': 'Interview Helper'
        },
        body: JSON.stringify({
          model: this.tier1Model,
          messages: [
            { role: 'system', content: systemPromptTier1 },
            { role: 'user', content: userContent }
          ],
          max_tokens: star ? 220 : 120, // STAR = story line + 4 bullets
          temperature: 0.3,
          stream: true
        }),
        signal: this.currentAbortController.signal
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter Tier 1 Error (${response.status}): ${errText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullTier1Text = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Check if aborted or superseded
        if (requestId !== this.requestCounter) {
          reader.cancel();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep remainder

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content || '';
            if (delta) {
              if (!tFirstToken) {
                tFirstToken = Date.now();
                this._clearDeadlines(); // First token arrived, clear timeout warnings
              }

              fullTier1Text += delta;

              if (this.isSpeculating && !this.isTier1Revealed) {
                // Buffer silently in background
                this.hiddenTier1Buffer += delta;
              } else {
                if (!tFirstRender) {
                  tFirstRender = Date.now();
                }
                if (this.onTier1Token) {
                  this.onTier1Token(delta, fullTier1Text);
                }
              }
            }
          } catch (e) {
            // Ignore parse errors on malformed SSE chunk
          }
        }
      }

      if (requestId === this.requestCounter) {
        const totalLag = tFirstRender ? (tFirstRender - speechEndTime) : (Date.now() - speechEndTime);
        if (this.onTier1Complete) {
          this.onTier1Complete(fullTier1Text, totalLag);
        }

        // ── Start Tier 2 immediately behind Tier 1 ──
        this._startTier2(requestId, questionText, fullTier1Text);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // Normal cancellation
        return;
      }
      console.error('[AnswerEngine Tier 1] Error:', err);
      if (this.onError) this.onError(err);
    }
  }

  /**
   * Reveal the hidden speculative buffer when silence is confirmed
   */
  confirmSpeculation() {
    if (!this.isSpeculating) return;
    this.isSpeculating = false;
    this.isTier1Revealed = true;

    if (this.hiddenTier1Buffer && this.onTier1Token) {
      // Flush buffered tokens to UI all at once
      this.onTier1Token(this.hiddenTier1Buffer, this.hiddenTier1Buffer);
    }
  }

  /**
   * Cancel in-flight generation
   */
  cancelCurrent(reason = '') {
    this._clearDeadlines();
    if (this.currentAbortController) {
      try {
        this.currentAbortController.abort();
      } catch (e) {}
      this.currentAbortController = null;
    }
    this.isSpeculating = false;
    this.hiddenTier1Buffer = '';
  }

  /**
   * Start Tier 2 deep structured guidance
   */
  async _startTier2(requestId, questionText, tier1Summary) {
    if (requestId !== this.requestCounter) return;

    if (this.onTier2Start) this.onTier2Start();

    const star = this._isStarMode();
    const systemPromptTier2 = `You are an elite real-time expert personal advisor.
The user was asked the question or is in the discussion below and was already given quick talking points.
The user reads this LIVE while talking, so it must be skimmable in 5 seconds.
Use EXACTLY these markdown sections, in this order, with these headings:
${star ? this._starTier2Sections() : `
## 🎯 Say this
One or two natural first-person sentences the user can say out loud right now.

## ⭐ Key points
3-5 bullets. Each starts with the bolded key term itself, e.g. "- **Routing**: send simple tasks to cheap models", at most 14 words.

## 🔍 Details
3-5 bullets of concrete facts, examples, numbers, methods or trade-offs, at most 18 words each.

## ⚠️ Avoid
2-3 bullets: traps, pitfalls or things not to say.

## ↪️ If they follow up
1-2 bullets: "- **Likely question?** one-line answer".`}

RULES:
- Bold only the 1-3 most important words per bullet; never bold whole sentences.
- No preamble, no closing remarks, no meta-commentary (e.g. about the transcript). If the transcript has an obvious mishearing, silently use the intended words.
- No paragraphs longer than ${star ? '4' : '2'} lines. Total under ${star ? '320' : '230'} words.
- Don't repeat the quick talking points verbatim; go deeper.
- Ground facts in the user's background/context when applicable.
- Keep the section headings exactly as given (in English) whatever the reply language.
${this._styleRule()}
${this._languageRule()}${this._modeBlock(60000)}`;

    const userPrompt = `${this._formatUserPrompt(questionText)}

[Quick guidance already shown]:
${tier1Summary}`;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://vividhdesign.com/overlay',
          'X-Title': 'Interview Helper'
        },
        body: JSON.stringify({
          model: this.tier2Model,
          messages: [
            { role: 'system', content: systemPromptTier2 },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 1000, // 5 sections + emoji/markdown overhead was getting cut off at 600
          temperature: 0.4,
          stream: true
        }),
        signal: this.currentAbortController ? this.currentAbortController.signal : undefined
      });

      if (!response.ok) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullTier2Text = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (requestId !== this.requestCounter) {
          reader.cancel();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullTier2Text += delta;
              if (this.onTier2Token) {
                this.onTier2Token(delta, fullTier2Text);
              }
            }
          } catch (e) {}
        }
      }

      if (requestId === this.requestCounter && this.onTier2Complete) {
        this.onTier2Complete(fullTier2Text);
        // The question itself is already in history (every speech segment is
        // added as it's transcribed); just note what was suggested.
        this.addTurn('AI suggestion shown to me', fullTier2Text.slice(0, 200) + '...');
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[AnswerEngine Tier 2] Error:', err);
      }
    }
  }

  _formatUserPrompt(questionText) {
    let prompt = '';
    const prof = this.candidateProfile || {};

    if (prof.targetRole || prof.jobDescription || prof.resume) {
      prompt += `[Candidate Profile & Role]:\n`;
      if (prof.targetRole) prompt += `Target Role: ${prof.targetRole}\n`;
      if (prof.jobDescription) prompt += `Job Description: ${prof.jobDescription.slice(0, 500)}\n`;
      if (prof.resume) prompt += `Resume / Skills: ${prof.resume.slice(0, 500)}\n`;
      prompt += `\n`;
    }

    if (this.rollingConversation.length > 0) {
      prompt += `[Recent Conversation History]:\n`;
      for (const turn of this.rollingConversation) {
        prompt += `${turn.speaker}: ${turn.text}\n`;
      }
      prompt += `\n`;
    }

    prompt += `[Current Question to Answer]:\n"${questionText}"`;
    return prompt;
  }

  _startDeadlines(requestId) {
    this._clearDeadlines();

    // 1.5s deadline: "Still working..."
    this.deadline1_5Timer = setTimeout(() => {
      if (requestId === this.requestCounter && !this.isTier1Revealed) {
        if (this.onDeadlineAlert) this.onDeadlineAlert('still_working');
      }
    }, 1500);

    // 3.0s deadline: Hard deadline fallback -> "Ask them to repeat the question"
    this.deadline3_0Timer = setTimeout(() => {
      if (requestId === this.requestCounter && !this.isTier1Revealed) {
        this.cancelCurrent('timeout_3s');
        if (this.onDeadlineAlert) this.onDeadlineAlert('ask_repeat');
      }
    }, 3000);
  }

  _clearDeadlines() {
    if (this.deadline1_5Timer) {
      clearTimeout(this.deadline1_5Timer);
      this.deadline1_5Timer = null;
    }
    if (this.deadline3_0Timer) {
      clearTimeout(this.deadline3_0Timer);
      this.deadline3_0Timer = null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AnswerEngine };
}
