"""Tests for enhanced CLI parsing flags and helper functions."""
import argparse
import unittest
from unittest.mock import patch
from pathlib import Path
import sys

# Add cli directory to sys.path so we can import litedoc_cli
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "cli") not in sys.path:
    sys.path.insert(0, str(ROOT / "cli"))

from litedoc_cli.cli import parse_page_range
import litedoc_cli.cli as cli


class TestCLIHelpers(unittest.TestCase):
    def test_parse_page_range(self):
        """Test parsing of page range strings."""
        self.assertEqual(parse_page_range(""), set())
        self.assertEqual(parse_page_range("5"), {5})
        self.assertEqual(parse_page_range("1-3"), {1, 2, 3})
        self.assertEqual(parse_page_range("1-3,5,8-10"), {1, 2, 3, 5, 8, 9, 10})
        self.assertEqual(parse_page_range(" 2, 4-5 "), {2, 4, 5})

class TestCLIParser(unittest.TestCase):
    def setUp(self):
        self.original_exit = sys.exit
        sys.exit = self.mock_exit
        self.exit_code = None

    def tearDown(self):
        sys.exit = self.original_exit

    def mock_exit(self, code):
        self.exit_code = code
        raise SystemExit(code)

    def test_new_convert_flags(self):
        """Test the new enhanced convert flags by verifying argparse configuration."""
        parsed_args = None
        def mock_func(args):
            nonlocal parsed_args
            parsed_args = args
            return 0
        
        with patch('litedoc_cli.cli.cmd_convert', side_effect=mock_func):
            try:
                cli.main(["convert", "dummy.pdf", "--img-res", "600", "--auto-resolve", "skip", "--pages", "1-5", "--verbose", "--recursive", "--watch"])
            except SystemExit:
                pass
                
        self.assertIsNotNone(parsed_args, "cmd_convert was not called, argument parsing may have failed")
        self.assertEqual(parsed_args.img_res, "600")
        self.assertEqual(parsed_args.auto_resolve, "skip")
        self.assertEqual(parsed_args.pages, "1-5")
        self.assertTrue(parsed_args.verbose)
        self.assertTrue(parsed_args.recursive)
        self.assertTrue(parsed_args.watch)

    def test_benchmark_subcommand(self):
        """Test the new benchmark subcommand parser logic."""
        original_parse_args = argparse.ArgumentParser.parse_args
        
        parsed_args = None
        def side_effect_parse_args(parser_self, args=None, namespace=None):
            nonlocal parsed_args
            parsed_args = original_parse_args(parser_self, args, namespace)
            # Prevent execution of lambda/func
            parsed_args.func = lambda x: 0
            return parsed_args

        with patch('argparse.ArgumentParser.parse_args', side_effect=side_effect_parse_args, autospec=True):
            try:
                cli.main(["benchmark", "--iterations", "5", "--json"])
            except SystemExit:
                pass
                
        self.assertIsNotNone(parsed_args)
        self.assertEqual(parsed_args.command, "benchmark")
        self.assertEqual(parsed_args.iterations, 5)
        self.assertTrue(parsed_args.json)

if __name__ == "__main__":
    unittest.main()
