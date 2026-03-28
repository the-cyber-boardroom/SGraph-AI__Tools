/**
 * sg-image — Client-side image processing via Canvas API
 *
 * Pure ES module. No frameworks, no build step, no external dependencies.
 * Every function takes canvas/image data in and returns canvas/blob out.
 *
 * @module sg-image
 * @version 1.0.0
 */

/**
 * Load a File (or Blob) into an HTMLImageElement and return its dimensions and metadata.
 *
 * @param {File} file - The image file to load
 * @returns {Promise<{ width: number, height: number, format: string, size: number, image: HTMLImageElement }>}
 */
export function getImageInfo(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();

        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve({
                width  : image.naturalWidth,
                height : image.naturalHeight,
                format : file.type || 'unknown',
                size   : file.size,
                image,
            });
        };

        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error(`Failed to load image from file: ${file.name || 'unknown'}`));
        };

        image.src = url;
    });
}

/**
 * Check whether the current browser supports AVIF encoding via the Canvas API.
 *
 * Creates a tiny 1x1 canvas, calls toDataURL('image/avif'), and checks
 * whether the resulting string actually begins with the AVIF data-URI prefix.
 *
 * @returns {boolean} true if AVIF export is supported
 */
export function supportsAvif() {
    try {
        const c   = document.createElement('canvas');
        c.width   = 1;
        c.height  = 1;
        const uri = c.toDataURL('image/avif');
        return uri.startsWith('data:image/avif');
    } catch {
        return false;
    }
}

/**
 * Crop a canvas to the specified rectangular region.
 *
 * Returns a **new** HTMLCanvasElement containing only the cropped area.
 *
 * @param {HTMLCanvasElement} canvas - Source canvas
 * @param {{ x: number, y: number, width: number, height: number }} region - Crop rectangle
 * @returns {HTMLCanvasElement} A new canvas containing the cropped region
 */
export function crop(canvas, { x, y, width, height }) {
    const out = document.createElement('canvas');
    out.width  = width;
    out.height = height;

    const ctx = out.getContext('2d');
    ctx.drawImage(canvas, x, y, width, height, 0, 0, width, height);

    return out;
}

/**
 * Resize a canvas to the given dimensions using high-quality image smoothing.
 *
 * Returns a **new** HTMLCanvasElement at the target size.
 *
 * @param {HTMLCanvasElement} canvas - Source canvas
 * @param {{ width: number, height: number }} size - Target dimensions
 * @returns {HTMLCanvasElement} A new canvas at the requested size
 */
export function resize(canvas, { width, height }) {
    const out = document.createElement('canvas');
    out.width  = width;
    out.height = height;

    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, width, height);

    return out;
}

/**
 * Redact one or more rectangular regions on a canvas.
 *
 * Each region specifies its position, size, and mode:
 * - `'black'` fills the region with a solid black rectangle.
 * - `'blur'`  pixelates the region by drawing it at a tiny scale and then
 *   scaling back up (effective pixel size = 10).
 *
 * **Mutates and returns the same canvas.**
 *
 * @param {HTMLCanvasElement} canvas - The canvas to redact (mutated in place)
 * @param {{ regions: Array<{ x: number, y: number, w: number, h: number, mode: 'black'|'blur' }> }} options
 * @returns {HTMLCanvasElement} The same canvas, now with redacted regions
 */
export function redact(canvas, { regions }) {
    const ctx = canvas.getContext('2d');

    for (const region of regions) {
        const { x, y, w, h, mode } = region;

        if (mode === 'black') {
            ctx.fillStyle = '#000000';
            ctx.fillRect(x, y, w, h);
        } else if (mode === 'blur') {
            // Pixelation: draw the region small, then scale it back up
            const pixelSize = 10;
            const smallW = Math.max(1, Math.ceil(w / pixelSize));
            const smallH = Math.max(1, Math.ceil(h / pixelSize));

            const tmp    = document.createElement('canvas');
            tmp.width    = smallW;
            tmp.height   = smallH;
            const tmpCtx = tmp.getContext('2d');

            // Disable smoothing so we get hard pixel edges
            tmpCtx.imageSmoothingEnabled = false;

            // Draw the region scaled down
            tmpCtx.drawImage(canvas, x, y, w, h, 0, 0, smallW, smallH);

            // Draw it back scaled up — disable smoothing on the target too
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tmp, 0, 0, smallW, smallH, x, y, w, h);

            // Restore smoothing for any subsequent operations
            ctx.imageSmoothingEnabled = true;
        }
    }

    return canvas;
}

