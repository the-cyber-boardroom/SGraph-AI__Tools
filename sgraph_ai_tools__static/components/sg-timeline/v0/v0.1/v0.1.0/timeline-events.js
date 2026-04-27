// timeline-events.js — frozen event-name constants for sg-timeline (v0.1.0)

/** Event names emitted by <sg-timeline>. */
export const SGT_EVENTS = Object.freeze({
    CLIP_ADDED: 'sg-timeline:clip-added',
    CLIP_MOVED: 'sg-timeline:clip-moved',
    CLIP_TRIMMED: 'sg-timeline:clip-trimmed',
    CLIP_SELECTED: 'sg-timeline:clip-selected',
    CLIP_DELETED: 'sg-timeline:clip-deleted',
    CLIP_SPLIT_REQUESTED: 'sg-timeline:clip-split',
    CLIP_COLOR_REQUESTED: 'sg-timeline:clip-color-requested',
    CLIP_RENAMED: 'sg-timeline:clip-renamed',
    CLIP_UNDO_REQUESTED: 'sg-timeline:undo-requested',
    CLIP_REDO_REQUESTED: 'sg-timeline:redo-requested',
    PLAYHEAD_CHANGED: 'sg-timeline:playhead-changed',
    TRACK_ADD_REQUESTED: 'sg-timeline:track-add-requested',
    TRACK_REMOVE_REQUESTED: 'sg-timeline:track-remove-requested',
    TRACK_MUTE_REQUESTED: 'sg-timeline:track-mute-requested',
    TRACK_LOCK_REQUESTED: 'sg-timeline:track-lock-requested',
    TRACK_RENAMED: 'sg-timeline:track-renamed',
    TRACK_SELECTED: 'sg-timeline:track-selected',
    CLIP_TRACK_CHANGED: 'sg-timeline:clip-track-changed',
    EDITOR_MODE_REQUESTED: 'sg-timeline:editor-mode-requested',
    CLIP_COPIED: 'sg-timeline:clip-copied',
    CLIP_PASTE_REQUESTED: 'sg-timeline:clip-paste-requested',
});
