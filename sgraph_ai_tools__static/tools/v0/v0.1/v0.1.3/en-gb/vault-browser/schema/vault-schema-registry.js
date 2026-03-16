/**
 * Schema registry — maps schema identifiers to viewer components.
 *
 * Each viewer is a custom element that implements:
 *   render(data, fileId)  — display the parsed JSON object
 *
 * All viewers emit:
 *   vault-object-navigate  — { detail: { fileId } }  when a ref link is clicked
 */

const _viewers = new Map()

/**
 * Register a schema viewer.
 * @param {string} schemaId   — value of the "schema" field (e.g. "commit_v1")
 * @param {string} tagName    — custom element tag (e.g. "vault-schema-commit")
 */
export function registerSchemaViewer(schemaId, tagName) {
    _viewers.set(schemaId, tagName)
}

/**
 * Detect the schema of a parsed JSON object.
 * Returns the schema identifier string or null.
 */
export function detectSchema(data) {
    if (!data || typeof data !== 'object') return null
    if (data.schema) return data.schema
    // Heuristic detection for objects without an explicit schema field
    if (data.tree_id && data.message !== undefined && (data.parents || data.parent))  return 'commit_v1'
    if (data.entries && Array.isArray(data.entries) && data.entries[0]?.blob_id !== undefined) return 'tree_v1'
    if (data.commit_id && data.version !== undefined) return 'ref_v1'
    if (data.label && data.public_key_pem)            return 'pki_public_key'
    return null
}

/**
 * Get the tag name for a schema, or null if none registered.
 */
export function getSchemaViewer(schemaId) {
    return _viewers.get(schemaId) || null
}

/**
 * Get all registered schema IDs.
 */
export function registeredSchemas() {
    return [..._viewers.keys()]
}
