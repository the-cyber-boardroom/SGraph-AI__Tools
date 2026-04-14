/**
 * PlaybookLM — Deck view panel.
 *
 * Filmstrip / grid preview of all generated slides in order.
 * Reactive: updates whenever pipeline state changes.
 * Clicking a slide thumbnail activates its workspace tab in the outer layout.
 *
 * @module ui-deck-view
 * @version 0.1.0
 */

/**
 * Build the deck view panel.
 *
 * @param {HTMLElement} container
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @param {object} outerLayout - sg-layout instance (used to activateTab)
 * @param {() => Map<number, string>} getTabMap - returns slide index → tabId map
 * @returns {void}
 */
export function buildDeckViewPanel(container, state, outerLayout, getTabMap) {
  container.style.cssText =
    'height:100%;background:#080812;overflow:hidden;display:flex;flex-direction:column;font-family:system-ui,sans-serif;';

  // ── Header bar ─────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #1e2035;flex-shrink:0;';

  const title = document.createElement('span');
  title.style.cssText = 'font-size:12px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:0.08em;';
  title.textContent = 'Slide Deck Preview';

  const statsEl = document.createElement('span');
  statsEl.style.cssText = 'font-size:11px;color:#4a5568;';

  header.appendChild(title);
  header.appendChild(statsEl);
  container.appendChild(header);

  // ── Scroll area ────────────────────────────────────────────────────────────
  const scrollArea = document.createElement('div');
  scrollArea.style.cssText = 'flex:1;overflow-y:auto;padding:16px;box-sizing:border-box;';
  container.appendChild(scrollArea);

  function _render() {
    const briefs  = state.getSlideBriefs();
    const results = state.getSlideResults();
    const tabMap  = getTabMap();

    const completed = results.filter(r => r.status === 'complete' && r.imageSrc).length;
    statsEl.textContent = `${completed} / ${briefs.length} slides generated`;

    scrollArea.innerHTML = '';

    if (!briefs.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;color:#334155;font-size:12px;padding:60px 0;';
      empty.textContent = 'No slide briefs yet. Complete Steps 1–3 first.';
      scrollArea.appendChild(empty);
      return;
    }

    // Grid layout — wrapping cards
    const grid = document.createElement('div');
    grid.style.cssText =
      'display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;';
    scrollArea.appendChild(grid);

    briefs.forEach((brief, i) => {
      const res     = results.find(r => r.index === i);
      const versions = state.getSlideVersions(i);
      const selIdx   = state.getSelectedVersion(i);
      const ver      = versions[selIdx] ?? null;

      const card = document.createElement('div');
      card.style.cssText =
        'background:#0d0d1a;border:1px solid #1e2035;border-radius:6px;overflow:hidden;display:flex;flex-direction:column;cursor:pointer;transition:border-color 0.15s;';

      card.addEventListener('mouseenter', () => { card.style.borderColor = '#4ECDC4'; });
      card.addEventListener('mouseleave', () => { card.style.borderColor = '#1e2035'; });

      // Click → activate tab
      card.addEventListener('click', () => {
        const tabId = tabMap.get(i);
        if (tabId) outerLayout.activateTab?.(tabId);
      });

      // ── Thumbnail area ─────────────────────────────────────────────────────
      const thumb = document.createElement('div');
      thumb.style.cssText =
        'position:relative;width:100%;aspect-ratio:16/9;background:#080812;overflow:hidden;';

      if (ver?.imageSrc) {
        const img = document.createElement('img');
        img.src = ver.imageSrc;
        img.alt = brief.title;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        thumb.appendChild(img);
      } else if (res?.status === 'generating') {
        const spinner = document.createElement('div');
        spinner.style.cssText =
          'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';
        spinner.innerHTML = '<div class="plm-spinner"></div>';
        thumb.appendChild(spinner);
      } else {
        const placeholder = document.createElement('div');
        placeholder.style.cssText =
          'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#1e2035;font-size:28px;';
        placeholder.textContent = String(i + 1);
        thumb.appendChild(placeholder);
      }

      // Slide number badge
      const badge = document.createElement('div');
      badge.style.cssText =
        'position:absolute;top:6px;left:6px;background:rgba(0,0,0,0.7);color:#a0aec0;font-size:10px;font-weight:700;padding:2px 7px;border-radius:3px;';
      badge.textContent = String(i + 1);
      thumb.appendChild(badge);

      // Version badge (if multiple versions)
      if (versions.length > 1) {
        const vBadge = document.createElement('div');
        vBadge.style.cssText =
          'position:absolute;top:6px;right:6px;background:rgba(78,205,196,0.2);color:#4ECDC4;border:1px solid #4ECDC4;font-size:10px;font-weight:700;padding:2px 7px;border-radius:3px;';
        vBadge.textContent = `v${selIdx + 1}/${versions.length}`;
        thumb.appendChild(vBadge);
      }

      card.appendChild(thumb);

      // ── Caption ────────────────────────────────────────────────────────────
      const caption = document.createElement('div');
      caption.style.cssText = 'padding:8px 10px;flex:1;';

      const titleEl = document.createElement('div');
      titleEl.style.cssText =
        'font-size:11px;font-weight:600;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      titleEl.textContent = brief.title;
      caption.appendChild(titleEl);

      if (ver) {
        const meta = document.createElement('div');
        meta.style.cssText = 'font-size:10px;color:#4a5568;margin-top:3px;display:flex;gap:8px;';
        meta.innerHTML = `
          <span style="color:#f6c90e;">$${(ver.cost || 0).toFixed(5)}</span>
          <span>${ver.latencyMs ? (ver.latencyMs / 1000).toFixed(1) + 's' : ''}</span>
        `;
        caption.appendChild(meta);
      } else {
        const statusEl = document.createElement('div');
        statusEl.style.cssText = 'font-size:10px;margin-top:3px;';
        const statusColors = { generating: '#4ECDC4', error: '#fc8181', pending: '#4a5568' };
        const label = res?.status ?? 'pending';
        statusEl.style.color = statusColors[label] || '#4a5568';
        statusEl.textContent = label.charAt(0).toUpperCase() + label.slice(1);
        caption.appendChild(statusEl);
      }

      card.appendChild(caption);
      grid.appendChild(card);
    });
  }

  state.onChange(_render);
  _render();
}
