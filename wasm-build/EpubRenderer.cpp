// EpubRenderer.cpp — Embind wrapper for CREngine, matching the API surface
// that ../web/app.js and ../cli/converter.js already expect.
//
// This file is compiled inside the Dockerfile in this directory (em++ from
// the Emscripten SDK). Local clangd will flag <emscripten/bind.h> as missing
// — that's expected; do not "fix" by removing the include.

#include <emscripten/bind.h>
#include <emscripten/emscripten.h>
#include <emscripten/val.h>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <string>
#include <vector>

#include "lvdocview.h"
#include "lvcolordrawbuf.h"
#include "lvstreamutils.h"
#include "lvfntman.h"
#include "lvtinydom.h"
#include "lvdocviewprops.h"
#include "cssdef.h"
#include "crlog.h"
#include "crsetup.h"

bool InitFontManager(lString8 path);

using emscripten::val;

namespace {
    inline std::string utf8(const lString32& s) {
        return std::string(LCSTR(s));
    }

    // Iterative pre-order traversal. Avoids stack overflow on pathological
    // TOC trees (WASM stacks are small — malformed docs with deep nesting
    // would otherwise crash the module).
    void walkToc(LVTocItem* root, val& arr) {
        std::vector<LVTocItem*> stack;
        for (int i = root->getChildCount() - 1; i >= 0; i--) {
            stack.push_back(root->getChild(i));
        }
        while (!stack.empty()) {
            LVTocItem* item = stack.back();
            stack.pop_back();
            val entry = val::object();
            entry.set("title", utf8(item->getName()));
            entry.set("page",  item->getPage());
            entry.set("level", item->getLevel());
            arr.call<void>("push", entry);
            for (int i = item->getChildCount() - 1; i >= 0; i--) {
                stack.push_back(item->getChild(i));
            }
        }
    }

    // Return the filename component of a caller-supplied path-like string.
    // Font names come from JS callers; strip any directory separators and
    // parent-dir references so we can't write outside /tmp/.
    std::string sanitizeBasename(const std::string& name) {
        std::string base = name;
        size_t slash = base.find_last_of("/\\");
        if (slash != std::string::npos) base = base.substr(slash + 1);
        if (base.empty() || base == "." || base == "..") base = "font.ttf";
        return base;
    }
}

class EpubRenderer {
public:
    EpubRenderer(int w, int h)
        : m_w(w), m_h(h)
    {
        if (w <= 0 || h <= 0) {
            CRLog::error("EpubRenderer: non-positive dims %dx%d", w, h);
            w = w > 0 ? w : 1;
            h = h > 0 ? h : 1;
            m_w = w; m_h = h;
        }
        // Font manager must be initialized before constructing LVDocView.
        if (!fontMan) {
            InitFontManager(lString8(""));
        }
        m_view.reset(new LVDocView());
        m_buf.reset(new LVColorDrawBuf(w, h, 32));
        m_view->Resize(w, h);
        applyDefaultProps();
    }

    // Explicitly enable the engine features the vendored WASM ships with:
    // harfbuzz shaping, kerning, algorithmic hyphenation, and 120 % interline
    // spacing (the vendored binary's effective layout — without setting this
    // default, page count drifts ~20 % from the reference build because the
    // engine default is 100 %). Call before any document load.
    void applyDefaultProps() {
        CRPropRef p = m_view->propsGetCurrent();
        p->setInt (PROP_FONT_SHAPING, 2);                     // harfbuzz
        p->setBool(PROP_FONT_KERNING_ENABLED, true);
        p->setBool(PROP_EMBEDDED_STYLES, true);
        p->setBool(PROP_EMBEDDED_FONTS, true);
        p->setBool(PROP_TEXTLANG_HYPHENATION_ENABLED, true);
        // No .pattern dictionaries bundled — fall back to algorithmic.
        p->setBool(PROP_TEXTLANG_HYPH_FORCE_ALGORITHMIC, true);
        p->setString(PROP_HYPHENATION_DICT,
                     PROP_HYPHENATION_DICT_VALUE_ALGORITHM);
        // 120 % interline matches the vendored binary's effective layout.
        p->setInt(PROP_INTERLINE_SPACE, 120);
        m_view->propsApply(p);
    }

