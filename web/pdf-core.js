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
        return {
            x: layout.cx + col * layout.screenW,
            y: layout.cy + row * layout.screenH,
            w: Math.min(layout.screenW, layout.cw - col * layout.screenW),
            h: Math.min(layout.screenH, layout.ch - row * layout.screenH)
        };
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

    return { detectContentBox, computeLayout, tileSourceRect, tileDestOffset };
});
