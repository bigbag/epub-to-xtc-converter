// ==================== Global State ====================
let Module = null;
let renderer = null;
let wasmReady = false;
let currentPage = 0;
let totalPages = 0;
let currentToc = [];
let loadedFiles = [];
let currentFileIndex = 0;
let ditherWorker = null;
let ditherCallbacks = new Map();
let ditherJobId = 0;

// Device presets
const DEVICES = {
    'xteink-x4': { width: 480, height: 800, name: 'Xteink X4' },
    'xteink-x3': { width: 528, height: 792, name: 'Xteink X3' },
    'custom': { width: 480, height: 800, name: 'Custom' }
};

let SCREEN_WIDTH = 480;
let SCREEN_HEIGHT = 800;

// ==================== DOM Elements ====================
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const bookTitle = document.getElementById('bookTitle');
const bookAuthor = document.getElementById('bookAuthor');
const previewCanvas = document.getElementById('previewCanvas');
const ctx = previewCanvas.getContext('2d');
const pageInfo = document.getElementById('pageInfo');
const chapterList = document.getElementById('chapterList');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

// Buttons
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const refreshBtn = document.getElementById('refreshBtn');
const exportBtn = document.getElementById('exportBtn');
const exportPageBtn = document.getElementById('exportPageBtn');
const exportAllBtn = document.getElementById('exportAllBtn');
const optimizeBtn = document.getElementById('optimizeBtn');

// Settings
const devicePreset = document.getElementById('devicePreset');
const customDimensions = document.getElementById('customDimensions');
const fontFamily = document.getElementById('fontFamily');
const fontSize = document.getElementById('fontSize');
const fontSizeNum = document.getElementById('fontSizeNum');
const fontWeight = document.getElementById('fontWeight');
const fontWeightNum = document.getElementById('fontWeightNum');
const lineHeight = document.getElementById('lineHeight');
const lineHeightNum = document.getElementById('lineHeightNum');
const margin = document.getElementById('margin');
const marginNum = document.getElementById('marginNum');
const textAlign = document.getElementById('textAlign');
const hyphenation = document.getElementById('hyphenation');
const hyphenationLang = document.getElementById('hyphenationLang');
const qualityMode = document.getElementById('qualityMode');
const enableDithering = document.getElementById('enableDithering');
const ditherStrength = document.getElementById('ditherStrength');
const ditherStrengthNum = document.getElementById('ditherStrengthNum');
const enableNegative = document.getElementById('enableNegative');

// Progress bar settings
const enableProgressBar = document.getElementById('enableProgressBar');
const progressPosition = document.getElementById('progressPosition');
const showBookProgress = document.getElementById('showBookProgress');
const showChapterMarks = document.getElementById('showChapterMarks');
const showChapterProgress = document.getElementById('showChapterProgress');
const progressFullWidth = document.getElementById('progressFullWidth');
const showPageXY = document.getElementById('showPageXY');
const showBookPercent = document.getElementById('showBookPercent');
const showChapterXY = document.getElementById('showChapterXY');
const showChapterPercent = document.getElementById('showChapterPercent');
const statusFontSize = document.getElementById('statusFontSize');
const statusFontSizeNum = document.getElementById('statusFontSizeNum');
const statusEdgeMargin = document.getElementById('statusEdgeMargin');
const statusEdgeMarginNum = document.getElementById('statusEdgeMarginNum');
const statusSideMargin = document.getElementById('statusSideMargin');
const statusSideMarginNum = document.getElementById('statusSideMarginNum');

// ==================== Initialize ====================
async function init() {
    try {
        // Initialize CREngine
        Module = await CREngine();
        renderer = new Module.EpubRenderer(SCREEN_WIDTH, SCREEN_HEIGHT);
        wasmReady = true;
        console.log('CREngine WASM loaded');


        // Load default fonts
        await loadDefaultFonts();

        // Initialize dither worker
        initDitherWorker();

        // Show initial message in chapter list
        showNoChaptersMessage();

    } catch (err) {
        console.error('Failed to initialize CREngine:', err);
        alert('Failed to load WASM module. Please refresh the page.');
    }
}

// Google Fonts configuration - loaded on demand from google/fonts repo
var GOOGLE_FONTS = {
    'Literata': [
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/literata/Literata%5Bopsz%2Cwght%5D.ttf', name: 'Literata-Regular.ttf' },
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/literata/Literata-Italic%5Bopsz%2Cwght%5D.ttf', name: 'Literata-Italic.ttf' }
    ],
    'Lora': [
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/lora/Lora%5Bwght%5D.ttf', name: 'Lora-Regular.ttf' },
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/lora/Lora-Italic%5Bwght%5D.ttf', name: 'Lora-Italic.ttf' }
    ],
    'Merriweather': [
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/merriweather/Merriweather-Regular.ttf', name: 'Merriweather-Regular.ttf' },
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/merriweather/Merriweather-Bold.ttf', name: 'Merriweather-Bold.ttf' },
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/merriweather/Merriweather-Italic.ttf', name: 'Merriweather-Italic.ttf' }
    ],
    'Source Serif 4': [
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/sourceserif4/SourceSerif4%5Bopsz%2Cwght%5D.ttf', name: 'SourceSerif4-Regular.ttf' }
    ],
    'Noto Serif': [
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoserif/NotoSerif-Regular.ttf', name: 'NotoSerif-Regular.ttf' },
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoserif/NotoSerif-Bold.ttf', name: 'NotoSerif-Bold.ttf' },
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoserif/NotoSerif-Italic.ttf', name: 'NotoSerif-Italic.ttf' }
    ],
    'Noto Sans': [
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf', name: 'NotoSans-Regular.ttf' }
    ],
    'Open Sans': [
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/opensans/OpenSans%5Bwdth%2Cwght%5D.ttf', name: 'OpenSans-Regular.ttf' }
    ],
    'Roboto': [
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf', name: 'Roboto-Regular.ttf' }
    ],
    'EB Garamond': [
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf', name: 'EBGaramond-Regular.ttf' },
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/ebgaramond/EBGaramond-Italic%5Bwght%5D.ttf', name: 'EBGaramond-Italic.ttf' }
    ],
    'Crimson Pro': [
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/crimsonpro/CrimsonPro%5Bwght%5D.ttf', name: 'CrimsonPro-Regular.ttf' },
        { url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/crimsonpro/CrimsonPro-Italic%5Bwght%5D.ttf', name: 'CrimsonPro-Italic.ttf' }
    ]
};

var loadedFonts = new Set();

async function loadDefaultFonts() {
    // Load Literata (default font) from Google Fonts
    await loadGoogleFont('Literata');
}

async function loadGoogleFont(familyName) {
    if (loadedFonts.has(familyName)) {
        console.log('Font already loaded:', familyName);
        return true;
    }

    var fontConfig = GOOGLE_FONTS[familyName];
    if (!fontConfig) {
        console.warn('Unknown font family:', familyName);
        return false;
    }

    console.log('Loading Google Font:', familyName);
    var success = false;

    for (var i = 0; i < fontConfig.length; i++) {
        var font = fontConfig[i];
        try {
            var response = await fetch(font.url);
            if (!response.ok) {
                console.warn('Failed to fetch:', font.url, response.status);
                continue;
            }
            var data = new Uint8Array(await response.arrayBuffer());
            var ptr = Module.allocateMemory(data.length);
            Module.HEAPU8.set(data, ptr);
            renderer.registerFontFromMemory(ptr, data.length, font.name);
            Module.freeMemory(ptr);
            console.log('Loaded font:', font.name);
            success = true;
        } catch (err) {
            console.warn('Failed to load font:', font.name, err);
        }
    }

    if (success) {
        loadedFonts.add(familyName);
    }
    return success;
}

function initDitherWorker() {
    try {
        ditherWorker = new Worker('dither-worker.js');
        ditherWorker.onmessage = function(e) {
            const data = e.data;
            const callback = ditherCallbacks.get(data.id);
            if (callback) {
                ditherCallbacks.delete(data.id);
                callback(data.imageData);
            }
        };
        console.log('Dither worker initialized');
    } catch (err) {
        console.warn('Dither worker not available, using sync fallback');
    }
}

// ==================== File Handling ====================
function setupDropZone() {
    dropZone.addEventListener('click', function() {
        fileInput.click();
    });

    dropZone.addEventListener('dragover', function(e) {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', function() {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', function(e) {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', function(e) {
        handleFiles(e.target.files);
    });
}

function handleFiles(files) {
    const epubFiles = Array.from(files).filter(function(f) {
        return f.name.endsWith('.epub');
    });
    if (epubFiles.length === 0) {
        alert('Please select EPUB files');
        return;
    }

    for (var i = 0; i < epubFiles.length; i++) {
        var file = epubFiles[i];
        var exists = loadedFiles.some(function(f) {
            return f.name === file.name;
        });
        if (!exists) {
            loadedFiles.push({ file: file, name: file.name, loaded: false });
        }
    }

    updateFileList();

    // Auto-load first file if none loaded
    var anyLoaded = loadedFiles.some(function(f) { return f.loaded; });
    if (loadedFiles.length > 0 && !anyLoaded) {
        switchToFile(0);
    }

    // Show export all button if multiple files
    exportAllBtn.style.display = loadedFiles.length > 1 ? 'inline-block' : 'none';
}

function updateFileList() {
    // Clear existing items
    while (fileList.firstChild) {
        fileList.removeChild(fileList.firstChild);
    }

    for (var i = 0; i < loadedFiles.length; i++) {
        var fileData = loadedFiles[i];
        var div = document.createElement('div');
        div.className = 'file-item' + (i === currentFileIndex ? ' active' : '');
        div.setAttribute('data-index', i);

        var nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = fileData.name;
        nameSpan.setAttribute('data-index', i);

        var removeBtn = document.createElement('button');
        removeBtn.className = 'remove';
        removeBtn.textContent = 'x';
        removeBtn.setAttribute('data-index', i);

        div.appendChild(nameSpan);
        div.appendChild(removeBtn);
        fileList.appendChild(div);

        // Add event listeners using closure
        (function(index) {
            nameSpan.addEventListener('click', function() {
                switchToFile(index);
            });
            removeBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                removeFile(index);
            });
        })(i);
    }
}