    bool loadEpubFromMemory(uintptr_t ptr, int len) {
        if (len <= 0) return false;
        // copy=true so the JS-side buffer can be freed immediately afterwards
        LVStreamRef stream = LVCreateMemoryStream(
            reinterpret_cast<void*>(ptr), len, /*createCopy=*/true);
        // Pass a .epub filename hint so format detection picks EPUB reader.
        bool ok = m_view->LoadDocument(stream, U"book.epub",
                                       /*metadataOnly=*/false);
        if (!ok) return false;
        // Force layout so getPageCount() returns the real count.
        // Pass explicit dims (default-arg 0,0 yields zero-size pages).
        m_view->Render(m_w, m_h, NULL);
        // Treat "loaded but no pages" as failure — malformed docs can pass
        // LoadDocument and yield a zero-page view, which confuses callers.
        return m_view->getPageCount() > 0;
    }

    void registerFontFromMemory(uintptr_t ptr, int len, std::string name) {
        if (!fontMan || len <= 0) return;
        // No memory-container variant of RegisterDocumentFont exists in this
        // CoolReader version. Stage the font bytes to MEMFS and register by path.
        // Sanitize to a basename so a caller-supplied "name" can't escape /tmp/.
        std::string path = "/tmp/" + sanitizeBasename(name);
        FILE* f = std::fopen(path.c_str(), "wb");
        if (!f) {
            CRLog::error("registerFontFromMemory: fopen('%s') failed",
                         path.c_str());
            return;
        }
        size_t written = std::fwrite(reinterpret_cast<void*>(ptr), 1, len, f);
        std::fclose(f);
        if (written != static_cast<size_t>(len)) {
            CRLog::error("registerFontFromMemory: short write %zu/%d for '%s'",
                         written, len, path.c_str());
            return;
        }
        fontMan->RegisterFont(lString8(path.c_str()));
        // LVDocView's m_infoFont is fetched in its ctor — but at that point
        // fontMan has zero registered fonts, so m_infoFont stays null and
        // getPageHeaderHeight() returns 0 (no header reservation). Refresh
        // it now that a real font exists, otherwise pagination differs from
        // the vendored binary by ~10 %.
        LVFontRef info = fontMan->GetFont(
            m_view->getStatusFontSize(), 700, false,
            css_ff_sans_serif, lString8(""));
        if (!info.isNull()) {
            m_view->setInfoFont(info);
            // Force the layout-recompute path: setPageHeaderInfo compares
            // old vs new getPageHeaderHeight() and calls updateLayout()
            // when the height changes (it just changed because m_infoFont
            // was null before and now exists).
            int hdrFlags = m_view->getPageHeaderInfo();
            m_view->setPageHeaderInfo(0);
            m_view->setPageHeaderInfo(hdrFlags);
        }
    }

    void setMargins(int l, int t, int r, int b) {
        CRPropRef p = m_view->propsGetCurrent();
        p->setInt(PROP_PAGE_MARGIN_LEFT,   l);
        p->setInt(PROP_PAGE_MARGIN_TOP,    t);
        p->setInt(PROP_PAGE_MARGIN_RIGHT,  r);
        p->setInt(PROP_PAGE_MARGIN_BOTTOM, b);
        m_view->propsApply(p);
    }

    void setFontSize(int px)            { m_view->setFontSize(px); }
    void setInterlineSpace(int percent) { m_view->setDefaultInterlineSpace(percent); }

    void setFontWeight(int weight) {
        CRPropRef p = m_view->propsGetCurrent();
        p->setInt(PROP_FONT_BASE_WEIGHT, weight);
        m_view->propsApply(p);
    }

