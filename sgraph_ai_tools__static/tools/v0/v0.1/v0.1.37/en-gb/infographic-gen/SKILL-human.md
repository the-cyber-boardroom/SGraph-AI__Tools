# Infographic Generator — Human Guide

**Tool:** Infographic Generator v0.1.37
**URL:** `/en-gb/infographic-gen/`

## What This Tool Does

Generates infographic images from a text description (or an uploaded document), using
image-capable AI models via OpenRouter. Each generation opens as a new tab so you
can compare results side by side or run multiple models in parallel.

---

## Quick Start

1. **Enter your OpenRouter API key** in the key field at the top and click **Connect**.
   The status shows `Connected ✓ (model-name)` when ready.
2. **Type a description** in the text area, or pick a template chip to pre-fill one.
3. Optionally **attach a reference image** using the 📎 button (logo, screenshot, or
   example infographic you want the model to reference or match).
4. Click **▶ Send** (or press **Ctrl+Enter**).
5. The result appears as a new tab in the right panel. While generating you'll see
   an elapsed timer and a **■ Cancel** button.

---

## Templates

Seven built-in templates pre-fill the text area with a proven prompt:

| Template | What it generates |
|---|---|
| **Executive Summary** | 3–5 key metrics, headline finding, supporting data |
| **Architecture** | System components, connections, and data flows |
| **Timeline** | Horizontal timeline with dates, titles, and descriptions |
| **Comparison** | Side-by-side options with strengths, weaknesses, ratings |
| **Process Flow** | Numbered steps with icons and arrows |
| **Stats Dashboard** | Key numbers, percentages, trend chart, callout boxes |
| **Mind Map** | Central concept with 5–6 colour-coded branches |

Click a template chip, then customise the text before sending.

---

## Attaching a Reference Image (Text Mode)

Click the **📎** button in the action bar to attach a PNG, JPG, WebP, or GIF file.
A thumbnail strip appears below the text area confirming what's loaded.

**Use cases:**
- **Logo** — "Create an infographic in the style of this brand, using these colours"
- **Screenshot** — "Turn this chart/diagram into a polished infographic"
- **Reference infographic** — "Create something similar to this but about our Q3 results"

The image is sent alongside your text prompt as a multimodal message. Click **✕** in
the thumbnail strip to remove it. The attachment clears automatically when you switch
to Document mode.

---

## Document Mode

Switch to **Document** mode (toggle above the text area) to generate an infographic
*from a file* rather than a typed prompt.

**Supported formats:** PDF, Markdown, plain text, CSV, JSON, HTML, code files, images (PNG/JPG/WebP/GIF).

1. Drop a file onto the drop zone or click it to browse.
2. Optionally pick a **Focus** template to direct the AI:
   - **Key Points** — extract the 5–7 most important points
   - **Data & Stats** — visualise all numbers and metrics
   - **Timeline** — extract chronological events
   - **Executive Brief** — one-page summary
   - **Process Map** — workflow or steps
   - **Compare** — side-by-side comparison points
3. Optionally type a custom direction in the direction box.
4. Click **▶ Send**.

---

## Model Picker

The model dropdown shows curated image-capable models with cost and speed indicators:

- **★★★** — highest quality, slowest, most expensive
- **★★☆** — good quality, moderate speed and cost
- **★☆☆** — fastest, cheapest, good for iteration

Change the model between sends to run multiple models in parallel — each send opens
its own result tab regardless of which model is selected.

---

## Comparing Results Side by Side

1. Generate with Model A → result opens as tab "gemini-2.0-flash-exp"
2. Change model to Model B → click Send again → result opens as second tab
3. **Drag** the second tab to the right side of the right panel to split the view

---

## Export Options

Each result tab's Details pane has an **Export** section with three buttons:

- **Download** — saves the image as a PNG file
- **Copy** — copies the PNG to your clipboard (paste into docs/slides)
- **Share ↗** — encrypts and uploads the image to SG/Send, gives you a share link

---

## Advanced: System Prompt Override

Click **⚙ Advanced** at the bottom of the left panel to reveal the system prompt editor.

Replacing the default prompt lets you control:
- **Visual style** — dark/light background, colour palette, font choices
- **Output format** — SVG vs PNG, aspect ratio, dimensions
- **Content constraints** — max sections, level of detail, language

**Example overrides:**
```
You are a professional infographic designer. Use a dark navy background (#0a0a1a),
teal accent colour (#4ECDC4), and white body text. Always output SVG. Keep all text
to 12pt or larger. Use a 16:9 aspect ratio.
```

The system prompt can also be set programmatically via the JS API:
```js
window.__tool.setSystemPrompt('Your instructions here...');
window.__tool.setSystemPrompt(''); // reset to mode default
```

This is the clean alternative to embedding override instructions inside your user prompt.

---

## JS API Panel

Click the **footer bar** at the bottom of the page to open the developer panel:

- **⚡ Explorer** — live health check, registered methods, event log
- **> Console** — call any API method interactively (connect, generate, getState, …)
- **📋 Manifest** — full manifest.json: identity, api schema, dependencies
- **📄 Skills** — this guide, the browser automation guide, and the API spec

The Skills tab renders markdown for easy reading. Drag the top edge of the panel to
resize it. Click the footer bar again to collapse.

---

## Tips

- **Ctrl+Enter** sends without clicking the button
- The **■ Stop** button (appears during generation) cancels all active requests
- Result tabs are not saved between page reloads — export before closing
- If a model returns no image, try a model with ★★★ or switch to an SVG model
- The 📎 image attachment persists across multiple sends — clear it with ✕ when done
- Use **⚙ Advanced** to set a system prompt once rather than repeating style instructions in every prompt
- The JS API Console (`> Console` tab) lets you call `getGenerations()` to inspect the full
  request/response log for any generation in the current session
