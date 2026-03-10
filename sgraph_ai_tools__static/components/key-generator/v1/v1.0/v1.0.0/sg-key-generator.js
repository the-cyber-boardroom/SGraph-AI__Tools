/* =================================================================================
   SGraph — Key Generator Component
   v1.0.0 — Friendly encryption key creator with entropy visualisation

   Usage:
     <script type="module" src="/components/key-generator/v1/v1.0/v1.0.0/sg-key-generator.js"></script>

     <sg-key-generator
         locale="en-gb"
         word-count="2"
         suffix-length="2"
         show-geek-mode>
     </sg-key-generator>

   Attributes:
     locale           — Language for word list (default: "en-gb")
     word-count       — Number of words (default: 2)
     suffix-length    — Digits in numeric suffix (default: 2)
     min-entropy      — Minimum bits for "good" rating (default: 30)
     show-geek-mode   — Start with geek mode expanded (boolean)
     allow-custom-words — Allow free-text word entry (default: true)

   Events:
     key-generated — { key, entropy, derivedKey, derivationTimeMs }
     key-changed   — { key, entropy }
     key-copied    — { key }
     key-used      — { key, derivedKey }
   ================================================================================= */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js'
import { getWordList, getRandomWords } from '/core/wordlist/v1/v1.0/v1.0.0/sg-wordlist.js'
import { deriveKeyFromWords, calculateEntropy } from '/core/pbkdf2/v1/v1.0/v1.0.0/sg-pbkdf2.js'
import { exportKey } from '/core/crypto/v1/v1.0/v1.0.0/sg-crypto.js'

