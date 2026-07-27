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
import time
from pathlib import Path

from . import __version__
from .engine import Engine


def parse_page_range(range_str: str) -> set[int]:
    """Parse a page range string like '1-3,5,8-10' into a set of integers."""
    pages = set()
    if not range_str:
        return pages
    for part in range_str.split(','):
        part = part.strip()
        if '-' in part:
            start, end = part.split('-', 1)
            pages.update(range(int(start), int(end) + 1))
        else:
            pages.add(int(part))
    return pages


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

def parse_page_ranges(range_str: str) -> set:
    if not range_str:
        return set()
    pages = set()
    for part in range_str.split(","):
        part = part.strip()
        if "-" in part:
            start, end = part.split("-", 1)
            pages.update(range(int(start), int(end) + 1))
        elif part:
            pages.add(int(part))
    return pages


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


def _get_config_path() -> Path:
    config_dir = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "litedoc"
    config_file = config_dir / "config.json"
    if not config_file.exists():
        fallback = Path.home() / ".litedoc.json"
        if fallback.exists():
            return fallback
    return config_file


def _load_config() -> dict:
    path = _get_config_path()
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_config(config: dict) -> None:
    path = _get_config_path()
    if path == Path.home() / ".litedoc.json":
        target = path
    else:
        target = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "litedoc" / "config.json"
        target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"litedoc: configuration saved to {target}", file=sys.stderr)


def _should_animate(args) -> bool:
    if getattr(args, "no_animate", False):
        return False
    if getattr(args, "animate", False):
        return True
    if getattr(args, "quiet", False) or getattr(args, "json", False):
        return False
    if any(os.environ.get(k, "").lower() in ("1", "true", "yes", "on") for k in ("CI", "NO_COLOR", "LITEDOC_NO_ANIMATE")):
        return False
    if os.environ.get("LITEDOC_ANIMATE", "").lower() in ("0", "false", "no", "off"):
        return False
    config = _load_config()
    if config.get("animate", True) is False or config.get("show_animation", True) is False:
        return False
    return sys.stderr.isatty() or sys.stdout.isatty()


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
    if _should_animate(args):
        from .animation import run_animation
        run_animation(show_prompt=False, stream=sys.stderr)
    log(f"litedoc-cli {__version__} — engine identical to litedoc.xyz")

    def _discover_inputs():
        found = []
        for spec in args.files:
            if spec == "-":
                found.append(("-", None))
                continue
            if getattr(args, "recursive", False):
                if any(c in spec for c in "*?["):
                    matches = sorted(Path(".").glob(spec))
                else:
                    p = Path(spec)
                    if p.is_dir():
                        matches = sorted(p.rglob("*.pdf"))
                    else:
                        matches = [p]
            else:
                matches = sorted(Path(".").glob(spec)) if any(c in spec for c in "*?[") else [Path(spec)]
            for p in matches:
                if not p.is_file():
                    continue
                found.append((str(p), p))
        return found

    inputs = _discover_inputs()
    if not inputs and not args.watch:
        print("litedoc: no input files.", file=sys.stderr)
        return 2

    out_dir = None
    out_file = None
    if args.output:
        out_path = Path(args.output)
        if len(inputs) > 1 or getattr(args, "recursive", False) or getattr(args, "watch", False) or out_path.is_dir() or str(args.output).endswith(("/", "\\")):
            out_dir = out_path
            out_dir.mkdir(parents=True, exist_ok=True)
        else:
            out_file = out_path

    config = _load_config()
    img_res = str(config.get("img_res", config.get("img-res", "300")) if getattr(args, "img_res", "300") == "300" else getattr(args, "img_res", "300"))
    auto_resolve = str(config.get("auto_resolve", config.get("auto-resolve", "clean")) if getattr(args, "auto_resolve", "clean") == "clean" else getattr(args, "auto_resolve", "clean"))
    ocr = getattr(args, "ocr", False) or bool(config.get("ocr", False))
    lang = str(config.get("lang", "auto") if getattr(args, "lang", "auto") == "auto" else getattr(args, "lang", "auto"))
    quiet = getattr(args, "quiet", False) or bool(config.get("quiet", False))
    verbose = getattr(args, "verbose", False) or bool(config.get("verbose", False))

    engine = Engine(ocr=ocr, lang=lang, quiet=quiet,
                    img_res=img_res, auto_resolve=auto_resolve, verbose=verbose)
    failures = 0
    results = []

    pages_to_keep = parse_page_ranges(getattr(args, "pages", ""))

    def _process_inputs(current_inputs, processed_states=None):
        nonlocal failures
        processed_count = 0
        for name, path in current_inputs:
            if path and processed_states is not None:
                mtime = path.stat().st_mtime
                if str(path) in processed_states and processed_states[str(path)] >= mtime:
                    continue
                processed_states[str(path)] = mtime
            
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

            if pages_to_keep:
                filtered_md = []
                # Keep metadata like Title if present before pages start
                # Actually, simplest is to use layout block if present, else just basic splitting.
                # Assuming layout contains {'page': N, 'text': ...} or we parse '## Page X'
                if result.get("layout"):
                    filtered_md = []
                    for block in result["layout"]:
                        if block.get("page") in pages_to_keep:
                            if "text" in block:
                                filtered_md.append(block["text"])
                    md = "\n\n".join(filtered_md)
                else:
                    # fallback to string splitting if layout is missing
                    lines = md.split('\n')
                    filtered_lines = []
                    current_page = 1
                    for line in lines:
                        if line.startswith('## Page '):
                            try:
                                current_page = int(line.replace('## Page ', '').strip())
                            except ValueError:
                                pass
                        if current_page in pages_to_keep:
                            filtered_lines.append(line)
                    md = "\n".join(filtered_lines)

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
            elif len(current_inputs) > 1 and path:
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
            elif args.source_map and len(current_inputs) > 1 and path:
                sm_path = path.with_suffix(".source-map.json")
                _write_source_map(result, sm_path, log)
            elif args.source_map and out_file is None:
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
            elif len(current_inputs) > 1:
                sibling = path.with_suffix(".md") if path else Path("stdin.md")
                sibling.write_text(md, encoding="utf-8")
                log(f"wrote {sibling}")
            else:
                sys.stdout.write(md)
                if not md.endswith("\n"):
                    sys.stdout.write("\n")
            processed_count += 1
        return processed_count

    try:
        if args.watch:
            processed_states = {}
            log("Watching for files...")
            while True:
                current_inputs = _discover_inputs()
                _process_inputs(current_inputs, processed_states)
                time.sleep(1.0)
        else:
            _process_inputs(inputs)

    finally:
        engine.close()

    if args.json:
        json.dump(results if len(results) != 1 else results[0], sys.stdout, indent=2)
        sys.stdout.write("\n")
    return 1 if failures else 0


