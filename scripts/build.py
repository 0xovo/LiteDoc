#!/usr/bin/env python3
"""
build.py — Bundles src/ into a single self-contained dist/index.html
"""

import re
import sys
import base64
import hashlib
import textwrap
import urllib.request
import urllib.parse
import argparse
import time
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Config

SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent

SRC_DIR  = PROJECT_ROOT / "src"
DIST_DIR = PROJECT_ROOT / "dist"
OUT_FILE = DIST_DIR / "index.html"
CACHE_DIR = PROJECT_ROOT / ".build_cache"

# If your files exist with these names they'll be used in this order.
# Anything in src/css/ or src/js/ NOT in these lists gets appended automatically,
# so you never silently lose a file just because it's not listed here.
CSS_PREFERRED_ORDER = ["css/main.css", "css/addons.css", "css/mobile.css"]
JS_PREFERRED_ORDER  = [
    "js/utils.js", "js/state.js", "js/terminal.js", "js/ui.js",
    "js/ui-controls.js", "js/markdown-renderer.js", "js/geometry.js",
    "js/pdf-parser.js",
    "js/ocr.js", "js/file-tree.js", "js/dropzone.js", "js/reset-utils.js",
    "js/downloads.js", "js/mobile-ux.js", "js/addons.js", "js/demo.js",
    "js/litedoc-core.js", "js/benchmark.js",
    "js/main.js",  # must stay last
]

# Logging

OK   = "\033[92m✔\033[0m"
WARN = "\033[93m⚠\033[0m"
ERR  = "\033[91m✖\033[0m"
INFO = "\033[94m•\033[0m"

def log(sym, msg): print(f"  {sym}  {msg}")

# File helpers

def read(path: Path) -> str:
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf-8")
    log(OK, f"{path}  ({len(text):,} chars)")
    return text

DEV_ONLY_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}

def is_dev_only_url(url: str) -> bool:
    """
    True for URLs that only resolve on the developer's own machine (e.g. a local
    ai-addon dev server on http://localhost:8081). These must never be treated as
    a "remote asset" to fetch-and-inline — whether the build accidentally sucks
    them in depends entirely on whether that dev server happens to be running at
    build time, which is exactly the kind of silent, environment-dependent leak
    that must never end up in a published dist/index.html.
    """
    return (urllib.parse.urlparse(url).hostname or "") in DEV_ONLY_HOSTS

