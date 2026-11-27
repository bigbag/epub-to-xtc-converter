# PDF → XTC/XTCH Conversion — Design Spec

- **Date:** 2026-11-27
- **Status:** Approved in brainstorming (all design sections reviewed)
- **Scope:** CLI (`cli/`) and web app (`web/`), Xteink X4 primary target (all existing device presets work)

## 1. Background & Intent

The converter today turns EPUB into XTC (1-bit) / XTCH (2-bit) via CREngine WASM.
CREngine cannot render PDF. Users want to read PDFs — both text-heavy books and
technical/layout-rich books (reference example: `example/Network Warrior, 2nd Edition.pdf`,
~785 pages, 504×661.5 pt pages, bookmarks present, unencrypted) — on the Xteink X4 (480×800).

PDF is fixed-layout: there is no reflow. Each PDF page is rendered to a bitmap, mapped
onto device pages, then pushed through the **existing, unchanged** pipeline:
dither → negative → progress bar (web) → XTG/XTH encode → XTC container.

**Success criteria**

1. `node index.js convert book.pdf -o book.xtc` produces a valid XTC with correct page
   count, metadata, and chapter navigation from PDF bookmarks.
2. The web app accepts PDFs with preview, chapter list, settings, and export parity
   with EPUB (single, current page, batch ZIP).
3. Optional margin trimming and a zoom factor (1.0–3.0) work identically in CLI and web;
   zoom > 1 splits a PDF page into multiple device pages with pixel-exact layout.
4. The *Network Warrior* example converts end-to-end in both surfaces with readable
   figures and a usable TOC.
5. Existing EPUB conversion and optimizer behavior is unchanged; existing tests pass.

## 2. Agreed Requirements

| Decision | Choice |
|---|---|
| Surfaces | Both CLI and web |
| PDF engine | **pdf.js** (`pdfjs-dist`, Apache-2.0). MuPDF rejected (AGPL vs repo MIT); PDFium rejected (no official WASM, more glue) |
| Page mapping | Fit whole page by default; optional auto-trim of white margins |
| Bigger text | **Zoom & split** (layout-preserving). Text reflow explicitly rejected |
| EPUB path | Untouched — no refactor of working CREngine code |

## 3. Out of Scope

- Text reflow / PDF→EPUB conversion
- Password-protected PDFs (clear error, no password prompt)
- PDF support in the Optimizer tab (remains EPUB-only; PDFs skipped with a notice)
- Multi-column-aware tile reading order, tile overlap, page reordering
- XTC/XTCH format changes
- Rendering interactive form fields beyond pdf.js defaults (annotation appearance
  streams render per pdf.js default behavior)

## 4. Architecture & Components

A PDF document source implements the same implicit contract CREngine already provides:

```
source = {
  pageCount,                     // device pages (after tiling)
  info: { title, author },
  toc: [{ title, page }],        // page = 0-based DEVICE page index
  renderPage(i) → RGBA           // Uint8ClampedArray, width*height*4, device dimensions
}
```

### New files

| File | Role |
|---|---|
| `web/pdf-core.js` | Pure, DOM-free logic shared by both sides: layout math (content box → scale → tile grid), content-box detection, outline flattening, TOC device-page mapping, settings validation helpers. Dual export: `module.exports` when present, else a browser global (same pattern the CLI already uses to require `web/crengine.js`). |
| `web/pdf-source.js` | Browser adapter: pdf.js + canvas → source contract. |
| `cli/pdf-renderer.js` | Node adapter: `pdfjs-dist` + `@napi-rs/canvas` → source contract; `convertPdf(inputPath, outputPath, settings, progressCallback)` mirroring `convertEpub`'s structure (render → dither → negative → encode → container → write). |
| `cli/pdf-core.test.js` | Unit tests for `web/pdf-core.js` (`node --test`). |
| `cli/pdf-convert.test.js` | Integration tests: generated PDF fixture → XTC bytes assertions. |
| `web/pdf.test.js` | Browser-console smoke script following `web/status-bar.test.js` pattern. |

