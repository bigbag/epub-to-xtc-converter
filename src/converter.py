#!/usr/bin/env python3
"""
EPUB to XTC/XTCH converter for Xteink e-readers.

Converts EPUB files to XTC (1-bit) or XTCH (2-bit grayscale) format.
"""

import argparse
import logging
import sys
from pathlib import Path
from typing import Literal

from epub_parser import EPUBParser
from pagination import Paginator
from text_renderer import FontFamily, TextRenderer
from xtc_format import BookMetadata, ChapterInfo, encode_xtg_page, encode_xth_page, write_xtc_container

logger = logging.getLogger(__name__)

OutputFormat = Literal["xtc", "xtch"]


def convert_epub_to_xtc(
    input_path: Path,
    output_path: Path,
    font_family: FontFamily,
    output_format: OutputFormat = "xtch",
    font_size: int = 34,
) -> dict:
    """
    Convert EPUB to XTC/XTCH format.

    Args:
        input_path: Path to input EPUB file
        output_path: Path for output XTC/XTCH file
        font_family: Font family to use for text rendering
        output_format: 'xtc' for monochrome, 'xtch' for 4-level grayscale
        font_size: Base font size (28, 34, or 40) for 220 PPI display

    Returns:
        Dict with conversion statistics
    """
    stats = {"pages": 0, "chapters": 0}

    # 1. Parse EPUB
    with EPUBParser(input_path) as parser:
        epub_content = parser.parse()
        metadata = epub_content.metadata

        # 2. Initialize renderer and paginator
        renderer = TextRenderer(font_family, base_font_size=font_size)
        paginator = Paginator(renderer)

        # 3. Paginate content
        result = paginator.paginate(parser.iter_content_blocks(), epub_content.toc)

    stats["pages"] = result.total_pages
    stats["chapters"] = len(result.chapters)

    # 4. Render pages to images and encode
    rendered_pages: list[bytes] = []
    total_pages = result.total_pages

    for page in result.pages:
        # Render page to image
        image = renderer.render_page(page.blocks, page.page_number, total_pages)

        # Encode to XTG/XTH format
        if output_format == "xtch":
            encoded = encode_xth_page(image)
        else:
            encoded = encode_xtg_page(image)

        rendered_pages.append(encoded)

    # 5. Build chapter info
    chapter_infos = [
        ChapterInfo(
            title=cm.title,
            start_page=cm.start_page,
            end_page=cm.end_page,
        )
        for cm in result.chapters
    ]

    # 6. Write XTC/XTCH container
    book_metadata = BookMetadata(
        title=metadata.title,
        author=metadata.author,
    )

    write_xtc_container(
        output_path,
        pages=rendered_pages,
        chapters=chapter_infos,
        metadata=book_metadata,
        is_grayscale=(output_format == "xtch"),
    )

    return stats


def main():
    parser = argparse.ArgumentParser(
        description="Convert EPUB to XTC/XTCH format for Xteink e-readers",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s book.epub book.xtch --font fonts/Bookerly.ttf
  %(prog)s book.epub book.xtch --font fonts/Bookerly.ttf --font-size 40
  %(prog)s book.epub book.xtc --format xtc --font fonts/Bookerly.ttf
  %(prog)s ./epubs ./output -r --font fonts/Bookerly.ttf \\
      --font-bold "fonts/Bookerly Bold.ttf" \\
      --font-italic "fonts/Bookerly Italic.ttf"
""",
    )

    parser.add_argument("input", type=Path, help="Input EPUB file or directory")
    parser.add_argument("output", type=Path, help="Output XTC/XTCH file or directory")

    parser.add_argument(
        "--format",
        "-f",
        choices=["xtc", "xtch"],
        default="xtch",
        help="Output format: xtc (1-bit mono) or xtch (2-bit grayscale, default)",
    )

    # Font options
    parser.add_argument(
        "--font",
        type=Path,
        required=True,
        help="Regular font file (TTF/OTF) - REQUIRED",
    )
    parser.add_argument(
        "--font-bold",
        type=Path,
        help="Bold font variant (optional, falls back to regular)",
    )
    parser.add_argument(
        "--font-italic",
        type=Path,
        help="Italic font variant (optional, falls back to regular)",
    )
    parser.add_argument(
        "--font-bold-italic",
        type=Path,
        help="Bold-Italic font variant (optional)",
    )
    parser.add_argument(
        "--font-size",
        type=int,
        choices=[28, 34, 40],
        default=34,
        help="Base font size in pixels: 28 (~9pt), 34 (~11pt, default), 40 (~13pt) at 220 PPI",
    )

    parser.add_argument(
        "--recursive",
        "-r",
        action="store_true",
        help="Process directories recursively",
    )

    args = parser.parse_args()

    # Validate font exists
    if not args.font.exists():
        print(f"Error: Font file not found: {args.font}", file=sys.stderr)
        sys.exit(1)

    # Build font family
    font_family = FontFamily(
        regular=args.font,
        bold=args.font_bold if args.font_bold and args.font_bold.exists() else None,
        italic=args.font_italic if args.font_italic and args.font_italic.exists() else None,
        bold_italic=args.font_bold_italic if args.font_bold_italic and args.font_bold_italic.exists() else None,
    )

    # Determine input files
    if args.input.is_file():
        if not args.input.suffix.lower() == ".epub":
            print(f"Error: Input file must be an EPUB: {args.input}", file=sys.stderr)
            sys.exit(1)
        epub_files = [args.input]
        output_is_dir = not args.output.suffix
    else:
        if not args.input.is_dir():
            print(f"Error: Input path not found: {args.input}", file=sys.stderr)
            sys.exit(1)
        pattern = "**/*.epub" if args.recursive else "*.epub"
        epub_files = list(args.input.glob(pattern))
        output_is_dir = True

    if not epub_files:
        print(f"No EPUB files found in {args.input}", file=sys.stderr)
        sys.exit(1)

    # Create output directory if needed
    if output_is_dir:
        args.output.mkdir(parents=True, exist_ok=True)

    # Determine output extension
    out_ext = ".xtch" if args.format == "xtch" else ".xtc"

    # Process files
    total_stats = {"pages": 0, "chapters": 0, "files": 0}

    for epub_path in epub_files:
        if output_is_dir:
            out_name = epub_path.stem + out_ext
            if args.recursive:
                # Preserve directory structure
                rel = epub_path.relative_to(args.input)
                out_path = args.output / rel.parent / out_name
                out_path.parent.mkdir(parents=True, exist_ok=True)
            else:
                out_path = args.output / out_name
        else:
            out_path = args.output

        print(f"Converting: {epub_path.name}")

        try:
            stats = convert_epub_to_xtc(
                epub_path,
                out_path,
                font_family=font_family,
                output_format=args.format,
                font_size=args.font_size,
            )

            total_stats["pages"] += stats["pages"]
            total_stats["chapters"] += stats["chapters"]
            total_stats["files"] += 1

            print(f"  -> {out_path}")
            print(f"     Pages: {stats['pages']}, Chapters: {stats['chapters']}")

        except Exception as e:
            logger.error(f"Failed to convert {epub_path}: {e}")
            print(f"  Error: {e}", file=sys.stderr)
            continue

    # Summary
    if total_stats["files"] > 1:
        print("\nSummary:")
        print(f"  Files converted: {total_stats['files']}")
        print(f"  Total pages: {total_stats['pages']}")
        print(f"  Total chapters: {total_stats['chapters']}")


if __name__ == "__main__":
    main()
