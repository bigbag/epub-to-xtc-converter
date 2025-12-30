#!/usr/bin/env python3
"""
PIL-based text rendering for XTC/XTCH conversion.

Renders styled text blocks to grayscale images optimized for e-ink displays.
"""

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from config import (
    DEFAULT_FONT_SIZE,
    DISPLAY_HEIGHT,
    DISPLAY_WIDTH,
    LINE_HEIGHT_RATIO,
    MARGINS,
    PARAGRAPH_SPACING,
    get_heading_sizes,
)
from epub_parser import TextBlock, TextStyle


@dataclass
class FontFamily:
    """Font family with optional bold/italic variants."""

    regular: Path
    bold: Path | None = None
    italic: Path | None = None
    bold_italic: Path | None = None

    def get_path(self, bold: bool = False, italic: bool = False) -> Path:
        """Get font path for given style, with fallbacks."""
        if bold and italic:
            if self.bold_italic:
                return self.bold_italic
            elif self.bold:
                return self.bold
            elif self.italic:
                return self.italic
        elif bold:
            if self.bold:
                return self.bold
        elif italic:
            if self.italic:
                return self.italic
        return self.regular


class TextRenderer:
    """Render text blocks to PIL images."""

    def __init__(self, font_family: FontFamily, base_font_size: int = DEFAULT_FONT_SIZE):
        self.font_family = font_family
        self.base_font_size = base_font_size
        self.heading_sizes = get_heading_sizes(base_font_size)
        self._font_cache: dict[tuple[Path, int], ImageFont.FreeTypeFont] = {}

    def get_font(self, size: int, bold: bool = False, italic: bool = False) -> ImageFont.FreeTypeFont:
        """Get or create cached font for given style."""
        font_path = self.font_family.get_path(bold, italic)
        key = (font_path, size)

        if key not in self._font_cache:
            self._font_cache[key] = ImageFont.truetype(str(font_path), size)

        return self._font_cache[key]

    def get_font_for_style(self, style: TextStyle) -> ImageFont.FreeTypeFont:
        """Get font matching a TextStyle, using renderer's base font size."""
        # Use heading sizes from renderer, or base_font_size for regular text
        if style.is_heading and style.heading_level in self.heading_sizes:
            size = self.heading_sizes[style.heading_level]
        else:
            size = self.base_font_size
        return self.get_font(size, style.bold, style.italic)

    def measure_text(self, text: str, font: ImageFont.FreeTypeFont) -> tuple[int, int]:
        """Measure text width and height."""
        bbox = font.getbbox(text)
        return bbox[2] - bbox[0], bbox[3] - bbox[1]

    def wrap_text(self, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
        """
        Wrap text to fit within max_width pixels.
        Uses greedy algorithm with word boundaries.
        """
        if not text:
            return []

        words = text.split()
        if not words:
            return []

        lines = []
        current_line: list[str] = []

        for word in words:
            test_line = " ".join(current_line + [word])
            width, _ = self.measure_text(test_line, font)

            if width <= max_width:
                current_line.append(word)
            else:
                if current_line:
                    lines.append(" ".join(current_line))
                current_line = [word]

                # Handle very long words
                word_width, _ = self.measure_text(word, font)
                if word_width > max_width:
                    # Break word character by character
                    lines.pop() if lines and lines[-1] == word else None
                    chars = list(word)
                    current_chars = []
                    for char in chars:
                        test = "".join(current_chars + [char])
                        w, _ = self.measure_text(test, font)
                        if w <= max_width:
                            current_chars.append(char)
                        else:
                            if current_chars:
                                lines.append("".join(current_chars))
                            current_chars = [char]
                    current_line = ["".join(current_chars)] if current_chars else []

        if current_line:
            lines.append(" ".join(current_line))

        return lines

    def _get_font_size_for_style(self, style: TextStyle) -> int:
        """Get the actual font size for a style."""
        if style.is_heading and style.heading_level in self.heading_sizes:
            return self.heading_sizes[style.heading_level]
        return self.base_font_size

    def estimate_block_height(self, block: TextBlock, content_width: int) -> int:
        """Estimate height of a text block in pixels."""
        font = self.get_font_for_style(block.style)
        available_width = content_width - block.style.indent

        lines = self.wrap_text(block.text, font, available_width)
        font_size = self._get_font_size_for_style(block.style)
        line_height = int(font_size * LINE_HEIGHT_RATIO)

        return len(lines) * line_height + PARAGRAPH_SPACING

    def render_page(
        self,
        blocks: list[TextBlock],
        page_number: int,
        total_pages: int | None = None,
    ) -> Image.Image:
        """
        Render a page of content to a PIL Image.

        Returns grayscale ('L' mode) image of DISPLAY_WIDTH x DISPLAY_HEIGHT.
        """
        # Create white background
        image = Image.new("L", (DISPLAY_WIDTH, DISPLAY_HEIGHT), 255)
        draw = ImageDraw.Draw(image)

        content_width = DISPLAY_WIDTH - MARGINS["left"] - MARGINS["right"]
        y = MARGINS["top"]

        for block in blocks:
            font = self.get_font_for_style(block.style)
            available_width = content_width - block.style.indent

            lines = self.wrap_text(block.text, font, available_width)
            font_size = self._get_font_size_for_style(block.style)
            line_height = int(font_size * LINE_HEIGHT_RATIO)

            for line in lines:
                x = MARGINS["left"] + block.style.indent
                draw.text((x, y), line, fill=0, font=font)
                y += line_height

            y += PARAGRAPH_SPACING

        # Render page number at bottom
        self._render_page_number(draw, page_number, total_pages)

        return image

    def _render_page_number(
        self,
        draw: ImageDraw.ImageDraw,
        page_number: int,
        total_pages: int | None = None,
    ) -> None:
        """Render page number at bottom center."""
        font = self.get_font(14)

        if total_pages:
            text = f"{page_number} / {total_pages}"
        else:
            text = str(page_number)

        width, _ = self.measure_text(text, font)
        x = (DISPLAY_WIDTH - width) // 2
        y = DISPLAY_HEIGHT - MARGINS["bottom"] + 10

        draw.text((x, y), text, fill=128, font=font)

    def render_chapter_title(self, title: str, chapter_num: int) -> Image.Image:
        """Render a chapter title page."""
        image = Image.new("L", (DISPLAY_WIDTH, DISPLAY_HEIGHT), 255)
        draw = ImageDraw.Draw(image)

        content_width = DISPLAY_WIDTH - MARGINS["left"] - MARGINS["right"]

        # Chapter number
        num_font = self.get_font(18)
        num_text = f"Chapter {chapter_num}"
        num_width, _ = self.measure_text(num_text, num_font)
        num_x = (DISPLAY_WIDTH - num_width) // 2
        num_y = DISPLAY_HEIGHT // 3

        draw.text((num_x, num_y), num_text, fill=100, font=num_font)

        # Chapter title
        title_font = self.get_font(28, bold=True)
        lines = self.wrap_text(title, title_font, content_width)
        line_height = int(28 * LINE_HEIGHT_RATIO)

        title_y = num_y + 50
        for line in lines:
            line_width, _ = self.measure_text(line, title_font)
            line_x = (DISPLAY_WIDTH - line_width) // 2
            draw.text((line_x, title_y), line, fill=0, font=title_font)
            title_y += line_height

        return image
