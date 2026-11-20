
// script classifier
function scriptBucket(cp) {
    // C0 and C1 control characters are never real text content. A text layer
    // that carries them in quantity is a broken glyph mapping (subset fonts
    // whose ToUnicode maps point at control slots), not Latin prose.
    if ((cp >= 0x0000 && cp <= 0x001F) || (cp >= 0x007F && cp <= 0x009F)) return 'control';
    if (cp >= 0x0020 && cp <= 0x007F) return 'latin-basic';
    if (cp >= 0x0080 && cp <= 0x024F) return 'latin-ext';
    if (cp >= 0x0250 && cp <= 0x02FF) return 'ipa';
    if (cp >= 0x0300 && cp <= 0x036F) return 'combining';
    if (cp >= 0x0370 && cp <= 0x03FF) return 'greek';
    if (cp >= 0x0400 && cp <= 0x04FF) return 'cyrillic';
    if (cp >= 0x0600 && cp <= 0x06FF) return 'arabic';
    if (cp >= 0x0900 && cp <= 0x097F) return 'devanagari';
    if (cp >= 0x1800 && cp <= 0x18AF) return 'mongolian';
    if (cp >= 0x2000 && cp <= 0x206F) return 'general-punct';
    if (cp >= 0x2070 && cp <= 0x209F) return 'super-sub';
    if (cp >= 0x20A0 && cp <= 0x20CF) return 'currency';
    if (cp >= 0x2100 && cp <= 0x214F) return 'letterlike';
    if (cp >= 0x2150 && cp <= 0x218F) return 'numforms';
    if (cp >= 0x2190 && cp <= 0x21FF) return 'arrows';
    if (cp >= 0x2200 && cp <= 0x22FF) return 'math-ops';
    if (cp >= 0x2300 && cp <= 0x23FF) return 'misc-tech';
    if (cp >= 0x2400 && cp <= 0x243F) return 'control-pics';
    if (cp >= 0x2440 && cp <= 0x245F) return 'ocr';
    if (cp >= 0x2460 && cp <= 0x24FF) return 'enclosed-alpha';
    if (cp >= 0x2500 && cp <= 0x257F) return 'box-drawing';
    if (cp >= 0x2580 && cp <= 0x259F) return 'block-elements';
    if (cp >= 0x25A0 && cp <= 0x25FF) return 'geom-shapes';
    if (cp >= 0x2600 && cp <= 0x27FF) return 'misc-symbols';
    if (cp >= 0x2800 && cp <= 0x28FF) return 'braille';
    if (cp >= 0x2E80 && cp <= 0x2FFF) return 'cjk-radicals';
    if (cp >= 0x3000 && cp <= 0x303F) return 'cjk-symbols';
    if (cp >= 0x3040 && cp <= 0x309F) return 'hiragana';
    if (cp >= 0x30A0 && cp <= 0x30FF) return 'katakana';
    if (cp >= 0x3100 && cp <= 0x312F) return 'bopomofo';
    if (cp >= 0x3190 && cp <= 0x319F) return 'kanbun';
    if (cp >= 0x3200 && cp <= 0x32FF) return 'enclosed-cjk';
    if (cp >= 0x3300 && cp <= 0x33FF) return 'cjk-compat';
    if (cp >= 0x3400 && cp <= 0x9FFF) return 'cjk-unified';
    if (cp >= 0xA000 && cp <= 0xA4CF) return 'yi';
    if (cp >= 0xE000 && cp <= 0xF8FF) return 'pua';
    if (cp >= 0xFB00 && cp <= 0xFDFF) return 'arabic-pres';
    if (cp >= 0xFE00 && cp <= 0xFEFF) return 'halfwidth';
    if (cp >= 0xFFF0 && cp <= 0xFFFF) return 'specials';
    if (cp >= 0xF0000) return 'pua-supp';
    return 'other';
}

// suspicious buckets
const SUSPICIOUS_BUCKETS = new Set([
    'braille', 'mongolian', 'cjk-radicals', 'cjk-symbols',
    'hiragana', 'katakana', 'enclosed-cjk', 'cjk-compat',
    'cjk-unified', 'pua', 'pua-supp', 'specials', 'yi',
    'misc-symbols', 'control-pics', 'control'
]);

