/**
 * ui-metadata.js
 * Metadata tab — editable title/description/tags/privacy, one-click generate
 * from the transcript, guided regenerate ("shorter", "more emojis", …).
 * @module ui-metadata
 */

import { VP_EVENTS } from '../api/publisher-events.js';
import { getStoredPrivacy } from '../api/publisher-pipeline.js';
import { METADATA_MODELS } from '../api/metadata-gen.js';

export function initMetadataTab(container, state, api, emit) {
    if (!container) return;
    container.innerHTML = `
      <div class="vp-metadata">
        <div class="vp-row">
          <button id="vp-md-generate" class="vp-btn vp-btn--primary">✨ Generate from transcript</button>
          <select id="vp-md-model" class="vp-input" title="Model used to write the title/description">
            ${METADATA_MODELS.map((m, i) => `<option value="${m.id}" ${i === 0 ? 'selected' : ''}>${m.label}</option>`).join('')}
          </select>
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
        <label class="vp-check">
          <input id="vp-md-remember" type="checkbox">
          Remember this privacy as my default (saved in this browser)
        </label>
      </div>`;

    const $ = s => container.querySelector(s);
    const titleEl = $('#vp-md-title'), descEl = $('#vp-md-desc'), tagsEl = $('#vp-md-tags');
    const privacyEl = $('#vp-md-privacy'), statusEl = $('#vp-md-status'), countEl = $('#vp-md-count');
    const rememberEl = $('#vp-md-remember');
    rememberEl.checked = !!getStoredPrivacy();

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

    // Remembered default: while checked, the current privacy choice persists
    // across sessions (localStorage); unchecking reverts to unlisted.
    privacyEl.addEventListener('change', () => {
        if (rememberEl.checked) api.setDefaultPrivacy({ privacy: privacyEl.value });
    });
    rememberEl.addEventListener('change', () => {
        api.setDefaultPrivacy({ privacy: rememberEl.checked ? privacyEl.value : null });
    });

    const modelEl = $('#vp-md-model');
    $('#vp-md-generate').addEventListener('click', () => {
        api.generateMetadata({ model: modelEl.value }).catch(() => {});
    });
    $('#vp-md-regen').addEventListener('click', () => {
        api.generateMetadata({
            model: modelEl.value,
            guidance: $('#vp-md-guidance').value.trim() || undefined,
        }).catch(() => {});
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
