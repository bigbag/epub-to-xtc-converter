#!/usr/bin/env python3
"""
EPUB Sanitizer for Xteink X4 / CrossPoint Reader

Optimizes EPUB files for small e-paper displays by:
- Sanitizing CSS (removing floats, fixed positioning, etc.)
- Injecting e-paper-friendly stylesheet
- Removing embedded fonts (optional)
- Downscaling and optimizing images for grayscale e-ink
"""

import argparse
import io
import logging
import os
import re
import shutil
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from config import DEFAULT_CONTRAST_BOOST, DEFAULT_MAX_WIDTH, DEFAULT_QUALITY, X4_CSS, X4_CSS_FILENAME
from epub_utils import EPUB_NAMESPACES, find_opf_path_in_dir, get_opf_dir

logger = logging.getLogger(__name__)

try:
    from PIL import Image, ImageEnhance, ImageFilter

    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False
    logger.warning("PIL not available - image processing disabled")


# CSS patterns to remove (data-driven approach)
# Each tuple: (pattern, flags)
CSS_PATTERNS_TO_REMOVE = [
    (r"@font-face\s*\{[^}]*\}", re.IGNORECASE | re.DOTALL),  # @font-face blocks
    (r"font-family\s*:[^;]+;?", re.IGNORECASE),  # font-family declarations
    (r"float\s*:[^;]+;?", re.IGNORECASE),  # float
    (r"column-count\s*:[^;]+;?", re.IGNORECASE),  # column-count
    (r"margin(-left|-right)?\s*:[^;]+;?", re.IGNORECASE),  # margins
    (r"position\s*:\s*(absolute|fixed)[^;]*;?", re.IGNORECASE),  # absolute/fixed positioning
    (r"display\s*:\s*(flex|grid)[^;]*;?", re.IGNORECASE),  # flex/grid display
    (r"(?<!max-)(width|height)\s*:\s*\d+\s*(px|pt|cm|mm|in)[^;]*;?", re.IGNORECASE),  # fixed sizes
    (r"text-indent\s*:\s*-?\d{2,}[^;]*;?", re.IGNORECASE),  # large text-indent
]

# Pre-compiled patterns for font-related CSS (used conditionally)
CSS_FONT_PATTERNS = [
    re.compile(r"@font-face\s*\{[^}]*\}", re.IGNORECASE | re.DOTALL),
    re.compile(r"font-family\s*:[^;]+;?", re.IGNORECASE),
]

# Pre-compiled patterns for layout-related CSS (always removed)
CSS_LAYOUT_PATTERNS = [re.compile(pattern, flags) for pattern, flags in CSS_PATTERNS_TO_REMOVE[2:]]

# Alias for backward compatibility
NAMESPACES = EPUB_NAMESPACES


def sanitize_css_text(css: str, remove_fonts: bool = True) -> str:
    """Remove problematic CSS properties for e-readers."""
    # Remove font-related CSS if requested
    if remove_fonts:
        for pattern in CSS_FONT_PATTERNS:
            css = pattern.sub("", css)

    # Remove layout-related CSS (always)
    for pattern in CSS_LAYOUT_PATTERNS:
        css = pattern.sub("", css)

    # Clean up empty rules and multiple semicolons
    css = re.sub(r";\s*;", ";", css)
    css = re.sub(r"\{\s*\}", "", css)  # Empty rule blocks
    css = re.sub(r"\n\s*\n", "\n", css)  # Multiple blank lines
    return css


def find_opf_file(root: Path) -> Path | None:
    """Find the OPF file via META-INF/container.xml."""
    return find_opf_path_in_dir(root)


def add_css_to_manifest(opf_path: Path, css_rel_path: str) -> None:
    """Add the sanitizer CSS file to the OPF manifest."""
    try:
        tree = ET.parse(opf_path)
        root = tree.getroot()

        # Find manifest element
        manifest = root.find("opf:manifest", NAMESPACES)
        if manifest is None:
            manifest = root.find("manifest")
        if manifest is None:
            return

        # Check if already exists
        css_id = "x4-sanitizer-css"
        for item in manifest:
            if item.get("id") == css_id:
                return  # Already added

        # Add new item
        item = ET.SubElement(manifest, "item")
        item.set("id", css_id)
        item.set("href", css_rel_path)
        item.set("media-type", "text/css")

        tree.write(opf_path, encoding="utf-8", xml_declaration=True)
    except ET.ParseError:
        pass