function removeFile(index) {
    loadedFiles.splice(index, 1);
    if (currentFileIndex >= loadedFiles.length) {
        currentFileIndex = Math.max(0, loadedFiles.length - 1);
    }
    updateFileList();

    if (loadedFiles.length > 0) {
        switchToFile(currentFileIndex);
    } else {
        clearPreview();
    }

    exportAllBtn.style.display = loadedFiles.length > 1 ? 'inline-block' : 'none';
}

async function switchToFile(index) {
    if (!wasmReady || index >= loadedFiles.length) return;

    currentFileIndex = index;
    updateFileList();

    var fileData = loadedFiles[index];
    var data = new Uint8Array(await fileData.file.arrayBuffer());

    // Load EPUB into renderer
    var ptr = Module.allocateMemory(data.length);
    Module.HEAPU8.set(data, ptr);

    try {
        renderer.loadEpubFromMemory(ptr, data.length);

        // Always disable CREngine's built-in status bar (we use our own)
        renderer.configureStatusBar(false, false, false, false, false, false, false, false, false);

        applySettings();

        totalPages = renderer.getPageCount();
        currentPage = 0;

        // Get document info
        var info = renderer.getDocumentInfo() || {};
        bookTitle.textContent = info.title || fileData.name;
        bookAuthor.textContent = info.author || info.authors || 'Unknown author';

        // Get TOC
        currentToc = renderer.getToc() || [];
        updateChapterList();

        // Enable buttons
        exportBtn.disabled = false;
        exportPageBtn.disabled = false;
        exportAllBtn.disabled = false;

        fileData.loaded = true;
        renderCurrentPage();

    } catch (err) {
        console.error('Failed to load EPUB:', err);
        alert('Failed to load EPUB file');
    } finally {
        Module.freeMemory(ptr);
    }
}

function clearPreview() {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    bookTitle.textContent = 'No book loaded';
    bookAuthor.textContent = 'Drop an EPUB file to start';
    pageInfo.textContent = 'Page 0 / 0';
    showNoChaptersMessage();
    exportBtn.disabled = true;
    exportPageBtn.disabled = true;
    exportAllBtn.disabled = true;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
}

function showNoChaptersMessage() {
    while (chapterList.firstChild) {
        chapterList.removeChild(chapterList.firstChild);
    }
    var div = document.createElement('div');
    div.className = 'chapter-item';
    div.textContent = 'No chapters loaded';
    chapterList.appendChild(div);
}

// ==================== Status Bar ====================
// Helper to get current chapter info
function getCurrentChapterInfo() {
    if (currentToc.length === 0) return { index: 0, startPage: 0, endPage: totalPages - 1, pagesInChapter: totalPages, pageInChapter: currentPage + 1 };

    var chapterIndex = 0;
    var chapterStartPage = 0;

    for (var i = currentToc.length - 1; i >= 0; i--) {
        var ch = currentToc[i];
        if (!ch) continue;
        var chPage = ch.page || ch.startPage || 0;
        if (currentPage >= chPage) {
            chapterIndex = i;
            chapterStartPage = chPage;
            break;
        }
    }

    // Find end page (start of next chapter or total pages)
    var chapterEndPage = totalPages - 1;
    if (chapterIndex < currentToc.length - 1) {
        var nextCh = currentToc[chapterIndex + 1];
        if (nextCh) {
            chapterEndPage = (nextCh.page || nextCh.startPage || totalPages) - 1;
        }
    }

    var pagesInChapter = chapterEndPage - chapterStartPage + 1;
    var pageInChapter = currentPage - chapterStartPage + 1;

    return {
        index: chapterIndex,
        startPage: chapterStartPage,
        endPage: chapterEndPage,
        pagesInChapter: pagesInChapter,
        pageInChapter: pageInChapter
    };
}

