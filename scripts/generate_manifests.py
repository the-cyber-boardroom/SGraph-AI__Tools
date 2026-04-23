#!/usr/bin/env python3
"""Generate manifest.json files for all tools by parsing their HTML imports.

Reads each tool's index.html, extracts import paths, and writes a
structured manifest.json alongside the tool. Uses the landing page
HTML to pull display metadata (name, description, icon, status).

Usage:
    python scripts/generate_manifests.py
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STATIC = REPO_ROOT / 'sgraph_ai_tools__static'
IFD_BASE = STATIC / 'tools' / 'v0' / 'v0.1'

# ── Shared dependencies (site-header, site-footer, locale-picker, CSS) ──
SHARED_PREFIXES = [
    '/components/site-header/',
    '/components/site-footer/',
    '/components/locale-picker/',
]

# ── Tool metadata from the landing page ──
# (name, icon, description, status, category, keywords)
TOOL_META = {
    'ssh-keygen':          ('SSH Key Generator',    '🔑', 'Generate Ed25519 SSH key pairs entirely in your browser. No server involved. Copy or download your keys instantly.', 'live', 'security', ['ssh', 'ed25519', 'cryptography']),
    'file-hasher':         ('File Hasher',          '📈', 'Calculate SHA-256, SHA-1, or SHA-512 hash of any file. Verify file integrity without uploading.', 'live', 'security', ['sha256', 'sha512', 'hash', 'integrity']),
    'file-encryptor':      ('File Encryptor',       '🔒', 'Encrypt or decrypt any file with AES-256-GCM. Everything stays in your browser. Same encryption used by SG/Send.', 'live', 'security', ['encrypt', 'decrypt', 'aes-256-gcm']),
    'key-generator':       ('Key Generator',        '🗝️', 'Create friendly encryption keys like "apple-mango-56" instead of random strings. Visualise entropy and strength.', 'live', 'security', ['passphrase', 'entropy', 'friendly', 'words']),
    'vault-browser':       ('Vault Browser',        '🗄️', 'Open and browse SG/Send vaults in your browser. Derive keys, decrypt files, view contents — no Python or CLI required.', 'live', 'vault', ['sgraph', 'send', 'browse', 'decrypt']),
    'image-tools':         ('Image Tools',          '🖼️', 'Convert, resize, crop, redact, and annotate images entirely in your browser. Supports PNG, JPG, WebP, AVIF.', 'live', 'media', ['image', 'resize', 'crop', 'redact', 'annotate', 'png', 'jpg', 'webp']),
    'video-tools':         ('Video Tools',          '🎬', 'Split, trim, and extract audio or video using FFmpeg in your browser. No upload required. Share results via SG/Send.', 'live', 'media', ['video', 'split', 'trim', 'ffmpeg', 'audio', 'extract']),
    'pyodide-repl':        ('Python REPL',          '🐍', 'Interactive Python console in your browser via Pyodide. Install PyPI packages (numpy, pydantic, cryptography) instantly.', 'experimental', 'code', ['python', 'repl', 'pyodide', 'wasm', 'console', 'packages', 'numpy']),
    'vault-pyodide':       ('Vault (Pyodide)',      '🔐', 'Run Python vault crypto in the browser via CPython/WebAssembly. Compare Python vs JavaScript key derivation side by side.', 'experimental', 'dev', ['vault', 'pyodide', 'python', 'crypto', 'wasm', 'compare']),
    'sg-send-cli':         ('SG/Send CLI',          '📦', 'Run sg-send-cli vault operations in your browser. Init, commit, push, inspect — the real Python package from PyPI in WebAssembly.', 'experimental', 'dev', ['sgraph', 'send', 'cli', 'pypi', 'wasm', 'vault']),
    'chat':                ('Chat',                 '💬', 'Multi-turn chat with any LLM. Attach images, PDFs, audio and video files. Maintain conversation history and export transcripts.', 'live', 'llm', ['conversation', 'history', 'attachments', 'images', 'files', 'multimodal']),
    'one-shot-chat':       ('One-Shot Chat',        '🎯', 'Engineer precision LLM requests. Build system prompts, context blocks, constructed history — send once. No conversation drift.', 'live', 'llm', ['precision', 'system', 'prompt', 'context', 'history']),
    'infographic-gen':     ('Infographic Generator', '📊', 'Turn text and data into SVG infographics with a single LLM request. Executive, technical, playful or data styles. Export SVG or PNG.', 'live', 'llm', ['infographic', 'svg', 'chart', 'visual', 'diagram', 'png', 'export']),
    'llm-dev':             ('LLM Dev Environment',  '🔧', 'Full LLM development environment. Build realities, attach files, inspect requests, track token costs and time-travel through history.', 'live', 'code', ['llm', 'dev', 'environment', 'bundle', 'history', 'token', 'cost', 'inspect', 'debug']),
    'multi-agent-chat':    ('Multi-Agent Chat',     '👥', 'Chat with multiple specialist agents simultaneously — Architect, Dev, Designer, DevOps, Historian, Librarian. Broadcast to all at once.', 'live', 'llm', ['multi', 'agent', 'specialist', 'roles', 'parallel', 'broadcast']),
    'openrouter':          ('OpenRouter',           '⚡', 'Manage your OpenRouter account. View key stats, spending analytics with charts, model explorer, provisioned key management, and CSV log analysis.', 'new', 'vault', ['openrouter', 'api', 'key', 'stats', 'spending', 'analytics', 'logs', 'csv', 'models']),
    'agentic':             ('Agentic Loop',         '🤖', 'Full LLM tool-calling loop. Define tools, run autonomous tasks, trace every step. Supports Python via Pyodide and VFS file operations.', 'live', 'llm', ['agentic', 'loop', 'tool', 'calling', 'function', 'use', 'python', 'vfs', 'autonomous']),
    'model-compatibility': ('Model Compatibility',  '🧪', 'Static compatibility matrix for LLM models. Tests tool calling, JSON schema, streaming, stop conditions across OpenRouter, Ollama, Anthropic, OpenAI.', 'live', 'llm', ['model', 'compatibility', 'matrix', 'tool', 'calling', 'json', 'streaming', 'llm']),
    'vault':               ('Vault',                '🏛️', 'Native SGraph vault browser and editor. Connect with a full vault key or simple token, browse the file tree, view and edit encrypted files.', 'live', 'vault', ['vault', 'sgraph', 'send', 'browse', 'edit', 'write', 'files', 'tree']),
    'vfs-dev':             ('VFS Dev',              '📁', 'Virtual filesystem developer tool. Test read/write/list/copy/delete operations across memory, IndexedDB and layered providers with live event viewer.', 'dev', 'dev', ['vfs', 'virtual', 'filesystem', 'dev', 'operations', 'memory', 'indexeddb', 'layered']),
    'vfs-tree-demo':       ('VFS Tree Demo',        '🌲', 'Live demo of sg-tree component with VFS integration. Visual directory tree that auto-refreshes on structural changes, with inline file editor.', 'dev', 'dev', ['vfs', 'tree', 'demo', 'directory', 'listing', 'visual', 'filesystem', 'browser']),
    'send-sim':            ('Send Simulator',       '📡', 'Local SG/Send API simulator for development and testing. Seed test data, inspect requests, simulate vault and file operations without a live server.', 'dev', 'dev', ['send', 'simulator', 'sgraph', 'api', 'mock', 'test', 'local']),
    'folder-editor':       ('Folder Editor',        '📂', 'Manage VFS folder structures in the browser. Create, rename and delete files and folders. Share via SG/Send. Browse with a live tree view backed by IndexedDB.', 'dev', 'code', ['folder', 'editor', 'vfs', 'files', 'manage', 'create', 'rename', 'delete']),
    'sg-tree-demo':        ('SG Tree Demo',         '🌳', 'Component demo for sg-tree — a reusable tree-view Web Component. Explore props, events, and styling options.', 'dev', 'dev', ['sg', 'tree', 'demo', 'component', 'visual', 'directory']),
}


def parse_version_tuple(name):
    """Parse 'v0.1.22' into (0, 1, 22)."""
    m = re.match(r'^v(\d+)\.(\d+)\.(\d+)$', name)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def find_latest_tool_html(slug):
    """Find the latest version of a tool's index.html across all IFD folders."""
    candidates = []
    for version_dir in IFD_BASE.iterdir():
        if not version_dir.is_dir():
            continue
        v = parse_version_tuple(version_dir.name)
        if v is None:
            continue
        tool_html = version_dir / 'en-gb' / slug / 'index.html'
        if tool_html.is_file():
            candidates.append((v, tool_html, version_dir.name))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0])
    return candidates[-1]  # (version_tuple, path, version_string)


