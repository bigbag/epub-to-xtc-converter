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
