/**
 * Infographic Generator — shared constants.
 * Templates, system prompts, and the localStorage key.
 *
 * @module constants
 * @version 0.1.25
 */

export const STORAGE_KEY = 'sg-infographic-simple-v1';

export const DEFAULT_SYSTEM_PROMPT = 'You are a professional infographic designer. Create a high-quality, publication-ready infographic image. Use a clean dark navy background (#0d1b2a), white headings, teal and blue-grey accents. Clear layout with visual groupings, icons, and data callouts. Render as a landscape image.';

export const DOCUMENT_SYSTEM_PROMPT = 'You are a professional infographic designer. The user has provided a document. Analyse its key content and create a high-quality, publication-ready infographic that visualises the most important information. Use a clean dark navy background (#0d1b2a), white headings, teal and blue-grey accents. Clear layout with visual groupings, icons, and data callouts. Render as a landscape image.';

/** Quick-start prompt templates for text mode. */
export const TEMPLATES = [
    { id: 'executive',    icon: '\u{1F4CA}', label: 'Executive Summary',
      prompt: 'Create an executive summary infographic with 3-5 key business metrics, a headline finding, and supporting data points. Use a clean, professional layout with clear hierarchy.' },
    { id: 'architecture', icon: '\u{1F3D7}', label: 'Architecture',
      prompt: 'Create a technical architecture diagram showing system components, their connections, and data flows. Use boxes and arrows with clear labels for each component and layer.' },
    { id: 'timeline',     icon: '\u{1F4C5}', label: 'Timeline',
      prompt: 'Create a horizontal timeline infographic showing key milestones in chronological order. Each milestone should have a date, title, and brief description.' },
    { id: 'comparison',   icon: '\u2696\uFE0F', label: 'Comparison',
      prompt: 'Create a side-by-side comparison infographic with 2-3 options. Show strengths, weaknesses, and best-use-case for each with clear visual rating indicators.' },
    { id: 'process',      icon: '\u{1F504}', label: 'Process Flow',
      prompt: 'Create a step-by-step process flow infographic with numbered steps, icons for each stage, and brief descriptions. Connect steps with arrows.' },
    { id: 'stats',        icon: '\u{1F4C8}', label: 'Stats Dashboard',
      prompt: 'Create a statistics dashboard infographic featuring key numbers, percentage breakdowns, a trend chart, and 3-4 highlight metrics in callout boxes.' },
    { id: 'mindmap',      icon: '\u{1F9E0}', label: 'Mind Map',
      prompt: 'Create a mind map infographic with a central concept and 5-6 main branches, each with 2-3 sub-topics. Use distinct colour-coding for each branch.' },
];

/** Document-mode focus templates — prepended to the user direction. */
export const DOC_TEMPLATES = [
    { id: 'keypoints',   icon: '\u{1F4CB}', label: 'Key Points',      direction: 'Extract and visualise the 5-7 most important points from this document.' },
    { id: 'datastats',   icon: '\u{1F4CA}', label: 'Data & Stats',    direction: 'Identify all data, statistics, and metrics in this document and create a data visualisation.' },
    { id: 'doctimeline', icon: '\u{1F4C5}', label: 'Timeline',        direction: 'Extract chronological events and milestones from this document and create a timeline.' },
    { id: 'execbrief',   icon: '\u{1F4DD}', label: 'Executive Brief', direction: 'Create a one-page executive summary infographic from this document.' },
    { id: 'processmap',  icon: '\u{1F504}', label: 'Process Map',     direction: 'Identify the process, workflow, or steps described in this document and visualise them.' },
    { id: 'compare',     icon: '\u2696\uFE0F', label: 'Compare',     direction: 'Identify comparison points in this document and visualise them side by side.' },
];
