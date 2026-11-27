'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildXTCContainer } = require('./encoder');

const METADATA_OFFSET = 56;
const CHAPTER_OFFSET = 56 + 256;

function container(meta, toc) {
    return buildXTCContainer([new Uint8Array(16)], meta, toc, 480, 800, false);
}
function cString(bytes, start, cap) {
    let end = start;
    while (end < start + cap && bytes[end] !== 0) end++;
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, end));
}

test('long ASCII title stays within 127 bytes and does not bleed into author', () => {
    const bytes = container({ title: 'T'.repeat(300), author: 'Alice' }, []);
    assert.equal(bytes[METADATA_OFFSET + 127], 0);
    assert.equal(cString(bytes, METADATA_OFFSET, 127), 'T'.repeat(127));
    assert.equal(cString(bytes, METADATA_OFFSET + 128, 63), 'Alice');
});

test('CJK title is truncated byte-safe (valid UTF-8, <= 127 bytes)', () => {
    const bytes = container({ title: '中文标题'.repeat(50), author: '作者'.repeat(50) }, []);
    const title = cString(bytes, METADATA_OFFSET, 127); // fatal decoder throws on split sequence
    assert.ok(title.length <= 127);
    assert.ok(Buffer.from(title, 'utf8').length <= 127);
    const author = cString(bytes, METADATA_OFFSET + 128, 63);
    assert.ok(Buffer.from(author, 'utf8').length <= 63);
});

test('CJK chapter title <= 79 bytes, page field intact', () => {
    const toc = [{ title: '章节'.repeat(60), page: 7 }];
    const bytes = container({ title: 'Book', author: '' }, toc);
    const title = cString(bytes, CHAPTER_OFFSET, 79);
    assert.ok(Buffer.from(title, 'utf8').length <= 79);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint16(CHAPTER_OFFSET + 80, true), 8); // 1-indexed
    assert.equal(bytes[CHAPTER_OFFSET + 79], 0);
});

test('short strings unchanged', () => {
    const bytes = container({ title: 'Hello', author: 'Bob' }, [{ title: 'Ch 1', page: 0 }]);
    assert.equal(cString(bytes, METADATA_OFFSET, 127), 'Hello');
    assert.equal(cString(bytes, METADATA_OFFSET + 128, 63), 'Bob');
    assert.equal(cString(bytes, CHAPTER_OFFSET, 79), 'Ch 1');
});
