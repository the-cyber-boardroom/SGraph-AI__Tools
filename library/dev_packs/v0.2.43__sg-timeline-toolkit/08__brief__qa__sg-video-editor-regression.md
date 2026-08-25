# 08 — Brief: QA Regression Suite for sg-video-editor v0.1.55

**Pack:** `v0.22.17__pack__sg-toolkit-extraction`
**Brief revision:** rev 1 (Pass 3)
**Brief role:** the implementer task list for QA. Runs the formal Playwright regression suite against sg-video-editor v0.1.55 to confirm behaviour preservation against v0.1.54.
**Audience:** Sonnet QA implementer (Villager QA team). Does NOT need to be the same Sonnet who wrote brief 06; cross-team review is preferred.
**Lifetime:** archive after merge.
**Estimated effort:** 15–25 hours of Sonnet-time across 22 tasks.

> **Read first, in order:**
> 1. `README.md` — V.1–V.11
> 2. `04__verification__feature-checklist.md` — section §B is your tick-list (you OWN section §B)
> 3. `06__brief__explorer__sg-video-editor-refactor.md` — to understand what v0.1.55 changed
> 4. v0.1.54 source for reference behaviour
> 5. v0.1.55 source for the system-under-test
>
> **Briefs 05 and 07** are background reading; they don't drive your tasks.

---

# §0 — Pre-flight checklist

- [ ] You're on a branch named `claude/qa-video-editor-{session-id}`
- [ ] Brief 06 is merged; v0.1.55 exists
- [ ] You have access to v0.1.54 for behavioural reference
- [ ] You can name the 5 op categories
- [ ] You understand that "behaviour preservation" means **user-facing behaviour identical**, NOT "code identical"
- [ ] You have Playwright installed in the repo

If unclear, ASK. Per K.2.

---

# §1 — Section §B is the source of truth

Your work is to tick every item in doc 04 §B (B.1 through B.20). Each item has:
- A description of what's being tested
- A `How:` field saying `[playwright]` for E2E or `[unit]` for unit tests
- A `Where:` field with the spec file path
- A `Brief refs:` field pointing back to brief 06 task IDs

