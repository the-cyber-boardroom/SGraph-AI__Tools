/**
 * ui-credentials-panel — hydrates the visible credentials section.
 *
 * AC-D2: credential values must be visible in rendered page text,
 * not just in HTML source.
 *
 * @module ui-credentials-panel
 */

/**
 * @param {{ vaultIdEl: HTMLElement, readKeyEl: HTMLElement, endpointEl: HTMLElement, config: object }} opts
 */
export function mountCredentialsPanel({ vaultIdEl, readKeyEl, endpointEl, config }) {
    if (vaultIdEl)  vaultIdEl.textContent  = config.vaultId
    if (readKeyEl)  readKeyEl.textContent  = config.readKey + ' (this key is public — content is public)'
    if (endpointEl) endpointEl.textContent = config.endpoint
}
