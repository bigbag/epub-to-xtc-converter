'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPdfFixture } = require('./pdf-fixture');
const pdfRenderer = require('./pdf-renderer');

test('fixture opens in pdf.js with 3 pages and resolvable outline', async () => {
    const { doc, task } = await pdfRenderer.openPdf(buildPdfFixture());
    try {
        assert.equal(doc.numPages, 3);
        const outline = await doc.getOutline();
        assert.equal(outline.length, 2);
        assert.equal(outline[0].title, 'Chapter One');
        const dest = typeof outline[1].dest === 'string' ? await doc.getDestination(outline[1].dest) : outline[1].dest;
        assert.equal(await doc.getPageIndex(dest[0]), 1);
    } finally {
        await task.destroy();
    }
});

test('Node render produces device-sized bitmap with content', async () => {
    const { doc, task } = await pdfRenderer.openPdf(buildPdfFixture());
    try {
        const page = await doc.getPage(1);
        const vp = page.getViewport({ scale: 1 });
        assert.equal(vp.width, 612);
        assert.equal(vp.height, 792);
        const scale = Math.min(480 / vp.width, 800 / vp.height);
        const { canvas, context } = await pdfRenderer.renderPageToCanvas(doc, 1, scale);
        assert.equal(canvas.width, 480);
        assert.equal(canvas.height, 621);
        const img = context.getImageData(0, 0, canvas.width, canvas.height);
        let nonWhite = 0;
        for (let i = 0; i < img.data.length; i += 4) {
            if (img.data[i] < 250 || img.data[i + 1] < 250 || img.data[i + 2] < 250) nonWhite++;
        }
        assert.ok(nonWhite > 1000, 'page should contain text and rectangle');
    } finally {
        await task.destroy();
    }
});

test('corrupt PDF rejects with friendly error', async () => {
    const bytes = buildPdfFixture().slice(0, 200);
    await assert.rejects(pdfRenderer.openPdf(bytes), /Invalid or corrupt PDF file/);
});

const PdfCore = require('../web/pdf-core.js');

async function nodeSource(opts, fixtureOpts) {
    return pdfRenderer.createNodePdfSource(buildPdfFixture(fixtureOpts), Object.assign({ width: 480, height: 800 }, opts));
}

test('source zoom 1: 3 device pages, TOC, centered letterbox, content pixel', async () => {
    const src = await nodeSource({});
    try {
        assert.equal(src.pageCount, 3);
        assert.deepEqual(src.toc, [
            { title: 'Chapter One', page: 0 },
            { title: 'Chapter Two', page: 1 }
        ]);
        assert.equal(src.layouts[0].cw, 480);
        assert.equal(src.layouts[0].ch, 621);
        const rgba = await src.renderPage(0);
        assert.equal(rgba.length, 480 * 800 * 4);
        // top letterbox row is white
        assert.equal(rgba[0], 255);
        // center of the black rectangle (rect y 72..672 scaled + dy 89 -> ~145..616)
        const o = (400 * 480 + 240) * 4;
        assert.ok(rgba[o] < 128, 'center should be inside the black rectangle');
    } finally {
        await src.destroy();
    }
});

test('source zoom 2: 4 tiles per page, TOC maps to device pages', async () => {
    const src = await nodeSource({ zoom: 2 });
    try {
        assert.equal(src.pageCount, 12);
        assert.deepEqual(src.toc, [
            { title: 'Chapter One', page: 0 },
            { title: 'Chapter Two', page: 4 }
        ]);
        const a = await src.renderPage(0);
        const b = await src.renderPage(4);
        assert.notDeepEqual(a, b);
    } finally {
        await src.destroy();
    }
});

test('source trim: larger scale than untrimmed, still 1 tile per page', async () => {
    const plain = await nodeSource({});
    const trimmed = await nodeSource({ trimMargins: true });
    try {
        assert.ok(trimmed.layouts[0].scale > plain.layouts[0].scale + 0.1);
        assert.equal(trimmed.pageCount, 3);
    } finally {
        await plain.destroy();
        await trimmed.destroy();
    }
});

test('rotated page (/Rotate 90) uses swapped viewport dims', async () => {
    const src = await nodeSource({}, { rotateLast: true });
    try {
        // last page viewport is 792x612 -> fit by width: scale 480/792
        assert.equal(src.layouts[2].cw, 480);
        assert.equal(src.layouts[2].ch, 371);
    } finally {
        await src.destroy();
    }
});

test('blank pages with trim fall back to full page and render white', async () => {
    const src = await nodeSource({ trimMargins: true }, { blank: true });
    try {
        assert.equal(src.pageCount, 3);
        assert.equal(src.layouts[0].cw, 480);
        assert.equal(src.layouts[0].ch, 621);
        const rgba = await src.renderPage(0);
        assert.ok(rgba.every(v => v === 255));
    } finally {
        await src.destroy();
    }
});

test('invalid options reject', async () => {
    await assert.rejects(nodeSource({ zoom: 5 }), /pdf\.zoom/);
});
