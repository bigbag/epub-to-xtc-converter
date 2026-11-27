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

test('zero-page PDF: createNodePdfSource rejects', async () => {
    await assert.rejects(
        pdfRenderer.createNodePdfSource(buildPdfFixture({ pageCount: 0 }), { width: 480, height: 800 }),
        /no pages|Invalid or corrupt/
    );
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'pdfxtc-'));
}
function parseHeader(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
        magic: String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]),
        pageCount: view.getUint16(6, true),
        chapterCount: view.getUint16(56 + 196, true),
        chapterOffset: Number(view.getBigUint64(48, true)),
        indexOffset: Number(view.getBigUint64(24, true)),
        view
    };
}
function chapterAt(bytes, header, i) {
    const pos = header.chapterOffset + i * 96;
    let end = pos;
    while (end < pos + 79 && bytes[end] !== 0) end++;
    return {
        title: new TextDecoder().decode(bytes.subarray(pos, end)),
        startPage: header.view.getUint16(pos + 80, true)
    };
}
const SETTINGS = {
    width: 480, height: 800,
    output: { format: 'xtc', dithering: true, ditherStrength: 0.7, negative: false },
    pdf: { trimMargins: false, zoom: 1 }
};

test('convertPdf end-to-end: valid XTC with chapters', async () => {
    const dir = tmpDir();
    const input = path.join(dir, 'book.pdf');
    const output = path.join(dir, 'book.xtc');
    fs.writeFileSync(input, buildPdfFixture());
    const result = await pdfRenderer.convertPdf(input, output, SETTINGS);
    assert.equal(result.pageCount, 3);
    const bytes = new Uint8Array(fs.readFileSync(output));
    const h = parseHeader(bytes);
    assert.equal(h.magic, 'XTC\0');
    assert.equal(h.pageCount, 3);
    assert.equal(h.chapterCount, 2);
    assert.deepEqual(chapterAt(bytes, h, 0), { title: 'Chapter One', startPage: 1 });
    assert.deepEqual(chapterAt(bytes, h, 1), { title: 'Chapter Two', startPage: 2 });
    assert.equal(h.view.getUint16(h.indexOffset + 12, true), 480);
    assert.equal(h.view.getUint16(h.indexOffset + 14, true), 800);
});

test('convertPdf zoom 2 multiplies pages and shifts chapter targets', async () => {
    const dir = tmpDir();
    const input = path.join(dir, 'book.pdf');
    const output = path.join(dir, 'book.xtc');
    fs.writeFileSync(input, buildPdfFixture());
    const settings = Object.assign({}, SETTINGS, { pdf: { trimMargins: false, zoom: 2 } });
    const result = await pdfRenderer.convertPdf(input, output, settings);
    assert.equal(result.pageCount, 12);
    const bytes = new Uint8Array(fs.readFileSync(output));
    const h = parseHeader(bytes);
    assert.equal(h.pageCount, 12);
    assert.equal(chapterAt(bytes, h, 1).startPage, 5);
});

test('convertPdf XTCH variant', async () => {
    const dir = tmpDir();
    const input = path.join(dir, 'book.pdf');
    const output = path.join(dir, 'book.xtch');
    fs.writeFileSync(input, buildPdfFixture());
    const settings = Object.assign({}, SETTINGS, { output: Object.assign({}, SETTINGS.output, { format: 'xtch' }) });
    await pdfRenderer.convertPdf(input, output, settings);
    assert.equal(parseHeader(new Uint8Array(fs.readFileSync(output))).magic, 'XTCH');
});

test('convertPdf corrupt input: friendly error, no output file', async () => {
    const dir = tmpDir();
    const input = path.join(dir, 'bad.pdf');
    const output = path.join(dir, 'bad.xtc');
    fs.writeFileSync(input, buildPdfFixture().slice(0, 200));
    await assert.rejects(pdfRenderer.convertPdf(input, output, SETTINGS), /Invalid or corrupt PDF file/);
    assert.equal(fs.existsSync(output), false);
});

test('convertPdf zero-page input: rejects and writes no output file', async () => {
    const dir = tmpDir();
    const input = path.join(dir, 'empty.pdf');
    const output = path.join(dir, 'empty.xtc');
    fs.writeFileSync(input, buildPdfFixture({ pageCount: 0 }));
    await assert.rejects(pdfRenderer.convertPdf(input, output, SETTINGS), /no pages|Invalid or corrupt/);
    assert.equal(fs.existsSync(output), false);
});

test('CLI: PDF-only conversion works without font config', () => {
    const dir = tmpDir();
    const input = path.join(dir, 'book.pdf');
    const output = path.join(dir, 'book.xtc');
    fs.writeFileSync(input, buildPdfFixture());
    execFileSync(process.execPath, [path.join(__dirname, 'index.js'), 'convert', input, '-o', output], { encoding: 'utf8' });
    assert.equal(parseHeader(new Uint8Array(fs.readFileSync(output))).pageCount, 3);
});

test('CLI: --zoom flag reaches the converter', () => {
    const dir = tmpDir();
    const input = path.join(dir, 'book.pdf');
    const output = path.join(dir, 'book.xtc');
    fs.writeFileSync(input, buildPdfFixture());
    execFileSync(process.execPath, [path.join(__dirname, 'index.js'), 'convert', input, '-o', output, '--zoom', '2'], { encoding: 'utf8' });
    assert.equal(parseHeader(new Uint8Array(fs.readFileSync(output))).pageCount, 12);
});

test('CLI: mixed directory without font fails validation clearly', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'book.pdf'), buildPdfFixture());
    fs.writeFileSync(path.join(dir, 'book.epub'), 'not a real epub');
    let failed = false;
    try {
        execFileSync(process.execPath, [path.join(__dirname, 'index.js'), 'convert', dir, '-o', path.join(dir, 'out')], { encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
        failed = true;
        assert.match(err.stderr, /Font path is required/);
    }
    assert.ok(failed, 'mixed input without font must fail validation');
});

test('CLI: --trim-margins flag reaches the converter', () => {
    const dir = tmpDir();
    const input = path.join(dir, 'book.pdf');
    const output = path.join(dir, 'book.xtc');
    fs.writeFileSync(input, buildPdfFixture());
    execFileSync(process.execPath, [path.join(__dirname, 'index.js'), 'convert', input, '-o', output, '--trim-margins'], { encoding: 'utf8' });
    assert.equal(parseHeader(new Uint8Array(fs.readFileSync(output))).pageCount, 3);
});

test('CLI: PDF-only directory converts without font config', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'book.pdf'), buildPdfFixture());
    const outdir = path.join(dir, 'out');
    execFileSync(process.execPath, [path.join(__dirname, 'index.js'), 'convert', dir, '-o', outdir], { encoding: 'utf8' });
    const output = path.join(outdir, 'book.xtc');
    assert.equal(fs.existsSync(output), true);
    assert.equal(parseHeader(new Uint8Array(fs.readFileSync(output))).pageCount, 3);
});
