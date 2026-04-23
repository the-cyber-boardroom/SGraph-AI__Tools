/* =================================================================================
   SGraph — Site Header Component
   v1.0.5 — SITE_CONFIGS + active-nav attribute + auto-generated nav items

   Changes from v1.0.4:
     - Added SITE_CONFIGS: environment-aware base URLs for SGraph ecosystem
     - When site="Tools" and no nav-items override, auto-generates the standard
       SGraph nav (How it Works / Vaults / Security / Tools / Pricing)
     - New active-nav attribute: highlights the matching nav item
     - Cross-site nav links no longer use target="_blank" (seamless navigation)
     - Locale auto-detected from URL path

   Usage:
     <script type="module" src="/components/site-header/v1/v1.0/v1.0.5/sg-site-header.js"></script>

     <sg-site-header site="Tools" active-nav="Tools" home-url="/en-gb/">
       <div slot="locale" id="locale-picker"></div>
     </sg-site-header>

   Attributes:
     site        — Product name shown after "SG/" (e.g. "Tools", "Send")
     active-nav  — Label of the currently active nav item (adds class="active")
     home-url    — Logo link target (default: "/")
     nav-items   — JSON array override: [{label, href}] — bypasses auto-generation
   ================================================================================= */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js'

// Environment-aware base URLs for the SGraph ecosystem
const SGRAPH_BASE = {
    dev:  'https://dev.sgraph.ai',
    main: 'https://main.sgraph.ai',
    prod: 'https://sgraph.ai',
}

const TOOLS_BASE = {
    dev:  'https://dev.tools.sgraph.ai',
    main: 'https://main.tools.sgraph.ai',
    prod: 'https://tools.sgraph.ai',
}

/** Detect deployment environment from hostname. */
function _detectEnv() {
    const h = window.location.hostname
    if (h.startsWith('dev.'))  return 'dev'
    if (h.startsWith('main.')) return 'main'
    return 'prod'
}

/** Detect locale from URL path, defaulting to en-gb. */
function _detectLocale() {
    const m = window.location.pathname.match(
        /\/(en-gb|en-us|de-de|de-ch|es-es|es-ar|es-mx|fr-fr|fr-ca|hr-hr|it-it|nl-nl|pl-pl|pt-br|pt-pt|ro-ro|tlh)(?=\/|$)/
    )
    return m ? m[1] : 'en-gb'
}

/**
 * Build the standard SGraph nav items for a given context.
 * The "Tools" link is relative (same-site) when on tools.sgraph.ai,
 * absolute otherwise.
 */
function _buildToolsNavItems(env, locale) {
    const sgraphBase = SGRAPH_BASE[env] || SGRAPH_BASE.prod
    const h = window.location.hostname
    const isOnTools = h.includes('tools.sgraph.ai') || h === 'localhost' || h === '127.0.0.1'
    const toolsHref = isOnTools ? `/${locale}/` : `${TOOLS_BASE[env] || TOOLS_BASE.prod}/${locale}/`

    return [
        { label: 'How it Works', href: `${sgraphBase}/${locale}/how-it-works/` },
        { label: 'Vaults',       href: `${sgraphBase}/${locale}/vaults/`       },
        { label: 'Security',     href: `${sgraphBase}/${locale}/security/`     },
        { label: 'Tools',        href: toolsHref                               },
        { label: 'Pricing',      href: `${sgraphBase}/${locale}/pricing/`      },
    ]
}

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
        if (!site) {
            this._siteLabel.previousElementSibling.style.display = 'none'
            this._siteLabel.style.display = 'none'
        }
    }

    _renderNav() {
        const activeNav = this.getAttribute('active-nav') || ''
        let items

        const raw = this.getAttribute('nav-items')
        if (raw) {
            // Explicit nav-items override
            try {
                items = JSON.parse(raw)
            } catch {
                console.warn('[sg-site-header] Invalid nav-items JSON:', raw)
                return
            }
        } else {
            // Auto-generate based on site attribute
            const site = this.getAttribute('site')
            if (site === 'Tools') {
                const env    = _detectEnv()
                const locale = _detectLocale()
                items = _buildToolsNavItems(env, locale)
            }
        }

        if (!items) return

        this._nav.innerHTML = items.map(item => {
            const isActive = activeNav && item.label === activeNav
            const cls  = isActive ? ' class="active"' : ''
            return `<a href="${this._escapeAttr(item.href)}"${cls}>${this._escapeHtml(item.label)}</a>`
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

    // --- Attribute Change --------------------------------------------------------

    static get observedAttributes() {
        return ['site', 'nav-items', 'home-url', 'active-nav']
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (!this._isReady || oldVal === newVal) return
        if (name === 'site')       { this._renderSiteLabel(); this._renderNav() }
        if (name === 'nav-items')  this._renderNav()
        if (name === 'active-nav') this._renderNav()
        if (name === 'home-url')   this._renderHomeUrl()
    }

    // --- Helpers -----------------------------------------------------------------

    _escapeAttr(text) {
        return (text || '').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    }
}

customElements.define('sg-site-header', SgSiteHeader)

export { SgSiteHeader }
