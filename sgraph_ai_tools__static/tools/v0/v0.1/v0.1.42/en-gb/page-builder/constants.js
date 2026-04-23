/**
 * Page Builder — theme schemes, component palette, demo JSON.
 *
 * Theme schemes mirror the named presets in send-browse-v031--page-layout.js.
 *
 * NOTE: The renderer uses "components" (not "blocks") for the top-level array,
 * and "children" (not "blocks") for nested items inside section/columns.
 *
 * @module constants
 * @version 0.1.42
 */

/** @type {Record<string, {mode:string, accent:string, font:string, background:string}>} */
const THEME_SCHEMES = {
    'default':   { mode: 'light', accent: '#4ecdc4', font: 'sans',  background: '#ffffff' },
    'navy':      { mode: 'light', accent: '#1a8fe0', font: 'sans',  background: '#f7f9fc' },
    'slate':     { mode: 'light', accent: '#a0522d', font: 'serif', background: '#faf9f7' },
    'minimal':   { mode: 'light', accent: '#111111', font: 'serif', background: '#ffffff' },
    'brand':     { mode: 'light', accent: '#4ecdc4', font: 'sans',  background: '#f6fefe' },
    'dark-deck': { mode: 'dark',  accent: '#7b9ef5', font: 'sans',  background: '#141820' },
};

/**
 * One default component per type for the palette insert.
 * Top-level array field is "components"; nested items inside section/columns use "children".
 * "navigation" is special — it inserts into page.navigation, not page.components.
 */
const PALETTE_BLOCKS = [
    { id: 'hero',          block: { type: 'hero',  title: 'Page Title', subtitle: 'A subtitle for your page.' } },
    { id: 'section',       block: { type: 'section', title: 'Section Title', children: [{ type: 'text', content: 'Section content here.' }] } },
    { id: 'text',          block: { type: 'text',  content: 'Add your text content here.' } },
    { id: 'markdown',      block: { type: 'markdown', content: '**Bold**, *italic*, and `code` text.' } },
    { id: 'title',         block: { type: 'title', content: 'Heading', level: 2 } },
    { id: 'bullet-points', block: { type: 'bullet-points', items: ['First point', 'Second point', 'Third point'] } },
    { id: 'callout',       block: { type: 'callout', style: 'info', title: 'Note', text: 'A callout message here.' } },
    { id: 'stats',         block: { type: 'stats', items: [{ value: '42', label: 'Metric A' }, { value: '99%', label: 'Metric B' }, { value: '3.2×', label: 'Metric C' }] } },
    { id: 'quote',         block: { type: 'quote', text: 'A memorable quote.', author: 'Author Name', role: 'Title' } },
    { id: 'author',        block: { type: 'author', name: 'Author Name', role: 'Role or date' } },
    { id: 'cards',         block: { type: 'cards', cols: 3, items: [{ title: 'Card One', desc: 'Description.' }, { title: 'Card Two', desc: 'Description.' }, { title: 'Card Three', desc: 'Description.' }] } },
    { id: 'columns',       block: { type: 'columns', ratio: '1:1', gap: 'medium', children: [{ type: 'text', content: 'Left column.' }, { type: 'text', content: 'Right column.' }] } },
    { id: 'image',         block: { type: 'image', src: 'https://placehold.co/800x400', alt: 'Image description' } },
    { id: 'pdf',           block: { type: 'pdf', src: 'https://example.com/document.pdf', label: 'View PDF' } },
    // navigation inserts into page.navigation, handled specially in _insertBlock
    { id: 'navigation',    nav: true, item: { label: 'Section', anchor: '#section-title' } },
];

/** Demo JSON — loads on first open and when "Load Demo" is clicked. */
const DEMO_JSON = {
    title: 'Page Builder Demo',
    theme: { mode: 'light', accent: '#4ecdc4', font: 'sans', background: '#ffffff' },
    components: [
        {
            type: 'hero',
            title: 'SG/Send Theme Explorer',
            subtitle: 'Build and preview _page.json layouts — then drop them into any vault.',
        },
        {
            type: 'section',
            title: 'Getting Started',
            children: [
                {
                    type: 'text',
                    content: 'Edit the JSON on the left to update this preview instantly. Use the theme picker to switch colour schemes, or click a palette chip below to insert a new block.',
                },
                {
                    type: 'bullet-points',
                    items: [
                        'Switch themes using the dropdown or swatch row — 6 named schemes',
                        'Click palette chips to insert a component at the end',
                        'Use viewport buttons to preview at phone / tablet / desktop width',
                        'Copy the final JSON and paste it into a vault _page.json',
                    ],
                },
            ],
        },
        {
            type: 'section',
            title: 'Key Numbers',
            children: [
                {
                    type: 'stats',
                    items: [
                        { value: '6',     label: 'Theme schemes' },
                        { value: '15',    label: 'Component types' },
                        { value: '200ms', label: 'Render delay' },
                    ],
                },
            ],
        },
        {
            type: 'section',
            title: 'Callout + Quote',
            children: [
                {
                    type: 'callout',
                    style: 'info',
                    title: 'Try the theme picker',
                    text: 'Select "dark-deck" to switch to the dark theme, or "slate" for a warm serif look.',
                },
                {
                    type: 'quote',
                    text: 'The best way to design a page is to see it rendered before sharing.',
                    author: 'SGraph Team',
                },
            ],
        },
        {
            type: 'author',
            name: 'SGraph Librarian',
            role: 'Demo document — 13 April 2026',
        },
    ],
};

export { THEME_SCHEMES, PALETTE_BLOCKS, DEMO_JSON };
