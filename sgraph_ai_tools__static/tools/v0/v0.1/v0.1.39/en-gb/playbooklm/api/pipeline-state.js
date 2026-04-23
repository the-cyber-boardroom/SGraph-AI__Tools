/**
 * PlaybookLM — PipelineState class.
 *
 * Pure state container for the PlaybookLM pipeline. No LLM calls, no DOM.
 * Holds all pipeline data and notifies listeners on change.
 *
 * @module pipeline-state
 * @version 0.1.0
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

    /** @type {string} OpenRouter API key */
    this._apiKey = '';

    /** @type {string} Model for text (LLM) calls */
    this._textModel = 'google/gemini-2.5-flash-preview';

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
   * Get all slide results.
   *
   * @returns {Array<{index: number, imageSrc: string|null, status: string, error: string|null}>}
   */
  getSlideResults() {
    return [...this._slideResults];
  }

  /**
   * Set or update a slide result by index.
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
    this._apiKey = apiKey;
    this._textModel = textModel;
    this._imageModel = imageModel;
    this._connected = true;
    this._stopped = false;
    this._notify();
  }

  /**
   * Get the current API key.
   *
   * @returns {string}
   */
  get apiKey() { return this._apiKey; }

  /**
   * Get the current text model ID.
   *
   * @returns {string}
   */
  get textModel() { return this._textModel; }

  /**
   * Set the text model ID.
   *
   * @param {string} model
   * @returns {void}
   */
  set textModel(model) { this._textModel = model; this._notify(); }

  /**
   * Get the current image model ID.
   *
   * @returns {string}
   */
  get imageModel() { return this._imageModel; }

  /**
   * Set the image model ID.
   *
   * @param {string} model
   * @returns {void}
   */
  set imageModel(model) { this._imageModel = model; this._notify(); }

  /**
   * Whether the pipeline is currently connected.
   *
   * @returns {boolean}
   */
  get connected() { return this._connected; }

  /**
   * Whether a stop has been requested.
   *
   * @returns {boolean}
   */
  get stopped() { return this._stopped; }

  // ── Abort controllers ─────────────────────────────────────────────────────

  /**
   * Register an AbortController to be cancelled on stop().
   *
   * @param {AbortController} controller
   * @returns {void}
   */
  addAbortController(controller) {
    this._abortControllers.push(controller);
  }

  /**
   * Remove an AbortController after its request completes.
   *
   * @param {AbortController} controller
   * @returns {void}
   */
  removeAbortController(controller) {
    this._abortControllers = this._abortControllers.filter(c => c !== controller);
  }

  // ── Control ───────────────────────────────────────────────────────────────

  /**
   * Stop all active pipeline operations by aborting all controllers.
   *
   * @returns {void}
   */
  stop() {
    this._stopped = true;
    for (const c of this._abortControllers) {
      try { c.abort(); } catch (_) { /* swallow */ }
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
    return {
      connected:       this._connected,
      textModel:       this._textModel,
      imageModel:      this._imageModel,
      sources:         this.getSources(),
      presentationDoc: this._presentationDoc,
      slideBriefs:     this.getSlideBriefs(),
      slideResults:    this.getSlideResults(),
      stopped:         this._stopped,
    };
  }

  /**
   * Get a brief pipeline status summary.
   *
   * @returns {{connected: boolean, sourceCount: number, briefCount: number, slideCount: number, stopped: boolean}}
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
