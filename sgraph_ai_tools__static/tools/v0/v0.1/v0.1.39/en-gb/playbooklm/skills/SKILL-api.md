# PlaybookLM — JS API Specification

**Tool:** PlaybookLM v0.1.39
**API version:** 0.1.0
**Entry point:** `window.__tool`

## Overview

PlaybookLM exposes a 19-method JS API via `window.__tool`. All methods are available
from the browser console, Playwright scripts, and other tools.sgraph.ai tools.

The pipeline has five stages:
1. **connect** — authenticate with OpenRouter
2. **loadSources / getSources / removeSource** — manage input documents
3. **generatePresentation / getPresentation / setPresentation** — Step 2
4. **generateSlideBriefs / getSlideBriefs / setSlideBrief / addSlideBrief / removeSlideBrief** — Step 3
5. **generateSlide / generateAllSlides / getSlideResults** — Step 4
6. **exportDeck** — Step 5
7. **getState / getPipelineStatus / stop** — utilities

---

## Methods

### `connect(params?)`
**Async.** Authenticates with OpenRouter and stores credentials in the pipeline state.

```typescript
connect(params?: {
  apiKey?: string;      // OpenRouter key (secret)
  textModel?: string;   // Default: 'google/gemini-2.5-flash-preview'
  imageModel?: string;  // Default: 'google/gemini-3.1-flash-image-preview'
}): Promise<{ provider: 'openrouter', textModel: string, imageModel: string }>
```

---

### `loadSources(files)`
**Async.** Add source documents to the pipeline state.

```typescript
loadSources(files: Array<{
  name: string;
  type: string;       // MIME type, e.g. 'text/plain'
  textContent: string;
}>): Promise<Array<Source>>
```

---

### `getSources()`
**Sync.** Returns all currently loaded sources.

```typescript
getSources(): Array<{ name: string, type: string, textContent: string }>
```

---

### `removeSource(index)`
**Sync.** Removes source at the given index.

```typescript
removeSource(index: number): void
```

---

### `generatePresentation(params?)`
**Async.** Generates a presentation strategy document from loaded sources.

```typescript
generatePresentation(params?: {
  model?: string;   // Override text model for this call
}): Promise<string>  // The presentation document text
```

---

### `getPresentation()`
**Sync.** Returns the current presentation document.

```typescript
getPresentation(): string
```

---

### `setPresentation(text)`
**Sync.** Manually set the presentation document text.

```typescript
setPresentation(text: string): void
```

---

### `generateSlideBriefs(params?)`
**Async.** Generates slide briefs from the presentation document.

```typescript
generateSlideBriefs(params?: {
  count?: number;   // Number of slides (default: 8, max: 24)
  model?: string;   // Override text model for this call
}): Promise<Array<{ title: string, prompt: string }>>
```

---

### `getSlideBriefs()`
**Sync.** Returns all current slide briefs.

```typescript
getSlideBriefs(): Array<{ title: string, prompt: string }>
```

---

### `setSlideBrief(params)`
**Sync.** Update a single slide brief by index.

```typescript
setSlideBrief(params: {
  index: number;
  brief: { title?: string, prompt?: string };
}): void
```

---

### `addSlideBrief(brief)`
**Sync.** Add a new slide brief at the end.

```typescript
addSlideBrief(brief: { title: string, prompt: string }): void
```

---

### `removeSlideBrief(index)`
**Sync.** Remove a slide brief by index.

```typescript
removeSlideBrief(index: number): void
```

---

### `generateSlide(params)`
**Async.** Generate the image for a single slide.

```typescript
generateSlide(params: {
  index: number;        // Which brief to generate (0-based)
  model?: string;       // Override image model for this call
  template?: string;    // Optional template style hint
}): Promise<{ index: number, imageSrc: string }>
```

---

### `generateAllSlides(params?)`
**Async.** Generate images for all slide briefs.

```typescript
generateAllSlides(params?: {
  model?: string;       // Override image model for all slides
  parallel?: boolean;   // true = all at once; false = sequential (default: false)
}): Promise<Array<{ index: number, imageSrc: string }>>
```

---

### `getSlideResults()`
**Sync.** Returns all slide generation results.

```typescript
getSlideResults(): Array<{
  index:    number;
  imageSrc: string | null;
  status:   'pending' | 'generating' | 'complete' | 'error';
  error:    string | null;
}>
```

---

### `exportDeck(params?)`
**Async.** Export all completed slides.

```typescript
exportDeck(params?: {
  format?: 'pdf' | 'zip';  // default: 'pdf'
}): Promise<void>
```

Requires **jsPDF** (for PDF) or **JSZip** (for ZIP) to be loaded — both are included via the manifest loader.

---

### `getState()`
**Sync.** Full pipeline state snapshot.

```typescript
getState(): {
  connected:       boolean;
  textModel:       string;
  imageModel:      string;
  sources:         Array<Source>;
  presentationDoc: string;
  slideBriefs:     Array<SlideBrief>;
  slideResults:    Array<SlideResult>;
  stopped:         boolean;
}
```

---

### `getPipelineStatus()`
**Sync.** Quick pipeline status summary.

```typescript
getPipelineStatus(): {
  connected:   boolean;
  sourceCount: number;
  briefCount:  number;
  slideCount:  number;   // count of completed slides
  stopped:     boolean;
}
```

---

### `stop()`
**Sync.** Abort all in-progress pipeline operations.

```typescript
stop(): void
```

---

## Events (on `window`)

| Event                | When                              | Detail                              |
|----------------------|-----------------------------------|-------------------------------------|
| `tool:ready`         | api.activate() called             | `{ instanceId, tool, version }`     |
| `tool:connected`     | connect() succeeds                | `{ instanceId, provider, model }`   |
| `plm:state-changed`  | Any state mutation                | `{}`                                |
| `plm:slide-complete` | A slide image is generated        | `{ index, imageSrc }`               |
| `plm:slide-error`    | A slide image generation fails    | `{ index, error }`                  |
| `plm:all-slides-complete` | All slides done              | `{ count }`                         |
| `plm:export-complete`| Export finishes                   | `{ format }`                        |