function drawStatusBar(imageData) {
    if (!enableProgressBar.checked) return;

    var data = imageData.data;
    var width = imageData.width;
    var height = imageData.height;
    var position = progressPosition.value;
    var edgeMargin = parseInt(statusEdgeMargin.value) || 0;
    var sideMargin = parseInt(statusSideMargin.value) || 0;
    var fontSize = parseInt(statusFontSize.value) || 14;
    var fullWidth = progressFullWidth.checked;

    // Calculate status bar area
    var barHeight = 6;
    var textHeight = fontSize + 4;
    var totalHeight = barHeight + textHeight + 4;
    var startY = position === 'top' ? edgeMargin : height - totalHeight - edgeMargin;
    var barY = position === 'top' ? startY + textHeight + 2 : startY;
    var textY = position === 'top' ? startY : startY + barHeight + 2;

    var barStartX = fullWidth ? 0 : sideMargin;
    var barEndX = fullWidth ? width : width - sideMargin;
    var barWidth = barEndX - barStartX;

    // Clear the status bar area (white background)
    for (var y = startY; y < startY + totalHeight && y < height; y++) {
        for (var x = 0; x < width; x++) {
            if (y >= 0) {
                var idx = (y * width + x) * 4;
                data[idx] = 255;
                data[idx + 1] = 255;
                data[idx + 2] = 255;
                data[idx + 3] = 255;
            }
        }
    }

    var chapterInfo = getCurrentChapterInfo();

    // Draw book progress bar
    if (showBookProgress.checked && barWidth > 0) {
        // Background
        for (var y = barY; y < barY + barHeight && y < height; y++) {
            for (var x = barStartX; x < barEndX; x++) {
                if (y >= 0) {
                    var idx = (y * width + x) * 4;
                    data[idx] = 200;
                    data[idx + 1] = 200;
                    data[idx + 2] = 200;
                    data[idx + 3] = 255;
                }
            }
        }

        // Progress fill
        var bookProgress = totalPages > 0 ? (currentPage + 1) / totalPages : 0;
        var progressWidth = Math.floor(barWidth * bookProgress);

        for (var y = barY; y < barY + barHeight && y < height; y++) {
            for (var x = barStartX; x < barStartX + progressWidth && x < barEndX; x++) {
                if (y >= 0) {
                    var idx = (y * width + x) * 4;
                    data[idx] = 0;
                    data[idx + 1] = 0;
                    data[idx + 2] = 0;
                    data[idx + 3] = 255;
                }
            }
        }

        // Chapter marks
        if (showChapterMarks.checked && currentToc.length > 0) {
            for (var i = 0; i < currentToc.length; i++) {
                var ch = currentToc[i];
                if (!ch) continue;
                var chapterPage = ch.page || ch.startPage || 0;
                var markX = barStartX + Math.floor((chapterPage / totalPages) * barWidth);
                for (var y = barY - 2; y < barY + barHeight + 2; y++) {
                    if (y >= 0 && y < height && markX >= barStartX && markX < barEndX) {
                        var idx = (y * width + markX) * 4;
                        data[idx] = 255;
                        data[idx + 1] = 255;
                        data[idx + 2] = 255;
                        data[idx + 3] = 255;
                    }
                }
            }
        }
    }

    // Draw chapter progress bar (below book progress)
    if (showChapterProgress.checked && barWidth > 0) {
        var chapterBarY = barY + barHeight + 2;

        // Background
        for (var y = chapterBarY; y < chapterBarY + barHeight && y < height; y++) {
            for (var x = barStartX; x < barEndX; x++) {
                if (y >= 0) {
                    var idx = (y * width + x) * 4;
                    data[idx] = 220;
                    data[idx + 1] = 220;
                    data[idx + 2] = 220;
                    data[idx + 3] = 255;
                }
            }
        }

        // Chapter progress fill
        var chapterProgress = chapterInfo.pagesInChapter > 0 ? chapterInfo.pageInChapter / chapterInfo.pagesInChapter : 0;
        var chapterProgressWidth = Math.floor(barWidth * chapterProgress);

        for (var y = chapterBarY; y < chapterBarY + barHeight && y < height; y++) {
            for (var x = barStartX; x < barStartX + chapterProgressWidth && x < barEndX; x++) {
                if (y >= 0) {
                    var idx = (y * width + x) * 4;
                    data[idx] = 80;
                    data[idx + 1] = 80;
                    data[idx + 2] = 80;
                    data[idx + 3] = 255;
                }
            }
        }
    }

    // Build text strings
    var leftText = '';
    var rightText = '';

    if (showPageXY.checked) {
        leftText += (currentPage + 1) + '/' + totalPages;
    }

    if (showBookPercent.checked) {
        var bookPct = totalPages > 0 ? Math.round(((currentPage + 1) / totalPages) * 100) : 0;
        if (leftText) leftText += '  ';
        leftText += bookPct + '%';
    }

    if (showChapterXY.checked) {
        rightText += chapterInfo.pageInChapter + '/' + chapterInfo.pagesInChapter;
    }

    if (showChapterPercent.checked) {
        var chapterPct = chapterInfo.pagesInChapter > 0 ? Math.round((chapterInfo.pageInChapter / chapterInfo.pagesInChapter) * 100) : 0;
        if (rightText) rightText += '  ';
        rightText += chapterPct + '%';
    }

    // Draw text using offscreen canvas
    if (leftText || rightText) {
        var textCanvas = document.createElement('canvas');
        textCanvas.width = width;
        textCanvas.height = textHeight;
        var textCtx = textCanvas.getContext('2d');

        textCtx.fillStyle = '#fff';
        textCtx.fillRect(0, 0, width, textHeight);

        textCtx.font = fontSize + 'px sans-serif';
        textCtx.fillStyle = '#000';
        textCtx.textBaseline = 'middle';

        if (leftText) {
            textCtx.textAlign = 'left';
            textCtx.fillText(leftText, sideMargin + 4, textHeight / 2);
        }

        if (rightText) {
            textCtx.textAlign = 'right';
            textCtx.fillText(rightText, width - sideMargin - 4, textHeight / 2);
        }

        // Copy text to imageData
        var textImageData = textCtx.getImageData(0, 0, width, textHeight);
        var textData = textImageData.data;

        for (var ty = 0; ty < textHeight; ty++) {
            var destY = textY + ty;
            if (destY >= 0 && destY < height) {
                for (var tx = 0; tx < width; tx++) {
                    var srcIdx = (ty * width + tx) * 4;
                    var destIdx = (destY * width + tx) * 4;
                    data[destIdx] = textData[srcIdx];
                    data[destIdx + 1] = textData[srcIdx + 1];
                    data[destIdx + 2] = textData[srcIdx + 2];
                    data[destIdx + 3] = textData[srcIdx + 3];
                }
            }
        }
    }
}

// ==================== Rendering ====================
function renderCurrentPage() {
    if (!wasmReady || !renderer) return;

    try {
        // Go to page and render
        renderer.goToPage(currentPage);
        renderer.renderCurrentPage();

        var frameBuffer = renderer.getFrameBuffer();
        if (!frameBuffer || frameBuffer.length === 0) {
            console.warn('Empty frame buffer');
            return;
        }

        var imageData = new ImageData(
            new Uint8ClampedArray(frameBuffer),
            SCREEN_WIDTH,
            SCREEN_HEIGHT
        );

        // Apply negative (dark mode) if enabled
        if (enableNegative.checked) {
            applyNegative(imageData);
        }

        // Draw our custom status bar on preview
        drawStatusBar(imageData);

        ctx.putImageData(imageData, 0, 0);

        // Update page info (1-indexed for display)
        pageInfo.textContent = 'Page ' + (currentPage + 1) + ' / ' + totalPages;
        prevBtn.disabled = currentPage === 0;
        nextBtn.disabled = currentPage >= totalPages - 1;

        // Highlight current chapter
        updateCurrentChapter();
    } catch (err) {
        console.error('Error rendering page:', err);
    }
}

function applySettings() {
    if (!renderer) return;

    try {
        var m = parseInt(margin.value) || 16;
        renderer.setMargins(m, m, m, m);
        renderer.setFontSize(parseInt(fontSize.value) || 34);
        renderer.setInterlineSpace(parseInt(lineHeight.value) || 120);
        renderer.setFontWeight(parseInt(fontWeight.value) || 400);

        // Only set font face if not custom (custom fonts use registered name)
        var selectedFont = fontFamily.value;
        if (selectedFont && selectedFont !== 'custom') {
            renderer.setFontFace(selectedFont);
        }

        renderer.setTextAlign(getTextAlignValue());
        renderer.setHyphenation(parseInt(hyphenation.value) || 0);

        // Set hyphenation language if method exists
        var hyphLang = hyphenationLang.value;
        if (hyphLang && hyphLang !== 'auto' && renderer.setHyphenationLanguage) {
            renderer.setHyphenationLanguage(hyphLang);
        }

        // Re-paginate only if document is loaded
        var pageCount = renderer.getPageCount();
        if (pageCount > 0) {
            totalPages = pageCount;
        }
    } catch (err) {
        console.warn('Error applying settings:', err);
    }
}

function getTextAlignValue() {
    var align = textAlign.value;
    // CREngine text align values: 0=left, 1=right, 2=center, 3=justify
    switch (align) {
        case 'left': return 0;
        case 'right': return 1;
        case 'center': return 2;
        case 'justify': return 3;
        default: return 3;
    }
}

// ==================== Navigation ====================
function setupNavigation() {
    prevBtn.addEventListener('click', function() {
        if (currentPage > 0) {
            currentPage--;
            renderCurrentPage();
        }
    });

    nextBtn.addEventListener('click', function() {
        if (currentPage < totalPages - 1) {
            currentPage++;
            renderCurrentPage();
        }
    });

    refreshBtn.addEventListener('click', function() {
        // Just re-render current page (applySettings called on slider change)
        renderCurrentPage();
    });
}

