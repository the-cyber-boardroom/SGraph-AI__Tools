/**
 * Magic-byte content-type sniffing for vault-fetched blobs.
 *
 * Inspects the first bytes of decrypted content to determine MIME type.
 * Used by <sg-vault-fetch> to populate the contentType field in content-ready.
 *
 * @module sg-vault-fetch-content-type
 * @version 0.1.0
 */

/**
 * Sniff the content-type of decrypted bytes.
 *
 * Detection order:
 *   1. PNG magic bytes:  89 50 4E 47
 *   2. JPEG magic bytes: FF D8 FF
 *   3. GIF magic bytes:  47 49 46 38
 *   4. WebP:             52 49 46 46 ... 57 45 42 50
 *   5. JSON:             leading { or [ after UTF-8 decode
 *   6. HTML:             leading < after UTF-8 decode
 *   7. Valid UTF-8 text: text/plain
 *   8. Otherwise:        application/octet-stream
 *
 * @param {ArrayBuffer} bytes - Decrypted content bytes
 * @returns {{ contentType: string, text: string|null }}
 */
export function sniffContentType(bytes) {
    const arr = new Uint8Array(bytes)

    // PNG: 89 50 4E 47
    if (arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4E && arr[3] === 0x47) {
        return { contentType: 'image/png', text: null }
    }

    // JPEG: FF D8 FF
    if (arr[0] === 0xFF && arr[1] === 0xD8 && arr[2] === 0xFF) {
        return { contentType: 'image/jpeg', text: null }
    }

    // GIF: 47 49 46 38
    if (arr[0] === 0x47 && arr[1] === 0x49 && arr[2] === 0x46 && arr[3] === 0x38) {
        return { contentType: 'image/gif', text: null }
    }

    // WebP: RIFF....WEBP  (52 49 46 46 xx xx xx xx 57 45 42 50)
    if (
        arr[0] === 0x52 && arr[1] === 0x49 && arr[2] === 0x46 && arr[3] === 0x46 &&
        arr[8] === 0x57 && arr[9] === 0x45 && arr[10] === 0x42 && arr[11] === 0x50
    ) {
        return { contentType: 'image/webp', text: null }
    }

    // Attempt UTF-8 decode for text-based types
    let text = null
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        // Not valid UTF-8 — binary content
        return { contentType: 'application/octet-stream', text: null }
    }

    const trimmed = text.trimStart()

    // JSON: starts with { or [
    if (trimmed[0] === '{' || trimmed[0] === '[') {
        return { contentType: 'application/json', text }
    }

    // HTML: starts with <
    if (trimmed[0] === '<') {
        return { contentType: 'text/html', text }
    }

    // Markdown heuristic: starts with # (heading) — still text/plain per spec
    // Valid UTF-8 plain text
    return { contentType: 'text/plain', text }
}
