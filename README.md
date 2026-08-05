<div align="center">
 <h1>📄 LiteDoc</h1>
 <p><b>A 100% Local, Browser-Based PDF to Markdown Converter.</b></p>

 [![Try it Live](https://img.shields.io/badge/🚀_Try_LiteDoc_Live-litedoc.xyz-6366f1?style=for-the-badge)](https://litedoc.xyz/)
 [![GitHub stars](https://img.shields.io/github/stars/0xovo/LiteDoc?style=for-the-badge&color=eab308)](https://github.com/0xovo/LiteDoc/stargazers)
 [![Twitter Follow](https://img.shields.io/badge/Follow_@0xovoo-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/0xovoo)

 <br />

 <i>LiteDoc is a zero-setup, client-side tool built to extract text, images, tables, and math from PDFs. Save your LLM tokens and avoid wrestling with heavy backend environments—just drop your file in the browser and get clean Markdown.</i>
</div>

---

## Project Status

LiteDoc is **actively developed.** v3.2.0 is a major release — the CLI got enterprise automation (live folder watchers, page slicing, performance benchmarking, persistent config), the GUI got source-map provenance tracking, low-confidence OCR auditing, and split view panel selectors. The core extraction engine continues to improve with better scoring and bug fixes.

The optional AI cleanup feature has been **retired**. The cloud account hosting it was suspended with no explanation and an open-ended appeal process (see `RELEASE_NOTES.md` for the full story), and it is not coming back. This doesn't affect the core app: extraction has always run 100% in your browser, and the CLI works fully offline too.

The project is open source, so if you want to keep pushing on the parser or the training pipeline yourself, everything you need is in this repo — see [Training & Heuristic Optimization](#training--heuristic-optimization) below.

---

## Screenshots

**Full Main UI with Files Loaded**
<p align="center">
 <img alt="Full Main UI" src="https://github.com/user-attachments/assets/e47528eb-63cc-4af1-9baf-253e8c5ce4f0" width="100%" />
</p>

<table>
 <tr>
 <td width="50%" valign="top">
 <b>Editor View</b><br>
 <img alt="Editor View" src="https://github.com/user-attachments/assets/e3406f44-05d3-49ee-9b51-7ff547596ea1" width="100%" />
 </td>
 <td width="50%" valign="top">
 <b>Explorer View</b><br>
 <img alt="Explorer View" src="https://github.com/user-attachments/assets/860b196d-36b6-4462-90fa-dc8bd46ed811" width="100%" />
 </td>
 </tr>
 <tr>
 <td width="50%" valign="top">
 <b>Loading Process</b><br>
 <img alt="Loading Process" src="https://github.com/user-attachments/assets/246b4a2d-0786-4996-a076-9d9f6fd8dee0" width="100%" />
 </td>
 <td width="50%" valign="top" align="center">
 <b>Settings</b><br>
 <img alt="Settings View" src="https://github.com/user-attachments/assets/88ac3a21-0620-4ebc-a3c3-ebd2eca8ce72" />
 </td>
 </tr>
</table>

---

## Why LiteDoc

There are incredible, industry-standard tools out there for PDF parsing, like **Markitdown** (Microsoft), **Docling** (IBM), and **Marker**. However, they are fundamentally built for automated backend pipelines, which introduces significant friction for average users.

| Feature | 🐍 Markitdown / Docling / Marker | 🌐 LiteDoc |
| :--- | :--- | :--- |
| **Setup Required** | `pip install`, Python environments, Docker | **Zero.** Just open a web page. |
| **Target Audience** | Backend Devs, Data Engineers, AI Pipelines | **Everyone.** Students, researchers, writers. |
| **Processing** | Local CLI or Server-side API | **100% Client-side** (WASM + JS). |
| **Privacy** | Depends on your infrastructure setup | **Absolute.** Files never leave your device. |

**LiteDoc is for people who just want their Markdown *right now*.**
No dependencies, no server uploads, no privacy concerns. It runs entirely on your local machine using your browser's resources.

*And if you ARE building a pipeline:* the same engine now ships as a proper CLI — `pip install litedoc-cli` — with globs, stdin/stdout, JSON envelopes, and an optional bring-your-own-model AI repair pass. See [the CLI section](#the-cli) below.

---

## Key Features

### Document Intelligence

| Feature | Description |
|---|---|
| **Layout Analysis** | Kahn's Topological Sort on a DAG of geometric blocks determines correct reading order across sidebars, headers, and multi-column page layouts — no horizontal text mixing. |
| **Table Extraction** | Vector line detection builds GitHub-Flavored Markdown tables with merged cell support. Extraction heuristics are tuned via Bayesian Optimization (Optuna) against synthetic layout edge-case simulations. |
| **Math Rendering** | Detects formula bounding boxes (including PUA-encoded symbols) and preserves them as high-fidelity images or KaTeX. |
| **Figure & Chart Extraction** | Vector graphics (charts, diagrams, plots) are detected from the PDF's drawing operators, cropped **with their axis labels and annotations included**, and placed above their captions in the output — instead of leaking stray label text into your prose. |
| **Gibberish Detection** | Statistical scoring identifies corrupted custom-encoded fonts and routes them to OCR fallback. |
| **Source-Map Provenance** | Per-block traceability from markdown output back to source PDF page, character offsets, and bounding box. Available in the GUI explorer and as a `--source-map` CLI sidecar for RAG pipeline auditing. |
| **Low-Confidence Auditing** | Automatic detection of pages with suspect OCR quality. GUI shows ⚠ badges with expandable per-page reasons; click to highlight affected blocks in raw and rendered views. |

### Privacy & Performance

| Feature | Description |
|---|---|
| **100% Local** | All processing runs on your CPU/GPU inside the browser. Files never leave your device. |
| **Batch Processing** | Large files split into 10-page chunks. Canvas assets released dynamically to prevent memory crashes. |
| **Local Decryption** | Password-protected PDFs unlocked client-side in the browser sandbox — keys never sent anywhere. |

### Format Support & UX

| Feature | Description |
|---|---|
| **RTL & Arabic** | Native right-to-left script support with automatic line alignment and typography routing. |
| **Smart OCR Routing** | Scans initial pages for corruption; auto-detects script direction and language, initializing Tesseract.js workers with dynamically tuned PSM modes and vertical tolerances for maximum stability. |
| **Font Fallback** | Corrupted or custom-encoded fonts intercepted with image-fallback options for readability. |
| **Mobile Responsive** | Full editor, document navigation, and settings available on any screen size. |
| **Queue Control** | Pause or skip processing tasks. "Unformat" action strips markdown styling instantly. |

### Retired: Optional AI Cleanup

LiteDoc briefly shipped an opt-in **"Clean with AI"** feature: after the local parser extracted your document, an AI pass could fix leftover typos and OCR artifacts, stitch sentences broken across lines and pages, and re-align mangled tables into proper Markdown.

**It has been retired and is no longer available.** The cloud account hosting it was suspended, and it is not being brought back.

- **The core app is unaffected** — the AI pass was the *only* feature that ever talked to a server. Everything else runs in your browser, same as always, and the CLI works fully offline.
- **Private by design** — documents were processed in memory and never written to disk, stored, or logged.
- **LiteDoc sells nothing.** The project is free and open-source, funded entirely by voluntary [Ko-fi](https://ko-fi.com/0xovo) donations.

## The CLI

The full extraction engine is also available as a command-line tool for scripts, RAG ingestion pipelines, and folder automation — identical output to the web app, because it drives the exact same engine headlessly:

```bash
pip install litedoc-cli
playwright install chromium        # one-time engine download

litedoc convert paper.pdf                                # markdown to stdout
litedoc convert paper.pdf -o out/ --images out/images    # extract figures as JPEGs
litedoc convert textbook.pdf --pages "1-5,10" -o out/    # extract targeted page ranges
litedoc convert scans/*.pdf -o out/ --img-res 600 --ocr  # batch conversion with 600 DPI figure extraction
litedoc convert batch/*.pdf --auto-resolve clean         # unattended batch with conflict handling
litedoc convert paper.pdf --source-map -o out/           # write source-map.json provenance sidecar
litedoc convert ~/obsidian/inbox -o notes/ --watch --recursive  # live folder daemon for RAG dropzones
litedoc convert massive.pdf --verbose                    # stream live diagnostic events
litedoc benchmark --iterations 3                         # headless speed tests (spin-up, burst PPT & PPM)
litedoc config --set img_res=600 auto_resolve=render     # persist custom default preferences globally
litedoc convert scan.pdf --ai-url http://localhost:11434 # triage-first repair with YOUR model
```

Deterministic by default (no AI, no network). The optional AI repair pass is **triage-first**: it detects the specific sections that are actually damaged — broken sentences, ragged tables, OCR artifacts — and sends *only those* to the model, never your whole document. Point it at your own Ollama/OpenAI-compatible endpoint with `--ai-url`, or at the hosted service with `--ai`. Full documentation: [`cli/README.md`](cli/README.md).

## Getting Started

Because LiteDoc is a purely client-side web application, you don't need to install any dependencies to run it!

**The Easiest Way:**
1. Go to the [Releases page](https://github.com/0xovo/LiteDoc/releases).
2. Download the `index.html` file from the latest release.
3. Open the downloaded `index.html` file in any modern web browser (Chrome, Edge, Firefox, Safari) and drag and drop your PDFs!

**Run from Source:**
1. Clone or download this repository.
2. Build the single-file app: `python scripts/build.py`
3. Open the generated `dist/index.html` in your browser.

### Development & Custom Builds
If you want to modify the source code:
1. Make changes inside the `src/` directory (includes modular CSS and JS).
2. Bundle your changes into a single self-contained file by running:
 ```bash
 python scripts/build.py
 ```
3. The compiled production bundle will be updated at `dist/index.html`.

### Release Workflow (Maintainers)
Releases are fully automated through a single gated controller:

```bash
python scripts/release.py --version X.Y.Z
```

It runs the complete test suite first (**any failure builds nothing**), then builds the public edition, verifies it contains no secrets or dev URLs via an automated leak scan, produces the release zip, and rebuilds the version-stamped CLI package. Only artifacts that pass every gate come out the other end. Each release ships with `RELEASE.md` — an auto-generated document with the release notes and the measured extraction benchmark for that version.

### Training & Heuristic Optimization
LiteDoc's parser is driven by a set of layout, table, and OCR heuristics (column proximity, alignment tolerances, math detection margins, and more). Those parameters are no longer hand-tuned — this repository ships the complete, open-source **Synthetic Dataset Training Pipeline** that tunes them automatically.

The pipeline procedurally generates diverse PDFs with matching ground-truth Markdown (using rendering backends like Typst, WeasyPrint, and LaTeX), degrades some of them to simulate low-quality scans, then runs continuous headless Bayesian optimization (Optuna) that scores the real parser in headless Chromium against the ground truth — including reading order, table structure, and word order.

Want to dig deeper — or train the parser on your own PDF edge cases? Everything lives in the [`training/`](training/) folder: the dataset generator, the scoring functions, the optimizer, and a live training dashboard, with step-by-step setup instructions in the [Training Pipeline README](training/README.md).

### Extracting Files
Once processing finishes, you can preview the generated Markdown directly in the built-in Ace Editor.
Click **Download Files (.zip)** to get a neatly packaged archive containing your `.md` file and an attached folder containing all extracted images, tables, and charts.

## Architecture

LiteDoc relies on a powerful stack of client-side libraries:
* **PDF.js** - Core parsing, rendering, and text-layer extraction.
* **Tesseract.js** - WebAssembly-based OCR for scanned document fallback.
* **JSZip** - Local, client-side ZIP packaging of extracted assets.
* **KaTeX** - Fast math typesetting in the Markdown previewer.
* **Ace Editor** - High-performance code editor for tweaking Markdown before export.

## How It Works: Document Layout Analysis

Unlike basic wrapper libraries that blindly extract text sequentially from top to bottom, LiteDoc utilizes advanced Document Layout Analysis (DLA) and topological graph algorithms natively in your browser. This ensures structurally perfect extractions for complex formats like multi-column scientific papers, journals, and math-heavy PDFs.

### 1. Kahn's Topological Sort (Reading Order)
After extracting text blocks, LiteDoc maps them into a Directed Acyclic Graph (DAG) using spatial constraints.
- I use **Kahn's Topological Sort** to determine the exact human reading order.
- Edges in the graph are defined by strict geometric constraints (vertical/horizontal overlap and proximity). This eliminates "column interleaving" bugs where a right column might be accidentally read before the left.

### 2. Mathematical Equation Detection
Mathematical formulas are notoriously difficult to extract because PDF engines often map math symbols to the Private Use Area (PUA) of Unicode.
- LiteDoc analyzes character densities line-by-line using an expanded Unicode math symbol set.
- When an equation block is detected ($Density_{math} > 15\%$, or shorter lines at 30%), instead of outputting corrupted text, LiteDoc geometrically calculates the bounding box of the multi-line formula.
- The region is rendered onto an offscreen web canvas and cropped into a high-fidelity image (`[IMAGE_MATH]`), preserving visual fractions and complex integrals.

### 3. Smart Gibberish Scoring
LiteDoc implements a robust Gibberish Scorer to identify heavily corrupted, custom-encoded "subset" fonts. It calculates a statistical $Suspicion Ratio$ based on illegal character blocks. When standard text fails this heuristic, LiteDoc safely isolates the text or dynamically routes the page to my WebAssembly OCR fallback (Tesseract.js) to recover the lost data.

## Contributing

Contributions, issues, and feature requests are highly welcome! Since the goal is to keep the tool accessible and server-free, any PRs should adhere to the "100% client-side" philosophy.

**A Note on Future Updates:** Up until now, bugs and algorithmic edge-cases have been tracked manually by the maintainer. Because I currently don't have anyone actively opening issues on the repository, **future updates will be rolling out at a slower pace**. If you find a bug or want a feature, *please open an issue!* It is the best way to drive the next wave of development.

## Connect

<div align="center">

| | Link |
|---|---|
| 🌐 Website | [litedoc.xyz](https://litedoc.xyz) |
| 𝕏 Twitter | [@0xovoo](https://x.com/0xovoo) |
| ☕ Ko-fi | [ko-fi.com/0xovo](https://ko-fi.com/0xovo) |
| 📦 GitHub | [github.com/0xovo/LiteDoc](https://github.com/0xovo/LiteDoc) |
| 📧 Email | [contact@litedoc.xyz](mailto:contact@litedoc.xyz) |

</div>

## Support

LiteDoc is—and always will be—100% free and open-source. I originally built this tool to help broke students stop burning their paid AI tokens just to parse their study materials.

If LiteDoc has saved you time, protected your privacy, or spared your wallet from expensive backend API costs, **please consider making a donation!** Your support is what keeps this project alive and continuously improving.

<a href="https://ko-fi.com/0xovo" target="_blank"><img src="https://storage.ko-fi.com/cdn/kofi1.png?v=3" alt="Buy Me A Coffee" height="36"></a>

---

*Built with ❤️ by 0xovo*
