/**
 * ui-dynamic-content — creates vault-embed components programmatically
 * once credentials are available.
 *
 * Components are created with attributes set before DOM insertion so
 * connectedCallback receives correct values immediately.
 *
 * @module ui-dynamic-content
 */

let _seq = 0
function uid() { return `vedcc-${++_seq}` }

/**
 * Create and wire a key + fetch + renderer trio into a container.
 *
 * @param {{ container: HTMLElement, config: object, objectId: string, renderer: string }} opts
 */
function mountContentSlot({ container, config, objectId, renderer }) {
    container.innerHTML = ''

    const keyId   = uid()
    const fetchId = uid()

    const keyEl = document.createElement('sg-vault-key')
    keyEl.setAttribute('id',       keyId)
    keyEl.setAttribute('vault-id', config.vaultId)
    keyEl.setAttribute('read-key', config.readKey)
    keyEl.setAttribute('endpoint', config.endpoint)

    const fetchEl = document.createElement('sg-vault-fetch')
    fetchEl.setAttribute('id',         fetchId)
    fetchEl.setAttribute('key-source', keyId)
    fetchEl.setAttribute('object-id',  objectId)

    const renderEl = document.createElement(`sg-content-${renderer}`)
    renderEl.setAttribute('content-source', fetchId)

    container.appendChild(keyEl)
    container.appendChild(fetchEl)
    container.appendChild(renderEl)
}

/**
 * Mount the manifest element and register the slot-mount bootstrap.
 *
 * @param {{ config: object, manifestUrl: string }} opts
 */
function mountManifest({ config, manifestUrl }) {
    const existing = document.getElementById('page-manifest')
    if (existing) existing.remove()

    const el = document.createElement('sg-vault-manifest')
    el.setAttribute('id',        'page-manifest')
    el.setAttribute('src',       manifestUrl)
    el.setAttribute('vault-id',  config.vaultId)
    el.setAttribute('read-key',  config.readKey)
    document.body.appendChild(el)

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

/**
 * Mount all demo content components using the given config.
 * Sections without an objectId are marked as not configured.
 *
 * @param {{ config: object, objectIds: object, manifestUrl: string|null }} opts
 */
export function mountDynamicContent({ config, objectIds, manifestUrl }) {
    const heroCard  = document.getElementById('content-hero')
    const imageCard = document.getElementById('content-image')
    const jsonCard  = document.getElementById('content-json')

    if (heroCard) {
        if (objectIds.hero) {
            mountContentSlot({ container: heroCard, config, objectId: objectIds.hero, renderer: 'markdown' })
        } else {
            heroCard.innerHTML = '<p class="ved-not-configured">No object ID configured — enter one in the form to load content.</p>'
        }
    }

    if (imageCard) {
        if (objectIds.image) {
            mountContentSlot({ container: imageCard, config, objectId: objectIds.image, renderer: 'image' })
        } else {
            imageCard.innerHTML = '<p class="ved-not-configured">No object ID configured — enter one in the form to load content.</p>'
        }
    }

    if (jsonCard) {
        if (objectIds.json) {
            mountContentSlot({ container: jsonCard, config, objectId: objectIds.json, renderer: 'json' })
        } else {
            jsonCard.innerHTML = '<p class="ved-not-configured">No object ID configured — enter one in the form to load content.</p>'
        }
    }

    const manifestSection = document.getElementById('manifest-section')
    if (manifestSection) {
        if (manifestUrl) {
            manifestSection.hidden = false
            mountManifest({ config, manifestUrl })
        } else {
            manifestSection.hidden = true
        }
    }
}
