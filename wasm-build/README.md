# `wasm-build/` — Docker-based CREngine WASM rebuild

Reproduces `web/crengine.wasm` from upstream
[buggins/coolreader](https://github.com/buggins/coolreader) using
Emscripten. Produces a drop-in replacement for the vendored binary.

## Status: working, parity with vendored

From the repo root:

```bash
make wasm
```

(or step-by-step: `make wasm-build` → `make wasm-run` → `make wasm-install`)

Tested with the bundled `jane-austen_pride-and-prejudice.epub` via the
CLI at xteink-x4 dimensions, Literata 34 px, 16 px margins:

- Page count — vendored 2217, rebuilt 2257 (**+1.8 %**)
- Output `.xtc` size — vendored 106 MB, rebuilt 108 MB (+1.8 %)
- TOC entries — 65 in both, identical titles
- Title / authors / series / language — populated identically
- `getDocumentInfo()` keys — match the schema documented in
  [`docs/building-crengine-wasm.md`](../docs/building-crengine-wasm.md)
- Framebuffer format — 480×800 RGBA, 1.5 MB in both

The new WASM is slightly larger (4.3 MB vs 3.7 MB) because it links
chmlib, antiword, qimagescale and a newer harfbuzz. Layout drift on
the user-facing CLI flow is **<2 %**.

### How the parity was reached

Two engine quirks combined to cause ~21 % drift in the first cut:

1. **Default interline spacing.** The vendored binary's effective
   interline is ~120 %; upstream CoolReader defaults to 100 %. Fixed
   by setting `PROP_INTERLINE_SPACE = 120` in `applyDefaultProps()`
   ([`EpubRenderer.cpp` ctor](EpubRenderer.cpp)).
2. **Page header reservation.** `LVDocView::getPageHeaderHeight()`
   returns 0 if `m_infoFont` is null, which it is at construction
   time (no fonts registered yet). Pagination then ignores the header
   reservation and packs ~10 % more text per page. Fixed by calling
   `setInfoFont()` after `RegisterFont()` in `registerFontFromMemory`
   and re-triggering layout in `configureStatusBar` (which the CLI
   and web app both call). See
   [`registerFontFromMemory`](EpubRenderer.cpp) and
   [`configureStatusBar`](EpubRenderer.cpp).

The remaining ~2 % drift comes from minor font-shaping/hyphenation
differences between freetype/harfbuzz versions — well under the user's
"almost same" bar.

## Files

- [`Dockerfile`](Dockerfile) — Ubuntu 24.04, emsdk, and build patches
- [`build.sh`](build.sh) — runs inside container; cmake + deps + crengine + em++ link
- [`EpubRenderer.cpp`](EpubRenderer.cpp) — Embind wrapper (~210 lines) binding `LVDocView` to the JS API
- [`post.js`](post.js) — bridges `Module._allocateMemory`/`_freeMemory` to non-underscore names the JS callers expect
- [`scripts/normalize-patches.py`](scripts/normalize-patches.py) — rewrites bundled patch headers to uniform `a/foo`, `b/foo` so `patch -p1` works regardless of upstream convention
- [`patches/`](patches/) — engine patches that the Docker build applies

## Patches applied (consolidated)

The Dockerfile applies these changes with `sed`, `COPY`, `ln`, and `patch`:

1. **CMake minimum version** — bump `cmake_minimum_required(VERSION 3.0)` → `3.10`. Modern CMake refuses 3.0.
2. **`zlib.meta.sh`** — URL → `zlib.net/fossils`, ext → `.tar.gz`, SHA512 recomputed. Upstream removed the `.tar.xz`.
3. **`zstd.meta.sh`** — ext → `.tar.gz`. GitHub release only ships `.gz`; the pinned SHA512 already matches it.
4. **Bundled `.patch` headers** — rewritten to uniform `a/`/`b/` prefix via `normalize-patches.py`. Some upstream patches use `--- foo.orig` (needs `-p0`), others use `--- libpng-orig/foo` (needs `-p1`); normalising lets `patch -p1` handle both.
5. **freetype `FT_WITH_*`** — `FT_WITH_ZLIB ON` / `FT_WITH_PNG ON` → `OFF`. freetype 2.11 reads `FT_WITH_*`, not `FT_DISABLE_*` (CoolReader's hand-coded `FT_DISABLE_*` was a no-op).
6. **`cr3gui` subdir** — `ADD_SUBDIRECTORY(cr3gui)` commented out. Executable frontend, not needed for WASM.
7. **`CR_INTERNAL_PAGE_ORIENTATION`** — `0` → `1` for the CRGUI_XCB block. Without it, `lvdocview.cpp:6675` references missing `m_rotateAngle`.
8. **Warnings-as-errors** — `add_compile_options(-Wno-error -w)` after `PROJECT()`. harfbuzz 2.8.2 trips modern Clang's `-Wcast-function-type-strict` (default-error).
9. **`crengine` includes + props** — appended `target_include_directories(crengine PRIVATE …)` listing every bundled lib's source + build dir, plus `target_compile_definitions(crengine PRIVATE USE_FONTCONFIG=0)`. Cross-subdir headers (`fribidi-config.h`, etc.) aren't visible to crengine, and `crsetup.h` defaults `USE_FONTCONFIG=1` though we have no fontconfig.
10. **fribidi include layout** — after deploy, `ln -sf . thirdparty/fribidi-1.0.10/lib/fribidi`. Sources use `#include <fribidi/fribidi.h>`.
11. **Inline code ([issue #10](https://github.com/bigbag/epub-to-xtc-converter/issues/10))** — separate the default `code` and `pre` rules. The `code` rule uses inline display. It uses the parent element's `white-space` value. The `pre` rule keeps line breaks. Publisher CSS can change these defaults.
12. **FreeType download** — use the Savannah release mirror. Keep the original checksum.

Plus cmake flags at configure time:
`-DCMAKE_DISABLE_FIND_PACKAGE_{PNG,ZLIB,BZip2,HarfBuzz,BrotliDec}=TRUE`
to force every dep to come from the bundled subdirectories.

## EpubRenderer wrapper

[`EpubRenderer.cpp`](EpubRenderer.cpp) binds `LVDocView` via Embind to
match the API surface in
[`docs/building-crengine-wasm.md`](../docs/building-crengine-wasm.md#required-javascript-interface).

Notable choices:

- Holds `std::unique_ptr<LVDocView>` and `std::unique_ptr<LVColorDrawBuf>` (both deferred to ctor body so `InitFontManager("")` runs before `LVDocView`'s ctor)
- `loadEpubFromMemory` passes `U"book.epub"` as the filename hint so format detection picks the EPUB reader, then calls `Render(w, h, NULL)` to force layout
- `getFrameBuffer()` returns a `Uint8Array` view onto the WASM heap via `emscripten::typed_memory_view` — no copy
- `getDocumentInfo()` reads from both `m_view->getDocProps()` (user props) and `m_doc->getProps()` (EPUB metadata) and exposes both `author` and `authors` keys for compatibility
- `registerFontFromMemory` stages bytes to MEMFS and registers via path (no `RegisterDocumentFontFromMemory` API in this CoolReader version)

## Reproducibility

The Dockerfile uses these versions:

- Ubuntu 24.04 base
- CoolReader revision `064723eace938389fb99f84518ce773ede38dbdf`. This revision matches the dependency versions in `build.sh`. The current upstream HEAD does not match these versions. It also does not match the build patches.

The build selects `latest` for Emscripten by default.
The WASM files for issue #10 use Emscripten 6.0.9.
Use `--build-arg EMSDK_VERSION=6.0.9` with `docker build` to select that version.

Build takes ~15 min on a modern laptop. Most of the time is in
emsdk install + harfbuzz compile.

## Code layout regression check

Run these commands from the repository root.
Use the path to a local TTF or OTF font.

```bash
npm ci --prefix cli
node cli/code-layout.test.js /path/to/font.ttf
```

The check renders small EPUBs with the project's WASM files.
It checks inline code, inline whitespace, preformatted line breaks, and publisher block styles.
An optional second argument selects another `crengine.js` file.

## Known minor issues

- **`setTextAlign` is a no-op.** CoolReader's text alignment is a
  document-CSS setting; the JS-level alignment override would need a
  custom `setStyleSheet` call. JS callers gracefully fall back.
- **Hyphenation language switching is a no-op.** Real per-language
  dictionaries require shipping `.pattern` files. Not bundled.
- **Two `CRE: styles re-init needed` warnings** print to stderr on
  every load. Cosmetic — comes from CoolReader's CSS parser
  encountering EPUB pseudoclasses it doesn't grok.