// ==================== Chapters ====================
function updateChapterList() {
    // Clear existing items
    while (chapterList.firstChild) {
        chapterList.removeChild(chapterList.firstChild);
    }

    if (currentToc.length === 0) {
        var noChapters = document.createElement('div');
        noChapters.className = 'chapter-item';
        noChapters.textContent = 'No chapters found';
        chapterList.appendChild(noChapters);
        return;
    }

    for (var i = 0; i < currentToc.length; i++) {
        var ch = currentToc[i];
        if (!ch) continue;

        var div = document.createElement('div');
        div.className = 'chapter-item';
        div.textContent = ch.title || ch.name || 'Chapter ' + (i + 1);

        var chapterPage = ch.page || ch.startPage || 0;
        div.setAttribute('data-page', chapterPage);
        div.setAttribute('data-index', i);

        (function(page) {
            div.addEventListener('click', function() {
                currentPage = page;
                renderCurrentPage();
            });
        })(chapterPage);

        chapterList.appendChild(div);
    }
}

function updateCurrentChapter() {
    var items = chapterList.querySelectorAll('.chapter-item');
    for (var i = 0; i < items.length; i++) {
        items[i].classList.remove('active');
    }

    for (var i = currentToc.length - 1; i >= 0; i--) {
        var ch = currentToc[i];
        if (!ch) continue;
        var chapterPage = ch.page || ch.startPage || 0;
        if (currentPage >= chapterPage) {
            if (items[i]) {
                items[i].classList.add('active');
            }
            break;
        }
    }
}

// ==================== Settings UI ====================
function setupSettings() {
    // Sync slider/number inputs
    syncInputs(fontSize, fontSizeNum, 'fontSizeValue');
    syncInputs(fontWeight, fontWeightNum, 'fontWeightValue');
    syncInputs(lineHeight, lineHeightNum, 'lineHeightValue');
    syncInputs(margin, marginNum, 'marginValue');
    syncInputs(ditherStrength, ditherStrengthNum, 'ditherStrengthValue');
    syncInputs(document.getElementById('maxImageWidth'),
               document.getElementById('maxImageWidthNum'),
               'maxImageWidthValue');

    // Status bar sliders (render-only, no applySettings needed)
    syncInputsRenderOnly(statusFontSize, statusFontSizeNum, 'statusFontSizeValue');
    syncInputsRenderOnly(statusEdgeMargin, statusEdgeMarginNum, 'statusEdgeMarginValue');
    syncInputsRenderOnly(statusSideMargin, statusSideMarginNum, 'statusSideMarginValue');

    // Monitor DPI - calculates preview scale based on device DPI
    var monitorDpi = document.getElementById('monitorDpi');
    var monitorDpiNum = document.getElementById('monitorDpiNum');
    var monitorDpiValue = document.getElementById('monitorDpiValue');
    var previewScaleValue = document.getElementById('previewScaleValue');

    // Device DPI values
    var DEVICE_DPI = {
        'xteink-x4': 220,
        'xteink-x3': 212,
        'custom': 220
    };

    function updatePreviewScale() {
        var deviceDpi = DEVICE_DPI[devicePreset.value] || 220;
        var monDpi = parseInt(monitorDpi.value) || 96;
        var scale = monDpi / deviceDpi;
        var scalePercent = Math.round(scale * 100);

        previewCanvas.style.setProperty('--preview-scale', scale);
        monitorDpiValue.textContent = monDpi;
        previewScaleValue.textContent = scalePercent;
    }

    monitorDpi.addEventListener('input', function() {
        monitorDpiNum.value = monitorDpi.value;
        updatePreviewScale();
    });

    monitorDpiNum.addEventListener('input', function() {
        monitorDpi.value = monitorDpiNum.value;
        updatePreviewScale();
    });

    // Initialize preview scale
    updatePreviewScale();

    // Device preset
    devicePreset.addEventListener('change', function() {
        var preset = devicePreset.value;
        customDimensions.style.display = preset === 'custom' ? 'block' : 'none';

        if (preset !== 'custom') {
            SCREEN_WIDTH = DEVICES[preset].width;
            SCREEN_HEIGHT = DEVICES[preset].height;
            updateCanvasSize();
        }

        // Update preview scale for new device DPI
        updatePreviewScale();
    });

    // Custom dimensions
    document.getElementById('customWidth').addEventListener('change', updateCanvasSize);
    document.getElementById('customHeight').addEventListener('change', updateCanvasSize);

    // Orientation buttons
    var orientBtns = document.querySelectorAll('.orientation-buttons button');
    for (var i = 0; i < orientBtns.length; i++) {
        orientBtns[i].addEventListener('click', function() {
            for (var j = 0; j < orientBtns.length; j++) {
                orientBtns[j].classList.remove('active');
            }
            this.classList.add('active');
            updateOrientation(parseInt(this.getAttribute('data-orientation')));
        });
    }

    // Text align change
    textAlign.addEventListener('change', function() {
        applySettings();
        renderCurrentPage();
    });

    // Hyphenation mode - show/hide language dropdown
    hyphenation.addEventListener('change', function() {
        var langGroup = document.getElementById('hyphenationLangGroup');
        langGroup.style.display = hyphenation.value === '0' ? 'none' : 'block';
        applySettings();
        renderCurrentPage();
    });

    // Hyphenation language change
    hyphenationLang.addEventListener('change', function() {
        applySettings();
        renderCurrentPage();
    });

    // Initialize hyphenation language visibility
    document.getElementById('hyphenationLangGroup').style.display =
        hyphenation.value === '0' ? 'none' : 'block';

    // Quality mode
    qualityMode.addEventListener('change', function() {
        document.getElementById('ditherStrengthGroup').style.display =
            enableDithering.checked ? 'block' : 'none';
    });

    // Dithering toggle
    enableDithering.addEventListener('change', function() {
        document.getElementById('ditherStrengthGroup').style.display =
            enableDithering.checked ? 'block' : 'none';
    });

    // Negative (dark mode) toggle
    enableNegative.addEventListener('change', function() {
        renderCurrentPage();
    });

    // Progress bar toggle - re-render to show/hide our custom status bar
    enableProgressBar.addEventListener('change', function() {
        document.getElementById('progressSettings').style.display =
            enableProgressBar.checked ? 'block' : 'none';
        renderCurrentPage();
    });

    // All progress bar setting changes trigger re-render
    var progressBarCheckboxes = [
        progressPosition, showBookProgress, showChapterMarks, showChapterProgress,
        progressFullWidth, showPageXY, showBookPercent, showChapterXY, showChapterPercent
    ];
    progressBarCheckboxes.forEach(function(el) {
        if (el) {
            el.addEventListener('change', function() {
                renderCurrentPage();
            });
        }
    });

    // Tabs
    var tabBtns = document.querySelectorAll('.tabs button');
    for (var i = 0; i < tabBtns.length; i++) {
        tabBtns[i].addEventListener('click', function() {
            for (var j = 0; j < tabBtns.length; j++) {
                tabBtns[j].classList.remove('active');
            }
            var tabContents = document.querySelectorAll('.tab-content');
            for (var j = 0; j < tabContents.length; j++) {
                tabContents[j].classList.remove('active');
            }
            this.classList.add('active');
            document.getElementById(this.getAttribute('data-tab') + '-tab').classList.add('active');
        });
    }
}

function syncInputs(slider, num, valueId) {
    var valueEl = document.getElementById(valueId);

    slider.addEventListener('input', function() {
        num.value = slider.value;
        if (valueEl) valueEl.textContent = slider.value;
    });

    num.addEventListener('input', function() {
        slider.value = num.value;
        if (valueEl) valueEl.textContent = num.value;
    });

    slider.addEventListener('change', function() {
        applySettings();
        renderCurrentPage();
    });
    num.addEventListener('change', function() {
        applySettings();
        renderCurrentPage();
    });
}

