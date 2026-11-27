/**
 * Core EPUB to XTC/XTCH converter
 * Uses CREngine WASM for EPUB rendering
 */

const fs = require('fs');
const path = require('path');
const { applyDithering, applyNegative } = require('./dither');
const { encodeXTG, encodeXTH, buildXTCContainer } = require('./encoder');

let Module = null;
let renderer = null;

/**
 * Destroy renderer and free WASM memory
 */
function destroyRenderer() {
    if (renderer) {
        renderer.delete();  // Emscripten destructor - frees WASM heap
        renderer = null;
    }
}

/**
 * Initialize CREngine WASM module
 */
async function initWasm() {
    if (Module) return;

    const wasmPath = path.join(__dirname, '..', 'web', 'crengine.js');

    if (!fs.existsSync(wasmPath)) {
        throw new Error(`CREngine WASM not found at: ${wasmPath}`);
    }

    // Load CREngine module
    const CREngine = require(wasmPath);
    Module = await CREngine();
}

/**
 * Create renderer with specified dimensions
 */
function createRenderer(width, height) {
    if (!Module) {
        throw new Error('WASM module not initialized. Call initWasm() first.');
    }
    destroyRenderer();  // Clean up existing renderer before creating new one
    renderer = new Module.EpubRenderer(width, height);

    return renderer;
}

/**
 * Register font from file
 */
async function registerFont(fontPath) {
    if (!renderer) {
        throw new Error('Renderer not initialized');
    }

    const fontData = fs.readFileSync(fontPath);
    const fontName = path.basename(fontPath);

    const ptr = Module.allocateMemory(fontData.length);
    Module.HEAPU8.set(new Uint8Array(fontData), ptr);
    renderer.registerFontFromMemory(ptr, fontData.length, fontName);
    Module.freeMemory(ptr);

    return fontName;
}

/**
 * Load EPUB file into renderer
 */
async function loadEpub(epubPath) {
    if (!renderer) {
        throw new Error('Renderer not initialized');
    }

    const epubData = fs.readFileSync(epubPath);

    const ptr = Module.allocateMemory(epubData.length);
    Module.HEAPU8.set(new Uint8Array(epubData), ptr);

    try {
        renderer.loadEpubFromMemory(ptr, epubData.length);

        // Disable built-in status bar (must be after loading document)
        renderer.configureStatusBar(false, false, false, false, false, false, false, false, false);
    } finally {
        Module.freeMemory(ptr);
    }

    return {
        pageCount: renderer.getPageCount(),
        info: renderer.getDocumentInfo() || {},
        toc: renderer.getToc() || []
    };
}

/**
 * Apply rendering settings
 */
function applySettings(settings) {
    if (!renderer) {
        throw new Error('Renderer not initialized');
    }

    const { margins, font, lineHeight, textAlignValue, hyphenation } = settings;

    renderer.setMargins(
        margins.left,
        margins.top,
        margins.right,
        margins.bottom
    );
    renderer.setFontSize(font.size);
    renderer.setFontWeight(font.weight);
    renderer.setInterlineSpace(lineHeight);
    renderer.setTextAlign(textAlignValue);

    if (hyphenation.enabled) {
        renderer.setHyphenation(2); // Dictionary-based
        if (renderer.setHyphenationLanguage) {
            renderer.setHyphenationLanguage(hyphenation.language);
        }
    } else {
        renderer.setHyphenation(0); // Disabled
    }
}

/**
 * Render a single page
 */
function renderPage(pageNum) {
    if (!renderer) {
        throw new Error('Renderer not initialized');
    }

    renderer.goToPage(pageNum);
    renderer.renderCurrentPage();

    const frameBuffer = renderer.getFrameBuffer();
    if (!frameBuffer || frameBuffer.length === 0) {
        throw new Error(`Empty frame buffer for page ${pageNum}`);
    }

    // Copy buffer (frame buffer may be reused by WASM)
    return new Uint8ClampedArray(frameBuffer);
}

/**
 * Convert single EPUB to XTC/XTCH
 */
async function convertEpub(epubPath, outputPath, settings, progressCallback) {
    const { width, height, output } = settings;
    const isHQ = output.format === 'xtch';
    const bits = isHQ ? 2 : 1;

    // Initialize and setup
    await initWasm();
    createRenderer(width, height);

    // Register font
    await registerFont(settings.font.path);

    // Load EPUB
    const { pageCount, info, toc } = await loadEpub(epubPath);

    if (pageCount === 0) {
        throw new Error('EPUB has no pages');
    }

    // Apply settings after loading (affects pagination)
    applySettings(settings);

    // Re-get page count after settings (pagination may change)
    const totalPages = renderer.getPageCount();

    // Render all pages
    const pages = [];
    for (let i = 0; i < totalPages; i++) {
        // Render page
        let imageData = renderPage(i);

        // Apply dithering if enabled
        if (output.dithering) {
            imageData = applyDithering(imageData, width, height, bits, output.ditherStrength);
        }

        // Apply negative if enabled
        if (output.negative) {
            applyNegative(imageData);
        }

        // Encode page
        const encoded = isHQ
            ? encodeXTH(imageData, width, height)
            : encodeXTG(imageData, width, height);
        pages.push(encoded);

        // Progress callback
        if (progressCallback) {
            progressCallback(i + 1, totalPages);
        }
    }

    // Build container
    const metadata = {
        title: info.title || path.basename(epubPath, '.epub'),
        author: info.author || info.authors || ''
    };

    const container = buildXTCContainer(pages, metadata, toc, width, height, isHQ);

    // Write output
    fs.writeFileSync(outputPath, container);

    return {
        outputPath,
        pageCount: totalPages,
        format: output.format
    };
}

/**
 * Get output path for an input file
 */
function getOutputPath(inputPath, outputDir, format) {
    const basename = path.basename(inputPath, path.extname(inputPath));
    const extension = format === 'xtch' ? '.xtch' : '.xtc';
    return path.join(outputDir, basename + extension);
}

/**
 * Cleanup renderer resources
 */
function cleanup() {
    destroyRenderer();
}

module.exports = {
    initWasm,
    createRenderer,
    registerFont,
    loadEpub,
    applySettings,
    renderPage,
    convertEpub,
    getOutputPath,
    cleanup
};
