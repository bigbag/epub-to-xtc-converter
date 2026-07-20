const JSZip = require('jszip');

function packageDocument(version, manifest, spine) {
    const namespace = version === '2.0' ? 'http://www.idpf.org/2007/opf' : 'http://www.idpf.org/2007/opf';
    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="${namespace}" version="${version}" unique-identifier="book-id">
  <metadata><dc:identifier xmlns:dc="http://purl.org/dc/elements/1.1/" id="book-id">fixture-${version}</dc:identifier></metadata>
  <manifest>${manifest}</manifest>
  <spine>${spine}</spine>
</package>`;
}

function xhtml(body, attributes = '') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" ${attributes}><head><title>Fixture</title></head><body>${body}</body></html>`;
}

function createFixture(name) {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');

    if (name === 'basic-epub2') {
        zip.file('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
        zip.file('OEBPS/content.opf', packageDocument(
            '2.0',
            '<item id="first" href="Text/one.xhtml" media-type="application/xhtml+xml"/><item id="second" href="Text/two.xhtml" media-type="application/xhtml+xml"/>',
            '<itemref idref="first"/><itemref idref="second" linear="no"/>'
        ));
        zip.file('OEBPS/Text/one.xhtml', xhtml(`<p>${'alpha beta '.repeat(70)}</p><script>${'ignored '.repeat(100)}</script>`));
        zip.file('OEBPS/Text/two.xhtml', xhtml(`<p>${'gamma-delta '.repeat(50)}</p>`));
    } else if (name === 'basic-epub3') {
        zip.file('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="EPUB/package.opf"/></rootfiles></container>');
        zip.file('EPUB/package.opf', packageDocument(
            '3.0',
            '<item id="chapter" href="./Text/chapter%201.xhtml#start" media-type="application/xhtml+xml"/>',
            '<itemref idref="chapter"/>'
        ));
        zip.file('EPUB/Text/chapter 1.xhtml', xhtml(`<h1>Chapter</h1><p>${'one two three four five '.repeat(60)}</p><style>.ignored{content:"words"}</style>`));
    } else if (name === 'unicode-multilingual') {
        zip.file('fallback.opf', packageDocument(
            '3.0',
            '<item id="unicode" href="Text/Ti%E1%BA%BFng%20Vi%E1%BB%87t.xhtml?edition=1" media-type="application/xhtml+xml"/>',
            '<itemref idref="unicode"/>'
        ));
        zip.file('Text/Tiếng Việt.xhtml', xhtml(`<p>${'Tiếng Việt 😀 漢字 العربية שלום\u00a0'.repeat(45)}</p><p>soft\u00adhyphen zero\u200bwidth &#65; &#x1F600; &#x200B;</p>`));
    } else {
        throw new Error(`Unknown fixture: ${name}`);
    }

    return zip;
}

module.exports = { createFixture, xhtml, packageDocument };