### Changed files (minimal)

- `cli/index.js` — extension dispatch (`.epub` → `convertEpub`, `.pdf` → `convertPdf`,
  compared lowercased); file collector generalized to take an `include` glob — convert
  uses `*.{epub,pdf}`, optimizer keeps `*.epub`; `getOutputPath` strips the actual
  extension instead of hardcoded `.epub`; new `--zoom` / `--trim-margins` flags;
  font requirement computed from the input set.
- `cli/settings.js` — new `pdf` section in defaults and `init` output; validation for it;
  `validateSettings(settings, { requireFont })` (PDF-only input sets skip the font check).
- `cli/encoder.js` — byte-safe truncation fix only (see §8).
- `cli/package.json` — deps `pdfjs-dist`, `@napi-rs/canvas`; script `test:pdf`.
- `web/index.html` — accept `.pdf` on the file input; PDF settings panel markup;
  pdf.js loaded via pinned CDN URL (dynamic import, see §7).
- `web/app.js` — `handleFiles` accepts `.pdf`; `switchToFile` branches per file type;
  `renderCurrentPage` / `renderPageForExport` / `generateXTC` call the active source;
  text-settings controls disabled while a PDF is active; layout recompute on
  zoom/trim/device/orientation changes; export filenames replace the actual extension;
  optimizer skips PDFs with a notice.

**Untouched:** CREngine files, EPUB conversion logic, `dither.js` / dither worker,
XTG/XTH encoding math, container layout, optimizer logic, Docker/deploy.

## 5. Page Mapping & Data Flow

One unified layout model per PDF page — fit, trim, and zoom are parameters, not modes.

### 5.1 Layout computation

Inputs: PDF page viewport at scale 1 (`vw × vh`, pdf.js applies `/Rotate`), screen
`W × H` (current orientation), options `{ trimMargins, zoom }`.

1. **Content box** (in PDF units):
   - `trimMargins: false` → full page `(0, 0, vw, vh)`.
   - `trimMargins: true` → detected bounding box (§5.2), expanded by a safety padding.
2. **Base scale** = `min(W / bw, H / bh)` (contain-fit of the content box).
3. **Render scale** `s = baseScale × zoom`.
4. **Render** the full PDF page at scale `s` into a canvas of
   `round(vw × s) × round(vh × s)`, initialized white (opaque); the content rect is
   `round(bbox × s)` within it. Let `cw × ch` be the integer content dimensions.
5. **Tile grid**: `cols = ceil(cw / W)`, `rows = ceil(ch / H)`. Tiles are emitted
   **row-major** (top-to-bottom, left-to-right). Tile `(r, c)` copies source rect
   `(c·W, r·H, min(W, cw − c·W), min(H, ch − r·H))` to the **top-left** of a white
   `W × H` canvas; partial edge tiles are padded white on right/bottom.
6. `zoom = 1.0` always yields exactly one tile — that **is** fit mode. The tile is
   centered on the white canvas (both axes) when it is the only tile.

**Worked example (Network Warrior, X4 portrait):** 504×661.5 pt → base scale ≈ 0.952 →
480×630 content centered on 480×800 (≈85 px white bands top/bottom). Zoom 1.5 →
720×945 → 2×2 = 4 device pages. Single-column content at zoom ≤ ~1.27 stays within
480 px width → vertical strips, natural reading order.

### 5.2 Trim detection

- One-time pre-pass when `trimMargins` is enabled: render each page at detection scale
  `200 / max(vw, vh)` (longest side ≈ 200 px).
- Background = pixels with **all RGB channels ≥ 250** (canvas is opaque; alpha ignored).
  Content box = bbox of non-background
  pixels, expanded by **2 detection pixels per side**, clamped to page bounds, converted
  to PDF units. Fully blank page → full-page box.
