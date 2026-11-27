#!/usr/bin/env node

/**
 * EPUB to XTC/XTCH CLI Converter
 * Converts EPUB files to Xteink e-reader format
 */

const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const { minimatch } = require('minimatch');
const { loadSettings, resolveSettings, validateSettings, validateOptimizerSettings, resolveOptimizerOptions, generateDefaultConfig } = require('./settings');
const { convertEpub, getOutputPath, cleanup } = require('./converter');
const { convertPdf } = require('./pdf-renderer');
const { optimizeEpub } = require('./optimizer');

program
    .name('epub-to-xtc')
    .description('Convert EPUB files to XTC/XTCH format for Xteink e-readers')
    .version('1.0.0');

program
    .command('convert <input>')
    .description('Convert EPUB file(s) to XTC/XTCH format')
    .option('-o, --output <path>', 'Output file or directory')
    .option('-c, --config <path>', 'Path to settings JSON file')
    .option('-f, --format <format>', 'Output format: xtc (1-bit) or xtch (2-bit)')
    .option('--zoom <number>', 'PDF zoom factor 1.0-3.0 (splits pages into tiles)')
    .option('--trim-margins', 'Trim PDF white margins before fitting')
    .action(async (input, options) => {
        try {
            let settings = loadSettings(options.config);
            settings = resolveSettings(settings);

            if (options.format) settings.output.format = options.format;
            if (options.zoom !== undefined) settings.pdf.zoom = parseFloat(options.zoom);
            if (options.trimMargins) settings.pdf.trimMargins = true;

            const inputPath = path.resolve(input);
            if (!fs.existsSync(inputPath)) {
                console.error(`Input not found: ${inputPath}`);
                process.exit(1);
            }
            const stat = fs.statSync(inputPath);

            let files;
            if (stat.isDirectory()) {
                files = collectInputFiles(inputPath, { recursive: true, include: '*.{epub,pdf}' }, inputPath);
                if (files.length === 0) {
                    console.error('No EPUB or PDF files found in directory (searched recursively)');
                    process.exit(1);
                }
            } else if (stat.isFile() && /\.(epub|pdf)$/i.test(inputPath)) {
                files = [{ absolute: inputPath, relative: path.basename(inputPath) }];
            } else {
                console.error('Input must be an EPUB or PDF file, or a directory containing them');
                process.exit(1);
            }

            const requireFont = files.some(f => /\.epub$/i.test(f.absolute));
            const errors = validateSettings(settings, { requireFont });
            if (errors.length > 0) {
                console.error('Configuration errors:');
                errors.forEach(e => console.error(`  - ${e}`));
                process.exit(1);
            }

            if (stat.isDirectory()) {
                await convertDirectory(inputPath, options.output, settings, files);
            } else {
                await convertSingleFile(inputPath, options.output, settings);
            }

        } catch (err) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        } finally {
            cleanup();
        }
    });

program
    .command('init')
    .description('Generate default settings.json file')
    .option('-o, --output <path>', 'Output path', 'settings.json')
    .action((options) => {
        const outputPath = path.resolve(options.output);

        if (fs.existsSync(outputPath)) {
            console.error(`File already exists: ${outputPath}`);
            process.exit(1);
        }

        fs.writeFileSync(outputPath, generateDefaultConfig());
        console.log(`Created default settings file: ${outputPath}`);
        console.log('\nImportant: Edit the file to set font.path to your TTF/OTF font file.');
    });

program
    .command('optimize <input>')
    .description('Optimize EPUB file(s) for e-paper devices')
    .option('-o, --output <path>', 'Output file or directory')
    .option('-c, --config <path>', 'Path to settings JSON file')
    .option('--stable-pages', 'Generate CrossInk stable page metadata')
    .option('--no-stable-pages', 'Disable stable page generation even with --chars-per-page')
    .option('--chars-per-page <integer>', 'Set reference characters per page (1-10000). Enable generation.')
    .action(async (input, options) => {
        try {
            const settings = loadSettings(options.config);
            const opts = resolveOptimizerOptions(settings.optimizer || {}, options);
            settings.optimizer = opts;

            const errors = validateOptimizerSettings(settings);
            if (errors.length > 0) {
                console.error('Configuration errors:');
                errors.forEach(e => console.error(`  - ${e}`));
                process.exit(1);
            }

            const inputPath = path.resolve(input);

            if (!fs.existsSync(inputPath)) {
                console.error(`Input not found: ${inputPath}`);
                process.exit(1);
            }

            const stat = fs.statSync(inputPath);

            if (stat.isDirectory()) {
                await optimizeDirectory(inputPath, options.output, opts);
            } else if (stat.isFile() && inputPath.endsWith('.epub')) {
                await optimizeSingleFile(inputPath, options.output, opts);
            } else {
                console.error('Input must be an EPUB file or directory containing EPUB files');
                process.exit(1);
            }

        } catch (err) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    });

function formatSize(bytes) {
    return (bytes / 1024).toFixed(1) + ' KB';
}

