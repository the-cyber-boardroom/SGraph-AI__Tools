/** api-probe.js — hidden-element probes for video / image File metadata. */

/** Probe a video File for duration/dimensions via a hidden <video> element.
 *  @param {Blob|File} file
 *  @returns {Promise<{duration:number,width:number,height:number}>} */
export async function probeVideoFile(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        const cleanup = () => { URL.revokeObjectURL(url); v.src = ''; };
        v.addEventListener('loadedmetadata', () => {
            const out = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
            cleanup(); resolve(out);
        }, { once: true });
        v.addEventListener('error', () => {
            cleanup(); reject(new Error('failed to load video metadata'));
        }, { once: true });
        v.src = url;
    });
}

/** Probe an image File for naturalWidth/naturalHeight via a hidden <img>.
 *  @param {Blob|File} file
 *  @returns {Promise<{width:number,height:number}>} */
export async function probeImageFile(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        const cleanup = () => { try { URL.revokeObjectURL(url); } catch (_) {} };
        img.onload = () => {
            const out = { width: img.naturalWidth, height: img.naturalHeight };
            cleanup(); resolve(out);
        };
        img.onerror = () => { cleanup(); reject(new Error('failed to load image metadata')); };
        img.src = url;
    });
}
