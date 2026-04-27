/**
 * vault-store — vault registry backed by Google Drive App Data.
 *
 * Stores a single vaults.json file in the user's Drive App Data folder.
 * Registry format matches sg-vault-manager localStorage format for compatibility.
 *
 * @module vault-store
 * @version 0.1.51
 */

const VAULTS_FILE = 'vaults.json';

/**
 * Generate a vault master key in SGraph format: {48-char hex}:{16-char hex}
 * @returns {string}
 */
export function generateVaultKey() {
    const part1 = Array.from(crypto.getRandomValues(new Uint8Array(24)))
        .map(b => b.toString(16).padStart(2, '0')).join('');
    const part2 = Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map(b => b.toString(16).padStart(2, '0')).join('');
    return `${part1}:${part2}`;
}

/**
 * VaultStore — reads/writes vault registry in Drive App Data.
 *
 * @example
 * const store = new VaultStore(driveAppDataInstance);
 * await store.load();
 * const vault = await store.create({ displayName: 'My Vault', apiBaseUrl: 'https://vault.sgraph.ai', vaultKey: '...' });
 */
export class VaultStore {
    /** @param {import('/core/drive-appdata/v0/v0.1/v0.1.0/sg-drive-appdata.js').DriveAppData} drive */
    constructor(drive) {
        this._drive  = drive;
        this._vaults = [];
    }

    /**
     * Load vault registry from Drive App Data.
     * @returns {Promise<VaultEntry[]>}
     */
    async load() {
        try {
            const raw = await this._drive.readFile(VAULTS_FILE);
            if (raw) this._vaults = JSON.parse(raw).vaults || [];
        } catch { this._vaults = []; }
        return this._vaults;
    }

    async _save() {
        await this._drive.writeFile(VAULTS_FILE,
            JSON.stringify({ vaults: this._vaults }, null, 2));
    }

    /** @returns {VaultEntry[]} */
    list() { return [...this._vaults]; }

    /** @returns {VaultEntry|null} */
    get(vaultId) { return this._vaults.find(v => v.vaultId === vaultId) ?? null; }

    /**
     * Create a new vault entry and persist to Drive.
     * @param {{ displayName: string, apiBaseUrl: string, vaultKey?: string }} opts
     * @returns {Promise<VaultEntry>}
     */
    async create({ displayName, apiBaseUrl, vaultKey }) {
        const entry = {
            vaultId:     crypto.randomUUID(),
            displayName,
            apiBaseUrl:  apiBaseUrl.replace(/\/$/, ''),
            vaultKey:    vaultKey || generateVaultKey(),
            createdAt:   new Date().toISOString(),
            lastUsed:    null,
        };
        this._vaults.push(entry);
        await this._save();
        return entry;
    }

    /**
     * Update last-used timestamp for a vault.
     * @param {string} vaultId
     */
    async touchLastUsed(vaultId) {
        const v = this._vaults.find(v => v.vaultId === vaultId);
        if (v) { v.lastUsed = new Date().toISOString(); await this._save(); }
    }

    /**
     * Update fields on an existing vault entry and persist to Drive.
     * @param {string} vaultId
     * @param {Partial<VaultEntry>} changes
     * @returns {Promise<VaultEntry|null>}
     */
    async update(vaultId, changes) {
        const v = this._vaults.find(v => v.vaultId === vaultId);
        if (!v) return null;
        Object.assign(v, changes);
        await this._save();
        return v;
    }

    /**
     * Remove a vault from the registry.
     * @param {string} vaultId
     */
    async remove(vaultId) {
        this._vaults = this._vaults.filter(v => v.vaultId !== vaultId);
        await this._save();
    }
}

/**
 * @typedef {Object} VaultEntry
 * @property {string}      vaultId
 * @property {string}      displayName
 * @property {string}      apiBaseUrl
 * @property {string}      vaultKey
 * @property {string}      createdAt
 * @property {string|null} lastUsed
 */