    void setFontFace(std::string name) {
        // Update both the LVDocView internal default AND the canonical prop;
        // setDefaultFontFace() only updates m_defaultFontFace, leaving the
        // props record's PROP_FONT_FACE empty, which can confuse fallback.
        m_view->setDefaultFontFace(lString8(name.c_str()));
        CRPropRef p = m_view->propsGetCurrent();
        p->setString(PROP_FONT_FACE, lString8(name.c_str()));
        m_view->propsApply(p);
    }

    void setTextAlign(int /*mode*/) {
        // CoolReader's text alignment is a CSS document-level setting.
        // No direct LVDocView setter; left as no-op for now.
    }

    void setHyphenation(int mode) {
        // mode 0 = off, 2 = dictionary-based.
        CRPropRef p = m_view->propsGetCurrent();
        p->setString(PROP_HYPHENATION_DICT,
                     mode == 0 ? PROP_HYPHENATION_DICT_VALUE_NONE
                               : PROP_HYPHENATION_DICT_VALUE_ALGORITHM);
        m_view->propsApply(p);
    }

    void setHyphenationLanguage(std::string /*lang*/) {
        // Real per-language dictionaries require HyphMan::initDictionaries
        // with a directory of .pattern files. Not bundled in this build.
    }

    void resize(int w, int h) {
        if (w == m_w && h == m_h) return;
        m_w = w; m_h = h;
        m_view->Resize(w, h);
        m_buf.reset(new LVColorDrawBuf(w, h, 32));
    }

    void configureStatusBar(bool /*b1*/, bool /*b2*/, bool /*b3*/, bool /*b4*/,
                            bool /*b5*/, bool /*b6*/, bool /*b7*/, bool /*b8*/,
                            bool /*b9*/) {
        // Match the vendored binary: keep the page header reservation
        // (vendored's wrapper no-ops this) so pagination matches.
        // JS callers paint their own status bar over the framebuffer.
        // Force the header back on. Values from lvdocview.h enum:
        //   PGHDR_PAGE_NUMBER=1, PGHDR_PAGE_COUNT=2, PGHDR_AUTHOR=4,
        //   PGHDR_TITLE=8, PGHDR_CLOCK=16, PGHDR_BATTERY=32,
        //   PGHDR_CHAPTER_MARKS=64
        m_view->setPageHeaderPosition(1);  // PAGE_HEADER_POS_TOP
        m_view->setPageHeaderInfo(1 | 2 | 4 | 8 | 16 | 32);  // 0x3F
    }

    void goToPage(int n)     { m_view->goToPage(n); }
    void renderCurrentPage() { m_view->Draw(*m_buf); }

    val getFrameBuffer() {
        // Return a Uint8Array view aliasing the draw buffer's bytes (no copy).
        // Lifetime: m_buf outlives the view as long as resize()/dtor not called.
        const int rowSize = m_buf->GetRowSize();
        const int height  = m_buf->GetHeight();
        const int byteCount = rowSize * height;
        lUInt8* data = m_buf->GetScanLine(0);
        return val(emscripten::typed_memory_view(byteCount, data));
    }

    int getPageCount() { return m_view->getPageCount(); }

    val getDocumentInfo() {
        val info = val::object();
        // The original WASM exposes:  title, authors (plural), series,
        // language, pageCount. Match that schema so existing JS works.
        // EPUB metadata lives in m_doc->getProps(), not m_doc_props (the
        // latter is the user-config props container).
        auto get = [&](const char* key) -> std::string {
            CRPropRef p = m_view->getDocProps();
            if (!p.isNull()) {
                lString32 v = p->getStringDef(key);
                if (!v.empty()) return std::string(LCSTR(v));
            }
            // Fallback: read from the document's own props.
            auto doc = m_view->getDocument();
            if (doc) {
                CRPropRef dp = doc->getProps();
                if (!dp.isNull()) {
                    lString32 v = dp->getStringDef(key);
                    if (!v.empty()) return std::string(LCSTR(v));
                }
            }
            return "";
        };
        std::string authors = get(DOC_PROP_AUTHORS);
        info.set("title",     get(DOC_PROP_TITLE));
        info.set("authors",   authors);
        info.set("author",    authors); // alias for older callers
        info.set("series",    get(DOC_PROP_SERIES_NAME));
        info.set("language",  get(DOC_PROP_LANGUAGE));
        info.set("pageCount", m_view->getPageCount());
        return info;
    }