def remove_font_from_manifest(opf_path: Path, font_href: str) -> None:
    """Remove a font file reference from the OPF manifest."""
    try:
        tree = ET.parse(opf_path)
        root = tree.getroot()

        manifest = root.find("opf:manifest", NAMESPACES)
        if manifest is None:
            manifest = root.find("manifest")
        if manifest is None:
            return

        for item in list(manifest):
            href = item.get("href", "")
            if href == font_href or href.endswith("/" + font_href):
                manifest.remove(item)

        tree.write(opf_path, encoding="utf-8", xml_declaration=True)
    except ET.ParseError:
        pass


def remove_fonts(root: Path, opf_path: Path | None) -> int:
    """Remove embedded font files and update manifest."""
    font_extensions = {".ttf", ".otf", ".woff", ".woff2", ".eot"}
    removed_count = 0

    opf_dir = get_opf_dir(opf_path) if opf_path else root

    for path in list(root.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() in font_extensions:
            # Calculate relative path for manifest
            try:
                rel_path = path.relative_to(opf_dir).as_posix()
            except ValueError:
                rel_path = path.name

            if opf_path:
                remove_font_from_manifest(opf_path, rel_path)

            path.unlink()
            removed_count += 1

    return removed_count


def process_images(
    root: Path,
    max_width: int = DEFAULT_MAX_WIDTH,
    quality: int = DEFAULT_QUALITY,
    contrast_boost: float = DEFAULT_CONTRAST_BOOST,
) -> int:
    """Optimize images for e-ink display."""
    if not HAVE_PIL:
        return 0

    processed_count = 0
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        ext = path.suffix.lower()
        if ext not in {".jpg", ".jpeg", ".png", ".gif", ".webp"}:
            continue
        try:
            with Image.open(path) as im:
                im.load()
                w, h = im.size

                # Convert to RGB if necessary (for grayscale conversion)
                if im.mode in ("RGBA", "P"):
                    im = im.convert("RGB")
                elif im.mode == "LA":
                    im = im.convert("L")

                # Resize if too wide
                if w > max_width:
                    ratio = max_width / float(w)
                    new_size = (max_width, int(h * ratio))
                    im = im.resize(new_size, Image.LANCZOS)

                # Boost contrast before grayscale conversion
                if im.mode != "L":
                    enhancer = ImageEnhance.Contrast(im)
                    im = enhancer.enhance(contrast_boost)

                # Convert to grayscale
                im = im.convert("L")

                # Apply sharpening after resize
                im = im.filter(ImageFilter.UnsharpMask(radius=1, percent=50, threshold=3))

                # Save as optimized JPEG
                buf = io.BytesIO()
                im.save(buf, format="JPEG", quality=quality, optimize=True)
                buf.seek(0)

                # Change extension to .jpg if needed
                new_path = path.with_suffix(".jpg")
                new_path.write_bytes(buf.read())
                if new_path != path:
                    path.unlink()

                processed_count += 1
        except (IOError, OSError) as e:
            logger.warning(f"Failed to process image {path}: {e}")
            continue
        except Exception as e:
            logger.error(f"Unexpected error processing image {path}: {e}")
            continue

    return processed_count


def calculate_relative_path(from_path: Path, to_path: Path) -> str:
    """Calculate relative path from one file to another."""
    from_dir = from_path.parent
    try:
        rel = os.path.relpath(to_path, from_dir)
        return rel.replace(os.sep, "/")
    except ValueError:
        # Different drives on Windows
        return to_path.name


def inject_css_link(html_path: Path, css_path: Path) -> bool:
    """Inject a link to the sanitizer CSS in an HTML file."""
    try:
        text = html_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return False

    if X4_CSS_FILENAME in text:
        return False  # Already injected

    lower = text.lower()
    idx = lower.find("</head>")
    if idx == -1:
        return False

    rel_path = calculate_relative_path(html_path, css_path)
    rel_link = f'<link rel="stylesheet" type="text/css" href="{rel_path}"/>\n'
    new_text = text[:idx] + rel_link + text[idx:]
    html_path.write_text(new_text, encoding="utf-8")
    return True


def rebuild_epub(from_dir: Path, out_path: Path) -> None:
    """Rebuild EPUB from extracted directory."""
    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        # mimetype must be first and uncompressed
        mimetype_file = from_dir / "mimetype"
        if mimetype_file.exists():
            z.writestr(
                "mimetype",
                mimetype_file.read_bytes(),
                compress_type=zipfile.ZIP_STORED,
            )

        for root_path, dirs, files in os.walk(from_dir):
            root_p = Path(root_path)
            for name in files:
                path = root_p / name
                rel = path.relative_to(from_dir)
                if rel.as_posix() == "mimetype":
                    continue
                z.write(path, rel.as_posix())


def sanitize_epub_file(
    in_epub: Path,
    out_epub: Path,
    downscale_images: bool = True,
    remove_fonts_flag: bool = True,
    max_width: int = DEFAULT_MAX_WIDTH,
    quality: int = DEFAULT_QUALITY,
) -> dict:
    """Sanitize a single EPUB file."""
    stats = {"fonts_removed": 0, "images_processed": 0, "css_injected": 0}

    tmp = Path(tempfile.mkdtemp(prefix="x4epub_"))
    try:
        # Extract EPUB
        with zipfile.ZipFile(in_epub, "r") as z:
            z.extractall(tmp)

        # Find OPF file
        opf_path = find_opf_file(tmp)
        opf_dir = get_opf_dir(opf_path) if opf_path else tmp

        # Remove fonts if requested
        if remove_fonts_flag:
            stats["fonts_removed"] = remove_fonts(tmp, opf_path)

        # Sanitize all CSS files
        for css_path in tmp.rglob("*.css"):
            text = css_path.read_text(encoding="utf-8", errors="ignore")
            text = sanitize_css_text(text, remove_fonts=remove_fonts_flag)
            css_path.write_text(text, encoding="utf-8")

        # Place x4 CSS in the content directory (same as OPF)
        x4_css_path = opf_dir / X4_CSS_FILENAME
        x4_css_path.write_text(X4_CSS, encoding="utf-8")

        # Add to manifest
        if opf_path:
            css_rel_to_opf = X4_CSS_FILENAME
            add_css_to_manifest(opf_path, css_rel_to_opf)

        # Inject CSS link into all HTML files
        for html_path in tmp.rglob("*.xhtml"):
            if inject_css_link(html_path, x4_css_path):
                stats["css_injected"] += 1
        for html_path in tmp.rglob("*.html"):
            if inject_css_link(html_path, x4_css_path):
                stats["css_injected"] += 1

        # Process images
        if downscale_images:
            stats["images_processed"] = process_images(tmp, max_width=max_width, quality=quality)

        # Rebuild EPUB
        rebuild_epub(tmp, out_epub)

    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    return stats


def main():
    parser = argparse.ArgumentParser(description="Sanitize EPUBs for Xteink X4 / CrossPoint Reader (480x800 e-paper).")
    parser.add_argument("input_dir", type=Path, help="Input directory with EPUB files")
    parser.add_argument("output_dir", type=Path, help="Output directory for sanitized EPUB files")
    parser.add_argument(
        "--no-image-downscale",
        action="store_true",
        help="Do not modify images",
    )
    parser.add_argument(
        "--keep-fonts",
        action="store_true",
        help="Keep embedded fonts (default: remove them)",
    )
    parser.add_argument(
        "--recursive",
        action="store_true",
        help="Recurse into subdirectories",
    )
    parser.add_argument(
        "--max-width",
        type=int,
        default=DEFAULT_MAX_WIDTH,
        help=f"Maximum image width in pixels (default: {DEFAULT_MAX_WIDTH})",
    )
    parser.add_argument(
        "--quality",
        type=int,
        default=DEFAULT_QUALITY,
        help=f"JPEG quality 1-100 (default: {DEFAULT_QUALITY})",
    )
    args = parser.parse_args()

    in_dir = args.input_dir
    out_dir = args.output_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    pattern = "**/*.epub" if args.recursive else "*.epub"
    epubs = list(in_dir.glob(pattern))

    if not epubs:
        print(f"No EPUB files found in {in_dir}")
        return

    total_stats = {"fonts_removed": 0, "images_processed": 0, "css_injected": 0}

    for in_epub in epubs:
        rel = in_epub.relative_to(in_dir)
        out_path = out_dir / rel
        out_path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Sanitizing: {in_epub.name}")

        stats = sanitize_epub_file(
            in_epub,
            out_path,
            downscale_images=not args.no_image_downscale,
            remove_fonts_flag=not args.keep_fonts,
            max_width=args.max_width,
            quality=args.quality,
        )

        for key in total_stats:
            total_stats[key] += stats[key]

        print(f"  -> {out_path}")
        print(
            f"     Fonts removed: {stats['fonts_removed']}, "
            f"Images: {stats['images_processed']}, "
            f"CSS injected: {stats['css_injected']} files"
        )

    print("\nSummary:")
    print(f"  EPUBs processed: {len(epubs)}")
    print(f"  Total fonts removed: {total_stats['fonts_removed']}")
    print(f"  Total images optimized: {total_stats['images_processed']}")
    print(f"  Total HTML files with CSS: {total_stats['css_injected']}")


if __name__ == "__main__":
    main()
