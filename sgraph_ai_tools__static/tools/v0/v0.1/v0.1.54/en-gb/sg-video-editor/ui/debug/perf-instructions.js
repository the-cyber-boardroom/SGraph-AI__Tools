/** perf-instructions.js — static Chrome investigation guide rendered in the Perf tab. */

export const PERF_INSTRUCTIONS_HTML = `
<p class="sgve-perf-note">
  <b>Note:</b> <code>performance.memory</code> only tracks the JS heap (~5–10 MB
  typical). The 4+ GB spike is in <b>native video decode buffers</b> which live
  outside the heap — use the tools below to see that memory.
</p>

<details>
  <summary>Task Manager — see native memory per tab</summary>
  <p>Press <kbd>Shift+Esc</kbd> (or Chrome menu → More tools → Task Manager).
  Find the editor tab. Key columns:</p>
  <ul>
    <li><b>Memory footprint</b> — total native memory incl. video decode buffers. This is what spikes.</li>
    <li><b>JavaScript memory</b> — JS heap only (same as the Heap number above).</li>
    <li><b>GPU memory</b> — right-click the column header to enable it.</li>
  </ul>
</details>

<details>
  <summary>chrome://media-internals — live decoder stats</summary>
  <p>Open a new tab → <code>chrome://media-internals</code>. Each active
  <code>&lt;video&gt;</code> element appears as a row. Watch:</p>
  <ul>
    <li><b>natural_size</b> — intrinsic resolution (4K = ~4× more memory than 1080p)</li>
    <li><b>pipeline_state</b> — PLAYING / PAUSED / STOPPED</li>
    <li><b>video_codec</b> + <b>audio_codec</b></li>
    <li><b>video buffered</b> — seconds pre-decoded in memory</li>
  </ul>
  <p>Rows persist even after elements leave the DOM — count them to confirm
  how many decoders Chrome is keeping alive.</p>
</details>

<details>
  <summary>DevTools Performance tab — memory timeline</summary>
  <ol>
    <li>DevTools → Performance → tick <b>Memory</b> checkbox.</li>
    <li>Click <b>Record</b>, drop a large video, wait 3 s, click <b>Stop</b>.</li>
    <li>The memory chart shows JS Heap, DOM nodes, event listeners, GPU memory over time.</li>
    <li>Zoom into the drop event — look for a spike that never drops back (= leak).</li>
  </ol>
  <p>A sawtooth heap = GC running (normal). A staircase that never drops = leak.</p>
</details>

<details>
  <summary>DevTools Memory tab — heap snapshots</summary>
  <ol>
    <li>DevTools → Memory → <b>Heap snapshot</b> → Take snapshot (baseline).</li>
    <li>Drop the video, wait 5 s, take a second snapshot.</li>
    <li>Switch to <b>Comparison</b> view, sort by <b>Size delta ↓</b>.</li>
    <li>Look for: <code>HTMLVideoElement</code>, <code>MediaSource</code>,
        <code>ArrayBuffer</code>, <code>AudioContext</code>.</li>
  </ol>
</details>

<details>
  <summary>Allocation sampling — find the hot allocation path</summary>
  <ol>
    <li>DevTools → Memory → <b>Allocation sampling</b> → Start.</li>
    <li>Drop a video, click Stop.</li>
    <li>Flame chart shows call stacks weighted by allocation size.</li>
    <li>Known hot paths: <code>buildAllTrackVideos</code>,
        <code>URL.createObjectURL</code>, <code>createPlayback</code>.</li>
  </ol>
</details>

<details>
  <summary>chrome://gpu — GPU memory &amp; hardware decode</summary>
  <p>Navigate to <code>chrome://gpu</code>. The <b>Video Acceleration
  Information</b> section confirms which codecs use hardware decode (hardware
  decode = GPU memory, not RAM). On Apple Silicon, CPU and GPU share the same
  pool, so video decode competes directly with JS heap.</p>
</details>
`.trim();