// Sync inputs that only need re-render (not applySettings)
function syncInputsRenderOnly(slider, num, valueId) {
    var valueEl = document.getElementById(valueId);

    slider.addEventListener('input', function() {
        num.value = slider.value;
        if (valueEl) valueEl.textContent = slider.value;
        renderCurrentPage();
    });

    num.addEventListener('input', function() {
        slider.value = num.value;
        if (valueEl) valueEl.textContent = num.value;
        renderCurrentPage();
    });
}

function updateCanvasSize() {
    if (devicePreset.value === 'custom') {
        SCREEN_WIDTH = parseInt(document.getElementById('customWidth').value);
        SCREEN_HEIGHT = parseInt(document.getElementById('customHeight').value);
    }

    previewCanvas.width = SCREEN_WIDTH;
    previewCanvas.height = SCREEN_HEIGHT;

    if (renderer) {
        renderer.resize(SCREEN_WIDTH, SCREEN_HEIGHT);
        applySettings();
        renderCurrentPage();
    }
}

function updateOrientation(rotation) {
    var baseDevice = DEVICES[devicePreset.value] || DEVICES['xteink-x4'];
    var isLandscape = rotation === 90 || rotation === 270;

    if (isLandscape) {
        SCREEN_WIDTH = baseDevice.height;
        SCREEN_HEIGHT = baseDevice.width;
    } else {
        SCREEN_WIDTH = baseDevice.width;
        SCREEN_HEIGHT = baseDevice.height;
    }

    updateCanvasSize();
}

// ==================== Export Functions ====================
async function exportXTC() {
    if (!renderer || totalPages === 0) return;

    var isHQ = qualityMode.value === 'hq';
    var extension = isHQ ? 'xtch' : 'xtc';
    var filename = loadedFiles[currentFileIndex].name.replace('.epub', '.' + extension);

    progressContainer.style.display = 'block';
    progressText.textContent = 'Generating XTC...';
    progressFill.style.width = '0%';

    try {
        var xtcData = await generateXTC(function(progress, page) {
            progressFill.style.width = progress + '%';
            progressText.textContent = 'Processing page ' + page + ' / ' + totalPages;
        });

        downloadFile(xtcData, filename);
        progressText.textContent = 'Export complete!';

    } catch (err) {
        console.error('Export failed:', err);
        progressText.textContent = 'Export failed: ' + err.message;
    }

    setTimeout(function() {
        progressContainer.style.display = 'none';
    }, 2000);
}

async function exportCurrentPage() {
    if (!renderer) return;

    var isHQ = qualityMode.value === 'hq';
    var pageData = await renderPageForExport(currentPage);

    var filename = 'page_' + (currentPage + 1) + '.' + (isHQ ? 'xth' : 'xtg');
    downloadFile(pageData, filename);
}

async function exportAllFiles() {
    if (loadedFiles.length === 0) return;

    var zip = new JSZip();
    var isHQ = qualityMode.value === 'hq';
    var extension = isHQ ? 'xtch' : 'xtc';

    progressContainer.style.display = 'block';

    for (var i = 0; i < loadedFiles.length; i++) {
        progressText.textContent = 'Converting file ' + (i + 1) + ' / ' + loadedFiles.length + ': ' + loadedFiles[i].name;

        await switchToFile(i);

        var xtcData = await generateXTC(function(progress, page) {
            var overallProgress = ((i + progress / 100) / loadedFiles.length) * 100;
            progressFill.style.width = overallProgress + '%';
        });

        var filename = loadedFiles[i].name.replace('.epub', '.' + extension);
        zip.file(filename, xtcData);
    }

    progressText.textContent = 'Creating ZIP file...';
    var zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadFile(zipBlob, 'converted_books.zip');

    progressText.textContent = 'Export complete!';
    setTimeout(function() {
        progressContainer.style.display = 'none';
    }, 2000);
}

async function generateXTC(progressCallback) {
    var isHQ = qualityMode.value === 'hq';
    var pages = [];

    // Render all pages
    for (var i = 0; i < totalPages; i++) {
        var pageData = await renderPageForExport(i);
        pages.push(pageData);

        if (progressCallback) {
            progressCallback((i + 1) / totalPages * 100, i + 1);
        }
    }

    // Build XTC container
    return buildXTCContainer(pages, isHQ);
}

async function renderPageForExport(pageNum) {
    renderer.goToPage(pageNum);
    renderer.renderCurrentPage();

    var frameBuffer = renderer.getFrameBuffer();
    if (!frameBuffer || frameBuffer.length === 0) {
        throw new Error('Empty frame buffer for page ' + pageNum);
    }

    var imageData = new ImageData(
        new Uint8ClampedArray(frameBuffer),
        SCREEN_WIDTH,
        SCREEN_HEIGHT
    );

    // Apply dithering if enabled
    if (enableDithering.checked) {
        var bits = qualityMode.value === 'hq' ? 2 : 1;
        var strength = parseInt(ditherStrength.value) / 100;
        imageData = await applyDithering(imageData, bits, strength);
    }

    // Apply negative if enabled
    if (enableNegative.checked) {
        applyNegative(imageData);
    }

    // Draw progress bar if enabled
    if (enableProgressBar.checked) {
        drawProgressBar(imageData, pageNum);
    }

    // Encode to XTG/XTH
    var isHQ = qualityMode.value === 'hq';
    return isHQ ? encodeXTH(imageData) : encodeXTG(imageData);
}

// ==================== Dithering ====================
async function applyDithering(imageData, bits, strength) {
    if (ditherWorker) {
        return await applyDitheringAsync(imageData, bits, strength);
    } else {
        return applyDitheringSync(imageData, bits, strength);
    }
}

function applyDitheringAsync(imageData, bits, strength) {
    return new Promise(function(resolve) {
        var id = ++ditherJobId;
        ditherCallbacks.set(id, function(resultData) {
            resolve(new ImageData(
                new Uint8ClampedArray(resultData),
                imageData.width,
                imageData.height
            ));
        });

        ditherWorker.postMessage({
            imageData: imageData.data.buffer.slice(0),
            width: imageData.width,
            height: imageData.height,
            bits: bits,
            strength: strength,
            id: id
        });
    });
}

function applyDitheringSync(imageData, bits, strength) {
    var data = imageData.data;
    var width = imageData.width;
    var height = imageData.height;

    // Floyd-Steinberg dithering
    var gray = new Float32Array(width * height);

    // Convert to grayscale
    for (var i = 0; i < width * height; i++) {
        var idx = i * 4;
        gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }

    // Dither
    for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
            var idx = y * width + x;
            var oldPixel = gray[idx];
            var newPixel = quantize(oldPixel, bits);
            gray[idx] = newPixel;

            var error = (oldPixel - newPixel) * strength;

            if (x + 1 < width) gray[idx + 1] += error * 7 / 16;
            if (y + 1 < height) {
                if (x > 0) gray[idx + width - 1] += error * 3 / 16;
                gray[idx + width] += error * 5 / 16;
                if (x + 1 < width) gray[idx + width + 1] += error * 1 / 16;
            }
        }
    }

    // Write back to imageData
    for (var i = 0; i < width * height; i++) {
        var v = Math.max(0, Math.min(255, Math.round(gray[i])));
        var idx = i * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = v;
    }

    return imageData;
}

function quantize(value, bits) {
    if (bits === 1) {
        return value < 128 ? 0 : 255;
    } else {
        // 2-bit: 4 levels for XTH
        if (value > 212) return 255;
        if (value > 127) return 170;
        if (value > 42) return 85;
        return 0;
    }
}

function applyNegative(imageData) {
    var data = imageData.data;
    for (var i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i];
        data[i + 1] = 255 - data[i + 1];
        data[i + 2] = 255 - data[i + 2];
    }
}

