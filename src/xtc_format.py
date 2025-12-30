#!/usr/bin/env python3
"""
XTG/XTH/XTC/XTCH binary format encoding for Xteink e-readers.

XTG: 1-bit monochrome page format
XTH: 2-bit (4-level) grayscale page format
XTC: Container format for multiple XTG pages
XTCH: Container format for multiple XTH pages
"""

import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from config import PAGE_TABLE_ENTRY_SIZE, TITLE_MAX_SIZE, XTC_HEADER_SIZE, XTC_MARK, XTCH_MARK, XTG_MARK, XTH_MARK

# Grayscale levels for XTH (0=white, 3=black)
GRAY_LEVELS = np.array([255, 170, 85, 0], dtype=np.uint8)


@dataclass
class BookMetadata:
    """Book metadata for XTC/XTCH container."""

    title: str = ""
    author: str = ""


@dataclass
class ChapterInfo:
    """Chapter information for XTC/XTCH container."""

    title: str
    start_page: int
    end_page: int


def encode_xtg_header(width: int, height: int, data_size: int) -> bytes:
    """
    Encode 22-byte XTG header.

    Format:
    - mark: 4 bytes (0x00475458)
    - width: 2 bytes (uint16)
    - height: 2 bytes (uint16)
    - colorMode: 1 byte (0)
    - compression: 1 byte (0)
    - dataSize: 4 bytes (uint32)
    - md5: 8 bytes (0 for now)
    """
    return struct.pack(
        "<IHHBBIQ",
        XTG_MARK,
        width,
        height,
        0,  # colorMode
        0,  # compression
        data_size,
        0,  # md5 placeholder
    )


def encode_xth_header(width: int, height: int, data_size: int) -> bytes:
    """Encode 22-byte XTH header (same as XTG but different mark)."""
    return struct.pack(
        "<IHHBBIQ",
        XTH_MARK,
        width,
        height,
        0,  # colorMode
        0,  # compression
        data_size,
        0,  # md5 placeholder
    )


