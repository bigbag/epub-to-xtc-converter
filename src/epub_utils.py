#!/usr/bin/env python3
"""
Shared EPUB utilities for optimizer and parser.

Provides common XML namespace handling and OPF file finding functionality.
"""

import logging
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

logger = logging.getLogger(__name__)

# XML namespaces used in EPUB files
EPUB_NAMESPACES = {
    "opf": "http://www.idpf.org/2007/opf",
    "dc": "http://purl.org/dc/elements/1.1/",
    "container": "urn:oasis:names:tc:opendocument:xmlns:container",
    "ncx": "http://www.daisy.org/z3986/2005/ncx/",
    "xhtml": "http://www.w3.org/1999/xhtml",
    "epub": "http://www.idpf.org/2007/ops",
}

# Register namespaces to preserve them in output
_namespaces_registered = False


def register_namespaces() -> None:
    """Register XML namespaces for ElementTree to preserve prefixes."""
    global _namespaces_registered
    if _namespaces_registered:
        return

    for prefix, uri in EPUB_NAMESPACES.items():
        # OPF namespace is default (no prefix)
        ET.register_namespace(prefix if prefix != "opf" else "", uri)

    _namespaces_registered = True


# Auto-register on import
register_namespaces()


def find_opf_path_in_zip(epub_zip: zipfile.ZipFile) -> str | None:
    """
    Find the OPF file path within an EPUB ZIP archive.

    Looks in META-INF/container.xml first, falls back to searching for .opf files.

    Args:
        epub_zip: Open EPUB archive as ZipFile

    Returns:
        Path to OPF file within archive, or None if not found
    """
    try:
        container = epub_zip.read("META-INF/container.xml")
        tree = ET.fromstring(container)
        rootfile = tree.find(
            ".//container:rootfile[@media-type='application/oebps-package+xml']",
            EPUB_NAMESPACES,
        )
        if rootfile is not None:
            opf_path = rootfile.get("full-path")
            if opf_path:
                return opf_path
    except (KeyError, ET.ParseError) as e:
        logger.debug(f"Failed to parse container.xml: {e}")

    # Fallback: search for .opf file
    for name in epub_zip.namelist():
        if name.endswith(".opf"):
            logger.debug(f"Found OPF via fallback search: {name}")
            return name

    logger.warning("No OPF file found in EPUB archive")
    return None


def find_opf_path_in_dir(root: Path) -> Path | None:
    """
    Find the OPF file path within an extracted EPUB directory.

    Looks in META-INF/container.xml first, falls back to searching for .opf files.

    Args:
        root: Root directory of extracted EPUB

    Returns:
        Path to OPF file, or None if not found
    """
    container_path = root / "META-INF" / "container.xml"

    if container_path.exists():
        try:
            tree = ET.parse(container_path)
            rootfile = tree.find(
                ".//container:rootfile[@media-type='application/oebps-package+xml']",
                EPUB_NAMESPACES,
            )
            if rootfile is not None:
                opf_path = rootfile.get("full-path")
                if opf_path:
                    return root / opf_path
        except ET.ParseError as e:
            logger.debug(f"Failed to parse container.xml: {e}")

    # Fallback: search for .opf file
    for opf in root.rglob("*.opf"):
        logger.debug(f"Found OPF via fallback search: {opf}")
        return opf

    logger.warning(f"No OPF file found in {root}")
    return None


def get_opf_dir(opf_path: Path) -> Path:
    """Get the directory containing the OPF file (content root)."""
    return opf_path.parent
