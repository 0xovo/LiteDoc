"""Tests for training/benchmark/scoring.py — the order-aware fitness function.

The critical regression tests here encode the v3.0.0 plateau fix: reversed
paragraph order and merged table cells MUST score lower than correct output.
Run: python3 -m unittest discover -s tests/py -v
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "training"))

from benchmark.scoring import (  # noqa: E402
    _normalize_math,
    _order_concordance,
    _parse_markdown_tables,
    _table_similarity,
    calculate_fitness,
    score_math,
    score_prose,
    score_tables,
)


class TestOrderConcordance(unittest.TestCase):
    def test_sorted_positions_are_perfect(self):
        self.assertEqual(_order_concordance([10, 20, 30, 40]), 1.0)

    def test_reversed_positions_score_zero(self):
        self.assertEqual(_order_concordance([40, 30, 20, 10]), 0.0)

    def test_single_position_is_perfect(self):
        self.assertEqual(_order_concordance([5]), 1.0)


class TestScoreProse(unittest.TestCase):
    PARAGRAPHS = [
        "The quick brown fox jumps over the lazy dog near the river bank.",
        "Meanwhile the parser reconstructs every paragraph in reading order.",
        "Finally the document ends with a short concluding remark about tables.",
    ]

    def test_perfect_extraction_scores_high(self):
        text = "\n\n".join(self.PARAGRAPHS)
        self.assertGreater(score_prose(self.PARAGRAPHS, text), 0.95)

    def test_reversed_block_order_scores_lower(self):
        # The plateau root cause: order-blind scoring gave reversed output a
        # perfect score. The order-aware metric must penalize it.
        correct = "\n\n".join(self.PARAGRAPHS)
        reversed_text = "\n\n".join(reversed(self.PARAGRAPHS))
        self.assertLess(
            score_prose(self.PARAGRAPHS, reversed_text),
            score_prose(self.PARAGRAPHS, correct) - 0.1,
        )

    def test_scrambled_words_score_lower_than_correct(self):
        correct = "\n\n".join(self.PARAGRAPHS)
        scrambled = "\n\n".join(
            " ".join(reversed(p.split())) for p in self.PARAGRAPHS
        )
        self.assertLess(
            score_prose(self.PARAGRAPHS, scrambled),
            score_prose(self.PARAGRAPHS, correct),
        )

    def test_empty_ground_truth_is_perfect(self):
        self.assertEqual(score_prose([], "whatever"), 1.0)


class TestTables(unittest.TestCase):
    TABLE_MD = (
        "| Name | Score |\n"
        "|---|---|\n"
        "| Alpha | 10 |\n"
        "| Beta | 20 |\n"
    )

    def test_parse_markdown_tables_extracts_cells(self):
        tables = _parse_markdown_tables(self.TABLE_MD)
        self.assertEqual(len(tables), 1)
        self.assertIn(["Alpha", "10"], tables[0])

    def test_exact_table_scores_full(self):
        gt = [[["Name", "Score"], ["Alpha", "10"], ["Beta", "20"]]]
        self.assertGreater(score_tables(gt, self.TABLE_MD), 0.9)

    def test_missing_table_scores_zero(self):
        gt = [[["Name", "Score"], ["Alpha", "10"]]]
        self.assertEqual(score_tables(gt, "No tables in this text at all."), 0.0)

    def test_merged_cells_score_less_than_exact(self):
        gt_table = [["Name", "Score"], ["Alpha", "10"], ["Beta", "20"]]
        exact = [["Name", "Score"], ["Alpha", "10"], ["Beta", "20"]]
        merged = [["Name Score"], ["Alpha 10"], ["Beta 20"]]
        self.assertLess(
            _table_similarity(gt_table, merged),
            _table_similarity(gt_table, exact),
        )


class TestMath(unittest.TestCase):
    def test_normalize_math_strips_dollars_and_case(self):
        self.assertEqual(_normalize_math("$$E = MC^2$$"), _normalize_math("e = mc^2"))
        self.assertEqual(_normalize_math(r"\text{speed} = d/t"), "speed = d/t")

    def test_preserved_math_scores_full(self):
        gt = ["E = mc^2"]
        self.assertGreater(score_math(gt, "Some text $$E = mc^2$$ more text"), 0.9)

    def test_empty_math_is_perfect(self):
        self.assertEqual(score_math([], "anything"), 1.0)


class TestCalculateFitness(unittest.TestCase):
    def _gt_file(self, payload):
        f = tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8"
        )
        json.dump(payload, f)
        f.close()
        self.addCleanup(lambda: Path(f.name).unlink(missing_ok=True))
        return f.name

    def test_returns_all_score_components(self):
        gt = self._gt_file({"prose": ["Hello world paragraph."], "tables": [], "math": []})
        result = calculate_fitness(gt, "Hello world paragraph.")
        for key in ("overall", "prose", "tables", "math", "rtl"):
            self.assertIn(key, result)

    def test_weighting_without_rtl(self):
        gt = self._gt_file({"prose": ["Exact match text here."], "tables": [], "math": []})
        r = calculate_fitness(gt, "Exact match text here.")
        expected = r["prose"] * 0.4 + r["tables"] * 0.4 + r["math"] * 0.2
        self.assertAlmostEqual(r["overall"], expected, places=6)

    def test_weighting_with_rtl(self):
        gt = self._gt_file({
            "prose": ["English text."], "tables": [], "math": [],
            "rtl": ["نص عربي للاختبار هنا."],
        })
        r = calculate_fitness(gt, "English text.\n\nنص عربي للاختبار هنا.")
        expected = (r["prose"] * 0.3 + r["tables"] * 0.3
                    + r["math"] * 0.2 + r["rtl"] * 0.2)
        self.assertAlmostEqual(r["overall"], expected, places=6)


if __name__ == "__main__":
    unittest.main()
