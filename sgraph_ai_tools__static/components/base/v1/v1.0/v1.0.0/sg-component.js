/* =================================================================================
   SGraph — Base Component Class
   v1.0.0 — Shadow DOM components with resource loading

   Adapted from VaultComponent (SG/Send vault UI v0.1.1).
   All SGraph shared components extend this base class.

   Pattern:
     - Shadow DOM for style isolation
     - Fetches .html template + .css from sibling files
     - Lifecycle: loadResources() -> bindElements() -> setupEventListeners() -> onReady()

   Usage:
     import { SgComponent, SgComponentPaths } from './sg-component.js';

     class MySiteHeader extends SgComponent { ... }
   ================================================================================= */

/**
 * Path resolution for SGraph components.
 * Resolves component resource URLs relative to the component's JS file location.
 *
 * @param {string} baseUrl - The base URL of the component JS file
 */
class SgComponentPaths {

    /**
     * Resolve paths for a component's resources.
     * Assumes .html and .css files are siblings of the .js file.
     *
     * @param {string} jsUrl - The URL of the component's JS module
     * @param {string} componentName - The component file name (without extension)
     * @returns {{ html: string, css: string }}
     */
    static resolve(jsUrl, componentName) {
        const base = jsUrl.substring(0, jsUrl.lastIndexOf('/') + 1)
        return {
            html : base + componentName + '.html',
            css  : base + componentName + '.css'
        }
    }

    /**
     * Resolve path for a shared CSS file relative to a component's JS file.
     *
     * @param {string} jsUrl - The URL of the component's JS module
     * @param {string} relativePath - Relative path from the component to the shared CSS
     * @returns {string}
     */
    static resolveShared(jsUrl, relativePath) {
        const base = jsUrl.substring(0, jsUrl.lastIndexOf('/') + 1)
        return new URL(relativePath, base).href
    }
}

/**
 * Base class for all SGraph shared UI components.
 * Provides Shadow DOM, resource loading, event tracking, and lifecycle hooks.
 *
 * Subclasses override:
 *   - resourceName()         — file name for .html/.css (default: tag name)
 *   - sharedCssPaths()       — array of shared CSS URLs to inject before component CSS
 *   - bindElements()         — cache shadow DOM element references
 *   - setupEventListeners()  — bind event handlers
 *   - onReady()              — called after all resources loaded and elements bound
 */
class SgComponent extends HTMLElement {

    constructor() {
        super()
        this.attachShadow({ mode: 'open' })
        this._eventListeners  = []
        this._isReady         = false
        this._resourcesLoaded = false
    }

    // --- Lifecycle ---------------------------------------------------------------

    async connectedCallback() {
        try {
            await this.loadResources()
            this.bindElements()
            this.setupEventListeners()
            this._isReady = true
            this.onReady()
            this.emit('component-ready', { component: this.tagName.toLowerCase() })
        } catch (error) {
            console.error(`[${this.tagName}] Failed to initialize:`, error)
            this.showError(`Failed to load component: ${error.message}`)
        }
    }

    disconnectedCallback() {
        this.cleanup()
    }

    /** Override in subclass — called after resources loaded and elements bound. */
    onReady() {}

    /** Override in subclass — cache shadow DOM element references via this.$(). */
    bindElements() {}

    /** Override in subclass — bind event handlers via this.addTrackedListener(). */
    setupEventListeners() {}

    // --- Resource Loading --------------------------------------------------------

    /**
     * The file name (without extension) for this component's .html and .css.
     * Override if the file names don't match the tag name.
     * @returns {string}
     */
    get resourceName() {
        return this.tagName.toLowerCase()
    }

    /**
     * Array of shared CSS file paths to load before component CSS.
     * Paths are relative to the component's JS file.
     * Override in subclass to include shared tokens, etc.
     * @returns {string[]}
     */
    get sharedCssPaths() {
        return []
    }

