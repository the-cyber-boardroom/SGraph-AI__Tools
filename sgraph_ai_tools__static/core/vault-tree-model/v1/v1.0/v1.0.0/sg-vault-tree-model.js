/* =============================================================================
   SGraph — Vault Tree Model
   v1.0.0 — Persistent in-memory tree with STUB/LOADED folder states

   Maintains the in-memory representation of a vault's directory tree. Folders
   start as stubs (with a _tree_id but no children loaded) and transition to
   loaded state when the user expands them.

   Critical invariant from the vault team: during commit, unloaded folders pass
   through unchanged — their _tree_id is preserved verbatim in the new tree
   object. This means committing a change to /README.md never touches an
   unloaded /archive/ folder (which might contain 100 files).

   Folder node states:
     STUB:   { type:'folder', children:{}, _tree_id:'obj-cas-imm-...', _loaded:false }
     LOADED: { type:'folder', children:{...}, _loaded:true }

   File node:
     { type:'file', blob_id:'obj-cas-imm-...', size:number, content_hash:string, name:string }

   Usage:
     import { createTreeModel } from './sg-vault-tree-model.js';

     const model = createTreeModel();
     model.loadRoot(rootTreeEntries);
     model.loadSubTree('/documents', subTreeEntries);
     const entries = model.buildTreeEntries(model.getRoot());

   ============================================================================= */

/**
 * Create a new tree model instance.
 * @returns {TreeModel}
 */
export function createTreeModel() {
    return new TreeModel()
}

/**
 * @typedef {object} FolderNode
 * @property {'folder'} type
 * @property {Object<string, FolderNode|FileNode>} children
 * @property {string} [_tree_id] - Object ID for unloaded sub-tree (present only when _loaded=false)
 * @property {boolean} _loaded - Whether children have been fetched
 */

/**
 * @typedef {object} FileNode
 * @property {'file'} type
 * @property {string} blob_id - Content-addressed blob ID
 * @property {number} size - File size in bytes
 * @property {string} content_hash - SHA-256(plaintext)[:12]
 * @property {string} name - Decrypted file name
 */

class TreeModel {
    constructor() {
        /** @type {{ '/': FolderNode }} */
        this._tree = { '/': { type: 'folder', children: {}, _loaded: true } }

        /** @type {object|null} */
        this._settings = null

        /** @type {string|null} */
        this._settingsBlobId = null
    }

    /**
     * Load the root tree from decrypted tree entries (from open() step 5–6).
     * Resets the entire in-memory tree and populates root-level entries.
     * Sub-folders become stubs; files are inserted directly.
     *
     * @param {Array<{ name: string, blob_id?: string, tree_id?: string, size?: number, content_hash?: string }>} entries
     */
    loadRoot(entries) {
        this._tree = { '/': { type: 'folder', children: {}, _loaded: true } }
        this._settings = null
        this._settingsBlobId = null

        for (const entry of entries) {
            if (entry.name === '.vault-settings') {
                this._settingsBlobId = entry.blob_id
                continue
            }
            this._insertEntry('/', entry)
        }
    }

    /**
     * Load a sub-tree's entries into a folder that was previously a stub.
     * Transitions the folder from STUB to LOADED state.
     *
     * @param {string} folderPath - Absolute path (e.g. '/documents')
     * @param {Array<{ name: string, blob_id?: string, tree_id?: string, size?: number, content_hash?: string }>} entries
     * @returns {boolean} true if loaded, false if already loaded or not found
     */
    loadSubTree(folderPath, entries) {
        const node = this.getNode(folderPath)
        if (!node || node.type !== 'folder') return false
        if (node._loaded) return false

        for (const entry of entries) {
            if (entry.tree_id && !entry.blob_id) {
                node.children[entry.name] = {
                    type: 'folder',
                    children: {},
                    _tree_id: entry.tree_id,
                    _loaded: false
                }
            } else {
                node.children[entry.name] = {
                    type: 'file',
                    blob_id: entry.blob_id,
                    size: entry.size || 0,
                    content_hash: entry.content_hash || '',
                    name: entry.name
                }
            }
        }

        node._loaded = true
        delete node._tree_id
        return true
    }

    /**
     * Check if a folder path needs loading (is still a stub).
     *
     * @param {string} folderPath - Absolute path
     * @returns {boolean}
     */
    needsLoading(folderPath) {
        const node = this.getNode(folderPath)
        return node
            && node.type === 'folder'
            && node._loaded === false
            && !!node._tree_id
    }

    /**
     * Get the tree_id for a stub folder (needed to fetch it from the server).
     *
     * @param {string} folderPath - Absolute path
     * @returns {string|null}
     */
    getTreeId(folderPath) {
        const node = this.getNode(folderPath)
        if (!node || node.type !== 'folder' || node._loaded) return null
        return node._tree_id || null
    }

