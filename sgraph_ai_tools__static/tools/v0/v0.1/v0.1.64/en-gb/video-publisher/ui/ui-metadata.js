/**
 * ui-metadata.js
 * Metadata tab — editable title/description/tags/privacy, one-click generate
 * from the transcript, guided regenerate ("shorter", "more emojis", …).
 * @module ui-metadata
 */

import { VP_EVENTS } from '../api/publisher-events.js';

export function initMetadataTab(container, state, api, emit) {
    if (!container) return;
    container.innerHTML = `
      <div class="vp-metadata">
        <div class="vp-row">
          <button id="vp-md-generate" class="vp-btn vp-btn--primary">✨ Generate from transcript</button>
          <span id="vp-md-cost" class="vp-muted"></span>
        </div>
        <div class="vp-row">
          <input id="vp-md-guidance" class="vp-input" type="text" placeholder="Guidance, e.g. “shorter, more emojis” (optional)">
          <button id="vp-md-regen" class="vp-btn">↺ Regenerate</button>
        </div>
        <div id="vp-md-status" class="vp-muted"></div>
        <label>Title <span id="vp-md-count" class="vp-muted">0/100</span>
          <input id="vp-md-title" class="vp-input" type="text" maxlength="100">
        </label>
        <label>Description
          <textarea id="vp-md-desc" class="vp-input" rows="10"></textarea>
        </label>
        <label>Tags (comma-separated)
          <input id="vp-md-tags" class="vp-input" type="text">
        </label>
        <label>Privacy
          <select id="vp-md-privacy" class="vp-input">
            <option value="unlisted" selected>Unlisted</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </label>
      </div>`;

    const $ = s => container.querySelector(s);
    const titleEl = $('#vp-md-title'), descEl = $('#vp-md-desc'), tagsEl = $('#vp-md-tags');
    const privacyEl = $('#vp-md-privacy'), statusEl = $('#vp-md-status'), countEl = $('#vp-md-count');

    function fill() {
        titleEl.value = state.metadata.title || '';
        descEl.value = state.metadata.description || '';
        tagsEl.value = (state.metadata.tags || []).join(', ');
        privacyEl.value = state.metadata.privacy || 'unlisted';
        countEl.textContent = `${titleEl.value.length}/100`;
    }

    function push() {
        api.setMetadata({
            title: titleEl.value, description: descEl.value,
            tags: tagsEl.value, privacy: privacyEl.value,
        });
        countEl.textContent = `${titleEl.value.length}/100`;
    }
    for (const el of [titleEl, descEl, tagsEl, privacyEl]) el.addEventListener('change', push);
    titleEl.addEventListener('input', () => { countEl.textContent = `${titleEl.value.length}/100`; });

    $('#vp-md-generate').addEventListener('click', () => api.generateMetadata().catch(() => {}));
    $('#vp-md-regen').addEventListener('click', () => {
        api.generateMetadata({ guidance: $('#vp-md-guidance').value.trim() || undefined }).catch(() => {});
    });

    window.addEventListener(VP_EVENTS.METADATA_START, () => { statusEl.textContent = 'Generating…'; });
    window.addEventListener(VP_EVENTS.METADATA_COMPLETE, e => {
        statusEl.textContent = '';
        $('#vp-md-cost').textContent = e.detail?.costUsd != null ? `$${e.detail.costUsd.toFixed(4)}` : '';
        fill();
    });
    window.addEventListener(VP_EVENTS.STEP_ERROR, e => {
        if (e.detail?.step === 'metadata') statusEl.textContent = `Failed: ${e.detail.message}`;
    });
    window.addEventListener(VP_EVENTS.JOB_LOADED, fill);
    window.addEventListener(VP_EVENTS.JOB_RESET, fill);
    fill();
}
