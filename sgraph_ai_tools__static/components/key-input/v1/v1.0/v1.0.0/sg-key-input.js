/* =================================================================================
   SGraph — Key Input Component
   v1.0.0 — Mobile-optimised input for friendly decryption keys

   Usage:
     <script type="module" src="/components/key-input/v1/v1.0/v1.0.0/sg-key-input.js"></script>

     <sg-key-input
         locale="en-gb"
         placeholder="apple-mango-56"
         button-text="Open File">
     </sg-key-input>

   Attributes:
     locale          — Language for auto-complete (default: "en-gb")
     placeholder     — Placeholder text (default: "apple-mango-56")
     auto-submit     — Auto-submit when valid key detected (boolean)
     button-text     — Submit button label (default: "Open File")
     show-validation — Show format validation feedback (default: true)

   Events:
     key-submitted — { key, normalised, derivedKey }
     key-changed   — { key, normalised, isValid }
   ================================================================================= */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js'
import { searchWords, getWordList } from '/core/wordlist/v1/v1.0/v1.0.0/sg-wordlist.js'
import { deriveKey } from '/core/pbkdf2/v1/v1.0/v1.0.0/sg-pbkdf2.js'

class SgKeyInput extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-key-input' }

    get sharedCssPaths() {
        return ['/components/tokens/v1/v1.0/v1.0.0/sg-tokens.css']
    }

    async onReady() {
        this._locale       = this.getAttribute('locale') || 'en-gb'
        this._autoSubmit   = this.hasAttribute('auto-submit')
        this._showValid    = this.getAttribute('show-validation') !== 'false'
        this._submitFailed = false

        const placeholder = this.getAttribute('placeholder') || 'apple-mango-56'
        this._input.setAttribute('placeholder', placeholder)

        const btnText = this.getAttribute('button-text') || 'Open File'
        this._submitBtn.textContent = btnText

        this._wordList = await getWordList(this._locale)
    }

    bindElements() {
        this._input      = this.$('#key-input')
        this._submitBtn  = this.$('#submit-btn')
        this._suggestions = this.$('#suggestions')
        this._feedback   = this.$('#feedback')
    }

    setupEventListeners() {
        this.addTrackedListener(this._input, 'input', this._onInput)
        this.addTrackedListener(this._input, 'paste', this._onPaste)
        this.addTrackedListener(this._input, 'keydown', this._onKeyDown)
        this.addTrackedListener(this._submitBtn, 'click', this._onSubmit)
    }

    // --- Input Processing --------------------------------------------------------

    /**
     * Sanitise raw input — strip invisible chars, normalise dashes, lowercase.
     * @param {string} raw
     * @returns {string}
     */
    _sanitise(raw) {
        return raw
            .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
            .replace(/[\u201C\u201D\u2018\u2019]/g, '')
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/\s+/g, ' ')
            .replace(/-+/g, '-')
            .trim()
            .toLowerCase()
    }

    /**
     * Normalise input to word-word-number format.
     * @param {string} sanitised
     * @returns {string}
     */
    _normalise(sanitised) {
        const parts = sanitised.split(/[-\s]+/).filter(s => s.length > 0)
        return parts.join('-')
    }

    /**
     * Extract key from a pasted URL.
     * @param {string} text
     * @returns {string|null}
     */
    _extractKeyFromUrl(text) {
        const trimmed = text.trim()
        if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null

        // Check for fragment: https://send.sgraph.ai/r/abc#apple-mango-56
        const hashIndex = trimmed.indexOf('#')
        if (hashIndex !== -1) {
            return trimmed.substring(hashIndex + 1)
        }

        // Check for key= parameter
        try {
            const url = new URL(trimmed)
            const keyParam = url.searchParams.get('key')
            if (keyParam) return keyParam
        } catch {
            // Not a valid URL
        }

        return null
    }

    /**
     * Check if a normalised key looks valid (word-word-number pattern).
     * @param {string} normalised
     * @returns {boolean}
     */
    _isValidFormat(normalised) {
        const parts = normalised.split('-')
        if (parts.length < 2) return false
        const hasWords = parts.slice(0, -1).some(p => /^[a-z]+$/.test(p))
        return hasWords && parts.length >= 2
    }

    // --- Event Handlers ----------------------------------------------------------

    _onInput() {
        this._submitFailed = false
        const raw = this._input.value
        const sanitised = this._sanitise(raw)
        const normalised = this._normalise(sanitised)
        const isValid = this._isValidFormat(normalised)

        // Update validation styling
        if (this._showValid) {
            this._input.classList.toggle('valid', isValid && normalised.length > 0)
            this._input.classList.remove('invalid')
        }

        // Show auto-complete
        this._updateSuggestions(sanitised)

        // Emit change
        this.emit('key-changed', { key: raw, normalised, isValid })

        // Auto-submit if enabled
        if (this._autoSubmit && isValid) {
            this._onSubmit()
        }
    }

    _onPaste(e) {
        const pasted = (e.clipboardData || window.clipboardData).getData('text')
        const extracted = this._extractKeyFromUrl(pasted)
        if (extracted) {
            e.preventDefault()
            this._input.value = extracted
            this._showFeedback('Key extracted from URL', 'info')
            this._onInput()
        }
    }

    _onKeyDown(e) {
        if (e.key === 'Tab' && this._activeSuggestion !== undefined) {
            e.preventDefault()
            this._acceptSuggestion(this._activeSuggestion)
            return
        }
        if (e.key === 'Enter') {
            e.preventDefault()
            this._onSubmit()
        }
    }

    async _onSubmit() {
        const raw = this._input.value
        const sanitised = this._sanitise(raw)
        const normalised = this._normalise(sanitised)
        const isValid = this._isValidFormat(normalised)

        if (!isValid || normalised.length === 0) {
            this._submitFailed = true
            if (this._showValid) {
                this._input.classList.add('invalid')
            }
            this._showFeedback('Key format not recognised', 'error')
            return
        }

        this._submitBtn.disabled = true
        this._submitBtn.textContent = 'Deriving key...'

        try {
            const { key: derivedKey } = await deriveKey(normalised)
            this.emit('key-submitted', { key: raw, normalised, derivedKey })
        } catch (err) {
            this._showFeedback('Key derivation failed', 'error')
            console.error('[sg-key-input] Derivation error:', err)
        }

        this._submitBtn.disabled = false
        this._submitBtn.textContent = this.getAttribute('button-text') || 'Open File'
    }

    // --- Auto-Complete -----------------------------------------------------------

    async _updateSuggestions(sanitised) {
        const parts = sanitised.split(/[-\s]+/)
        const lastPart = parts[parts.length - 1]

        if (!lastPart || lastPart.length < 2 || /^\d+$/.test(lastPart)) {
            this._hideSuggestions()
            return
        }

        const matches = await searchWords(lastPart, this._locale, 5)
        if (matches.length === 0 || (matches.length === 1 && matches[0] === lastPart)) {
            this._hideSuggestions()
            return
        }

        this._suggestions.innerHTML = matches.map((word, i) =>
            `<button type="button" class="keyinput__suggestion" data-index="${i}" data-word="${word}">${word}</button>`
        ).join('')
        this._suggestions.classList.add('visible')
        this._activeSuggestion = 0

        // Add click handlers
        this._suggestions.querySelectorAll('.keyinput__suggestion').forEach(btn => {
            btn.addEventListener('click', () => {
                this._acceptSuggestion(parseInt(btn.dataset.index, 10))
            })
        })
    }

    _acceptSuggestion(index) {
        const btns = this._suggestions.querySelectorAll('.keyinput__suggestion')
        if (!btns[index]) return

        const word = btns[index].dataset.word
        const raw = this._input.value
        const parts = raw.split(/[-\s]+/)
        parts[parts.length - 1] = word
        this._input.value = parts.join('-') + '-'
        this._hideSuggestions()
        this._input.focus()
        this._onInput()
    }

    _hideSuggestions() {
        this._suggestions.classList.remove('visible')
        this._suggestions.innerHTML = ''
        this._activeSuggestion = undefined
    }

    // --- Feedback ----------------------------------------------------------------

    _showFeedback(msg, type) {
        this._feedback.textContent = msg
        this._feedback.className = `keyinput__feedback ${type}`
        this._feedback.classList.add('visible')
        if (type === 'info') {
            setTimeout(() => { this._feedback.classList.remove('visible') }, 3000)
        }
    }

    // --- Attribute Change ---------------------------------------------------------

    static get observedAttributes() {
        return ['locale', 'placeholder', 'button-text']
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (!this._isReady || oldVal === newVal) return
        if (name === 'placeholder') this._input.setAttribute('placeholder', newVal)
        if (name === 'button-text') this._submitBtn.textContent = newVal
    }
}

customElements.define('sg-key-input', SgKeyInput)

export { SgKeyInput }
