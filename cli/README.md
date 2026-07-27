# litedoc-cli

The [litedoc.xyz](https://litedoc.xyz) extraction engine in your terminal: deterministic PDF → Markdown that never hallucinates, engineered for server pipelines, RAG ingestion, and local workflow automation. Includes an optional, triage-first AI repair pass you can point at **your own** model.

```bash
pip install litedoc-cli
playwright install chromium        # one-time engine download

# Basic & Batch Conversion
litedoc convert paper.pdf                                # markdown to stdout
litedoc convert scans/*.pdf -o out/ --ocr                # batch + OCR fallback
litedoc convert paper.pdf -o out/ --images out/images    # extracted figures as JPEGs

# Precision & Quality Controls (New in v3.2.0!)
litedoc convert textbook.pdf --pages "1-5,12-15" -o out/ # slice exact page ranges
litedoc convert diagrams.pdf --img-res 600 -o out/       # set custom figure DPI (75,150,300,600)
litedoc convert batch/*.pdf --auto-resolve clean         # set OCR conflict handling strategy
litedoc convert massive.pdf -o out/ --verbose            # stream live diagnostic stage events

# Live Automation Daemons (Obsidian / RAG Dropzones)
litedoc convert ~/obsidian/inbox -o ~/obsidian/notes --watch --recursive

# AI Repair (Bring Your Own Model)
litedoc convert scan.pdf --ai-url http://localhost:11434 --ai-model llama3.1:8b
```

## Features & Philosophy

* **Identical output to the web app** — it drives the same single-file engine headlessly.
* **Deterministic by default** — no AI flag, no network: nothing leaves your machine.
* **Precision Extraction & Page Slicing** — `--pages` lets you extract targeted chapters or sections without paying compute or token overhead for entire volumes.
* **Live Folder Watcher & Daemon Mode** — drop `--watch` (`-w`) and `--recursive` (`-r`) onto an ingestion directory to run an automated, zero-dependency background RAG pipeline that instantly turns newly dropped PDFs into structured Markdown.
* **Automated QA & Auto-Resolve** — configure batch conflict handling (`--auto-resolve {render,gibberish,clean,skip}`) so batch scripts run unattended without manual verification breaks.
* **Headless Performance Benchmarking** — test processing speeds on your hardware anytime:
  ```bash
  litedoc benchmark --iterations 3 --json
  ```
  Reports worker spin-up latency, burst PPT (Pages Per Toast), and sustained PPM (Pages Per Minute).
* **Persistent Global Configuration** — customize your default CLI conversion parameters so you don't have to repeat flags across invocations:
  ```bash
  litedoc config --set img_res=600 auto_resolve=render verbose=true
  litedoc config # inspect currently stored defaults (~/.config/litedoc/config.json)
  ```
* **Bring your own AI** — `--ai-url` speaks Ollama or OpenAI-compatible protocols; only sections that are provably damaged (broken sentences, ragged tables, OCR artifacts) are ever sent. `--ai` uses the hosted LiteDoc service instead (token from `LITEDOC_TOKEN`).
* **Structure, not just prose** — `--json` returns per-page layout (lines with coordinates, font sizes, reading-order blocks, OCR provenance; tables as row arrays; figures with page + bounding box), and `--images DIR` writes detected figures — cropped to include their axis labels and annotations — as JPEG files linked from the markdown.

License: AGPL-3.0. Part of the [LiteDoc](https://github.com/0xovo/LiteDoc) project.