def extract_imports(html_path):
    """Extract all import paths from an HTML file."""
    text = html_path.read_text(encoding='utf-8')
    imports = set()

    # <script type="module" src="/components/...">
    for m in re.finditer(r'<script[^>]+src=["\'](/(?:core|components)/[^"\']+)["\']', text):
        imports.add(m.group(1))

    # import ... from '/core/...' or import '/components/...'
    for m in re.finditer(r"""import\s+(?:.*?\s+from\s+)?['"](/(?:core|components)/[^'"]+)['"]""", text):
        imports.add(m.group(1))

    # <link rel="stylesheet" href="/core/...">
    for m in re.finditer(r'<link[^>]+href=["\'](/(?:core|components)/[^"\']+\.css)["\']', text):
        imports.add(m.group(1))

    return sorted(imports)


def classify_import(path):
    """Classify an import path into core/components/shared."""
    for prefix in SHARED_PREFIXES:
        if path.startswith(prefix):
            return 'shared'
    if path.startswith('/core/'):
        return 'core'
    return 'components'


def module_name_from_path(path):
    """Extract a readable module name from an import path."""
    filename = path.rstrip('/').split('/')[-1]
    # Remove extension
    name = re.sub(r'\.(js|css)$', '', filename)
    # Remove version suffix like --v0.1.4
    name = re.sub(r'--v[\d.]+$', '', name)
    return name


