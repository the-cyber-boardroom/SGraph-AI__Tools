/**
 * vault-embed-demo — entry point.
 *
 * Shows a credential setup form on load. Once the user provides a vault key
 * (or vault-id + read-key directly), derives all credentials, hydrates the
 * credentials panel, and mounts all content components dynamically.
 */

import { mountSetupForm }        from './ui-setup-form.js'
import { mountCredentialsPanel } from './ui-credentials-panel.js'
import { mountTracePanel }       from './ui-trace-panel.js'
import { mountDynamicContent }   from './ui-dynamic-content.js'

/**
 * Called once the user has provided credentials.
 * @param {{ vaultId, readKey, endpoint, objectIds, manifestUrl }} config
 */
function init(config) {
    mountCredentialsPanel({
        vaultIdEl:  document.getElementById('cred-vault-id'),
        readKeyEl:  document.getElementById('cred-read-key'),
        endpointEl: document.getElementById('cred-endpoint'),
        config,
    })

    mountDynamicContent({
        config,
        objectIds:   config.objectIds,
        manifestUrl: config.manifestUrl,
    })
}

// Show the credential form in the credentials panel container
mountSetupForm({
    container: document.getElementById('setup-form-container'),
    onConfig:  init,
})

// Mount trace panel (works immediately — just listens for events)
mountTracePanel({ traceEl: document.getElementById('main-trace') })

// Register SgToolApi (non-blocking)
import('../api/vault-embed-demo-api.js')
