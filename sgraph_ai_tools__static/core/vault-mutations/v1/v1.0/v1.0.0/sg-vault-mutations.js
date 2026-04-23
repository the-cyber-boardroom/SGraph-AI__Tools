/* =============================================================================
   SGraph — Vault Mutations Module
   v1.0.0 — High-level file and folder operations on a vault session

   All 9 mutation operations from the vault team's SGVault class, adapted to
   work with a VaultSession instance. Each mutation:
     1. Validates inputs
     2. Optionally encrypts and uploads a blob (for add/update)
     3. Mutates the session's tree model
     4. Calls session.commit(message)

   Usage:
     import { addFile, removeFile, renameFile, createFolder } from './sg-vault-mutations.js';
     import { createSession } from '/core/vault-session/v1/v1.0/v1.0.0/sg-vault-session.js';

     const session = createSession({ apiBaseUrl, vaultId, keys });
     await session.open();
     await addFile(session, '/', 'hello.txt', 'Hello world');
     await renameFile(session, '/', 'hello.txt', 'greeting.txt');
     await session.push();

   ============================================================================= */

// ── File mutations ──────────────────────────────────────────────────────────

/**
 * Add a new file to the vault.
 * Encrypts content, uploads blob, inserts into tree model, commits.
 *
 * @param {import('../vault-session/v1/v1.0/v1.0.0/sg-vault-session.js').VaultSession} session
 * @param {string} folderPath - Parent folder (e.g. '/' or '/docs')
 * @param {string} fileName - File name
 * @param {string|Uint8Array} content - File content
 * @param {object} [options]
 * @param {string} [options.message] - Commit message
 * @returns {Promise<{ commitId: string, treeId: string, blob_id: string }>}
 */
export async function addFile(session, folderPath, fileName, content, options = {}) {
    await _ensureLoaded(session, folderPath)

    const existing = session.treeModel.getNode(
        folderPath === '/' ? `/${fileName}` : `${folderPath}/${fileName}`
    )
    if (existing) {
        throw new Error(`File already exists: ${folderPath}/${fileName}`)
    }

    const entry = await session.uploadBlob(content)
    session.treeModel.insertFile(folderPath, fileName, entry)

    const message = options.message || `Add ${fileName}`
    const result  = await session.commit(message)
    return { ...result, blob_id: entry.blob_id }
}

/**
 * Update an existing file's content.
 * Encrypts new content, uploads blob, updates tree model entry, commits.
 *
 * @param {object} session - VaultSession instance
 * @param {string} folderPath - Parent folder
 * @param {string} fileName - File name
 * @param {string|Uint8Array} content - New content
 * @param {object} [options]
 * @param {string} [options.message] - Commit message
 * @returns {Promise<{ commitId: string, treeId: string, blob_id: string }>}
 */
export async function updateFile(session, folderPath, fileName, content, options = {}) {
    await _ensureLoaded(session, folderPath)

    const entry = await session.uploadBlob(content)
    session.treeModel.updateFile(folderPath, fileName, entry)

    const message = options.message || `Update ${fileName}`
    const result  = await session.commit(message)
    return { ...result, blob_id: entry.blob_id }
}

/**
 * Remove a file from the vault.
 *
 * @param {object} session - VaultSession instance
 * @param {string} folderPath - Parent folder
 * @param {string} fileName - File name to remove
 * @param {object} [options]
 * @param {string} [options.message] - Commit message
 * @returns {Promise<{ commitId: string, treeId: string }>}
 */
export async function removeFile(session, folderPath, fileName, options = {}) {
    await _ensureLoaded(session, folderPath)

    const fullPath = folderPath === '/' ? `/${fileName}` : `${folderPath}/${fileName}`
    const node = session.treeModel.getNode(fullPath)
    if (!node || node.type !== 'file') {
        throw new Error(`File not found: ${fullPath}`)
    }

    session.treeModel.removeEntry(folderPath, fileName)
    return session.commit(options.message || `Remove ${fileName}`)
}

/**
 * Rename a file within the same folder.
 *
 * @param {object} session - VaultSession instance
 * @param {string} folderPath - Parent folder
 * @param {string} oldName - Current file name
 * @param {string} newName - New file name
 * @param {object} [options]
 * @param {string} [options.message] - Commit message
 * @returns {Promise<{ commitId: string, treeId: string }>}
 */
