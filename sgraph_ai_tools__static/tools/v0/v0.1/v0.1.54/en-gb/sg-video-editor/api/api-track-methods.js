/** api-track-methods.js — addTrack/removeTrack/moveClipToTrack/reorderTracks proxies. */

function badArg(msg) { return Object.assign(new Error(msg), { code: 'invalid-arg' }); }

/**
 * Build the four track-level API methods bound to a state container.
 * @param {{ state: object }} cfg
 * @returns {{ addTrack: Function, removeTrack: Function, moveClipToTrack: Function, reorderTracks: Function }}
 */
export function buildTrackMethods({ state }) {
    function addTrack(params = {}) {
        const { kind, name } = params;
        const r = state.addTrack({ kind, name });
        return { trackId: r.trackId };
    }

    function removeTrack(params = {}) {
        const { trackId } = params;
        if (!trackId) throw badArg('trackId required');
        const r = state.removeTrack({ trackId });
        return { trackId: r.trackId };
    }

    function moveClipToTrack(params = {}) {
        const { clipId, toTrackId } = params;
        if (!clipId) throw badArg('clipId required');
        if (!toTrackId) throw badArg('toTrackId required');
        const r = state.moveClipToTrack({ clipId, toTrackId });
        return { clipId: r.clipId, fromTrackId: r.fromTrackId, toTrackId: r.toTrackId };
    }

    function reorderTracks(params = {}) {
        const { trackIds } = params;
        if (!Array.isArray(trackIds)) throw badArg('trackIds must be an array');
        const r = state.reorderTracks({ trackIds });
        return { trackIds: r.trackIds };
    }

    function setTrackMuted(params = {}) {
        const { trackId, muted } = params;
        if (!trackId) throw badArg('trackId required');
        if (typeof muted !== 'boolean') throw badArg('muted must be boolean');
        const r = state.setTrackMuted({ trackId, muted });
        return { trackId: r.trackId, muted: r.muted };
    }

    return { addTrack, removeTrack, moveClipToTrack, reorderTracks, setTrackMuted };
}