def fetch_url(url: str) -> str:
    CACHE_DIR.mkdir(exist_ok=True)
    key = CACHE_DIR / f"{hashlib.md5(url.encode()).hexdigest()}.txt"
    if key.exists():
        log(INFO, f"cache hit: {url}")
        return key.read_text(encoding="utf-8", errors="ignore")
    log(INFO, f"downloading: {url}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as r:
            data = r.read().decode("utf-8", errors="ignore")
        key.write_text(data, encoding="utf-8")
        return data
    except Exception as e:
        log(ERR, f"download failed {url}: {e}")
        return ""

# File discovery

def resolve_file_order(src: Path, preferred: list[str], glob: str, exclude: list[str] = None) -> list[str]:
    """
    Returns the final ordered list of files to bundle.
    - Preferred list entries that exist come first, in order.
    - Any files found on disk that aren't in the preferred list are appended,
      sorted alphabetically — so nothing gets silently dropped.
    - 'main.js' is always kept last if present.
    """
    if exclude is None: exclude = []
    
    existing_preferred = [p for p in preferred if (src / p).exists() and p not in exclude]
    preferred_set = set(existing_preferred)

    # Find everything on disk
    all_on_disk = sorted(
        str(f.relative_to(src)).replace("\\", "/")
        for f in (src / glob.split("/")[0]).glob(f"*.{glob.split('.')[-1]}")
    )

    # Filter out excluded files
    all_on_disk = [f for f in all_on_disk if f not in exclude]

    # Force main.js last
    main = "js/main.js"
    extras = [f for f in all_on_disk if f not in preferred_set and f != main]
    result = existing_preferred + extras
    if main in all_on_disk and main not in result:
        result.append(main)

    missing = [p for p in preferred if p not in existing_preferred]
    if missing:
        log(WARN, f"not found (skipped): {', '.join(missing)}")
    extras_found = [f for f in all_on_disk if f not in preferred_set and f != main]
    if extras_found:
        log(INFO, f"auto-discovered (not in list): {', '.join(extras_found)}")

    return result

# Bundlers

def safe_js(content: str) -> str:
    # </script> anywhere inside a <script> block ends it — browser doesn't care about context
    return content.replace("</script>", "<\\/script>")

def bundle_css(src: Path, files: list[str]) -> str:
    parts = []
    for rel in files:
        content = read(src / rel)
        if content:
            parts.append(f"/* {rel} */\n{content}")
    return "\n\n".join(parts)

def bundle_js(src: Path, files: list[str]) -> str:
    parts = []
    for rel in files:
        content = read(src / rel)
        if content:
            # Must escape </script> in ALL JS — local or remote — otherwise the
            # browser's HTML parser ends the <script> block mid-source when it
            # hits that exact byte sequence, dropping everything that follows.
            content = content.replace("</script>", "<\\/script>")
            banner = (
                f"/* {'═'*60}\n"
                f"   {rel}\n"
                f"   {'═'*60} */\n"
            )
            wrapped = f"{banner}// ----- {rel} -----\n;\n{content}\n;\n"
            parts.append(wrapped)
    return "\n".join(parts)

# HTML inlining

def build_ai_widget_tags(base_url: str, version: str = "") -> str:
    """External <link>/<script> tags that load the (separately hosted) AI addon widget.

    These are injected ONLY for the hosted edition (build --ai-widget <url>), never
    into the default build — the public GitHub release must stay 100% AI-free. Because
    the tags reference the addon files by absolute https URL and are appended here at
    build time (not present in src/index.html), the default build literally cannot
    contain them, and pre_publish_check.sh's 'ai-addon' pattern catches any accident.

    auth.js must load before ai-addon.js — ai-addon.js reads window.LiteDocAuth, which
    auth.js defines. Order below is load-bearing.
    """
    base = base_url.rstrip("/")
    # Cache-buster: Cloudflare serves /widget/* with a 4h edge+browser TTL, so an
    # unversioned URL means widget fixes take up to 4 hours to reach users (and
    # testers see stale CSS and file bug reports about it). A versioned query
    # string makes every newly deployed index fetch fresh assets immediately.
    # Unique per BUILD, not per release: redeploying widget files under an
    # unchanged version string would re-pin the stale copies for another TTL.
    bust = f"{version}-{int(time.time())}" if version else str(int(time.time()))
    q = f"?v={bust}"
    return (
        f'<link rel="stylesheet" href="{base}/auth.css{q}">\n'
        f'<link rel="stylesheet" href="{base}/ai-addon.css{q}">\n'
        f'<script src="{base}/auth.js{q}"></script>\n'
        f'<script src="{base}/ai-addon.js{q}"></script>\n'
    )


def inline_into_html(html: str, css_blob: str, js_blob: str, version: str, ai_widget: str = "") -> str:
    # Strip local <link> tags
    local_link = re.compile(
        r'<link\b[^>]*rel=["\']stylesheet["\'][^>]*href=["\'](?!https?://)([^"\']+)["\'][^>]*/?>',
        re.IGNORECASE)
    n_links = [0]
    def drop_link(m): n_links[0] += 1; return ""
    html = local_link.sub(drop_link, html)

    # Fetch + inline remote <link> tags
    remote_link = re.compile(
        r'<link\b[^>]*rel=["\']stylesheet["\'][^>]*href=["\'](https?://[^"\']+)["\'][^>]*/?>',
        re.IGNORECASE)
    remote_css = []
    n_dev_links_dropped = [0]
    def fetch_link(m):
        url = m.group(1)
        if is_dev_only_url(url):
            n_dev_links_dropped[0] += 1
            log(WARN, f"dropped dev-only stylesheet (never inlined into dist): {url}")
            return ""
        c = fetch_url(url)
        if c: remote_css.append(f"/* {url} */\n{c}")
        return ""
    html = remote_link.sub(fetch_link, html)

    full_css = "\n\n".join(remote_css) + ("\n\n" if remote_css else "") + css_blob
    style_tag = f"\n<style>\n{full_css}\n</style>\n"
    html = html.replace("</head>", style_tag + "</head>", 1) if "</head>" in html else style_tag + html
    dropped_note = f" (dropped {n_dev_links_dropped[0]} dev-only link(s))" if n_dev_links_dropped[0] else ""
    log(INFO, f"inlined {n_links[0]} local link(s) + {len(remote_css)} remote stylesheet(s){dropped_note}")

    # Inline vendor/<lib>.js IN PLACE, preserving source order.
    #
    # These used to be left as <script src="vendor/..."> tags while nothing copied
    # vendor/ into dist/, so the shipped "single self-contained file" 404'd on every
    # library — most visibly tailwindcss.js, which meant no CSS at all and a page
    # that renders as unstyled scattered text.
    #
    # Substituted in place rather than appended to js_blob because order is
    # load-bearing: pdfjsLib/JSZip must exist before the app scripts at </body> run.
    # pdf.worker.min.js is deliberately NOT handled here — it is never a <script>
    # tag; it is fetched at runtime as a Worker and is inlined as a data URI further
    # down.
    vendor_script = re.compile(
        r'<script\b[^>]*src=["\'](vendor/[^"\']+)["\'][^>]*>\s*</script>',
        re.IGNORECASE)
    n_vendor = [0]
    vendor_missing = []
    def inline_vendor(m):
        rel = m.group(1)
        p = SRC_DIR / rel
        if not p.exists():
            vendor_missing.append(rel)
            return m.group(0)
        code = p.read_text(encoding="utf-8", errors="replace").replace("</script>", "<\\/script>")
        n_vendor[0] += 1
        return f"<script>\n/* {rel} */\n{code}\n</script>"
    html = vendor_script.sub(inline_vendor, html)
    if vendor_missing:
        log(ERR, f"vendor file(s) missing, still referenced externally: {', '.join(vendor_missing)}")
    log(INFO, f"inlined {n_vendor[0]} vendor script(s)")

    local_script = re.compile(
        r'<script\b[^>]*src=["\'](?!https?://|vendor/)([^"\']+)["\'][^>]*>\s*</script>',
        re.IGNORECASE)
    n_scripts = [0]
    def drop_script(m): n_scripts[0] += 1; return ""
    html = local_script.sub(drop_script, html)

    # Fetch + inline remote <script src> tags
    remote_script = re.compile(
        r'<script\b[^>]*src=["\'](https?://[^"\']+)["\'][^>]*>\s*</script>',
        re.IGNORECASE)
    remote_js = []
    n_dev_scripts_dropped = [0]
    def fetch_remote_script(m):
        url = m.group(1)
        if is_dev_only_url(url):
            n_dev_scripts_dropped[0] += 1
            log(WARN, f"dropped dev-only script (never inlined into dist): {url}")
            return ""
        content = fetch_url(url)
        content = content.replace("</script>", "<\\/script>")
        remote_js.append(f"// {url}\n;\n{content}\n;\n")
        return ""
    html = remote_script.sub(fetch_remote_script, html)

    full_js = "\n\n".join(remote_js) + ("\n\n" if remote_js else "") + js_blob
    script_tag = f"\n<script>\n{full_js}\n</script>\n"
    html = html.replace("</body>", script_tag + "</body>", 1) if "</body>" in html else html + "\n" + script_tag
    dropped_note = f" (dropped {n_dev_scripts_dropped[0]} dev-only script(s))" if n_dev_scripts_dropped[0] else ""
    log(INFO, f"inlined {n_scripts[0]} local script(s) + {len(remote_js)} remote script(s){dropped_note}")

    # Hosted edition only: append external AI-widget tags just before </body>, after
    # the inlined app scripts (so the app DOM the widget injects into already exists).
    if ai_widget:
        widget_tags = "\n" + build_ai_widget_tags(ai_widget, version)
        html = html.replace("</body>", widget_tags + "</body>", 1) if "</body>" in html else html + "\n" + widget_tags
        log(INFO, f"injected hosted AI-widget tags pointing at {ai_widget}")

    # Stamp version into HTML
    if version:
        html = re.sub(r'<title>(.*?)</title>', f'<title>\\1 v{version}</title>', html, flags=re.IGNORECASE)
        html = re.sub(r'Version \d+\.\d+\.\d+', f'Version {version}', html)

    return html

# Main

def build():
    parser = argparse.ArgumentParser(description="Bundle LiteDoc")
    parser.add_argument("--version", help="Version to stamp into output (e.g. 3.0.0)", default="")
    parser.add_argument(
        "--ai-widget", default="", metavar="BASE_URL",
        help="Hosted edition ONLY: inject the external AI-addon widget tags pointing at this "
             "base URL (e.g. https://api.litedoc.xyz/widget). Omit for the public GitHub "
             "release build, which must stay AI-free.",
    )
    args = parser.parse_args()

    version = args.version
    ai_widget = args.ai_widget

    print("\n╔══════════════════════════════════════╗")
    print(  "║        build.py  —  bundler          ║")
    print(  "╚══════════════════════════════════════╝\n")

    if not SRC_DIR.exists():
        log(ERR, "src/ not found — run from project root"); sys.exit(1)

    DIST_DIR.mkdir(parents=True, exist_ok=True)

    # Discover files
    print("── Discovering files ────────────────────")
    css_files = resolve_file_order(SRC_DIR, CSS_PREFERRED_ORDER, "css/*.css")
    js_files  = resolve_file_order(SRC_DIR, JS_PREFERRED_ORDER,  "js/*.js")
    print(f"  CSS files ({len(css_files)}): {', '.join(css_files) or 'none'}")
    print(f"  JS files  ({len(js_files)}):  {', '.join(js_files) or 'none'}")
    print()

    if not css_files and not js_files:
        log(ERR, "No CSS or JS files found in src/css/ or src/js/ — nothing to bundle")
        sys.exit(1)

    # Bundle CSS
    print("── CSS ──────────────────────────────────")
    css_blob = bundle_css(SRC_DIR, css_files)
    print()

    # Bundle JS
    print("👉 JavaScript (Rollup Bundling) 👈")
    import subprocess
    # rollup_res = subprocess.run(["npx", "-y", "rollup", "-c"], capture_output=True, text=True)
    # if rollup_res.returncode != 0:
    #     log(ERR, f"Rollup failed:\n{rollup_res.stderr}")
    #     sys.exit(1)
    # else:
    #     log(OK, "Rollup successfully bundled src/core into src/js/litedoc-core.js")
        
    js_blob = bundle_js(SRC_DIR, js_files)
    
    if version:
        js_blob = f'window.LITEDOC_VERSION = "{version}";\n\n' + js_blob
        
    print()

    # Heavy CDN assets
    print("── CDN assets ───────────────────────────")

    # PDF.js worker — replace every workerSrc reference with an inline data URI.
    #
    # The worker is loaded as a Worker at runtime, not via a <script> tag, so it
    # can't be inlined like the other vendor libs. main.js sets:
    #     pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'
    # and explicitly expects the build to rewrite that to a data: URI (it checks for
    # a data:/http: prefix and skips its own detection when it finds one).
    #
    # The old regex only matched `https?://...pdf.worker...js`. The source uses a
    # RELATIVE path, so it never matched: the substitution silently did nothing, the
    # warning went unread, and the shipped build asked for a vendor/ file that isn't
    # there. Match both forms now.
    #
    # Prefer the local vendored copy over the CDN so the build is reproducible and
    # matches the pdf.min.js actually being shipped — a version skew between library
    # and worker breaks PDF parsing in confusing ways.
    local_worker = SRC_DIR / "vendor" / "pdf.worker.min.js"
    if local_worker.exists():
        pdf_worker_code = local_worker.read_text(encoding="utf-8", errors="replace")
        worker_origin = str(local_worker.relative_to(SRC_DIR.parent))
    else:
        worker_origin = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
        pdf_worker_code = fetch_url(worker_origin)

    if pdf_worker_code:
        b64 = base64.b64encode(pdf_worker_code.encode()).decode()
        data_uri = f"data:application/javascript;base64,{b64}"
        # Bind the URI to one global and point every reference at it. Substituting the
        # literal inline instead would embed ~1.5MB of base64 once per reference —
        # there are 6, which alone bloated the bundle from ~3.5MB to 10.6MB.
        js_blob, n = re.subn(
            r'["\'](?:https?://[^\s\'"]+|(?:\./)?(?:vendor|js)/)pdf\.worker[^\s\'"]*\.js["\']',
            "window.__litedocPdfWorkerSrc",
            js_blob,
        )
        if n:
            js_blob = (
                f'window.__litedocPdfWorkerSrc = "{data_uri}";\n'
                + js_blob
            )
            log(OK, f"pdf.worker: inlined once as data URI from {worker_origin} "
                    f"({n} reference(s) repointed)")
        else:
            log(ERR, "pdf.worker: NO references patched — the worker will 404 at runtime. "
                     "Check how workerSrc is set in src/js/.")

    # Tesseract — just prepend the library, let it fetch worker/core from CDN
    # to avoid "NetworkError: Failed to execute 'importScripts' on 'WorkerGlobalScope'"
    # which happens when a data URI worker tries to load relative WASM scripts.
    tess_lib = safe_js(fetch_url("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"))
    if tess_lib:
        js_blob = tess_lib + "\n\n" + js_blob
        log(OK, "Tesseract library inlined (worker/core will fetch from CDN)")
    else:
        log(WARN, "Tesseract download failed — OCR will need network access for the library too")

    print()

    # HTML
    print("── HTML ─────────────────────────────────")
    html = read(SRC_DIR / "index.html")
    if not html:
        log(ERR, "src/index.html missing"); sys.exit(1)
    print()

    # Inlining
    print("── Inlining ─────────────────────────────")
    output = inline_into_html(html, css_blob, js_blob, version, ai_widget=ai_widget)
    print()

    # Write
    OUT_FILE.write_text(output, encoding="utf-8")
    kb = OUT_FILE.stat().st_size / 1024
    print("── Done ─────────────────────────────────")
    log(OK, f"output: {OUT_FILE.name}")
    log(OK, f"size:   {kb:,.1f} KB")
    
    # PWA Support
    manifest_src = SRC_DIR / "manifest.json"
    sw_src = SRC_DIR / "sw.js"
    if manifest_src.exists():
        (DIST_DIR / "manifest.json").write_text(manifest_src.read_text(encoding="utf-8"), encoding="utf-8")
        log(OK, "copied: manifest.json")
    if sw_src.exists():
        (DIST_DIR / "sw.js").write_text(sw_src.read_text(encoding="utf-8"), encoding="utf-8")
        log(OK, "copied: sw.js")

    print("\n  Open dist/index.html in your browser — no server needed.\n")


if __name__ == "__main__":
    build()