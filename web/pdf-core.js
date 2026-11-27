/**
 * Shared PDF conversion logic (DOM-free).
 * Used by cli/pdf-renderer.js (Node) and web/pdf-source.js (browser).
 * Dual export: CommonJS via module.exports, browser global via window.PdfCore.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.PdfCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    /** Bounding box of non-background pixels. Blank page -> full bounds. */
    function detectContentBox(rgba, width, height, threshold, padding) {
        if (threshold === undefined) threshold = 250;
        if (padding === undefined) padding = 2;
        let minX = width, minY = height, maxX = -1, maxY = -1;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const o = (y * width + x) * 4;
                if (rgba[o] < threshold || rgba[o + 1] < threshold || rgba[o + 2] < threshold) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < 0) return { x: 0, y: 0, w: width, h: height };
        const x = Math.max(0, minX - padding);
        const y = Math.max(0, minY - padding);
        const right = Math.min(width - 1, maxX + padding);
        const bottom = Math.min(height - 1, maxY + padding);
        return { x, y, w: right - x + 1, h: bottom - y + 1 };
    }

    /**
     * Unified fit/trim/zoom layout. All dims in PDF units except screen W/H (px).
     * Returns render-canvas dims (rw/rh), content rect (cx/cy/cw/ch) within it,
     * and the row-major tile grid.
     */
    function computeLayout(vw, vh, W, H, opts) {
        opts = opts || {};
        const zoom = opts.zoom === undefined ? 1 : opts.zoom;
        const box = opts.box || { x: 0, y: 0, w: vw, h: vh };
        const base = Math.min(W / box.w, H / box.h);
        const scale = base * zoom;
        const rw = Math.round(vw * scale);
        const rh = Math.round(vh * scale);
        const cx = Math.round(box.x * scale);
        const cy = Math.round(box.y * scale);
        const cw = Math.round(box.w * scale);
        const ch = Math.round(box.h * scale);
        const cols = Math.ceil(cw / W);
        const rows = Math.ceil(ch / H);
        return { scale, rw, rh, cx, cy, cw, ch, cols, rows, count: cols * rows, screenW: W, screenH: H };
    }

    /** Source rect of tile i within the full-page render canvas (row-major). */
    function tileSourceRect(layout, i) {
        const col = i % layout.cols;
        const row = Math.floor(i / layout.cols);
        const x = layout.cx + col * layout.screenW;
        const y = layout.cy + row * layout.screenH;
        let w = Math.min(layout.screenW, layout.cw - col * layout.screenW);
        let h = Math.min(layout.screenH, layout.ch - row * layout.screenH);
        // Clamp to the render canvas: rounding in computeLayout can make the
        // content rect overshoot rw/rh, which would break getImageData.
        w = Math.max(0, Math.min(w, layout.rw - x));
        h = Math.max(0, Math.min(h, layout.rh - y));
        return { x, y, w, h };
    }

    /** Single tile: centered. Multi-tile grid: top-left. */
    function tileDestOffset(layout) {
        if (layout.count === 1) {
            return {
                dx: Math.floor((layout.screenW - layout.cw) / 2),
                dy: Math.floor((layout.screenH - layout.ch) / 2)
            };
        }
        return { dx: 0, dy: 0 };
    }

    /** Depth-first flatten of pdf.js getOutline() items. */
    function flattenOutline(items) {
        const out = [];
        (function walk(list) {
            if (!Array.isArray(list)) return;
            for (const item of list) {
                if (!item) continue;
                out.push({ title: item.title || '', dest: item.dest });
                if (item.items) walk(item.items);
            }
        })(items);
        return out;
    }

    function prefixSums(counts) {
        const sums = [0];
        for (let i = 0; i < counts.length; i++) sums.push(sums[i] + counts[i]);
        return sums;
    }

    /** entries: [{title, page}] with page = 0-based PDF page or null. */
    function mapTocToDevices(entries, tileCounts) {
        const sums = prefixSums(tileCounts);
        const out = [];
        for (const e of entries) {
            if (!Number.isInteger(e.page) || e.page < 0 || e.page >= tileCounts.length) continue;
            out.push({ title: e.title, page: sums[e.page] });
        }
        return out;
    }

    /** Binary search: device page index -> {pdfPage, tile}. */
    function locateTile(sums, deviceIndex) {
        let lo = 0, hi = sums.length - 2;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (sums[mid] <= deviceIndex) lo = mid; else hi = mid - 1;
        }
        return { pdfPage: lo, tile: deviceIndex - sums[lo] };
    }

    function validatePdfOptions(opts) {
        const errors = [];
        opts = opts || {};
        if (opts.zoom !== undefined) {
            if (typeof opts.zoom !== 'number' || !Number.isFinite(opts.zoom) || opts.zoom < 1 || opts.zoom > 3) {
                errors.push('pdf.zoom must be a number between 1.0 and 3.0');
            }
        }
        if (opts.trimMargins !== undefined && typeof opts.trimMargins !== 'boolean') {
            errors.push('pdf.trimMargins must be a boolean');
        }
        return errors;
    }

    function mapPdfError(err) {
        const name = err && err.name;
        if (name === 'PasswordException') return new Error('Password-protected PDFs are not supported');
        if (name === 'InvalidPDFException' || name === 'MissingPDFException') return new Error('Invalid or corrupt PDF file');
        return err;
    }

    function assertRenderLimits(rw, rh) {
        if (rw > 8192 || rh > 8192) throw new Error('PDF render size exceeds 8192px; lower the zoom');
    }

    function assertPageCount(n) {
        if (n > 65535) throw new Error('PDF produces more than 65535 device pages; lower the zoom');
    }

    /**
     * Build a device-page document source from an open pdf.js document.
     * createCanvas(w, h) -> {canvas, context} is injected (DOM or @napi-rs/canvas).
     */
    async function createSource(opts) {
        const doc = opts.doc;
        const loadingTask = opts.loadingTask;
        const createCanvas = opts.createCanvas;
        const width = opts.width;
        const height = opts.height;
        const zoom = opts.zoom === undefined ? 1 : opts.zoom;
        const errors = validatePdfOptions({ zoom, trimMargins: opts.trimMargins });
        if (errors.length) throw new Error(errors.join('; '));
        const trimMargins = !!opts.trimMargins;

        const layouts = [];
        const tileCounts = [];
        for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const vp = page.getViewport({ scale: 1 });
            let box = null;
            if (trimMargins) {
                const ds = 200 / Math.max(vp.width, vp.height);
                const dw = Math.max(1, Math.round(vp.width * ds));
                const dh = Math.max(1, Math.round(vp.height * ds));
                const det = createCanvas(dw, dh);
                det.context.fillStyle = '#ffffff';
                det.context.fillRect(0, 0, dw, dh);
                await page.render({ canvasContext: det.context, viewport: page.getViewport({ scale: ds }) }).promise;
                const px = detectContentBox(det.context.getImageData(0, 0, dw, dh).data, dw, dh);
                // Clamp to the page: the pixel->PDF round-trip (and full-bounds
                // fallback on blank pages) can overshoot vp by a rounding error.
                const bx = Math.min(vp.width, px.x / ds);
                const by = Math.min(vp.height, px.y / ds);
                box = { x: bx, y: by, w: Math.min(vp.width - bx, px.w / ds), h: Math.min(vp.height - by, px.h / ds) };
            }
            const layout = computeLayout(vp.width, vp.height, width, height, { zoom, box });
            assertRenderLimits(layout.rw, layout.rh);
            layouts.push(layout);
            tileCounts.push(layout.count);
        }
        const sums = prefixSums(tileCounts);
        const pageCount = sums[sums.length - 1];
        if (pageCount === 0) throw new Error('PDF has no pages');
        assertPageCount(pageCount);

        const entries = [];
        const outline = await doc.getOutline();
        for (const item of flattenOutline(outline)) {
            let page = null;
            try {
                const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
                if (Array.isArray(dest) && dest[0]) page = await doc.getPageIndex(dest[0]);
            } catch (e) { page = null; }
            entries.push({ title: item.title, page });
        }
        const toc = mapTocToDevices(entries, tileCounts);

        const meta = await doc.getMetadata().catch(() => null);
        const info = {
            title: (meta && meta.info && meta.info.Title) || '',
            author: (meta && meta.info && meta.info.Author) || ''
        };

        let last = null; // cache: consecutive tiles of one PDF page reuse the render
        async function renderPage(deviceIndex) {
            if (deviceIndex < 0 || deviceIndex >= pageCount) {
                throw new Error('Device page index out of range: ' + deviceIndex);
            }
            const loc = locateTile(sums, deviceIndex);
            const layout = layouts[loc.pdfPage];
            if (!last || last.pdfPage !== loc.pdfPage) {
                const page = await doc.getPage(loc.pdfPage + 1);
                const viewport = page.getViewport({ scale: layout.scale });
                const c = createCanvas(layout.rw, layout.rh);
                c.context.fillStyle = '#ffffff';
                c.context.fillRect(0, 0, layout.rw, layout.rh);
                await page.render({ canvasContext: c.context, viewport }).promise;
                last = { pdfPage: loc.pdfPage, context: c.context };
            }
            const rect = tileSourceRect(layout, loc.tile);
            const tile = last.context.getImageData(rect.x, rect.y, rect.w, rect.h);
            const out = createCanvas(width, height);
            out.context.fillStyle = '#ffffff';
            out.context.fillRect(0, 0, width, height);
            const off = tileDestOffset(layout);
            out.context.putImageData(tile, off.dx, off.dy);
            return new Uint8ClampedArray(out.context.getImageData(0, 0, width, height).data);
        }

        return {
            pageCount, info, toc, layouts, renderPage,
            destroy: () => loadingTask.destroy()
        };
    }

    return {
        detectContentBox, computeLayout, tileSourceRect, tileDestOffset,
        flattenOutline, prefixSums, mapTocToDevices, locateTile,
        validatePdfOptions, mapPdfError, assertRenderLimits, assertPageCount,
        createSource
    };
});
