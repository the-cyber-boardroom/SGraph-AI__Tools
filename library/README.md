# Library — SGraph-AI__Tools

Reference materials for all agents. Start here when you need to look something up.

## API References

| Document | Contents |
|----------|----------|
| [Component API Catalogue](api/v0.1.68__reference__components.md) | All 50+ components across 20 families: elements, attributes, events, versions. **Vault sections are stale — use the two vault guides below.** |
| [Core Module API Reference](api/v0.1.68__reference__core-modules.md) | All 15 core module families: exports, type signatures. **Vault sections are stale — use the two vault guides below.** |

## Vault — Consumer-Agent Guides

For agents and developers embedding vault content via cross-origin imports from `https://tools.sgraph.ai`.

| Document | Contents |
|----------|----------|
| [Vault Quick Start](api/v0.1.92__vault__quick-start.md) | Common subset (the vault-peek pattern): `<sg-vault-content>`, key + fetch + renderer composition, manifests, trace panel, CORS notes, end-to-end example |
| [Vault Full Inventory](api/v0.1.92__vault__full-inventory.md) | Every vault artefact: 7 core modules, 5 read-only embed components, 3 content renderers, 10 interactive components, 6 tools — with pinned CDN URLs, attributes, events, exports |

## sg-layout — Consumer-Agent Guides

For agents and developers building tools on top of `<sg-layout>` (the fractal panel/window custom element used by every tool on tools.sgraph.ai), imported over CORS from `https://tools.sgraph.ai`.

| Document | Contents |
|----------|----------|
| [sg-layout Quick Start](api/v0.1.92__sg-layout__quick-start.md) | Common patterns: layout JSON tree, 5 methods you'll actually use, the `layout.events` bus (not `addEventListener`!), theming via CSS custom properties, end-to-end example |
| [sg-layout Full Inventory](api/v0.1.92__sg-layout__full-inventory.md) | Every method (15), every `SGL_EVENTS` constant (18) with detail shapes and dispatch info, the layout JSON schema, drag-to-dock zones, lock model, shadow DOM classes, all CSS variables |

## Architecture

| Document | Contents |
|----------|----------|
| [Three-Tier Architecture](architecture/v0.1.68__guide__three-tier-architecture.md) | Dependency rules, module/component/tool inventory, IFD, security, environments |

## Development

| Document | Contents |
|----------|----------|
| [IFD Intro](development/ifd/v1.2.1__ifd__intro-and-how-to-use.md) | Iterative Flow Development methodology |
| [IFD Surgical Overrides](development/ifd/v1.3.0__ifd__surgical-overrides-version-stamped-filenames.md) | Version-stamped filenames for prototype patching |
| [IFD Original Spec](development/ifd/v1.1.0__idf__iterative_flow_development.md) | IFD specification |

## Skills

| Document | Contents |
|----------|----------|
| [sgit & Vaults](skills/use_sgit-and-vaults/SKILL.md) | How to use sgit for vault operations |

## Dev Packs

| Document | Contents |
|----------|----------|
| [Image & Video Processing](dev_packs/from_team__send/v0.19.1__image-video-processing-tools/README.md) | 11 source documents on media capabilities |