// Helper to get chapter info for a specific page (for export)
function getChapterInfoForPage(pageNum) {
    if (currentToc.length === 0) return { index: 0, startPage: 0, endPage: totalPages - 1, pagesInChapter: totalPages, pageInChapter: pageNum + 1 };

    var chapterIndex = 0;
    var chapterStartPage = 0;

    for (var i = currentToc.length - 1; i >= 0; i--) {
        var ch = currentToc[i];
        if (!ch) continue;
        var chPage = ch.page || ch.startPage || 0;
        if (pageNum >= chPage) {
            chapterIndex = i;
            chapterStartPage = chPage;
            break;
        }
    }

    var chapterEndPage = totalPages - 1;
    if (chapterIndex < currentToc.length - 1) {
        var nextCh = currentToc[chapterIndex + 1];
        if (nextCh) {
            chapterEndPage = (nextCh.page || nextCh.startPage || totalPages) - 1;
        }
    }

    var pagesInChapter = chapterEndPage - chapterStartPage + 1;
    var pageInChapter = pageNum - chapterStartPage + 1;

    return {
        index: chapterIndex,
        startPage: chapterStartPage,
        endPage: chapterEndPage,
        pagesInChapter: pagesInChapter,
        pageInChapter: pageInChapter
    };
}

function drawProgressBar(imageData, pageNum) {
    var data = imageData.data;
    var width = imageData.width;
    var height = imageData.height;
    var position = progressPosition.value;
    var edgeMargin = parseInt(statusEdgeMargin.value) || 0;
    var sideMargin = parseInt(statusSideMargin.value) || 0;
    var fontSize = parseInt(statusFontSize.value) || 14;
    var fullWidth = progressFullWidth.checked;

    var barHeight = 6;
    var textHeight = fontSize + 4;
    var totalHeight = barHeight + textHeight + 4;
    var startY = position === 'top' ? edgeMargin : height - totalHeight - edgeMargin;
    var barY = position === 'top' ? startY + textHeight + 2 : startY;
    var textY = position === 'top' ? startY : startY + barHeight + 2;

    var barStartX = fullWidth ? 0 : sideMargin;
    var barEndX = fullWidth ? width : width - sideMargin;
    var barWidth = barEndX - barStartX;

    // Clear the status bar area (white background)
    for (var y = startY; y < startY + totalHeight && y < height; y++) {
        for (var x = 0; x < width; x++) {
            if (y >= 0) {
                var idx = (y * width + x) * 4;
                data[idx] = 255;
                data[idx + 1] = 255;
                data[idx + 2] = 255;
                data[idx + 3] = 255;
            }
        }
    }

    var chapterInfo = getChapterInfoForPage(pageNum);

    // Draw book progress bar
    if (showBookProgress.checked && barWidth > 0) {
        for (var y = barY; y < barY + barHeight && y < height; y++) {
            for (var x = barStartX; x < barEndX; x++) {
                if (y >= 0) {
                    var idx = (y * width + x) * 4;
                    data[idx] = 200;
                    data[idx + 1] = 200;
                    data[idx + 2] = 200;
                    data[idx + 3] = 255;
                }
            }
        }

        var bookProgress = totalPages > 0 ? (pageNum + 1) / totalPages : 0;
        var progressWidth = Math.floor(barWidth * bookProgress);

        for (var y = barY; y < barY + barHeight && y < height; y++) {
            for (var x = barStartX; x < barStartX + progressWidth && x < barEndX; x++) {
                if (y >= 0) {
                    var idx = (y * width + x) * 4;
                    data[idx] = 0;
                    data[idx + 1] = 0;
                    data[idx + 2] = 0;
                    data[idx + 3] = 255;
                }
            }
        }

        if (showChapterMarks.checked && currentToc.length > 0) {
            for (var i = 0; i < currentToc.length; i++) {
                var ch = currentToc[i];
                if (!ch) continue;
                var chapterPage = ch.page || ch.startPage || 0;
                var markX = barStartX + Math.floor((chapterPage / totalPages) * barWidth);
                for (var y = barY - 2; y < barY + barHeight + 2; y++) {
                    if (y >= 0 && y < height && markX >= barStartX && markX < barEndX) {
                        var idx = (y * width + markX) * 4;
                        data[idx] = 255;
                        data[idx + 1] = 255;
                        data[idx + 2] = 255;
                        data[idx + 3] = 255;
                    }
                }
            }
        }
    }

    // Draw chapter progress bar
    if (showChapterProgress.checked && barWidth > 0) {
        var chapterBarY = barY + barHeight + 2;

        for (var y = chapterBarY; y < chapterBarY + barHeight && y < height; y++) {
            for (var x = barStartX; x < barEndX; x++) {
                if (y >= 0) {
                    var idx = (y * width + x) * 4;
                    data[idx] = 220;
                    data[idx + 1] = 220;
                    data[idx + 2] = 220;
                    data[idx + 3] = 255;
                }
            }
        }

        var chapterProgress = chapterInfo.pagesInChapter > 0 ? chapterInfo.pageInChapter / chapterInfo.pagesInChapter : 0;
        var chapterProgressWidth = Math.floor(barWidth * chapterProgress);

        for (var y = chapterBarY; y < chapterBarY + barHeight && y < height; y++) {
            for (var x = barStartX; x < barStartX + chapterProgressWidth && x < barEndX; x++) {
                if (y >= 0) {
                    var idx = (y * width + x) * 4;
                    data[idx] = 80;
                    data[idx + 1] = 80;
                    data[idx + 2] = 80;
                    data[idx + 3] = 255;
                }
            }
        }
    }

    // Build text strings
    var leftText = '';
    var rightText = '';

    if (showPageXY.checked) {
        leftText += (pageNum + 1) + '/' + totalPages;
    }

    if (showBookPercent.checked) {
        var bookPct = totalPages > 0 ? Math.round(((pageNum + 1) / totalPages) * 100) : 0;
        if (leftText) leftText += '  ';
        leftText += bookPct + '%';
    }

    if (showChapterXY.checked) {
        rightText += chapterInfo.pageInChapter + '/' + chapterInfo.pagesInChapter;
    }

    if (showChapterPercent.checked) {
        var chapterPct = chapterInfo.pagesInChapter > 0 ? Math.round((chapterInfo.pageInChapter / chapterInfo.pagesInChapter) * 100) : 0;
        if (rightText) rightText += '  ';
        rightText += chapterPct + '%';
    }

    // Draw text using offscreen canvas
    if (leftText || rightText) {
        var textCanvas = document.createElement('canvas');
        textCanvas.width = width;
        textCanvas.height = textHeight;
        var textCtx = textCanvas.getContext('2d');

        textCtx.fillStyle = '#fff';
        textCtx.fillRect(0, 0, width, textHeight);

        textCtx.font = fontSize + 'px sans-serif';
        textCtx.fillStyle = '#000';
        textCtx.textBaseline = 'middle';

        if (leftText) {
            textCtx.textAlign = 'left';
            textCtx.fillText(leftText, sideMargin + 4, textHeight / 2);
        }

        if (rightText) {
            textCtx.textAlign = 'right';
            textCtx.fillText(rightText, width - sideMargin - 4, textHeight / 2);
        }

        var textImageData = textCtx.getImageData(0, 0, width, textHeight);
        var textData = textImageData.data;

        for (var ty = 0; ty < textHeight; ty++) {
            var destY = textY + ty;
            if (destY >= 0 && destY < height) {
                for (var tx = 0; tx < width; tx++) {
                    var srcIdx = (ty * width + tx) * 4;
                    var destIdx = (destY * width + tx) * 4;
                    data[destIdx] = textData[srcIdx];
                    data[destIdx + 1] = textData[srcIdx + 1];
                    data[destIdx + 2] = textData[srcIdx + 2];
                    data[destIdx + 3] = textData[srcIdx + 3];
                }
            }
        }
    }
}

