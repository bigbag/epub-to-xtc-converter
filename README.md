# EPUB Optimizer for Xteink X4

[![Tests](https://github.com/bigbag/epub-optimizer-xteink/workflows/Tests/badge.svg)](https://github.com/bigbag/epub-optimizer-xteink/actions?query=workflow%3ATests)
[![versions](https://img.shields.io/badge/python-3.10%20|%203.11%20|%203.12%20|%203.13-blue.svg)](https://github.com/bigbag/epub-optimizer-xteink)
[![license](https://img.shields.io/github/license/bigbag/epub-optimizer-xteink.svg)](https://github.com/bigbag/epub-optimizer-xteink/blob/main/LICENSE)

Optimizes EPUB files for the Xteink X4 e-reader (and similar small e-paper devices).

## Why This Tool?

The Xteink X4 is a compact 4.3" e-ink reader with a 480×800 pixel monochrome display and only 128MB RAM. Standard EPUBs often render poorly on such devices due to:

- **Complex CSS layouts** (floats, flexbox, grid) that the simple reader engine can't handle
- **Large embedded fonts** consuming precious memory and storage
- **High-resolution color images** wasting space on a grayscale screen
- **Fixed-width designs** meant for larger tablets, causing text overflow or tiny fonts

This optimizer sanitizes EPUBs specifically for the X4's constraints, resulting in faster page turns, better readability, and smaller file sizes.

## Xteink X4 Specifications

- **Display**: 4.3" E Ink
- **Resolution**: 480×800 pixels
- **PPI**: 220
- **Color**: Monochrome
- **Formats**: TXT, EPUB

## Features

- **CSS Sanitization**: Removes floats, fixed positioning, flex/grid layouts
- **Font Removal**: Strips embedded fonts to reduce file size
- **Image Optimization**: Converts to grayscale, resizes to 480px max width, applies contrast boost and sharpening
- **E-paper CSS Injection**: Adds optimized stylesheet for e-ink displays

## Installation

```bash
uv sync
```

## Usage

```bash
python src/optimizer.py INPUT_DIR OUTPUT_DIR [OPTIONS]
```

Or using make:

```bash
make optimize INPUT=./input OUTPUT=./output
```

### Options

- `--no-image-downscale` - Skip image processing (default: False)
- `--keep-fonts` - Keep embedded fonts (default: False)
- `--recursive` - Process subdirectories (default: False)
- `--max-width` - Max image width in pixels (default: 480)
- `--quality` - JPEG quality 1-100 (default: 75)

### Examples

Basic conversion:
```bash
python src/optimizer.py ./ebooks ./optimized
```

Recursive with custom quality:
```bash
python src/optimizer.py ./library ./x4-ready --recursive --quality 85
```

Keep fonts, skip image processing:
```bash
python src/optimizer.py ./input ./output --keep-fonts --no-image-downscale
```

## EPUB to XTC/XTCH Conversion

Convert EPUB files to Xteink's native XTC/XTCH format:

```bash
python src/converter.py book.epub book.xtch --font fonts/Bookerly.ttf
```

Or using make (uses Bookerly fonts from `fonts/` by default):

```bash
make convert INPUT=book.epub OUTPUT=book.xtch
make convert INPUT=book.epub OUTPUT=book.xtch FONT_SIZE=40  # larger text
make convert-mono INPUT=book.epub OUTPUT=book.xtc  # 1-bit monochrome
```

### Options

- `--format {xtc,xtch}` - Output format: xtc (1-bit mono) or xtch (2-bit grayscale, default)
- `--font PATH` - Regular font file (REQUIRED)
- `--font-bold PATH` - Bold font variant (optional)
- `--font-italic PATH` - Italic font variant (optional)
- `--font-bold-italic PATH` - Bold-Italic font variant (optional)
- `--font-size {28,34,40}` - Base font size in pixels (default: 34)
- `--recursive` - Process directories recursively

### Font Size and PPI

The Xteink X4 has 220 PPI, which affects how font sizes translate to readable text:

- At 220 PPI: 1 point ≈ 3 pixels
- For readable 11pt text: need ~34 pixels

Available font sizes:
- `28` - Small (~9pt)
- `34` - Medium (~11pt, default)
- `40` - Large (~13pt)

## Architecture

```
src/
├── config.py          # Centralized configuration (display, typography, format constants)
├── epub_utils.py      # Shared EPUB utilities (namespaces, OPF finding)
├── optimizer.py       # EPUB sanitizer CLI
├── converter.py       # EPUB to XTC/XTCH converter CLI
├── epub_parser.py     # EPUB content extraction
├── text_renderer.py   # PIL-based text rendering
├── pagination.py      # Page layout and text flow
└── xtc_format.py      # XTC/XTCH binary encoding
```

### Converter Pipeline

```
EPUB → epub_parser.py → pagination.py → text_renderer.py → xtc_format.py → XTC/XTCH
```

## Testing

Run tests with pytest:

```bash
# Run all tests with coverage
make test

# Run specific test file
PYTHONPATH=.:src pytest tests/test_config.py -v

# Run tests matching pattern
PYTHONPATH=.:src pytest -k "test_sanitize" -v
```

The test suite covers:
- **config.py**: Constants, heading size calculations
- **epub_utils.py**: OPF finding, namespace handling
- **optimizer.py**: CSS sanitization, manifest operations, font removal, image processing, EPUB rebuild
- **xtc_format.py**: Binary encoding, quantization, container writing
- **epub_parser.py**: HTML parsing, metadata extraction, TOC parsing
- **text_renderer.py**: Font handling, text wrapping
- **pagination.py**: Page layout, chapter detection
- **converter.py**: End-to-end conversion, CLI argument handling, directory processing

### Test Fixtures

Test fixtures in `tests/fixtures/` include:
- Minimal valid EPUB structure (container.xml, content.opf, chapter1.xhtml)
- NCX and NAV navigation files
- Generated test images (grayscale, color)

## Documentation

- [XTC/XTG/XTH/XTCH Format Specification](docs/xtc-format-spec.md) ([source](https://gist.github.com/CrazyCoder/b125f26d6987c0620058249f59f1327d))