// Targeted text hygiene (Q6): expand ONLY the characters that are known
// compatibility forms: Latin ligatures (U+FB00 to U+FB04) and Arabic
// presentation forms (U+FB50 to U+FDFF, U+FE70 to U+FEFF). Each such char
// is normalised on its own, which maps it to its standard form. This is
// deliberately NOT a blanket NFKC pass over the string: NFKC also rewrites
// fractions, superscripts, and the micro sign, which the math path needs
// exactly as written.
function expandText(str) {
    if (!str) return str;
    let out = '';
    for (const ch of str) {
        const cp = ch.codePointAt(0);
        if ((cp >= 0xFB00 && cp <= 0xFB04) || (cp >= 0xFB50 && cp <= 0xFDFF) || (cp >= 0xFE70 && cp <= 0xFEFF)) {
            out += ch.normalize('NFKC');
        } else {
            out += ch;
        }
    }
    return out;
}

// corruption detector
// A lone bullet glyph: Wingdings/Symbol fonts put list markers in the Private
// Use Area (U+F0A7, U+F0FC ...). One isolated PUA char is a list marker, not a broken encoding.
function isSymbolGlyph(str) {
    const t = (str || '').trim();
    if ([...t].length !== 1) return false;
    const cp = t.codePointAt(0);
    return (cp >= 0xE000 && cp <= 0xF8FF) || '\u2022\u25AA\u25AB\u25CF\u25E6\u25A0\u25A1\u2023\u2043\u27A2\u2756\u25BA\u2713\u2714'.includes(t);
}

function detectCorruptedFonts(rawItems) {
    // group by font
    const byFont = {};
    for (const item of rawItems) {
        if (isSymbolGlyph(item.str)) continue;
        const fn = item.fontName || '__unknown__';
        if (!byFont[fn]) byFont[fn] = { chars: 0, suspicious: 0, controls: 0, buckets: new Set() };
        const entry = byFont[fn];
        for (const ch of (item.str || '')) {
            const cp = ch.codePointAt(0);
            if (cp === 0x20 || cp === 0x09 || cp === 0x0A || cp === 0x0D) continue; // real whitespace
            entry.chars++;
            const bkt = scriptBucket(cp);
            entry.buckets.add(bkt);
            if (bkt === 'control') entry.controls++;
            if (SUSPICIOUS_BUCKETS.has(bkt)) entry.suspicious++;
        }
    }

    const corrupted = new Set();
    for (const [fn, stats] of Object.entries(byFont)) {
        if (stats.chars < 3) continue;
        const suspRatio = stats.suspicious / stats.chars;

        // Control characters in quantity are a broken glyph mapping on
        // their own, even when the rest of the font reads as a real script
        // (the WeasyPrint Arabic subset case: real Arabic letters mixed
        // with C0 controls and stray Latin for the missing glyphs).
        const ctrlRatio = (stats.controls || 0) / stats.chars;
        if (ctrlRatio > 0.02) { corrupted.add(fn); continue; }

        // hard rule > 30%
        if (suspRatio > 0.30) { corrupted.add(fn); continue; }

        // soft rule
        if (suspRatio > 0.08) {
            const hasSuspicious = [...stats.buckets].some(b => SUSPICIOUS_BUCKETS.has(b));
            const hasLatin = stats.buckets.has('latin-basic') || stats.buckets.has('latin-ext');
            if (hasSuspicious && hasLatin) { corrupted.add(fn); continue; }
        }

        // subset fonts
        if (/^[A-Z]{6}\+/.test(fn) && suspRatio > 0.05) {
            corrupted.add(fn); continue;
        }
    }
    return corrupted;
}

