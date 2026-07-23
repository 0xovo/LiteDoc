"""litedoc — deterministic PDF → Markdown, with an optional AI repair pass.

    litedoc convert paper.pdf                    # markdown to stdout
    litedoc convert paper.pdf -o paper.md
    litedoc convert scans/*.pdf -o out/ --ocr --lang jpn+eng
    litedoc convert scan.pdf --ai-url http://localhost:11434 --ai-model llama3.1:8b
    litedoc convert scan.pdf --ai                # hosted service (LITEDOC_TOKEN env)
    litedoc convert paper.pdf --json             # machine-readable result envelope
"""

import argparse
import base64
import json
import os
import sys
from pathlib import Path

from . import __version__
from .engine import Engine


def _write_images(result, images_dir: Path, md_dir: Path, log) -> None:
    """Write extracted figures as JPEG files and point the markdown's
    ![...](name) references at them (relative to where the markdown lands).
    Pops the bulky data_url off each image entry either way."""
    md = result["markdown"]
    for img in result.get("images", []):
        data_url = img.pop("data_url", None)
        if images_dir is None or not data_url or "," not in data_url:
            continue
        images_dir.mkdir(parents=True, exist_ok=True)
        target = images_dir / img["name"]
        target.write_bytes(base64.b64decode(data_url.split(",", 1)[1]))
        img["path"] = str(target)
        ref = os.path.relpath(target, start=md_dir)
        md = md.replace(f"]({img['name']})", f"]({ref})")
        log(f"wrote {target}")
    result["markdown"] = md


def _write_source_map(result: dict, target: Path, log) -> None:
    """Write a <name>.source-map.json sidecar with provenance for every block."""
    sm = {
        "source_map": result.get("source_map", []),
        "low_confidence_pages": result.get("low_confidence_pages", []),
        "file": result.get("file", ""),
    }
    target.write_text(json.dumps(sm, indent=2, ensure_ascii=False), encoding="utf-8")
    log(f"wrote {target}")
    result["_source_map_written"] = str(target)


def _log_factory(quiet: bool):
    def log(msg):
        if not quiet:
            print(f"litedoc: {msg}", file=sys.stderr)
    return log


