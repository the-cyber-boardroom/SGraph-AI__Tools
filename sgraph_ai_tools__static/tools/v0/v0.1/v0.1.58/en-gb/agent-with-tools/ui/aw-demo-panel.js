/**
 * aw-demo-panel — Pre-defined scenario prompts for testing the agent pipeline.
 *
 * Clicking a prompt dispatches llm:chat-message on the bus, exactly as if
 * the user typed it. Optional "Clear chat first" toggle.
 *
 * @module aw-demo-panel
 * @version 0.1.58
 */

const DEMOS = [
    {
        category: 'Explore',
        icon: '🔍',
        prompts: [
            { label: 'List workspace',    text: 'List all files and folders in the workspace root.' },
            { label: 'Full tree',         text: 'Show me the full directory structure of the workspace recursively.' },
            { label: 'Check env',         text: 'Run `pwd` to show the working directory, then `ls -la` to list all files.' },
        ],
    },
    {
        category: 'Files',
        icon: '📁',
        prompts: [
            { label: 'Create hello.txt',  text: 'Create a file called hello.txt with the content "Hello from Agent with Tools! 🚀"' },
            { label: 'Read it back',      text: 'Read the file hello.txt and confirm its contents.' },
            { label: 'Write JSON',        text: 'Write a file called data.json containing {"status":"ok","agent":"sgraph","ts":0}, then read it back to verify.' },
            { label: 'Delete file',       text: 'Delete the file hello.txt from the workspace.' },
        ],
    },
    {
        category: 'Bash',
        icon: '💻',
        prompts: [
            { label: 'Python version',    text: 'Run `python3 --version` to check the Python version available in the container.' },
            { label: 'Write & run .py',   text: 'Write a Python script called greet.py that prints "Hello from the agent!", then run it with python3 and show the output.' },
            { label: 'Disk usage',        text: 'Run `df -h` to show disk usage, then `free -m` to show available memory.' },
            { label: 'Count files',       text: 'Run a bash command to count how many files are in the workspace, then list them.' },
        ],
    },
    {
        category: 'Fetch',
        icon: '🌐',
        prompts: [
            { label: 'Fetch JSON API',    text: 'Fetch https://httpbin.org/json and show the result.' },
            { label: 'Get IP',            text: 'Fetch https://httpbin.org/ip to find the outbound IP address of this container.' },
            { label: 'Headers',           text: 'Fetch https://httpbin.org/headers to see what HTTP headers are being sent.' },
        ],
    },
    {
        category: 'Multi-step',
        icon: '⛓️',
        prompts: [
            { label: 'Create → read → delete', text: 'Create a file called temp.txt with "temporary test data", read it back to verify the content, then delete it and confirm it is gone.' },
            { label: 'Script pipeline',   text: 'Write a shell script called count.sh that counts the number of files in the workspace and prints the result, then run it with bash.' },
            { label: 'Full workflow',     text: 'List the workspace files, create a file called SUMMARY.md that describes what you found (file names, count, any .py or .json files), then read it back.' },
            { label: 'Fetch + save',      text: 'Fetch https://httpbin.org/json, then save the response body to a file called api-response.json in the workspace.' },
        ],
    },
];

