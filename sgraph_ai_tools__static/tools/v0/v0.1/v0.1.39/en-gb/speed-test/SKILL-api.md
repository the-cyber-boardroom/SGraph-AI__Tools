# Speed Test — API Reference

**Tool:** Speed Test v0.1.39
**Window object:** `window.__tool`
**Module:** `tools/v0/v0.1/v0.1.39/en-gb/speed-test/speed-test.js`

---

## Core imports

```javascript
// sg-send-upload v1.1.0 (ChunkedUploader, formatSpeed, formatEta)
import { ChunkedUploader, formatSpeed, formatEta }  from '/core/sg-send-upload/v1/v1.1/v1.1.0/sg-send-upload.js';

// sg-send-download v1.0.0 (ChunkedDownloader, decryptWithProgress)
import { ChunkedDownloader, decryptWithProgress }    from '/core/sg-send-download/v1/v1.0/v1.0.0/sg-send-download.js';

// sg-crypto v1.0.0 (generateKey, encryptFile, decryptFile)
import { generateKey, encryptFile, decryptFile }     from '/core/crypto/v1/v1.0/v1.0.0/sg-crypto.js';

// speed-test-sim (randomBytes, runSimBenchmark)
import { randomBytes, runSimBenchmark }              from './speed-test-sim.js';

// speed-test-live (runLiveUpload, runLiveDownload)
import { runLiveUpload, runLiveDownload }             from './speed-test-live.js';
```

---

## Methods

### `runAll()` → `Promise<void>`

Run the full test sequence for the current mode. Reads UI state (mode, probe
size, target URL, tokens). Updates meter cards. Adds result to history.

---

### `runSim(opts?)` → `Promise<SimResult>`

Run a crypto benchmark in isolation (no UI update unless called via `runAll`).

```typescript
interface SimResult {
    type:         'sim';
    encryptBps:   number;   // bytes/second for AES-256-GCM encrypt
    decryptBps:   number;   // bytes/second for AES-256-GCM decrypt
    encryptLabel: string;   // formatSpeed(encryptBps)
    decryptLabel: string;   // formatSpeed(decryptBps)
    encryptMs:    number;   // wall-clock milliseconds for encryption
    decryptMs:    number;   // wall-clock milliseconds for decryption
    sizeBytes:    number;   // payload size measured
    aborted:      boolean;
}
```

Options:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `sizeBytes` | `number` | `8 * 1024 * 1024` | Payload size |
| `onProgress` | `Function` | — | `({ stage, percent }) => void` |
| `signal` | `AbortSignal` | — | Cancel via `AbortController` |

---

### `runUpload(opts)` → `Promise<LiveUploadResult>`

Encrypt a random probe payload and upload via `ChunkedUploader`.

```typescript
interface LiveUploadResult {
    type:        'upload';
    bps:         number;
    mbps:        number;
    label:       string;   // formatSpeed(bps)
    bytesTotal:  number;   // ciphertext bytes transferred
    durationMs:  number;
    transferId:  string;
    token:       string;   // friendly SG/Send token
    downloadUrl: string;   // ${sendUrl}/${transferId}
    aborted:     boolean;
}
```

Options:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `sendUrl` | `string` | *(required)* | SG/Send base URL |
| `accessToken` | `string` | *(required)* | API access token |
| `sizeBytes` | `number` | `2 * 1024 * 1024` | Plaintext probe size |
| `chunkSize` | `number` | `5 * 1024 * 1024` | Chunk size |
| `maxConcurrent` | `number` | `4` | Parallel threads |
| `onProgress` | `Function` | — | `(UploadProgress) => void` |
| `signal` | `AbortSignal` | — | Cancel |

---

### `runDownload(url, opts?)` → `Promise<LiveDownloadResult>`

Download a resource via HTTP Range requests using `ChunkedDownloader`.

```typescript
interface LiveDownloadResult {
    type:       'download';
    bps:        number;
    mbps:       number;
    label:      string;
    bytesTotal: number;
    durationMs: number;
    aborted:    boolean;
}
```

Options:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `chunkSize` | `number` | `2 * 1024 * 1024` | Chunk size |
| `maxConcurrent` | `number` | `4` | Parallel threads |
| `onProgress` | `Function` | — | `(DownloadProgress) => void` |
| `signal` | `AbortSignal` | — | Cancel |

---

### `cancel()` → `void`

Abort any running test via `AbortController.abort()`.

---

### `setMode(mode)` → `void`

Switch UI mode. `'sim'` shows crypto cards; `'live'` shows upload/download cards.

---

### `setTarget(url)` → `void`

Set the TARGET URL input value. Takes effect on the next live run.

---

### `setAccessToken(token)` → `void`

Set the ACCESS TOKEN input. Value is masked in the execution log.

---

### `setDownloadUrl(url)` → `void`

Set the DOWNLOAD URL input.

---

### `getLastResult()` → `SimResult | { upload, download } | null`

Return the most recent test result. `null` if no test has run yet.

---

### `getHistory()` → `Array<{ ts: number, result }>`

Return the last 10 test results with Unix timestamps.

---

## Events

| Event | When | Detail |
|-------|------|--------|
| `tool:ready` | After `api.activate()` | `{ instanceId, version }` |

---

## Progress callbacks

### `UploadProgress` (from sg-send-upload v1.1.0)

```typescript
interface UploadProgress {
    percent:        number;
    stage:          'initiating' | 'uploading' | 'completing' | 'complete';
    chunksTotal:    number;
    chunksDone:     number;
    bytesTotal:     number;
    bytesUploaded:  number;
    bytesPerSecond: number;   // rolling-window average
    etaSecs:        number;   // Infinity if unknown
    threadCount:    number;   // active parallel threads
}
```

### `DownloadProgress` (from sg-send-download v1.0.0)

```typescript
interface DownloadProgress {
    percent:         number;
    stage:           'initiating' | 'downloading' | 'assembling' | 'decrypting' | 'complete';
    chunksTotal:     number;
    chunksDone:      number;
    bytesTotal:      number;
    bytesDownloaded: number;
    bytesPerSecond:  number;
    etaSecs:         number;
    threadCount:     number;
}
```

---

## Known limitations

- **Live download requires CORS** — the target URL must be accessible from the browser (CORS headers present). The SG/Send download endpoint (`${sendUrl}/${transferId}`) is the raw viewer URL, not a direct binary stream; probe it with a direct presigned URL if available.
- **Live upload requires an access token** — without it, only the download test runs.
- **Sim mode does not measure memory bandwidth** — it measures only the AES-256-GCM SubtleCrypto throughput; memory copy/allocation costs are included but not isolated.
- **chunkedDownloader.probe()** requires the server to return `Content-Length`. Static file servers typically do; some CDNs do not.