- Results cached per page for the session; reused by layout math and rendering.
- The pre-pass makes TOC device-page mapping exact at load time without full-res renders.

### 5.3 TOC & metadata

- `getOutline()` → nested items. Resolve each `dest` (explicit array or named destination
  via `getDestination`) to a 0-based PDF page index with `getPageIndex`.
- Flatten depth-first. Entries with unresolvable destinations are skipped but their
  children are still traversed.
- Map to device pages: `tocPage = prefixSum[pdfPage]`, where prefix sums accumulate
  per-page tile counts. Layouts for all pages are computed at load (cheap: viewport math
  only, plus the trim pre-pass when enabled), so `pageCount` and TOC are exact before
  any full-res render.
- Metadata: `getMetadata().info.Title` / `.Author`; fallbacks: filename stem for title,
  empty author (CLI) / "Unknown author" (web, existing behavior).

### 5.4 Runtime flow

- **Load:** read file → pdf.js document → layouts for all pages → `pageCount`, `toc`,
  `info` → preview page 0.
- **Preview:** `renderPage(deviceIndex)` → locate layout (binary search over prefix
  sums) → render PDF page at final scale → extract tile → RGBA.
- **Export:** loop device pages → RGBA → dither (existing) → negative (existing) →
  progress bar (web, existing) → `encodeXTG`/`encodeXTH` → `buildXTCContainer`.
- **Settings change** (zoom/trim/device/orientation): recompute layouts, refresh TOC
  mapping and preview. EPUB path keeps its existing behavior.

## 6. CLI & Web Surfaces

### 6.1 CLI

```bash
node index.js convert book.pdf -o book.xtc -c settings.json
node index.js convert ./library/ -o ./output/ -c settings.json   # EPUB + PDF, recursive
node index.js convert book.pdf --zoom 1.5 --trim-margins
```

- New settings section (also in `init` output):
  ```json
  "pdf": { "trimMargins": false, "zoom": 1.0 }
  ```
- Flags `--zoom <n>` and `--trim-margins` override config (existing priority rule).
- Validation: `zoom` finite and in **[1.0, 3.0]**; `trimMargins` boolean.
  `font.path` required **only if the input set contains an EPUB**.
- Output naming: `book.pdf` → `book.xtc` / `book.xtch` (actual extension stripped).
- Progress reported in device pages; failed file reports an error and the batch continues
  (single-file failure exits 1), matching EPUB behavior.

### 6.2 Web

- Drop zone + file picker accept `.pdf`; mixed EPUB/PDF batches and ZIP export work.
- While a PDF is active: text settings (font family/size/weight, line height, margins,
  alignment, hyphenation) are disabled/grayed. A **PDF panel** appears:
  - *Trim margins* checkbox (default off)
  - *Zoom* control, 1×–3× in 0.25 steps (default 1×)
- Device preset, orientation, monitor DPI, quality mode, dithering, negative, and
  progress bar remain active (they operate on device bitmaps, source-agnostic).
- Chapter list, preview navigation, single-page export, Export All: existing machinery
  fed by the PDF source. Export filenames replace the actual extension.
- Optimizer tab: PDFs skipped with a notice.

## 7. Engine Integration

- **Version:** latest stable `pdfjs-dist` at implementation time; the **exact version is
  pinned identically** in `cli/package.json` and the web CDN URL. **Legacy build** in both
  environments to preserve stated browser support (Chrome 90+, Firefox 88+, Safari 14+).
- **Web:** dynamic `import()` of the pinned legacy ESM build from jsDelivr's npm mirror
  (no build step, consistent with the CDN pattern used for JSZip). `workerSrc`,
  `standardFontDataUrl`, and `cMapUrl` (with `cMapPacked: true`) point at the same pinned
  version on the CDN. Browsers without module-worker support (Safari 14) fall back to
  pdf.js's main-thread fake worker — slower but functional.
