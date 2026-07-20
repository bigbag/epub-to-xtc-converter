const { DOMParser } = require('@xmldom/xmldom');

const X_LOCATION_MANIFEST_PATH = 'META-INF/x-locations.json';
const X_LOCATION_WORDS_PER_UNIT = 64;
const DEFAULT_REFERENCE_CHARACTERS_PER_PAGE = 1500;
const MIN_REFERENCE_CHARACTERS_PER_PAGE = 1;
const MAX_REFERENCE_CHARACTERS_PER_PAGE = 10000;

const SCRUBBED_BLANK_CODEPOINT_RANGES = [
    [0x0000, 0x0008],
    [0x000b, 0x000c],
    [0x000e, 0x001f],
    [0x007f, 0x009f],
    [0x00ad, 0x00ad],
    [0x034f, 0x034f],
    [0x061c, 0x061c],
    [0x180b, 0x180f],
    [0x200b, 0x200f],
    [0x202a, 0x202e],
    [0x2060, 0x2064],
    [0x2066, 0x206f],
    [0xfe00, 0xfe0f],
    [0xfeff, 0xfeff]
];

const SCRUBBED_BLANK_CODEPOINT_RE =
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFE00-\uFE0F\uFEFF]/g;
const NUMERIC_CHARACTER_REFERENCE_RE = /&#(?:x([0-9A-Fa-f]+)|([0-9]+));/g;

function localName(node) {
    return (node && (node.localName || node.nodeName || '')).replace(/^.*:/, '').toLowerCase();
}

function getElementsByLocalName(root, name) {
    const target = name.toLowerCase();
    const result = [];
    const nodes = root.getElementsByTagName('*');
    for (let index = 0; index < nodes.length; index++) {
        if (localName(nodes[index]) === target) result.push(nodes[index]);
    }
    return result;
}

function parseXml(content) {
    const errors = [];
    const parser = new DOMParser({
        errorHandler: {
            warning: () => {},
            error: message => errors.push(message),
            fatalError: message => errors.push(message)
        }
    });
    const document = parser.parseFromString(content, 'application/xml');
    return { document, errors };
}

function normalizeZipPath(value) {
    const output = [];
    for (const part of String(value).replace(/\\/g, '/').split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') output.pop();
        else output.push(part);
    }
    return output.join('/');
}

function dirname(value) {
    const index = value.lastIndexOf('/');
    return index === -1 ? '' : value.slice(0, index);
}

