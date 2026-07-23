"""Tests for cli/litedoc_cli/ai.py — triage, chunking, prompt hardening,
and the sanitizer's anti-drift guards.
Run: python3 -m unittest discover -s tests/py -v
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "cli"))

from litedoc_cli import ai  # noqa: E402


class TestTriage(unittest.TestCase):
    def test_clean_prose_skips_the_llm(self):
        text = (
            "# A Heading\n\n"
            "This is a complete sentence that ends properly. Another follows it.\n\n"
            "A second clean paragraph, also fine."
        )
        self.assertFalse(ai.chunk_needs_cleanup(text))

    def test_table_without_separator_needs_cleanup(self):
        self.assertTrue(ai.chunk_needs_cleanup("| a | b |\n| c | d |"))

    def test_well_formed_table_is_clean(self):
        self.assertFalse(ai.chunk_needs_cleanup("| a | b |\n|---|---|\n| c | d |"))

    def test_ragged_table_columns_need_cleanup(self):
        self.assertTrue(ai.chunk_needs_cleanup(
            "| a | b |\n|---|---|\n| c | d | e | f |"
        ))

    def test_mid_sentence_line_break_needs_cleanup(self):
        self.assertTrue(ai.chunk_needs_cleanup(
            "The sentence was broken in the\nmiddle without punctuation"
        ))

    def test_missing_space_after_period_needs_cleanup(self):
        self.assertTrue(ai.chunk_needs_cleanup("word ends.Next starts wrong."))

    def test_empty_text_is_clean(self):
        self.assertFalse(ai.chunk_needs_cleanup(""))
        self.assertFalse(ai.chunk_needs_cleanup("\n\n\n"))


class TestSplitChunks(unittest.TestCase):
    def test_respects_max_chars_for_normal_paragraphs(self):
        md = "\n\n".join(f"Paragraph number {i} with some text." for i in range(30))
        chunks = ai.split_chunks(md, 200)
        self.assertGreater(len(chunks), 1)
        for c in chunks:
            self.assertLessEqual(len(c), 250)  # small tolerance for joins

    def test_content_survives_the_round_trip(self):
        md = "\n\n".join(f"Unique paragraph {i}." for i in range(10))
        rejoined = "\n\n".join(ai.split_chunks(md, 100))
        for i in range(10):
            self.assertIn(f"Unique paragraph {i}.", rejoined)


class TestPrompt(unittest.TestCase):
    def test_delimiter_wraps_chunk_and_is_named_in_system(self):
        system, user, delim = ai._prompt("some content")
        self.assertIn(delim, system)
        self.assertTrue(user.startswith(delim))
        self.assertTrue(user.rstrip().endswith(delim))
        self.assertIn("some content", user)

    def test_delimiter_is_unique_per_call(self):
        _, _, d1 = ai._prompt("x")
        _, _, d2 = ai._prompt("x")
        self.assertNotEqual(d1, d2)


class TestSanitize(unittest.TestCase):
    ORIGINAL = ("A reasonably long original paragraph that the model was asked "
                "to clean up carefully without changing meaning at all.")

    def test_extracts_delimited_span_and_drops_chatter(self):
        raw = (
            "Sure! Here is the cleaned text:\n"
            "<LITEDOC_CONTENT_AB12CD34>\nCleaned paragraph that is roughly the "
            "same length as the original text was before cleaning it.\n"
            "<LITEDOC_CONTENT_AB12CD34>\nHope that helps!"
        )
        out = ai._sanitize(raw, self.ORIGINAL)
        self.assertNotIn("Sure!", out)
        self.assertNotIn("Hope that helps", out)
        self.assertIn("Cleaned paragraph", out)

    def test_empty_response_returns_original(self):
        self.assertEqual(ai._sanitize("", self.ORIGINAL), self.ORIGINAL)
        self.assertEqual(ai._sanitize("   ", self.ORIGINAL), self.ORIGINAL)

    def test_truncated_rewrite_is_rejected(self):
        # Under 30% of the original length → drift guard returns the original.
        self.assertEqual(ai._sanitize("tiny", self.ORIGINAL), self.ORIGINAL)

    def test_ballooned_rewrite_is_rejected(self):
        huge = "spam " * 200 + self.ORIGINAL * 3
        self.assertEqual(ai._sanitize(huge, self.ORIGINAL), self.ORIGINAL)

    def test_reasonable_untagged_response_passes(self):
        rewritten = self.ORIGINAL.replace("cleaned up", "tidied")
        self.assertEqual(ai._sanitize(rewritten, self.ORIGINAL), rewritten)


class TestRepairByoTriage(unittest.TestCase):
    def test_only_damaged_chunks_reach_the_model(self):
        clean = ("This paragraph is perfectly fine. It has complete sentences. "
                 "Nothing needs repair here at all.")
        damaged = "broken mid\nsentence line that clearly needs.Repair badly"
        md = clean + "\n\n" + damaged
        calls = []

        def fake_call(url, model, system, user, timeout):
            calls.append(user)
            return user  # echo: sanitizer extracts the delimited span

        with mock.patch.object(ai, "_call_ollama", side_effect=fake_call):
            out = ai.repair_byo(md, "http://fake:11434", "m", "ollama",
                                4000, 30.0, lambda m: None)

        self.assertEqual(len(calls), 1, "clean chunk must never be sent")
        self.assertIn("needs.Repair", calls[0])
        self.assertIn(clean, out)


if __name__ == "__main__":
    unittest.main()
