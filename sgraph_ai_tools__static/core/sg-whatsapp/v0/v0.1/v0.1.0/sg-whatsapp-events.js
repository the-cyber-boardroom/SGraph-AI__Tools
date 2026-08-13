/**
 * sg-whatsapp-events.js
 * Frozen event-name constants for WhatsApp tooling — the public contract
 * (embedders and SKILL files depend on names + detail shapes; do not change).
 * @module sg-whatsapp-events
 */

export const WA_EVENTS = Object.freeze({
    CONNECTED:      'wa:connected',        // { phoneNumberId, displayNumber? }
    DISCONNECTED:   'wa:disconnected',     // {}
    SYNC:           'wa:sync',             // { newMessages, cursor }
    MESSAGE_IN:     'wa:message:in',       // { conversationId, messageId, type }
    MESSAGE_OUT:    'wa:message:out',      // { conversationId, messageId }
    RECEIPT:        'wa:receipt',          // { messageId, status: 'sent'|'delivered'|'read'|'failed' }
    WINDOW_CHANGED: 'wa:window:changed',   // { conversationId, windowExpiresAt, open }
    TRANSCRIPT_COMPLETE: 'wa:transcript:complete', // { messageId, costUsd }
    DRAFT_READY:    'wa:draft:ready',      // { conversationId }
    ERROR:          'wa:error',            // { step, code, message }
});