/**
 * Draw text onto a canvas.
 *
 * Supports multi-line text (split on `\n`), optional bold/italic styling,
 * and an optional black outline stroke behind the text for readability.
 *
 * **Mutates and returns the same canvas.**
 *
 * @param {HTMLCanvasElement} canvas - The canvas to draw on (mutated in place)
 * @param {{
 *   text: string,
 *   x: number,
 *   y: number,
 *   fontSize?: number,
 *   fontFamily?: string,
 *   color?: string,
 *   align?: CanvasTextAlign,
 *   bold?: boolean,
 *   italic?: boolean,
 *   outline?: boolean
 * }} options
 * @returns {HTMLCanvasElement} The same canvas with text drawn
 */
export function addText(canvas, { text, x, y, fontSize = 16, fontFamily = 'sans-serif', color = '#000000', align = 'left', bold = false, italic = false, outline = false }) {
    const ctx = canvas.getContext('2d');

    // Build the CSS font string
    const parts = [];
    if (italic) parts.push('italic');
    if (bold)   parts.push('bold');
    parts.push(`${fontSize}px`);
    parts.push(fontFamily);
    ctx.font = parts.join(' ');

    ctx.textAlign    = align;
    ctx.textBaseline = 'top';

    const lines      = text.split('\n');
    const lineHeight = fontSize * 1.2;

    for (let i = 0; i < lines.length; i++) {
        const lineY = y + i * lineHeight;

        if (outline) {
            ctx.strokeStyle = '#000000';
            ctx.lineWidth   = 3;
            ctx.lineJoin    = 'round';
            ctx.strokeText(lines[i], x, lineY);
        }

        ctx.fillStyle = color;
        ctx.fillText(lines[i], x, lineY);
    }

    return canvas;
}

/**
 * Composite a canvas onto a white background, removing any transparency.
 *
 * Useful before exporting to JPEG (which does not support alpha).
 * Returns a **new** HTMLCanvasElement with an opaque white background.
 *
 * @param {HTMLCanvasElement} canvas - Source canvas (may contain transparency)
 * @returns {HTMLCanvasElement} A new canvas with a white background and the original image composited on top
 */
export function flattenTransparency(canvas) {
    const out = document.createElement('canvas');
    out.width  = canvas.width;
    out.height = canvas.height;

    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);

    return out;
}

/**
 * Apply an ordered list of operations to an original HTMLImageElement.
 *
 * Non-destructive: starts from the original image each time, drawing it onto
 * a fresh canvas and then applying each operation in sequence.
 *
 * Supported operation types:
 * - `{ type: 'crop', x, y, width, height }`
 * - `{ type: 'resize', width, height }`
 * - `{ type: 'redact', regions: [{ x, y, w, h, mode }] }`
 * - `{ type: 'text', text, x, y, fontSize, fontFamily, color, align, bold, italic, outline }`
 *
 * @param {HTMLImageElement} image - The original image element
 * @param {Array<{ type: 'crop'|'resize'|'redact'|'text', [key: string]: any }>} operations - Ordered list of operations
 * @returns {HTMLCanvasElement} The resulting canvas after all operations
 */
export function renderOperations(image, operations) {
    // Start from a fresh canvas with the original image
    let canvas  = document.createElement('canvas');
    canvas.width  = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    for (const op of operations) {
        switch (op.type) {
            case 'crop':
                canvas = crop(canvas, { x: op.x, y: op.y, width: op.width, height: op.height });
                break;

            case 'resize':
                canvas = resize(canvas, { width: op.width, height: op.height });
                break;

            case 'redact':
                canvas = redact(canvas, { regions: op.regions });
                break;

            case 'text':
                canvas = addText(canvas, {
                    text       : op.text,
                    x          : op.x,
                    y          : op.y,
                    fontSize   : op.fontSize,
                    fontFamily : op.fontFamily,
                    color      : op.color,
                    align      : op.align,
                    bold       : op.bold,
                    italic     : op.italic,
                    outline    : op.outline,
                });
                break;

            default:
                throw new Error(`Unknown operation type: ${op.type}`);
        }
    }

    return canvas;
}

/**
 * Export a canvas to a Blob in the specified format and quality.
 *
 * Wraps `canvas.toBlob` in a Promise for ergonomic async usage.
 *
 * @param {HTMLCanvasElement} canvas - The canvas to export
 * @param {string} format - MIME type, e.g. 'image/png', 'image/jpeg', 'image/webp', 'image/avif'
 * @param {number} [quality=0.92] - Encoding quality from 0.0 to 1.0 (ignored for PNG)
 * @returns {Promise<Blob>} The encoded image as a Blob
 */
export function exportImage(canvas, format, quality = 0.92) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error(`Failed to export canvas as ${format}`));
                }
            },
            format,
            quality,
        );
    });
}
