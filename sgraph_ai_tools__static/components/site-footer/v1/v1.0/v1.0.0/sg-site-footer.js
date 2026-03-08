/* =================================================================================
   SGraph — Site Footer Component
   v1.0.0 — Shared footer across all sgraph.ai domains

   Usage:
     <script type="module" src="/components/site-footer/v1/v1.0/v1.0.0/sg-site-footer.js"></script>

     <sg-site-footer
         brand-desc="Free browser-based tools. No uploads, no servers."
         columns='[{"title":"Product","links":[{"label":"send.sgraph.ai","href":"https://send.sgraph.ai"}]},{"title":"Open Source","links":[{"label":"GitHub","href":"https://github.com/the-cyber-boardroom/SGraph-AI__App__Send"}]}]'>
     </sg-site-footer>

   Attributes:
     brand-desc  — Description text under the SG/ logo
     columns     — JSON array of {title, links: [{label, href}]} for footer columns
     copyright   — Copyright text (default: auto-generated)
     sherpa-text — Text for the sherpa CTA button
     sherpa-href — Href for the sherpa CTA button
   ================================================================================= */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js'

class SgSiteFooter extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-site-footer' }

    get sharedCssPaths() {
        return ['../../tokens/v1/v1.0/v1.0.0/sg-tokens.css']
    }

    onReady() {
        this._renderBrandDesc()
        this._renderColumns()
        this._renderCopyright()
        this._renderSherpa()
    }

    bindElements() {
        this._brandDesc     = this.$('#brand-desc')
        this._columnsEl     = this.$('#footer-columns')
        this._copyrightEl   = this.$('#copyright')
        this._sherpaLink    = this.$('#sherpa-link')
    }

    // --- Rendering ---------------------------------------------------------------

    _renderBrandDesc() {
        const desc = this.getAttribute('brand-desc')
        if (desc) this._brandDesc.textContent = desc
    }

    _renderColumns() {
        const raw = this.getAttribute('columns')
        if (!raw) return

        let columns
        try {
            columns = JSON.parse(raw)
        } catch {
            console.warn('[sg-site-footer] Invalid columns JSON:', raw)
            return
        }

        this._columnsEl.innerHTML = columns.map(col => {
            const links = (col.links || []).map(link => {
                const external = link.href && link.href.startsWith('http')
                const attrs = external ? ' target="_blank" rel="noopener"' : ''
                return `<li><a href="${this._escapeAttr(link.href)}"${attrs}>${this._escapeHtml(link.label)}</a></li>`
            }).join('')

            return `
                <div class="site-footer__col">
                    <h4>${this._escapeHtml(col.title)}</h4>
                    <ul>${links}</ul>
                </div>
            `
        }).join('')
    }

    _renderCopyright() {
        const text = this.getAttribute('copyright')
        if (text) this._copyrightEl.innerHTML = text
    }

    _renderSherpa() {
        const text = this.getAttribute('sherpa-text')
        const href = this.getAttribute('sherpa-href')
        if (text) this._sherpaLink.textContent = text
        if (href) this._sherpaLink.href = href
    }

    // --- Helpers -----------------------------------------------------------------

    _escapeAttr(text) {
        return (text || '').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    }
}

customElements.define('sg-site-footer', SgSiteFooter)

export { SgSiteFooter }
