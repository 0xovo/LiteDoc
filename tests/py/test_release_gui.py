"""Tests for scripts/release_gui.py — params validation, DEFAULT_CONFIG
patching (both parser twins), and report rendering.
Run: python3 -m unittest discover -s tests/py -t . -v
"""
import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


gui = _load("release_gui", ROOT / "scripts" / "release_gui.py")

AB_FIXTURE = {
    "baseline": {"score": 0.52, "breakdown": {"Academic": {"score": 0.50, "expected": 2}}},
    "candidate": {"score": 0.55, "breakdown": {"Academic": {"score": 0.55, "expected": 2}}},
    "delta_points": 3.0,
    "dataset": "training/sample_materials",
}


class TestShippedDefaults(unittest.TestCase):
    def test_parses_full_config_from_bundle(self):
        d = gui.shipped_defaults()
        self.assertEqual(len(d), 15)
        self.assertIn("horizontalGapMultiplier", d)
        self.assertIn("garbageScoreThreshold", d)

    def test_twins_carry_identical_config(self):
        # Twin drift in DEFAULT_CONFIG would mean the benchmark measures one
        # parser while the release ships another.
        core = gui.CORE_JS.read_text(encoding="utf-8")
        twin = gui.TWIN_JS.read_text(encoding="utf-8")
        s, e = gui._config_block(core)
        cs, ce = gui._config_block(twin)
        import re
        core_vals = dict(re.findall(r"(\w+)\s*:\s*(-?[\d.eE+]+)", core[s:e]))
        twin_vals = dict(re.findall(r"(\w+)\s*:\s*(-?[\d.eE+]+)", twin[cs:ce]))
        self.assertEqual(core_vals, twin_vals)


class TestValidateCandidate(unittest.TestCase):
    def test_accepts_real_current_params_file(self):
        raw = (ROOT / "training" / "current_params.json").read_text(encoding="utf-8")
        params = gui.validate_candidate(raw)
        self.assertEqual(len(params), 13)
        self.assertNotIn("_bestScore", params)

    def test_rejects_unknown_keys_and_bad_values(self):
        for bad in ('{"evilKey": 1}', '{"horizontalGapMin": "x"}', "[1, 2]", "{}"):
            with self.assertRaises(ValueError, msg=bad):
                gui.validate_candidate(bad)


class TestApplyParams(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.core = self.tmp / "core.js"
        self.twin = self.tmp / "twin.js"
        shutil.copy(gui.CORE_JS, self.core)
        shutil.copy(gui.TWIN_JS, self.twin)
        self.orig = gui.CORE_JS, gui.TWIN_JS
        gui.CORE_JS, gui.TWIN_JS = self.core, self.twin
        self.addCleanup(self._restore)

    def _restore(self):
        gui.CORE_JS, gui.TWIN_JS = self.orig

    def test_patches_both_twins_and_round_trips(self):
        raw = (ROOT / "training" / "current_params.json").read_text(encoding="utf-8")
        params = gui.validate_candidate(raw)
        gui.apply_params_to_source(params)
        reparsed = gui.shipped_defaults()  # reads the patched copy
        for key, val in params.items():
            self.assertAlmostEqual(reparsed[key], val, places=12, msg=key)
        # non-tuned keys survive untouched
        self.assertEqual(reparsed["itemOverlapTolerance"], 4)

    def test_unknown_key_aborts_without_writing_either_file(self):
        before_core = self.core.read_text(encoding="utf-8")
        before_twin = self.twin.read_text(encoding="utf-8")
        with self.assertRaises(ValueError):
            gui.apply_params_to_source({"horizontalGapMin": 5, "nope": 1})
        self.assertEqual(self.core.read_text(encoding="utf-8"), before_core)
        self.assertEqual(self.twin.read_text(encoding="utf-8"), before_twin)


class TestRendering(unittest.TestCase):
    def _render(self, **kw):
        args = dict(version="9.9.9", ab=AB_FIXTURE, server_scores={}, highlights=[])
        args.update(kw)
        return gui.render_release_md(args["version"], args["ab"],
                                     args["server_scores"], args["highlights"])

    def test_release_md_is_single_version_with_table(self):
        md = self._render()
        self.assertTrue(md.startswith("# LiteDoc v9.9.9"))
        self.assertIn("| Academic", md)
        self.assertIn("+3.00", md)
        # single-release document: no other version sections stacked in
        self.assertEqual(md.count("# LiteDoc v"), 1)

    def test_release_md_never_names_internal_tooling(self):
        md = self._render(server_scores={"_holdoutScore": 0.56},
                          highlights=["Fixed a thing"])
        for leak in ("release_gui", "benchmark_ab", "release.py", ".py`",
                     "current_params.json", "DEFAULT_CONFIG"):
            self.assertNotIn(leak, md, f"internal name {leak!r} leaked into RELEASE.md")

    def test_release_md_includes_server_holdout_and_highlights(self):
        md = self._render(server_scores={"_holdoutScore": 0.5614},
                          highlights=["OCR auto-detect now routes Japanese", ""])
        self.assertIn("56.14%", md)
        self.assertIn("held-out", md)
        self.assertIn("- OCR auto-detect now routes Japanese", md)

    def test_version_already_released_detects_v310(self):
        self.assertTrue(gui.version_already_released("3.1.0"))
        self.assertFalse(gui.version_already_released("99.0.0"))

    def test_suggest_version_bumps_patch(self):
        v = gui.suggest_version()
        self.assertRegex(v, r"^\d+\.\d+\.\d+$")
        self.assertFalse(gui.version_already_released(v))


if __name__ == "__main__":
    unittest.main()
