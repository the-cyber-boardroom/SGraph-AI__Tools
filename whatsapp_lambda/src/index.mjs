/**
 * index.mjs
 * Lambda entry point. Transport only — all logic lives in handlers.mjs.
 * Handler string: `index.handler` (the zip has src/ contents at its root).
 *
 * Environment (plain Lambda env vars for the MVP; SSM/Secrets Manager is the
 * milestone-2 upgrade — see the plan doc):
 *   META_APP_SECRET       webhook signature verification   (required)
 *   META_VERIFY_TOKEN     subscription handshake            (required)
 *   META_ACCESS_TOKEN     sending                           (required)
 *   META_PHONE_NUMBER_ID  sending                           (required)
 *   PONG_TEXT             optional fixed reply (default: diagnostics)
 *
 * @module whatsapp_lambda/index
 */

import { handle, createSeenSet } from './handlers.mjs';
import { makeSender } from './send.mjs';

const config = {
    appSecret:     process.env.META_APP_SECRET,
    verifyToken:   process.env.META_VERIFY_TOKEN,
    accessToken:   process.env.META_ACCESS_TOKEN,
    phoneNumberId: process.env.META_PHONE_NUMBER_ID,
    pongText:      process.env.PONG_TEXT || null,
};

const missing = Object.entries({
    META_APP_SECRET:      config.appSecret,
    META_VERIFY_TOKEN:    config.verifyToken,
    META_ACCESS_TOKEN:    config.accessToken,
    META_PHONE_NUMBER_ID: config.phoneNumberId,
}).filter(([, v]) => !v).map(([k]) => k);

if (missing.length) {
    // Log once at cold start rather than failing: the handshake and /health
    // still work, which makes a half-configured deployment diagnosable.
    console.warn(JSON.stringify({ event: 'config-incomplete', missing }));
}

// Module scope: survives warm invocations.
const seen = createSeenSet(500);
const sendText = makeSender({ token: config.accessToken, phoneNumberId: config.phoneNumberId });
let cold = true;

/** Structured logs, one JSON object per line. Never message bodies. */
const log = (entry) => console.log(JSON.stringify({ t: new Date().toISOString(), ...entry }));

export async function handler(event) {
    const wasCold = cold;
    cold = false;
    try {
        const res = await handle(event, { config, sendText, seen, now: Date.now, cold: wasCold, log });
        return { statusCode: res.status, headers: res.headers, body: res.body };
    } catch (err) {
        // Never leak a stack to Meta; never 500 a valid webhook into a retry storm.
        log({ event: 'unhandled-error', error: err?.message });
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '{"ok":false}' };
    }
}
