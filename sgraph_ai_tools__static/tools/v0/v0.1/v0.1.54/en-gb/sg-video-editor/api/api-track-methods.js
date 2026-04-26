/** api-track-methods.js — addTrack/removeTrack/moveClipToTrack/reorderTracks proxies. */

function badArg(msg) { return Object.assign(new Error(msg), { code: 'invalid-arg' }); }

/**
 * Build the four track-level API methods bound to a state container.
 * @param {{ state: object }} cfg
 * @returns {{ addTrack: Function, removeTrack: Function, moveClipToTrack: Function, reorderTracks: Function }}
 */
export function buildTrackMethods({ state }) {
    function addTrack(params = {}) {
        const { kind, name, insertAboveTrackId } = params;
        const r = state.addTrack({ kind, name, insertAboveTrackId });
        return { trackId: r.trackId };
    }

    function removeTrack(params = {}) {
        const { trackId } = params;
        if (!trackId) throw badArg('trackId required');
        const r = state.removeTrack({ trackId });
        return { trackId: r.trackId };
    }

    function moveClipToTrack(params = {}) {
        const { clipId, toTrackId, timelineStart, snap } = params;
        if (!clipId) throw badArg('clipId required');
        if (!toTrackId) throw badArg('toTrackId required');
        if (timelineStart != null && !Number.isFinite(timelineStart)) {
            throw badArg('timelineStart must be a finite number');
        }
        const r = state.moveClipToTrack({
            clipId, toTrackId,
            timelineStart: Number.isFinite(timelineStart) ? timelineStart : undefined,
            snap: !!snap,
        });
        return {
            clipId: r.clipId,
            fromTrackId: r.fromTrackId,
            toTrackId: r.toTrackId,
            timelineStart: r.timelineStart,
        };
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

    function setTrackLocked(params = {}) {
        const { trackId, locked } = params;
        if (!trackId) throw badArg('trackId required');
        if (typeof locked !== 'boolean') throw badArg('locked must be boolean');
        const r = state.setTrackLocked({ trackId, locked });
        return { trackId: r.trackId, locked: r.locked };
    }

    function renameTrack(params = {}) {
        const { trackId, name } = params;
        if (!trackId) throw badArg('trackId required');
        if (name != null && typeof name !== 'string') throw badArg('name must be a string');
        const r = state.renameTrack({ trackId, name: name == null ? '' : name });
        return { trackId: r.trackId, name: r.name };
    }

    return {
        addTrack, removeTrack, moveClipToTrack, reorderTracks,
        setTrackMuted, setTrackLocked, renameTrack,
    };
}
