/* =================================================================================
   SGraph — Site Header Component
   v1.0.3 — Plain text logo matching SG/Send header (no inline SVG favicon)

   Changes from v1.0.2:
     - Removed inline SVG favicon from logo area
     - Logo is now plain text only: SG/Product — matching the SG/Send header
       at sgraph.ai (dev.sgraph.ai/en-gb/index.html)

   Usage:
     <script type="module" src="/components/site-header/v1/v1.0/v1.0.3/sg-site-header.js"></script>

     <sg-site-header
         site="Tools"
         home-url="/en-gb/"
         nav-items='[{"label":"All Tools","href":"/en-gb/"},{"label":"SG/Send","href":"https://send.sgraph.ai"}]'>
         <sg-locale-picker slot="locale" locale="en-gb"></sg-locale-picker>
     </sg-site-header>

   Attributes:
     site       — Product name shown after "SG/" (e.g. "Send", "Tools", "Vault")
     home-url   — Logo link target (default: "/")
     nav-items  — JSON array of {label, href} objects for navigation links

   Slots:
     locale     — Accepts a locale picker component (e.g. <sg-locale-picker>)
   ================================================================================= */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js'

class SgSiteHeader extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-site-header' }

    get sharedCssPaths() {
        return ['/components/tokens/v1/v1.0/v1.0.0/sg-tokens.css']
    }

    onReady() {
        this._renderSiteLabel()
        this._renderNav()
        this._renderHomeUrl()
    }

    bindElements() {
        this._siteLabel = this.$('#site-label')
        this._nav       = this.$('#nav')
        this._toggle    = this.$('#nav-toggle')
        this._logo      = this.$('.site-header__logo')
    }

    setupEventListeners() {
        this.addTrackedListener(this._toggle, 'click', this._onToggle)
    }

    // --- Rendering ---------------------------------------------------------------

    _renderSiteLabel() {
        const site = this.getAttribute('site') || ''
        this._siteLabel.textContent = site
        // Hide the slash + product if no site name
        if (!site) {
            this._siteLabel.previousElementSibling.style.display = 'none'
            this._siteLabel.style.display = 'none'
        }
    }

    _renderNav() {
        const raw = this.getAttribute('nav-items')
        if (!raw) return

        let items
        try {
            items = JSON.parse(raw)
        } catch {
            console.warn('[sg-site-header] Invalid nav-items JSON:', raw)
            return
        }

        this._nav.innerHTML = items.map(item => {
            const external = item.href && item.href.startsWith('http')
            const attrs = external ? ' target="_blank" rel="noopener"' : ''
            return `<a href="${this._escapeAttr(item.href)}"${attrs}>${this._escapeHtml(item.label)}</a>`
        }).join('')
    }

    _renderHomeUrl() {
        const url = this.getAttribute('home-url') || '/'
        this._logo.href = url
    }

    // --- Mobile Toggle -----------------------------------------------------------

    _onToggle() {
        const nav = this._nav
        const isOpen = nav.classList.toggle('is-open')
        this._toggle.setAttribute('aria-expanded', isOpen)
    }

    // --- Attribute Change ---------------------------------------------------------

    static get observedAttributes() {
        return ['site', 'nav-items', 'home-url']
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (!this._isReady || oldVal === newVal) return
        if (name === 'site')      this._renderSiteLabel()
        if (name === 'nav-items') this._renderNav()
        if (name === 'home-url')  this._renderHomeUrl()
    }

    // --- Helpers -----------------------------------------------------------------

    _escapeAttr(text) {
        return (text || '').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    }
}

customElements.define('sg-site-header', SgSiteHeader)

export { SgSiteHeader }
