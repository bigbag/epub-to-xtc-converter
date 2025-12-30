#!/usr/bin/env python3
"""
Centralized configuration for epub-optimizer-xteink.

Contains all constants for display specifications, typography, format markers,
and optimizer defaults. Single source of truth for device and format constants.
"""

from dataclasses import dataclass

# =============================================================================
# Xteink X4 Display Specifications
# =============================================================================


@dataclass(frozen=True)
class XteinkX4Display:
    """Xteink X4 e-reader display specifications."""

    WIDTH: int = 480
    HEIGHT: int = 800
    PPI: int = 220


DISPLAY = XteinkX4Display()

# Convenience aliases
DISPLAY_WIDTH = DISPLAY.WIDTH
DISPLAY_HEIGHT = DISPLAY.HEIGHT


# =============================================================================
# Typography Settings
# =============================================================================


@dataclass(frozen=True)
class TypographyConfig:
    """Typography settings for text rendering."""

    # At 220 PPI: 1pt ~ 3px, so 11pt ~ 34px
    DEFAULT_FONT_SIZE: int = 34
    LINE_HEIGHT_RATIO: float = 1.4
    PARAGRAPH_SPACING: int = 16
    MIN_LINES_TOGETHER: int = 2  # Widow/orphan control


TYPOGRAPHY = TypographyConfig()

# Convenience aliases
DEFAULT_FONT_SIZE = TYPOGRAPHY.DEFAULT_FONT_SIZE
LINE_HEIGHT_RATIO = TYPOGRAPHY.LINE_HEIGHT_RATIO
PARAGRAPH_SPACING = TYPOGRAPHY.PARAGRAPH_SPACING


# Heading size multipliers relative to base font size
HEADING_SIZE_MULTIPLIERS = {
    1: 1.8,  # H1: 180%
    2: 1.5,  # H2: 150%
    3: 1.3,  # H3: 130%
    4: 1.15,  # H4: 115%
    5: 1.0,  # H5: 100%
    6: 0.9,  # H6: 90%
}


def get_heading_sizes(base_size: int) -> dict[int, int]:
    """Calculate heading sizes relative to base font size."""
    return {level: int(base_size * mult) for level, mult in HEADING_SIZE_MULTIPLIERS.items()}


# =============================================================================
# Margins
# =============================================================================


@dataclass(frozen=True)
class MarginsConfig:
    """Page margin settings."""

    TOP: int = 20
    BOTTOM: int = 40  # Extra space for page number
    LEFT: int = 16
    RIGHT: int = 16


MARGINS_CONFIG = MarginsConfig()

# Dict format for backward compatibility
MARGINS = {
    "top": MARGINS_CONFIG.TOP,
    "bottom": MARGINS_CONFIG.BOTTOM,
    "left": MARGINS_CONFIG.LEFT,
    "right": MARGINS_CONFIG.RIGHT,
}


# =============================================================================
# XTC/XTCH Binary Format Constants
# =============================================================================


@dataclass(frozen=True)
class XTCFormatConstants:
    """Binary format markers and sizes for XTC/XTCH containers."""

    # Format markers (little-endian)
    XTG_MARK: int = 0x00475458  # "XTG\0"
    XTH_MARK: int = 0x00485458  # "XTH\0"
    XTC_MARK: int = 0x00435458  # "XTC\0"
    XTCH_MARK: int = 0x48435458  # "XTCH"

    # Header sizes
    XTG_HEADER_SIZE: int = 22
    XTC_HEADER_SIZE: int = 56
    PAGE_TABLE_ENTRY_SIZE: int = 16
    TITLE_MAX_SIZE: int = 128


XTC_FORMAT = XTCFormatConstants()

# Convenience aliases for xtc_format.py
XTG_MARK = XTC_FORMAT.XTG_MARK
XTH_MARK = XTC_FORMAT.XTH_MARK
XTC_MARK = XTC_FORMAT.XTC_MARK
XTCH_MARK = XTC_FORMAT.XTCH_MARK
XTG_HEADER_SIZE = XTC_FORMAT.XTG_HEADER_SIZE
XTC_HEADER_SIZE = XTC_FORMAT.XTC_HEADER_SIZE
PAGE_TABLE_ENTRY_SIZE = XTC_FORMAT.PAGE_TABLE_ENTRY_SIZE
TITLE_MAX_SIZE = XTC_FORMAT.TITLE_MAX_SIZE


# =============================================================================
# Optimizer Defaults
# =============================================================================


@dataclass(frozen=True)
class OptimizerDefaults:
    """Default settings for EPUB optimizer."""

    MAX_WIDTH: int = 480
    QUALITY: int = 75
    CONTRAST_BOOST: float = 1.2


OPTIMIZER = OptimizerDefaults()

# Convenience aliases
DEFAULT_MAX_WIDTH = OPTIMIZER.MAX_WIDTH
DEFAULT_QUALITY = OPTIMIZER.QUALITY
DEFAULT_CONTRAST_BOOST = OPTIMIZER.CONTRAST_BOOST

# Optimized CSS for e-paper displays
X4_CSS = """html, body {
    margin: 0;
    padding: 0;
}
body {
    font-family: serif;
    font-size: 0.95em;
    line-height: 1.4;
    text-align: left;
}
p {
    margin: 0 0 0.6em 0;
    widows: 2;
    orphans: 2;
}
h1, h2, h3, h4, h5, h6 {
    margin: 0.8em 0 0.4em 0;
    font-weight: bold;
}
img {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 0.4em auto;
}
div, p, img, figure {
    float: none !important;
    position: static !important;
    column-count: auto !important;
}
ul, ol {
    margin: 0 0 0.6em 1.2em;
    padding: 0;
}
"""

X4_CSS_FILENAME = "x4-sanitizer.css"
