const { DOMParser } = require('@xmldom/xmldom');
const path = require('node:path').posix;

const X_LOCATION_MANIFEST_PATH = 'META-INF/x-locations.json';
const WORDS_PER_LOCATION = 64;
const MAX_MANIFEST_BYTES = 64 * 1024;
// CrossInk v1.4.0 web/pages/files.js defines the counting rules and schema.
const BLANK_CODEPOINTS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFE00-\uFE0F\uFEFF]/g;

function elements(root, name) {
    return Array.from(root.getElementsByTagName('*')).filter(node => node.localName === name);
}

function parseXml(text, mimeType = 'application/xml') {
    const errors = [];
    const document = new DOMParser({
        errorHandler: {
            warning: message => errors.push(message),
            error: message => errors.push(message),
            fatalError: message => errors.push(message)
        }
    }).parseFromString(text, mimeType);
    if (!document?.documentElement || errors.length) {
        throw new Error(`Invalid XML: ${errors[0] || 'empty document'}`);
    }
    return document;
}

async function readText(zip, name) {
    const file = zip.file(name);
    if (!file) throw new Error(`Missing EPUB resource: ${name}`);
    const bytes = await file.async('uint8array');
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        const header = new TextDecoder('ascii').decode(bytes.subarray(0, 512));
        const encoding = header.match(/(?:encoding|charset)=["']?([^"'\s;>]+)/i)?.[1] || 'windows-1252';
        return new TextDecoder(encoding, { fatal: true }).decode(bytes);
    }
}

function decodeHref(href) {
    try {
        return decodeURIComponent(href);
    } catch {
        return href;
    }
}

async function readSpine(zip) {
    let opfPath;
    const container = zip.file('META-INF/container.xml');
    if (container) {
        const document = parseXml(await readText(zip, container.name));
        opfPath = elements(document, 'rootfile')[0]?.getAttribute('full-path');
    } else {
        opfPath = Object.keys(zip.files).find(name => !zip.files[name].dir && /\.opf$/i.test(name));
    }
    if (!opfPath) throw new Error('EPUB package document was not found');
    if (container) opfPath = path.normalize(decodeHref(opfPath));
    const document = parseXml(await readText(zip, opfPath));
    const manifest = new Map();
    for (const item of elements(document, 'item')) {
        const id = item.getAttribute('id');
        const href = item.getAttribute('href');
        if (id && href) {
            const decoded = decodeHref(href.split(/[?#]/, 1)[0]);
            const resolved = path.normalize(decoded.startsWith('/') ? decoded.slice(1) : path.join(path.dirname(opfPath), decoded));
            manifest.set(id, resolved);
        }
    }
    const spine = elements(document, 'itemref').map(item => {
        const id = item.getAttribute('idref');
        if (!manifest.has(id)) throw new Error(`Spine item is not in the EPUB manifest: ${id}`);
        return manifest.get(id);
    });
    if (!spine.length) throw new Error('EPUB spine is empty');
    return spine;
}

function visibleText(content) {
    const scrubbed = content.replace(BLANK_CODEPOINTS, '').replace(/&#(?:x([\da-f]+)|(\d+));/gi, (match, hex, decimal) => {
        const value = parseInt(hex || decimal, hex ? 16 : 10);
        return value <= 0x10ffff && String.fromCodePoint(value).replace(BLANK_CODEPOINTS, '') === '' ? '' : match;
    });
    let document;
    try {
        document = parseXml(scrubbed, 'application/xhtml+xml');
    } catch {
        document = new DOMParser({ errorHandler: () => {} }).parseFromString(scrubbed, 'text/html');
    }
    if (!document?.documentElement) throw new Error('EPUB content document is empty');
    for (const name of ['script', 'style', 'svg', 'metadata']) {
        for (const element of elements(document, name)) element.parentNode?.removeChild(element);
    }
    const body = elements(document, 'body')[0] || document.documentElement;
    return (body?.textContent || '').replace(/\s+/g, ' ').trim();
}

async function writeStablePageManifest(zip, charactersPerReferencePage = 1500) {
    if (!Number.isInteger(charactersPerReferencePage) || charactersPerReferencePage < 1 || charactersPerReferencePage > 10000) {
        throw new Error('Reference characters per page must be an integer from 1 to 10000');
    }
    const hrefs = await readSpine(zip);
    const spine = [];
    let totalWords = 0;
    let totalCharacters = 0;
    let totalLocations = 0;
    for (const [index, href] of hrefs.entries()) {
        const text = visibleText(await readText(zip, href));
        const wordCount = (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
        let characterCount = 0;
        for (const character of text) characterCount++;
        const locationCount = Math.ceil(wordCount / WORDS_PER_LOCATION);
        spine.push({
            index,
            href,
            wordStart: totalWords,
            wordCount,
            characterStart: totalCharacters,
            characterCount,
            startLocation: locationCount ? totalLocations + 1 : 0,
            endLocation: locationCount ? totalLocations + locationCount : 0,
            startReferencePage: characterCount ? Math.floor(totalCharacters / charactersPerReferencePage) + 1 : 0,
            endReferencePage: characterCount ? Math.ceil((totalCharacters + characterCount) / charactersPerReferencePage) : 0
        });
        totalWords += wordCount;
        totalCharacters += characterCount;
        totalLocations += locationCount;
    }
    if (totalLocations === 0) {
        throw new Error('CrossInk stable pages require text locations in the EPUB');
    }
    const manifest = {
        format: 'x-locations',
        version: 1,
        generator: 'epub-to-xtc',
        unit: 'word',
        referencePageUnit: 'character',
        wordsPerLocation: WORDS_PER_LOCATION,
        charactersPerReferencePage,
        totalWords,
        totalCharacters,
        totalLocations,
        totalReferencePages: Math.ceil(totalCharacters / charactersPerReferencePage),
        spine
    };
    const json = JSON.stringify(manifest);
    const size = Buffer.byteLength(json, 'utf8');
    if (size > MAX_MANIFEST_BYTES) {
        throw new Error(`Stable page metadata is ${size} bytes; CrossInk supports at most ${MAX_MANIFEST_BYTES} bytes (64 KiB)`);
    }
    zip.file(X_LOCATION_MANIFEST_PATH, json);
    return {
        referenceCharactersPerPage: charactersPerReferencePage,
        locationCount: totalLocations,
        referencePageCount: manifest.totalReferencePages
    };
}

module.exports = { X_LOCATION_MANIFEST_PATH, writeStablePageManifest };