async function optimizeSingleFile(inputPath, outputPath, opts) {
    if (!outputPath) {
        const dir = path.dirname(inputPath);
        const ext = path.extname(inputPath);
        const base = path.basename(inputPath, ext);
        outputPath = path.join(dir, `${base}_optimized${ext}`);
    } else if (fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory()) {
        outputPath = path.join(outputPath, path.basename(inputPath));
    } else {
        outputPath = path.resolve(outputPath);
    }

    const filename = path.basename(inputPath);
    console.log(`Optimizing: ${filename}`);

    const result = await optimizeEpub(inputPath, outputPath, opts);

    console.log(`  Output: ${result.outputPath}`);
    console.log(`  Size: ${formatSize(result.originalSize)} -> ${formatSize(result.optimizedSize)} (${result.reductionPercent}% reduction)`);
    logStablePageStatus(result.stablePageNumbers);
}

function logStablePageStatus(stats) {
    if (!stats) return;
    console.log(`  Stable pages: ${stats.referencePageCount} (${stats.referenceCharactersPerPage} characters/page)`);
    console.log(`  Locations: ${stats.locationCount}`);
    console.log('  Manifest: META-INF/x-locations.json');
}

/**
 * Collect input files from a directory, optionally recursive
 */
function collectInputFiles(dir, opts, basedir) {
    basedir = basedir || dir;
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const include = opts.include || '*.epub';
    const exclude = opts.exclude || null;

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(basedir, fullPath);

        if (entry.isDirectory() && opts.recursive) {
            results = results.concat(collectInputFiles(fullPath, opts, basedir));
        } else if (entry.isFile()) {
            if (!minimatch(entry.name, include)) continue;
            if (exclude && minimatch(entry.name, exclude)) continue;
            results.push({ absolute: fullPath, relative: relPath });
        }
    }

    return results;
}

async function optimizeDirectory(inputDir, outputDir, opts) {
    const files = collectInputFiles(inputDir, opts, inputDir);

    if (files.length === 0) {
        console.error('No EPUB files found in directory');
        process.exit(1);
    }

    const inPlace = !outputDir;
    if (!outputDir) {
        outputDir = inputDir;
    } else {
        outputDir = path.resolve(outputDir);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
    }

    console.log(`Optimizing ${files.length} EPUB file(s)...\n`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // Preserve relative directory structure in output
        let outputPath;
        if (inPlace) {
            // Add _optimized suffix to avoid overwriting originals
            const ext = path.extname(file.relative);
            const base = file.relative.slice(0, -ext.length);
            outputPath = path.join(outputDir, `${base}_optimized${ext}`);
        } else {
            outputPath = path.join(outputDir, file.relative);
        }

        console.log(`[${i + 1}/${files.length}] ${file.relative}`);

        try {
            const result = await optimizeEpub(file.absolute, outputPath, opts);

            console.log(`  Output: ${path.basename(result.outputPath)}`);
            console.log(`  Size: ${formatSize(result.originalSize)} -> ${formatSize(result.optimizedSize)} (${result.reductionPercent}% reduction)`);
            logStablePageStatus(result.stablePageNumbers);
            console.log('');
            successCount++;

        } catch (err) {
            console.log(`  Error: ${err.message}\n`);
            failCount++;
        }
    }

    console.log(`\nOptimization complete: ${successCount} succeeded, ${failCount} failed`);
}

async function convertSingleFile(inputPath, outputPath, settings) {
    // Determine output path
    if (!outputPath) {
        const dir = path.dirname(inputPath);
        outputPath = getOutputPath(inputPath, dir, settings.output.format);
    } else if (fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory()) {
        outputPath = getOutputPath(inputPath, outputPath, settings.output.format);
    } else {
        outputPath = path.resolve(outputPath);
    }

    const filename = path.basename(inputPath);
    console.log(`Converting: ${filename}`);

    const convert = /\.pdf$/i.test(inputPath) ? convertPdf : convertEpub;
    const result = await convert(inputPath, outputPath, settings, (current, total) => {
        const percent = Math.round((current / total) * 100);
        process.stdout.write(`\r  Progress: ${current}/${total} pages (${percent}%)`);
    });

    console.log(`\n  Output: ${result.outputPath}`);
    console.log(`  Pages: ${result.pageCount}`);
    console.log(`  Format: ${result.format.toUpperCase()}`);
}

async function convertDirectory(inputDir, outputDir, settings, files) {
    // Determine output directory
    if (!outputDir) {
        outputDir = inputDir;
    } else {
        outputDir = path.resolve(outputDir);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
    }

    console.log(`Converting ${files.length} EPUB/PDF file(s)...\n`);

    const ext = settings.output.format === 'xtch' ? '.xtch' : '.xtc';
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const relNoExt = file.relative.slice(0, -path.extname(file.relative).length);
        const outputPath = path.join(outputDir, relNoExt + ext);

        fs.mkdirSync(path.dirname(outputPath), { recursive: true });

        console.log(`[${i + 1}/${files.length}] ${file.relative}`);

        try {
            const convert = /\.pdf$/i.test(file.absolute) ? convertPdf : convertEpub;
            const result = await convert(file.absolute, outputPath, settings, (current, total) => {
                const percent = Math.round((current / total) * 100);
                process.stdout.write(`\r  Progress: ${current}/${total} pages (${percent}%)`);
            });

            console.log(`\n  Output: ${path.relative(outputDir, result.outputPath)}`);
            console.log(`  Pages: ${result.pageCount}\n`);
            successCount++;

        } catch (err) {
            console.log(`\n  Error: ${err.message}\n`);
            failCount++;
        }
    }

    console.log(`\nConversion complete: ${successCount} succeeded, ${failCount} failed`);
}

program.parse();