class SgKeyGenerator extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-key-generator' }

    get sharedCssPaths() {
        return ['/components/tokens/v1/v1.0/v1.0.0/sg-tokens.css']
    }

    async onReady() {
        this._wordCount    = parseInt(this.getAttribute('word-count') || '2', 10)
        this._suffixLength = parseInt(this.getAttribute('suffix-length') || '2', 10)
        this._locale       = this.getAttribute('locale') || 'en-gb'
        this._minEntropy   = parseInt(this.getAttribute('min-entropy') || '30', 10)
        this._allowCustom  = this.getAttribute('allow-custom-words') !== 'false'
        this._showGeek     = this.hasAttribute('show-geek-mode')

        this._wordList = await getWordList(this._locale)
        await this._generateNewKey()

        if (this._showGeek) {
            this._geekSection.classList.add('expanded')
            this._geekToggle.setAttribute('aria-expanded', 'true')
        }
    }

    bindElements() {
        this._wordInputs    = this.$$('.keygen__word-input')
        this._wordSelects   = this.$$('.keygen__word-select')
        this._shuffleBtns   = this.$$('.keygen__shuffle-btn')
        this._suffixInput   = this.$('#suffix-input')
        this._keyPreview    = this.$('#key-preview')
        this._entropyBar    = this.$('#entropy-bar')
        this._entropyFill   = this.$('#entropy-fill')
        this._entropyLabel  = this.$('#entropy-label')
        this._entropyCount  = this.$('#entropy-count')
        this._geekSection   = this.$('#geek-section')
        this._geekToggle    = this.$('#geek-toggle')
        this._geekKey       = this.$('#geek-key')
        this._geekKdf       = this.$('#geek-kdf')
        this._geekTime      = this.$('#geek-time')
        this._geekSalt      = this.$('#geek-salt')
        this._copyBtn       = this.$('#copy-btn')
        this._regenBtn      = this.$('#regen-btn')
        this._useBtn        = this.$('#use-btn')
        this._wordSlotsDiv  = this.$('#word-slots')
    }

    setupEventListeners() {
        this.addTrackedListener(this._suffixInput, 'input', this._onKeyChange)
        this.addTrackedListener(this._geekToggle, 'click', this._toggleGeekMode)
        this.addTrackedListener(this._copyBtn, 'click', this._onCopy)
        this.addTrackedListener(this._regenBtn, 'click', this._onRegenerate)
        this.addTrackedListener(this._useBtn, 'click', this._onUse)

        this._wordInputs.forEach((input, i) => {
            this.addTrackedListener(input, 'input', () => this._onWordInput(i))
        })
        this._wordSelects.forEach((select, i) => {
            this.addTrackedListener(select, 'change', () => this._onWordSelect(i))
        })
        this._shuffleBtns.forEach((btn, i) => {
            this.addTrackedListener(btn, 'click', () => this._shuffleWord(i))
        })
    }

    // --- Key Generation ----------------------------------------------------------

    async _generateNewKey() {
        const words = await getRandomWords(this._wordCount, this._locale)
        const suffix = this._generateSuffix()

        this._currentWords = words
        this._currentSuffix = suffix
        this._renderWordSlots()
        this._suffixInput.value = suffix

        await this._deriveAndDisplay()
        const key = this._assembleKey()
        const entropy = this._currentEntropy
        this.emit('key-generated', {
            key,
            entropy,
            derivedKey: this._currentDerivedKey,
            derivationTimeMs: this._currentDerivationTime
        })
    }

    _generateSuffix() {
        const array = new Uint8Array(this._suffixLength)
        crypto.getRandomValues(array)
        return Array.from(array).map(b => b % 10).join('')
    }

    _assembleKey() {
        const words = this._currentWords.map(w => w.toLowerCase())
        return [...words, this._currentSuffix].join('-')
    }

    // --- Rendering ---------------------------------------------------------------

    _renderWordSlots() {
        this._wordSlotsDiv.innerHTML = ''
        for (let i = 0; i < this._currentWords.length; i++) {
            const slot = document.createElement('div')
            slot.className = 'keygen__word-slot'
            slot.innerHTML = `
                <label class="keygen__word-label">Word ${i + 1}</label>
                <div class="keygen__word-row">
                    <select class="keygen__word-select" data-index="${i}">
                        ${this._wordList.map(w =>
                            `<option value="${w}" ${w === this._currentWords[i] ? 'selected' : ''}>${w}</option>`
                        ).join('')}
                    </select>
                    ${this._allowCustom ? `<input type="text" class="keygen__word-input" data-index="${i}" placeholder="or type your own" value="">` : ''}
                    <button type="button" class="keygen__shuffle-btn" data-index="${i}" title="Random word">&#x21bb;</button>
                </div>
            `
            this._wordSlotsDiv.appendChild(slot)
        }

        // Re-bind new elements
        this._wordInputs  = this.$$('.keygen__word-input')
        this._wordSelects = this.$$('.keygen__word-select')
        this._shuffleBtns = this.$$('.keygen__shuffle-btn')

        this._wordInputs.forEach((input, i) => {
            this.addTrackedListener(input, 'input', () => this._onWordInput(i))
        })
        this._wordSelects.forEach((select, i) => {
            this.addTrackedListener(select, 'change', () => this._onWordSelect(i))
        })
        this._shuffleBtns.forEach((btn, i) => {
            this.addTrackedListener(btn, 'click', () => this._shuffleWord(i))
        })

        this._updateKeyPreview()
    }

    _updateKeyPreview() {
        this._keyPreview.textContent = this._assembleKey()
    }

    async _deriveAndDisplay() {
        const key = this._assembleKey()
        this._updateKeyPreview()

        // Calculate entropy
        const entropy = calculateEntropy(key, this._wordList.length)
        this._currentEntropy = entropy
        this._updateEntropyBar(entropy)

        // Derive key
        try {
            const { key: derivedKey, derivationTimeMs } = await deriveKeyFromWords(
                this._currentWords, this._currentSuffix
            )
            this._currentDerivedKey = derivedKey
            this._currentDerivationTime = derivationTimeMs
            await this._updateGeekMode(derivedKey, derivationTimeMs)
        } catch (err) {
            console.error('[sg-key-generator] Key derivation failed:', err)
        }
    }

    _updateEntropyBar(entropy) {
        const maxBits = 50
        const pct = Math.min(100, (entropy.bits / maxBits) * 100)
        this._entropyFill.style.width = `${pct}%`

        const colors = { weak: '#e94560', fair: '#f4a261', good: '#4ecdc4', strong: '#06d6a0' }
        this._entropyFill.style.background = colors[entropy.rating] || colors.fair

        this._entropyLabel.textContent = entropy.rating.charAt(0).toUpperCase() + entropy.rating.slice(1)
        this._entropyLabel.style.color = colors[entropy.rating]
        this._entropyCount.textContent = `~${this._formatCombinations(entropy.combinations)} combinations`
    }

    _formatCombinations(n) {
        if (n >= 1e12) return `${(n / 1e12).toFixed(1)} trillion`
        if (n >= 1e9)  return `${(n / 1e9).toFixed(1)} billion`
        if (n >= 1e6)  return `${(n / 1e6).toFixed(1)} million`
        if (n >= 1e3)  return `${(n / 1e3).toFixed(1)} thousand`
        return Math.round(n).toString()
    }

    async _updateGeekMode(derivedKey, derivationTimeMs) {
        try {
            const raw = await crypto.subtle.exportKey('raw', derivedKey)
            const hex = Array.from(new Uint8Array(raw)).map(b => b.toString(16).padStart(2, '0')).join('')
            this._geekKey.textContent = hex
        } catch {
            this._geekKey.textContent = '(unable to export)'
        }
        this._geekKdf.textContent = 'PBKDF2 (600,000 iterations, SHA-256)'
        this._geekTime.textContent = `${Math.round(derivationTimeMs)}ms`
        this._geekSalt.textContent = 'sgraph-send-v1 (fixed)'
    }

    // --- Event Handlers ----------------------------------------------------------

    _onWordInput(index) {
        const input = this._wordInputs[index]
        const value = input.value.trim().toLowerCase()
        if (value) {
            this._currentWords[index] = value
            this._onKeyChange()
        }
    }

    _onWordSelect(index) {
        const select = this._wordSelects[index]
        this._currentWords[index] = select.value
        if (this._wordInputs[index]) {
            this._wordInputs[index].value = ''
        }
        this._onKeyChange()
    }

    async _shuffleWord(index) {
        const [word] = await getRandomWords(1, this._locale)
        this._currentWords[index] = word
        this._wordSelects[index].value = word
        if (this._wordInputs[index]) {
            this._wordInputs[index].value = ''
        }
        this._onKeyChange()
    }

    async _onKeyChange() {
        this._currentSuffix = this._suffixInput.value.trim() || this._currentSuffix
        const key = this._assembleKey()
        const entropy = calculateEntropy(key, this._wordList.length)
        this._currentEntropy = entropy
        this._updateKeyPreview()
        this._updateEntropyBar(entropy)
        this.emit('key-changed', { key, entropy })
        await this._deriveAndDisplay()
    }

    _toggleGeekMode() {
        const expanded = this._geekSection.classList.toggle('expanded')
        this._geekToggle.setAttribute('aria-expanded', expanded)
    }

    async _onCopy() {
        const key = this._assembleKey()
        await navigator.clipboard.writeText(key)
        const orig = this._copyBtn.textContent
        this._copyBtn.textContent = 'Copied!'
        setTimeout(() => { this._copyBtn.textContent = orig }, 1500)
        this.emit('key-copied', { key })
    }

    async _onRegenerate() {
        await this._generateNewKey()
    }

    _onUse() {
        this.emit('key-used', {
            key: this._assembleKey(),
            derivedKey: this._currentDerivedKey
        })
    }
}

customElements.define('sg-key-generator', SgKeyGenerator)

export { SgKeyGenerator }
