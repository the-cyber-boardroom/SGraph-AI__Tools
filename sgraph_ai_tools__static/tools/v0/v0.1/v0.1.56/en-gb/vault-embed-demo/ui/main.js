/**
 * vault-embed-demo — entry point.
 *
 * Configures the demo with vault credentials, wires the manifest
 * slot-mount bootstrap, and registers the SgToolApi.
 */

import { mountCredentialsPanel } from './ui-credentials-panel.js'
import { mountTracePanel }       from './ui-trace-panel.js'
import { mountShell }            from './ui-shell.js'

// Demo vault credentials (OQ-3: credentials are placeholders — real credentials
// are injected by the demo vault setup script, or remain as-is for the
// structural demo without a live vault).
//
// NOTE: This is intentionally public. The vault key is a read_key only.
// The content is intentionally public. No write_key is present anywhere.
export const DEMO_CONFIG = {
    vaultId:   'DEMO_VAULT_ID',
    readKey:   'DEMO_READ_KEY',
    endpoint:  'https://send.sgraph.ai',
    objectIds: {
        hero:   'DEMO_OBJECT_HERO',
        image:  'DEMO_OBJECT_IMAGE',
        json:   'DEMO_OBJECT_JSON',
    },
    manifestUrl: 'DEMO_MANIFEST_URL',
}

// Hydrate the page's placeholder credential values
mountCredentialsPanel({
    vaultIdEl:  document.getElementById('cred-vault-id'),
    readKeyEl:  document.getElementById('cred-read-key'),
    endpointEl: document.getElementById('cred-endpoint'),
    config:     DEMO_CONFIG,
})

// Wire the manifest slot bootstrap
mountShell({ config: DEMO_CONFIG })

// Mount trace panel controls
mountTracePanel({
    traceEl: document.getElementById('main-trace'),
})

// Register SgToolApi
import('../api/vault-embed-demo-api.js')
