'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const PdfCore = require('../web/pdf-core.js');

function whiteRgba(w, h) {
    const a = new Uint8ClampedArray(w * h * 4);
    a.fill(255);
    return a;
}
function setPixel(a, w, x, y, v) {
    const o = (y * w + x) * 4;
    a[o] = v; a[o + 1] = v; a[o + 2] = v; a[o + 3] = 255;
}

test('detectContentBox: blank page returns full bounds', () => {
    const box = PdfCore.detectContentBox(whiteRgba(20, 30), 20, 30);
    assert.deepEqual(box, { x: 0, y: 0, w: 20, h: 30 });
});

test('detectContentBox: single pixel with padding', () => {
    const a = whiteRgba(20, 20);
    setPixel(a, 20, 5, 7, 0);
    assert.deepEqual(PdfCore.detectContentBox(a, 20, 20), { x: 3, y: 5, w: 5, h: 5 });
});

test('detectContentBox: threshold boundary (249 content, 250 background)', () => {
    const a = whiteRgba(10, 10);
    setPixel(a, 10, 2, 2, 249);
    setPixel(a, 10, 8, 8, 250);
    const box = PdfCore.detectContentBox(a, 10, 10, 250, 0);
    assert.deepEqual(box, { x: 2, y: 2, w: 1, h: 1 });
});

test('detectContentBox: padding clamps at page edges', () => {
    const a = whiteRgba(10, 10);
    setPixel(a, 10, 0, 0, 0);
    assert.deepEqual(PdfCore.detectContentBox(a, 10, 10), { x: 0, y: 0, w: 3, h: 3 });
});

test('computeLayout: fit 504x661.44 into 480x800 (Network Warrior page)', () => {
    const l = PdfCore.computeLayout(504, 661.44, 480, 800, {});
    assert.ok(Math.abs(l.scale - 480 / 504) < 1e-9);
    assert.equal(l.cw, 480);
    assert.equal(l.ch, 630);
    assert.equal(l.count, 1);
    assert.deepEqual(PdfCore.tileDestOffset(l), { dx: 0, dy: 85 });
});

test('computeLayout: zoom 1.5 produces 2x2 grid, row-major rects', () => {
    const l = PdfCore.computeLayout(504, 661.44, 480, 800, { zoom: 1.5 });
    assert.equal(l.cw, 720);
    assert.equal(l.ch, 945);
    assert.equal(l.cols, 2);
    assert.equal(l.rows, 2);
    assert.equal(l.count, 4);
    assert.deepEqual(PdfCore.tileSourceRect(l, 0), { x: 0, y: 0, w: 480, h: 800 });
    assert.deepEqual(PdfCore.tileSourceRect(l, 1), { x: 480, y: 0, w: 240, h: 800 });
    assert.deepEqual(PdfCore.tileSourceRect(l, 2), { x: 0, y: 800, w: 480, h: 145 });
    assert.deepEqual(PdfCore.tileSourceRect(l, 3), { x: 480, y: 800, w: 240, h: 145 });
    assert.deepEqual(PdfCore.tileDestOffset(l), { dx: 0, dy: 0 });
});

test('computeLayout: landscape page fits by width', () => {
    const l = PdfCore.computeLayout(800, 480, 480, 800, {});
    assert.equal(l.cw, 480);
    assert.equal(l.ch, 288);
    assert.equal(l.count, 1);
});

test('computeLayout: tall narrow page fits by height and centers horizontally', () => {
    const l = PdfCore.computeLayout(300, 1000, 480, 800, {});
    assert.equal(l.cw, 240);
    assert.equal(l.ch, 800);
    assert.deepEqual(PdfCore.tileDestOffset(l), { dx: 120, dy: 0 });
});

test('computeLayout: trimmed content box drives scale and offsets', () => {
    const box = { x: 50, y: 60, w: 400, h: 560 };
    const l = PdfCore.computeLayout(504, 661.44, 480, 800, { box });
    assert.ok(Math.abs(l.scale - 1.2) < 1e-9);
    assert.equal(l.cx, 60);
    assert.equal(l.cy, 72);
    assert.equal(l.cw, 480);
    assert.equal(l.ch, 672);
    assert.equal(l.count, 1);
    assert.deepEqual(PdfCore.tileSourceRect(l, 0), { x: 60, y: 72, w: 480, h: 672 });
});

