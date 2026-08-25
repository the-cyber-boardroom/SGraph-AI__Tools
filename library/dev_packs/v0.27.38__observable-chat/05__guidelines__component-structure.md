# Component Coding Standards — v0.27.38

Extracted from Dinis Cruz's code review of `aw-tool-tester`. These standards apply to all new and refactored components in this codebase.

---

## 1. One component = one folder

Each component must live in its own folder. The folder holds all related files:

```
ui/
  aw-tool-tester/
    aw-tool-tester.js      # component class
    aw-tool-tester.css     # styles (separate file)
    aw-tool-tester.html    # template (separate file, if complex)
    .issues/
      bugs.md
      questions.md
```

Rationale: files are CDN-served; co-locating CSS and HTML makes them individually cacheable and independently replaceable.

## 2. Separate CSS and HTML into their own files

Do NOT inline CSS as a template literal inside the JS file. Do NOT hardcode HTML strings inside `connectedCallback`. Instead:

- CSS → `<component-name>.css` — imported or fetched by the component
- HTML → `<component-name>.html` — fetched or imported as a template
- Use the base class utilities (see §5) to load them cleanly

Exception: very short (< 5 lines) inline styles for dynamic values that cannot live in static CSS.

## 3. Shared CSS for consistency

Prefer importing shared CSS from the tools repo instead of re-defining common rules:
- `/components/tokens/v1/v1.0/v1.0.0/sg-tokens.css` — design tokens
- Common patterns (buttons, panels, scrollbars) should be extracted into a shared component stylesheet

This enables consistent theming across all tools.

## 4. Class naming convention

Use `Snake_Pascal` for class names: `Aw_Tool_Tester`, `Sg_Local_Bridge`, `Aw_Chat_Pane`.

Not: `AwToolTester`, `SgLocalBridge`, `AwChatPane`.

## 5. Use the base class

All components should extend `SgComponent` from:

```
sgraph_ai_tools__static/components/base/v1/v1.0/v1.0.0/sg-component.js
```

The base class provides:
- CSS file loading
- HTML template loading
- Shadow DOM setup helpers
- i18n string registration

## 6. `connectedCallback` must be minimal

`connectedCallback` (and other lifecycle methods) should contain almost no logic — only method calls whose names describe what they do:

```js
// GOOD
connectedCallback() {
    if (this._init) return;
    this._init = true;
    this._setupShadowDom();
    this._bindEvents();
    this._loadTools();
}

// BAD
connectedCallback() {
    if (this._init) return;
    this._init = true;
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `<style>...</style><div>...</div>`;
    this.shadowRoot.querySelector('.tt-reload').addEventListener('click', () => this._load());
    const bus = this._bus();
    bus.addEventListener('sg-local-bridge:status', () => setTimeout(() => this._load(), 300), { once: true });
    this._load();
}
```

The goal: reading the method calls in `connectedCallback` gives you a complete mental model of what the component does without reading the implementations.

## 7. All UI strings must be i18n variables

Every user-visible string must be defined as a `const` (even if hardcoded to English for now):

```js
// GOOD
const LABELS = {
    title:  'Tool Tester',
    reload: '↺ Reload',
    run:    '▶ Run',
    result: 'Result',
    empty:  'No tools found. Connect the bridge first.',
};

// BAD
this.shadowRoot.innerHTML = `<span class="tt-title">Tool Tester</span>
    <button class="tt-reload">↺ Reload</button>`;
```

This prepares the codebase for localisation without a rewrite.

## 8. Utility helper classes

Avoid long one-liner utility chains inline. Create explicit utility helpers:

```js
// GOOD — intent is clear
_on(selector, event, handler) {
    this.shadowRoot.querySelector(selector)?.addEventListener(event, handler);
}

// USAGE
this._on('.tt-reload', 'click', () => this._load());

// BAD — intent buried in syntax
this.shadowRoot.querySelector('.tt-reload').addEventListener('click', () => this._load());
```

Standard helpers to create (candidate for base class):
- `_on(selector, event, fn)` — scoped event binding in shadow DOM
- `_el(selector)` — scoped `querySelector` in shadow DOM
- `_esc(s)` — HTML entity escaping

## 9. Bus finding via `closest()`

Use `this.closest('[data-llm-bus]')` instead of walking `parentElement` manually:

```js
// GOOD
_bus() { return this.closest('[data-llm-bus]') ?? document; }

// BAD
_bus() {
    let el = this.parentElement;
    while (el) { if (el.hasAttribute('data-llm-bus')) return el; el = el.parentElement; }
    return this.parentElement || document;
}
```

## 10. Explicit over clever

Avoid compressing logic into a single line for the sake of brevity. Explicit is always preferred:

```js
// BAD
bus.addEventListener('sg-local-bridge:status', () => setTimeout(() => this._load(), 300), { once: true });

// GOOD
bus.addEventListener('sg-local-bridge:status', () => this._onBridgeReady(), { once: true });

_onBridgeReady() {
    setTimeout(() => this._load(), 300);
}
```

---

## Action items for dev / architect

- [ ] Create `components/base/v1/v1.0/v1.0.0/sg-component.js` base class with the above utilities
- [ ] Extract shared CSS for common panel patterns (toolbar, scrollable body, empty state)
- [ ] Refactor `aw-tool-tester` to use folder structure + separate CSS/HTML files
- [ ] Apply these standards to all new `aw-*` components going forward
- [ ] Set up i18n variable pattern in the base class