function resolveEpubHref(opfPath, href) {
    const withoutSuffix = String(href).split(/[?#]/, 1)[0];
    let decoded = withoutSuffix;
    try {
        decoded = decodeURIComponent(withoutSuffix);
    } catch {
        // Keep malformed percent escapes literal, matching the web optimizer.
    }

    if (decoded.startsWith('/')) return normalizeZipPath(decoded.slice(1));
    return normalizeZipPath(`${dirname(opfPath)}/${decoded}`);
}

function findZipEntry(epubZip, requestedPath, caseInsensitive = false) {
    const normalized = normalizeZipPath(requestedPath);
    if (epubZip.files[normalized]) return { path: normalized, file: epubZip.files[normalized] };
    if (!caseInsensitive) return null;
    const lower = normalized.toLowerCase();
    const actual = Object.keys(epubZip.files).find(candidate => normalizeZipPath(candidate).toLowerCase() === lower);
    return actual ? { path: actual, file: epubZip.files[actual] } : null;
}

async function readTextResource(file) {
    const raw = await file.async('uint8array');
    let offset = 0;
    if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) offset = 3;

    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(raw.subarray(offset));
    } catch {
        // Detect the same XML/meta encoding hints used by the CrossInk uploader.
    }

    const header = new TextDecoder('ascii').decode(raw.subarray(offset, offset + 512));
    const match = header.match(/encoding=["']([^"']+)["']/i) || header.match(/charset=["']?([^"'\s;]+)/i);
    const encoding = match ? match[1].toLowerCase() : 'windows-1252';
    try {
        return new TextDecoder(encoding).decode(raw.subarray(offset));
    } catch {
        return new TextDecoder('iso-8859-1').decode(raw.subarray(offset));
    }
}

async function findOpfPath(epubZip) {
    const container = findZipEntry(epubZip, 'META-INF/container.xml', true);
    if (container) {
        try {
            const content = await readTextResource(container.file);
            const parsed = parseXml(content);
            if (parsed.errors.length === 0) {
                const rootfile = getElementsByLocalName(parsed.document, 'rootfile')[0];
                const fullPath = rootfile && rootfile.getAttribute('full-path');
                const entry = fullPath && findZipEntry(epubZip, fullPath);
                if (entry && !entry.file.dir) return entry.path;
            }
        } catch {
            // Fall through to the package-document scan.
        }
    }

    return Object.keys(epubZip.files).find(candidate => !epubZip.files[candidate].dir && candidate.toLowerCase().endsWith('.opf')) || null;
}

function parsePackageDocument(content, opfPath) {
    const parsed = parseXml(content);
    if (parsed.errors.length > 0) {
        throw new Error(`Cannot generate stable page metadata: EPUB package document is malformed: ${parsed.errors[0]}`);
    }

    const manifest = new Map();
    for (const item of getElementsByLocalName(parsed.document, 'item')) {
        const id = item.getAttribute('id');
        const href = item.getAttribute('href');
        if (id && href) {
            manifest.set(id, {
                id,
                href: resolveEpubHref(opfPath, href),
                mediaType: item.getAttribute('media-type') || '',
                properties: item.getAttribute('properties') || ''
            });
        }
    }

    const spine = [];
    for (const itemref of getElementsByLocalName(parsed.document, 'itemref')) {
        const idref = itemref.getAttribute('idref');
        if (!idref) continue;
        const item = manifest.get(idref);
        if (!item) {
            throw new Error(`Cannot generate stable page metadata: spine item "${idref}" was not found in the OPF manifest`);
        }
        // CrossInk v1.4.0 includes linear="no" entries in spine order.
        spine.push(item);
    }

    return spine;
}

function isScrubbedBlankCodepoint(codePoint) {
    return SCRUBBED_BLANK_CODEPOINT_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

function scrubBlankCodepoints(text) {
    const withoutLiterals = text.replace(SCRUBBED_BLANK_CODEPOINT_RE, '');
    return withoutLiterals.replace(NUMERIC_CHARACTER_REFERENCE_RE, (match, hexValue, decimalValue) => {
        const codePoint = Number.parseInt(hexValue || decimalValue, hexValue ? 16 : 10);
        return Number.isFinite(codePoint) && isScrubbedBlankCodepoint(codePoint) ? '' : match;
    });
}

function removeHiddenMarkup(document) {
    for (const name of ['script', 'style', 'svg', 'metadata']) {
        for (const element of getElementsByLocalName(document, name)) {
            if (element.parentNode) element.parentNode.removeChild(element);
        }
    }
}

function extractVisibleText(content) {
    const scrubbed = scrubBlankCodepoints(content);
    for (const mimeType of ['application/xhtml+xml', 'text/html']) {
        const errors = [];
        const parser = new DOMParser({
            errorHandler: {
                warning: () => {},
                error: message => errors.push(message),
                fatalError: message => errors.push(message)
            }
        });
        const document = parser.parseFromString(scrubbed, mimeType);
        if (errors.length > 0 && mimeType === 'application/xhtml+xml') continue;
        removeHiddenMarkup(document);
        const body = getElementsByLocalName(document, 'body')[0] || document.documentElement;
        if (body) return body.textContent || '';
    }

    return scrubbed
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<metadata[\s\S]*?<\/metadata>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
}

function normalizeVisibleText(text) {
    return text.replace(/\s+/g, ' ').trim();
}

function countLocationWords(text) {
    const normalized = normalizeVisibleText(text);
    if (!normalized) return 0;
    try {
        return (normalized.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
    } catch {
        return (normalized.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g) || []).length;
    }
}

function countReferenceCharacters(text) {
    return Array.from(normalizeVisibleText(text)).length;
}

function validateReferenceCharactersPerPage(value) {
    if (!Number.isFinite(value) || !Number.isInteger(value) ||
        value < MIN_REFERENCE_CHARACTERS_PER_PAGE || value > MAX_REFERENCE_CHARACTERS_PER_PAGE) {
        throw new Error('referenceCharactersPerPage must be an integer between 1 and 10000');
    }
}

async function generateStablePageManifest(epubZip, options = {}) {
    const charactersPerReferencePage = options.referenceCharactersPerPage ?? DEFAULT_REFERENCE_CHARACTERS_PER_PAGE;
    validateReferenceCharactersPerPage(charactersPerReferencePage);

    const opfPath = await findOpfPath(epubZip);
    if (!opfPath) {
        throw new Error('Cannot generate stable page metadata: EPUB package document was not found');
    }

    const opfContent = await readTextResource(epubZip.files[opfPath]);
    const spineItems = parsePackageDocument(opfContent, opfPath);
    if (spineItems.length === 0) {
        throw new Error('Cannot generate stable page metadata: EPUB spine is empty');
    }

    const spine = [];
    let totalWords = 0;
    let totalCharacters = 0;
    let nextLocation = 1;

    for (let index = 0; index < spineItems.length; index++) {
        const item = spineItems[index];
        const entry = findZipEntry(epubZip, item.href);
        if (!entry || entry.file.dir) {
            throw new Error(`Cannot generate stable page metadata: spine item "${item.id}" points to missing resource "${item.href}"`);
        }

        const content = await readTextResource(entry.file);
        const visibleText = extractVisibleText(content);
        const wordCount = countLocationWords(visibleText);
        const characterCount = countReferenceCharacters(visibleText);
        const locationCount = Math.ceil(wordCount / X_LOCATION_WORDS_PER_UNIT);
        const startLocation = locationCount > 0 ? nextLocation : 0;
        const endLocation = locationCount > 0 ? nextLocation + locationCount - 1 : 0;
        const startReferencePage = characterCount > 0
            ? Math.floor(totalCharacters / charactersPerReferencePage) + 1
            : 0;
        const endReferencePage = characterCount > 0
            ? Math.ceil((totalCharacters + characterCount) / charactersPerReferencePage)
            : 0;

        spine.push({
            index,
            href: item.href,
            wordStart: totalWords,
            wordCount,
            characterStart: totalCharacters,
            characterCount,
            startLocation,
            endLocation,
            startReferencePage,
            endReferencePage
        });

        totalWords += wordCount;
        totalCharacters += characterCount;
        nextLocation += locationCount;
    }

    // This is the exact v1.4.0 web-uploader schema. The firmware reads the
    // character fields even though its JSON filter currently omits two of them.
    return {
        format: 'x-locations',
        version: 1,
        generator: 'crossink-web-uploader',
        unit: 'word',
        referencePageUnit: 'character',
        wordsPerLocation: X_LOCATION_WORDS_PER_UNIT,
        charactersPerReferencePage,
        totalWords,
        totalCharacters,
        totalLocations: Math.max(0, nextLocation - 1),
        totalReferencePages: Math.ceil(totalCharacters / charactersPerReferencePage),
        spine
    };
}

async function writeStablePageManifest(epubZip, options = {}) {
    const manifest = await generateStablePageManifest(epubZip, options);
    epubZip.file(X_LOCATION_MANIFEST_PATH, JSON.stringify(manifest), {
        binary: false,
        createFolders: true
    });
    return {
        referenceCharactersPerPage: manifest.charactersPerReferencePage,
        wordsPerLocationUnit: manifest.wordsPerLocation,
        locationCount: manifest.totalLocations,
        referencePageCount: manifest.totalReferencePages
    };
}

module.exports = {
    X_LOCATION_MANIFEST_PATH,
    X_LOCATION_WORDS_PER_UNIT,
    DEFAULT_REFERENCE_CHARACTERS_PER_PAGE,
    MIN_REFERENCE_CHARACTERS_PER_PAGE,
    MAX_REFERENCE_CHARACTERS_PER_PAGE,
    generateStablePageManifest,
    writeStablePageManifest
};
