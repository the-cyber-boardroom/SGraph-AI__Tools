/**
 * PlaybookLM — PipelineState class.
 *
 * Pure state container for the PlaybookLM pipeline. No LLM calls, no DOM.
 * Holds all pipeline data and notifies listeners on change.
 *
 * v0.1.2 changes:
 *  - Slide version tracking: _slideVersions (Map<index, VersionData[]>) and
 *    _selectedVersions (Map<index, number>) added.
 *  - addSlideVersion(index, data): appends a new version, auto-selects latest.
 *  - getSlideVersions(index): returns all versions for a slide.
 *  - getSelectedVersion(index): returns current selected version index.
 *  - setSelectedVersion(index, vIdx): selects a version, syncs _slideResults.
 *  - getSlideResults() backward-compat: still returns [{index,status,imageSrc,error}]
 *    using the selected version's imageSrc.
 *
 * @module pipeline-state
 * @version 0.1.2
 */

const LS_DECK_COST_KEY = 'plm-deck-cost';

/**
 * @typedef {object} SlideVersion
 * @property {string}      imageSrc     - Data URL of the generated image
 * @property {string}      title        - Slide title
 * @property {string}      briefPrompt  - Visual brief used for this version
 * @property {string}      systemPrompt - System prompt used for this version
 * @property {string}      model        - Model ID used
 * @property {number}      cost         - USD cost
 * @property {number}      ts           - Unix timestamp (ms)
 * @property {number}      latencyMs    - Generation latency in ms
 */

/**
 * Pure state container for the PlaybookLM pipeline.
 * All state changes call _notify() to alert registered onChange handlers.
 */
export class PipelineState {
  constructor() {
    /** @type {Array<{name: string, type: string, textContent: string}>} */
    this._sources = [];

    /** @type {string} The generated presentation document text */
    this._presentationDoc = '';

    /** @type {Array<{title: string, prompt: string}>} */
    this._slideBriefs = [];

    /** @type {Array<{index: number, imageSrc: string|null, status: string, error: string|null}>} */
    this._slideResults = [];

    /** @type {Map<number, SlideVersion[]>} All generated versions per slide */
    this._slideVersions = new Map();

    /** @type {Map<number, number>} Selected version index per slide (default: latest) */
    this._selectedVersions = new Map();

    /** @type {string} OpenRouter API key */
    this._apiKey = '';

    /** @type {string} Model for text (LLM) calls */
    this._textModel = 'anthropic/claude-sonnet-4-6';

    /** @type {string} Model for image (LLM) calls */
    this._imageModel = 'google/gemini-3.1-flash-image-preview';

    /** @type {boolean} Whether connected to OpenRouter */
    this._connected = false;

    /** @type {boolean} Whether a stop has been requested */
    this._stopped = false;

    /** @type {Array<Function>} onChange listener functions */
    this._listeners = [];

    /** @type {Array<AbortController>} Active abort controllers */
    this._abortControllers = [];

    // ── Cost tracking ──────────────────────────────────────────────────────

    /** @type {number} Cumulative USD cost for this browser session */
    this._sessionCost = 0;

    /** @type {number} Cumulative USD cost across all sessions for this deck */
    this._deckCost = parseFloat(localStorage.getItem(LS_DECK_COST_KEY) || '0') || 0;
  }

  // ── Listeners ─────────────────────────────────────────────────────────────

