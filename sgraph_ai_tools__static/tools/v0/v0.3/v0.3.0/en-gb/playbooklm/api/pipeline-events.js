/**
 * PlaybookLM — pipeline event name constants.
 *
 * All tool-local event names used within the PlaybookLM pipeline.
 * Import this instead of using raw strings.
 *
 * @module pipeline-events
 * @version 0.1.0
 */

/**
 * Frozen event constants for the PlaybookLM pipeline.
 * All events are dispatched on window.
 */
export const PLM_EVENTS = Object.freeze({
  /** Fired when sources are loaded into state. detail: { count } */
  SOURCES_LOADED:          'plm:sources-loaded',

  /** Fired when a source is removed. detail: { index } */
  SOURCE_REMOVED:          'plm:source-removed',

  /** Fired when presentation generation begins. detail: {} */
  PRESENTATION_STARTED:    'plm:presentation-started',

  /** Fired when presentation generation completes. detail: { text } */
  PRESENTATION_COMPLETE:   'plm:presentation-complete',

  /** Fired when presentation generation fails. detail: { error } */
  PRESENTATION_ERROR:      'plm:presentation-error',

  /** Fired when slide brief generation begins. detail: {} */
  BRIEFS_STARTED:          'plm:briefs-started',

  /** Fired when slide brief generation completes. detail: { count } */
  BRIEFS_COMPLETE:         'plm:briefs-complete',

  /** Fired when slide brief generation fails. detail: { error } */
  BRIEFS_ERROR:            'plm:briefs-error',

  /** Fired when a single slide generation begins. detail: { index } */
  SLIDE_STARTED:           'plm:slide-started',

  /** Fired when a single slide generation completes. detail: { index, imageSrc } */
  SLIDE_COMPLETE:          'plm:slide-complete',

  /** Fired when a single slide generation fails. detail: { index, error } */
  SLIDE_ERROR:             'plm:slide-error',

  /** Fired when all slide generations complete. detail: { count } */
  ALL_SLIDES_COMPLETE:     'plm:all-slides-complete',

  /** Fired when export begins. detail: { format } */
  EXPORT_STARTED:          'plm:export-started',

  /** Fired when export completes. detail: { format } */
  EXPORT_COMPLETE:         'plm:export-complete',

  /** Fired when export fails. detail: { error } */
  EXPORT_ERROR:            'plm:export-error',

  /** Fired when pipeline state changes (any field). detail: {} */
  STATE_CHANGED:           'plm:state-changed',

  /** Fired when pipeline is stopped/aborted. detail: {} */
  PIPELINE_STOPPED:        'plm:pipeline-stopped',
});