- **Node:** dynamic `import()` of `pdfjs-dist/legacy/build/pdf.mjs` from CommonJS.
  Canvas via `@napi-rs/canvas` (prebuilt binaries, no node-gyp) through a custom
  CanvasFactory (`create`/`reset`/`destroy`). Headless configuration: no worker,
  `isEvalSupported: false`, `disableFontFace: true`; `standardFontDataUrl` and `cMapUrl`
  point into the installed `pdfjs-dist` package. Exact flags verified against the fixture
  tests during implementation.
- **Behavior parity:** both adapters feed the same `web/pdf-core.js` logic, so layout,
  trim, tiling, and TOC mapping are identical by construction.

## 8. Error Handling & Limits

| Condition | Behavior |
|---|---|
| Password-protected PDF | Clear "password-protected PDFs are not supported" error |
| Corrupt/invalid PDF, zero pages | Per-file error; batch continues, single file exits 1 |
| Page render failure | Fails the file; never silently emits a blank page |
| Render canvas side > 8192 px | Error suggesting a lower zoom |
| Device page count > 65535 | Error (XTC page-count and chapter fields are uint16) |
| Cleanup | pdf.js document destroyed on file switch / after conversion; Node canvases released |

**Targeted encoder fix (in scope):** `buildXTCContainer` currently truncates strings by
*character* count (`substring(0, 78)` etc.) before UTF-8 encoding — multi-byte titles can
overflow their fixed-size fields. PDF TOCs commonly contain non-ASCII titles, so this work
changes truncation to **byte-safe**: encode first, then slice to the field capacity
(title ≤ 127 bytes, author ≤ 63 bytes, chapter title ≤ 79 bytes), preserving null
termination. Applies to EPUB output too (pure bug fix, no layout change). Covered by tests.

## 9. Testing

TDD during implementation; `node --test` in `cli/`, matching `stable-pages.test.js`.

1. **`cli/pdf-core.test.js`** — layout math across aspect ratios and zoom levels
   (tile counts, edge padding, single-tile centering); trim detection on synthetic
   bitmaps (blank page, bordered content, threshold boundary); outline flattening and
   prefix-sum TOC mapping (incl. unresolvable dest); settings validation (zoom range,
   font-requirement rule).
2. **`cli/pdf-convert.test.js`** — a minimal PDF fixture generated in-test (3 pages,
   612×792, 2-entry outline, programmatic xref offsets; zero new dependencies) →
   `convertPdf` → assert XTC magic (`XTC\0`/`XTCH`), dimensions, page count, chapter
   entries and their device-page targets; XTCH variant; zoom 2 → expected page
   multiplication; trim → larger content scale; byte-safe truncation with a non-ASCII
   chapter title.
3. **Script:** `npm run test:pdf` (existing suites untouched).
4. **`web/pdf.test.js`** — browser-console script in the `status-bar.test.js` style:
   load PDF, chapter navigation, zoom change → page count change, export header sanity.
5. **Manual smoke:** *Network Warrior* through CLI and web — TOC, figures, readability;
   on-device check on the X4 by the user.

## 10. Documentation

README updates: PDF feature bullet, CLI/web usage examples, `pdf` settings section,
new dependencies, and limitations:

- Multi-column pages at zoom > 1 read across columns (row-major tiles).
- No reflow; no encrypted-PDF support.
- Output size grows with page count: ~38 MB for 785 pages at 1-bit/zoom 1; roughly 4×
  at zoom 2 (device storage permitting).

## 11. Risks & Known Limitations

- **pdf.js fidelity** on exotic PDFs is below MuPDF/PDFium; acceptable for the target
  use case, and the fixture + example smoke tests guard the common path.
- **`@napi-rs/canvas`** ships prebuilds for macOS/Linux/Windows; unsupported platforms
  would need a source build (documented in README if it arises).
- **Safari 14** renders on the main thread (fake worker) — slower, functional.
- **Large zoom × large pages** increases memory and output size; the 8192 px and
  65535-page guards fail loudly instead of corrupting output.
