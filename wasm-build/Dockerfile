# Reproducible environment for building crengine.wasm from upstream CoolReader.
#
# Usage:
#   docker build -t crengine-wasm-build .
#   docker run --rm -v "$(pwd)/out:/out" crengine-wasm-build
#   # Produces out/crengine.js + out/crengine.wasm

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl xz-utils python3 python3-pip \
    cmake make build-essential pkg-config patch \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt

# --- Emscripten SDK ----------------------------------------------------------
# Override with --build-arg EMSDK_VERSION=3.1.55 to pin. Default "latest" is
# convenient but non-reproducible — a future emsdk release could break patches.
ARG EMSDK_VERSION=latest
RUN git clone --depth 1 https://github.com/emscripten-core/emsdk \
    && cd emsdk \
    && ./emsdk install "${EMSDK_VERSION}" \
    && ./emsdk activate "${EMSDK_VERSION}"

# --- CoolReader source -------------------------------------------------------
# This revision matches the dependency versions in build.sh.
# Set --build-arg COOLREADER_REF=<sha> to test another revision.
ARG COOLREADER_REF=064723eace938389fb99f84518ce773ede38dbdf
RUN git clone https://github.com/buggins/coolreader \
    && cd coolreader \
    && git checkout "${COOLREADER_REF}"

WORKDIR /opt/coolreader

# --- Patch 1: bump cmake minimum required -----------------------------------
# Guard each sed with a grep to fail loudly if upstream drift changes the line
# pattern — otherwise the sed silently no-ops and the build breaks downstream.
RUN sed -i 's|cmake_minimum_required(VERSION 3.0)|cmake_minimum_required(VERSION 3.10)|' \
    CMakeLists.txt \
 && grep -q 'cmake_minimum_required(VERSION 3.10)' CMakeLists.txt

# --- Patch 2: fix rotted thirdparty URLs ------------------------------------
# zlib 1.3.1 moved to fossils/, only .tar.gz exists; SHA512 differs from .xz.
RUN sed -i \
    -e 's|SRCFILE="${PN}-${PV}.tar.xz"|SRCFILE="${PN}-${PV}.tar.gz"|' \
    -e 's|URL="http://www.zlib.net/${SRCFILE}"|URL="https://zlib.net/fossils/${SRCFILE}"|' \
    -e 's|SHA512=".*"|SHA512="580677aad97093829090d4b605ac81c50327e74a6c2de0b85dd2e8525553f3ddde17556ea46f8f007f89e435493c9a20bc997d1ef1c1c2c23274528e3c46b94f"|' \
    thirdparty_repo/zlib.meta.sh \
 && grep -q 'fossils/${SRCFILE}' thirdparty_repo/zlib.meta.sh \
 && grep -q 'tar.gz' thirdparty_repo/zlib.meta.sh

# zstd 1.5.0: GH releases only have .tar.gz; SHA512 already matches the .gz.
RUN sed -i 's|SRCFILE="${PN}-${PV}.tar.xz"|SRCFILE="${PN}-${PV}.tar.gz"|' \
    thirdparty_repo/zstd.meta.sh \
 && grep -q 'tar.gz' thirdparty_repo/zstd.meta.sh

# Use the FreeType release mirror.
# Keep the original checksum.
RUN sed -i 's|https://download.savannah.gnu.org/releases/|https://download-mirror.savannah.gnu.org/releases/|' \
    thirdparty_repo/freetype.meta.sh \
 && grep -q 'download-mirror.savannah.gnu.org' thirdparty_repo/freetype.meta.sh

