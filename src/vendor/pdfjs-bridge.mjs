// PDF.js 6.5.438 (legacy ESM) bridge, source mode.
// The library ships as an ES module, so it cannot be a classic script
// like the 3.11 UMD build was. This module imports it, publishes the
// familiar window.pdfjsLib global every consumer already uses, and
// points the worker at the sibling module file. scripts/build.py
// replaces this tag in the single-file build with a blob-URL variant
// of the same bridge (module workers cannot load from data URIs).
import * as pdfjsLib from "./pdf.min.mjs";

window.pdfjsLib = pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.min.mjs", import.meta.url).href;
window.__litedocPdfWorkerSrc = pdfjsLib.GlobalWorkerOptions.workerSrc;

export default pdfjsLib;
