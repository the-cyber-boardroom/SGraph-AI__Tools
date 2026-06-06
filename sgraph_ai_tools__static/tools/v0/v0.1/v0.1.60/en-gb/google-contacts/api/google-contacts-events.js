/**
 * Frozen event-name constants for the google-contacts tool.
 * All events are CustomEvents dispatched on window with at minimum
 * { instanceId } in detail.
 *
 * @module google-contacts/google-contacts-events
 */

export const GC_EVENTS = Object.freeze({
    AUTH_CONNECTED:    'gc:auth:connected',
    AUTH_SIGNED_IN:    'gc:auth:signed-in',
    AUTH_SIGNED_OUT:   'gc:auth:signed-out',
    AUTH_ERROR:        'gc:auth:error',
    CONTACTS_LOADING:  'gc:contacts:loading',
    CONTACTS_PAGE:     'gc:contacts:page',
    CONTACTS_LOADED:   'gc:contacts:loaded',
    CONTACTS_ERROR:    'gc:contacts:error',
    CONTACTS_CLEARED:  'gc:contacts:cleared',
    FILTER_CHANGED:    'gc:filter:changed',
    SELECTION_CHANGED: 'gc:selection:changed',
    EXPORT_COMPLETE:   'gc:export:complete',
});

export const GC_EVENT_NAMES = Object.freeze(Object.values(GC_EVENTS));
