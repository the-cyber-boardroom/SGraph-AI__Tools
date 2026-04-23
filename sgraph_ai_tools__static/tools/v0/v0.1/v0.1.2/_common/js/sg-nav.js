/* =================================================================================
   SGraph — Shared Navigation Module
   v0.1.2 — Environment-aware cross-site nav for tools.sgraph.ai

   Builds the nav-items JSON for <sg-site-header> with links that automatically
   point to the correct sgraph.ai environment (dev ↔ dev, main ↔ main, prod ↔ prod).

   Usage:
     import { buildToolsNav } from '/_common/js/sg-nav.js'
     buildToolsNav(document.querySelector('sg-site-header'))

   Or with custom options:
     buildToolsNav(header, { toolsLabel: 'All Tools', toolsHref: '/en-gb/' })
   ================================================================================= */

/**
 * Returns the sgraph.ai base URL matching the current environment.
 * dev.tools.sgraph.ai → dev.sgraph.ai
 * main.tools.sgraph.ai → main.sgraph.ai
 * tools.sgraph.ai → sgraph.ai
 * localhost → sgraph.ai (production fallback)
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
 * Matches any supported locale slug in the path (e.g. /en-gb/, /de-de/).
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
 * Cross-site links (Product, Pricing, etc.) point to the correct sgraph.ai environment.
 * The "All Tools" link points to the tools landing page on the current domain.
 *
 * @param {HTMLElement} headerEl - The <sg-site-header> element
 * @param {Object} [options]
 * @param {string} [options.toolsLabel='All Tools'] - Label for the in-site tools link
 * @param {string} [options.toolsHref] - Override href for the tools link (default: auto-detected)
 */
function buildToolsNav(headerEl, options = {}) {
    if (!headerEl) return

    const base   = getSgraphBaseUrl()
    const locale = detectLocale()
    const toolsLabel = options.toolsLabel || 'All Tools'
    const toolsHref  = options.toolsHref || `/${locale}/`

    const navItems = [
        { label: 'Product',      href: `${base}/${locale}/product/` },
        { label: 'Pricing',      href: `${base}/${locale}/pricing/` },
        { label: 'Architecture', href: `${base}/${locale}/architecture/` },
        { label: 'Team',         href: `${base}/${locale}/agents/` },
        { label: toolsLabel,     href: toolsHref }
    ]

    headerEl.setAttribute('nav-items', JSON.stringify(navItems))
}

export { buildToolsNav, getSgraphBaseUrl, detectLocale }
