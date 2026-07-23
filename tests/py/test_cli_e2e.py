"""End-to-end test: the real extraction engine, headless, on a fixture PDF.

Slow (spins up Chromium). Skipped automatically when Playwright or the
bundled engine is missing. Run just this file:
    python3 -m unittest tests.py.test_cli_e2e -v
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "cli"))

FIXTURE = ROOT / "tests" / "fixtures" / "figtest.pdf"
ENGINE_HTML = ROOT / "cli" / "litedoc_cli" / "app" / "index.html"

try:
    import playwright  # noqa: F401
    HAVE_PLAYWRIGHT = True
except ImportError:
    HAVE_PLAYWRIGHT = False


@unittest.skipUnless(HAVE_PLAYWRIGHT, "playwright not installed")
@unittest.skipUnless(FIXTURE.exists(), "fixture PDF missing")
@unittest.skipUnless(ENGINE_HTML.exists(), "bundled engine missing — run scripts/build.py")
class TestEngineEndToEnd(unittest.TestCase):
    """One engine instance for the class — Chromium startup is the slow part."""

    @classmethod
    def setUpClass(cls):
        from litedoc_cli.engine import Engine
        cls.engine = Engine(ocr=False, lang="auto", quiet=True)
        cls.result = cls.engine.convert(FIXTURE.read_bytes(), "figtest.pdf")

    @classmethod
    def tearDownClass(cls):
        cls.engine.close()

    def test_markdown_contains_document_text(self):
        md = self.result["markdown"]
        self.assertIn("Quarterly Performance Analysis", md)
        self.assertIn("caching layer was rewritten", md)

    def test_reading_order_is_correct(self):
        md = self.result["markdown"]
        intro = md.index("summarizes measured throughput")
        conclusion = md.index("roughly twice its starting capacity")
        self.assertLess(intro, conclusion, "paragraphs out of order")

    def test_figure_is_extracted_with_bbox_and_data(self):
        images = self.result["images"]
        self.assertEqual(len(images), 1)
        img = images[0]
        self.assertEqual(img["page"], 1)
        bbox = img["bbox"]
        for k in ("x", "y", "w", "h"):
            self.assertIn(k, bbox)
        self.assertGreater(bbox["w"], 100, "crop suspiciously narrow")
        self.assertTrue((img.get("data_url") or "").startswith("data:image/"))

    def test_figure_sits_above_its_caption(self):
        md = self.result["markdown"]
        fig = md.index("![Figure 1]")
        caption = md.index("Figure 1: Scatter")
        self.assertLess(fig, caption)
        self.assertLess(caption - fig, 200, "figure not adjacent to caption")

    def test_axis_labels_consumed_into_figure_not_prose(self):
        # 'TPS' and the x-axis title live inside the cropped image now;
        # leaking them as stray text lines is the old bug.
        md = self.result["markdown"]
        self.assertNotRegex(md, r"(?m)^TPS$")
        self.assertNotRegex(md, r"(?m)^Quarter \(2025–2026\)$")

    def test_structured_layout_envelope(self):
        layout = self.result["layout"]
        self.assertEqual(len(layout), 1)
        page = layout[0]
        self.assertEqual(page["page"], 1)
        self.assertGreater(len(page["lines"]), 3)
        line = page["lines"][0]
        for k in ("text", "y", "x0", "x1", "font_size", "block", "ocr"):
            self.assertIn(k, line)

    def test_page_count(self):
        self.assertEqual(self.result["num_pages"], 1)

    def test_source_map_exists(self):
        """Source map should be present in the result envelope."""
        sm = self.result.get("source_map")
        self.assertIsNotNone(sm, "source_map missing from result")
        self.assertIsInstance(sm, list)

    def test_source_map_blocks_have_provenance(self):
        """Every block in the source map must have page, bbox, type, confidence."""
        sm = self.result.get("source_map", [])
        self.assertGreater(len(sm), 0, "source_map is empty — expected at least one block")
        for block in sm:
            self.assertIn("page", block)
            self.assertIn("md_range", block)
            self.assertIsInstance(block["md_range"], list)
            self.assertEqual(len(block["md_range"]), 2)
            self.assertIn("bbox", block)
            bbox = block["bbox"]
            for k in ("x0", "y0", "x1", "y1"):
                self.assertIn(k, bbox)
            self.assertIn("type", block)
            self.assertIn(block["type"], ("heading", "paragraph", "table"))
            self.assertIn("confidence", block)
            self.assertIn(block["confidence"], ("high", "low", "medium"))

    def test_source_map_block_points_into_markdown(self):
        """Each block's md_range must point to valid content inside mdText."""
        md = self.result["markdown"]
        for block in self.result.get("source_map", []):
            start, end = block["md_range"]
            self.assertGreaterEqual(start, 0, f"negative start in block {block}")
            self.assertLessEqual(end, len(md), f"range end past mdText length in block {block}")
            snippet = md[start:end]
            self.assertTrue(snippet.strip(), f"empty snippet at [{start}:{end}]")

    def test_low_confidence_pages_structure(self):
        """low_confidence_pages should be a list with structured entries (or empty)."""
        lc = self.result.get("low_confidence_pages")
        self.assertIsNotNone(lc, "low_confidence_pages missing from result")
        self.assertIsInstance(lc, list)
        for entry in lc:
            self.assertIn("page", entry)
            self.assertIn("confidence", entry)
            self.assertIn("reasons", entry)
            self.assertIsInstance(entry["reasons"], list)
            self.assertGreater(len(entry["reasons"]), 0)


if __name__ == "__main__":
    unittest.main()
