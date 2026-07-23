#!/usr/bin/env bash
# LiteDoc test suite — zero external dependencies beyond node + python3
# (the E2E test additionally needs playwright, and skips itself if absent).
set -u
set -o pipefail  # a unittest failure must survive the `| tail` below
cd "$(dirname "$0")/.."

fail=0

echo "── JS unit tests (node:test) ──────────────────"
node --test tests/js/*.test.mjs || fail=1

echo
echo "── Python unit + E2E tests (unittest) ─────────"
python3 -m unittest discover -s tests/py -t . -v 2>&1 | tail -25 || fail=1

exit $fail