def encode_xtg_page(image: Image.Image) -> bytes:
    """
    Encode PIL Image to XTG (1-bit monochrome) format.

    Pixel packing: rows top-to-bottom, pixels left-to-right
    MSB = leftmost pixel, 0 = black, 1 = white
    """
    width, height = image.size

    # Convert to 1-bit (threshold at 128)
    if image.mode != "1":
        gray = image.convert("L")
        mono = gray.point(lambda x: 255 if x >= 128 else 0, "1")
    else:
        mono = image

    # Get pixel data as numpy array
    pixels = np.array(mono, dtype=np.uint8)

    # Pack 8 pixels per byte, MSB first
    # Pad width to multiple of 8
    padded_width = ((width + 7) // 8) * 8
    if padded_width > width:
        padded = np.zeros((height, padded_width), dtype=np.uint8)
        padded[:, :width] = pixels
        pixels = padded

    # Reshape to groups of 8 and pack bits
    pixels = pixels.reshape(height, -1, 8)
    # In PIL mode "1", True=white, False=black
    # We want 1=white, 0=black, so this is correct
    packed = np.packbits(pixels, axis=2, bitorder="big")
    data = packed.tobytes()

    # Calculate data size
    data_size = ((width + 7) // 8) * height

    # Build complete page
    header = encode_xtg_header(width, height, data_size)
    return header + data[:data_size]


def quantize_to_4_levels(image: Image.Image) -> np.ndarray:
    """
    Quantize 8-bit grayscale to 4 levels using vectorized operations.

    Returns array with values 0-3:
    - 0 = white (255)
    - 1 = light gray (170)
    - 2 = dark gray (85)
    - 3 = black (0)

    Uses simple thresholding for speed. Thresholds are at midpoints between levels.
    """
    if image.mode != "L":
        image = image.convert("L")

    pixels = np.array(image, dtype=np.uint8)

    # Thresholds at midpoints: (255+170)/2=212, (170+85)/2=127, (85+0)/2=42
    # Map: 213-255->0, 128-212->1, 43-127->2, 0-42->3
    output = np.zeros_like(pixels, dtype=np.uint8)
    output[pixels <= 42] = 3  # Black
    output[(pixels > 42) & (pixels <= 127)] = 2  # Dark gray
    output[(pixels > 127) & (pixels <= 212)] = 1  # Light gray
    output[pixels > 212] = 0  # White

    return output


def encode_xth_page(image: Image.Image) -> bytes:
    """
    Encode PIL Image to XTH (2-bit grayscale) format.

    Vertical scan order with two bit planes:
    - Columns scanned right-to-left
    - 8 vertical pixels packed per byte (MSB = topmost)
    - Plane 0: LSB of each 2-bit value
    - Plane 1: MSB of each 2-bit value
    """
    width, height = image.size

    # Quantize to 4 levels
    quantized = quantize_to_4_levels(image)

    # Pad height to multiple of 8
    padded_height = ((height + 7) // 8) * 8
    if padded_height > height:
        padded = np.zeros((padded_height, width), dtype=np.uint8)
        padded[:height, :] = quantized
        quantized = padded

    # Extract bit planes (vectorized)
    bit0 = (quantized & 1).astype(np.uint8)  # LSB
    bit1 = ((quantized >> 1) & 1).astype(np.uint8)  # MSB

    # Flip columns (right-to-left scan)
    bit0 = np.fliplr(bit0)
    bit1 = np.fliplr(bit1)

    # Reshape for vertical packing: (height/8, 8, width) then transpose to (width, height/8, 8)
    bytes_per_column = padded_height // 8
    bit0 = bit0.reshape(bytes_per_column, 8, width).transpose(2, 0, 1)
    bit1 = bit1.reshape(bytes_per_column, 8, width).transpose(2, 0, 1)

    # Pack 8 bits per byte (MSB first)
    plane0 = np.packbits(bit0, axis=2, bitorder="big").flatten()
    plane1 = np.packbits(bit1, axis=2, bitorder="big").flatten()

    data = bytes(plane0) + bytes(plane1)
    data_size = len(data)

    header = encode_xth_header(width, height, data_size)
    return header + data


def write_xtc_container(
    output_path: Path,
    pages: list[bytes],
    chapters: list[ChapterInfo],
    metadata: BookMetadata,
    is_grayscale: bool = True,
) -> None:
    """
    Write complete XTC/XTCH container file.

    Container structure (matching XtcParser expectations):
    - Header (56 bytes)
    - Title string (at offset 56, null-terminated)
    - Page table (16 bytes per page)
    - Page data (XTG/XTH pages)
    """
    mark = XTCH_MARK if is_grayscale else XTC_MARK
    page_count = len(pages)

    # Prepare title (null-terminated UTF-8, max 128 bytes)
    title_bytes = metadata.title.encode("utf-8")[: TITLE_MAX_SIZE - 1] + b"\x00"
    title_bytes = title_bytes.ljust(TITLE_MAX_SIZE, b"\x00")

    # Calculate offsets
    title_offset = XTC_HEADER_SIZE  # 56
    page_table_offset = title_offset + TITLE_MAX_SIZE  # 56 + 128 = 184
    data_offset = page_table_offset + (page_count * PAGE_TABLE_ENTRY_SIZE)

    # Build page table (16 bytes per entry)
    page_table = bytearray(page_count * PAGE_TABLE_ENTRY_SIZE)
    current_data_offset = data_offset
    for i, page_data in enumerate(pages):
        page_size = len(page_data)
        # Extract width/height from XTG/XTH page header
        _, width, height = struct.unpack("<IHH", page_data[:8])
        # PageTableEntry: uint64_t offset, uint32_t size, uint16_t width, uint16_t height
        struct.pack_into(
            "<QIHH",
            page_table,
            i * PAGE_TABLE_ENTRY_SIZE,
            current_data_offset,
            page_size,
            width,
            height,
        )
        current_data_offset += page_size

    # Build header (56 bytes)
    # struct XtcHeader {
    #   uint32_t magic;            // 0x00
    #   uint16_t version;          // 0x04
    #   uint16_t pageCount;        // 0x06
    #   uint32_t flags;            // 0x08
    #   uint32_t headerSize;       // 0x0C (88 = typical value)
    #   uint32_t reserved1;        // 0x10
    #   uint32_t tocOffset;        // 0x14 (0 = unused)
    #   uint64_t pageTableOffset;  // 0x18
    #   uint64_t dataOffset;       // 0x20
    #   uint64_t reserved2;        // 0x28
    #   uint32_t titleOffset;      // 0x30
    #   uint32_t padding;          // 0x34
    # }
    header = struct.pack(
        "<IHHIIIIQQQI4x",
        mark,  # magic
        1,  # version
        page_count,  # pageCount
        0,  # flags
        88,  # headerSize (conventional value)
        0,  # reserved1
        0,  # tocOffset (unused)
        page_table_offset,  # pageTableOffset
        data_offset,  # dataOffset
        0,  # reserved2
        title_offset,  # titleOffset
    )

    # Write file
    with open(output_path, "wb") as f:
        f.write(header)
        f.write(title_bytes)
        f.write(bytes(page_table))
        for page_data in pages:
            f.write(page_data)


def read_xtc_info(path: Path) -> dict:
    """Read basic info from XTC/XTCH file (for debugging/verification)."""
    with open(path, "rb") as f:
        header = f.read(XTC_HEADER_SIZE)
        # Read title
        f.seek(XTC_HEADER_SIZE)
        title_bytes = f.read(TITLE_MAX_SIZE)
        title = title_bytes.split(b"\x00")[0].decode("utf-8", errors="ignore")

    # Parse header
    mark, version, page_count = struct.unpack("<IHH", header[:8])

    format_name = {
        XTC_MARK: "XTC",
        XTCH_MARK: "XTCH",
    }.get(mark, f"Unknown (0x{mark:08X})")

    return {
        "format": format_name,
        "version": version,
        "pages": page_count,
        "title": title,
    }