def cmd_animate(args) -> int:
    from .animation import run_animation
    run_animation(show_prompt=True, stream=sys.stdout)
    return 0


def cmd_config(args) -> int:
    config = _load_config()
    modified = False
    if getattr(args, "animate", False):
        config["animate"] = True
        modified = True
    elif getattr(args, "no_animate", False):
        config["animate"] = False
        modified = True
    
    if getattr(args, "set", None):
        for item in args.set:
            if "=" in item:
                k, v = item.split("=", 1)
                k = k.strip()
                v_clean = v.strip().lower()
                if v_clean in ("true", "yes", "1", "on"):
                    config[k] = True
                elif v_clean in ("false", "no", "0", "off"):
                    config[k] = False
                else:
                    try:
                        config[k] = int(v.strip())
                    except ValueError:
                        config[k] = v.strip()
                modified = True
    
    if modified:
        _save_config(config)
    else:
        path = _get_config_path()
        print(f"# Config Path: {path}")
        defaults = {
            "animate": True,
            "img_res": "300",
            "auto_resolve": "clean",
            "ocr": False,
            "lang": "auto",
            "verbose": False,
            "quiet": False,
            "_note": "Using defaults. Use 'litedoc config --set KEY=VALUE' to customize (e.g. --set img_res=600 auto_resolve=render)."
        }
        display_conf = defaults.copy()
        display_conf.update(config)
        if config:
            display_conf["_note"] = "Custom configuration loaded. Use 'litedoc config --set KEY=VALUE' to modify."
        print(json.dumps(display_conf, indent=2))
    return 0


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
    conv.add_argument("--img-res", choices=["75", "150", "300", "600"], default="300", help="Image resolution")
    conv.add_argument("--auto-resolve", choices=["render", "gibberish", "clean", "skip"], default="clean", help="Auto-resolve action")
    conv.add_argument("--pages", help="Page range to keep (e.g. 1-5,10)")
    conv.add_argument("-r", "--recursive", action="store_true", help="Recursively find PDFs in directories")
    conv.add_argument("-w", "--watch", action="store_true", help="Watch directories for new PDFs")
    conv.add_argument("-v", "--verbose", action="store_true", help="Verbose terminal diagnostics")
    conv.add_argument("--animate", action="store_true", help="Force display ASCII startup animation before processing")
    conv.add_argument("--no-animate", action="store_true", help="Disable ASCII startup animation")
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
    conv.set_defaults(func=cmd_convert)

    anim = sub.add_parser("animate", help="Display the animated LiteDoc CLI startup sequence")
    anim.set_defaults(func=cmd_animate)

    cfg = sub.add_parser("config", help="View or manage CLI configuration settings")
    cfg_group = cfg.add_mutually_exclusive_group()
    cfg_group.add_argument("--animate", action="store_true", help="Enable startup animation on load in configuration")
    cfg_group.add_argument("--no-animate", action="store_true", help="Disable startup animation on load in configuration")
    cfg.add_argument("--set", metavar="KEY=VALUE", nargs="+", help="Set arbitrary configuration options")
    cfg.set_defaults(func=cmd_config)

    bm = sub.add_parser("benchmark", help="Run a headless performance benchmark")
    bm.add_argument("--iterations", type=int, default=3, help="Number of benchmark iterations")
    bm.add_argument("--json", action="store_true", help="Output benchmark results as JSON")
    bm.add_argument("--quiet", action="store_true", help="Suppress progress messages")
    
    # We defer import benchmark to avoid overhead if not used
    def run_benchmark_cmd(args):
        from .benchmark import cmd_benchmark
        return cmd_benchmark(args)
    bm.set_defaults(func=run_benchmark_cmd)

    args = parser.parse_args(argv)
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
