// Bridge non-standard helpers exposed by EpubRenderer.cpp into Module.
// EpubRenderer.cpp exports `allocateMemory`/`freeMemory` (no underscore) via
// EMSCRIPTEN_KEEPALIVE; emcc routes them as `_allocateMemory`/`_freeMemory`
// on Module. The existing JS callers expect `Module.allocateMemory(n)` and
// `Module.freeMemory(p)` without the underscore.
Module.allocateMemory = function (n) {
    var p = (Module._allocateMemory || Module._malloc)(n);
    if (!p && n) throw new Error("allocateMemory failed");
    return p;
};
Module.freeMemory     = Module._freeMemory     || function (p) { return Module._free(p); };
