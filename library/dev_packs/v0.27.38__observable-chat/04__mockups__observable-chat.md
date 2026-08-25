# ASCII Mockups: observable-chat

**version** v0.27.38
**date** 13 May 2026
**from** Designer
**to** Developer + Architect
**companion docs**
- Strategy — `team/explorer/architect/v0.27.38__strategy__observable-llm-orchestration.md`
- UX — `team/explorer/designer/v0.27.38__ux__observable-llm-orchestration.md`

These mockups are illustrative, not pixel-perfect. They fix the visual relationships between panels and the information density of each surface. Box-drawing characters approximate sg-layout panel dividers; `▸`/`▾` are toggles; `●` are graph nodes; `📌`/`🚫` are pin/exclude affordances.

---

## 1. Top-level layout — default view

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 🔭 observable-chat                                       client-acme / api-redesign  ● bridge   ⚙   │
├───────────────────────────────────────────────────────┬──────────────────────────────────────────────┤
│ System & Reality                            Graph▸    │  Conversation Graph             [last 20 ▾] │
│ ┌─────────────────────────────────────────────────┐   │  ┌────────────────────────────────────────┐ │
│ │ SYSTEM PROMPT                    Reset   Apply  │   │  │           ●fact "lb_read_file UTF-8"   │ │
│ │ You are an autonomous agent ...                 │   │  │              │ supports                │ │
│ │ ## Available tools                              │   │  │              ▼                         │ │
│ │ - lb_read_file(path)                            │   │  │           ◐hypothesis  "README en-GB"  │ │
│ │ - lb_write_file(path, content)                  │   │  │              │ derives                 │ │
│ │ - lb_run_bash(command)                          │   │  │              ▼                         │ │
│ │ - lb_fetch_url(url)                             │   │  │           ◆decision 📌 "Ollama default"│ │
│ └─────────────────────────────────────────────────┘   │  │   ◇question ──answers──▶ ●fact        │ │
├───────────────────────────────────────────────────────┤  │                                        │ │
│ Chat  Inspector  Compression  Replay                  │  └────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────┐  ├──────────────────────────────────────────────┤
│ │ Context built from 8 nodes · 3 turns ▸           │  │ Tokens & Cost          Bundles               │
│ │                                                  │  │ ┌─────────────────────┐ ┌──────────────────┐ │
│ │ ⚙ System Prompt                                  │  │ │ Last 2,150 · $0.001 │ │▸ 12:03 attempt 1 │ │
│ │                                                  │  │ │ Sess 18,400 · $0.012│ │  12:05 with bash │ │
│ │ YOU: what are the workspace rules?               │  │ │ Context ▍▍▍▍▍▍ 14% │ │  12:11 retry     │ │
│ │                                                  │  │ └─────────────────────┘ └──────────────────┘ │
│ │ ASSISTANT: The workspace rules are: every path   │  ├──────────────────────────────────────────────┤
│ │ must be relative, no traversal, no destructive   │  │ Tools (scored)   Connection   Vault          │
│ │ rm -rf, ...                                      │  │ ┌────────────────────────────────────────┐  │
│ │                                                  │  │ │✓ 87 ▍▍▍▍▍▍▍▍▍  lb_read_file       📌 │  │
│ ├──────────────────────────────────────────────────┤  │ │✓ 64 ▍▍▍▍▍▍      lb_run_bash           │  │
│ │ Type a message...                          [▶]   │  │ │✓ 52 ▍▍▍▍▍       lb_list_folder        │  │
│ │ qwen2.5:7b · est 1.2k tok · $0.0006  Review→     │  │ │  12 ▍           lb_fetch_url        🚫│  │
│ └──────────────────────────────────────────────────┘  │ │  04             web_search            │  │
├───────────────────────────────────────────────────────┤ └────────────────────────────────────────┘  │
│ Sidecar Suggestions                            ▾      │                                              │
│ 💡Phrasing  🔍Ambiguity  🧠Graph (3)  🔧Tools (lb_read)│                                              │
└───────────────────────────────────────────────────────┴──────────────────────────────────────────────┘
```

The chat is the largest panel because that's where writing happens. The graph canvas dominates the right column because the user is meant to watch it grow.

---

## 2. Vault & Folder Browser (new for multi-conversation)

Opens from the Vault tab in the right rail or via ⌘O. Slide-over from the left.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Vault: my-llm-work                                  + new conversation  [✕]  │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▾ 📁 client-acme                                                  3 convs    │
│   ▾ 📁 api-redesign                                                          │
│     💬 v1 plan brainstorm                              13 May · 18 turns  ●  │
│     💬 v2 OpenAPI generation                           12 May · 42 turns     │
│     💬 v2 review (forked from v1)                      12 May · 9 turns      │
│   ▸ 📁 onboarding                                                 7 convs    │
│ ▾ 📁 research                                                                │
│   💬 token compression literature                       9 May · 24 turns     │
│   💬 graph-extraction prompts                           7 May · 6 turns      │
│ ▾ 📁 personal                                                                │
│   💬 home-server bash scratchpad                        5 May · 51 turns     │
│ ▸ 📁 archive                                                     53 convs    │
├──────────────────────────────────────────────────────────────────────────────┤
│ Search...                                                  [filter ▾] [sort ▾]│
└──────────────────────────────────────────────────────────────────────────────┘

  ● = currently open      📁 right-click → rename, move, share
  💬 right-click → rename, move, duplicate, export, share read-key, delete
```

