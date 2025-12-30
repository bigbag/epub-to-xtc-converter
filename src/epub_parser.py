#!/usr/bin/env python3
"""
EPUB content extraction for XTC/XTCH conversion.

Extracts text content, TOC, and metadata from EPUB files.
"""

import html.parser
import logging
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

from epub_utils import EPUB_NAMESPACES, find_opf_path_in_zip
from xtc_format import BookMetadata

logger = logging.getLogger(__name__)

# Alias for backward compatibility
NAMESPACES = EPUB_NAMESPACES


@dataclass
class TextStyle:
    """Text styling information."""

    font_size: int = 20
    bold: bool = False
    italic: bool = False
    is_heading: bool = False
    heading_level: int = 0
    indent: int = 0


@dataclass
class TextBlock:
    """A block of styled text."""

    text: str
    style: TextStyle
    block_type: str = "paragraph"  # paragraph, heading1-6, list_item, blockquote


@dataclass
class TOCEntry:
    """Table of contents entry."""

    title: str
    href: str
    level: int = 0
    children: list["TOCEntry"] = field(default_factory=list)


@dataclass
class EPUBContent:
    """Parsed EPUB content."""

    metadata: BookMetadata
    toc: list[TOCEntry]
    content_files: list[str]


class HTMLContentParser(html.parser.HTMLParser):
    """
    Extract text content from EPUB HTML with basic styling.

    Handles: p, h1-h6, strong/b, em/i, ul/ol/li, blockquote, br
    Ignores: script, style, complex CSS
    """

    HEADING_SIZES = {1: 32, 2: 28, 3: 24, 4: 22, 5: 20, 6: 18}
    BLOCK_TAGS = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "br"}
    IGNORED_TAGS = {"script", "style", "head", "meta", "link", "title"}

    def __init__(self):
        super().__init__()
        self.blocks: list[TextBlock] = []
        self.current_text = ""
        self.style_stack: list[TextStyle] = [TextStyle()]
        self.tag_stack: list[str] = []
        self.in_ignored = 0
        self.in_list = 0

    def current_style(self) -> TextStyle:
        return self.style_stack[-1] if self.style_stack else TextStyle()

    def push_style(self, **kwargs) -> None:
        current = self.current_style()
        new_style = TextStyle(
            font_size=kwargs.get("font_size", current.font_size),
            bold=kwargs.get("bold", current.bold),
            italic=kwargs.get("italic", current.italic),
            is_heading=kwargs.get("is_heading", current.is_heading),
            heading_level=kwargs.get("heading_level", current.heading_level),
            indent=kwargs.get("indent", current.indent),
        )
        self.style_stack.append(new_style)

    def pop_style(self) -> None:
        if len(self.style_stack) > 1:
            self.style_stack.pop()

    def emit_block(self, block_type: str = "paragraph") -> None:
        text = self.current_text.strip()
        text = re.sub(r"\s+", " ", text)  # Normalize whitespace
        if text:
            self.blocks.append(
                TextBlock(
                    text=text,
                    style=self.current_style(),
                    block_type=block_type,
                )
            )
        self.current_text = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        self.tag_stack.append(tag)

        if tag in self.IGNORED_TAGS:
            self.in_ignored += 1
            return

        if self.in_ignored:
            return

        # Handle formatting tags
        if tag in ("strong", "b"):
            self.push_style(bold=True)
        elif tag in ("em", "i"):
            self.push_style(italic=True)
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level = int(tag[1])
            self.push_style(
                font_size=self.HEADING_SIZES.get(level, 20),
                bold=True,
                is_heading=True,
                heading_level=level,
            )
        elif tag in ("ul", "ol"):
            self.in_list += 1
        elif tag == "li":
            self.push_style(indent=20 * self.in_list)
        elif tag == "blockquote":
            self.push_style(indent=20, italic=True)
        elif tag == "br":
            self.current_text += "\n"

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()

        if self.tag_stack and self.tag_stack[-1] == tag:
            self.tag_stack.pop()

        if tag in self.IGNORED_TAGS:
            self.in_ignored = max(0, self.in_ignored - 1)
            return

        if self.in_ignored:
            return

        # Emit block for block-level tags
        if tag == "p":
            self.emit_block("paragraph")
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level = int(tag[1])
            self.emit_block(f"heading{level}")
            self.pop_style()
        elif tag == "li":
            self.emit_block("list_item")
            self.pop_style()
        elif tag == "blockquote":
            self.emit_block("blockquote")
            self.pop_style()
        elif tag == "div":
            self.emit_block("paragraph")
        elif tag in ("ul", "ol"):
            self.in_list = max(0, self.in_list - 1)
        elif tag in ("strong", "b", "em", "i"):
            self.pop_style()

    def handle_data(self, data: str) -> None:
        if not self.in_ignored:
            self.current_text += data

    def get_blocks(self) -> list[TextBlock]:
        # Emit any remaining text
        if self.current_text.strip():
            self.emit_block("paragraph")
        return self.blocks


