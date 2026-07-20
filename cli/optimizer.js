/**
 * EPUB Optimizer for CLI
 * Optimizes EPUBs for Xteink e-paper devices (ESP32-C3, 800x480 1-bit/4-level grayscale)
 *
 * Device constraints (from papyrix-reader firmware):
 * - Viewport: 464x788px usable
 * - Max image decode: 2048x3072px
 * - JPEG: baseline only (no progressive/arithmetic)
 * - No GIF/SVG/WebP support
 * - CSS: max 1500 rules, simple selectors only (tag, .class, tag.class)
 * - No color, no transparency
 * - Max word length: 200 chars
 * - Images <20px skipped as decorative
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const sharp = require('sharp');
const {
    X_LOCATION_MANIFEST_PATH,
    writeStablePageManifest
} = require('./stable-pages');

const MAX_IMAGE_DECODE_WIDTH = 2048;
const MAX_IMAGE_DECODE_HEIGHT = 3072;
const MIN_IMAGE_SIZE = 20;

/**
 * Remove problematic CSS properties for e-paper rendering
 */
function cleanCss(css) {
    const problematic = [
        /float\s*:\s*[^;]+;?/gi,
        /position\s*:\s*(fixed|absolute|relative|sticky)[^;]*;?/gi,
        /display\s*:\s*(flex|grid|inline-flex|inline-grid)[^;]*;?/gi,
        /transform[^;]*;?/gi,
        /animation[^;]*;?/gi,
        /transition[^;]*;?/gi,
        /opacity\s*:\s*[^;]+;?/gi,
        /box-shadow[^;]*;?/gi,
        /text-shadow[^;]*;?/gi,
        /border-radius[^;]*;?/gi,
        /background[^;]*;?/gi,
        /color\s*:\s*[^;]+;?/gi,
        /overflow[^;]*;?/gi,
        /z-index[^;]*;?/gi,
        /visibility[^;]*;?/gi,
    ];

    for (const pattern of problematic) {
        css = css.replace(pattern, '');
    }

    // Strip @media blocks with balanced brace matching
    css = stripAtBlocks(css, '@media');
    css = stripAtBlocks(css, '@font-face');
    css = stripAtBlocks(css, '@keyframes');
    css = stripAtBlocks(css, '@import');
    css = stripAtBlocks(css, '@supports');

    return css;
}

/**
 * Remove @-rule blocks using balanced brace matching
 */
function stripAtBlocks(css, atRule) {
    let result = '';
    let i = 0;
    while (i < css.length) {
        const idx = css.indexOf(atRule, i);
        if (idx === -1) {
            result += css.slice(i);
            break;
        }
        result += css.slice(i, idx);

        // @import has no braces — just a semicolon
        if (atRule === '@import') {
            const semi = css.indexOf(';', idx);
            i = semi === -1 ? css.length : semi + 1;
            continue;
        }

        const braceStart = css.indexOf('{', idx);
        if (braceStart === -1) {
            result += css.slice(idx);
            break;
        }
        let depth = 1;
        let j = braceStart + 1;
        while (j < css.length && depth > 0) {
            if (css[j] === '{') depth++;
            else if (css[j] === '}') depth--;
            j++;
        }
        i = j;
    }
    return result;
}

/**
 * Remove inline styles with problematic properties from HTML
 */
