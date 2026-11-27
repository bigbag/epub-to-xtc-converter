/**
 * Browser adapter: pdf.js (pinned CDN, legacy ESM build) + DOM canvas.
 * Exposes window.PdfWeb. Requires pdf-core.js loaded first.
 * Safari 14 lacks module workers; pdf.js falls back to its main-thread
 * fake worker automatically (slower, functional).
 */
(function (global) {
    'use strict';

    var PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438';
    var libPromise = null;

    function loadPdfjs() {
        if (!libPromise) {
            libPromise = import(PDFJS_BASE + '/legacy/build/pdf.min.mjs').then(function (lib) {
                lib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + '/legacy/build/pdf.worker.min.mjs';
                return lib;
            });
        }
        return libPromise;
    }

    function createCanvas(w, h) {
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        return { canvas: canvas, context: canvas.getContext('2d') };
    }

    async function createSource(data, opts) {
        var lib = await loadPdfjs();
        var task = lib.getDocument({
            data: data,
            standardFontDataUrl: PDFJS_BASE + '/standard_fonts/',
            cMapUrl: PDFJS_BASE + '/cmaps/',
            cMapPacked: true,
            wasmUrl: PDFJS_BASE + '/wasm/'
        });
        var doc;
        try {
            doc = await task.promise;
        } catch (err) {
            await task.destroy().catch(function () {});
            throw global.PdfCore.mapPdfError(err);
        }
        try {
            return await global.PdfCore.createSource({
                doc: doc, loadingTask: task, createCanvas: createCanvas,
                width: opts.width, height: opts.height,
                trimMargins: opts.trimMargins, zoom: opts.zoom
            });
        } catch (err) {
            await task.destroy().catch(function () {});
            throw global.PdfCore.mapPdfError(err);
        }
    }

    global.PdfWeb = { loadPdfjs: loadPdfjs, createSource: createSource };
})(window);