test('flattenOutline: depth-first with nested items', () => {
    const outline = [
        { title: 'A', dest: 'da', items: [{ title: 'A.1', dest: 'da1' }] },
        { title: 'B', dest: 'db' }
    ];
    assert.deepEqual(PdfCore.flattenOutline(outline), [
        { title: 'A', dest: 'da' },
        { title: 'A.1', dest: 'da1' },
        { title: 'B', dest: 'db' }
    ]);
    assert.deepEqual(PdfCore.flattenOutline(null), []);
});

test('prefixSums and mapTocToDevices', () => {
    assert.deepEqual(PdfCore.prefixSums([1, 4, 2]), [0, 1, 5, 7]);
    const entries = [
        { title: 'One', page: 0 },
        { title: 'Two', page: 1 },
        { title: 'Bad', page: null },
        { title: 'OutOfRange', page: 3 }
    ];
    assert.deepEqual(PdfCore.mapTocToDevices(entries, [1, 4, 2]), [
        { title: 'One', page: 0 },
        { title: 'Two', page: 1 }
    ]);
});

test('locateTile: boundaries across variable tile counts', () => {
    const sums = PdfCore.prefixSums([1, 4, 2]); // pages: [0], [1..4], [5..6]
    assert.deepEqual(PdfCore.locateTile(sums, 0), { pdfPage: 0, tile: 0 });
    assert.deepEqual(PdfCore.locateTile(sums, 1), { pdfPage: 1, tile: 0 });
    assert.deepEqual(PdfCore.locateTile(sums, 4), { pdfPage: 1, tile: 3 });
    assert.deepEqual(PdfCore.locateTile(sums, 5), { pdfPage: 2, tile: 0 });
    assert.deepEqual(PdfCore.locateTile(sums, 6), { pdfPage: 2, tile: 1 });
});

test('validatePdfOptions: zoom and trimMargins', () => {
    assert.deepEqual(PdfCore.validatePdfOptions({ zoom: 1, trimMargins: false }), []);
    assert.deepEqual(PdfCore.validatePdfOptions({ zoom: 3 }), []);
    assert.deepEqual(PdfCore.validatePdfOptions({}), []);
    assert.equal(PdfCore.validatePdfOptions({ zoom: 0.9 }).length, 1);
    assert.equal(PdfCore.validatePdfOptions({ zoom: 3.1 }).length, 1);
    assert.equal(PdfCore.validatePdfOptions({ zoom: NaN }).length, 1);
    assert.equal(PdfCore.validatePdfOptions({ zoom: '2' }).length, 1);
    assert.equal(PdfCore.validatePdfOptions({ trimMargins: 'yes' }).length, 1);
});

test('mapPdfError: friendly messages', () => {
    assert.equal(PdfCore.mapPdfError({ name: 'PasswordException' }).message,
        'Password-protected PDFs are not supported');
    assert.equal(PdfCore.mapPdfError({ name: 'InvalidPDFException' }).message,
        'Invalid or corrupt PDF file');
    const other = new Error('boom');
    assert.equal(PdfCore.mapPdfError(other), other);
});

test('guards: render size and page count', () => {
    assert.doesNotThrow(() => PdfCore.assertRenderLimits(8192, 8192));
    assert.throws(() => PdfCore.assertRenderLimits(8193, 100), /8192/);
    assert.throws(() => PdfCore.assertRenderLimits(100, 8193), /8192/);
    assert.doesNotThrow(() => PdfCore.assertPageCount(65535));
    assert.throws(() => PdfCore.assertPageCount(65536), /65535/);
});

test('tileSourceRect: clamps to render canvas when the grid overshoots', () => {
    // Hand-built layout: content rect spans 5..935 in both axes, overshooting
    // the 934x934 render canvas by 1px (rounding in computeLayout can do this).
    const layout = { scale: 1, rw: 934, rh: 934, cx: 5, cy: 5, cw: 930, ch: 930, cols: 2, rows: 2, count: 4, screenW: 480, screenH: 800 };
    const r = PdfCore.tileSourceRect(layout, 3);
    assert.equal(r.x, 485);
    assert.equal(r.y, 805);
    // pre-clamp w=450, h=130; clamped to rw-x=449 and rh-y=129
    assert.equal(r.w, 449);
    assert.equal(r.h, 129);
});
