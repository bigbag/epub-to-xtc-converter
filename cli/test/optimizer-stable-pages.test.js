const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const JSZip = require('jszip');

const { DEFAULT_SETTINGS } = require('../settings');
const { optimizeEpub } = require('../optimizer');
const { X_LOCATION_MANIFEST_PATH } = require('../stable-pages');
const { createFixture } = require('./fixtures/books');

function options(overrides = {}) {
    return {
        ...structuredClone(DEFAULT_SETTINGS.optimizer),
        ...overrides,
        stablePageNumbers: {
            ...DEFAULT_SETTINGS.optimizer.stablePageNumbers,
            ...(overrides.stablePageNumbers || {})
        }
    };
}

async function writeFixture(filePath, name = 'basic-epub3') {
    const buffer = await createFixture(name).generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE'
    });
    fs.writeFileSync(filePath, buffer);
}

function temporaryDirectory(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crossink-stable-pages-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return directory;
}

function firstLocalEntry(buffer) {
    assert.equal(buffer.readUInt32LE(0), 0x04034b50);
    const compressionMethod = buffer.readUInt16LE(8);
    const nameLength = buffer.readUInt16LE(26);
    const name = buffer.subarray(30, 30 + nameLength).toString('utf8');
    return { name, compressionMethod };
}

test('optimizer writes the manifest after content processing and records its operation', async t => {
    const directory = temporaryDirectory(t);
    const input = path.join(directory, 'input.epub');
    const output = path.join(directory, 'output.epub');
    await writeFixture(input);

    const result = await optimizeEpub(input, output, options({
        stablePageNumbers: { enabled: true, referenceCharactersPerPage: 1000 }
    }));
    const outputBuffer = fs.readFileSync(output);
    const zip = await JSZip.loadAsync(outputBuffer);
    const manifest = JSON.parse(await zip.files[X_LOCATION_MANIFEST_PATH].async('string'));

    assert.equal(manifest.charactersPerReferencePage, 1000);
    assert.equal(manifest.totalReferencePages, 2);
    assert.deepEqual(result.stablePageNumbers, {
        referenceCharactersPerPage: 1000,
        wordsPerLocationUnit: 64,
        locationCount: 5,
        referencePageCount: 2
    });
    assert.deepEqual(result.operations.at(-1), {
        type: 'generateStablePageNumbers',
        file: X_LOCATION_MANIFEST_PATH,
        ...result.stablePageNumbers
    });
});

test('enabled packaging keeps mimetype first and uncompressed and remains readable', async t => {
    const directory = temporaryDirectory(t);
    const input = path.join(directory, 'input.epub');
    const output = path.join(directory, 'output.epub');
    await writeFixture(input);

    await optimizeEpub(input, output, options({
        stablePageNumbers: { enabled: true, referenceCharactersPerPage: 1500 }
    }));

    const outputBuffer = fs.readFileSync(output);
    assert.deepEqual(firstLocalEntry(outputBuffer), { name: 'mimetype', compressionMethod: 0 });
    const zip = await JSZip.loadAsync(outputBuffer);
    assert.equal(await zip.files.mimetype.async('string'), 'application/epub+zip');
    assert.ok(zip.files['META-INF/container.xml']);
    assert.ok(zip.files[X_LOCATION_MANIFEST_PATH]);
});

test('disabled behavior does not add or replace stable page metadata', async t => {
    const directory = temporaryDirectory(t);
    const input = path.join(directory, 'input.epub');
    const output = path.join(directory, 'output.epub');
    const fixture = createFixture('basic-epub3');
    fixture.file(X_LOCATION_MANIFEST_PATH, '{"preserved":true}');
    fs.writeFileSync(input, await fixture.generateAsync({ type: 'nodebuffer' }));

    const result = await optimizeEpub(input, output, options());
    const zip = await JSZip.loadAsync(fs.readFileSync(output));
    assert.equal(await zip.files[X_LOCATION_MANIFEST_PATH].async('string'), '{"preserved":true}');
    assert.equal(result.stablePageNumbers, null);
    assert.equal(result.operations.some(operation => operation.type === 'generateStablePageNumbers'), false);
});

test('generation errors fail optimization without writing an output EPUB', async t => {
    const directory = temporaryDirectory(t);
    const input = path.join(directory, 'input.epub');
    const output = path.join(directory, 'output.epub');
    const fixture = createFixture('basic-epub3');
    fixture.remove('EPUB/Text/chapter 1.xhtml');
    fs.writeFileSync(input, await fixture.generateAsync({ type: 'nodebuffer' }));

    await assert.rejects(
        optimizeEpub(input, output, options({ stablePageNumbers: { enabled: true } })),
        /Failed to generate stable page metadata for input\.epub:[\s\S]*points to missing resource/
    );
    assert.equal(fs.existsSync(output), false);
});