// ==================== XTG/XTH Encoding ====================
function encodeXTG(imageData) {
    // XTG: 1-bit monochrome, row-major, MSB = leftmost pixel
    var width = imageData.width;
    var height = imageData.height;
    var data = imageData.data;

    // Header: 22 bytes
    var header = new Uint8Array(22);
    var view = new DataView(header.buffer);

    // Magic "XTG\0"
    header[0] = 0x58; // X
    header[1] = 0x54; // T
    header[2] = 0x47; // G
    header[3] = 0x00;

    // Dimensions (per XTG spec - no version field!)
    view.setUint16(4, width, true);    // offset 0x04
    view.setUint16(6, height, true);   // offset 0x06
    header[8] = 0;                      // colorMode = 0 (monochrome)
    header[9] = 0;                      // compression = 0 (uncompressed)

    // Bitmap: 8 pixels per byte, MSB = leftmost
    var rowBytes = Math.ceil(width / 8);
    var dataSize = rowBytes * height;
    view.setUint32(10, dataSize, true); // offset 0x0A (dataSize)
    // md5 at 0x0E left as zeros (optional)
    var bitmap = new Uint8Array(rowBytes * height);

    for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
            var srcIdx = (y * width + x) * 4;
            var gray = data[srcIdx]; // Already grayscale after dithering

            if (gray < 128) {
                // Black pixel - set bit
                var byteIdx = y * rowBytes + Math.floor(x / 8);
                var bitIdx = 7 - (x % 8); // MSB first
                bitmap[byteIdx] |= (1 << bitIdx);
            }
        }
    }

    // Combine header + bitmap
    var result = new Uint8Array(header.length + bitmap.length);
    result.set(header, 0);
    result.set(bitmap, header.length);

    return result;
}

function encodeXTH(imageData) {
    // XTH: 2-bit grayscale, vertical scan (columns right-to-left)
    var width = imageData.width;
    var height = imageData.height;
    var data = imageData.data;

    // Header: 22 bytes
    var header = new Uint8Array(22);
    var view = new DataView(header.buffer);

    // Magic "XTH\0"
    header[0] = 0x58; // X
    header[1] = 0x54; // T
    header[2] = 0x48; // H
    header[3] = 0x00;

    // Dimensions (per XTH spec - no version field!)
    view.setUint16(4, width, true);    // offset 0x04
    view.setUint16(6, height, true);   // offset 0x06
    header[8] = 0;                      // colorMode = 0
    header[9] = 0;                      // compression = 0

    // Two bit planes, vertical scan, columns right-to-left
    var colBytes = Math.ceil(height / 8);
    var dataSize = colBytes * width * 2; // Two bit planes
    view.setUint32(10, dataSize, true); // offset 0x0A (dataSize)
    // md5 at 0x0E left as zeros (optional)
    var plane0 = new Uint8Array(colBytes * width); // bit 0
    var plane1 = new Uint8Array(colBytes * width); // bit 1

    for (var x = width - 1; x >= 0; x--) {
        var colIdx = width - 1 - x;

        for (var y = 0; y < height; y++) {
            var srcIdx = (y * width + x) * 4;
            var gray = data[srcIdx];

            // Quantize to 2-bit (XTH LUT)
            var level;
            if (gray > 212) level = 0b00;      // White
            else if (gray > 127) level = 0b10; // Light Gray
            else if (gray > 42) level = 0b01;  // Dark Gray
            else level = 0b11;                 // Black

            var byteIdx = colIdx * colBytes + Math.floor(y / 8);
            var bitIdx = 7 - (y % 8);

            if (level & 0b01) plane0[byteIdx] |= (1 << bitIdx);
            if (level & 0b10) plane1[byteIdx] |= (1 << bitIdx);
        }
    }

    // Combine header + plane0 + plane1
    var result = new Uint8Array(header.length + plane0.length + plane1.length);
    result.set(header, 0);
    result.set(plane0, header.length);
    result.set(plane1, header.length + plane0.length);

    return result;
}

// ==================== XTC Container ====================
function buildXTCContainer(pages, isHQ) {
    var magic = isHQ ? 'XTCH' : 'XTC\0';

    // Get metadata
    var info = renderer.getDocumentInfo();
    var title = info.title || loadedFiles[currentFileIndex].name;
    var author = info.author || '';

    // Calculate offsets
    var headerSize = 56;
    var metadataSize = 256;
    var chapterEntrySize = 96;
    var chaptersSize = currentToc.length * chapterEntrySize;
    var indexEntrySize = 16;
    var indexSize = pages.length * indexEntrySize;

    var metadataOffset = headerSize;
    var chapterOffset = metadataOffset + metadataSize;
    var indexOffset = chapterOffset + chaptersSize;
    var pageDataOffset = indexOffset + indexSize;

    // Build page index
    var pageOffsets = [];
    var currentOffset = pageDataOffset;
    for (var i = 0; i < pages.length; i++) {
        pageOffsets.push({ offset: currentOffset, size: pages[i].length });
        currentOffset += pages[i].length;
    }

    var totalSize = currentOffset;
    var buffer = new ArrayBuffer(totalSize);
    var view = new DataView(buffer);
    var bytes = new Uint8Array(buffer);

    // Write header (56 bytes)
    for (var i = 0; i < 4; i++) {
        bytes[i] = magic.charCodeAt(i);
    }
    view.setUint16(4, 1, true); // Version
    view.setUint16(6, pages.length, true); // Page count
    // Individual flag bytes per XTC spec
    bytes[8] = 0;   // readDirection (0 = L→R)
    bytes[9] = 1;   // hasMetadata
    bytes[10] = 0;  // hasThumbnails
    bytes[11] = currentToc.length > 0 ? 1 : 0;  // hasChapters
    view.setUint32(12, 1, true); // Current page (1-indexed)

    // Use BigInt for 64-bit values
    view.setBigUint64(16, BigInt(metadataOffset), true);
    view.setBigUint64(24, BigInt(indexOffset), true);
    view.setBigUint64(32, BigInt(pageDataOffset), true);
    view.setBigUint64(40, BigInt(0), true); // Reserved
    view.setBigUint64(48, BigInt(chapterOffset), true);

    // Write metadata (256 bytes)
    var encoder = new TextEncoder();
    var titleBytes = encoder.encode(title.substring(0, 126));
    var authorBytes = encoder.encode(author.substring(0, 62));

    bytes.set(titleBytes, metadataOffset);
    bytes[metadataOffset + 127] = 0; // Null terminator
    bytes.set(authorBytes, metadataOffset + 128);
    bytes[metadataOffset + 191] = 0; // Null terminator
    view.setUint32(metadataOffset + 192, Math.floor(Date.now() / 1000), true); // Timestamp
    view.setUint16(metadataOffset + 196, currentToc.length, true); // Chapter count

    // Write chapters
    var chapterPos = chapterOffset;
    for (var i = 0; i < currentToc.length; i++) {
        var ch = currentToc[i];
        if (!ch) continue;
        var chTitle = ch.title || ch.name || 'Chapter ' + (i + 1);
        var chPage = ch.page || ch.startPage || 0;
        var chNameBytes = encoder.encode(chTitle.substring(0, 78));
        bytes.set(chNameBytes, chapterPos);
        bytes[chapterPos + 79] = 0;
        view.setUint16(chapterPos + 80, chPage + 1, true); // Start page (1-indexed)
        view.setUint16(chapterPos + 82, chPage + 1, true); // End page (placeholder)
        chapterPos += chapterEntrySize;
    }

    // Write index
    var indexPos = indexOffset;
    for (var i = 0; i < pages.length; i++) {
        view.setBigUint64(indexPos, BigInt(pageOffsets[i].offset), true);
        view.setUint32(indexPos + 8, pageOffsets[i].size, true);
        view.setUint16(indexPos + 12, SCREEN_WIDTH, true);
        view.setUint16(indexPos + 14, SCREEN_HEIGHT, true);
        indexPos += indexEntrySize;
    }

    // Write page data
    var dataPos = pageDataOffset;
    for (var i = 0; i < pages.length; i++) {
        bytes.set(pages[i], dataPos);
        dataPos += pages[i].length;
    }

    return bytes;
}

