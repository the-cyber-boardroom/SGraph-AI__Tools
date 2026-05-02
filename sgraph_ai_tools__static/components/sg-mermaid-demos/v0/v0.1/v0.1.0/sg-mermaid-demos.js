/**
 * <sg-mermaid-demos> — Curated Mermaid diagram examples gallery.
 *
 * Renders a scrollable list of demo cards grouped by diagram type.
 * Clicking a card emits `sg-mermaid:demo-selected` so the tool can
 * load the markup into the editor and trigger a render.
 *
 * API:
 *   getDemos()        → Demo[]  ({ id, type, label, description, markup })
 *   selectDemo(id)    → void    (fires demo-selected, highlights card)
 *
 * Events (dispatched on element, bubbles + composed):
 *   sg-mermaid:demo-selected  — { id, type, label, markup }
 *
 * @module sg-mermaid-demos
 * @version 0.1.0
 */

/** @typedef {{ id: string, type: string, label: string, description: string, markup: string }} Demo */

/** @type {Demo[]} */
const DEMOS = [
    {
        id: 'flowchart-api',
        type: 'Flowchart',
        label: 'API Auth Flow',
        description: 'Request routing with auth decision diamond',
        markup: `flowchart TD
    A([Browser]) --> B{API Gateway}
    B -->|Valid token| C[Service A]
    B -->|Invalid token| D[401 Unauthorized]
    C --> E[(PostgreSQL)]
    C --> F[(Redis Cache)]
    F -->|Cache hit| G([Response])
    E -->|Cache miss| G`,
    },
    {
        id: 'sequence-login',
        type: 'Sequence',
        label: 'Login Sequence',
        description: 'Browser → API → DB interaction for auth',
        markup: `sequenceDiagram
    participant B as Browser
    participant A as API Server
    participant DB as Database
    participant C as Cache

    B->>A: POST /login {email, password}
    A->>DB: SELECT user WHERE email=?
    DB-->>A: User record + hash
    A->>A: bcrypt.compare(pass, hash)
    A-->>B: 200 {token, expiresIn}
    B->>A: GET /profile (Bearer token)
    A->>C: GET session:{token}
    C-->>A: Session data
    A-->>B: 200 {name, email, role}`,
    },
    {
        id: 'class-domain',
        type: 'Class',
        label: 'Domain Model',
        description: 'User / Post / Comment class hierarchy',
        markup: `classDiagram
    class User {
        +int id
        +string email
        +string name
        +datetime createdAt
        +getPosts() Post[]
        +getComments() Comment[]
    }
    class Post {
        +int id
        +string title
        +text body
        +datetime publishedAt
        +publish() void
        +archive() void
    }
    class Comment {
        +int id
        +text content
        +bool approved
        +approve() void
    }
    User "1" --> "0..*" Post : writes
    Post "1" --> "0..*" Comment : has
    User "1" --> "0..*" Comment : writes`,
    },
    {
        id: 'state-task',
        type: 'State',
        label: 'Task Lifecycle',
        description: 'States a task moves through from creation to done',
        markup: `stateDiagram-v2
    [*] --> Backlog : created
    Backlog --> InProgress : assign()
    InProgress --> Review : submit()
    Review --> InProgress : reject()
    Review --> Done : approve()
    InProgress --> Blocked : blocker()
    Blocked --> InProgress : resolved()
    Done --> [*]`,
    },
    {
        id: 'er-blog',
        type: 'ER Diagram',
        label: 'Blog Schema',
        description: 'Entities and relationships for a blog platform',
        markup: `erDiagram
    USER {
        int id PK
        string email UK
        string name
        datetime created_at
    }
    POST {
        int id PK
        int author_id FK
        string title
        text body
        string status
        datetime published_at
    }
    TAG {
        int id PK
        string name UK
    }
    POST_TAG {
        int post_id FK
        int tag_id FK
    }
    COMMENT {
        int id PK
        int post_id FK
        int user_id FK
        text content
        datetime created_at
    }
    USER ||--o{ POST : writes
    POST ||--o{ POST_TAG : has
    TAG ||--o{ POST_TAG : applied-to
    POST ||--o{ COMMENT : receives
    USER ||--o{ COMMENT : writes`,
    },
    {
        id: 'gantt-sprint',
        type: 'Gantt',
        label: 'Sprint Timeline',
        description: 'Two-week sprint with planning, build and release phases',
        markup: `gantt
    title Sprint 12 — May 2026
    dateFormat YYYY-MM-DD
    section Planning
    Backlog grooming   :done,  bg, 2026-05-01, 1d
    Sprint planning    :done,  sp, 2026-05-02, 1d
    section Build
    Auth API           :active, a1, 2026-05-03, 4d
    Dashboard UI       :        a2, 2026-05-05, 5d
    section Testing
    QA & Bug fixes     :        t1, 2026-05-10, 3d
    Regression suite   :        t2, 2026-05-12, 2d
    section Release
    Staging deploy     :        d1, 2026-05-13, 1d
    Production deploy  :        d2, 2026-05-14, 1d`,
    },
    {
        id: 'mindmap-sgraph',
        type: 'Mind Map',
        label: 'SGraph Ecosystem',
        description: 'Key capabilities of the SGraph platform',
        markup: `mindmap
  root((SGraph))
    Security
      AES-256-GCM encryption
      Ed25519 SSH keys
      PBKDF2 key derivation
    Collaboration
      Encrypted Vaults
      SG/Send file transfer
      Real-time sharing
    AI Tools
      Multi-turn Chat
      Infographic Generator
      PlaybookLM slides
      Agentic Loop
    Developer
      JS API Primitive
      Browser-only tools
      Playwright test suite`,
    },
    {
        id: 'gitgraph-feature',
        type: 'Git Graph',
        label: 'Feature Branch Flow',
        description: 'Typical git branching with feature branches',
        markup: `gitGraph
    commit id: "init: project scaffold"
    commit id: "feat: core crypto module"
    branch feature/vault
    checkout feature/vault
    commit id: "feat: vault client"
    commit id: "feat: vault write"
    commit id: "fix: key derivation"
    checkout main
    branch feature/llm
    checkout feature/llm
    commit id: "feat: sg-llm module"
    commit id: "feat: chat tool"
    checkout main
    merge feature/vault id: "Merge: vault stack"
    merge feature/llm id: "Merge: LLM tools"
    commit id: "chore: bump v0.1.57"`,
    },
];

