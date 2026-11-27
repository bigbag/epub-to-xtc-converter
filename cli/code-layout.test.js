const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

// Run: node cli/code-layout.test.js /path/to/font.ttf [path/to/crengine.js]
async function main() {
    const font = fs.readFileSync(process.argv[2]);
    const createEngine = require(path.resolve(process.argv[3] || 'web/crengine.js'));
    const Module = await createEngine();
    const width = 480;
    const height = 800;

    async function countLines(body) {
        const zip = new JSZip();
        zip.file('mimetype', 'application/epub+zip');
        zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
        zip.file('book.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">code-layout</dc:identifier><dc:title>Code layout</dc:title><dc:language>en</dc:language></metadata><manifest><item id="page" href="page.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="page"/></spine></package>');
        zip.file('page.xhtml', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Code layout</title><style>body { text-align: left; text-indent: 0; }</style></head><body>' + body + '</body></html>');
        const epub = await zip.generateAsync({ type: 'nodebuffer' });
        const renderer = new Module.EpubRenderer(width, height);
        function withMemory(data, use) {
            const ptr = Module.allocateMemory(data.length);
            try {
                Module.HEAPU8.set(data, ptr);
                return use(ptr);
            } finally {
                Module.freeMemory(ptr);
            }
        }
        try {
            withMemory(font, ptr => renderer.registerFontFromMemory(ptr, font.length, 'font.ttf'));
            withMemory(epub, ptr => assert.equal(renderer.loadEpubFromMemory(ptr, epub.length), true));
            renderer.configureStatusBar(false, false, false, false, false, false, false, false, false);
            renderer.setFontSize(24);
            renderer.setMargins(16, 16, 16, 16);
            renderer.goToPage(0);
            renderer.renderCurrentPage();
            const pixels = renderer.getFrameBuffer();
            let lines = 0;
            let previousInk = false;
            for (let y = 0; y < height; y++) {
                let ink = false;
                for (let x = 0; x < width; x++) {
                    const offset = (y * width + x) * 4;
                    if (pixels[offset] < 128 && pixels[offset + 1] < 128 && pixels[offset + 2] < 128) {
                        ink = true;
                        break;
                    }
                }
                if (ink && !previousInk) lines++;
                previousInk = ink;
            }
            return lines;
        } finally {
            renderer.delete();
        }
    }

    const headerLines = await countLines('<p>XXX</p>') - 1;
    for (const [name, body, expected] of [
        ['inline code', '<p>XXX <code>XXX</code> XXX</p>', 1],
        ['inline whitespace', '<p>XXX <code>XXX\nXXX</code> XXX</p>', 1],
        ['preformatted code', '<p>XXX</p><pre><code>XXX\n  XXX</code></pre><p>XXX</p>', 4],
        ['publisher block style', '<p>XXX <code style="display: block">XXX</code> XXX</p>', 3]
    ]) {
        const actual = await countLines(body) - headerLines;
        assert.equal(actual, expected, name + ': rendered text line count');
        console.log(name + ': ' + actual + ' lines (PASS)');
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