def build_manifest(slug):
    """Build a complete manifest dict for a tool."""
    if slug not in TOOL_META:
        print(f"  SKIP {slug}: no metadata defined")
        return None

    result = find_latest_tool_html(slug)
    if result is None:
        print(f"  SKIP {slug}: no HTML found")
        return None

    version_tuple, html_path, version_string = result
    name, icon, description, status, category, keywords = TOOL_META[slug]

    imports = extract_imports(html_path)

    deps = {'core': [], 'components': [], 'shared': [], 'external': []}
    for imp in imports:
        bucket = classify_import(imp)
        mod_name = module_name_from_path(imp)
        deps[bucket].append({'module': mod_name, 'path': imp})

    # Always add tools.css as a shared dependency
    if not any(d['module'] == 'tools' for d in deps['shared']):
        deps['shared'].append({'module': 'tools.css', 'path': '/_common/css/tools.css'})

    # Remove empty buckets for cleanliness
    deps = {k: v for k, v in deps.items() if v}

    version_sem = f"{version_tuple[0]}.{version_tuple[1]}.{version_tuple[2]}"

    return {
        'name': name,
        'slug': slug,
        'description': description,
        'icon': icon,
        'version': version_sem,
        'status': status,
        'category': category,
        'keywords': keywords,
        'dependencies': deps,
    }


def main():
    print("Generating manifest.json files for all tools...\n")

    slugs = sorted(TOOL_META.keys())
    generated = 0
    errors = 0

    for slug in slugs:
        manifest = build_manifest(slug)
        if manifest is None:
            errors += 1
            continue

        result = find_latest_tool_html(slug)
        _, html_path, version_string = result
        manifest_path = html_path.parent / 'manifest.json'

        manifest_path.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + '\n',
            encoding='utf-8'
        )
        dep_count = sum(len(v) for v in manifest['dependencies'].values())
        print(f"  {slug} ({version_string}): {dep_count} deps -> {manifest_path.relative_to(REPO_ROOT)}")
        generated += 1

    print(f"\nDone: {generated} manifests generated, {errors} skipped.")
    return 0 if errors == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
