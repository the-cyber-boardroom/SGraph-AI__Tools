/**
 * ui-shell — manifest slot-mount bootstrap.
 *
 * Listens for sg-vault-manifest:slot-ready events and replaces
 * [data-vault-slot="{slotName}"] placeholders with <sg-vault-content>.
 *
 * @module ui-shell
 */

/**
 * @param {{ config: object }} opts
 */
export function mountShell({ config }) {
    const manifest = document.getElementById('page-manifest')
    if (!manifest) return

    // Update the manifest element's attributes from config
    manifest.setAttribute('vault-id', config.vaultId)
    manifest.setAttribute('read-key', config.readKey)
    manifest.setAttribute('src', config.manifestUrl)

    // Update individual sg-vault-key elements with config values
    document.querySelectorAll('sg-vault-key').forEach(el => {
        if (el.getAttribute('vault-id') === 'DEMO_VAULT_ID') {
            el.setAttribute('vault-id', config.vaultId)
        }
        if (el.getAttribute('read-key') === 'DEMO_READ_KEY') {
            el.setAttribute('read-key', config.readKey)
        }
    })

    // Update sg-vault-fetch elements with real object IDs
    const fetchHero = document.getElementById('fetch-hero')
    if (fetchHero && config.objectIds.hero !== 'DEMO_OBJECT_HERO') {
        fetchHero.setAttribute('object-id', config.objectIds.hero)
    }
    const fetchImage = document.getElementById('fetch-image')
    if (fetchImage && config.objectIds.image !== 'DEMO_OBJECT_IMAGE') {
        fetchImage.setAttribute('object-id', config.objectIds.image)
    }
    const fetchJson = document.getElementById('fetch-json')
    if (fetchJson && config.objectIds.json !== 'DEMO_OBJECT_JSON') {
        fetchJson.setAttribute('object-id', config.objectIds.json)
    }

    // Slot-mount bootstrap: listen for slot-ready, swap placeholders
    document.addEventListener('sg-vault-manifest:slot-ready', (e) => {
        const { slotName, objectId, render, vaultId, readKey } = e.detail
        const slot = document.querySelector(`[data-vault-slot="${slotName}"]`)
        if (!slot) return

        const contentEl = document.createElement('sg-vault-content')
        contentEl.setAttribute('vault-id',  vaultId)
        contentEl.setAttribute('read-key',  readKey)
        contentEl.setAttribute('object-id', objectId)
        contentEl.setAttribute('render',    render)
        slot.replaceWith(contentEl)
    })
}