Drag-and-drop a conversation between folders. Right-click a folder → "share folder as read-key" exports just that subtree as a single-conversation-set vault.

---

## 3. Chat panel — close-up

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Context built from 8 nodes · 3 turns ▸ click to see what was included   │ ← provenance pill
├─────────────────────────────────────────────────────────────────────────┤
│ ⚙ System Prompt           1,840 tok                                     │ ← collapsible
├─────────────────────────────────────────────────────────────────────────┤
│ YOU 12:03                                                               │
│ what are the workspace rules?                                           │
│                                                                         │
│ ASSISTANT 12:03 · qwen2.5:7b · 2.4s · 412 tok                          │
│ The workspace rules say every file path must be relative, no traversal,│
│ and destructive ops require confirmation. The workspace itself is      │
│ mounted at /workspace inside the container.                            │
│   ↳ used context: 5 facts, 1 decision  · graph pill                    │
│                                                                         │
│ YOU 12:05                                                               │
│ list the files in src/                                                  │
│                                                                         │
│ ASSISTANT 12:05 · qwen2.5:7b · 1.8s · 220 tok                          │
│ [tool_call] lb_list_folder(path="src/")                                │
│   → ["api.py", "models.py", "utils.py"]                                │
│ The src/ directory contains 3 Python files: api.py, models.py, and    │
│ utils.py.                                                              │
│                                                                         │
│ ▶ streaming...                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│  Type a message...                              📎      [▶ Send]        │
│  qwen2.5:7b · est 1.2k tok · $0.0006 · 1.4s TTFT      Review →          │
└─────────────────────────────────────────────────────────────────────────┘
```

The "↳ used context" pill on each assistant turn lets the user jump back to the exact graph nodes that informed that response.

---

## 4. Pre-send Inspector — slide-over

Triggered by clicking "Review →" or auto-opened on first send.

```
┌─────────────────────────────────────────── Review & Send ───────────────────────────────────┐
│ Model: qwen2.5-coder:7b (ollama)        Tokens 1,240 / 8,192  Cost $0.0006  TTFT ~1.4s     │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ Assembled   Tools (4)   Diff vs previous   Raw JSON                                         │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ ▾ system                                                                     420 tok   ✎   │
│   You are an autonomous agent ...                                                          │
│                                                                                            │
│ ▾ pinned facts (3)                                                           180 tok   ✎   │
│   • lb_read_file returns UTF-8 text                                                        │
│   • workspace root is /workspace                                                           │
│   • bash timeout is 30s                                                                    │
│                                                                                            │
│ ▾ active hypotheses (2)                                                       95 tok   ✎   │
│   • README is in en-GB                                                                     │
│   • src/ contains Python files                                                             │
│                                                                                            │
│ ▾ recent decisions (1)                                                        60 tok   ✎   │
│   • Ollama qwen2.5-coder:7b is the default model                                          │
│                                                                                            │
│ ▾ last 3 turns                                                              420 tok   ✎   │
│   (turn excerpts shown collapsed)                                                          │
│                                                                                            │
│ ▾ user message                                                               65 tok   ✎   │
│   what does utils.py do?                                                                   │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ [Send]  [Send & remember]   ☐ Always send without review (this conversation)    [Cancel]   │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