For each, you:
1. Author the spec file at the named path
2. Run it in CI (or locally if CI isn't ready)
3. If it passes: tick the item
4. If it fails: file a bug against brief 06 with the failing repro

Your tasks below are organised by §B item.

---

# §2 — Tasks

## T-1 — §B.1: project import / load round-trip

**What:** Author Playwright spec at `tools/v0/v0.1/v0.1.55/en-gb/sg-video-editor/playwright/spec.import-from-v054.js`.

**How:**
1. Setup: pre-seed `localStorage` with a known v0.1.54-saved project (committed as a fixture in `playwright/fixtures/v054-project.json`).
2. Open v0.1.55 in browser.
3. Open the project from the saves list.
4. Compare the rendered timeline to a screenshot fixture. Compare track names, item positions, item count, asset count.
5. Verify all assets load (no missing-blob badges).

**Done when:** §B.1 ticks. Spec passes deterministically (run 10x without flake).

**DO NOT:** Use sleep/timeout-based waits. Use Playwright's locator-based waits.

---

## T-2 — §B.2: drag item within track

**What:** Spec at `playwright/spec.drag-within-track.js`.

**How:**
1. Load fixture project with one track containing one item at `start: 0, end: 5`.
2. Drag the item rightward by 100 pixels.
3. Assert: item's new visual position is at the snapped value (e.g. start=1.5 if px/s=60 and snap=0.1).
4. Assert: a single `item-moved` op was recorded (op log inspection via test hook).
5. Assert: undo restores the original position.

**Done when:** §B.2 ticks.

---

## T-3 — §B.3: drag item across tracks

**What:** Spec at `playwright/spec.drag-cross-track.js`.

**How:**
1. Load fixture with 3 tracks; one item on Track 1.
2. Drag item from Track 1 to Track 3.
3. Assert: item visually appears on Track 3.
4. Assert: item-moved op has `fromTrackId !== toTrackId`.
5. Assert: undo returns item to Track 1.

**Done when:** §B.3 ticks.

---

## T-4 — §B.4: trim start handle

**What:** Spec at `playwright/spec.trim-start.js`.

**How:**
1. Load fixture; locate item with start=2, end=8.
2. Drag the start handle (small visual element on the item's left edge) rightward by 50px.
3. Assert: item's start updates; end is unchanged.
4. Assert: `item-trimmed` op with `payload.edge === 'start'`, `payload.fromStart`, `payload.toStart`.
5. Assert: undo restores start.

**Done when:** §B.4 ticks.

---

## T-5 — §B.5: trim end handle

**What:** Same shape as T-4, but for the end handle.

**Done when:** §B.5 ticks.

---

## T-6 — §B.6: split item at playhead

**What:** Spec at `playwright/spec.split-item.js`.

**How:**
1. Load fixture; select item with start=2, end=8.
2. Position playhead at 5 (drag scrubber).
3. Press 'S' (the Split keyboard shortcut).
4. Assert: original item gone; two new items at start=2, end=5 and start=5, end=8.
5. Assert: a single `item-split` op recorded with `payload.newItemIds`.
6. Assert: undo restores the un-split item.

**Done when:** §B.6 ticks.

---

## T-7 — §B.7: copy / paste item

**What:** Spec at `playwright/spec.copy-paste.js`.

**How:**
1. Load fixture; select item with start=2, end=4.
2. Press Cmd+C.
3. Move playhead to position 7.
4. Click on Track 2 (selected track).
5. Press Cmd+V.
6. Assert: new item on Track 2 with start=7, end=9 (preserved duration, new ID).
7. Assert: undo removes pasted item.

**Done when:** §B.7 ticks.

---

## T-8 — §B.8: asset upload (drop file)

**What:** Spec at `playwright/spec.asset-upload.js`.

**How:**
1. Load fixture (empty project).
2. Programmatically drop a small video file (MP4 fixture in `playwright/fixtures/test.mp4`, ~1MB) onto the asset panel.
3. Assert: asset row appears in panel.
4. Assert: blob persists in IDB (verify via test hook).
5. Assert: an `asset-add-requested` op recorded with `reversible: 'with-side-effects'`.
6. Assert: undo removes the asset row AND the blob from IDB.

**Done when:** §B.8 ticks.

---

## T-9 — §B.9: asset removal

**What:** Spec at `playwright/spec.asset-remove.js`.

**How:**
1. Load fixture with one asset.
2. Click × on the asset row.
3. Assert: asset row disappears.
4. Assert: blob removed from IDB.
5. Assert: undo restores asset row AND blob.

**Done when:** §B.9 ticks.

---

## T-10 — §B.10: asset drag onto track

**What:** Spec at `playwright/spec.asset-to-track.js`.

**How:**
1. Load fixture with one asset.
2. Drag asset row onto Track 2 at position 3.
3. Assert: new item on Track 2 at start=3 with payload's `assetId` matching the asset.
4. Assert: a `item-added` op recorded (from track-strip's drop handler).
5. Assert: undo removes the item.

**Done when:** §B.10 ticks.

---

## T-11 — §B.11: properties panel: select item

**What:** Spec at `playwright/spec.properties-show.js`.

**How:**
1. Load fixture with two items.
2. Click on item A.
3. Assert: properties panel shows sections (TRANSFORM, TIMING, VISUAL) with item A's values.
4. Click on item B.
5. Assert: panel updates to show item B's values.
6. Click on empty space.
7. Assert: panel clears.

**Done when:** §B.11 ticks.

---

## T-12 — §B.12: properties panel: edit field

**What:** Spec at `playwright/spec.properties-edit.js`.

**How:**
1. Load fixture; select item.
2. Change "X" field from 100 to 200 (focus, type, blur).
3. Assert: a `field-changed` op recorded with `payload.fromValue: 100, toValue: 200`.
4. Assert: item visually moves on the canvas (composer rebuilds).
5. Assert: undo restores X=100.

**Done when:** §B.12 ticks.

---

## T-13 — §B.13: properties panel: edit nested object field

**What:** Unit test at `components/sg-properties-panel/v0/v0.1/v0.1.0/test.spec.js` AND Playwright spec at `playwright/spec.properties-nested.js`.

**How:**
1. Unit: render a panel with a section that has a Field whose value is `{rotation: 0, scale: 1}`. Update via `setFieldValue`. Read back. Assert deep equality.
2. Playwright: in a real tool with a Transform Matrix field, edit the nested matrix. Save/load round-trip. Assert preserved.

**Done when:** §B.13 ticks.

---

## T-14 — §B.14: config panel replaces v0.1.54 implementation

**What:** Spec at `playwright/spec.config-tab.js`.

**How:**
1. Load v0.1.55. Open the right rail's Config tab.
2. Assert: section CONFIG with all the v0.1.54 checkboxes (Preview/Composer, Timeline renders, Autosave, Memory probe, Log composer rebuilds).
3. Toggle each checkbox. Assert: config persists to localStorage under `sgve:config`.
4. Reload the page. Assert: persisted values restored.
5. Click "Reset to defaults". Assert: all values back to defaults.
6. Test URL override: navigate with `?config.log-level=silent`. Assert: log-level reads as 'silent' for the session.

**Done when:** §B.14 ticks.

---

## T-15 — §B.15: playback (play / pause / scrub)

**What:** Spec at `playwright/spec.playback.js`.

**How:**
1. Load fixture with at least one video item.
2. Click Play. Assert: playhead moves; time-display updates.
3. Click Pause. Assert: playhead stops.
4. Drag scrubber to position 5. Assert: playhead jumps to 5; preview shows frame at 5.
5. Press Space. Assert: play/pause toggle.

**Done when:** §B.15 ticks.

---

## T-16 — §B.16: keyboard shortcuts

**What:** Spec at `playwright/spec.shortcuts.js`.

**How:** For each shortcut in v0.1.54's docs:
- Cmd+Z (undo), Cmd+Shift+Z (redo)
- Cmd+C (copy), Cmd+V (paste)
- S (split), Space (play/pause)
- Backspace/Delete (delete item)
- Cmd+drag (copy clip during drag)

Each test: setup state, fire keyboard event, assert expected result.

**Cross-platform note:** Run on Mac (Cmd → Meta) AND on Linux/Windows (Cmd → Ctrl). Use Playwright's `process.platform` detection.

**Done when:** §B.16 ticks.

---

## T-17 — §B.17: undo all the way back

**What:** Spec at `playwright/spec.undo-deep.js`.

**How:**
1. Load fixture (clean state).
2. Programmatically perform 30 mixed operations (drag, trim, split, delete, color change, asset add, etc.).
3. Capture project state hash after each op.
4. Press Cmd+Z 30 times.
5. Assert: state hash after each undo matches the captured hash from the corresponding earlier state.
6. Press Cmd+Shift+Z 30 times.
7. Assert: state hash after each redo matches.

**Done when:** §B.17 ticks.

**Note:** This test is the highest-value one for catching op-handler bugs. If T-17 passes, op handlers are correct.

---

## T-18 — §B.18: save round-trip

**What:** Spec at `playwright/spec.save-load-roundtrip.js`.

**How:**
1. Load fixture; make 10 operations.
2. Save (via toolbar save button or Cmd+S).
3. Reload page.
4. Open the saved project from the saves list.
5. Assert: state identical (item count, positions, assets, UI state — panel widths, zoom, selection).

**Done when:** §B.18 ticks.

---

## T-19 — §B.19: autosave-after-crash recovery

**What:** Spec at `playwright/spec.autosave-recovery.js`.

**How:**
1. Load fixture; make 5 operations (in 5 separate intervals so autosave fires).
2. Wait for autosave debounce (e.g. 5s after last mutation).
3. Force-close tab (or programmatically navigate away).
4. Re-open the page.
5. Assert: recovery dialog appears with autosave timestamp.
6. Click "Recover". Assert: all 5 operations restored.

**Done when:** §B.19 ticks.

---

## T-20 — §B.20: Round 9-K race fixes

**What:** Unit test at `core/sg-project-storage/v0/v0.1/v0.1.0/test.race-conditions.spec.js`.

**How:** Three sub-tests, one per race condition documented in doc 02 §6.6:

1. **filename-race:** simulate user renaming the project mid-autosave. Assert: autosave writes to original slug, not new one.
2. **beforeunload-after-clean-save:** simulate `beforeunload` firing after a clean manual save. Assert: autosave detects identical state, short-circuits.
3. **autosave-overwrites-newer-manual:** simulate autosave firing after a newer manual save. Assert: autosave detects newer save, refuses.

Use deterministic test harnesses (mock timers, mock localStorage, mock IDB) — these races are non-deterministic in production, but in tests they MUST be deterministic.

**Done when:** §B.20 ticks.

---

# §3 — Cross-cutting tasks

## T-21 — Run the full §B suite in CI

**What:** All 19 specs (T-1 through T-19) plus the unit test (T-20) run in CI on every PR.

**How:**
1. CI config (`.github/workflows/qa.yml` or wherever) runs `npx playwright test` and `npm run test:unit`.
2. Failures fail the PR.
3. Flake-check: each spec runs 3 times in CI; any non-deterministic failure flags.

**Done when:** CI green.

---

## T-22 — Generate the QA report

**What:** Markdown report summarising:
- Which §B items tick
- Which fail (with bug links)
- Which are flake-prone
- Performance numbers (test execution time per spec)

**How:** Generated by a script that parses Playwright JSON output.

**Done when:** Report exists at `tools/v0/v0.1/v0.1.55/en-gb/sg-video-editor/playwright/QA-REPORT.md`. Architect reviews. Sign-off.

**Checklist refs:** §H.2 (all §B items ticked → §H.2 ticks)

---

# §4 — Common QA drift patterns to avoid

1. **Sleep-based waits.** `await page.waitForTimeout(500)` is flaky. Use locator-based waits: `await locator.waitFor({state: 'visible'})`.
2. **Hardcoded coordinates.** Don't drag to `(100, 200)`. Find the element, calculate from its bounding box. Resolution-independent.
3. **Asserting visual identity by pixel.** Pixel-diff tests are brittle (anti-aliasing, font rendering). Use semantic asserts: "item is at position X" not "item screenshots match".
4. **Copying v0.1.54 specs.** v0.1.54's tests (if any) used the old event names and code paths. Write fresh specs against v0.1.55's API per V.2.
5. **Skipping the no-flake check.** Each spec must pass 10/10. If it passes 9/10, fix it; don't merge.
6. **Filing 'fix me' bugs without repros.** Each bug filing must have a deterministic repro and a screenshot/video.

---

# §5 — Definition of done for this brief

All 22 tasks ticked. All §B items in doc 04 ticked.

When done:
- Branch named `claude/qa-video-editor-{session-id}` is at a tagged commit
- All 19 Playwright specs at `tools/v0/v0.1/v0.1.55/en-gb/sg-video-editor/playwright/`
- Unit test for race conditions at `core/sg-project-storage/v0/v0.1/v0.1.0/test.race-conditions.spec.js`
- All specs pass 10/10 (no flake)
- CI green
- QA report generated and signed off by architect

End of brief 08. ~22 tasks. Estimated 15–25 hours of Sonnet-time.

---

# §6 — End of pack

This brief is the final piece of the v0.22.17 pack. When all four briefs (05, 06, 07, 08) merge:

- The toolkit (8 pieces) exists at v0.1.0 paths
- sg-video-editor v0.1.55 consumes the toolkit; v0.1.54 stays at its frozen path
- sg-audio-editor v0.1.0 exists, validating toolkit genericness
- The §B regression suite proves behaviour preservation
- All sections of doc 04 (§A–§H) tick

The pack release gate (doc 04 §H) is then signed off by the architect, and the pack closes.

Future packs (per doc 09) MAY revisit decisions parked here:
- Tree-undo / graph-based version control (doc 09 — needs separate pack)
- Vault-backed project export (vaults-future)
- Audio render pipeline (sg-audio-editor v0.1.1+)
- Animation editor as a separate tool (future pack)

End of pack v0.22.17.