    val getToc() {
        val arr = val::array();
        if (LVTocItem* root = m_view->getToc()) {
            walkToc(root, arr);
        }
        return arr;
    }

    // Debug: list the font faces fontMan knows about.
    val debugFontFaces() {
        val arr = val::array();
        if (!fontMan) return arr;
        lString32Collection list;
        fontMan->getFaceList(list);
        for (int i = 0; i < (int)list.length(); i++) {
            arr.call<void>("push", std::string(LCSTR(list[i])));
        }
        return arr;
    }

    // Debug: dump all current props as a JS object {name: stringValue}.
    val debugProps() {
        val obj = val::object();
        CRPropRef p = m_view->propsGetCurrent();
        if (p.isNull()) return obj;
        for (int i = 0; i < p->getCount(); i++) {
            const char* name = p->getName(i);
            lString32 v = p->getValue(i);
            obj.set(std::string(name), std::string(LCSTR(v)));
        }
        // Also surface engine geometry that's not in props.
        obj.set("_pageCount",     m_view->getPageCount());
        obj.set("_fontSize",      m_view->getFontSize());
        obj.set("_visiblePages",  m_view->getVisiblePageCount());
        return obj;
    }

private:
    int m_w, m_h;
    std::unique_ptr<LVDocView> m_view;
    std::unique_ptr<LVColorDrawBuf> m_buf;
};

// Non-standard module-level helpers the JS loader expects.
extern "C" {
    EMSCRIPTEN_KEEPALIVE void* allocateMemory(size_t n) {
        void* p = std::malloc(n);
        if (!p && n != 0) {
            CRLog::error("allocateMemory: malloc(%zu) failed", n);
            std::abort();
        }
        return p;
    }
    EMSCRIPTEN_KEEPALIVE void  freeMemory(void* p)      { std::free(p); }
}

EMSCRIPTEN_BINDINGS(crengine_module) {
    emscripten::class_<EpubRenderer>("EpubRenderer")
        .constructor<int, int>()
        .function("loadEpubFromMemory",     &EpubRenderer::loadEpubFromMemory)
        .function("registerFontFromMemory", &EpubRenderer::registerFontFromMemory)
        .function("setMargins",             &EpubRenderer::setMargins)
        .function("setFontSize",            &EpubRenderer::setFontSize)
        .function("setFontWeight",          &EpubRenderer::setFontWeight)
        .function("setInterlineSpace",      &EpubRenderer::setInterlineSpace)
        .function("setFontFace",            &EpubRenderer::setFontFace)
        .function("setTextAlign",           &EpubRenderer::setTextAlign)
        .function("setHyphenation",         &EpubRenderer::setHyphenation)
        .function("setHyphenationLanguage", &EpubRenderer::setHyphenationLanguage)
        .function("resize",                 &EpubRenderer::resize)
        .function("configureStatusBar",     &EpubRenderer::configureStatusBar)
        .function("goToPage",               &EpubRenderer::goToPage)
        .function("renderCurrentPage",      &EpubRenderer::renderCurrentPage)
        .function("getFrameBuffer",         &EpubRenderer::getFrameBuffer)
        .function("getPageCount",           &EpubRenderer::getPageCount)
        .function("getDocumentInfo",        &EpubRenderer::getDocumentInfo)
        .function("getToc",                 &EpubRenderer::getToc)
        .function("debugProps",             &EpubRenderer::debugProps)
        .function("debugFontFaces",         &EpubRenderer::debugFontFaces);
}
