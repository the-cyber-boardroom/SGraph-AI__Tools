/**
 * ved-cred-panel — lightweight non-shadow-DOM custom element for the
 * credentials / setup-form container on the left panel.
 *
 * Uses NO shadow DOM so that document.getElementById() can reach the
 * form container, creds list, and switch button from main.js.
 *
 * Dispatches `ved:cred-panel-ready` on document once connected.
 *
 * @module ved-cred-panel
 */

class VedCredPanel extends HTMLElement {
    connectedCallback() {
        if (this._ready) return
        this._ready = true
        this.className = 'ved-cred-panel-host'
        this.innerHTML = `
<div class="ved-cred-panel-inner">
    <div id="setup-form-container"></div>
    <dl class="ved-creds-list" id="creds-display" hidden>
        <dt>Vault ID</dt>   <dd id="cred-vault-id"></dd>
        <dt>Read Key</dt>   <dd id="cred-read-key"></dd>
        <dt>Endpoint</dt>   <dd id="cred-endpoint"></dd>
    </dl>
    <button class="ved-switch-btn" id="switch-vault-btn" hidden>Switch Vault</button>
</div>`
        document.dispatchEvent(new CustomEvent('ved:cred-panel-ready', { bubbles: false }))
    }
}

customElements.define('ved-cred-panel', VedCredPanel)