// gibberish scorer
function itemGibberishScore(str, fontName, corruptedFonts) {
    // skip if font already flagged
    if (corruptedFonts && corruptedFonts.has(fontName)) return 1.0;

    if (!str || !str.trim()) return 0;
    const clean = str.replace(/\s/g, '');
    if (!clean.length) return 0;

    let puaBad = 0, suspBad = 0, totalScored = 0;
    const buckets = new Set();

    for (const ch of clean) {
        const cp = ch.codePointAt(0);
        if (cp === 0x20) continue; // controls stay: they are the garbage signal
        totalScored++;
        const bkt = scriptBucket(cp);
        buckets.add(bkt);
        if (bkt === 'pua' || bkt === 'pua-supp' || bkt === 'specials') { puaBad++; }
        else if (SUSPICIOUS_BUCKETS.has(bkt)) { suspBad++; }
    }

    if (!totalScored) return 0;

    const puaRatio = puaBad / totalScored;
    const suspRatio = suspBad / totalScored;

    // script mix penalty
    const suspBuckets = [...buckets].filter(b => SUSPICIOUS_BUCKETS.has(b));
    const hasLatin = buckets.has('latin-basic') || buckets.has('latin-ext');
    const mixPenalty = (hasLatin && suspBuckets.length >= 2) ? 0.5 : 0;

    return Math.min(1, puaRatio * 2.0 + suspRatio * 1.2 + mixPenalty);
}

// smart word join
function joinLineItems(items, config) {
    if (!items.length) return '';
    const hm = (config && config.horizontalGapMultiplier) || 1.0;
    
    // sort x, skip whitespace-only items
    const validItems = items.filter(it => it.str && it.str.trim());
    // The PDF's own space glyphs: a space item sitting between two runs is a real word
    // break even when the measured gap is under the threshold ("BasicNetworking").
    const spaceSpans = items.filter(it => it.str && !it.str.trim()).map(it => [it.x, it.x + (it.width || 0)]);
    if (!validItems.length) return '';
    const sorted = [...validItems].sort((a, b) => a.x - b.x);
    // Per-line gap-fraction inference (Q6): a line's own gap distribution
    // says more than a fixed threshold. Kerning gaps cluster near zero and
    // word gaps sit well above them, so when the line has enough gaps to
    // judge, cap the space threshold at 2.2x the median positive gap. The
    // cap only ever lowers the fixed threshold, and never below 6 percent
    // of the glyph height, so loose lines keep the old behaviour.
    const lineGaps = [];
    for (let i = 1; i < sorted.length; i++) {
        const g = sorted[i].x - (sorted[i - 1].x + (sorted[i - 1].width || 0));
        if (g > 0) lineGaps.push(g);
    }
    let medianGap = 0;
    if (lineGaps.length >= 3) {
        const sg = [...lineGaps].sort((a, b) => a - b);
        medianGap = sg[Math.floor(sg.length / 2)];
    }
    let result = sorted[0].str;
    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        // prev right edge
        const prevRight = prev.x + (prev.width || 0);
        const gap = curr.x - prevRight;

        // Punctuation kerning is tighter. Lower the space threshold if the previous text ends with punctuation.
        const endsWithPunctuation = /[.,;:!?]/.test(prev.str.trim().slice(-1));
        let spaceThreshold = (prev.height || 10) * (endsWithPunctuation ? 0.08 : 0.18) * hm;
        if (medianGap > 0) {
            const adaptive = Math.max(medianGap * 2.2, (prev.height || 10) * 0.06);
            spaceThreshold = Math.min(spaceThreshold, adaptive);
        }

        // Subscript / Superscript / Drop-cap logic
        const isDropCap = prev.str.length === 1 && prev.height > (curr.height * 1.5) && gap < curr.height;
        const isSuperSub = (curr.height < prev.height * 0.75 || prev.height < curr.height * 0.75) && Math.abs((curr.y || 0) - (prev.y || 0)) > 1;

        // space insert
        const explicitSpace = spaceSpans.some(([s0, s1]) => s0 >= prevRight - 1 && s1 <= curr.x + 1);
        let needSpace = (gap > spaceThreshold || explicitSpace) && !result.endsWith(' ') && !curr.str.startsWith(' ');
        if (isDropCap || isSuperSub) {
            needSpace = false;
        }

        // ignore overlaps
        result += (needSpace ? ' ' : '') + curr.str;
    }
    return result.replace(/\s+/g, ' ').trim();
}

