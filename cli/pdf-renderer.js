/**
 * Node adapter: pdf.js + @napi-rs/canvas -> PDF document source.
 * Verified against pdfjs-dist 6.5.438: no custom CanvasFactory needed;
 * package asset URLs (standard_fonts, cmaps, wasm) are set explicitly in openPdf.
 */
const fs = require('fs');
const path = require('path');
const { createCanvas: napiCreateCanvas } = require('@napi-rs/canvas');
const PdfCore = require('../web/pdf-core.js');
const { applyDithering, applyNegative } = require('./dither');
const { encodeXTG, encodeXTH, buildXTCContainer } = require('./encoder');

// Node does not auto-resolve these package assets; pass explicit filesystem
// paths (getFactoryUrlProp requires a trailing separator; file:// URLs fail).
const PDFJS_PKG_ROOT = path.dirname(require.resolve('pdfjs-dist/package.json'));

let pdfjsPromise = null;
function loadPdfjs() {
    if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjsPromise;
}

async function openPdf(data) {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({
        data,
        useWorkerFetch: false,
        isEvalSupported: false,
        standardFontDataUrl: path.join(PDFJS_PKG_ROOT, 'standard_fonts') + path.sep,
        cMapUrl: path.join(PDFJS_PKG_ROOT, 'cmaps') + path.sep,
        wasmUrl: path.join(PDFJS_PKG_ROOT, 'wasm') + path.sep,
    });
    try {
        const doc = await task.promise;
        return { doc, task };
    } catch (err) {
        await task.destroy().catch(() => {});
        throw PdfCore.mapPdfError(err);
    }
}

function createCanvas(w, h) {
    const canvas = napiCreateCanvas(w, h);
    return { canvas, context: canvas.getContext('2d') };
}

async function renderPageToCanvas(doc, pageNumber, scale) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const { canvas, context } = createCanvas(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)));
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    return { canvas, context, viewport };
}

async function createNodePdfSource(data, opts) {
    const { doc, task } = await openPdf(data);
    try {
        return await PdfCore.createSource({
            doc, loadingTask: task, createCanvas,
            width: opts.width, height: opts.height,
            trimMargins: opts.trimMargins, zoom: opts.zoom
        });
    } catch (err) {
        await task.destroy().catch(() => {});
        throw PdfCore.mapPdfError(err);
    }
}

/**
 * Convert a single PDF to XTC/XTCH (mirrors convertEpub's pipeline).
 */
async function convertPdf(inputPath, outputPath, settings, progressCallback) {
    const { width, height, output, pdf } = settings;
    const isHQ = output.format === 'xtch';
    const bits = isHQ ? 2 : 1;

    const data = new Uint8Array(fs.readFileSync(inputPath));
    const source = await createNodePdfSource(data, {
        width, height, trimMargins: pdf.trimMargins, zoom: pdf.zoom
    });

    try {
        const pages = [];
        for (let i = 0; i < source.pageCount; i++) {
            let imageData = await source.renderPage(i);
            if (output.dithering) {
                imageData = applyDithering(imageData, width, height, bits, output.ditherStrength);
            }
            if (output.negative) applyNegative(imageData);
            pages.push(isHQ ? encodeXTH(imageData, width, height) : encodeXTG(imageData, width, height));
            if (progressCallback) progressCallback(i + 1, source.pageCount);
        }

        const metadata = {
            title: source.info.title || path.basename(inputPath, path.extname(inputPath)),
            author: source.info.author || ''
        };
        const container = buildXTCContainer(pages, metadata, source.toc, width, height, isHQ);
        fs.writeFileSync(outputPath, container);
        return { outputPath, pageCount: source.pageCount, format: output.format };
    } finally {
        await source.destroy();
    }
}

module.exports = { loadPdfjs, openPdf, createCanvas, renderPageToCanvas, createNodePdfSource, convertPdf };
