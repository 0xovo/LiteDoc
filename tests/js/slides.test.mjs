// Regressions from real lecture slides (KSU, 2026-10): Wingdings bullets made
// whole pages vanish, and words split across PDF space glyphs got glued.
// Run: node --test tests/js/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSymbolGlyph, detectCorruptedFonts, joinLineItems } from '../../src/core/utils/utils.js';

const it = (str, x, width, extra = {}) => ({ str, x, y: 100, width, height: 24, fontName: 'F3', ...extra });

test('isSymbolGlyph: lone PUA / bullet chars only', () => {
    assert.ok(isSymbolGlyph(''));
    assert.ok(isSymbolGlyph('  '));
    assert.ok(isSymbolGlyph('•'));
    assert.ok(!isSymbolGlyph(''));
    assert.ok(!isSymbolGlyph('a'));
    assert.ok(!isSymbolGlyph(''));
});

test('detectCorruptedFonts: a Wingdings bullet font is not corruption', () => {
    // Every bullet on a slide is its own one-glyph item in the symbol font.
    const items = [];
    for (let i = 0; i < 8; i++) items.push({ str: '', fontName: 'Wingdings' }, { str: 'Real text here', fontName: 'Body' });
    assert.equal(detectCorruptedFonts(items).size, 0);
});

test('detectCorruptedFonts: runs of PUA glyphs are still flagged', () => {
    const items = [{ str: '', fontName: 'Broken' }];
    assert.ok(detectCorruptedFonts(items).has('Broken'));
});

test('joinLineItems: an explicit space glyph between runs is a word break', () => {
    // "oriented" ends at 295.4, the PDF's " " is 295.4-299.4, "subprotocol" starts at 299.4:
    // a 4pt gap, under the 0.18*24 = 4.32pt threshold. The space glyph decides.
    const line = [it('Connection-oriented', 142.3, 153.1), it(' ', 295.4, 4.0, { height: 0 }), it('subprotocol', 299.4, 88.4)];
    assert.equal(joinLineItems(line), 'Connection-oriented subprotocol');
});

test('joinLineItems: no space glyph and a tight gap still joins (kerned word parts)', () => {
    assert.equal(joinLineItems([it('Connec', 100, 50), it('tion', 151, 30)]), 'Connection');
});