// col detector
function detectColumnSplit(lines, pageWidth) {
    if (lines.length < 4) return null;

    let bestScore = -1;
    let splitCandidates = [];
    const searchStart = pageWidth * 0.25;
    const searchEnd = pageWidth * 0.75;

    for (let x = searchStart; x <= searchEnd; x += 5) {
        let intersections = 0;
        let leftCount = 0;
        let rightCount = 0;

        for (const lg of lines) {
            // Ignore spanning headers/footers/figures (>60% of page width)
            if ((lg.xMax - lg.xMin) > pageWidth * 0.6) continue;

            if (x >= lg.xMin && x <= lg.xMax) {
                intersections++;
            } else if (lg.xMax < x) {
                leftCount++;
            } else if (lg.xMin > x) {
                rightCount++;
            }
        }

        if (leftCount >= 2 && rightCount >= 2) {
            const score = Math.min(leftCount, rightCount) - (intersections * 10);
            if (score > bestScore) {
                bestScore = score;
                splitCandidates = [x];
            } else if (score === bestScore) {
                splitCandidates.push(x);
            }
        }
    }

    let splitX = null;
    if (bestScore > 0 && splitCandidates.length > 0) {
        const center = pageWidth / 2;
        splitX = splitCandidates.reduce((prev, curr) =>
            Math.abs(curr - center) < Math.abs(prev - center) ? curr : prev
        );
    }

    return splitX;
}

// headings
function classifyHeadings(allLines) {
    // Sizes are weighted by text length so a dense table of small type (many
    // short "lines") can't drag the body-text median toward its font size.
    const weighted = allLines
        .filter(l => l.text && l.fontSize > 0)
        .map(l => ({ fs: l.fontSize, w: l.text.replace(/\s+/g, '').length }))
        .filter(e => e.w > 0);
    if (!weighted.length) return {};

    weighted.sort((a, b) => a.fs - b.fs);
    const total = weighted.reduce((s, e) => s + e.w, 0);
    const pick = (q) => {
        let acc = 0;
        for (const e of weighted) { acc += e.w; if (acc >= total * q) return e.fs; }
        return weighted[weighted.length - 1].fs;
    };

    // 0=body, 1=h3, 2=h2, 3=h1
    return { median: pick(0.5), p85: pick(0.85), p95: pick(0.95) };
}

function headingLevel(fontSize, thresholds, isBold) {
    if (!thresholds || !fontSize) return 0;
    const { median, p85, p95 } = thresholds;
    
    // Must be noticeably larger than body text to be a heading
    if (fontSize <= median * 1.05 && !isBold) return 0;
    
    // If it's bold and slightly larger, it's a heading.
    // If it's bold and SAME size, it's just bold body text, not a heading.
    if (fontSize <= median * 1.02 && isBold) return 0; 

    if (p95 > median * 1.1 && fontSize >= p95 * 0.97) return isBold ? 3 : (p95 > p85 * 1.1 ? 2 : 3);
    if (p85 > median * 1.1 && fontSize >= p85 * 0.97) return isBold ? 2 : 1;
    if (fontSize > median * 1.15 || (isBold && fontSize > median * 1.05)) return 1;
    
    return 0;
}

// Furniture fingerprints (Q3): two copies of the same running header must
// produce the same fingerprint even when one carries a page number or the
// items were joined with different spacing, so fingerprints strip all
// whitespace and fold every digit run to a single marker.
function normalizeFingerprint(text) {
    return (text || '').replace(/\s+/g, '').replace(/\d+/g, '#');
}

// dedup
function buildFingerprintSet(allPageLines, totalPages) {
    if (totalPages < 3) return new Set();
    const freq = {};
    for (const line of allPageLines) {
        const fp = normalizeFingerprint(line);
        if (fp.length < 3 || fp.length > 120) continue;
        freq[fp] = (freq[fp] || 0) + 1;
    }
    // 30 percent recurrence (was 50): a header that only appears from the
    // second section onward is still furniture.
    const threshold = Math.max(2, Math.ceil(totalPages * 0.3));
    const repeating = new Set();
    for (const [fp, count] of Object.entries(freq)) {
        if (count >= threshold) repeating.add(fp);
    }
    return repeating;
}

export { scriptBucket, isSymbolGlyph, expandText, normalizeFingerprint, detectCorruptedFonts, itemGibberishScore, joinLineItems, detectColumnSplit, classifyHeadings, headingLevel, buildFingerprintSet };

// global ace sync flag removed - consolidated in state.js

export const setAceValueLazy = function(editor, value) {
    if (!editor) return;
    window.isSyncingAce = true;
    editor.setValue(value, -1);
    window.isSyncingAce = false;
};
