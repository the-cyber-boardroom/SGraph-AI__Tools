/* =============================================================================
   SGraph Header — Shared Header Component
   v1.0.0 — Consistent header across all tools.sgraph.ai pages

   Usage:
     import { SgHeader } from './sg-header.js';
     // <sg-header> is now available as a custom element

   Or in HTML:
     <script type="module" src="/components/header/v1.0.0/sg-header.js"></script>
     <sg-header></sg-header>
   ============================================================================= */

/**
 * Shared header web component for tools.sgraph.ai.
 * Displays SGraph branding and navigation links.
 *
 * @attribute {string} tool-name - Name of the current tool (displayed in header)
 */
export class SgHeader extends HTMLElement {
    connectedCallback() {
        const toolName = this.getAttribute('tool-name') || '';
        this.innerHTML = `
            <style>
                .sg-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0.75rem 1.5rem;
                    background: #0a0a1a;
                    border-bottom: 1px solid #1e293b;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }
                .sg-header__brand {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    text-decoration: none;
                    color: #f0f0f5;
                    font-weight: 700;
                    font-size: 1rem;
                }
                .sg-header__brand:hover { color: #4ecdc4; }
                .sg-header__sep {
                    color: #334155;
                    margin: 0 0.25rem;
                }
                .sg-header__tool-name {
                    color: #94a3b8;
                    font-weight: 400;
                    font-size: 0.9375rem;
                }
                .sg-header__nav {
                    display: flex;
                    gap: 1rem;
                    align-items: center;
                }
                .sg-header__link {
                    color: #94a3b8;
                    text-decoration: none;
                    font-size: 0.8125rem;
                    transition: color 100ms;
                }
                .sg-header__link:hover { color: #4ecdc4; }
                .sg-header__badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 0.25rem;
                    padding: 0.1875rem 0.5rem;
                    background: rgba(78, 205, 196, 0.1);
                    border: 1px solid rgba(78, 205, 196, 0.3);
                    border-radius: 9999px;
                    color: #4ecdc4;
                    font-size: 0.6875rem;
                    font-weight: 600;
                }
            </style>
            <header class="sg-header">
                <div style="display:flex;align-items:center;">
                    <a href="/tools/" class="sg-header__brand">
                        tools.sgraph.ai
                    </a>
                    ${toolName ? `<span class="sg-header__sep">/</span><span class="sg-header__tool-name">${toolName}</span>` : ''}
                </div>
                <nav class="sg-header__nav">
                    <span class="sg-header__badge">Client-side only</span>
                    <a href="/tools/" class="sg-header__link">All Tools</a>
                    <a href="https://send.sgraph.ai" class="sg-header__link">SG/Send</a>
                </nav>
            </header>
        `;
    }
}

customElements.define('sg-header', SgHeader);
