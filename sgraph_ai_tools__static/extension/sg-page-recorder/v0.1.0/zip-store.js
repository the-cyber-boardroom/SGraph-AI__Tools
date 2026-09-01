/**
 * zip-store.js — a minimal, dependency-free ZIP writer (STORE, no compression).
 *
 * The extension has no network code and no bundler, so it cannot pull JSZip from
 * a CDN or npm. A stored-entry zip is about eighty lines of well-specified
 * format, and writing it here keeps the extension a folder of plain files that
 * anyone can read end to end before trusting it with their keystrokes.
 *
 * No compression: the payload is JSON and PNG. PNG is already compressed, and the
 * JSON saving would not justify shipping an inflate implementation.
 *
 * @module zip-store
 */

const enc = new TextEncoder();

/** CRC-32, table built once. */
const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c >>> 0;
    }
    return t;
})();

function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosTime(d = new Date()) {
    const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
    const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { time, date };
}

/**
 * @param {Array<{path: string, text?: string, bytes?: Uint8Array}>} entries
 * @returns {Blob} a valid .zip
 */
export function zipStore(entries) {
    const parts = [];
    const central = [];
    let offset = 0;
    const { time, date } = dosTime();

    for (const e of entries) {
        const name = enc.encode(e.path);
        const data = e.bytes || enc.encode(e.text ?? '');
        const crc = crc32(data);

        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);       // local file header
        local.setUint16(4, 20, true);               // version needed
        local.setUint16(6, 0x0800, true);           // UTF-8 names
        local.setUint16(8, 0, true);                // STORE
        local.setUint16(10, time, true);
        local.setUint16(12, date, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, name.length, true);
        local.setUint16(28, 0, true);
        parts.push(new Uint8Array(local.buffer), name, data);

        const cen = new DataView(new ArrayBuffer(46));
        cen.setUint32(0, 0x02014b50, true);         // central directory header
        cen.setUint16(4, 20, true);
        cen.setUint16(6, 20, true);
        cen.setUint16(8, 0x0800, true);
        cen.setUint16(10, 0, true);
        cen.setUint16(12, time, true);
        cen.setUint16(14, date, true);
        cen.setUint32(16, crc, true);
        cen.setUint32(20, data.length, true);
        cen.setUint32(24, data.length, true);
        cen.setUint16(28, name.length, true);
        cen.setUint32(42, offset, true);
        central.push(new Uint8Array(cen.buffer), name);

        offset += 30 + name.length + data.length;
    }

    const centralBytes = central.reduce((n, b) => n + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);             // end of central directory
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralBytes, true);
    end.setUint32(16, offset, true);

    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

/** data: URL → bytes, for the screenshots captureVisibleTab returns. */
export function dataUrlToBytes(dataUrl) {
    const b64 = String(dataUrl).split(',')[1] || '';
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
