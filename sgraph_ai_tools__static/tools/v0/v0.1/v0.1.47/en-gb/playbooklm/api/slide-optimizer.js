/**
 * PlaybookLM — Slide image compression utility.
 *
 * Pure function. Takes a PNG data URL (from the LLM), returns three
 * compressed variants using the Canvas API. No WASM, no external libraries.
 * Runs at generation time — immediately after the LLM returns the image.
 *
 * Compression numbers (15 Apr 2026 compression briefing):
 *   PNG infographic slide avg:  ~850 KB
 *   JPEG at q82, 1200px avg:    ~113 KB  (87% reduction)
 *   JPEG at q70, 800px avg:      ~50 KB  (94% reduction)
 *   107-slide PDF (PNG):        116 MB
 *   107-slide PDF (JPEG q82):  14.8 MB
 *
 * @module slide-optimizer
 * @version 0.1.0
 */

/**
 * @typedef {{ png: number, dist: number, li: number }} SlideOptSizes
 * @typedef {{ png: string, dist: Blob, li: Blob, sizes: SlideOptSizes }} SlideOptResult
 */

/**
 * Scale dimensions proportionally so width <= maxWidth.
 *
 * @param {number} origW
 * @param {number} origH
 * @param {number} maxWidth
 * @returns {{ w: number, h: number }}
 */
function _scale(origW, origH, maxWidth) {
  if (origW <= maxWidth) return { w: origW, h: origH };
  const ratio = maxWidth / origW;
  return { w: Math.round(origW * ratio), h: Math.round(origH * ratio) };
}

/**
 * Draw an image onto a canvas and encode as JPEG Blob.
 *
 * @param {HTMLImageElement} img
 * @param {number} maxWidth
 * @param {number} quality  0.0–1.0
 * @returns {Promise<Blob>}
 */
function _encodeJpeg(img, maxWidth, quality) {
  const { w, h } = _scale(img.naturalWidth, img.naturalHeight, maxWidth);
  const canvas   = document.createElement('canvas');
  canvas.width   = w;
  canvas.height  = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Canvas.toBlob returned null'))),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Compress a slide image into three variants.
 *
 * Returns the original PNG data URL for in-memory display (no re-encoding
 * required), plus two JPEG Blobs for vault upload and social sharing.
 *
 * @param {string} imageSrc - PNG data URL returned by the image LLM
 * @returns {Promise<SlideOptResult>}
 */
export async function optimizeSlide(imageSrc) {
  const img = await new Promise((resolve, reject) => {
    const el   = new Image();
    el.onload  = () => resolve(el);
    el.onerror = () => reject(new Error('optimizeSlide: failed to load image'));
    el.src     = imageSrc;
  });

  const [distBlob, liBlob] = await Promise.all([
    _encodeJpeg(img, 1200, 0.82),
    _encodeJpeg(img, 800,  0.70),
  ]);

  // Estimate PNG byte size from data URL (base64 overhead ≈ 4/3)
  const pngSize = Math.round((imageSrc.length - imageSrc.indexOf(',') - 1) * 0.75);

  return {
    png:   imageSrc,
    dist:  distBlob,
    li:    liBlob,
    sizes: { png: pngSize, dist: distBlob.size, li: liBlob.size },
  };
}