def cmd_convert(args) -> int:
    inputs = []
    for spec in args.files:
        if spec == "-":
            inputs.append(("-", None))
            continue
        matches = sorted(Path(".").glob(spec)) if any(c in spec for c in "*?[") else [Path(spec)]
        if not matches:
            print(f"litedoc: no files match {spec!r}", file=sys.stderr)
            return 2
        for p in matches:
            if not p.is_file():
                print(f"litedoc: not a file: {p}", file=sys.stderr)
                return 2
            inputs.append((str(p), p))
    if not inputs:
        print("litedoc: no input files.", file=sys.stderr)
        return 2

    out_dir = None
    out_file = None
    if args.output:
        out_path = Path(args.output)
        if len(inputs) > 1 or out_path.is_dir() or str(args.output).endswith(("/", "\\")):
            out_dir = out_path
            out_dir.mkdir(parents=True, exist_ok=True)
        else:
            out_file = out_path

    # progress goes to stderr; suppress it when piping markdown to stdout
    log = _log_factory(args.quiet)
    log(f"litedoc-cli {__version__} — engine identical to litedoc.xyz")

    engine = Engine(ocr=args.ocr, lang=args.lang, quiet=args.quiet)
    failures = 0
    results = []
    try:
        for name, path in inputs:
            pdf_bytes = sys.stdin.buffer.read() if path is None else path.read_bytes()
            display = "stdin.pdf" if path is None else path.name
            log(f"converting {display}…")
            try:
                result = engine.convert(pdf_bytes, display)
            except Exception as exc:
                print(f"litedoc: {display}: conversion failed: {exc}", file=sys.stderr)
                failures += 1
                continue

            md = result["markdown"]
            if args.ai_url:
                from .ai import repair_byo
                md = repair_byo(md, args.ai_url, args.ai_model, args.ai_kind,
                                args.ai_chunk_size, args.ai_timeout, log)
            elif args.ai:
                from .ai import repair_hosted
                md = repair_hosted(md, args.ai_timeout, log)
            result["markdown"] = md
            result["file"] = display

            if out_dir is not None:
                md_dir = out_dir
            elif out_file is not None:
                md_dir = out_file.parent
            elif len(inputs) > 1 and path:
                md_dir = path.parent
            else:
                md_dir = Path(".")
            _write_images(result, Path(args.images) if args.images else None, md_dir, log)
            md = result["markdown"]

            # ── Source-map sidecar ──
            if args.source_map and out_dir is None and out_file is not None:
                sm_path = out_file.with_suffix(".source-map.json")
                _write_source_map(result, sm_path, log)
            elif args.source_map and out_dir is not None:
                sm_path = out_dir / (Path(display).stem + ".source-map.json")
                _write_source_map(result, sm_path, log)
            elif args.source_map and len(inputs) > 1 and path:
                sm_path = path.with_suffix(".source-map.json")
                _write_source_map(result, sm_path, log)
            elif args.source_map and out_file is None:
                # stdout mode: emit sidecar to current dir
                sm_path = Path(display).with_suffix(".source-map.json")
                _write_source_map(result, sm_path, log)

            if args.json:
                results.append(result)
            elif out_dir is not None:
                target = out_dir / (Path(display).stem + ".md")
                target.write_text(md, encoding="utf-8")
                log(f"wrote {target}")
            elif out_file is not None:
                out_file.write_text(md, encoding="utf-8")
                log(f"wrote {out_file}")
            elif len(inputs) > 1:
                sibling = path.with_suffix(".md") if path else Path("stdin.md")
                sibling.write_text(md, encoding="utf-8")
                log(f"wrote {sibling}")
            else:
                sys.stdout.write(md)
                if not md.endswith("\n"):
                    sys.stdout.write("\n")
    finally:
        engine.close()

    if args.json:
        json.dump(results if len(results) != 1 else results[0], sys.stdout, indent=2)
        sys.stdout.write("\n")
    return 1 if failures else 0


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(
        prog="litedoc",
        description="Deterministic PDF → Markdown (the litedoc.xyz engine, headless).",
    )
    parser.add_argument("--version", action="version", version=f"litedoc-cli {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    conv = sub.add_parser("convert", help="Convert PDF file(s) to Markdown")
    conv.add_argument("files", nargs="+", help="PDF paths / globs, or '-' for stdin")
    conv.add_argument("-o", "--output", help="Output file, or directory for batches")
    conv.add_argument("--ocr", action="store_true", help="Enable OCR for scanned pages")
    conv.add_argument("--lang", default="auto",
                      help="OCR language (e.g. eng, jpn+eng, ara+eng; default: auto-detect)")
    conv.add_argument("--json", action="store_true",
                      help="Emit a JSON envelope (markdown + page count + structured layout + images)")
    conv.add_argument("--images", metavar="DIR",
                      help="Write extracted figures as JPEGs into DIR and link them from the markdown")
    conv.add_argument("--source-map", action="store_true",
                      help="Write a <name>.source-map.json sidecar with per-block provenance"
                           " (page, bbox, confidence) so every Markdown fragment traces to its source")
    conv.add_argument("--quiet", action="store_true", help="Suppress progress messages")

    ai = conv.add_argument_group("optional AI repair (triage-first: only damaged sections are sent)")
    ai.add_argument("--ai", action="store_true",
                    help="Use the hosted LiteDoc AI service (LITEDOC_TOKEN env)")
    ai.add_argument("--ai-url", help="Bring your own endpoint (Ollama or OpenAI-compatible)")
    ai.add_argument("--ai-model", default="llama3.1:8b", help="Model name for --ai-url")
    ai.add_argument("--ai-kind", choices=["ollama", "openai"], default="ollama",
                    help="Protocol for --ai-url (default: ollama)")
    ai.add_argument("--ai-chunk-size", type=int, default=1200,
                    help="Max chars per AI section for --ai-url")
    ai.add_argument("--ai-timeout", type=float, default=300.0, help="AI request timeout seconds")
    conv.set_defaults(func=cmd_convert)

    args = parser.parse_args(argv)
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
