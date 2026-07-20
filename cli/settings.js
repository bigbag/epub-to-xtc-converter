/**
 * Settings management and defaults for CLI converter
 */

const fs = require('fs');
const path = require('path');

// Device presets
const DEVICES = {
    'xteink-x4': { width: 480, height: 800, name: 'Xteink X4' },
    'xteink-x3': { width: 528, height: 792, name: 'Xteink X3' },
    'custom': { width: 480, height: 800, name: 'Custom' }
};

// Text alignment values for CREngine
const TEXT_ALIGN = {
    'left': 0,
    'right': 1,
    'center': 2,
    'justify': 3
};

// Default settings
const DEFAULT_SETTINGS = {
    device: 'xteink-x4',
    width: 480,
    height: 800,
    font: {
        path: null,  // Required: path to TTF/OTF font file
        size: 34,
        weight: 400
    },
    margins: {
        left: 16,
        top: 16,
        right: 16,
        bottom: 16
    },
    lineHeight: 120,
    textAlign: 'justify',
    hyphenation: {
        enabled: true,
        language: 'en'
    },
    output: {
        format: 'xtc',  // 'xtc' (1-bit) or 'xtch' (2-bit)
        dithering: true,
        ditherStrength: 0.7,
        negative: false
    },
    optimizer: {
        removeCss: true,
        stripFonts: true,
        processImages: true,
        removeUnsupportedImages: true,
        grayscale: true,
        maxImageWidth: 480,
        injectCss: true,
        recursive: true,
        include: '*.epub',
        exclude: null,
        stablePageNumbers: {
            enabled: false,
            referenceCharactersPerPage: 1500
        }
    }
};

/**
 * Load settings from JSON file
 */
function loadSettings(configPath) {
    if (!configPath || !fs.existsSync(configPath)) {
        return { ...DEFAULT_SETTINGS };
    }

    try {
        const content = fs.readFileSync(configPath, 'utf8');
        const userSettings = JSON.parse(content);
        return mergeSettings(DEFAULT_SETTINGS, userSettings);
    } catch (err) {
        throw new Error(`Failed to load config file: ${err.message}`);
    }
}

/**
 * Deep merge settings objects
 */
function mergeSettings(defaults, user) {
    const result = { ...defaults };

    for (const key of Object.keys(user)) {
        if (user[key] !== null && typeof user[key] === 'object' && !Array.isArray(user[key])) {
            result[key] = mergeSettings(defaults[key] || {}, user[key]);
        } else {
            result[key] = user[key];
        }
    }

    return result;
}

/**
 * Resolve settings with device preset
 */
function resolveSettings(settings) {
    const resolved = { ...settings };

    // Apply device preset dimensions if not custom
    if (settings.device !== 'custom' && DEVICES[settings.device]) {
        resolved.width = DEVICES[settings.device].width;
        resolved.height = DEVICES[settings.device].height;
    }

    // Convert text align string to CREngine value
    resolved.textAlignValue = TEXT_ALIGN[settings.textAlign] || 3;

    // Resolve font path to absolute
    if (resolved.font.path) {
        resolved.font.path = path.resolve(resolved.font.path);
    }

    return resolved;
}

/**
 * Validate settings
 */
function validateSettings(settings) {
    const errors = [];

    if (!settings.font.path) {
        errors.push('Font path is required. Set font.path in your config file.');
    } else if (!fs.existsSync(settings.font.path)) {
        errors.push(`Font file not found: ${settings.font.path}`);
    }

    if (settings.width <= 0 || settings.height <= 0) {
        errors.push('Width and height must be positive integers');
    }

    if (settings.font.size < 8 || settings.font.size > 100) {
        errors.push('Font size must be between 8 and 100');
    }

    if (settings.output.ditherStrength < 0 || settings.output.ditherStrength > 1) {
        errors.push('Dither strength must be between 0 and 1');
    }

    const validFormats = ['xtc', 'xtch'];
    if (!validFormats.includes(settings.output.format)) {
        errors.push(`Invalid output format: ${settings.output.format}. Must be 'xtc' or 'xtch'`);
    }

    validateOptimizerFields(settings, errors);

    return errors;
}

/**
 * Validate optimizer-specific settings (no font.path required)
 */
function validateOptimizerSettings(settings) {
    const errors = [];
    validateOptimizerFields(settings, errors);
    return errors;
}

function validateOptimizerFields(settings, errors) {
    if (settings.optimizer) {
        if (settings.optimizer.maxImageWidth !== undefined &&
            (settings.optimizer.maxImageWidth < 1 || settings.optimizer.maxImageWidth > 2048)) {
            errors.push('optimizer.maxImageWidth must be between 1 and 2048');
        }

        const stablePages = settings.optimizer.stablePageNumbers;
        if (stablePages) {
            if (typeof stablePages.enabled !== 'boolean') {
                errors.push('optimizer.stablePageNumbers.enabled must be a boolean');
            }

            const charactersPerPage = stablePages.referenceCharactersPerPage;
            if (!Number.isFinite(charactersPerPage) ||
                !Number.isInteger(charactersPerPage) ||
                charactersPerPage < 1 ||
                charactersPerPage > 10000) {
                errors.push('optimizer.stablePageNumbers.referenceCharactersPerPage must be an integer between 1 and 10000');
            }
        }
    }
}

function parseReferenceCharactersPerPage(value) {
    const text = String(value);
    if (!/^\d+$/.test(text)) {
        throw new Error('optimizer.stablePageNumbers.referenceCharactersPerPage must be an integer between 1 and 10000');
    }

    const parsed = Number.parseInt(text, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10000) {
        throw new Error('optimizer.stablePageNumbers.referenceCharactersPerPage must be an integer between 1 and 10000');
    }
    return parsed;
}

function resolveOptimizerOptions(optimizerSettings, cliOptions = {}) {
    const resolved = {
        ...optimizerSettings,
        stablePageNumbers: {
            ...(optimizerSettings.stablePageNumbers || DEFAULT_SETTINGS.optimizer.stablePageNumbers)
        }
    };

    if (cliOptions.stablePages !== undefined) {
        resolved.stablePageNumbers.enabled = cliOptions.stablePages;
    }

    if (cliOptions.charsPerPage !== undefined) {
        resolved.stablePageNumbers.referenceCharactersPerPage = parseReferenceCharactersPerPage(cliOptions.charsPerPage);
        resolved.stablePageNumbers.enabled = true;
    }

    return resolved;
}

/**
 * Generate default config file content
 */
function generateDefaultConfig() {
    return JSON.stringify(DEFAULT_SETTINGS, null, 2);
}

module.exports = {
    DEVICES,
    TEXT_ALIGN,
    DEFAULT_SETTINGS,
    loadSettings,
    resolveSettings,
    validateSettings,
    validateOptimizerSettings,
    parseReferenceCharactersPerPage,
    resolveOptimizerOptions,
    generateDefaultConfig
};