# --- Patch 3: normalise bundled patch headers to uniform a/ b/ prefix ------
# Some bundled patches use `--- foo.orig` (no slashes, needs -p0), others use
# `--- libpng-1.6.37-orig/foo` (one slash, needs -p1). Rewrite every header to
# `--- a/foo` / `+++ b/foo` so `patch -p1` works uniformly.
COPY scripts/normalize-patches.py /opt/scripts/normalize-patches.py
RUN python3 /opt/scripts/normalize-patches.py thirdparty_repo/patches/*/*.patch

# --- Patch 4: disable freetype's optional zlib/png deps ---------------------
# freetype 2.11.0 reads FT_WITH_*, NOT FT_DISABLE_* — earlier docs were wrong.
# CoolReader forces FT_WITH_ZLIB ON / FT_WITH_PNG ON; turning them OFF makes
# freetype skip find_package(ZLIB)/find_package(PNG) and the broken pngshim.c.
RUN sed -i \
    -e 's|SET(FT_WITH_ZLIB ON CACHE BOOL .* FORCE)|SET(FT_WITH_ZLIB OFF CACHE BOOL "no external zlib" FORCE)|' \
    -e 's|SET(FT_WITH_PNG ON CACHE BOOL .* FORCE)|SET(FT_WITH_PNG OFF CACHE BOOL "no PNG bitmaps" FORCE)|' \
    CMakeLists.txt \
 && grep -q 'FT_WITH_ZLIB OFF' CMakeLists.txt \
 && grep -q 'FT_WITH_PNG OFF' CMakeLists.txt

# --- Patch 5: skip the cr3gui executable subdir ------------------------------
RUN sed -i 's|^\(\s*\)ADD_SUBDIRECTORY(cr3gui)|\1#ADD_SUBDIRECTORY(cr3gui) # disabled for WASM build|' \
    CMakeLists.txt \
 && grep -q '#ADD_SUBDIRECTORY(cr3gui)' CMakeLists.txt

# --- Patch 6: enable internal page orientation -------------------------------
# Without this, lvdocview.cpp uses m_rotateAngle which only exists when =1.
# Scope the replacement to the CRGUI_XCB block (the GUI variant we build with)
# and fail loudly if no flip occurs — upstream HEAD drift would otherwise turn
# a line-number-anchored sed into a silent no-op.
RUN sed -i '/CRGUI_XCB/,/ENDIF/ s|CR_INTERNAL_PAGE_ORIENTATION=0|CR_INTERNAL_PAGE_ORIENTATION=1|' \
    CMakeLists.txt \
 && awk '/CRGUI_XCB/,/ENDIF/' CMakeLists.txt | grep -q 'CR_INTERNAL_PAGE_ORIENTATION=1'

# --- Patch 7: relax modern-Clang warnings → errors ---------------------------
# harfbuzz 2.8.2 trips Clang 19+'s -Wcast-function-type-strict default-error;
# CoolReader sources trip -Wnon-c-typedef-for-linkage on packed structs;
# freetype 2.11.0 hits -Wdeprecated-declarations on FT_Stream APIs.
RUN sed -i '/^PROJECT(cr3)/a add_compile_options(-Wno-error -w)' \
    CMakeLists.txt \
 && grep -q 'add_compile_options(-Wno-error -w)' CMakeLists.txt

# --- Patch 8: append cross-subdir includes + USE_FONTCONFIG=0 to crengine ---
# Without these, lvtextfm.cpp can't find fribidi-config.h, lvfreetypefontman.cpp
# can't find fontconfig/fontconfig.h (default 1 in crsetup.h), etc.
RUN cat >> crengine/CMakeLists.txt <<'EOF'

# WASM build: ensure all bundled thirdparty headers (source + generated build dirs)
# are visible to crengine. Without this, cross-subdir #includes fail.
target_include_directories(crengine PRIVATE
    ${CMAKE_SOURCE_DIR}/thirdparty/zlib-1.3.1
    ${CMAKE_BINARY_DIR}/thirdparty/zlib-1.3.1
    ${CMAKE_SOURCE_DIR}/thirdparty/libpng-1.6.37
    ${CMAKE_BINARY_DIR}/thirdparty/libpng-1.6.37
    ${CMAKE_SOURCE_DIR}/thirdparty/jpeg-9d
    ${CMAKE_BINARY_DIR}/thirdparty/jpeg-9d
    ${CMAKE_SOURCE_DIR}/thirdparty/freetype-2.11.0/include
    ${CMAKE_SOURCE_DIR}/thirdparty/harfbuzz-2.8.2/src
    ${CMAKE_BINARY_DIR}/thirdparty/harfbuzz-2.8.2
    ${CMAKE_SOURCE_DIR}/thirdparty/fribidi-1.0.10/lib
    ${CMAKE_BINARY_DIR}/thirdparty/fribidi-1.0.10
    ${CMAKE_SOURCE_DIR}/thirdparty/libunibreak-4.3/src
    ${CMAKE_BINARY_DIR}/thirdparty/libunibreak-4.3
    ${CMAKE_SOURCE_DIR}/thirdparty/utf8proc-2.6.1
    ${CMAKE_BINARY_DIR}/thirdparty/utf8proc-2.6.1
    ${CMAKE_SOURCE_DIR}/thirdparty/zstd-1.5.0/lib
    ${CMAKE_BINARY_DIR}/thirdparty/zstd-1.5.0
)

# crsetup.h defaults USE_FONTCONFIG=1 if undefined; we have no fontconfig.
target_compile_definitions(crengine PRIVATE USE_FONTCONFIG=0)
EOF

# --- Deploy thirdparty source tarballs --------------------------------------
RUN bash thirdparty-deploy.sh

# --- Patch 9: fribidi include convention -------------------------------------
# Sources use #include <fribidi/fribidi.h> but headers ship in lib/ directly.
RUN ln -sf . thirdparty/fribidi-1.0.10/lib/fribidi

# --- Wrapper sources ---------------------------------------------------------
COPY patches/ /opt/patches/
COPY EpubRenderer.cpp /opt/wrapper/EpubRenderer.cpp
COPY post.js /opt/wrapper/post.js
COPY build.sh /opt/build.sh
RUN chmod +x /opt/build.sh

# Optional user-supplied patches (drop additional .patch files in patches/).
RUN if ls /opt/patches/*.patch >/dev/null 2>&1; then \
      for p in /opt/patches/*.patch; do patch -p1 < "$p"; done; \
    fi

VOLUME ["/out"]
CMD ["/opt/build.sh"]
