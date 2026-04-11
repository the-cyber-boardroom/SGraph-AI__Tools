/**
 * SgToolApi — Instance Registry
 *
 * Manages window.__tools and window.__tool_registry for all tool instances.
 *
 * Because sg-layout is fractal, the same tool (e.g. 'infographic-generator')
 * can be mounted in multiple panels simultaneously. Each instance registers
 * under a unique key: '{toolName}:{panelId}'.
 *
 * `window.__tool` (singular convenience alias) is only set when exactly one
 * instance exists across all tools. It is deleted when a second instance
 * registers, to prevent silent wrong-instance bugs.
 *
 * Usage:
 *   import { registerTool, findTool, findAllTools } from './sg-tool-api-registry.js';
 *
 * @module sg-tool-api-registry
 * @version 0.1.0
 */

/** @type {Array<{ toolName: string, instanceId: string, api: object }>} */
const _registry = [];

/**
 * Register a tool instance.
 * Called by SgToolApi.activate() — do not call directly.
 *
 * @param {string} toolName   e.g. 'infographic-generator'
 * @param {string} instanceId e.g. 'infographic-generator:panel-s-right'
 * @param {object} api        The SgToolApi instance
 */
function registerTool(toolName, instanceId, api) {
    // Remove any prior registration for this instanceId (re-activation)
    const existing = _registry.findIndex(r => r.instanceId === instanceId);
    if (existing !== -1) _registry.splice(existing, 1);

    _registry.push({ toolName, instanceId, api });

    if (typeof window !== 'undefined') {
        window.__tools = window.__tools || {};
        window.__tools[instanceId] = api;

        // Convenience alias: only set when exactly one instance total
        if (_registry.length === 1) {
            window.__tool = api;
        } else {
            // Multiple instances — remove ambiguous alias, force explicit lookup
            delete window.__tool;
        }
    }
}

/**
 * Find the first registered instance of a tool by name.
 * On single-tool pages this is the only instance.
 *
 * @param {string} toolName
 * @returns {object|null}
 */
function findTool(toolName) {
    return _registry.find(r => r.toolName === toolName)?.api ?? null;
}

/**
 * Find all registered instances of a tool by name.
 *
 * @param {string} toolName
 * @returns {object[]}
 */
function findAllTools(toolName) {
    return _registry.filter(r => r.toolName === toolName).map(r => r.api);
}

/**
 * Find a specific instance by its full instanceId.
 *
 * @param {string} instanceId  e.g. 'infographic-generator:panel-s-right'
 * @returns {object|null}
 */
function findToolById(instanceId) {
    return _registry.find(r => r.instanceId === instanceId)?.api ?? null;
}

/**
 * List all registered instances.
 *
 * @returns {Array<{ toolName: string, instanceId: string, api: object }>}
 */
function listTools() {
    return [..._registry];
}

// Expose discovery API on window
if (typeof window !== 'undefined') {
    window.__tool_registry = { find: findTool, findAll: findAllTools, findById: findToolById, list: listTools };
}

export { registerTool, findTool, findAllTools, findToolById, listTools };