test('CLI supports single-file flags and chars-per-page enables metadata', async t => {
    const directory = temporaryDirectory(t);
    const input = path.join(directory, 'input.epub');
    const output = path.join(directory, 'output.epub');
    await writeFixture(input);

    const result = spawnSync(process.execPath, [
        path.join(__dirname, '..', 'index.js'),
        'optimize', input,
        '-o', output,
        '--chars-per-page', '1800'
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Stable page metadata: generated/);
    assert.match(result.stdout, /Reference characters\/page: 1800/);
    const zip = await JSZip.loadAsync(fs.readFileSync(output));
    const manifest = JSON.parse(await zip.files[X_LOCATION_MANIFEST_PATH].async('string'));
    assert.equal(manifest.charactersPerReferencePage, 1800);
});

test('CLI no-stable-pages overrides an enabled config', async t => {
    const directory = temporaryDirectory(t);
    const input = path.join(directory, 'input.epub');
    const output = path.join(directory, 'output.epub');
    const config = path.join(directory, 'settings.json');
    await writeFixture(input);
    fs.writeFileSync(config, JSON.stringify({
        optimizer: {
            stablePageNumbers: { enabled: true, referenceCharactersPerPage: 1000 }
        }
    }));

    const result = spawnSync(process.execPath, [
        path.join(__dirname, '..', 'index.js'),
        'optimize', input,
        '-o', output,
        '--config', config,
        '--no-stable-pages'
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Stable page metadata: disabled/);
    const zip = await JSZip.loadAsync(fs.readFileSync(output));
    assert.equal(zip.files[X_LOCATION_MANIFEST_PATH], undefined);
});

test('directory mode applies stable page settings to every EPUB', async t => {
    const directory = temporaryDirectory(t);
    const inputDirectory = path.join(directory, 'books');
    const nestedDirectory = path.join(inputDirectory, 'nested');
    const outputDirectory = path.join(directory, 'optimized');
    fs.mkdirSync(nestedDirectory, { recursive: true });
    await writeFixture(path.join(inputDirectory, 'one.epub'), 'basic-epub2');
    await writeFixture(path.join(nestedDirectory, 'two.epub'), 'unicode-multilingual');

    const result = spawnSync(process.execPath, [
        path.join(__dirname, '..', 'index.js'),
        'optimize', inputDirectory,
        '-o', outputDirectory,
        '--stable-pages',
        '--chars-per-page', '2500'
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Optimization complete: 2 succeeded, 0 failed/);
    for (const relative of ['one.epub', path.join('nested', 'two.epub')]) {
        const zip = await JSZip.loadAsync(fs.readFileSync(path.join(outputDirectory, relative)));
        const manifest = JSON.parse(await zip.files[X_LOCATION_MANIFEST_PATH].async('string'));
        assert.equal(manifest.charactersPerReferencePage, 2500);
    }
});

test('a failed batch item does not remove successful outputs', async t => {
    const directory = temporaryDirectory(t);
    const inputDirectory = path.join(directory, 'books');
    const outputDirectory = path.join(directory, 'optimized');
    fs.mkdirSync(inputDirectory);
    await writeFixture(path.join(inputDirectory, 'valid.epub'));
    const invalid = createFixture('basic-epub3');
    invalid.remove('EPUB/Text/chapter 1.xhtml');
    fs.writeFileSync(path.join(inputDirectory, 'invalid.epub'), await invalid.generateAsync({ type: 'nodebuffer' }));

    const result = spawnSync(process.execPath, [
        path.join(__dirname, '..', 'index.js'),
        'optimize', inputDirectory,
        '-o', outputDirectory,
        '--stable-pages'
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Optimization complete: 1 succeeded, 1 failed/);
    assert.equal(fs.existsSync(path.join(outputDirectory, 'valid.epub')), true);
    assert.equal(fs.existsSync(path.join(outputDirectory, 'invalid.epub')), false);
    const validZip = await JSZip.loadAsync(fs.readFileSync(path.join(outputDirectory, 'valid.epub')));
    assert.ok(validZip.files[X_LOCATION_MANIFEST_PATH]);
});

test('invalid CLI character counts are rejected before output is written', async t => {
    const directory = temporaryDirectory(t);
    const input = path.join(directory, 'input.epub');
    const output = path.join(directory, 'output.epub');
    await writeFixture(input);

    for (const invalid of ['0', '-1', '1.5', 'NaN', '10001']) {
        const result = spawnSync(process.execPath, [
            path.join(__dirname, '..', 'index.js'),
            'optimize', input,
            '-o', output,
            '--chars-per-page', invalid
        ], { encoding: 'utf8' });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /must be an integer between 1 and 10000/);
        assert.equal(fs.existsSync(output), false);
    }
});
