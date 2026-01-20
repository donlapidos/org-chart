# RRC PDF Template Integration Plan

This document outlines how to reuse the extracted layout specs (`executive_summary.md`, `orgchart_analysis.md`, `pdf_layout_summary.txt`, `pdf_layout_analysis.json`) to make the bulk export match the official *CurrentOrgChart* deck.

## 1. Assets & Data

| File | Purpose |
| --- | --- |
| `executive_summary.md` | High‑level orientation (page types, typography scale, color system). |
| `orgchart_analysis.md` | Narrative description of every section for context. |
| `pdf_layout_summary.txt` | Quick stats per page (counts, structural notes). |
| `pdf_layout_analysis.json` | Machine‑readable coordinates, widths/heights, element inventory. |

Action Items
1. Commit these files (done) so engineers stay in sync with the design authority.
2. Add any missing brand assets (logos, icons, fonts) under `app/assets/export/` once they are sourced from design.

## 2. Template Configuration

Define a JSON (or TS) config that mirrors `pdf_layout_analysis.json` but distilled for runtime:

```ts
interface PageTemplate {
  id: 'cover' | 'overview' | 'department';
  canvas: { widthPt: 1680, heightPt: 947 };
  zones: Array<{
    id: 'header' | 'content' | 'footer' | 'sidebar';
    xPt: number;
    yPt: number;
    widthPt: number;
    heightPt: number;
    background?: Fill;
    elements: ElementSpec[];
  }>;
}
```

* Use the 16:9 canvas from the PDF and convert to millimetres before drawing in jsPDF (`mm = pt × 25.4 ÷ 72`).
* Capture recurring box dimensions: Level‑1 nodes `400×120pt`, level‑2 `350×100pt`, level‑3 `250×90pt`, horizontal spacing `20‑50pt`, vertical `50‑80pt`.
* Encode footer height (61 pt = 6.4 % page height) and other ratios so scaling to A3/A4 later stays proportional.

## 3. Rendering Pipeline Updates

### 3.1 Chart Snapshot
- Switch `renderChartOffScreen` to optionally capture SVG (`chart.exportSvg`) so text stays vector; fall back to PNG when necessary.
- Match PDF aspect ratio by setting `canvasDiv` to 1680×947 and disabling white margins inside OrgChart.
- Provide two “views”: (a) full tree, (b) zoomed department view if tree exceeds target scale. Store both for layout composition.

### 3.2 Cover + Overview Pages
1. **Cover**: draw header typography using the recorded font sizes (100 pt / 53 pt / 22 pt) and place metadata (date stamp, tagline) at the specified coords.
2. **Overview**: build a reusable function `drawDivisionColumn(div: DivisionSpec, columnIndex)` that creates the five equal columns (≈336 pt width). Fill division data from storage (department list). Use connectors as simple vertical lines to mimic the original look.

### 3.3 Department Pages
1. Hydrate department data (manager + team) from chart dataset (or compose from OrgChart nodes).
2. Map nodes to three tiers. Use the template config for box dimensions, text sizes, and spacing.
3. Draw connectors (4 pt stroke) by emulating the original straight‑line style rather than relying on screenshot.
4. Embed the actual org chart snapshot into the “content zone” if a bitmap representation is still required.

### 3.4 Footer & Metadata
- Standard footer: dark rectangle (#1A1A1A) across width, 61 pt tall, white text (classification, URL, page number).
- Add helper `drawFooter(pdf, pageNumber, totalPages, context)` and invoke on every page.

### 3.5 Fonts & Colors
- Add brand font files (Circular or agreed equivalent) and register them with jsPDF:
  ```js
  pdf.addFileToVFS('Circular-Bold.ttf', base64);
  pdf.addFont('Circular-Bold.ttf', 'Circular', 'bold');
  ```
- Maintain the monochrome palette unless design says otherwise.

## 4. Code Organization

1. Create `app/js/export-template.js` that exports functions `drawCoverPage`, `drawOverviewPage`, `drawDepartmentPage`.
2. Refactor `BulkExportManager.assemblePDF` to orchestrate:
   - Add cover page → `drawCoverPage`.
   - Add overview page (optional) → `drawOverviewPage`.
   - For each captured chart (department), call `drawDepartmentPage({ chart, snapshot })`.
3. Keep `BulkExportManager` focused on data fetch + rendering pipeline; move layout math into the new module for clarity and testing.

## 5. Testing Checklist

1. **Unit**: Add Jest (or similar) tests for conversion helpers (pt→mm, alignment calculations) using values from `pdf_layout_analysis.json`.
2. **Visual**: Export sample cover, overview, and HR department pages and compare against the PDF (manual QA or pixel diff).
3. **Performance**: Verify export time with SVG snapshots vs PNG; adjust `quality` presets accordingly.
4. **Accessibility**: Ensure all text uses embedded fonts so copy/paste from PDF remains possible.

## 6. Next Actions

1. Import brand fonts/logos from design team.
2. Transform `pdf_layout_analysis.json` into a slimmer `export-template.json`.
3. Implement `export-template.js` with hard‑coded measurements from the spec.
4. Update `bulk-export.js` to use the new template module and SVG snapshots.
5. QA with `CurrentOrgChart (1).pdf` side‑by‑side; iterate on spacing until alignment matches.

Once these steps are complete, the exported PDFs will mirror the official deck while remaining data‑driven.