const STYLES = `
:host { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }

.smd-header {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px; background: var(--sg-bg-card,#0d1117);
    border-bottom: 1px solid var(--sg-border,#1a2a3a);
    flex-shrink: 0;
}
.smd-header-title {
    font-size: .7rem; font-weight: 600; color: var(--sg-text-dim,#8899aa);
    text-transform: uppercase; letter-spacing: .05em; margin-right: auto;
}
.smd-count { font-size: .65rem; color: var(--sg-text-dim,#8899aa);
    font-family: var(--sg-font-mono,monospace); opacity: .5; }

.smd-list {
    flex: 1; overflow-y: auto; padding: 6px 8px;
    display: flex; flex-direction: column; gap: 5px; min-height: 0;
}

.smd-card {
    background: var(--sg-bg-card,#0d1117);
    border: 1px solid var(--sg-border,#1a2a3a);
    border-radius: 5px; padding: 8px 10px;
    cursor: pointer; transition: border-color .15s, background .15s;
    display: flex; flex-direction: column; gap: 3px;
}
.smd-card:hover { border-color: var(--sg-accent,#4ecdc4); background: rgba(78,205,196,.04); }
.smd-card.active { border-color: var(--sg-accent,#4ecdc4); background: rgba(78,205,196,.08); }

.smd-card-top { display: flex; align-items: center; gap: 6px; }

.smd-badge {
    display: inline-block; padding: 1px 6px; border-radius: 10px;
    font-size: .6rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
    background: rgba(78,205,196,.15); color: var(--sg-accent,#4ecdc4);
    flex-shrink: 0; font-family: var(--sg-font-mono,monospace);
}
.smd-label {
    font-size: .8rem; font-weight: 600; color: var(--sg-text,#e2e8f0);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.smd-desc {
    font-size: .7rem; color: var(--sg-text-dim,#8899aa); line-height: 1.4;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
`;

export class SgMermaidDemos extends HTMLElement {
    connectedCallback() {
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `<style>${STYLES}</style>
<div class="smd-header">
    <span class="smd-header-title">Examples</span>
    <span class="smd-count">${DEMOS.length} diagrams</span>
</div>
<div class="smd-list" id="list"></div>`;

        this._list = shadow.getElementById('list');
        this._activeId = null;
        this._cards = new Map();
        DEMOS.forEach(d => this._buildCard(d));
    }

    /** @returns {Demo[]} */
    getDemos() { return DEMOS.map(({ id, type, label, description }) => ({ id, type, label, description })); }

    /** @param {string} id */
    selectDemo(id) {
        const demo = DEMOS.find(d => d.id === id);
        if (!demo) return;
        this._highlight(id);
        this._emit(demo);
    }

    _buildCard(demo) {
        const card = document.createElement('div');
        card.className = 'smd-card';
        card.innerHTML = `
<div class="smd-card-top">
    <span class="smd-badge">${this._esc(demo.type)}</span>
    <span class="smd-label">${this._esc(demo.label)}</span>
</div>
<div class="smd-desc">${this._esc(demo.description)}</div>`;
        card.addEventListener('click', () => this.selectDemo(demo.id));
        this._list.appendChild(card);
        this._cards.set(demo.id, card);
    }

    _highlight(id) {
        if (this._activeId) {
            this._cards.get(this._activeId)?.classList.remove('active');
        }
        this._activeId = id;
        this._cards.get(id)?.classList.add('active');
    }

    _emit(demo) {
        this.dispatchEvent(new CustomEvent('sg-mermaid:demo-selected', {
            detail: { id: demo.id, type: demo.type, label: demo.label, markup: demo.markup },
            bubbles: true, composed: true,
        }));
    }

    _esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
}

customElements.define('sg-mermaid-demos', SgMermaidDemos);
