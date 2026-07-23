// Tests for src/core/utils/utils.js — script classification, gibberish
// detection, line joining, char-weighted heading classification, dedup.
// Run: node --test tests/js/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    scriptBucket, detectCorruptedFonts, itemGibberishScore, joinLineItems,
    detectColumnSplit, classifyHeadings, headingLevel, buildFingerprintSet,
} from '../../src/core/utils/utils.js';

test('scriptBucket: classifies representative code points', () => {
    assert.equal(scriptBucket('A'.codePointAt(0)), 'latin-basic');
    assert.equal(scriptBucket('あ'.codePointAt(0)), 'hiragana');
    assert.equal(scriptBucket('ア'.codePointAt(0)), 'katakana');
    assert.equal(scriptBucket('ا'.codePointAt(0)), 'arabic');
    assert.equal(scriptBucket(0xE000), 'pua');
    assert.equal(scriptBucket('中'.codePointAt(0)), 'cjk-unified');
});

test('detectCorruptedFonts: flags font with mostly PUA glyphs', () => {
    const items = [
        { fontName: 'BadFont', str: 'hello' },
        { fontName: 'GoodFont', str: 'perfectly normal readable text' },
    ];
    const corrupted = detectCorruptedFonts(items);
    assert.ok(corrupted.has('BadFont'));
    assert.ok(!corrupted.has('GoodFont'));
});

test('detectCorruptedFonts: ignores fonts with under 3 scored chars', () => {
    const corrupted = detectCorruptedFonts([{ fontName: 'Tiny', str: '' }]);
    assert.ok(!corrupted.has('Tiny'));
});

test('detectCorruptedFonts: subset font prefix lowers the threshold', () => {
    // ABCDEF+Name subset fonts are flagged above 5% suspicious.
    const str = '' + 'abcdefghijk'; // 1/12 ≈ 8.3% suspicious
    const corrupted = detectCorruptedFonts([{ fontName: 'ABCDEF+Sub', str }]);
    assert.ok(corrupted.has('ABCDEF+Sub'));
});

test('itemGibberishScore: clean ASCII scores 0', () => {
    assert.equal(itemGibberishScore('The quick brown fox.', 'F1', new Set()), 0);
});

test('itemGibberishScore: all-PUA text saturates to 1', () => {
    assert.equal(itemGibberishScore('', 'F1', new Set()), 1);
});

test('itemGibberishScore: flagged font short-circuits to 1', () => {
    assert.equal(itemGibberishScore('normal text', 'Bad', new Set(['Bad'])), 1.0);
});

test('itemGibberishScore: empty and whitespace score 0', () => {
    assert.equal(itemGibberishScore('', 'F1', new Set()), 0);
    assert.equal(itemGibberishScore('   ', 'F1', new Set()), 0);
});

test('joinLineItems: inserts space across a wide gap, none when tight', () => {
    const items = [
        { str: 'Hello', x: 0, width: 50, height: 10 },
        { str: 'world', x: 53, width: 50, height: 10 },  // 3px gap > 1.8px threshold
    ];
    assert.equal(joinLineItems(items, {}), 'Hello world');
    const tight = [
        { str: 'Hel', x: 0, width: 30, height: 10 },
        { str: 'lo', x: 30.5, width: 20, height: 10 },   // 0.5px gap
    ];
    assert.equal(joinLineItems(tight, {}), 'Hello');
});

test('joinLineItems: sorts by x and drops whitespace-only items', () => {
    const items = [
        { str: 'world', x: 60, width: 50, height: 10 },
        { str: '   ', x: 55, width: 4, height: 10 },
        { str: 'Hello', x: 0, width: 50, height: 10 },
    ];
    assert.equal(joinLineItems(items, {}), 'Hello world');
    assert.equal(joinLineItems([], {}), '');
});

test('classifyHeadings: char-weighting resists a dense table of small type', () => {
    // 30 short table-cell lines at 8pt vs 5 long body lines at 12pt.
    // Naive median would say 8pt is body; char-weighted must say 12pt.
    const lines = [
        ...Array.from({ length: 30 }, () => ({ text: '42', fontSize: 8 })),
        ...Array.from({ length: 5 }, () => ({
            text: 'A long paragraph line with plenty of characters in it to weigh things properly.',
            fontSize: 12,
        })),
    ];
    const t = classifyHeadings(lines);
    assert.equal(t.median, 12);
});

test('classifyHeadings: empty input returns empty object', () => {
    assert.deepEqual(classifyHeadings([]), {});
    assert.deepEqual(classifyHeadings([{ text: '', fontSize: 12 }]), {});
});

test('headingLevel: body text is level 0, big text is a heading', () => {
    const t = { median: 10, p85: 10, p95: 16 };
    assert.equal(headingLevel(10, t, false), 0);
    assert.ok(headingLevel(16, t, false) > 0);
    assert.equal(headingLevel(null, t, false), 0);
    assert.equal(headingLevel(10, null, false), 0);
});

test('headingLevel: bold at body size is NOT a heading', () => {
    const t = { median: 10, p85: 12, p95: 16 };
    assert.equal(headingLevel(10, t, true), 0);
});

test('buildFingerprintSet: repeated page header detected, needs 3+ pages', () => {
    const header = 'Journal of Testing — Vol 4';
    const lines = [header, 'unique one', header, 'unique two', header, 'unique three'];
    const set = buildFingerprintSet(lines, 3);
    assert.ok(set.has(header));
    assert.ok(!set.has('unique one'));
    assert.equal(buildFingerprintSet(lines, 2).size, 0);
});

test('detectColumnSplit: finds gutter in a two-column layout', () => {
    const left = Array.from({ length: 6 }, (_, i) => ({ xMin: 40, xMax: 280, y: i * 20 }));
    const right = Array.from({ length: 6 }, (_, i) => ({ xMin: 320, xMax: 560, y: i * 20 }));
    const split = detectColumnSplit([...left, ...right], 600);
    assert.ok(split !== null, 'expected a split');
    assert.ok(split > 280 && split < 320, `split ${split} should fall in the gutter`);
});

test('detectColumnSplit: single column has no split', () => {
    const lines = Array.from({ length: 8 }, (_, i) => ({ xMin: 40, xMax: 560, y: i * 20 }));
    assert.equal(detectColumnSplit(lines, 600), null);
});
