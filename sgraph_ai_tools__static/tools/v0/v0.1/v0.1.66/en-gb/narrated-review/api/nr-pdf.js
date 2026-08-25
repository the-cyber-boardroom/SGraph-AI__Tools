/**
 * nr-pdf.js
 * The artefact as a PDF: the same ordered image-and-words document, laid out for
 * a human reader (markdown is for the model; a PDF is for the person you are
 * sending it to).
 *
 * jsPDF is lazy-loaded from a pinned CDN as a UMD global — the established repo
 * pattern for heavy optional libraries (see core/sg-zip / audio-zip's loadJSZip).
 *
 * @module nr-pdf
 */

import { state } from './nr-state.js';
import { fmtTime } from './nr-document.js';

const JSPDF_CDN_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
let _load = null;

/** Lazy-load jsPDF (publishes globalThis.jspdf). */
export function loadJsPdf() {
    if (typeof globalThis !== 'undefined' && globalThis.jspdf) return Promise.resolve();
    if (_load) return _load;
    _load = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${JSPDF_CDN_URL}"]`);
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('Failed to load jsPDF')), { once: true });
            return;
        }
        const tag = document.createElement('script');
        tag.src = JSPDF_CDN_URL;
        tag.onload = () => resolve();
        tag.onerror = () => reject(new Error('Failed to load jsPDF'));
        document.head.appendChild(tag);
    });
    return _load;
}

/** Read a Blob into a data URL + natural size. */
function loadImage(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const im = new Image();
        im.onload = () => {
            const c = document.createElement('canvas');
            c.width = im.naturalWidth; c.height = im.naturalHeight;
            c.getContext('2d').drawImage(im, 0, 0);
            URL.revokeObjectURL(url);
            resolve({ dataUrl: c.toDataURL('image/jpeg', 0.82), w: im.naturalWidth, h: im.naturalHeight });
        };
        im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
        im.src = url;
    });
}

/**
 * Build the PDF.
 * @param {{ includeRaw?: boolean, jsPDF?: Function }} [opts]
 * @returns {Promise<{ blob: Blob, name: string, pages: number }>}
 */
export async function buildPdf(opts = {}) {
    let JsPDF = opts.jsPDF;
    if (!JsPDF) {
        await loadJsPdf();
        JsPDF = globalThis.jspdf && globalThis.jspdf.jsPDF;
    }
    if (!JsPDF) throw Object.assign(new Error('jsPDF not available'), { code: 'pdf-unavailable' });

    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    const PW = 210, PH = 297, M = 16, W = PW - M * 2;
    let y = M;

    const nl = (h) => { if (y + h > PH - M) { doc.addPage(); y = M; } };
    const text = (str, size, style, colour, gap = 4) => {
        doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...colour);
        const lines = doc.splitTextToSize(String(str), W);
        for (const l of lines) { nl(size * 0.45); doc.text(l, M, y); y += size * 0.45; }
        y += gap;
    };

    text(`Narrated review — ${state.sessionId || 'session'}`, 20, 'bold', [18, 32, 58], 2);
    const meta = `${state.pairs.length} moment${state.pairs.length === 1 ? '' : 's'}` +
        (state.durationMs ? ` · ${fmtTime(state.durationMs)}` : '') + ' · narrated-review (tools.sgraph.ai)';
    text(meta, 9, 'italic', [90, 107, 133], 5);
    if (state.rollingSummary) text(state.rollingSummary, 10, 'normal', [18, 32, 58], 7);

    for (const p of [...state.pairs].sort((a, b) => a.seq - b.seq)) {
        // Decode first so the heading, image, words and note can be kept
        // together — a note orphaned onto the next page reads as unrelated.
        let im = null, imH = 0, imW = 0;
        if (p.screenshot) {
            try {
                im = await loadImage(p.screenshot);
                imH = Math.min((W * im.h) / im.w, 105);
                imW = (imH * im.w) / im.h;
            } catch (_) { im = null; }   // skip an unreadable image, don't fail the export
        }
        const bodyText = (p.clean && p.clean.text) || (p.raw && p.raw.text) || '';
        const estimate = 8 + imH + (bodyText ? Math.ceil(bodyText.length / 95) * 5 + 6 : 0) +
                         (p.notes ? Math.ceil(p.notes.length / 100) * 4.5 + 5 : 0);
        if (y + Math.min(estimate, PH - M * 2) > PH - M) { doc.addPage(); y = M; }

        text(p.tPress == null ? `${p.seq + 1}. Added` : `${p.seq + 1}. At ${fmtTime(p.tPress)}`,
             13, 'bold', [13, 125, 117], 3);

        if (im) {
            nl(imH + 3);
            doc.addImage(im.dataUrl, 'JPEG', M, y, imW, imH);
            doc.setDrawColor(215, 223, 234); doc.rect(M, y, imW, imH);
            y += imH + 5;
        }

        const body = bodyText;
        if (body) text(body, 10.5, 'normal', [18, 32, 58], 3);
        for (const m of (p.clean && p.clean.marks) || []) {
            text(`unsure: "${m.span}" — ${m.note || 'flagged'}`, 8.5, 'italic', [160, 90, 20], 2);
        }
        if (p.notes) text(`Note: ${p.notes}`, 9.5, 'italic', [90, 107, 133], 3);
        y += 3;
    }

    if (opts.includeRaw !== false) {
        const withRaw = state.pairs.filter(p => p.raw && p.clean);
        if (withRaw.length) {
            doc.addPage(); y = M;
            text('Appendix — raw transcripts', 14, 'bold', [13, 125, 117], 2);
            text('Unedited recogniser output (the source; the sections above are derived).',
                 9, 'italic', [90, 107, 133], 5);
            for (const p of withRaw) {
                text(`Moment ${p.seq + 1}`, 10.5, 'bold', [18, 32, 58], 2);
                text(p.raw.text, 9.5, 'normal', [70, 85, 110], 4);
            }
        }
    }

    const blob = doc.output('blob');
    return { blob, name: `narrated-review-${state.sessionId || 'session'}.pdf`, pages: doc.getNumberOfPages() };
}
