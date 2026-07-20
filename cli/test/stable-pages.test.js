const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');

const {
    X_LOCATION_MANIFEST_PATH,
    X_LOCATION_WORDS_PER_UNIT,
    generateStablePageManifest,
    writeStablePageManifest
} = require('../stable-pages');
const { createFixture, xhtml, packageDocument } = require('./fixtures/books');

const GOLDEN_STATS = {
    'basic-epub2': [
        { href: 'OEBPS/Text/one.xhtml', wordCount: 140, characterCount: 769 },
        { href: 'OEBPS/Text/two.xhtml', wordCount: 50, characterCount: 599 }
    ],
    'basic-epub3': [
        { href: 'EPUB/Text/chapter 1.xhtml', wordCount: 300, characterCount: 1446 }
    ],
    'unicode-multilingual': [
        { href: 'Text/Tiếng Việt.xhtml', wordCount: 228, characterCount: 1329 }
    ]
};

function crossInkGolden(name, charactersPerReferencePage) {
    let totalWords = 0;
    let totalCharacters = 0;
    let nextLocation = 1;
    const spine = GOLDEN_STATS[name].map((stats, index) => {
        const locationCount = Math.ceil(stats.wordCount / X_LOCATION_WORDS_PER_UNIT);
        const item = {
            index,
            href: stats.href,
            wordStart: totalWords,
            wordCount: stats.wordCount,
            characterStart: totalCharacters,
            characterCount: stats.characterCount,
            startLocation: locationCount ? nextLocation : 0,
            endLocation: locationCount ? nextLocation + locationCount - 1 : 0,
            startReferencePage: stats.characterCount ? Math.floor(totalCharacters / charactersPerReferencePage) + 1 : 0,
            endReferencePage: stats.characterCount ? Math.ceil((totalCharacters + stats.characterCount) / charactersPerReferencePage) : 0
        };
        totalWords += stats.wordCount;
        totalCharacters += stats.characterCount;
        nextLocation += locationCount;
        return item;
    });

    return {
        format: 'x-locations',
        version: 1,
        generator: 'crossink-web-uploader',
        unit: 'word',
        referencePageUnit: 'character',
        wordsPerLocation: 64,
        charactersPerReferencePage,
        totalWords,
        totalCharacters,
        totalLocations: nextLocation - 1,
        totalReferencePages: Math.ceil(totalCharacters / charactersPerReferencePage),
        spine
    };
}

for (const fixture of Object.keys(GOLDEN_STATS)) {
    for (const charactersPerReferencePage of [1000, 1500, 1800, 2500]) {
        test(`${fixture} matches the CrossInk v1.4.0 manifest at ${charactersPerReferencePage} characters`, async () => {
            const actual = await generateStablePageManifest(createFixture(fixture), { referenceCharactersPerPage: charactersPerReferencePage });
            assert.deepEqual(actual, crossInkGolden(fixture, charactersPerReferencePage));
        });
    }
}

test('container fallback, reading order, encoded paths, fragments, queries, and linear=no are supported', async () => {
    const manifest = await generateStablePageManifest(createFixture('unicode-multilingual'));
    assert.equal(manifest.spine[0].href, 'Text/Tiếng Việt.xhtml');

    const epub2 = await generateStablePageManifest(createFixture('basic-epub2'));
    assert.deepEqual(epub2.spine.map(item => item.href), [
        'OEBPS/Text/one.xhtml',
        'OEBPS/Text/two.xhtml'
    ]);
});

test('visible text counting handles entities, Unicode code points, hidden markup and scrubbed blanks', async () => {
    const manifest = await generateStablePageManifest(createFixture('unicode-multilingual'));
    assert.equal(manifest.totalWords, 228);
    assert.equal(manifest.totalCharacters, 1329);
    assert.equal(manifest.spine[0].wordCount, 228);
});

