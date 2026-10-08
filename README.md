<div align="center">
 <h1>📄 LiteDoc</h1>
 <p><b>PDF to Markdown, right in your browser. Your files never leave your machine.</b></p>

 [![Try it](https://img.shields.io/badge/Try_it-litedoc.xyz-6366f1?style=for-the-badge)](https://litedoc.xyz/)
 [![GitHub stars](https://img.shields.io/github/stars/0xovo/LiteDoc?style=for-the-badge&color=eab308)](https://github.com/0xovo/LiteDoc/stargazers)
 [![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](LICENSE)
 [![Twitter Follow](https://img.shields.io/badge/Follow_@0xovoo-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/0xovoo)
</div>

---

## Why this exists

I'm cheap. I use free ChatGPT and free Claude, and I wasn't about to burn my little token allowance making an AI read a 40-page lecture PDF. I also don't always have a good laptop on me, so running local AI models was out.

So I made a converter that runs in the browser. Drop a PDF in, get clean Markdown out, paste it into whatever AI you use. Nothing gets uploaded, nothing to install, costs nothing.

## Screenshots

<p align="center">
 <img alt="Main UI" src="https://github.com/user-attachments/assets/e47528eb-63cc-4af1-9baf-253e8c5ce4f0" width="100%" />
</p>

<table>
 <tr>
 <td width="50%" valign="top"><b>Editor</b><br><img alt="Editor View" src="https://github.com/user-attachments/assets/e3406f44-05d3-49ee-9b51-7ff547596ea1" width="100%" /></td>
 <td width="50%" valign="top"><b>Explorer</b><br><img alt="Explorer View" src="https://github.com/user-attachments/assets/860b196d-36b6-4462-90fa-dc8bd46ed811" width="100%" /></td>
 </tr>
</table>

## How it compares

There are great tools out there. They're just built for different people.

| | pdftotext / PyMuPDF | Marker / Docling / Markitdown | LiteDoc |
| :--- | :--- | :--- | :--- |
| **Setup** | pip install | Python env, ML models, usually a GPU | Open a web page |
| **Output** | Plain text | Markdown | Markdown |
| **Tables / lists / headings** | No | Yes | Yes |
| **Hard layouts** | Weak | Best of the bunch | Decent, see below |
| **Where your file goes** | Your machine | Your machine | Your machine (the browser) |

If you're processing thousands of PDFs on a server, Marker or Docling are probably what you want. If you just need a PDF in Markdown *right now*, that's what this is for.

## What it does

- Real Markdown: headings, tables, nested bullet lists, page markers (`## Page N`)
- Pulls out figures and charts as images and puts them above their captions
- Math gets cropped as images instead of turning into symbol soup
- OCR (Tesseract) for scanned pages and broken fonts, including Arabic and other RTL text
- Password-protected PDFs get unlocked locally
- Flags pages it's not confident about, so you know where to double check
- Exports everything as a zip (`.md` plus an images folder)

## Where it struggles

Being straight with you:

- **Weird layouts.** Two blocks side by side (like an invoice header with the address next to the invoice number) can get mixed together line by line.
- **Scanned math and tables.** OCR is Tesseract. It's fine on clean text and rough on math. A vision model will beat it there.
- **Heavily designed PDFs.** Magazines and posters with text all over the place won't come out pretty.

Got a PDF it messes up? [Open an issue](https://github.com/0xovo/LiteDoc/issues) and attach it if you can. That's how most bugs get fixed.

## Getting started

**Just use it:** [litedoc.xyz](https://litedoc.xyz)

**Offline:** grab `litedoc-vX.Y.Z.html` from the [latest release](https://github.com/0xovo/LiteDoc/releases), open it in any browser, done.

**From source:**
```bash
git clone https://github.com/0xovo/LiteDoc.git
cd LiteDoc
python scripts/build.py      # bundles src/ into dist/index.html
```
Edit stuff in `src/`, rebuild, open `dist/index.html`.

## The CLI

Same engine, for scripts and batch jobs. Heads up: it drives the engine through a headless Chromium, so it needs Playwright.

```bash
pip install litedoc-cli
playwright install chromium     # one-time

litedoc convert paper.pdf                              # markdown to stdout
litedoc convert paper.pdf -o out/ --images out/images  # save figures too
litedoc convert textbook.pdf --pages "1-5,10" -o out/  # only some pages
litedoc convert scans/*.pdf -o out/ --ocr              # batch, with OCR
litedoc convert inbox/ -o notes/ --watch --recursive   # watch a folder
litedoc convert paper.pdf --source-map -o out/         # where each block came from
litedoc benchmark                                      # how fast is your machine
```

No AI and no network by default. If you want an AI cleanup pass, point it at your own model with `--ai-url` (Ollama or anything OpenAI-compatible). It only sends the sections that look broken, not the whole doc. Full docs: [`cli/README.md`](cli/README.md).

## How it works

For the nerds:

- **PDF.js** reads the text layer and positions of everything on the page.
- Text gets grouped into lines and blocks, then sorted into reading order (a topological sort over which block sits above or beside which), so two-column papers usually read left column first.
- **Tables** come from the drawn lines in the PDF, or from text lining up in columns.
- **Math** is spotted by the density of math symbols in a line, then that region gets rendered and cropped as an image.
- **Broken fonts** (PDFs that map letters to garbage characters) get caught by a scoring check and sent to OCR or rendered as images.
- The thresholds for all of this aren't hand-guessed. There's a training pipeline in [`training/`](training/) that generates synthetic PDFs with known correct output and tunes the parser against them with Optuna. You can run it on your own edge cases.

Tests: `bash tests/run_tests.sh`

## License

MIT. Use it, fork it, ship it in your product, whatever. Just keep the copyright notice.

## Support

LiteDoc is free and staying free. If it saved you some tokens or some time, a [Ko-fi](https://ko-fi.com/0xovo) coffee keeps it going. Starring the repo helps too.

<a href="https://ko-fi.com/0xovo" target="_blank"><img src="https://storage.ko-fi.com/cdn/kofi1.png?v=3" alt="Buy Me A Coffee" height="36"></a>

[Website](https://litedoc.xyz) · [Twitter](https://x.com/0xovoo) · [Email](mailto:contact@litedoc.xyz)
