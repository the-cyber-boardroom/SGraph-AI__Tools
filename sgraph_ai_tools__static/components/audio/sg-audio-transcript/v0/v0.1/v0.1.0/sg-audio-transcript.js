/**
 * sg-audio-transcript.js
 * Web Component for displaying live transcription captions.
 * v0.1.0 — scrolling text, confidence colouring, word count, model badge.
 *
 * Usage:
 *   <sg-audio-transcript id="transcript"></sg-audio-transcript>
 *
 * Public methods:
 *   appendSegment({ index, text, latencyMs, modelId, confidence? })
 *   clear()
 *
 * @module sg-audio-transcript
 */

const TEMPLATE = `
<style>
  :host {
    display: block;
    font-family: 'Fira Mono', monospace;
    color: var(--sg-text, #ccd6f6);
    height: 100%;
  }
  .tx-wrap {
    display: flex; flex-direction: column; height: 100%;
  }
  .tx-toolbar {
    display: flex; align-items: center; gap: 0.4rem;
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid var(--sg-border, #2a3a5c);
    background: var(--sg-bg-primary, #0d1b2a);
    flex-shrink: 0;
  }
  .tx-meta {
    font-size: 0.62rem; color: var(--sg-text-muted, #8892b0);
    flex: 1;
  }
  .tx-meta span { color: var(--sg-accent, #4ecdc4); }
  .btn-clear {
    padding: 0.15rem 0.45rem; border-radius: 4px;
    border: 1px solid var(--sg-border, #2a3a5c);
    background: transparent; color: var(--sg-text-muted, #8892b0);
    font-size: 0.62rem; cursor: pointer;
  }
  .btn-clear:hover { border-color: var(--sg-accent, #4ecdc4); color: var(--sg-accent, #4ecdc4); }
  .tx-scroll {
    flex: 1; overflow-y: auto; padding: 0.5rem;
    display: flex; flex-direction: column; gap: 0.35rem;
  }
  .tx-empty {
    color: var(--sg-text-muted, #8892b0); font-size: 0.7rem;
    text-align: center; margin-top: 2rem; line-height: 1.7;
  }
  .tx-segment {
    border-left: 2px solid var(--sg-border, #2a3a5c);
    padding: 0.2rem 0.5rem;
    font-size: 0.78rem; line-height: 1.5;
    animation: fadeIn 0.2s ease;
  }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .tx-segment.high { border-left-color: #6ee7b7; }
  .tx-segment.mid  { border-left-color: #fbbf24; }
  .tx-segment.low  { border-left-color: #8892b0; }
  .tx-seg-meta {
    font-size: 0.6rem; color: var(--sg-text-muted, #8892b0);
    margin-bottom: 0.1rem;
    display: flex; gap: 0.5rem;
  }
  .tx-seg-text {
    color: var(--sg-text, #ccd6f6);
    white-space: pre-wrap; word-break: break-word;
  }
  .tx-seg-text.empty { color: var(--sg-text-muted, #8892b0); font-style: italic; }
  .pill-model {
    font-size: 0.58rem; font-weight: 700; border-radius: 9999px;
    padding: 0.05rem 0.35rem; border: 1px solid;
    background: rgba(167,139,250,0.1); color: #a78bfa; border-color: rgba(167,139,250,0.3);
  }
  .pill-model.base { background: rgba(78,205,196,0.1); color: var(--sg-accent,#4ecdc4); border-color: rgba(78,205,196,0.3); }
</style>
<div class="tx-wrap">
  <div class="tx-toolbar">
    <div class="tx-meta">
      <span id="word-count">0</span> words
      &nbsp;·&nbsp; <span id="seg-count">0</span> segments
    </div>
    <button class="btn-clear" id="btn-clear">Clear</button>
  </div>
  <div class="tx-scroll" id="scroll">
    <div class="tx-empty" id="empty">
      Transcriptions will appear here as each audio segment is processed.<br>
      Start recording to begin.
    </div>
  </div>
</div>
`;

export class SgAudioTranscript extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = TEMPLATE;
        this._wordCount = 0;
        this._segCount  = 0;
    }

    connectedCallback() {
        this.shadowRoot.getElementById('btn-clear').addEventListener('click', () => this.clear());
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Append a transcription result for a segment.
     * @param {Object} opts
     * @param {number} opts.index       Segment index (1-based)
     * @param {string} opts.text        Transcription text
     * @param {number} [opts.latencyMs] Inference latency
     * @param {string} [opts.modelId]   Model used (e.g. 'Xenova/whisper-tiny.en')
     * @param {number} [opts.confidence] 0–1 confidence hint
     */
    appendSegment({ index, text, latencyMs, modelId = '', confidence }) {
        const scroll = this.shadowRoot.getElementById('scroll');
        const empty  = this.shadowRoot.getElementById('empty');
        if (empty) empty.style.display = 'none';

        this._segCount++;
        const words = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
        this._wordCount += words;
        this._updateMeta();

        const conf  = confidence ?? 1;
        const tier  = conf > 0.8 ? 'high' : conf > 0.5 ? 'mid' : 'low';
        const isTiny = modelId.includes('tiny');
        const modelLabel = modelId ? modelId.replace('Xenova/', '') : '';

        const div = document.createElement('div');
        div.className = `tx-segment ${tier}`;

        const metaDiv = document.createElement('div');
        metaDiv.className = 'tx-seg-meta';
        metaDiv.innerHTML = `
            <span>seg ${String(index).padStart(3,'0')}</span>
            ${latencyMs != null ? `<span>${latencyMs} ms</span>` : ''}
            ${modelLabel ? `<span class="pill-model ${isTiny ? '' : 'base'}">${modelLabel}</span>` : ''}
        `;

        const textDiv = document.createElement('div');
        textDiv.className = `tx-seg-text ${text ? '' : 'empty'}`;
        textDiv.textContent = text || '[no speech detected]';

        div.appendChild(metaDiv);
        div.appendChild(textDiv);
        scroll.appendChild(div);

        // Auto-scroll to bottom
        scroll.scrollTop = scroll.scrollHeight;
    }

    /** Clear all transcript entries */
    clear() {
        this._wordCount = 0;
        this._segCount  = 0;
        this._updateMeta();

        const scroll = this.shadowRoot.getElementById('scroll');
        // Remove all segment divs but keep the empty placeholder
        [...scroll.querySelectorAll('.tx-segment')].forEach(el => el.remove());

        const empty = scroll.querySelector('.tx-empty') ?? (() => {
            const d = document.createElement('div');
            d.className = 'tx-empty';
            d.id = 'empty';
            d.innerHTML = 'Transcriptions will appear here as each audio segment is processed.<br>Start recording to begin.';
            return d;
        })();
        empty.style.display = '';
        if (!scroll.contains(empty)) scroll.appendChild(empty);
    }

    /** Get full transcript as plain text */
    get fullText() {
        return [...this.shadowRoot.querySelectorAll('.tx-seg-text:not(.empty)')]
            .map(el => el.textContent)
            .join('\n');
    }

    // ── Private ───────────────────────────────────────────────────────────────

    _updateMeta() {
        this.shadowRoot.getElementById('word-count').textContent = this._wordCount;
        this.shadowRoot.getElementById('seg-count').textContent  = this._segCount;
    }
}

customElements.define('sg-audio-transcript', SgAudioTranscript);