    /**
     * Navigate to a node by path.
     *
     * @param {string} path - Absolute path (e.g. '/', '/docs', '/docs/readme.md')
     * @returns {FolderNode|FileNode|null}
     */
    getNode(path) {
        if (path === '/' || path === '') return this._tree['/']

        const parts = path.replace(/^\//, '').replace(/\/$/, '').split('/')
        let node = this._tree['/']

        for (const part of parts) {
            if (!node || node.type !== 'folder' || !node.children[part]) return null
            node = node.children[part]
        }

        return node
    }

    /**
     * Get the root folder node.
     * @returns {FolderNode}
     */
    getRoot() {
        return this._tree['/']
    }

    /**
     * Get vault settings (loaded via loadSettings).
     * @returns {object|null}
     */
    getSettings() {
        return this._settings
    }

    /**
     * Set vault settings (after decrypting the .vault-settings blob).
     * @param {object} settings
     */
    setSettings(settings) {
        this._settings = settings
    }

    /**
     * Get the blob ID for the .vault-settings entry (for fetching).
     * @returns {string|null}
     */
    getSettingsBlobId() {
        return this._settingsBlobId
    }

    // ── Mutation operations ─────────────────────────────────────────────────

    /**
     * Insert a file entry into a folder.
     *
     * @param {string} folderPath - Absolute folder path
     * @param {string} name - File name
     * @param {{ blob_id: string, size: number, content_hash: string }} entry
     * @throws {Error} if folder not found or not loaded
     */
    insertFile(folderPath, name, entry) {
        const folder = this._requireLoadedFolder(folderPath)
        folder.children[name] = {
            type: 'file',
            blob_id: entry.blob_id,
            size: entry.size,
            content_hash: entry.content_hash,
            name
        }
    }

    /**
     * Update an existing file's blob reference.
     *
     * @param {string} folderPath - Absolute folder path
     * @param {string} name - File name
     * @param {{ blob_id: string, size: number, content_hash: string }} entry
     * @throws {Error} if file not found
     */
    updateFile(folderPath, name, entry) {
        const folder = this._requireLoadedFolder(folderPath)
        const existing = folder.children[name]
        if (!existing || existing.type !== 'file') {
            throw new Error(`File not found: ${folderPath}/${name}`)
        }
        existing.blob_id = entry.blob_id
        existing.size = entry.size
        existing.content_hash = entry.content_hash
    }

    /**
     * Remove a file or folder entry.
     *
     * @param {string} folderPath - Absolute parent folder path
     * @param {string} name - Entry name to remove
     * @throws {Error} if not found
     */
    removeEntry(folderPath, name) {
        const folder = this._requireLoadedFolder(folderPath)
        if (!folder.children[name]) {
            throw new Error(`Entry not found: ${folderPath}/${name}`)
        }
        delete folder.children[name]
    }

    /**
     * Rename a file or folder entry within the same parent.
     *
     * @param {string} folderPath - Absolute parent folder path
     * @param {string} oldName - Current name
     * @param {string} newName - New name
     * @throws {Error} if not found or newName already exists
     */
    renameEntry(folderPath, oldName, newName) {
        const folder = this._requireLoadedFolder(folderPath)
        if (!folder.children[oldName]) {
            throw new Error(`Entry not found: ${folderPath}/${oldName}`)
        }
        if (folder.children[newName]) {
            throw new Error(`Entry already exists: ${folderPath}/${newName}`)
        }
        const entry = folder.children[oldName]
        if (entry.type === 'file') entry.name = newName
        folder.children[newName] = entry
        delete folder.children[oldName]
    }

    /**
     * Move a file or folder from one parent to another.
     *
     * @param {string} srcFolder - Source parent folder path
     * @param {string} name - Entry name
     * @param {string} destFolder - Destination parent folder path
     * @throws {Error} if not found or destination has a name collision
     */
    moveEntry(srcFolder, name, destFolder) {
        const src = this._requireLoadedFolder(srcFolder)
        const dst = this._requireLoadedFolder(destFolder)
        if (!src.children[name]) {
            throw new Error(`Entry not found: ${srcFolder}/${name}`)
        }
        if (dst.children[name]) {
            throw new Error(`Entry already exists at destination: ${destFolder}/${name}`)
        }
        dst.children[name] = src.children[name]
        delete src.children[name]
    }

    /**
     * Create an empty folder.
     *
     * @param {string} parentPath - Parent folder path
     * @param {string} name - New folder name
     * @throws {Error} if parent not found or name already exists
     */
    createFolder(parentPath, name) {
        const parent = this._requireLoadedFolder(parentPath)
        if (parent.children[name]) {
            throw new Error(`Entry already exists: ${parentPath}/${name}`)
        }
        parent.children[name] = {
            type: 'folder',
            children: {},
            _loaded: true
        }
    }

    // ── Tree serialisation for commit ───────────────────────────────────────

    /**
     * Build tree entries for a folder node, suitable for createTree().
     * Preserves unloaded stubs with their original _tree_id — the critical
     * invariant that prevents data loss on partial commits.
     *
     * @param {FolderNode} node - The folder node to serialise
     * @returns {Array<{ name: string, blob_id: string|null, tree_id: string|null, size: number, content_hash: string|null }>}
     */
    buildTreeEntries(node) {
        const entries = []

        for (const [name, child] of Object.entries(node.children)) {
            if (child.type === 'folder') {
                if (!child._loaded && child._tree_id) {
                    entries.push({
                        name,
                        blob_id: null,
                        tree_id: child._tree_id,
                        size: 0,
                        content_hash: null
                    })
                } else {
                    entries.push({
                        name,
                        blob_id: null,
                        tree_id: null,
                        size: 0,
                        content_hash: null,
                        _children: child
                    })
                }
            } else {
                entries.push({
                    name,
                    blob_id: child.blob_id,
                    tree_id: null,
                    size: child.size,
                    content_hash: child.content_hash
                })
            }
        }

        return entries
    }

    /**
     * List all files in a folder (non-recursive, loaded entries only).
     *
     * @param {string} folderPath - Absolute folder path
     * @returns {Array<{ name: string, type: string, size?: number, blob_id?: string }>}
     */
    listFolder(folderPath) {
        const node = this.getNode(folderPath)
        if (!node || node.type !== 'folder') return []

        return Object.entries(node.children).map(([name, child]) => {
            if (child.type === 'folder') {
                return {
                    name,
                    type: 'folder',
                    _loaded: child._loaded,
                    _tree_id: child._tree_id || null
                }
            }
            return {
                name,
                type: 'file',
                size: child.size,
                blob_id: child.blob_id
            }
        })
    }

    /**
     * Recursively collect all file paths in the tree (loaded folders only).
     * Unloaded folder stubs are listed as folders but not traversed.
     *
     * @param {string} [basePath='/'] - Starting path
     * @returns {string[]} Array of absolute file paths
     */
    getAllFilePaths(basePath = '/') {
        const paths = []
        const node  = this.getNode(basePath)
        if (!node || node.type !== 'folder') return paths

        for (const [name, child] of Object.entries(node.children)) {
            const childPath = basePath === '/' ? `/${name}` : `${basePath}/${name}`
            if (child.type === 'file') {
                paths.push(childPath)
            } else if (child.type === 'folder' && child._loaded) {
                paths.push(...this.getAllFilePaths(childPath))
            }
        }

        return paths
    }

    /**
     * Get stats about the current tree state.
     *
     * @returns {{ totalFiles: number, totalFolders: number, loadedFolders: number, stubFolders: number }}
     */
    getStats() {
        const stats = { totalFiles: 0, totalFolders: 0, loadedFolders: 0, stubFolders: 0 }
        this._walkStats(this._tree['/'], stats)
        return stats
    }

    // ── Internal helpers ────────────────────────────────────────────────────

    /** @private */
    _insertEntry(folderPath, entry) {
        const folder = this.getNode(folderPath)
        if (!folder || folder.type !== 'folder') return

        if (entry.tree_id && !entry.blob_id) {
            folder.children[entry.name] = {
                type: 'folder',
                children: {},
                _tree_id: entry.tree_id,
                _loaded: false
            }
        } else {
            folder.children[entry.name] = {
                type: 'file',
                blob_id: entry.blob_id,
                size: entry.size || 0,
                content_hash: entry.content_hash || '',
                name: entry.name
            }
        }
    }

    /** @private */
    _requireLoadedFolder(path) {
        const node = this.getNode(path)
        if (!node) throw new Error(`Folder not found: ${path}`)
        if (node.type !== 'folder') throw new Error(`Not a folder: ${path}`)
        if (!node._loaded) throw new Error(`Folder not loaded: ${path}`)
        return node
    }

    /** @private */
    _walkStats(node, stats) {
        for (const child of Object.values(node.children)) {
            if (child.type === 'file') {
                stats.totalFiles++
            } else {
                stats.totalFolders++
                if (child._loaded) {
                    stats.loadedFolders++
                    this._walkStats(child, stats)
                } else {
                    stats.stubFolders++
                }
            }
        }
    }
}