test('image-only and empty chapters retain spine entries with zero ranges', async () => {
    const zip = new JSZip();
    zip.file('book.opf', packageDocument('3.0',
        '<item id="image" href="image.xhtml" media-type="application/xhtml+xml"/><item id="empty" href="empty.xhtml" media-type="application/xhtml+xml"/>',
        '<itemref idref="image"/><itemref idref="empty"/>'));
    zip.file('image.xhtml', xhtml('<img src="cover.jpg" alt=""/>'));
    zip.file('empty.xhtml', xhtml(''));

    const manifest = await generateStablePageManifest(zip);
    assert.equal(manifest.totalWords, 0);
    assert.equal(manifest.totalCharacters, 0);
    assert.deepEqual(manifest.spine.map(({ startLocation, endLocation }) => ({ startLocation, endLocation })), [
        { startLocation: 0, endLocation: 0 },
        { startLocation: 0, endLocation: 0 }
    ]);
});

test('existing x-locations manifest is replaced deterministically', async () => {
    const zip = createFixture('basic-epub3');
    zip.file(X_LOCATION_MANIFEST_PATH, '{"stale":true}');
    const stats = await writeStablePageManifest(zip, { referenceCharactersPerPage: 1800 });
    const first = await zip.files[X_LOCATION_MANIFEST_PATH].async('string');
    await writeStablePageManifest(zip, { referenceCharactersPerPage: 1800 });
    const second = await zip.files[X_LOCATION_MANIFEST_PATH].async('string');

    assert.equal(first, second);
    assert.deepEqual(stats, {
        referenceCharactersPerPage: 1800,
        wordsPerLocationUnit: 64,
        locationCount: 5,
        referencePageCount: 1
    });
});

test('smaller reference page sizes produce more reference pages', async () => {
    const smaller = await generateStablePageManifest(createFixture('basic-epub3'), { referenceCharactersPerPage: 1000 });
    const larger = await generateStablePageManifest(createFixture('basic-epub3'), { referenceCharactersPerPage: 2000 });
    assert.equal(smaller.totalReferencePages, 2);
    assert.equal(larger.totalReferencePages, 1);
});

test('missing package documents and spine resources fail with context', async () => {
    await assert.rejects(generateStablePageManifest(new JSZip()), /EPUB package document was not found/);

    const zip = new JSZip();
    zip.file('book.opf', packageDocument('3.0',
        '<item id="chapter-07" href="Text/ch07.xhtml" media-type="application/xhtml+xml"/>',
        '<itemref idref="chapter-07"/>'));
    await assert.rejects(generateStablePageManifest(zip), /spine item "chapter-07" points to missing resource "Text\/ch07.xhtml"/);
});

test('malformed XHTML uses the HTML-compatible fallback', async () => {
    const zip = new JSZip();
    zip.file('book.opf', packageDocument('3.0',
        '<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>',
        '<itemref idref="chapter"/>'));
    zip.file('chapter.xhtml', '<html><body><p>one &amp; two<p>three<script>ignored</script></body></html>');

    const manifest = await generateStablePageManifest(zip);
    assert.equal(manifest.totalWords, 2);
    assert.equal(manifest.totalCharacters, 14);
});

test('resource resolution does not fall back to a duplicate basename', async () => {
    const zip = new JSZip();
    zip.file('OPS/package.opf', packageDocument('3.0',
        '<item id="chapter" href="../Text/chapter.xhtml" media-type="application/xhtml+xml"/>',
        '<itemref idref="chapter"/>'));
    zip.file('Other/chapter.xhtml', xhtml('wrong resource'));

    await assert.rejects(
        generateStablePageManifest(zip),
        /points to missing resource "Text\/chapter.xhtml"/
    );
});

test('declared legacy encodings and UTF-8 BOM are decoded', async () => {
    const zip = new JSZip();
    zip.file('book.opf', packageDocument('3.0',
        '<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>',
        '<itemref idref="chapter"/>'));
    const prefix = Buffer.from('<?xml version="1.0" encoding="windows-1252"?><html><body><p>caf', 'ascii');
    const suffix = Buffer.from('</p></body></html>', 'ascii');
    zip.file('chapter.xhtml', Buffer.concat([prefix, Buffer.from([0xe9]), suffix]));

    const manifest = await generateStablePageManifest(zip);
    assert.equal(manifest.totalWords, 1);
    assert.equal(manifest.totalCharacters, 4);
});

test('reference character validation rejects invalid direct API values', async () => {
    for (const value of [0, -1, 1.5, 10001, NaN, Infinity, '1500']) {
        await assert.rejects(
            generateStablePageManifest(createFixture('basic-epub3'), { referenceCharactersPerPage: value }),
            /must be an integer between 1 and 10000/
        );
    }
});