class EPUBParser:
    """Parse EPUB files and extract content."""

    def __init__(self, epub_path: Path):
        self.epub_path = epub_path
        self.zip = zipfile.ZipFile(epub_path, "r")
        self.opf_path: str | None = None
        self.opf_dir: str = ""
        self._opf_tree: ET.Element | None = None

    def close(self) -> None:
        self.zip.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def _find_opf_path(self) -> str | None:
        """Find the OPF file path via META-INF/container.xml."""
        return find_opf_path_in_zip(self.zip)

    def _get_opf_tree(self) -> ET.Element | None:
        """Get parsed OPF XML tree."""
        if self._opf_tree is not None:
            return self._opf_tree

        if self.opf_path is None:
            self.opf_path = self._find_opf_path()
            if self.opf_path:
                self.opf_dir = str(Path(self.opf_path).parent)
                if self.opf_dir == ".":
                    self.opf_dir = ""

        if self.opf_path:
            try:
                content = self.zip.read(self.opf_path)
                self._opf_tree = ET.fromstring(content)
                return self._opf_tree
            except (KeyError, ET.ParseError):
                pass
        return None

    def _resolve_href(self, href: str) -> str:
        """Resolve href relative to OPF directory."""
        if self.opf_dir:
            return f"{self.opf_dir}/{href}"
        return href

    def extract_metadata(self) -> BookMetadata:
        """Extract title and author from OPF file."""
        tree = self._get_opf_tree()
        if tree is None:
            return BookMetadata()

        metadata = tree.find("opf:metadata", NAMESPACES)
        if metadata is None:
            metadata = tree.find("metadata")

        title = ""
        author = ""

        if metadata is not None:
            # Try with namespace first
            title_elem = metadata.find("dc:title", NAMESPACES)
            if title_elem is None:
                title_elem = metadata.find("{http://purl.org/dc/elements/1.1/}title")
            if title_elem is not None and title_elem.text:
                title = title_elem.text

            creator_elem = metadata.find("dc:creator", NAMESPACES)
            if creator_elem is None:
                creator_elem = metadata.find("{http://purl.org/dc/elements/1.1/}creator")
            if creator_elem is not None and creator_elem.text:
                author = creator_elem.text

        return BookMetadata(title=title, author=author)

    def _find_ncx_path(self) -> str | None:
        """Find NCX file path from OPF manifest."""
        tree = self._get_opf_tree()
        if tree is None:
            return None

        manifest = tree.find("opf:manifest", NAMESPACES)
        if manifest is None:
            manifest = tree.find("manifest")
        if manifest is None:
            return None

        for item in manifest:
            media_type = item.get("media-type", "")
            if media_type == "application/x-dtbncx+xml":
                href = item.get("href", "")
                return self._resolve_href(href)

        return None

    def _find_nav_path(self) -> str | None:
        """Find EPUB3 NAV file path from OPF manifest."""
        tree = self._get_opf_tree()
        if tree is None:
            return None

        manifest = tree.find("opf:manifest", NAMESPACES)
        if manifest is None:
            manifest = tree.find("manifest")
        if manifest is None:
            return None

        for item in manifest:
            props = item.get("properties", "")
            if "nav" in props:
                href = item.get("href", "")
                return self._resolve_href(href)

        return None

    def _parse_ncx_navpoint(self, elem: ET.Element, level: int = 0) -> TOCEntry:
        """Parse NCX navPoint element."""
        label_elem = elem.find("ncx:navLabel/ncx:text", NAMESPACES)
        content_elem = elem.find("ncx:content", NAMESPACES)

        title = label_elem.text if label_elem is not None and label_elem.text else ""
        href = content_elem.get("src", "") if content_elem is not None else ""

        entry = TOCEntry(title=title, href=href, level=level)

        for child in elem.findall("ncx:navPoint", NAMESPACES):
            entry.children.append(self._parse_ncx_navpoint(child, level + 1))

        return entry

    def _extract_toc_ncx(self, ncx_path: str) -> list[TOCEntry]:
        """Parse EPUB2 NCX navigation document."""
        try:
            content = self.zip.read(ncx_path)
            root = ET.fromstring(content)
        except (KeyError, ET.ParseError):
            return []

        nav_map = root.find("ncx:navMap", NAMESPACES)
        if nav_map is None:
            return []

        entries = []
        for navpoint in nav_map.findall("ncx:navPoint", NAMESPACES):
            entries.append(self._parse_ncx_navpoint(navpoint))

        return entries

    def _parse_nav_ol(self, ol: ET.Element, level: int = 0) -> list[TOCEntry]:
        """Parse NAV ordered list structure."""
        entries = []

        for li in ol.findall("xhtml:li", NAMESPACES):
            a = li.find("xhtml:a", NAMESPACES)
            if a is None:
                # Try without namespace
                a = li.find("a")
            if a is None:
                continue

            title = "".join(a.itertext()).strip()
            href = a.get("href", "")

            entry = TOCEntry(title=title, href=href, level=level)

            nested_ol = li.find("xhtml:ol", NAMESPACES)
            if nested_ol is None:
                nested_ol = li.find("ol")
            if nested_ol is not None:
                entry.children = self._parse_nav_ol(nested_ol, level + 1)

            entries.append(entry)

        return entries

    def _extract_toc_nav(self, nav_path: str) -> list[TOCEntry]:
        """Parse EPUB3 NAV document."""
        try:
            content = self.zip.read(nav_path)
            root = ET.fromstring(content)
        except (KeyError, ET.ParseError):
            return []

        # Find nav with epub:type="toc"
        for nav in root.iter():
            if nav.tag.endswith("nav"):
                nav_type = nav.get("{http://www.idpf.org/2007/ops}type")
                if nav_type == "toc":
                    ol = nav.find("xhtml:ol", NAMESPACES)
                    if ol is None:
                        ol = nav.find("ol")
                    if ol is not None:
                        return self._parse_nav_ol(ol)

        return []

    def extract_toc(self) -> list[TOCEntry]:
        """Extract table of contents from NCX or NAV."""
        # Try EPUB3 NAV first
        nav_path = self._find_nav_path()
        if nav_path:
            toc = self._extract_toc_nav(nav_path)
            if toc:
                return toc

        # Fall back to EPUB2 NCX
        ncx_path = self._find_ncx_path()
        if ncx_path:
            return self._extract_toc_ncx(ncx_path)

        return []

    def get_content_order(self) -> list[str]:
        """Get ordered list of content files from spine."""
        tree = self._get_opf_tree()
        if tree is None:
            return []

        # Build id -> href mapping from manifest
        manifest = tree.find("opf:manifest", NAMESPACES)
        if manifest is None:
            manifest = tree.find("manifest")
        if manifest is None:
            return []

        id_to_href = {}
        for item in manifest:
            item_id = item.get("id", "")
            href = item.get("href", "")
            media_type = item.get("media-type", "")
            if media_type in ("application/xhtml+xml", "text/html"):
                id_to_href[item_id] = href

        # Get spine order
        spine = tree.find("opf:spine", NAMESPACES)
        if spine is None:
            spine = tree.find("spine")
        if spine is None:
            return list(id_to_href.values())

        content_files = []
        for itemref in spine:
            idref = itemref.get("idref", "")
            if idref in id_to_href:
                content_files.append(self._resolve_href(id_to_href[idref]))

        return content_files

    def _parse_html_file(self, path: str) -> list[TextBlock]:
        """Parse HTML/XHTML file and return text blocks."""
        try:
            content = self.zip.read(path)
            # Try to decode as UTF-8, fall back to latin-1
            try:
                text = content.decode("utf-8")
            except UnicodeDecodeError:
                text = content.decode("latin-1", errors="ignore")

            parser = HTMLContentParser()
            parser.feed(text)
            return parser.get_blocks()
        except KeyError:
            logger.warning(f"HTML file not found in archive: {path}")
            return []
        except Exception as e:
            logger.warning(f"Failed to parse HTML file {path}: {e}")
            return []

    def iter_content_blocks(self) -> Iterator[TextBlock]:
        """Iterate through all content as styled text blocks."""
        for content_file in self.get_content_order():
            yield from self._parse_html_file(content_file)

    def parse(self) -> EPUBContent:
        """Parse EPUB and return structured content."""
        return EPUBContent(
            metadata=self.extract_metadata(),
            toc=self.extract_toc(),
            content_files=self.get_content_order(),
        )
