/* =============================================================================
   SGraph Footer — Shared Footer Component
   v1.0.0 — Consistent footer across all tools.sgraph.ai pages

   Usage:
     import { SgFooter } from './sg-footer.js';
     // <sg-footer> is now available as a custom element

   Or in HTML:
     <script type="module" src="/components/footer/v1.0.0/sg-footer.js"></script>
     <sg-footer></sg-footer>
   ============================================================================= */

/**
 * Shared footer web component for tools.sgraph.ai.
 * Displays privacy message and SG/Send link.
 */
export class SgFooter extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
            <style>
                .sg-footer {
                    padding: 1.5rem;
                    background: #0a0a1a;
                    border-top: 1px solid #1e293b;
                    text-align: center;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }
                .sg-footer__privacy {
                    color: #4ecdc4;
                    font-size: 0.8125rem;
                    font-weight: 600;
                    margin: 0 0 0.5rem;
                }
                .sg-footer__sub {
                    color: #64748b;
                    font-size: 0.75rem;
                    margin: 0;
                }
                .sg-footer__link {
                    color: #94a3b8;
                    text-decoration: none;
                }
                .sg-footer__link:hover {
                    color: #4ecdc4;
                    text-decoration: underline;
                }
            </style>
            <footer class="sg-footer">
                <p class="sg-footer__privacy">
                    All processing happens in your browser. No data is sent to any server.
                </p>
                <p class="sg-footer__sub">
                    Need to share files securely?
                    <a href="https://send.sgraph.ai" class="sg-footer__link">Try SG/Send &rarr;</a>
                </p>
            </footer>
        `;
    }
}

customElements.define('sg-footer', SgFooter);
