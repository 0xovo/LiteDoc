"""Headless driver for the LiteDoc engine.

The web app IS the engine: this module loads the single-file build in headless
Chromium and drives the exact same code path the browser runs — same parser,
same tuned parameters, same OCR — so CLI output is identical to litedoc.xyz
by construction, not by porting effort.
"""

import base64
import json
import os
import sys
from pathlib import Path

_APP_CANDIDATES = (
    # explicit override, packaged copy, then repo layouts for development
    lambda: os.environ.get("LITEDOC_APP_HTML"),
    lambda: str(Path(__file__).parent / "app" / "index.html"),
    lambda: str(Path(__file__).resolve().parents[2] / "dist" / "index.html"),
)


def find_app_html() -> str:
    for candidate in _APP_CANDIDATES:
        path = candidate()
        if path and Path(path).is_file():
            return str(Path(path).resolve())
    sys.exit(
        "litedoc: engine HTML not found. Reinstall litedoc-cli, or set "
        "LITEDOC_APP_HTML to a built LiteDoc index.html."
    )


class Engine:
    """One headless browser reused across a whole batch."""

    def __init__(self, ocr: bool = False, lang: str = "auto", quiet: bool = True):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            sys.exit("litedoc: playwright missing — run: pip install playwright")
        self._ocr = ocr
        self._lang = lang
        self._quiet = quiet
        self._pw = sync_playwright().start()
        try:
            self._browser = self._pw.chromium.launch(headless=True)
        except Exception:
            self._pw.stop()
            sys.exit(
                "litedoc: Chromium is not installed for Playwright.\n"
                "Run once:  playwright install chromium"
            )
        self._page = self._browser.new_page()
        self._page.goto(f"file://{find_app_html()}", wait_until="load", timeout=60000)

    def close(self):
        try:
            self._browser.close()
        finally:
            self._pw.stop()

    def convert(self, pdf_bytes: bytes, name: str) -> dict:
        """Returns {"markdown": str, "num_pages": int, "images": [names],
                    "layout": [...], "source_map": [...], "low_confidence_pages": [...]}.
        """
        self._page.evaluate(
            """([ocr, lang]) => {
                if (window.__litedocAddons && window.__litedocAddons._settings) {
                    window.__litedocAddons._settings.ocrEnabled = ocr;
                    window.__litedocAddons._settings.ocrLang = lang;
                }
                if (typeof window.resetTool === 'function') window.resetTool(true);
            }""",
            [self._ocr, self._lang],
        )
        b64 = base64.b64encode(pdf_bytes).decode()
        result = self._page.evaluate(
            """async ([b64, filename]) => {
                const bin = atob(b64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                const file = new File([bytes], filename, { type: 'application/pdf' });
                if (typeof window.executePdfConversion === 'undefined')
                    return { error: 'engine entrypoint missing' };
                await window.executePdfConversion([file]);
                if (typeof state === 'undefined' || !state.processedData || !state.processedData.length)
                    return { error: 'no output produced' };
                const d = state.processedData[state.processedData.length - 1];
                return {
                    markdown: d.mdText || '',
                    num_pages: d.numPages || null,
                    images: (d.extractedImages || []).map(i => ({
                        name: i.name, page: i.page || null, bbox: i.bbox || null,
                        data_url: i.dataUrl || null,
                    })),
                    layout: d.layout || [],
                    source_map: d.sourceMap || [],
                    low_confidence_pages: d.lowConfidencePages || [],
                };
            }""",
            [b64, name],
        )
        if result.get("error"):
            raise RuntimeError(result["error"])
        return result