    async loadResources() {
        if (this._resourcesLoaded) return

        const jsUrl = this._resolveJsUrl()
        const paths = SgComponentPaths.resolve(jsUrl, this.resourceName)

        const sharedCssUrls = this.sharedCssPaths.map(
            p => SgComponentPaths.resolveShared(jsUrl, p)
        )

        const fetches = [
            ...sharedCssUrls.map(url => this._fetchCss(url)),
            this._fetchCss(paths.css),
            this._fetchHtml(paths.html)
        ]

        const results  = await Promise.all(fetches)
        const htmlText = results.pop()
        const cssTexts = results

        const styleBlocks = cssTexts.map(css => `<style>${css}</style>`).join('\n')

        this.shadowRoot.innerHTML = `${styleBlocks}\n${htmlText}`

        this._resourcesLoaded = true
    }

    /**
     * Resolve the URL of the JS file that defines this component.
     * Uses import.meta.url when available; subclasses can override.
     * @returns {string}
     */
    _resolveJsUrl() {
        // Subclasses should set static jsUrl = import.meta.url in their module
        return this.constructor.jsUrl || import.meta.url
    }

    async _fetchCss(url) {
        try {
            const response = await fetch(url)
            if (!response.ok) return ''
            return response.text()
        } catch {
            return ''
        }
    }

    async _fetchHtml(url) {
        try {
            const response = await fetch(url)
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            return response.text()
        } catch (error) {
            console.error(`[${this.tagName}] Failed to load template: ${url}`, error)
            throw error
        }
    }

    // --- Event Helpers -----------------------------------------------------------

    /**
     * Dispatch a custom event that crosses Shadow DOM boundaries.
     * @param {string} eventName
     * @param {Object} detail
     */
    emit(eventName, detail = {}) {
        this.dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles:  true,
            composed: true
        }))
    }

    /**
     * Add an event listener that will be automatically removed on disconnect.
     * @param {EventTarget} target
     * @param {string} eventType
     * @param {Function} handler
     * @param {Object} options
     */
    addTrackedListener(target, eventType, handler, options = {}) {
        const boundHandler = handler.bind(this)
        target.addEventListener(eventType, boundHandler, options)
        this._eventListeners.push({ target, eventType, handler: boundHandler, options })
    }

    /** Query a single element in the shadow root. */
    $(selector)  { return this.shadowRoot.querySelector(selector)    }

    /** Query all matching elements in the shadow root. */
    $$(selector) { return this.shadowRoot.querySelectorAll(selector) }

    // --- Error Display -----------------------------------------------------------

    showError(message) {
        this.shadowRoot.innerHTML = `
            <style>
                .sg-component-error {
                    padding: 20px;
                    background: rgba(233, 69, 96, 0.1);
                    border: 1px solid rgba(233, 69, 96, 0.2);
                    border-radius: 8px;
                    color: #E94560;
                    font-family: system-ui, -apple-system, sans-serif;
                }
                .sg-component-error__title { font-weight: 600; margin-bottom: 8px; }
            </style>
            <div class="sg-component-error">
                <div class="sg-component-error__title">Component Error</div>
                <div>${this._escapeHtml(message)}</div>
            </div>
        `
    }

    // --- Utilities ---------------------------------------------------------------

    _escapeHtml(text) {
        const div = document.createElement('div')
        div.textContent = text
        return div.innerHTML
    }

    // --- Cleanup -----------------------------------------------------------------

    cleanup() {
        for (const { target, eventType, handler, options } of this._eventListeners) {
            target.removeEventListener(eventType, handler, options)
        }
        this._eventListeners = []
        this._isReady = false
    }

    get isReady() { return this._isReady }

    whenReady(timeout = 5000) {
        if (this._isReady) return Promise.resolve()
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Component ${this.tagName} ready timeout`))
            }, timeout)
            this.addEventListener('component-ready', () => {
                clearTimeout(timer)
                resolve()
            }, { once: true })
        })
    }
}

export { SgComponent, SgComponentPaths }