// ==================== EPUB Optimizer ====================
async function optimizeEpubs() {
    if (loadedFiles.length === 0) {
        alert('Please load EPUB files first');
        return;
    }

    var zip = new JSZip();
    progressContainer.style.display = 'block';

    for (var i = 0; i < loadedFiles.length; i++) {
        var file = loadedFiles[i].file;
        progressText.textContent = 'Optimizing ' + (i + 1) + ' / ' + loadedFiles.length + ': ' + file.name;
        progressFill.style.width = ((i / loadedFiles.length) * 100) + '%';

        try {
            var optimized = await optimizeEpub(file);
            zip.file(file.name.replace('.epub', '_optimized.epub'), optimized);
        } catch (err) {
            console.error('Failed to optimize:', file.name, err);
        }
    }

    progressText.textContent = 'Creating ZIP file...';
    progressFill.style.width = '100%';

    if (loadedFiles.length === 1) {
        // Single file - download directly
        var optimized = await optimizeEpub(loadedFiles[0].file);
        downloadFile(optimized, loadedFiles[0].name.replace('.epub', '_optimized.epub'));
    } else {
        // Multiple files - download as ZIP
        var zipBlob = await zip.generateAsync({ type: 'blob' });
        downloadFile(zipBlob, 'optimized_epubs.zip');
    }

    progressText.textContent = 'Optimization complete!';
    setTimeout(function() {
        progressContainer.style.display = 'none';
    }, 2000);
}

async function optimizeEpub(file) {
    var data = await file.arrayBuffer();
    var epubZip = await JSZip.loadAsync(data);

    var settings = {
        removeCss: document.getElementById('optRemoveCss').checked,
        stripFonts: document.getElementById('optStripFonts').checked,
        grayscale: document.getElementById('optGrayscale').checked,
        maxWidth: parseInt(document.getElementById('maxImageWidth').value),
        injectCss: document.getElementById('optInjectCss').checked
    };

    // Process each file in the EPUB
    var files = Object.keys(epubZip.files);

    for (var i = 0; i < files.length; i++) {
        var path = files[i];
        var zipFile = epubZip.files[path];
        if (zipFile.dir) continue;

        // Remove fonts if enabled
        if (settings.stripFonts && /\.(ttf|otf|woff|woff2)$/i.test(path)) {
            epubZip.remove(path);
            continue;
        }

        // Process CSS
        if (settings.removeCss && /\.css$/i.test(path)) {
            var css = await zipFile.async('string');
            var cleanedCss = cleanCss(css);
            epubZip.file(path, cleanedCss);
        }

        // Process HTML/XHTML
        if (/\.(html|xhtml|htm)$/i.test(path)) {
            var html = await zipFile.async('string');

            if (settings.removeCss) {
                html = cleanHtmlStyles(html);
            }

            if (settings.injectCss) {
                html = injectEpaperCss(html);
            }

            epubZip.file(path, html);
        }

        // Process images
        if (settings.grayscale && /\.(jpg|jpeg|png|gif)$/i.test(path)) {
            var imgData = await zipFile.async('arraybuffer');
            var processedImg = await processImage(imgData, settings.maxWidth, settings.grayscale);
            if (processedImg) {
                epubZip.file(path, processedImg);
            }
        }
    }

    return await epubZip.generateAsync({ type: 'blob' });
}

function cleanCss(css) {
    // Remove problematic CSS properties
    var problematic = [
        /float\s*:\s*[^;]+;?/gi,
        /position\s*:\s*(fixed|absolute)[^;]*;?/gi,
        /display\s*:\s*(flex|grid)[^;]*;?/gi,
        /@media[^{]+\{[^}]*\}/gi,
        /transform[^;]*;?/gi,
        /animation[^;]*;?/gi
    ];

    for (var i = 0; i < problematic.length; i++) {
        css = css.replace(problematic[i], '');
    }

    return css;
}

function cleanHtmlStyles(html) {
    // Remove inline styles with problematic properties
    return html.replace(/style="[^"]*"/gi, function(match) {
        var style = match;
        style = style.replace(/float\s*:\s*[^;"]+;?/gi, '');
        style = style.replace(/position\s*:\s*(fixed|absolute)[^;"]*;?/gi, '');
        return style;
    });
}

function injectEpaperCss(html) {
    var epaperCss = '<style type="text/css">' +
        '/* E-paper optimized styles */' +
        'body { font-family: serif; line-height: 1.4; text-align: justify; margin: 0; padding: 0; }' +
        'p { margin: 0.5em 0; text-indent: 1.5em; }' +
        'h1, h2, h3, h4, h5, h6 { text-indent: 0; margin: 1em 0 0.5em 0; }' +
        'img { max-width: 100%; height: auto; }' +
        '</style>';

    // Inject before </head>
    if (html.indexOf('</head>') !== -1) {
        return html.replace('</head>', epaperCss + '</head>');
    }
    return html;
}

async function processImage(imgData, maxWidth, toGrayscale) {
    return new Promise(function(resolve) {
        var blob = new Blob([imgData]);
        var img = new Image();
        img.onload = function() {
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');

            // Calculate new dimensions
            var width = img.width;
            var height = img.height;

            if (width > maxWidth) {
                height = Math.round(height * (maxWidth / width));
                width = maxWidth;
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to grayscale if enabled
            if (toGrayscale) {
                var imageData = ctx.getImageData(0, 0, width, height);
                var data = imageData.data;

                for (var i = 0; i < data.length; i += 4) {
                    var gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                    data[i] = data[i + 1] = data[i + 2] = gray;
                }

                ctx.putImageData(imageData, 0, 0);
            }

            canvas.toBlob(function(blob) {
                blob.arrayBuffer().then(resolve);
            }, 'image/jpeg', 0.85);
        };

        img.onerror = function() { resolve(null); };
        img.src = URL.createObjectURL(blob);
    });
}

// ==================== Utility Functions ====================
function downloadFile(data, filename) {
    var blob = data instanceof Blob ? data : new Blob([data]);
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== Event Listeners ====================
function setupEventListeners() {
    exportBtn.addEventListener('click', exportXTC);
    exportPageBtn.addEventListener('click', exportCurrentPage);
    exportAllBtn.addEventListener('click', exportAllFiles);
    optimizeBtn.addEventListener('click', optimizeEpubs);

    // Font family change - load Google Fonts on demand
    fontFamily.addEventListener('change', async function() {
        var selectedFont = fontFamily.value;

        if (selectedFont === 'custom') {
            document.getElementById('customFontInput').click();
            return;
        }

        // Load Google Font if not already loaded
        if (GOOGLE_FONTS[selectedFont] && !loadedFonts.has(selectedFont)) {
            progressContainer.style.display = 'block';
            progressText.textContent = 'Loading font: ' + selectedFont + '...';
            progressFill.style.width = '50%';

            var success = await loadGoogleFont(selectedFont);

            if (success) {
                progressText.textContent = 'Font loaded: ' + selectedFont;
                applySettings();
                renderCurrentPage();
            } else {
                progressText.textContent = 'Failed to load font: ' + selectedFont;
            }

            setTimeout(function() {
                progressContainer.style.display = 'none';
            }, 1500);
        } else {
            applySettings();
            renderCurrentPage();
        }
    });

    document.getElementById('customFontInput').addEventListener('change', async function(e) {
        var file = e.target.files[0];
        if (!file) return;

        var data = new Uint8Array(await file.arrayBuffer());
        var ptr = Module.allocateMemory(data.length);
        Module.HEAPU8.set(data, ptr);
        renderer.registerFontFromMemory(ptr, data.length, file.name);
        Module.freeMemory(ptr);

        // Add to font family dropdown
        var option = document.createElement('option');
        option.value = file.name.replace(/\.(ttf|otf)$/i, '');
        option.textContent = file.name;
        fontFamily.insertBefore(option, fontFamily.lastElementChild);
        fontFamily.value = option.value;

        applySettings();
        renderCurrentPage();
    });
}

// ==================== Initialize App ====================
document.addEventListener('DOMContentLoaded', function() {
    setupDropZone();
    setupNavigation();
    setupSettings();
    setupEventListeners();
    init();
});
