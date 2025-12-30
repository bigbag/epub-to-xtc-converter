# EPUB to XTC Converter & Optimizer

A tool for converting EPUB files to XTC/XTCH format and optimizing EPUBs for e-ink readers. Available as a browser-based web app and Node.js CLI.

**[Live Demo](https://liashkov.site/epub-to-xtc-converter/)**

## Features

### EPUB to XTC/XTCH Converter
- Convert EPUB books to Xteink's native XTC (1-bit) or XTCH (2-bit grayscale) format
- Uses CREngine WASM for accurate rendering (same as CoolReader)
- Batch processing - convert multiple files at once
- Customizable settings:
  - Device presets (Xteink X4, X3, custom dimensions)
  - Monitor DPI for accurate preview scaling
  - Font family, size, weight (Google Fonts + custom upload)
  - Line height and margins
  - Text alignment and hyphenation (42 languages)
  - Dithering with adjustable strength
  - Progress bar (page numbers, percentages, chapter marks)
  - Dark mode (negative)
- Export individual pages or entire books
- Download all as ZIP for batch exports

### EPUB Optimizer
- Optimize EPUB files for e-ink readers
- Remove problematic CSS (floats, flex, grid, fixed positioning)
- Strip embedded fonts to reduce file size
- Convert images to grayscale
- Resize images to configurable max width
- Inject e-paper optimized CSS
- Batch processing with ZIP export

## Supported Devices

| Device | Resolution | Format |
|--------|------------|--------|
| Xteink X4 | 480x800 | XTC/XTCH |
| Xteink X3 | 528x792 | XTC/XTCH |
| Custom | Any | XTC/XTCH |

## Usage

1. Open the web app in your browser
2. Drop EPUB files onto the drop zone (or click to browse)
3. Adjust settings in the sidebar
4. Preview pages using navigation buttons
5. Click "Export XTC" for single file or "Export All" for batch

### Converter Tab
- **Device**: Select target device or enter custom dimensions
- **Orientation**: Rotate output (0°, 90°, 180°, 270°)
- **Monitor DPI**: Scale preview to match your monitor (default 96 DPI)
- **Text Settings**: Font, size, weight, line height, margins, alignment, hyphenation language
- **Image Settings**: Quality mode (1-bit/2-bit), dithering strength, dark mode
- **Progress Bar**: Book/chapter progress, page numbers (X/Y), percentages, chapter marks

### Optimizer Tab
- Drop EPUBs and switch to the Optimizer tab
- Configure optimization options
- Click "Optimize EPUBs" to download optimized files

### CLI Usage

For batch processing without a browser, use the Node.js CLI:

```bash
cd cli
npm install

# Generate default settings file
node index.js init

# Edit settings.json to set font.path to your TTF/OTF font file

# Convert single file
node index.js convert book.epub -o book.xtc -c settings.json

# Convert all EPUBs in a directory
node index.js convert ./epubs/ -o ./output/ -c settings.json

# Use XTCH format (2-bit grayscale)
node index.js convert book.epub -f xtch -c settings.json
```

Example `settings.json`:
```json
{
  "device": "xteink-x4",
  "font": { "path": "./LiterataTT.ttf", "size": 34, "weight": 400 },
  "margins": { "left": 16, "top": 16, "right": 16, "bottom": 16 },
  "lineHeight": 120,
  "textAlign": "justify",
  "hyphenation": { "enabled": true, "language": "en" },
  "output": { "format": "xtc", "dithering": true, "ditherStrength": 0.7 }
}
```

## XTC/XTCH Format

Native binary ebook format for Xteink e-readers. Stores pre-rendered bitmap pages optimized for the device's e-paper display.

| Extension | Container | Page Format | Bit Depth | Description |
|-----------|-----------|-------------|-----------|-------------|
| `.xtc`    | XTC       | XTG         | 1-bit     | Monochrome, fast rendering, smaller files |
| `.xtch`   | XTCH      | XTH         | 2-bit     | 4-level grayscale, better image quality |

### Xteink X4 Specifics

- **Display**: 480x800 e-paper (4.3")
- **XTG (1-bit)**: Row-major scan, 8 pixels per byte, MSB = leftmost pixel
- **XTH (2-bit)**: Vertical scan order (columns right-to-left), optimized for e-paper refresh
- **Grayscale LUT**: Non-linear mapping (0=white, 1=dark gray, 2=light gray, 3=black)

Both formats include:
- Document metadata (title, author)
- Chapter navigation (TOC)
- Page index for random access

See [XTC Format Specification](docs/xtc-format-spec.md) for technical details.

## Self-Hosting

Clone the repository and serve the web directory:

```bash
git clone https://github.com/bigbag/epub-optimizer-xteink.git
cd epub-optimizer-xteink/web

# Using Python
python -m http.server 8000

# Using Node.js
npx serve .

# Using PHP
php -S localhost:8000
```

Then open http://localhost:8000 in your browser.

## Project Structure

```
/
├── web/                        # Browser-based web app
│   ├── index.html              # Main HTML structure
│   ├── style.css               # Application styles
│   ├── app.js                  # Main application logic
│   ├── crengine.js             # CREngine WASM loader
│   ├── crengine.wasm           # CREngine binary (CoolReader engine)
│   └── dither-worker.js        # Web Worker for Floyd-Steinberg dithering
├── cli/                        # Node.js CLI tool
│   ├── index.js                # CLI entry point
│   ├── converter.js            # WASM integration and conversion logic
│   ├── encoder.js              # XTG/XTH/XTC format encoding
│   ├── dither.js               # Floyd-Steinberg dithering
│   ├── settings.js             # Settings management
│   └── package.json            # CLI dependencies
├── docs/
│   └── xtc-format-spec.md      # XTC format specification
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Pages deployment
├── LICENSE
└── README.md
```

## Dependencies

### Web App
- [JSZip](https://stuk.github.io/jszip/) - ZIP file handling (loaded from CDN)
- CREngine - EPUB rendering (bundled as WASM)
- Google Fonts (loaded on demand): Literata, Lora, Merriweather, Source Serif 4, Noto Serif, Noto Sans, Open Sans, Roboto, EB Garamond, Crimson Pro
- Custom TTF/OTF font upload also supported

### CLI
- Node.js 18+
- [Commander](https://github.com/tj/commander.js) - CLI framework
- [JSZip](https://stuk.github.io/jszip/) - ZIP file handling
- CREngine WASM (shared with web app)

## Browser Support

Requires a modern browser with:
- WebAssembly support
- Web Workers
- File API
- Canvas API

Tested on: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+

## GitHub Pages Deployment

This project auto-deploys to GitHub Pages via GitHub Actions:

1. Push to the `main` branch
2. The workflow automatically deploys the `web/` folder
3. Go to Settings > Pages to verify deployment

The site will be available at `https://<username>.github.io/epub-optimizer-xteink/`

## Credits

- CREngine from [CoolReader](https://github.com/nickvantassel/literata-font)
- XTC format specification from [CrazyCoder's Gist](https://gist.github.com/CrazyCoder/b125f26d6987c0620058249f59f1327d)
- Inspired by [x4converter.rho.sh](https://x4converter.rho.sh)

## License

MIT License - see [LICENSE](LICENSE) file.
