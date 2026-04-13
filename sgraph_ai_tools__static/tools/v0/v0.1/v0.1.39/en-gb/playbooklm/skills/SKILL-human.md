# PlaybookLM — Human Guide

**Tool:** PlaybookLM v0.1.39
**URL:** `/v0/v0.1/v0.1.39/en-gb/playbooklm/`

## What This Tool Does

PlaybookLM is a five-step AI-powered slide deck generator. Upload source documents,
generate a presentation strategy, create slide briefs, generate slide images using an
image AI, then export your deck as PDF or ZIP.

---

## Quick Start

1. **Enter your OpenRouter API key** at the top and click **Connect**.
2. **Step 1 — Sources:** Upload your source files (text, markdown, PDF text layer).
3. **Step 2 — Presentation:** Click *Generate Strategy* to create a presentation document.
4. **Step 3 — Slide Briefs:** Choose how many slides (default 8) and click *Generate Briefs*.
5. **Step 4 — Generate:** Click *Generate All Slides* — each slide appears as a tab on the right.
6. **Step 5 — Export:** Download your deck as a PDF or a ZIP of PNG images.

---

## Step-by-Step Guide

### Step 1: Sources

Drop files onto the drop zone or click to browse. Supported formats:
- Plain text (`.txt`)
- Markdown (`.md`)
- JSON, CSV, HTML
- JavaScript, TypeScript, Python
- PDF (the text layer is extracted by your browser)

Each loaded source appears in the list with its character count. Click **×** to remove.

### Step 2: Presentation Strategy

Analyses all loaded sources and produces a structured presentation document covering:
- Core theme and key message
- Target audience and tone
- Main narrative arc (3–5 key points)
- Recommended visual style
- Statistics and quotes to highlight

You can **edit the strategy** directly in the textarea before generating slide briefs.

### Step 3: Slide Briefs

Generates one brief per slide. Each brief contains:
- **Title:** Short slide heading
- **Prompt:** Detailed visual prompt for the image AI

You can **edit any brief** before generating. Use **+ Add** to add a blank brief.
Remove slides with the **×** button.

### Step 4: Generate Slides

Click **Generate All Slides** to generate images for all briefs in sequence.
Or click the **Generate** button on individual cards to regenerate one slide.

Each completed slide appears as a tab in the right panel. Click a slide card to
switch to its tab. Slides already generated can be regenerated with a fresh prompt.

### Step 5: Export

- **Export PDF** — A4 landscape, one slide per page, downloaded as `playbooklm-deck.pdf`
- **Export ZIP** — All slides as `slide-01.png`, `slide-02.png`, etc., in a single ZIP

Only slides with completed images are included.

---

## JS API Panel

Click the **footer bar** at the bottom to open the developer panel:

- **Explorer** — Live health check, registered methods, event log
- **> Console** — Call any API method interactively
- **Manifest** — Full manifest.json: identity, api schema, dependencies
- **Skills** — This guide, browser automation guide, and API spec

---

## Tips

- Edit the presentation strategy before generating briefs to control the narrative
- Edit individual slide briefs to refine the visual prompt for better images
- Regenerate individual slides to try different interpretations
- The **Stop** button cancels all in-progress slide generations
- Export images before closing — results are not saved between reloads
- Use the JS API Console to call `getState()` and inspect the full pipeline state
