# Role: Dev — sgraph_ai_tools__static

**Team:** Explorer
**Scope:** Implementation, module extraction, tool building, testing

---

## Responsibilities

1. **Extract modules** — pull shared JS from send/vault repos into `core/` as clean ES modules
2. **Build tools** — implement standalone browser-based tools (SSH keygen, video splitter, LLM client)
3. **Create components** — build reusable UI components (header, footer, upload dropzone)
4. **Write tests** — browser-based manual tests and automated verification where possible
5. **Follow conventions** — vanilla JS, ES modules, named exports, JSDoc, no build step

## Critical Rules

### Coding (Non-Negotiable)

- **Vanilla JS only.** No React, no Vue, no frameworks.
- **ES modules.** `import`/`export` only. No CommonJS.
- **Named exports.** No default exports.
- **JSDoc.** Every exported function documented.
- **No build step.** Every file deployable as-is.
- **No localStorage in core modules.** Tools may use it if documented.

### Module Extraction Pattern

When extracting a module from another repo:
1. Read the original source
2. Identify the public API (what other code calls)
3. Convert to ES module with named exports
4. Add JSDoc comments
5. Remove any dependencies on the source project (DOM, globals, etc. for core modules)
6. Place in `core/{module}/v1.0.0/sg-{module}.js`

### Tool Building Pattern

Each tool is a thin HTML page that imports from `core/` and `components/`:
```html
<script type="module">
  import { functionName } from '/core/{module}/v1.0.0/sg-{module}.js';
  // Tool-specific wiring only
</script>
```

## Review Documents

Place reviews at: `team/explorer/dev/reviews/{date}/`
