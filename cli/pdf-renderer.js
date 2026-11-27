/**
 * Node adapter: pdf.js + @napi-rs/canvas -> PDF document source.
 * Verified against pdfjs-dist 6.5.438: Node factories and package assets
 * (standard_fonts, cmaps, wasm) auto-resolve; no custom CanvasFactory needed.
 */
const fs = require('fs');
const path = require('path');
const { createCanvas: napiCreateCanvas } = require('@napi-rs/canvas');
const PdfCore = require('../web/pdf-core.js');

let pdfjsPromise = null;
function loadPdfjs() {
    if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjsPromise;
}

async function openPdf(data) {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false });
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

module.exports = { loadPdfjs, openPdf, createCanvas, renderPageToCanvas };
