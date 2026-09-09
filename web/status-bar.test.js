// Run this script in the browser console after you load a book.
(function() {
    function check(value, message) {
        if (!value) throw new Error(message);
    }
    check(totalPages > 0, 'Load a book first');
    enableProgressBar.checked = true;
    statusFontSize.value = '24';
    statusEdgeMargin.value = '24';
    enableProgressBar.dispatchEvent(new Event('change'));
    var toc = renderer.getToc();
    check(JSON.stringify(currentToc) === JSON.stringify(toc), 'Chapter pages differ after layout change');
    var links = chapterList.querySelectorAll('.chapter-item');
    toc.forEach(function(chapter, index) {
        links[index].click();
        check(currentPage === (chapter.page || chapter.startPage || 0), 'Chapter link opens the wrong page');
    });
    currentPage = totalPages - 1;
    enableProgressBar.checked = false;
    enableProgressBar.dispatchEvent(new Event('change'));
    check(currentPage < totalPages, 'Page exceeds page count');
    check(JSON.stringify(currentToc) === JSON.stringify(renderer.getToc()), 'Chapter pages differ');
    enableProgressBar.checked = true;
    showChapterProgress.checked = true;
    statusFontSize.value = '14';
    statusEdgeMargin.value = '0';
    ['top', 'bottom'].forEach(function(position) {
        progressPosition.value = position;
        progressPosition.dispatchEvent(new Event('change'));
        var reserve = getStatusBarGeometry(SCREEN_HEIGHT).reserve;
        [drawStatusBar, drawProgressBar].forEach(function(draw) {
            var image = new ImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
            image.data.fill(255);
            draw(image, currentPage);
            var start = position === 'top' ? reserve : 0;
            var end = position === 'top' ? SCREEN_HEIGHT : SCREEN_HEIGHT - reserve;
            for (var y = start; y < end; y++) {
                for (var x = 0; x < SCREEN_WIDTH; x++) {
                    check(image.data[(y * SCREEN_WIDTH + x) * 4] === 255, 'Status bar exceeds margin');
                }
            }
        });
    });
    console.log('Status bar checks pass');
})();
