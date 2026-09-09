const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const JSZip = require('jszip');
const { optimizeEpub } = require('./optimizer');
const { DEFAULT_SETTINGS } = require('./settings');

const { writeStablePageManifest } = require('./stable-pages');
const manifestPath = 'META-INF/x-locations.json';

function fixture(chapters = [
    ['chapter one.xhtml', `<p>${'a '.repeat(65)}</p><script>hidden words</script><style>hidden words</style>`],
    ['two.xhtml', '<p>é &#x1F600;&#x200B;</p>'],
    ['empty.xhtml', '<img src="cover.jpg" alt=""/>']
]) {
    const zip = new JSZip();
    zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');
    zip.file('mimetype', 'application/epub+zip');
    zip.file('OPS/book.opf', `<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest>${chapters.map(([name], i) => `<item id="c${i}" href="${encodeURIComponent(name)}" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i}" linear="${i ? 'no' : 'yes'}"/>`).join('')}</spine></package>`);
    for (const [name, body] of chapters) {
        zip.file(`OPS/${name}`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ignored</title></head><body>${body}</body></html>`);
    }
    return zip;
}

async function setup(t, zip = fixture()) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-stable-pages-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const input = path.join(dir, 'input.epub');
    const output = path.join(dir, 'output.epub');
    fs.writeFileSync(input, await zip.generateAsync({ type: 'nodebuffer' }));
    return { dir, input, output };
}

function options(enabled = true, referenceCharactersPerPage = 10) {
    return { ...DEFAULT_SETTINGS.optimizer, stablePageNumbers: { enabled, referenceCharactersPerPage } };
}

async function readManifest(output) {
    const zip = await JSZip.loadAsync(fs.readFileSync(output));
    const file = zip.file(manifestPath);
    return file ? JSON.parse(await file.async('string')) : null;
}

function cli(input, output, flags = []) {
    return spawnSync(process.execPath, [path.join(__dirname, 'index.js'), 'optimize', input, '-o', output, ...flags], { encoding: 'utf8' });
}

test('optimized EPUB has CrossInk counts, spine order, and valid mimetype packaging', async t => {
    const { input, output } = await setup(t);
    await optimizeEpub(input, output, options());
    const manifest = await readManifest(output);
    assert.ok(manifest, 'Stable page metadata must be written');
    assert.equal(manifest.totalWords, 66);
    assert.equal(manifest.totalCharacters, 132);
    assert.equal(manifest.totalLocations, 3);
    assert.equal(manifest.totalReferencePages, 14);
    assert.deepEqual(manifest.spine, [
        { index: 0, href: 'OPS/chapter one.xhtml', wordStart: 0, wordCount: 65, characterStart: 0, characterCount: 129, startLocation: 1, endLocation: 2, startReferencePage: 1, endReferencePage: 13 },
        { index: 1, href: 'OPS/two.xhtml', wordStart: 65, wordCount: 1, characterStart: 129, characterCount: 3, startLocation: 3, endLocation: 3, startReferencePage: 13, endReferencePage: 14 },
        { index: 2, href: 'OPS/empty.xhtml', wordStart: 66, wordCount: 0, characterStart: 132, characterCount: 0, startLocation: 0, endLocation: 0, startReferencePage: 0, endReferencePage: 0 }
    ]);
    const buffer = fs.readFileSync(output);
    assert.equal(buffer.subarray(30, 30 + buffer.readUInt16LE(26)).toString(), 'mimetype');
    assert.equal(buffer.readUInt16LE(8), 0);
    await optimizeEpub(output, output, options());
    assert.deepEqual(await readManifest(output), manifest);
});

test('oversized metadata fails without overwriting an existing output', async t => {
    const chapters = Array.from({ length: 400 }, (_, i) => [`c${i}.xhtml`, '<p>word</p>']);
    const { input, output } = await setup(t, fixture(chapters));
    fs.writeFileSync(output, 'existing output');
    await assert.rejects(optimizeEpub(input, output, options()), /65536|64 KiB/);
    assert.equal(fs.readFileSync(output, 'utf8'), 'existing output');
});

test('manifest limit uses UTF-8 bytes and accepts exactly 64 KiB', async () => {
    const initial = fixture([['chapter.xhtml', '<p>word</p>']]);
    await writeStablePageManifest(initial);
    const initialSize = Buffer.byteLength(await initial.file(manifestPath).async('string'));
    const paddingSize = 65536 - initialSize;
    const padding = 'é'.repeat(Math.floor(paddingSize / 2)) + 'a'.repeat(paddingSize % 2);
    const boundary = fixture([[`${padding}chapter.xhtml`, '<p>word</p>']]);
    await writeStablePageManifest(boundary);
    assert.equal(Buffer.byteLength(await boundary.file(manifestPath).async('string')), 65536);
    const oversized = fixture([[`${padding}achapter.xhtml`, '<p>word</p>']]);
    await assert.rejects(writeStablePageManifest(oversized), /65536|64 KiB/);
    assert.equal(oversized.file(manifestPath), null);
});

test('missing spine resources fail before output is created', async t => {
    const zip = fixture();
    zip.remove('OPS/two.xhtml');
    const { input, output } = await setup(t, zip);
    await assert.rejects(optimizeEpub(input, output, options()), /two.xhtml/);
    assert.equal(fs.existsSync(output), false);
});

test('books without text locations fail instead of reporting unusable metadata', async t => {
    const { input, output } = await setup(t, fixture([['cover.xhtml', '<img src="cover.jpg" alt=""/>']]));
    await assert.rejects(optimizeEpub(input, output, options()), /text locations/);
    assert.equal(fs.existsSync(output), false);
});

test('container URL paths and literal percent resource names resolve correctly', async () => {
    const zip = fixture([['100%.xhtml', '<p>word</p>']]);
    const opf = await zip.file('OPS/book.opf').async('string');
    const content = await zip.file('OPS/100%.xhtml').async('string');
    zip.remove('OPS');
    zip.file('My Book/book.opf', opf.replace('100%25.xhtml', '100%.xhtml'));
    zip.file('My Book/100%.xhtml', content);
    zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="My%20Book/book.opf"/></rootfiles></container>');
    await writeStablePageManifest(zip);
    const manifest = JSON.parse(await zip.file(manifestPath).async('string'));
    assert.equal(manifest.spine[0].href, 'My Book/100%.xhtml');
    assert.equal(manifest.totalWords, 1);
});

test('SVG content documents retain zero-count spine entries', async () => {
    const zip = fixture([['chapter.xhtml', '<p>word</p>'], ['image.svg', '']]);
    zip.file('OPS/image.svg', '<svg xmlns="http://www.w3.org/2000/svg"><text>Hidden</text></svg>');
    const opf = await zip.file('OPS/book.opf').async('string');
    zip.file('OPS/book.opf', opf.replace('href="image.svg" media-type="application/xhtml+xml"', 'href="image.svg" media-type="image/svg+xml"'));
    await writeStablePageManifest(zip);
    const manifest = JSON.parse(await zip.file(manifestPath).async('string'));
    assert.equal(manifest.totalWords, 1);
    assert.equal(manifest.spine[1].characterCount, 0);
    assert.equal(manifest.spine[1].startLocation, 0);
});

test('CLI explicit disable wins over character size in either order', async t => {
    const { input, output, dir } = await setup(t);
    const config = path.join(dir, 'settings.json');
    fs.writeFileSync(config, JSON.stringify({ optimizer: { stablePageNumbers: { enabled: true } } }));
    for (const flags of [
        ['--no-stable-pages', '--chars-per-page', '20'],
        ['--chars-per-page', '20', '--no-stable-pages']
    ]) {
        const result = cli(input, output, ['-c', config, ...flags]);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(await readManifest(output), null);
    }
});

test('CLI character size enables generation and overrides configuration', async t => {
    const { input, output, dir } = await setup(t);
    const config = path.join(dir, 'settings.json');
    fs.writeFileSync(config, JSON.stringify({ optimizer: { stablePageNumbers: { enabled: false, referenceCharactersPerPage: 10 } } }));
    const result = cli(input, output, ['-c', config, '--chars-per-page', '20']);
    assert.equal(result.status, 0, result.stderr);
    const manifest = await readManifest(output);
    assert.equal(manifest.charactersPerReferencePage, 20);
    assert.equal(manifest.totalReferencePages, 7);
});

test('invalid CLI and configuration values do not create output', async t => {
    const { input, output, dir } = await setup(t);
    for (const value of ['0', '10001', '1.5', '1e3']) {
        const result = cli(input, output, ['--chars-per-page', value]);
        assert.equal(result.status, 1);
        assert.equal(fs.existsSync(output), false);
    }
    const config = path.join(dir, 'settings.json');
    for (const value of [null, false, [], { enabled: 'yes' }, { referenceCharactersPerPage: '20' }]) {
        fs.writeFileSync(config, JSON.stringify({ optimizer: { stablePageNumbers: value } }));
        const result = cli(input, output, ['-c', config]);
        assert.equal(result.status, 1, `Invalid configuration: ${JSON.stringify(value)}`);
        assert.equal(fs.existsSync(output), false);
    }
});

test('disabled generation preserves an existing manifest', async t => {
    const zip = fixture();
    zip.file(manifestPath, '{"existing":true}');
    const { input, output } = await setup(t, zip);
    await optimizeEpub(input, output, options(false));
    assert.deepEqual(await readManifest(output), { existing: true });
});