const CSS = `
:host { display: flex; flex-direction: column; height: 100%; min-height: 0; box-sizing: border-box; }
.dp-toolbar {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px;
    background: var(--color-background-secondary, #0d0d1a);
    border-bottom: 1px solid var(--color-border-subtle, #1a1a3a);
    flex-shrink: 0;
}
.dp-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .06em; color: var(--color-text-muted, #4a5568);
    font-family: system-ui, sans-serif; flex: 1;
}
.dp-clear-wrap {
    display: flex; align-items: center; gap: 5px;
    font-size: 10px; color: #475569; font-family: system-ui, sans-serif;
    cursor: pointer; user-select: none;
}
.dp-clear-wrap input { cursor: pointer; accent-color: #7c9ef8; margin: 0; }
.dp-body {
    flex: 1; min-height: 0; overflow-y: auto;
    padding: 6px 8px 10px;
    scrollbar-width: thin; scrollbar-color: #1a1a3a transparent;
}
.dp-cat {
    margin-bottom: 10px;
}
.dp-cat-header {
    display: flex; align-items: center; gap: 5px;
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .06em; color: #475569;
    font-family: system-ui, sans-serif;
    margin: 8px 0 4px;
}
.dp-btn {
    display: block; width: 100%; text-align: left;
    background: #12122a; border: 1px solid #1e1e3a;
    border-radius: 5px; padding: 7px 10px;
    color: #94a3b8; font-size: 11px;
    font-family: system-ui, sans-serif; cursor: pointer;
    margin-bottom: 3px; line-height: 1.4;
    transition: background .1s, border-color .1s, color .1s;
}
.dp-btn:hover {
    background: #1a1a3a; border-color: #7c9ef8; color: #e2e8f0;
}
.dp-btn:active { background: #1e2860; }
.dp-btn-label { font-weight: 600; color: #c4cfde; display: block; margin-bottom: 1px; }
.dp-btn-text  { font-size: 10px; color: #475569; display: block;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

export class AwDemoPanel extends HTMLElement {

    constructor() {
        super();
        this._shadow = this.attachShadow({ mode: 'open' });
        this._clearFirst = false;
    }

    connectedCallback() {
        if (this._init) return;
        this._init = true;
        this._render();
    }

    _bus() {
        let el = this.parentElement;
        while (el) { if (el.hasAttribute('data-llm-bus')) return el; el = el.parentElement; }
        return this.parentElement || document;
    }

    _send(text) {
        const bus = this._bus();
        if (this._clearFirst) {
            bus.dispatchEvent(new CustomEvent('llm:clear-history', { bubbles: false, composed: false }));
        }
        bus.dispatchEvent(new CustomEvent('llm:chat-message', {
            detail: { text },
            bubbles: true, composed: true,
        }));
    }

    _render() {
        const style = document.createElement('style');
        style.textContent = CSS;

        const toolbar = document.createElement('div');
        toolbar.className = 'dp-toolbar';

        const label = document.createElement('span');
        label.className = 'dp-label';
        label.textContent = 'Demo Scenarios';

        const clearWrap = document.createElement('label');
        clearWrap.className = 'dp-clear-wrap';
        clearWrap.title = 'Clear chat history before sending the prompt';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = this._clearFirst;
        cb.addEventListener('change', () => { this._clearFirst = cb.checked; });
        clearWrap.appendChild(cb);
        clearWrap.appendChild(document.createTextNode('Clear first'));

        toolbar.appendChild(label);
        toolbar.appendChild(clearWrap);

        const body = document.createElement('div');
        body.className = 'dp-body';

        for (const cat of DEMOS) {
            const section = document.createElement('div');
            section.className = 'dp-cat';

            const header = document.createElement('div');
            header.className = 'dp-cat-header';
            header.textContent = `${cat.icon}  ${cat.category}`;
            section.appendChild(header);

            for (const p of cat.prompts) {
                const btn = document.createElement('button');
                btn.className = 'dp-btn';
                btn.title = p.text;

                const lbl = document.createElement('span');
                lbl.className = 'dp-btn-label';
                lbl.textContent = p.label;

                const txt = document.createElement('span');
                txt.className = 'dp-btn-text';
                txt.textContent = p.text;

                btn.appendChild(lbl);
                btn.appendChild(txt);
                btn.addEventListener('click', () => this._send(p.text));
                section.appendChild(btn);
            }

            body.appendChild(section);
        }

        this._shadow.appendChild(style);
        this._shadow.appendChild(toolbar);
        this._shadow.appendChild(body);
    }
}

customElements.define('aw-demo-panel', AwDemoPanel);