  /**
   * Register a listener to be called on any state change.
   *
   * @param {Function} fn - Called with no arguments when state changes
   * @returns {Function} Unsubscribe function
   */
  onChange(fn) {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter(l => l !== fn);
    };
  }

  /**
   * Notify all registered listeners of a state change.
   *
   * @returns {void}
   */
  _notify() {
    for (const fn of this._listeners) {
      try { fn(); } catch (_) { /* swallow */ }
    }
  }

  // ── Sources ───────────────────────────────────────────────────────────────

  /**
   * Load source files into state.
   *
   * @param {Array<{name: string, type: string, textContent: string}>} files
   * @returns {Array<{name: string, type: string, textContent: string}>}
   */
  loadSources(files) {
    this._sources = [...this._sources, ...files];
    this._notify();
    return this._sources;
  }

  /**
   * Get all loaded sources.
   *
   * @returns {Array<{name: string, type: string, textContent: string}>}
   */
  getSources() {
    return [...this._sources];
  }

  /**
   * Remove a source by index.
   *
   * @param {number} index
   * @returns {void}
   */
  removeSource(index) {
    this._sources.splice(index, 1);
    this._notify();
  }

  // ── Presentation ──────────────────────────────────────────────────────────

  /**
   * Get the current presentation document text.
   *
   * @returns {string}
   */
  getPresentation() {
    return this._presentationDoc;
  }

  /**
   * Set the presentation document text.
   *
   * @param {string} text
   * @returns {void}
   */
  setPresentation(text) {
    this._presentationDoc = String(text);
    this._notify();
  }

  // ── Slide Briefs ──────────────────────────────────────────────────────────

  /**
   * Get all slide briefs.
   *
   * @returns {Array<{title: string, prompt: string}>}
   */
  getSlideBriefs() {
    return [...this._slideBriefs];
  }

  /**
   * Replace all slide briefs.
   *
   * @param {Array<{title: string, prompt: string}>} briefs
   * @returns {void}
   */
  setSlideBriefs(briefs) {
    this._slideBriefs = [...briefs];
    this._notify();
  }

  /**
   * Update a single slide brief by index.
   *
   * @param {number} index
   * @param {{title?: string, prompt?: string}} brief
   * @returns {void}
   */
  setSlideBrief(index, brief) {
    if (index < 0 || index >= this._slideBriefs.length) return;
    this._slideBriefs[index] = { ...this._slideBriefs[index], ...brief };
    this._notify();
  }

  /**
   * Add a new slide brief.
   *
   * @param {{title: string, prompt: string}} brief
   * @returns {void}
   */
  addSlideBrief(brief) {
    this._slideBriefs.push(brief);
    this._notify();
  }

  /**
   * Remove a slide brief by index.
   *
   * @param {number} index
   * @returns {void}
   */
  removeSlideBrief(index) {
    this._slideBriefs.splice(index, 1);
    this._notify();
  }

  // ── Slide Results ─────────────────────────────────────────────────────────

  /**
   * Get all slide results (selected versions, backward-compatible).
   *
   * @returns {Array<{index: number, imageSrc: string|null, status: string, error: string|null}>}
   */
  getSlideResults() {
    return [...this._slideResults];
  }

  /**
   * Set or update a slide result by index.
   * Does NOT create a version entry (that is done by addSlideVersion).
   *
   * @param {number} index
   * @param {{imageSrc?: string|null, status?: string, error?: string|null}} result
   * @returns {void}
   */
  setSlideResult(index, result) {
    const existing = this._slideResults.find(r => r.index === index);
    if (existing) {
      Object.assign(existing, result);
    } else {
      this._slideResults.push({ index, imageSrc: null, status: 'pending', error: null, ...result });
    }
    this._notify();
  }

  // ── Slide Versions ────────────────────────────────────────────────────────

  /**
   * Add a generated version for a slide.
   * Automatically selects the new version as the current one.
   *
   * @param {number} index
   * @param {SlideVersion} versionData
   * @returns {void}
   */
  addSlideVersion(index, versionData) {
    if (!this._slideVersions.has(index)) {
      this._slideVersions.set(index, []);
    }
    const versions = this._slideVersions.get(index);
    versions.push(versionData);

    // Auto-select the new (latest) version
    const newVersionIdx = versions.length - 1;
    this._selectedVersions.set(index, newVersionIdx);

    // Keep _slideResults in sync with selected version
    const result = this._slideResults.find(r => r.index === index);
    if (result) {
      result.imageSrc = versionData.imageSrc;
      result.status   = 'complete';
      result.error    = null;
    }

    this._notify();
  }

  /**
   * Get all generated versions for a slide.
   *
   * @param {number} index
   * @returns {SlideVersion[]}
   */
  getSlideVersions(index) {
    return [...(this._slideVersions.get(index) || [])];
  }

  /**
   * Get the currently selected version index for a slide.
   * Returns -1 if no versions exist.
   *
   * @param {number} index
   * @returns {number}
   */
  getSelectedVersion(index) {
    const versions = this._slideVersions.get(index);
    if (!versions || versions.length === 0) return -1;
    return this._selectedVersions.get(index) ?? versions.length - 1;
  }

  /**
   * Select a specific version as the active one for a slide.
   * Syncs the imageSrc in _slideResults so export still works.
   *
   * @param {number} index
   * @param {number} versionIdx
   * @returns {void}
   */
  setSelectedVersion(index, versionIdx) {
    const versions = this._slideVersions.get(index) || [];
    if (versionIdx < 0 || versionIdx >= versions.length) return;
    this._selectedVersions.set(index, versionIdx);

    // Sync _slideResults so getSlideResults() returns the selected imageSrc
    const result  = this._slideResults.find(r => r.index === index);
    const version = versions[versionIdx];
    if (result && version) {
      result.imageSrc = version.imageSrc;
    }
    this._notify();
  }

  // ── Connection ────────────────────────────────────────────────────────────

  /**
   * Set connection credentials and status.
   *
   * @param {string} apiKey
   * @param {string} textModel
   * @param {string} imageModel
   * @returns {void}
   */
  setConnected(apiKey, textModel, imageModel) {
    this._apiKey     = apiKey;
    this._textModel  = textModel;
    this._imageModel = imageModel;
    this._connected  = true;
    this._stopped    = false;
    this._notify();
  }

  /** @returns {string} */
  get apiKey() { return this._apiKey; }

  /** @returns {string} */
  get textModel() { return this._textModel; }

  /** @param {string} model */
  set textModel(model) { this._textModel = model; this._notify(); }

  /** @returns {string} */
  get imageModel() { return this._imageModel; }

  /** @param {string} model */
  set imageModel(model) { this._imageModel = model; this._notify(); }

  /** @returns {boolean} */
  get connected() { return this._connected; }

  /** @returns {boolean} */
  get stopped() { return this._stopped; }

  // ── Abort controllers ─────────────────────────────────────────────────────

  /**
   * @param {AbortController} controller
   * @returns {void}
   */
  addAbortController(controller) {
    this._abortControllers.push(controller);
  }

  /**
   * @param {AbortController} controller
   * @returns {void}
   */
  removeAbortController(controller) {
    this._abortControllers = this._abortControllers.filter(c => c !== controller);
  }

  // ── Cost tracking ──────────────────────────────────────────────────────────

  /**
   * Add a cost amount to both session and deck totals.
   *
   * @param {number} amount - USD cost to add
   * @returns {void}
   */
  recordCost(amount) {
    if (!amount || isNaN(amount) || amount <= 0) return;
    this._sessionCost += amount;
    this._deckCost    += amount;
    try {
      localStorage.setItem(LS_DECK_COST_KEY, String(this._deckCost.toFixed(6)));
    } catch (_) {}
    this._notify();
  }

  /**
   * Reset the deck cost total to zero.
   *
   * @returns {void}
   */
  resetDeckCost() {
    this._deckCost = 0;
    try { localStorage.removeItem(LS_DECK_COST_KEY); } catch (_) {}
    this._notify();
  }

  /** @returns {number} */
  get sessionCost() { return this._sessionCost; }

  /** @returns {number} */
  get deckCost() { return this._deckCost; }

  // ── Control ───────────────────────────────────────────────────────────────

  /**
   * Stop all active pipeline operations.
   *
   * @returns {void}
   */
  stop() {
    this._stopped = true;
    for (const c of this._abortControllers) {
      try { c.abort(); } catch (_) {}
    }
    this._abortControllers = [];
    this._notify();
  }

  // ── Full state ────────────────────────────────────────────────────────────

  /**
   * Get the full pipeline state snapshot.
   *
   * @returns {object}
   */
  getFullState() {
    const slideVersionsObj = {};
    for (const [idx, versions] of this._slideVersions) {
      slideVersionsObj[idx] = {
        selectedVersion: this.getSelectedVersion(idx),
        versions: versions.map((v, i) => ({
          v: i + 1,
          model: v.model,
          cost: v.cost,
          ts: v.ts,
          latencyMs: v.latencyMs,
          briefPrompt: v.briefPrompt,
        })),
      };
    }
    return {
      connected:       this._connected,
      textModel:       this._textModel,
      imageModel:      this._imageModel,
      sources:         this.getSources(),
      presentationDoc: this._presentationDoc,
      slideBriefs:     this.getSlideBriefs(),
      slideResults:    this.getSlideResults(),
      slideVersions:   slideVersionsObj,
      stopped:         this._stopped,
      sessionCost:     this._sessionCost,
      deckCost:        this._deckCost,
    };
  }

  /**
   * Get a brief pipeline status summary.
   *
   * @returns {object}
   */
  getStatus() {
    return {
      connected:   this._connected,
      sourceCount: this._sources.length,
      briefCount:  this._slideBriefs.length,
      slideCount:  this._slideResults.filter(r => r.status === 'complete').length,
      stopped:     this._stopped,
    };
  }
}
