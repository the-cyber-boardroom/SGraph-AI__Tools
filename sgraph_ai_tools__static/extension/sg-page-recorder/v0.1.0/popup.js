/**
 * popup.js — the arming UI.
 *
 * Arming happens HERE, on the tab the user is looking at, because `activeTab`
 * only grants access in response to this click. That is also the honest
 * interaction: the person whose page is about to be recorded is the one
 * pressing the button, on the page in question.
 *
 * The tool page cannot arm a tab on its own for the same reason — it can ask,
 * but a human has to click.
 */
const $ = s => document.querySelector(s);
let tabId = null;

function cfg() {
    return {
        mouse: $('#mouse').checked, scroll: $('#scroll').checked,
        console: $('#console').checked, network: $('#network').checked,
        keys: $('#keys').value,
    };
}

$('#keys').addEventListener('change', () => {
    $('#keywarn').hidden = $('#keys').value !== 'text';
});

async function refresh() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? null;
    $('#tab').textContent = tab ? `${new URL(tab.url).host}${new URL(tab.url).pathname}`.slice(0, 60) : 'no tab';
    const list = await chrome.runtime.sendMessage({ type: 'sgpr:list' });
    const mine = (list?.tabs || []).find(t => t.tabId === tabId);
    if (mine?.armed) {
        $('#go').textContent = 'Stop recording';
        $('#go').classList.add('rec');
        $('#state').textContent = `${mine.events} events buffered`
            + (mine.redacted ? ` · ${mine.redacted} keystrokes redacted` : '')
            + (mine.dropped ? ` · ${mine.dropped} dropped` : '');
    } else {
        $('#go').textContent = 'Start recording this tab';
        $('#go').classList.remove('rec');
        $('#state').textContent = mine?.events ? `${mine.events} events buffered, not recording` : '';
    }
}

$('#go').addEventListener('click', async () => {
    const list = await chrome.runtime.sendMessage({ type: 'sgpr:list' });
    const mine = (list?.tabs || []).find(t => t.tabId === tabId);
    const r = mine?.armed
        ? await chrome.runtime.sendMessage({ type: 'sgpr:disarm', tabId })
        : await chrome.runtime.sendMessage({ type: 'sgpr:arm', tabId, cfg: cfg() });
    if (r?.error) $('#state').textContent = `error: ${r.error}`;
    refresh();
});

refresh();
setInterval(refresh, 1500);