Each `✎` button opens an inline editor for that section. Folding `▾` → `▸` drops the section from this send only.

---

## 5. Compression Workbench

Opens when context crosses threshold, or on demand.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Compression for next send             Before 12,240 tok   →   After 2,640 tok   savings 78%   ⏰     │
├──────────────────────────────────────────────────┬──────────────────────────────────────────────────┤
│ BEFORE                                            │ PROPOSED AFTER                                   │
├──────────────────────────────────────────────────┼──────────────────────────────────────────────────┤
│ turn 1 · user · 80 tok                            │ turn 1 · user · 80 tok                   [kept] │
│ "what's in the workspace?"                        │ "what's in the workspace?"                       │
│                                                   │                                                  │
│ turn 1 · assistant · 1,200 tok                    │ turn 1 · assistant → summary · 180 tok [summ.✎] │
│ "Let me check. [tool_call lb_list_folder] ..."    │ "Listed root /workspace: 12 files, 3 dirs"      │
│                                                   │                                                  │
│ turn 2 · user · 60 tok                            │ turn 2 · user · 60 tok                   [kept] │
│ "what's in src/?"                                 │ "what's in src/?"                                │
│                                                   │                                                  │
│ turn 2 · tool_call · 400 tok                      │ turn 2 · tool_call                    [dropped] │
│ lb_read_file(path="src/utils.py")                 │ ✗ output already summarised into graph fact #14 │
│                                                   │                                                  │
│ turn 2 · tool_result · 8,400 tok                  │ turn 2 · tool_result → summary · 220 tok [summ.]│
│ (the full file content)                           │ "utils.py: 8 helpers, 142 LOC, no external deps"│
│                                                   │                                                  │
│ turn 3 · assistant · 2,100 tok                    │ turn 3 · assistant · 2,100 tok           [kept] │
│ "utils.py exports helper_a, helper_b ..."         │ (full kept — referenced by user's next msg)     │
├──────────────────────────────────────────────────┴──────────────────────────────────────────────────┤
│ [Apply]  [Apply once]  ☑ Save overrides as pattern  [Reject]                          [Cancel]      │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘

  click any [kept/summ./dropped] tag to flip · hover ✗ for the engine's reason
```

---

## 6. Tool Router — right column tab

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Tools (scored)                                              [Refresh ↻]  │
├──────────────────────────────────────────────────────────────────────────┤
│ Scored against pending msg · qwen2.5-3b sidecar · 84 ms · $0.00001       │
├──────────────────────────────────────────────────────────────────────────┤
│ Threshold ◀─────●─────────────────▶  30                                  │
├──────────────────────────────────────────────────────────────────────────┤
│ ✓  87  ▍▍▍▍▍▍▍▍▍   lb_read_file        builtin   📌                     │
│ ✓  64  ▍▍▍▍▍▍       lb_run_bash         builtin                          │
│ ✓  52  ▍▍▍▍▍        lb_list_folder      builtin                          │
│ ✓  41  ▍▍▍▍         lb_write_file       builtin                          │
│ ✓  33  ▍▍▍          lb_delete_file      builtin                          │
│ ─────────────────────────────────  threshold 30  ──────────────────────  │
│    12  ▍            lb_fetch_url        builtin                  🚫     │
│    04               web_search          template                         │
│    02               get_current_time    template                         │
├──────────────────────────────────────────────────────────────────────────┤
│ + Add tool   ↑ Export   ↓ Import                                         │
└──────────────────────────────────────────────────────────────────────────┘

  ✓ = enabled for next send · 📌 = always include · 🚫 = always exclude
  click a row to expand its JSON schema
```

---

## 7. Conversation Graph — close-up

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Conversation Graph              filters: ☑ active ☑ open ☐ resolved   [⌖]│
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│                                                                            │
│         ●fact #4                                ●fact #11                  │
│       "lb_read_file"                          "src/ is Python"             │
│        returns UTF-8                                                       │
│             │                                       │                      │
│             │ supports                              │ supports             │
│             ▼                                       ▼                      │
│        ◐hypothesis #7              ◐hypothesis #12 ─contradicts─▶ ●fact #14│
│       "README en-GB"                "utils.py is pure"                     │
│             │                                                              │
│             │ answered_by                                                  │
│             ▼                                                              │
│         ◇question #2 ──────────────▶ ●fact #5 "README has en-GB header"   │
│      "what locale?"                                                        │
│                                                                            │
│                            ◆decision #1 📌                                 │
│                          "Ollama default model"                            │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│  Legend  ●fact  ◐hypothesis  ◆decision  ◇question  ◈analysis  ○opinion    │
│  Layout: ●force-directed  ○chronological  ○dag                             │
└────────────────────────────────────────────────────────────────────────────┘

  click  → highlight neighbours, show source turn
  right  → pin / drop / merge / mark resolved / edit text
  📌     → always in next context
  ╳      → excluded from next context (greyed out)
```

---

## 8. Sidecar Suggestions — pill strip

Renders below the chat panel as the main response streams.

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ Sidecar Suggestions    (cost this turn: 412 tok · $0.0002 · 1.8s)                    ▾    │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────────┐   │
│ │💡 Phrasing               │ │🔍 Ambiguity              │ │🧠 Graph (3 hits)            │   │
│ │"show me bash output, not │ │"the file" — README.md   │ │turn 4 established           │   │
│ │ the rendered markdown"   │ │or the new one (turn 3)? │ │lb_read_file returns UTF-8   │   │
│ │           [Use] [×]      │ │      [Clarify] [×]      │ │            [Pin] [×]        │   │
│ └─────────────────────────┘ └─────────────────────────┘ └─────────────────────────────┘   │
│ ┌─────────────────────────────────────────────────────────────────────┐                   │
│ │🔧 Tools predicted        lb_read_file 95% · lb_run_bash 8%          │                   │
│ │                                                       [Lock-in] [×] │                   │
│ └─────────────────────────────────────────────────────────────────────┘                   │
└────────────────────────────────────────────────────────────────────────────────────────────┘

  pills slide in left-to-right as sidecar models finish
  dismiss × removes for this turn only · they're still recorded in the vault
```

---

## 9. Replay surface

Opens when clicking "Replay" on a bundle in the right-rail bundle list.

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ Replay: bundle 12:05-with-bash         parent: 12:03-attempt-1                       [✕]  │
├──────────────────────────────────────────────────┬────────────────────────────────────────┤
│ ORIGINAL REQUEST                                 │ NEW RESPONSE                            │
├──────────────────────────────────────────────────┼────────────────────────────────────────┤
│ Model        qwen2.5-coder:7b      ▾ change      │ Model        qwen2.5-coder:14b          │
│ Tools        5 enabled             ▾ change      │ Tools        3 enabled (router rerun)   │
│ Compression  off                   ▾ change      │ Compression  on (78% saved)             │
│ Sidecar      enabled                              │ Sidecar      enabled                    │
│                                                  │                                          │
│ ── messages ──                                   │ ── response ──                          │
│ system: You are an autonomous ...                │ The src/ directory contains 3 Python    │
│ user: list the files in src/                     │ files. utils.py is the largest at 142   │
│                                                  │ LOC. Want me to read any of them?       │
│                                                  │                                          │
│                                                  │ cost  $0.0008 · ttft 1.1s · 187 tok    │
├──────────────────────────────────────────────────┴────────────────────────────────────────┤
│  [▶ Replay]   [Save as new bundle]   [Promote to fixture]                                  │
│                                                                                            │
│  DIFF: response length −62 tok · cost −33% · added "Want me to read any?" follow-up        │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Empty state — first run

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 🔭 observable-chat                                                          │
│                                                                             │
│                                                                             │
│                          Welcome to observable-chat.                        │
│                                                                             │
│             Every prompt you send is visible, editable, and replayable.    │
│             Your conversations form a graph; the model sees the graph,     │
│             not the scrollback.                                            │
│                                                                             │
│                                                                             │
│           ┌────────────────────────────────────────────────────┐          │
│           │  ▢ Start a new conversation                         │          │
│           │  ▢ Open existing vault...                           │          │
│           │  ▢ Continue last session: "api-redesign — v2 plan"  │          │
│           └────────────────────────────────────────────────────┘          │
│                                                                             │
│                                                                             │
│           First-time tips:                                                 │
│           • Every send opens a Review panel by default                     │
│           • The right column shows the graph as it grows                   │
│           • Cost is shown at the moment of cost, never in retrospect       │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Compact / focus mode — observability collapsed

The user toggles ⛶ in the header. Right rail collapses; sidecar strip collapses; only chat remains.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 🔭 observable-chat                       api-redesign / v2 plan         ◧ ⛶ │
├──────────────────────────────────────────────────────────────────────────────┤
│ Context: 8 nodes · 3 turns ▸                                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⚙ System Prompt                                                              │
│                                                                              │
│ YOU 12:03                                                                    │
│ what are the workspace rules?                                                │
│                                                                              │
│ ASSISTANT 12:03 · qwen2.5:7b                                                 │
│ The workspace rules say every file path must be relative, no traversal,     │
│ and destructive ops require confirmation. ...                               │
│                                                                              │
│ YOU 12:05                                                                    │
│ list the files in src/                                                       │
│                                                                              │
│ ▶ streaming...                                                               │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  Type a message...                            📎      [▶ Send]               │
│  qwen2.5:7b · est 1.2k tok · $0.0006 · Review →                              │
└──────────────────────────────────────────────────────────────────────────────┘

  ◧ = re-open right rail        ⛶ = exit focus mode
  graph keeps building in the background; cost still recorded; trust mode unchanged
```

---

## 12. Reading the symbols

| Symbol | Meaning |
|---|---|
| `●` filled circle | A graph node — type by colour token in real UI |
| `◐` half-filled | Hypothesis node |
| `◆` filled diamond | Decision node |
| `◇` open diamond | Question node |
| `◈` lozenge | Analysis node |
| `○` open circle | Opinion node |
| `📌` | Pinned (always in next context) |
| `🚫` | Excluded from context |
| `▸` `▾` | Collapsed / expanded section |
| `▍` bars | Filled portion of a meter (tokens / score / cost) |
| `✎` | Inline edit handle |
| `↳` | Provenance link to a graph node or turn |
| `⛶` | Toggle focus / compact mode |
| `◧` | Re-open collapsed rail |
| `⌖` | Recentre the graph canvas |
| `↻` | Refresh / re-score |

---

This document is released under the Creative Commons Attribution 4.0 International licence (CC BY 4.0).
