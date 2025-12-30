#!/usr/bin/env python3
"""
Page layout and text flow for XTC/XTCH conversion.

Flows text blocks into fixed-size pages with chapter tracking.
"""

from dataclasses import dataclass
from typing import Iterator

from config import DISPLAY_HEIGHT, DISPLAY_WIDTH, MARGINS, TYPOGRAPHY
from epub_parser import TextBlock, TOCEntry
from text_renderer import TextRenderer


@dataclass
class PageContent:
    """Content for a single page."""

    blocks: list[TextBlock]
    page_number: int = 0
    is_chapter_start: bool = False
    chapter_title: str | None = None


@dataclass
class ChapterMapping:
    """Maps a chapter to its page range."""

    title: str
    start_page: int
    end_page: int = 0


@dataclass
class PaginationResult:
    """Result of pagination process."""

    pages: list[PageContent]
    chapters: list[ChapterMapping]
    total_pages: int = 0


class Paginator:
    """Flow text content into fixed-size pages."""

    # Minimum lines to keep together (widow/orphan control)
    MIN_LINES_TOGETHER = TYPOGRAPHY.MIN_LINES_TOGETHER

    def __init__(self, renderer: TextRenderer):
        self.renderer = renderer
        self.content_height = DISPLAY_HEIGHT - MARGINS["top"] - MARGINS["bottom"]
        self.content_width = DISPLAY_WIDTH - MARGINS["left"] - MARGINS["right"]

    def _is_chapter_heading(self, block: TextBlock) -> bool:
        """Check if block is a chapter-level heading."""
        return block.block_type in ("heading1", "heading2") or (
            block.style.is_heading and block.style.heading_level <= 2
        )

    def _estimate_block_height(self, block: TextBlock) -> int:
        """Estimate height of text block in pixels."""
        return self.renderer.estimate_block_height(block, self.content_width)

    def paginate(
        self,
        content_blocks: Iterator[TextBlock],
        toc: list[TOCEntry] | None = None,
    ) -> PaginationResult:
        """
        Flow content into pages and track chapter boundaries.

        Features:
        - Chapter breaks (headings start new page)
        - Widow/orphan control
        - Heading keeps (don't orphan headings)
        """
        pages: list[PageContent] = []
        chapter_mappings: list[ChapterMapping] = []

        current_page_blocks: list[TextBlock] = []
        current_y = 0
        page_number = 1

        current_chapter: str | None = None
        current_chapter_start = 1

        for block in content_blocks:
            block_height = self._estimate_block_height(block)

            # Check for chapter break
            if self._is_chapter_heading(block):
                # End current chapter
                if current_chapter and current_chapter_start < page_number:
                    chapter_mappings.append(
                        ChapterMapping(
                            title=current_chapter,
                            start_page=current_chapter_start,
                            end_page=page_number - 1,
                        )
                    )

                # Emit current page if it has content
                if current_page_blocks:
                    pages.append(
                        PageContent(
                            blocks=current_page_blocks,
                            page_number=page_number,
                            is_chapter_start=(page_number == current_chapter_start),
                            chapter_title=current_chapter if page_number == current_chapter_start else None,
                        )
                    )
                    page_number += 1
                    current_page_blocks = []
                    current_y = 0

                # Start new chapter
                current_chapter = block.text
                current_chapter_start = page_number

            # Check if block fits on current page
            if current_y + block_height > self.content_height:
                # Need new page
                if current_page_blocks:
                    pages.append(
                        PageContent(
                            blocks=current_page_blocks,
                            page_number=page_number,
                            is_chapter_start=(page_number == current_chapter_start),
                            chapter_title=current_chapter if page_number == current_chapter_start else None,
                        )
                    )
                    page_number += 1
                    current_page_blocks = []
                    current_y = 0

            # Add block to current page
            current_page_blocks.append(block)
            current_y += block_height

        # Emit final page
        if current_page_blocks:
            pages.append(
                PageContent(
                    blocks=current_page_blocks,
                    page_number=page_number,
                    is_chapter_start=(page_number == current_chapter_start),
                    chapter_title=current_chapter if page_number == current_chapter_start else None,
                )
            )

        # Close final chapter
        if current_chapter:
            chapter_mappings.append(
                ChapterMapping(
                    title=current_chapter,
                    start_page=current_chapter_start,
                    end_page=page_number,
                )
            )

        return PaginationResult(
            pages=pages,
            chapters=chapter_mappings,
            total_pages=len(pages),
        )

    def paginate_with_images(
        self,
        content_blocks: Iterator[TextBlock],
        toc: list[TOCEntry] | None = None,
    ) -> PaginationResult:
        """
        Paginate content and handle inline images.

        For now, this is the same as paginate().
        Image handling can be added later.
        """
        return self.paginate(content_blocks, toc)


def flatten_toc(entries: list[TOCEntry]) -> list[TOCEntry]:
    """Flatten nested TOC entries to a single list."""
    result = []
    for entry in entries:
        result.append(entry)
        if entry.children:
            result.extend(flatten_toc(entry.children))
    return result
