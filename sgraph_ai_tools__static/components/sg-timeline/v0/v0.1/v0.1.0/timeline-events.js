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
    CLIP_UNDO_REQUESTED: 'sg-timeline:undo-requested',
    CLIP_REDO_REQUESTED: 'sg-timeline:redo-requested',
    PLAYHEAD_CHANGED: 'sg-timeline:playhead-changed',
});
