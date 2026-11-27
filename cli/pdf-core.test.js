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
