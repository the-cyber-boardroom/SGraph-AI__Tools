/* =================================================================================
   SGraph — Shared Navigation Module
   v0.1.4 — Nav items now match sgraph.ai (SG/Send) header exactly for seamless
             cross-site navigation. Links auto-resolve to the correct environment
             (dev ↔ dev.sgraph.ai, main ↔ main.sgraph.ai, prod ↔ sgraph.ai).

   Nav items (matching sgraph.ai):
     How it Works  → sgraph.ai/en-gb/how-it-works/
     Vaults        → sgraph.ai/en-gb/vaults/
     Security      → sgraph.ai/en-gb/security/
     Tools         → tools.sgraph.ai/en-gb/  (current site — active)
     Pricing       → sgraph.ai/en-gb/pricing/

   Usage:
     import { buildToolsNav } from '/_common/js/sg-nav.js'
     buildToolsNav(document.querySelector('sg-site-header'))
   ================================================================================= */

/**
 * Returns the sgraph.ai base URL matching the current environment.
 * dev.tools.sgraph.ai  → dev.sgraph.ai
 * main.tools.sgraph.ai → main.sgraph.ai
 * tools.sgraph.ai      → sgraph.ai
 * localhost            → sgraph.ai (production fallback)
 *
 * @returns {string}
 */
function getSgraphBaseUrl() {
    const host = window.location.hostname
    if (host.startsWith('dev.'))  return 'https://dev.sgraph.ai'
    if (host.startsWith('main.')) return 'https://main.sgraph.ai'
    return 'https://sgraph.ai'
}

/**
 * Detect the current locale from the URL path.
 *
 * @returns {string} The detected locale code, or 'en-gb' as default
 */
function detectLocale() {
    const path = window.location.pathname
    const pattern = /\/(en-gb|en-us|de-de|de-ch|es-es|es-ar|es-mx|fr-fr|fr-ca|hr-hr|it-it|nl-nl|pl-pl|pt-br|pt-pt|ro-ro|tlh)(?=\/|$)/
    const match = path.match(pattern)
    return match ? match[1] : 'en-gb'
}

/**
 * Build and apply navigation items to an <sg-site-header> element.
 * Matches the sgraph.ai nav exactly for a seamless cross-site experience.
 *
 * @param {HTMLElement} headerEl - The <sg-site-header> element
 * @param {Object} [options]
 * @param {string} [options.toolsHref] - Override href for the Tools link (default: auto-detected)
 */
function buildToolsNav(headerEl, options = {}) {
    if (!headerEl) return

    const base      = getSgraphBaseUrl()
    const locale    = detectLocale()
    const toolsHref = options.toolsHref || `/${locale}/`

    const navItems = [
        { label: 'How it Works', href: `${base}/${locale}/how-it-works/` },
        { label: 'Vaults',       href: `${base}/${locale}/vaults/`       },
        { label: 'Security',     href: `${base}/${locale}/security/`     },
        { label: 'Tools',        href: toolsHref                         },
        { label: 'Pricing',      href: `${base}/${locale}/pricing/`      },
    ]

    headerEl.setAttribute('nav-items', JSON.stringify(navItems))
}

export { buildToolsNav, getSgraphBaseUrl, detectLocale }
