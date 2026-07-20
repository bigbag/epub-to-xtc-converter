const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_SETTINGS,
    parseReferenceCharactersPerPage,
    resolveOptimizerOptions,
    validateOptimizerSettings
} = require('../settings');

test('stable page defaults preserve existing optimizer behavior', () => {
    assert.deepEqual(DEFAULT_SETTINGS.optimizer.stablePageNumbers, {
        enabled: false,
        referenceCharactersPerPage: 1500
    });
    assert.deepEqual(validateOptimizerSettings(DEFAULT_SETTINGS), []);
});

test('stable page settings are validated without clamping', () => {
    const invalidValues = [0, -1, 1.5, 10001, NaN, Infinity, '1500'];
    for (const value of invalidValues) {
        const settings = structuredClone(DEFAULT_SETTINGS);
        settings.optimizer.stablePageNumbers.referenceCharactersPerPage = value;
        assert.deepEqual(validateOptimizerSettings(settings), [
            'optimizer.stablePageNumbers.referenceCharactersPerPage must be an integer between 1 and 10000'
        ]);
    }

    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.optimizer.stablePageNumbers.enabled = 'yes';
    assert.deepEqual(validateOptimizerSettings(settings), [
        'optimizer.stablePageNumbers.enabled must be a boolean'
    ]);
});

test('CLI stable page options override configuration', () => {
    const configured = {
        ...DEFAULT_SETTINGS.optimizer,
        stablePageNumbers: { enabled: true, referenceCharactersPerPage: 1800 }
    };

    assert.deepEqual(resolveOptimizerOptions(configured, {}), configured);
    assert.equal(resolveOptimizerOptions(configured, { stablePages: false }).stablePageNumbers.enabled, false);

    const overridden = resolveOptimizerOptions(configured, { charsPerPage: '2500' });
    assert.deepEqual(overridden.stablePageNumbers, {
        enabled: true,
        referenceCharactersPerPage: 2500
    });
});

test('CLI character count parser accepts only base-10 integers in range', () => {
    assert.equal(parseReferenceCharactersPerPage('1'), 1);
    assert.equal(parseReferenceCharactersPerPage('10000'), 10000);

    for (const value of ['0', '-1', '1.5', '1e3', 'NaN', '10001']) {
        assert.throws(() => parseReferenceCharactersPerPage(value), /must be an integer between 1 and 10000/);
    }
});