function cleanHtmlStyles(html) {
    return html.replace(/style="[^"]*"/gi, function (match) {
        let style = match;
        style = style.replace(/float\s*:\s*[^;"]+;?/gi, '');
        style = style.replace(/position\s*:\s*(fixed|absolute|relative|sticky)[^;"]*;?/gi, '');
        style = style.replace(/background[^;"]*;?/gi, '');
        style = style.replace(/color\s*:\s*[^;"]+;?/gi, '');
        return style;
    });
}

/**
 * Strip base64 data URIs from any src attribute — matches firmware DataUriStripper
 * which replaces all src="data:..." with src="#" to prevent expat OOM
 */
function stripDataUris(html) {
    return html.replace(/(src\s*=\s*")data:[^"]+(")/gi, '$1#$2')
               .replace(/(src\s*=\s*')data:[^']+(')/gi, '$1#$2');
}

/**
 * Insert soft hyphens into words longer than maxLen characters
 */
function breakLongWords(html, maxLen) {
    if (!maxLen) maxLen = 200;
    // Only break inside text nodes (between > and <)
    return html.replace(/>([^<]+)</g, function (match, text) {
        const re = new RegExp('\\S{' + maxLen + ',}', 'g');
        const broken = text.replace(re, function (word) {
            let result = '';
            for (let i = 0; i < word.length; i += maxLen) {
                if (i > 0) result += '\u00AD'; // soft hyphen
                result += word.slice(i, i + maxLen);
            }
            return result;
        });
        return '>' + broken + '<';
    });
}

/**
 * Inject e-paper optimized CSS into HTML documents
 */
function injectEpaperCss(html) {
    const epaperCss = '<style type="text/css">' +
        'body { font-family: serif; line-height: 1.4; text-align: justify; margin: 0; padding: 0; }' +
        'p { margin: 0.5em 0; text-indent: 1.5em; }' +
        'h1, h2, h3, h4, h5, h6 { text-indent: 0; margin: 1em 0 0.5em 0; }' +
        'img { max-width: 100%; height: auto; }' +
        '</style>';

    if (html.indexOf('</head>') !== -1) {
        return html.replace('</head>', epaperCss + '</head>');
    }
    return html;
}

/**
 * Process image: ensure baseline JPEG, resize, grayscale, flatten alpha
 */
async function processImage(imgBuffer, maxWidth, toGrayscale) {
    try {
        let pipeline = sharp(imgBuffer);
        const metadata = await pipeline.metadata();

        // Skip tiny decorative images
        if (metadata.width < MIN_IMAGE_SIZE || metadata.height < MIN_IMAGE_SIZE) {
            return null;
        }

        // Flatten alpha to white — e-paper has no transparency
        if (metadata.channels === 4 || metadata.hasAlpha) {
            pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
        }

        // Enforce device decode limits
        const effectiveMaxWidth = Math.min(maxWidth || MAX_IMAGE_DECODE_WIDTH, MAX_IMAGE_DECODE_WIDTH);
        if (metadata.width > effectiveMaxWidth || metadata.height > MAX_IMAGE_DECODE_HEIGHT) {
            pipeline = pipeline.resize({
                width: effectiveMaxWidth,
                height: MAX_IMAGE_DECODE_HEIGHT,
                fit: 'inside',
                withoutEnlargement: true
            });
        }

        if (toGrayscale) {
            pipeline = pipeline.grayscale();
        }

        // Always output baseline JPEG — device doesn't support progressive
        return await pipeline.jpeg({ quality: 85, progressive: false }).toBuffer();
    } catch {
        return null;
    }
}

/**
 * Optimize an EPUB file
 * @param {string} inputPath - Path to input EPUB
 * @param {string} outputPath - Path to output EPUB
 * @param {object} options - Optimizer options
 * @returns {object} Stats about the optimization
 */
async function optimizeEpub(inputPath, outputPath, options) {
    const data = fs.readFileSync(inputPath);
    const originalSize = data.length;
    const epubZip = await JSZip.loadAsync(data);

    const ops = [];
    const imageRenames = {}; // old path -> new path for format conversions
    const strippedFonts = []; // paths of removed font files
    const files = Object.keys(epubZip.files);

    for (const filePath of files) {
        const zipFile = epubZip.files[filePath];
        if (zipFile.dir) continue;

        // Remove embedded fonts
        if (options.stripFonts && /\.(ttf|otf|woff|woff2)$/i.test(filePath)) {
            epubZip.remove(filePath);
            strippedFonts.push(filePath);
            ops.push({ type: 'stripFont', file: filePath });
            continue;
        }

        // Remove unsupported image formats (GIF, SVG, WebP, TIFF)
        if (options.removeUnsupportedImages && /\.(gif|svg|webp|tiff?)$/i.test(filePath)) {
            // Try to convert to JPEG via sharp, remove if conversion fails
            try {
                const imgData = await zipFile.async('nodebuffer');
                const processed = await processImage(imgData, options.maxImageWidth, options.grayscale);
                if (processed) {
                    const jpegPath = filePath.replace(/\.[^.]+$/, '.jpg');
                    epubZip.remove(filePath);
                    epubZip.file(jpegPath, processed);
                    imageRenames[filePath] = jpegPath;
                    ops.push({ type: 'convertFormat', file: filePath, to: jpegPath });
                } else {
                    epubZip.remove(filePath);
                    ops.push({ type: 'removeUnsupported', file: filePath });
                }
            } catch {
                epubZip.remove(filePath);
                ops.push({ type: 'removeUnsupported', file: filePath });
            }
            continue;
        }

        // Process CSS
        if (options.removeCss && /\.css$/i.test(filePath)) {
            const css = await zipFile.async('string');
            const cleaned = cleanCss(css);
            epubZip.file(filePath, cleaned);
            ops.push({ type: 'cleanCss', file: filePath });
        }

        // Process HTML/XHTML
        if (/\.(html|xhtml|htm)$/i.test(filePath)) {
            let html = await zipFile.async('string');

            if (options.removeCss) {
                html = cleanHtmlStyles(html);
                ops.push({ type: 'cleanHtmlStyles', file: filePath });
            }

            // Strip data URIs to prevent OOM on device
            html = stripDataUris(html);

            // Break words >200 chars to prevent layout issues
            html = breakLongWords(html, 200);

            if (options.injectCss) {
                html = injectEpaperCss(html);
                ops.push({ type: 'injectCss', file: filePath });
            }

            epubZip.file(filePath, html);
        }

        // Process supported images (JPEG, PNG, BMP)
        if (options.processImages && /\.(jpg|jpeg|png|bmp)$/i.test(filePath)) {
            const imgData = await zipFile.async('nodebuffer');
            const processed = await processImage(imgData, options.maxImageWidth, options.grayscale);
            if (processed) {
                // Output is always JPEG — rename non-JPEG files to avoid content-type mismatch
                if (/\.(png|bmp)$/i.test(filePath)) {
                    const jpegPath = filePath.replace(/\.[^.]+$/, '.jpg');
                    epubZip.remove(filePath);
                    epubZip.file(jpegPath, processed);
                    imageRenames[filePath] = jpegPath;
                    ops.push({ type: 'convertImage', file: filePath, to: jpegPath });
                } else {
                    // Always replace JPEGs — device requires baseline encoding
                    // (progressive and arithmetic JPEGs are re-encoded to baseline by Sharp)
                    epubZip.file(filePath, processed);
                    ops.push({ type: 'processImage', file: filePath });
                }
            }
        }
    }

    // Update HTML/XHTML references for all renamed images (post-loop so all renames are collected)
    if (Object.keys(imageRenames).length > 0) {
        for (const htmlPath of Object.keys(epubZip.files)) {
            if (!/\.(html|xhtml|htm)$/i.test(htmlPath)) continue;
            let html = await epubZip.files[htmlPath].async('string');
            let changed = false;
            for (const [oldImg, newImg] of Object.entries(imageRenames)) {
                // Use relative path from HTML location (matches EPUB reference format)
                const htmlDir = path.dirname(htmlPath);
                const oldRef = htmlDir ? path.relative(htmlDir, oldImg).split(path.sep).join('/') : oldImg;
                const newRef = htmlDir ? path.relative(htmlDir, newImg).split(path.sep).join('/') : newImg;
                if (html.indexOf(oldRef) !== -1) {
                    html = html.split(oldRef).join(newRef);
                    changed = true;
                    ops.push({ type: 'updateImageRef', file: htmlPath, from: oldRef, to: newRef });
                }
            }
            if (changed) {
                epubZip.file(htmlPath, html);
            }
        }
    }

    // Update OPF manifest: remove stripped font entries, update renamed image references
    const hasOpfWork = strippedFonts.length > 0 || Object.keys(imageRenames).length > 0;
    if (hasOpfWork) {
        for (const opfPath of Object.keys(epubZip.files)) {
            if (!/\.opf$/i.test(opfPath)) continue;
            let opf = await epubZip.files[opfPath].async('string');

            // Remove <item> entries for stripped fonts
            for (const fontPath of strippedFonts) {
                const fontHref = path.relative(path.dirname(opfPath), fontPath) || path.basename(fontPath);
                const escaped = fontHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                opf = opf.replace(new RegExp('\\s*<item[^>]*href="' + escaped + '"[^>]*/>', 'g'), '');
            }

            // Update renamed image references
            for (const [oldImg, newImg] of Object.entries(imageRenames)) {
                const oldHref = path.relative(path.dirname(opfPath), oldImg) || path.basename(oldImg);
                const newHref = path.relative(path.dirname(opfPath), newImg) || path.basename(newImg);
                opf = opf.split(oldHref).join(newHref);
                // Update id attribute (typically the basename without path)
                const oldBasename = path.basename(oldImg);
                const newBasename = path.basename(newImg);
                if (oldBasename !== newBasename) {
                    const oldIdEsc = oldBasename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const hrefEscForId = newHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    // Handle either attribute order (id before or after href)
                    opf = opf.replace(
                        new RegExp('(<item\\b[^>]*\\bhref="' + hrefEscForId + '"[^>]*?)\\bid="' + oldIdEsc + '"'),
                        '$1id="' + newBasename + '"'
                    );
                    opf = opf.replace(
                        new RegExp('(<item\\b[^>]*?)\\bid="' + oldIdEsc + '"([^>]*\\bhref="' + hrefEscForId + '")'),
                        '$1id="' + newBasename + '"$2'
                    );
                }
                // Update media-type for converted images (handle either attribute order)
                const hrefEsc = newHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                opf = opf.replace(
                    new RegExp('(<item\\b[^>]*\\bhref="' + hrefEsc + '"[^>]*?)\\bmedia-type="[^"]*"'),
                    '$1media-type="image/jpeg"'
                );
                opf = opf.replace(
                    new RegExp('(<item\\b[^>]*?)\\bmedia-type="[^"]*"([^>]*\\bhref="' + hrefEsc + '")'),
                    '$1media-type="image/jpeg"$2'
                );
            }

            epubZip.file(opfPath, opf);
            ops.push({ type: 'updateOpf', file: opfPath });
        }
    }

    let stablePageStats = null;
    if (options.stablePageNumbers?.enabled) {
        try {
            stablePageStats = await writeStablePageManifest(epubZip, {
                referenceCharactersPerPage: options.stablePageNumbers.referenceCharactersPerPage
            });
        } catch (error) {
            throw new Error(`Failed to generate stable page metadata for ${path.basename(inputPath)}:\n${error.message}`);
        }

        ops.push({
            type: 'generateStablePageNumbers',
            file: X_LOCATION_MANIFEST_PATH,
            ...stablePageStats
        });
    }

    const outputBuffer = stablePageStats
        ? await generatePackagedEpub(epubZip)
        : await epubZip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 9 }
        });

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, outputBuffer);

    return {
        inputPath,
        outputPath,
        originalSize,
        optimizedSize: outputBuffer.length,
        reduction: originalSize - outputBuffer.length,
        reductionPercent: ((1 - outputBuffer.length / originalSize) * 100).toFixed(1),
        operations: ops,
        stablePageNumbers: stablePageStats
    };
}

async function generatePackagedEpub(epubZip) {
    const outputZip = new JSZip();
    const mimetype = epubZip.files.mimetype;
    if (mimetype && !mimetype.dir) {
        outputZip.file('mimetype', await mimetype.async('nodebuffer'), {
            compression: 'STORE',
            createFolders: false
        });
    }

    for (const filePath of Object.keys(epubZip.files)) {
        if (filePath === 'mimetype') continue;
        const file = epubZip.files[filePath];
        if (file.dir) continue;
        outputZip.file(filePath, await file.async('nodebuffer'), {
            compression: 'DEFLATE',
            compressionOptions: { level: 9 },
            createFolders: false,
            date: file.date,
            comment: file.comment,
            unixPermissions: file.unixPermissions,
            dosPermissions: file.dosPermissions
        });
    }

    return outputZip.generateAsync({ type: 'nodebuffer' });
}

module.exports = {
    optimizeEpub,
    cleanCss,
    cleanHtmlStyles,
    stripDataUris,
    breakLongWords,
    injectEpaperCss,
    processImage
};
