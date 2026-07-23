"""Tests for the release tooling — the leak-prevention layer that keeps the
public GitHub build free of AI-addon code and dev-only URLs.
Run: python3 -m unittest discover -s tests/py -v
"""
import importlib.util
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


zipmod = _load("make_release_zip", ROOT / "scripts" / "make_release_zip.py")
buildmod = _load("build", ROOT / "scripts" / "build.py")


class TestZipExclusions(unittest.TestCase):
    def test_local_state_files_are_excluded(self):
        for rel in (
            "training/optimizer_state.db",
            "training/dashboard/data.json",
            "training/push_status.py",
            "training/notify_improvement.py",
            "cli/litedoc_cli/app/index.html",
            "src/test_ocr.js",
        ):
            self.assertTrue(zipmod.is_excluded(Path(rel)), f"{rel} must be excluded")

    def test_shippable_files_are_included(self):
        for rel in ("src/index.html", "scripts/build.py", "cli/litedoc_cli/cli.py",
                    "training/benchmark/scoring.py"):
            self.assertFalse(zipmod.is_excluded(Path(rel)), f"{rel} must ship")

    def test_corpora_and_pycache_are_excluded_anywhere(self):
        self.assertTrue(zipmod.is_excluded(Path("training/source_materials/Academic/a.pdf")))
        self.assertTrue(zipmod.is_excluded(Path("training/holdout_materials/b.pdf")))
        self.assertTrue(zipmod.is_excluded(Path("cli/litedoc_cli/__pycache__/x.pyc")))
        self.assertTrue(zipmod.is_excluded(Path("scripts/foo.pyc")))


class TestLeakPatterns(unittest.TestCase):
    def test_ai_addon_markers_match(self):
        for marker in ("LiteDoc-AI-Addon", "ai-addon.js", "ai-clean-btn",
                       "litedoc_ai_token"):
            hit = any(re.search(p, marker, re.IGNORECASE)
                      for p in zipmod.CODE_LEAK_PATTERNS)
            self.assertTrue(hit, f"{marker} must trip the scanner")

    def test_dev_url_patterns_match(self):
        for leak in ("http://127.0.0.1:8000/api", "http://localhost:5500/w",
                     "Bearer abc123", "sk-" + "a" * 24):
            hit = any(re.search(p, leak, re.IGNORECASE)
                      for p in zipmod.LEAK_PATTERNS_BLOCKING_IN_DIST)
            self.assertTrue(hit, f"{leak!r} must trip the dist scanner")

    def test_dev_tag_pattern_strips_localhost_only(self):
        html = (
            '<script src="http://localhost:5500/widget/ai-addon.js"></script>\n'
            '<link rel="stylesheet" href="http://127.0.0.1:5500/w/a.css">\n'
            '<script src="vendor/pdf.min.js"></script>\n'
        )
        out = zipmod.DEV_TAG_PATTERN.sub("", html)
        self.assertNotIn("localhost", out)
        self.assertNotIn("127.0.0.1", out)
        self.assertIn("vendor/pdf.min.js", out)


class TestBuildHelpers(unittest.TestCase):
    def test_is_dev_only_url(self):
        self.assertTrue(buildmod.is_dev_only_url("http://localhost:5500/x.js"))
        self.assertTrue(buildmod.is_dev_only_url("http://127.0.0.1:8000/y.css"))
        self.assertFalse(buildmod.is_dev_only_url(
            "https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.2/ace.min.js"))

    def test_widget_tags_carry_base_url_and_cache_bust(self):
        tags = buildmod.build_ai_widget_tags("https://api.litedoc.xyz/widget", "9.9.9")
        self.assertIn("https://api.litedoc.xyz/widget", tags)
        self.assertIn("?v=9.9.9-", tags)  # per-build unique bust

    def test_widget_tags_never_reference_localhost(self):
        tags = buildmod.build_ai_widget_tags("https://api.litedoc.xyz/widget", "1.0")
        self.assertNotIn("localhost", tags)
        self.assertNotIn("127.0.0.1", tags)


class TestPublicArtifactIsClean(unittest.TestCase):
    """If a built public edition exists on disk, hold it to the leak rules."""

    DIST = ROOT / "dist" / "index.html"

    @unittest.skipUnless(DIST.exists(), "no dist build present")
    def test_dist_has_no_ai_addon_markers(self):
        text = self.DIST.read_text(encoding="utf-8", errors="ignore")
        for pattern in zipmod.CODE_LEAK_PATTERNS:
            self.assertIsNone(re.search(pattern, text, re.IGNORECASE),
                              f"public dist contains {pattern!r}")

    @unittest.skipUnless(DIST.exists(), "no dist build present")
    def test_dist_has_no_dev_urls(self):
        text = self.DIST.read_text(encoding="utf-8", errors="ignore")
        for pattern in (r"http://127\.0\.0\.1", r"http://localhost"):
            self.assertIsNone(re.search(pattern, text, re.IGNORECASE),
                              f"public dist contains {pattern!r}")


if __name__ == "__main__":
    unittest.main()
