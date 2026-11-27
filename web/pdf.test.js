// Run this script in the browser console after loading a SMALL PDF
// (a few pages — the export check converts the whole document).
(async function() {
    var sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
    function check(value, message) {
        if (!value) throw new Error(message);
    }
    check(activeKind === 'pdf' && pdfSource, 'Load a PDF first');
    var base = totalPages;
    check(base > 0, 'No pages loaded');

    // Chapter navigation lands on mapped device pages
    var links = chapterList.querySelectorAll('.chapter-item');
    for (var i = 0; i < currentToc.length; i++) {
        links[i].click();
        check(currentPage === currentToc[i].page, 'Chapter link opens the wrong page');
    }

    // Zoom increases device page count
    pdfZoom.value = '2';
    pdfZoom.dispatchEvent(new Event('change'));
    await sleep(5000);
    check(totalPages > base, 'Zoom 2x should increase page count');

    // Trim rebuild keeps a valid document
    pdfTrimMargins.checked = true;
    pdfTrimMargins.dispatchEvent(new Event('change'));
    await sleep(5000);
    check(totalPages > 0, 'Trim rebuild failed');

    // Export container sanity
    var xtc = await generateXTC(function() {});
    var magic = String.fromCharCode(xtc[0], xtc[1], xtc[2], xtc[3]);
    check(magic === 'XTC\0' || magic === 'XTCH', 'Bad container magic: ' + magic);
    var dv = new DataView(xtc.buffer, xtc.byteOffset, xtc.byteLength);
    check(dv.getUint16(6, true) === totalPages, 'Container page count mismatch');

    // Restore defaults
    pdfZoom.value = '1';
    pdfZoom.dispatchEvent(new Event('change'));
    pdfTrimMargins.checked = false;
    pdfTrimMargins.dispatchEvent(new Event('change'));
    console.log('PDF smoke OK');
})().catch(function(e) { console.error('PDF smoke FAILED:', e); });
