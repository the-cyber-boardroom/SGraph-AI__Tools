/* =================================================================================
   SGraph — Locale Picker Component
   v1.0.0 — Language selector dropdown with flag emojis

   Adapted from sgraph.ai website i18n.js renderLocaleSelector().
   Supports 17 locales with URL-based locale routing.

   Usage:
     <script type="module" src="/components/locale-picker/v1/v1.0/v1.0.0/sg-locale-picker.js"></script>

     <sg-locale-picker
         locale="en-gb"
         base-path="/tools/v0/v0.1/v0.1.0/">
     </sg-locale-picker>

   Attributes:
     locale    — Current locale code (default: detected from URL)
     base-path — Base path prefix before the locale slug (default: "/")
   ================================================================================= */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js'

/**
 * All supported locales with display names and flag emojis.
 * This is the canonical locale list for the SGraph ecosystem.
 */
const SG_LOCALES = [
    { code: 'en-gb', name: 'English (UK)',              flag: '\uD83C\uDDEC\uD83C\uDDE7' },
    { code: 'en-us', name: 'English (US)',              flag: '\uD83C\uDDFA\uD83C\uDDF8' },
    { code: 'de-de', name: 'Deutsch (Deutschland)',     flag: '\uD83C\uDDE9\uD83C\uDDEA' },
    { code: 'de-ch', name: 'Deutsch (Schweiz)',         flag: '\uD83C\uDDE8\uD83C\uDDED' },
    { code: 'es-es', name: 'Espa\u00f1ol (Espa\u00f1a)',          flag: '\uD83C\uDDEA\uD83C\uDDF8' },
    { code: 'es-ar', name: 'Espa\u00f1ol (Argentina)',       flag: '\uD83C\uDDE6\uD83C\uDDF7' },
    { code: 'es-mx', name: 'Espa\u00f1ol (M\u00e9xico)',          flag: '\uD83C\uDDF2\uD83C\uDDFD' },
    { code: 'fr-fr', name: 'Fran\u00e7ais (France)',         flag: '\uD83C\uDDEB\uD83C\uDDF7' },
    { code: 'fr-ca', name: 'Fran\u00e7ais (Canada)',         flag: '\uD83C\uDDE8\uD83C\uDDE6' },
    { code: 'hr-hr', name: 'Hrvatski (Hrvatska)',       flag: '\uD83C\uDDED\uD83C\uDDF7' },
    { code: 'it-it', name: 'Italiano (Italia)',         flag: '\uD83C\uDDEE\uD83C\uDDF9' },
    { code: 'nl-nl', name: 'Nederlands (Nederland)',    flag: '\uD83C\uDDF3\uD83C\uDDF1' },
    { code: 'pl-pl', name: 'Polski (Polska)',           flag: '\uD83C\uDDF5\uD83C\uDDF1' },
    { code: 'pt-br', name: 'Portugu\u00eas (Brasil)',        flag: '\uD83C\uDDE7\uD83C\uDDF7' },
    { code: 'pt-pt', name: 'Portugu\u00eas (Portugal)',      flag: '\uD83C\uDDF5\uD83C\uDDF9' },
    { code: 'ro-ro', name: 'Rom\u00e2n\u0103 (Rom\u00e2nia)',           flag: '\uD83C\uDDF7\uD83C\uDDF4' },
    { code: 'tlh',   name: 'tlhIngan Hol',             flag: '\uD83D\uDD96' }
]

class SgLocalePicker extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-locale-picker' }

    get sharedCssPaths() {
        return ['../../tokens/v1/v1.0/v1.0.0/sg-tokens.css']
    }

    onReady() {
        this._locale = this.getAttribute('locale') || this._detectLocale()
        this._renderTrigger()
        this._renderMenu()
        this._renderEnglishSwitch()
    }

    bindElements() {
        this._trigger       = this.$('#trigger')
        this._triggerLabel  = this.$('#trigger-label')
        this._menu          = this.$('#menu')
        this._dropdown      = this.$('#dropdown')
        this._englishSwitch = this.$('#english-switch')
    }

    setupEventListeners() {
        this.addTrackedListener(this._trigger, 'click', this._onToggle)
        this.addTrackedListener(document, 'click', this._onOutsideClick)
    }

    // --- Rendering ---------------------------------------------------------------

    _renderTrigger() {
        const current = SG_LOCALES.find(l => l.code === this._locale) || SG_LOCALES[0]
        this._triggerLabel.textContent = current.flag + ' ' + current.code.toUpperCase()
    }

    _renderMenu() {
        this._menu.innerHTML = SG_LOCALES.map(loc => {
            const active = loc.code === this._locale ? ' locale-picker__item--active' : ''
            return `<button class="locale-picker__item${active}" type="button" data-locale="${loc.code}">${loc.flag}  ${loc.name}</button>`
        }).join('')

        this._menu.querySelectorAll('.locale-picker__item').forEach(btn => {
            btn.addEventListener('click', () => {
                const code = btn.getAttribute('data-locale')
                this._dropdown.classList.remove('open')
                if (code !== this._locale) {
                    this._navigateToLocale(code)
                }
            })
        })
    }

    _renderEnglishSwitch() {
        if (this._locale && !this._locale.startsWith('en')) {
            this._englishSwitch.hidden = false
            this._englishSwitch.textContent = '\uD83C\uDDEC\uD83C\uDDE7 English'
            this._englishSwitch.href = this._buildLocaleUrl('en-gb')
        }
    }

    // --- Navigation ──────────────────────────────────────────────────────────────

    _navigateToLocale(code) {
        this.emit('locale-change', { locale: code })
        window.location.href = this._buildLocaleUrl(code)
    }

    _buildLocaleUrl(code) {
        const basePath = this.getAttribute('base-path') || '/'
        const currentPath = window.location.pathname

        // Strip current locale from path to get the page suffix
        const localePattern = new RegExp(
            '/' + SG_LOCALES.map(l => l.code).join('|') + '(?=/|$)'
        )
        const pageSuffix = currentPath.replace(localePattern, '') || '/'

        // Build new URL: basePath + locale + pageSuffix
        const base = basePath.endsWith('/') ? basePath : basePath + '/'
        return base + code + pageSuffix
    }

    // --- Locale Detection ────────────────────────────────────────────────────────

    _detectLocale() {
        const path = window.location.pathname
        const codes = SG_LOCALES.map(l => l.code)
        const pattern = new RegExp('/(' + codes.join('|') + ')(?=/|$)')
        const match = path.match(pattern)
        return match ? match[1] : 'en-gb'
    }

    // --- Toggle ──────────────────────────────────────────────────────────────────

    _onToggle(e) {
        e.stopPropagation()
        this._dropdown.classList.toggle('open')
    }

    _onOutsideClick() {
        this._dropdown.classList.remove('open')
    }

    // --- Attribute Change ─────────────────────────────────────────────────────────

    static get observedAttributes() {
        return ['locale']
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (!this._isReady || oldVal === newVal) return
        if (name === 'locale') {
            this._locale = newVal
            this._renderTrigger()
            this._renderMenu()
            this._renderEnglishSwitch()
        }
    }
}

customElements.define('sg-locale-picker', SgLocalePicker)

export { SgLocalePicker, SG_LOCALES }