export async function renameFile(session, folderPath, oldName, newName, options = {}) {
    await _ensureLoaded(session, folderPath)
    session.treeModel.renameEntry(folderPath, oldName, newName)
    return session.commit(options.message || `Rename ${oldName} → ${newName}`)
}

/**
 * Move a file from one folder to another.
 *
 * @param {object} session - VaultSession instance
 * @param {string} srcFolder - Source parent folder
 * @param {string} fileName - File name
 * @param {string} destFolder - Destination parent folder
 * @param {object} [options]
 * @param {string} [options.message] - Commit message
 * @returns {Promise<{ commitId: string, treeId: string }>}
 */
export async function moveFile(session, srcFolder, fileName, destFolder, options = {}) {
    await _ensureLoaded(session, srcFolder)
    await _ensureLoaded(session, destFolder)
    session.treeModel.moveEntry(srcFolder, fileName, destFolder)
    return session.commit(options.message || `Move ${fileName} to ${destFolder}`)
}

// ── Folder mutations ────────────────────────────────────────────────────────

/**
 * Create an empty folder.
 *
 * @param {object} session - VaultSession instance
 * @param {string} parentPath - Parent folder path
 * @param {string} folderName - New folder name
 * @param {object} [options]
 * @param {string} [options.message] - Commit message
 * @returns {Promise<{ commitId: string, treeId: string }>}
 */
export async function createFolder(session, parentPath, folderName, options = {}) {
    await _ensureLoaded(session, parentPath)
    session.treeModel.createFolder(parentPath, folderName)
    return session.commit(options.message || `Create folder ${folderName}`)
}

/**
 * Remove a folder and all its contents.
 *
 * @param {object} session - VaultSession instance
 * @param {string} parentPath - Parent folder path
 * @param {string} folderName - Folder name to remove
 * @param {object} [options]
 * @param {string} [options.message] - Commit message
 * @returns {Promise<{ commitId: string, treeId: string }>}
 */
export async function removeFolder(session, parentPath, folderName, options = {}) {
    await _ensureLoaded(session, parentPath)

    const fullPath = parentPath === '/' ? `/${folderName}` : `${parentPath}/${folderName}`
    const node = session.treeModel.getNode(fullPath)
    if (!node || node.type !== 'folder') {
        throw new Error(`Folder not found: ${fullPath}`)
    }

    session.treeModel.removeEntry(parentPath, folderName)
    return session.commit(options.message || `Remove folder ${folderName}`)
}

/**
 * Rename a folder within the same parent.
 *
 * @param {object} session - VaultSession instance
 * @param {string} parentPath - Parent folder path
 * @param {string} oldName - Current folder name
 * @param {string} newName - New folder name
 * @param {object} [options]
 * @param {string} [options.message] - Commit message
 * @returns {Promise<{ commitId: string, treeId: string }>}
 */
export async function renameFolder(session, parentPath, oldName, newName, options = {}) {
    await _ensureLoaded(session, parentPath)
    session.treeModel.renameEntry(parentPath, oldName, newName)
    return session.commit(options.message || `Rename folder ${oldName} → ${newName}`)
}

/**
 * Move a folder from one parent to another.
 *
 * @param {object} session - VaultSession instance
 * @param {string} srcParent - Source parent folder path
 * @param {string} folderName - Folder name to move
 * @param {string} destParent - Destination parent folder path
 * @param {object} [options]
 * @param {string} [options.message] - Commit message
 * @returns {Promise<{ commitId: string, treeId: string }>}
 */
export async function moveFolder(session, srcParent, folderName, destParent, options = {}) {
    await _ensureLoaded(session, srcParent)
    await _ensureLoaded(session, destParent)
    session.treeModel.moveEntry(srcParent, folderName, destParent)
    return session.commit(options.message || `Move folder ${folderName} to ${destParent}`)
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Ensure a folder is loaded (not a stub) before mutating.
 * If it's a stub, load it from the server.
 * @param {object} session
 * @param {string} folderPath
 */
async function _ensureLoaded(session, folderPath) {
    if (session.treeModel.needsLoading(folderPath)) {
        await session.loadSubTree(folderPath)
    }
}
